/**
 * markets.ts — Cross-venue market matching.
 *
 * Fetches ALL markets from both Polymarket (Gamma API) and Kalshi,
 * then matches them by text similarity. Only markets that exist on
 * both venues are shown — this is an aggregator, single-venue markets
 * are useless.
 *
 * Polymarket: paginated Gamma API (no limit)
 * Kalshi:     /trade-api/v2/events with nested markets
 */

import fs from "fs";
import path from "path";
import type { GammaMarket, Market } from "./types";

// ── API URLs ────────────────────────────────────────────────────────────────

const GAMMA_BASE =
  "https://gamma-api.polymarket.com/markets?closed=false&archived=false&active=true&order=liquidityNum&ascending=false";
const GAMMA_PAGE_SIZE = 100; // max per request
const GAMMA_MAX_PAGES = 10; // up to 1000 markets

const KALSHI_EVENTS_URL =
  "https://api.elections.kalshi.com/trade-api/v2/events?limit=200&status=open&with_nested_markets=true";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cachedMarkets: Market[] = [];
let activeMarketId: string | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

// ── Manual pairings (conditionId → kalshiTicker) ────────────────────────────

const PAIRINGS_FILE = path.join(__dirname, "..", "data", "pairings.json");
const manualPairings = new Map<string, string>();

// Load persisted pairings on module init
try {
  if (fs.existsSync(PAIRINGS_FILE)) {
    const raw = JSON.parse(fs.readFileSync(PAIRINGS_FILE, "utf-8")) as Record<string, string>;
    for (const [k, v] of Object.entries(raw)) {
      manualPairings.set(k, v);
    }
    console.log(`[markets] loaded ${manualPairings.size} manual pairings from disk`);
  }
} catch (err) {
  console.warn(`[markets] could not load pairings.json: ${(err as Error).message}`);
}

function savePairings(): void {
  try {
    const dir = path.dirname(PAIRINGS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, string> = {};
    for (const [k, v] of manualPairings) obj[k] = v;
    fs.writeFileSync(PAIRINGS_FILE, JSON.stringify(obj, null, 2));
  } catch (err) {
    console.error(`[markets] failed to save pairings.json: ${(err as Error).message}`);
  }
}

function applyManualPairings(): void {
  for (const market of cachedMarkets) {
    const override = manualPairings.get(market.id);
    if (override !== undefined) {
      market.kalshiTicker = override || undefined;
    }
  }
}

export function setManualPairing(marketId: string, kalshiTicker: string): Market | null {
  const market = cachedMarkets.find((m) => m.id === marketId);
  if (!market) return null;

  if (kalshiTicker) {
    manualPairings.set(marketId, kalshiTicker);
    market.kalshiTicker = kalshiTicker;
  } else {
    manualPairings.delete(marketId);
    market.kalshiTicker = undefined;
  }

  savePairings();
  return market;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseJsonField<T>(raw: string | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Normalize text for comparison: lowercase, strip punctuation, collapse spaces */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extract key terms from a market question for matching */
function extractKeyTerms(text: string): Set<string> {
  const norm = normalize(text);
  // Remove common stop words
  const stops = new Set([
    "will", "the", "be", "a", "an", "of", "in", "on", "at", "by", "to",
    "is", "it", "for", "and", "or", "this", "that", "before", "after",
    "from", "with", "has", "have", "do", "does", "did",
  ]);
  return new Set(
    norm.split(" ").filter((w) => w.length > 1 && !stops.has(w))
  );
}

/** Jaccard similarity between two term sets */
function termSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const term of a) {
    if (b.has(term)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ── Polymarket fetch (paginated) ────────────────────────────────────────────

interface PolyMarketEntry {
  id: string;
  title: string;
  category: string;
  midpoint: number;
  tokenId: string;
  volatility: number;
  slug?: string;
  terms: Set<string>;
}

async function fetchAllPolymarkets(): Promise<PolyMarketEntry[]> {
  console.log("[markets] fetching ALL Polymarket markets (paginated)...");
  const allEntries: PolyMarketEntry[] = [];

  for (let page = 0; page < GAMMA_MAX_PAGES; page++) {
    const offset = page * GAMMA_PAGE_SIZE;
    const url = `${GAMMA_BASE}&limit=${GAMMA_PAGE_SIZE}&offset=${offset}`;

    try {
      const res = await fetch(url);
      if (!res.ok) break;
      const data = (await res.json()) as GammaMarket[];
      if (data.length === 0) break;

      for (const gm of data) {
        if (!gm.enableOrderBook) continue;

        const tokenIds = parseJsonField<string[]>(gm.clobTokenIds, []);
        const prices = parseJsonField<string[]>(gm.outcomePrices, []);
        const outcomes = parseJsonField<string[]>(gm.outcomes, []);
        if (tokenIds.length === 0) continue;

        let yesIndex = outcomes.findIndex((o) => o.toLowerCase() === "yes");
        if (yesIndex === -1) yesIndex = 0;

        const yesTokenId = tokenIds[yesIndex];
        if (!yesTokenId) continue;

        const yesPrice = prices[yesIndex] ? parseFloat(prices[yesIndex]) : 0.5;
        const midpoint = Math.round(yesPrice * 10000) / 10000;
        const distFrom50 = Math.abs(midpoint - 0.5);
        const volatility = Math.max(0.3, Math.min(1.5,
          Math.round((1.0 - distFrom50 * 1.5) * 100) / 100
        ));

        allEntries.push({
          id: gm.conditionId,
          title: gm.question,
          category: gm.groupItemTitle || "General",
          midpoint,
          tokenId: yesTokenId,
          volatility,
          slug: gm.slug,
          terms: extractKeyTerms(gm.question),
        });
      }

      console.log(`[markets]   page ${page + 1}: +${data.length} raw → ${allEntries.length} with order books`);
      if (data.length < GAMMA_PAGE_SIZE) break; // last page
    } catch (err) {
      console.error(`[markets] Gamma API page ${page} failed: ${(err as Error).message}`);
      break;
    }
  }

  console.log(`[markets] Polymarket total: ${allEntries.length} markets`);
  return allEntries;
}

// ── Kalshi fetch (events with nested markets) ───────────────────────────────

interface KalshiMarketEntry {
  ticker: string;
  title: string;
  eventTitle: string;
  category: string;
  terms: Set<string>;
}

async function fetchAllKalshiMarkets(): Promise<KalshiMarketEntry[]> {
  console.log("[markets] fetching ALL Kalshi events...");
  const allEntries: KalshiMarketEntry[] = [];
  let cursor: string | null = null;
  let pageCount = 0;

  while (pageCount < 20) { // safety limit
    const url = cursor
      ? `${KALSHI_EVENTS_URL}&cursor=${encodeURIComponent(cursor)}`
      : KALSHI_EVENTS_URL;

    try {
      const res = await fetch(url);
      if (!res.ok) break;
      const data = await res.json() as {
        events?: Array<{
          title?: string;
          category?: string;
          markets?: Array<{
            ticker?: string;
            title?: string;
            subtitle?: string;
            yes_sub_title?: string;
          }>;
        }>;
        cursor?: string;
      };

      const events = data.events || [];
      if (events.length === 0) break;

      for (const event of events) {
        const eventTitle = event.title || "";
        const category = event.category || "General";
        const markets = event.markets || [];

        for (const m of markets) {
          if (!m.ticker) continue;
          // Use the event title as the main title (more descriptive)
          const title = m.title || m.subtitle || eventTitle;
          allEntries.push({
            ticker: m.ticker,
            title,
            eventTitle,
            category,
            terms: extractKeyTerms(`${eventTitle} ${title}`),
          });
        }
      }

      pageCount++;
      console.log(`[markets]   Kalshi page ${pageCount}: ${events.length} events → ${allEntries.length} markets total`);

      cursor = data.cursor || null;
      if (!cursor) break;
    } catch (err) {
      console.error(`[markets] Kalshi API failed: ${(err as Error).message}`);
      break;
    }
  }

  console.log(`[markets] Kalshi total: ${allEntries.length} markets`);
  return allEntries;
}

// ── Cross-venue matching ────────────────────────────────────────────────────

const SIMILARITY_THRESHOLD = 0.25; // Minimum Jaccard similarity to consider a match
const KALSHI_OB_HOST = "api.elections.kalshi.com";

/** Check if a Kalshi ticker has a non-empty order book */
function validateKalshiOrderbook(ticker: string): Promise<boolean> {
  return new Promise((resolve) => {
    const https = require("https");
    const path = `/trade-api/v2/markets/${encodeURIComponent(ticker)}/orderbook?depth=5`;
    const req = https.request(
      { hostname: KALSHI_OB_HOST, port: 443, path, method: "GET",
        headers: { Accept: "application/json" } },
      (res: any) => {
        let body = "";
        res.on("data", (d: Buffer) => (body += d.toString()));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            const ob = data.orderbook_fp || data.orderbook;
            if (!ob) return resolve(false);
            const yesLevels = ob.yes_dollars || ob.yes || [];
            const noLevels = ob.no_dollars || ob.no || [];
            resolve(yesLevels.length > 0 || noLevels.length > 0);
          } catch {
            resolve(false);
          }
        });
      }
    );
    req.on("error", () => resolve(false));
    req.setTimeout(5000, () => { req.destroy(); resolve(false); });
    req.end();
  });
}

interface CandidateMatch {
  pm: PolyMarketEntry;
  kalshiTicker: string;
  kalshiTitle: string;
  score: number;
}

async function matchMarkets(
  polyMarkets: PolyMarketEntry[],
  kalshiMarkets: KalshiMarketEntry[],
): Promise<Market[]> {
  console.log("[markets] matching markets across venues...");

  // Phase 1: text-match candidates
  const candidates: CandidateMatch[] = [];
  const usedKalshi = new Set<string>();

  for (const pm of polyMarkets) {
    let bestMatch: KalshiMarketEntry | null = null;
    let bestScore = 0;

    for (const km of kalshiMarkets) {
      if (usedKalshi.has(km.ticker)) continue;
      const score = termSimilarity(pm.terms, km.terms);
      if (score > bestScore && score >= SIMILARITY_THRESHOLD) {
        bestScore = score;
        bestMatch = km;
      }
    }

    if (bestMatch) {
      usedKalshi.add(bestMatch.ticker);
      candidates.push({
        pm,
        kalshiTicker: bestMatch.ticker,
        kalshiTitle: bestMatch.title,
        score: bestScore,
      });
    }
  }

  console.log(`[markets] ${candidates.length} text-match candidates, validating order books...`);

  // Phase 2: validate each candidate has a live Kalshi order book (parallel, batched)
  const BATCH_SIZE = 10;
  const validated: CandidateMatch[] = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map((c) => validateKalshiOrderbook(c.kalshiTicker))
    );
    for (let j = 0; j < batch.length; j++) {
      if (results[j]) {
        validated.push(batch[j]);
      } else {
        console.log(`[markets]   REJECTED (empty book): ${batch[j].kalshiTicker} ↔ "${batch[j].pm.title.slice(0, 50)}"`);
      }
    }
  }

  // Build final market list
  const matched: Market[] = validated.map((c) => {
    console.log(
      `[markets]   MATCH (${(c.score * 100).toFixed(0)}%): "${c.pm.title.slice(0, 60)}" ↔ "${c.kalshiTitle.slice(0, 60)}" [${c.kalshiTicker}]`
    );
    return {
      id: c.pm.id,
      title: c.pm.title,
      category: c.pm.category,
      midpoint: c.pm.midpoint,
      tokenId: c.pm.tokenId,
      volatility: c.pm.volatility,
      polymarketSlug: c.pm.slug,
      kalshiTicker: c.kalshiTicker,
    };
  });

  console.log(`[markets] ${matched.length} validated matches (${candidates.length - matched.length} rejected for empty books)`);
  return matched;
}

// ── Callback for when markets are updated (set by caller) ───────────────────

let onMarketsUpdated: ((markets: Market[]) => void) | null = null;

export function setOnMarketsUpdated(cb: (markets: Market[]) => void): void {
  onMarketsUpdated = cb;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Phase 1: Quick init — fetches just the first page of Polymarket (~200ms).
 * Returns immediately usable markets so data can start flowing.
 */
export async function initMarketsQuick(): Promise<Market[]> {
  console.log("[markets] quick init — fetching first page of Polymarket...");
  const url = `${GAMMA_BASE}&limit=${GAMMA_PAGE_SIZE}&offset=0`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status}`);
    const data = (await res.json()) as GammaMarket[];

    const markets: Market[] = [];
    for (const gm of data) {
      if (!gm.enableOrderBook) continue;
      const tokenIds = parseJsonField<string[]>(gm.clobTokenIds, []);
      const prices = parseJsonField<string[]>(gm.outcomePrices, []);
      const outcomes = parseJsonField<string[]>(gm.outcomes, []);
      if (tokenIds.length === 0) continue;

      let yesIndex = outcomes.findIndex((o) => o.toLowerCase() === "yes");
      if (yesIndex === -1) yesIndex = 0;
      const yesTokenId = tokenIds[yesIndex];
      if (!yesTokenId) continue;

      const yesPrice = prices[yesIndex] ? parseFloat(prices[yesIndex]) : 0.5;
      const midpoint = Math.round(yesPrice * 10000) / 10000;
      const distFrom50 = Math.abs(midpoint - 0.5);
      const volatility = Math.max(0.3, Math.min(1.5,
        Math.round((1.0 - distFrom50 * 1.5) * 100) / 100
      ));

      markets.push({
        id: gm.conditionId,
        title: gm.question,
        category: gm.groupItemTitle || "General",
        midpoint,
        tokenId: yesTokenId,
        volatility,
        polymarketSlug: gm.slug,
      });
    }

    console.log(`[markets] quick init done — ${markets.length} markets ready`);
    cachedMarkets = markets;
    if (!activeMarketId && markets.length > 0) {
      activeMarketId = markets[0].id;
    }
    return markets;
  } catch (err) {
    console.error(`[markets] quick init failed: ${(err as Error).message}`);
    return [];
  }
}

/**
 * Phase 2: Full init — fetches all pages from both venues and matches.
 * Runs in background. Updates cachedMarkets when done and notifies caller.
 */
export async function initMarketsFull(): Promise<void> {
  console.log("[markets] full init — fetching all markets from both venues...");

  const [polyMarkets, kalshiMarkets] = await Promise.all([
    fetchAllPolymarkets(),
    fetchAllKalshiMarkets(),
  ]);

  const matched = await matchMarkets(polyMarkets, kalshiMarkets);

  if (matched.length > 0) {
    cachedMarkets = matched;
    if (!activeMarketId || !cachedMarkets.find((m) => m.id === activeMarketId)) {
      activeMarketId = cachedMarkets[0].id;
    }
    console.log(`[markets] full init done — ${matched.length} cross-venue matches`);
  } else {
    // Keep the quick-init Polymarket-only markets
    console.warn("[markets] no cross-venue matches found — keeping Polymarket-only list");
    // But enrich with all pages
    cachedMarkets = polyMarkets.map((pm) => ({
      id: pm.id,
      title: pm.title,
      category: pm.category,
      midpoint: pm.midpoint,
      tokenId: pm.tokenId,
      volatility: pm.volatility,
      polymarketSlug: pm.slug,
    }));
    if (cachedMarkets.length > 0 && !activeMarketId) {
      activeMarketId = cachedMarkets[0].id;
    }
  }

  // Manual pairings override auto-matched tickers
  applyManualPairings();

  // Notify caller so it can update workers with matched tickers
  if (onMarketsUpdated) {
    onMarketsUpdated(cachedMarkets);
  }

  // Periodic refresh
  if (!refreshTimer) {
    refreshTimer = setInterval(async () => {
      const [pm, km] = await Promise.all([
        fetchAllPolymarkets(),
        fetchAllKalshiMarkets(),
      ]);
      const fresh = await matchMarkets(pm, km);
      if (fresh.length > 0) {
        cachedMarkets = fresh;
        applyManualPairings();
        console.log(`[markets] cache refreshed — ${fresh.length} matched markets`);
        if (onMarketsUpdated) onMarketsUpdated(cachedMarkets);
      }
    }, CACHE_TTL_MS);
  }
}

export function getActiveMarket(): Market {
  const market = cachedMarkets.find((m) => m.id === activeMarketId);
  if (market) return market;
  if (cachedMarkets.length > 0) return cachedMarkets[0];

  return {
    id: "fallback",
    title: "No markets loaded",
    category: "Unknown",
    midpoint: 0.5,
    tokenId: "",
    volatility: 1.0,
  };
}

export function setActiveMarket(id: string): Market | null {
  const market = cachedMarkets.find((m) => m.id === id);
  if (!market) return null;
  activeMarketId = market.id;
  return market;
}

export function getAllMarkets(): Market[] {
  return cachedMarkets;
}
