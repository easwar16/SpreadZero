/**
 * aggregator.worker.ts — Thread 3: Aggregation engine.
 *
 * Polls POLY_SEQ and KS_SEQ from the SharedArrayBuffer at ~60fps (16ms).
 * When either sequence changes, reads both venue books, merges them into
 * an AggregatedBook, and posts it to the main thread via parentPort.
 *
 * Also runs staleness detection every 5 seconds.
 */

import { workerData, parentPort, isMainThread } from "worker_threads";
import {
  HDR, STATUS, SECTION, readLevels,
} from "../shared/buffer";
import type { AggregatedBook, PriceLevel } from "../types";

if (isMainThread) throw new Error("Must run as worker thread");

const { sharedBuffer, env } = workerData as {
  sharedBuffer: SharedArrayBuffer;
  env: Record<string, string>;
  market: { id: string; title: string; category: string };
};

Object.assign(process.env, env);

const hdr = new Int32Array(sharedBuffer);

const STALE_MS       = parseInt(env.STALE_THRESHOLD_MS      || "15000", 10);
const DISCONNECT_MS  = parseInt(env.DISCONNECT_THRESHOLD_MS || "45000", 10);

let lastPolySeq = -1;
let lastKsSeq   = -1;
let lastPolyUpdate = 0;
let lastKsUpdate   = 0;
let activeMarket = (workerData as any).market as { id: string; title: string; category: string };

// When true, Kalshi data is included in the merged book.
// Set to false when the current market has no matched Kalshi ticker.
let kalshiEnabled = !!(workerData as any).kalshiEnabled;

// ---- Merge logic (inline — no import of aggregator.ts state) ----

function mergeSide(
  polyLevels: PriceLevel[],
  ksLevels: PriceLevel[]
): PriceLevel[] {
  const map = new Map<number, PriceLevel>();

  for (const l of polyLevels) {
    map.set(l.price, { price: l.price, size: l.size, sources: { polymarket: l.size, kalshi: 0 } });
  }
  for (const l of ksLevels) {
    const existing = map.get(l.price);
    if (existing) {
      existing.size += l.size;
      existing.sources.kalshi = l.size;
    } else {
      map.set(l.price, { price: l.price, size: l.size, sources: { polymarket: 0, kalshi: l.size } });
    }
  }

  return Array.from(map.values());
}

function buildAggregatedBook(market: { id: string; title: string; category: string }): AggregatedBook {
  // Read counts
  const polyBidCount = Atomics.load(hdr, HDR.POLY_BID_COUNT);
  const polyAskCount = Atomics.load(hdr, HDR.POLY_ASK_COUNT);
  const ksBidCount   = Atomics.load(hdr, HDR.KS_BID_COUNT);
  const ksAskCount   = Atomics.load(hdr, HDR.KS_ASK_COUNT);

  // Read raw levels
  const polyBidsRaw = readLevels(sharedBuffer, SECTION.POLY_BIDS, polyBidCount);
  const polyAsksRaw = readLevels(sharedBuffer, SECTION.POLY_ASKS, polyAskCount);
  const ksBidsRaw   = readLevels(sharedBuffer, SECTION.KS_BIDS,   ksBidCount);
  const ksAsksRaw   = readLevels(sharedBuffer, SECTION.KS_ASKS,   ksAskCount);

  // Wrap raw levels as PriceLevel[]
  const polyBids: PriceLevel[] = polyBidsRaw.map(l => ({ price: l.price, size: l.size, sources: { polymarket: l.size, kalshi: 0 } }));
  const polyAsks: PriceLevel[] = polyAsksRaw.map(l => ({ price: l.price, size: l.size, sources: { polymarket: l.size, kalshi: 0 } }));
  const ksBids: PriceLevel[]   = ksBidsRaw.map(l => ({ price: l.price, size: l.size, sources: { polymarket: 0, kalshi: l.size } }));
  const ksAsks: PriceLevel[]   = ksAsksRaw.map(l => ({ price: l.price, size: l.size, sources: { polymarket: 0, kalshi: l.size } }));

  // Only merge Kalshi data if we have a matched ticker for this market
  const useBids = kalshiEnabled ? mergeSide(polyBids, ksBids) : polyBids;
  const useAsks = kalshiEnabled ? mergeSide(polyAsks, ksAsks) : polyAsks;

  const bids = useBids.sort((a, b) => b.price - a.price);
  const asks = useAsks.sort((a, b) => a.price - b.price);

  const bestBid = bids.length > 0 ? bids[0].price : 0;
  const bestAsk = asks.length > 0 ? asks[0].price : 1;
  const spread    = Math.round((bestAsk - bestBid) * 10000) / 10000;
  const midpoint  = Math.round(((bestAsk + bestBid) / 2) * 10000) / 10000;

  // Read status
  const polyStatus = Atomics.load(hdr, HDR.POLY_STATUS);
  const ksStatus   = Atomics.load(hdr, HDR.KS_STATUS);

  const statusLabel = (s: number) =>
    s === STATUS.LIVE ? "live" : s === STATUS.STALE ? "stale" : "disconnected";

  return {
    market: { id: market.id, title: market.title, category: market.category },
    bids,
    asks,
    spread,
    midpoint,
    venueStatus: {
      polymarket: {
        status: statusLabel(polyStatus),
        lastUpdate: lastPolyUpdate > 0 ? new Date(lastPolyUpdate).toISOString() : null,
        isMock: false,
      },
      kalshi: {
        status: statusLabel(ksStatus),
        lastUpdate: lastKsUpdate > 0 ? new Date(lastKsUpdate).toISOString() : null,
        isMock: false,
      },
    },
    timestamp: new Date().toISOString(),
  };
}

// ---- Staleness detection ----

function checkStaleness(): void {
  const now = Date.now();
  let changed = false;

  const polyStatus = Atomics.load(hdr, HDR.POLY_STATUS);
  const ksStatus   = Atomics.load(hdr, HDR.KS_STATUS);

  if (lastPolyUpdate > 0 && polyStatus === STATUS.LIVE) {
    const elapsed = now - lastPolyUpdate;
    if (elapsed > DISCONNECT_MS) {
      Atomics.store(hdr, HDR.POLY_STATUS, STATUS.DISCONNECTED); changed = true;
    } else if (elapsed > STALE_MS) {
      Atomics.store(hdr, HDR.POLY_STATUS, STATUS.STALE); changed = true;
    }
  }

  if (lastKsUpdate > 0 && ksStatus === STATUS.LIVE) {
    const elapsed = now - lastKsUpdate;
    if (elapsed > DISCONNECT_MS) {
      Atomics.store(hdr, HDR.KS_STATUS, STATUS.DISCONNECTED); changed = true;
    } else if (elapsed > STALE_MS) {
      Atomics.store(hdr, HDR.KS_STATUS, STATUS.STALE); changed = true;
    }
  }

  if (changed) {
    parentPort!.postMessage({ type: "update", data: buildAggregatedBook(activeMarket) });
  }
}

setInterval(checkStaleness, 5000);

// ---- Main polling loop at ~60fps ----

setInterval(() => {
  const polySeq = Atomics.load(hdr, HDR.POLY_SEQ);
  const ksSeq   = Atomics.load(hdr, HDR.KS_SEQ);

  const polyChanged = polySeq !== lastPolySeq;
  const ksChanged   = ksSeq   !== lastKsSeq;

  if (!polyChanged && !ksChanged) return;

  if (polyChanged) { lastPolySeq = polySeq; lastPolyUpdate = Date.now(); }
  if (ksChanged)   { lastKsSeq   = ksSeq;   lastKsUpdate   = Date.now(); }

  const book = buildAggregatedBook(activeMarket);
  parentPort!.postMessage({ type: "update", data: book });
}, 16);

// ---- Market info update from main thread ----

parentPort!.on("message", (msg: { type: string; market?: typeof activeMarket; kalshiEnabled?: boolean }) => {
  if (msg.type === "market" && msg.market) {
    activeMarket = msg.market;
    if (typeof msg.kalshiEnabled === "boolean") {
      kalshiEnabled = msg.kalshiEnabled;
      console.log(`[aggregator] Kalshi ${kalshiEnabled ? "enabled" : "disabled"} for "${activeMarket.title.slice(0, 50)}"`);
    }
  }
});

console.log("[aggregator-worker] started, polling SharedArrayBuffer at 60fps");
