/**
 * kalshi.worker.ts — Thread 2: Kalshi REST polling data fetcher.
 *
 * Polls the public Kalshi orderbook endpoint every POLL_MS milliseconds.
 * Writes bids/asks into the SharedArrayBuffer and increments KS_SEQ.
 *
 * No authentication required (public read-only endpoint).
 */

import { workerData, parentPort, isMainThread } from "worker_threads";
import https from "https";
import { safeFloat, reconstructKalshiBook } from "../normalizer";
import {
  HDR, STATUS, SECTION, writeLevels, mapToLevels,
} from "../shared/buffer";

if (isMainThread) throw new Error("Must run as worker thread");

const { sharedBuffer, env, KALSHI_TICKER_OVERRIDE } = workerData as {
  sharedBuffer: SharedArrayBuffer;
  env: Record<string, string>;
  KALSHI_TICKER_OVERRIDE?: string;
};

Object.assign(process.env, env);

const hdr = new Int32Array(sharedBuffer);

const KALSHI_HOST = "api.elections.kalshi.com";
const POLL_MS = 3000;

// Prefer the matched ticker from market matching over the env variable
let ticker = KALSHI_TICKER_OVERRIDE || env.KALSHI_TICKER || "";
let pollTimer: ReturnType<typeof setInterval> | null = null;

// ---- Fetch orderbook from public REST endpoint ----

function fetchOrderbook(t: string): Promise<{ bids: Map<string, number>; asks: Map<string, number> } | null> {
  return new Promise((resolve) => {
    const path = `/trade-api/v2/markets/${encodeURIComponent(t)}/orderbook?depth=20`;
    const req = https.request(
      { hostname: KALSHI_HOST, port: 443, path, method: "GET",
        headers: { Accept: "application/json" } },
      (res) => {
        let body = "";
        res.on("data", (d: Buffer) => (body += d.toString()));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            const ob = data.orderbook_fp || data.orderbook;
            if (!ob) return resolve(null);

            const yesMap = new Map<string, number>();
            const noMap = new Map<string, number>();

            for (const [priceStr, sizeStr] of ob.yes_dollars || []) {
              const price = safeFloat(priceStr).toFixed(4);
              const size = safeFloat(sizeStr);
              if (size > 0) yesMap.set(price, size);
            }
            for (const [priceStr, sizeStr] of ob.no_dollars || []) {
              const price = safeFloat(priceStr).toFixed(4);
              const size = safeFloat(sizeStr);
              if (size > 0) noMap.set(price, size);
            }

            const book = reconstructKalshiBook(yesMap, noMap);
            resolve({ bids: book.bids, asks: book.asks });
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.end();
  });
}

// ---- Publish to shared buffer ----

function publish(bidsMap: Map<string, number>, asksMap: Map<string, number>): void {
  const bids = mapToLevels(bidsMap, "bids");
  const asks = mapToLevels(asksMap, "asks");

  writeLevels(sharedBuffer, SECTION.KS_BIDS, bids);
  Atomics.store(hdr, HDR.KS_BID_COUNT, bids.length);

  writeLevels(sharedBuffer, SECTION.KS_ASKS, asks);
  Atomics.store(hdr, HDR.KS_ASK_COUNT, asks.length);

  Atomics.store(hdr, HDR.KS_STATUS, STATUS.LIVE);

  // Increment sequence number — aggregator detects this change
  Atomics.add(hdr, HDR.KS_SEQ, 1);
}

// ---- Polling loop ----

function startPolling(t: string): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }

  if (!t) {
    console.log("[kalshi-worker] no ticker — clearing buffer and stopping");
    // Clear Kalshi data from shared buffer so aggregator doesn't use stale data
    Atomics.store(hdr, HDR.KS_BID_COUNT, 0);
    Atomics.store(hdr, HDR.KS_ASK_COUNT, 0);
    Atomics.store(hdr, HDR.KS_STATUS, STATUS.DISCONNECTED);
    Atomics.add(hdr, HDR.KS_SEQ, 1); // trigger aggregator to rebuild
    return;
  }

  console.log(`[kalshi-worker] polling ${KALSHI_HOST} for ${t} every ${POLL_MS}ms`);

  async function poll() {
    const book = await fetchOrderbook(t);
    if (book) publish(book.bids, book.asks);
  }

  poll(); // immediate first fetch
  pollTimer = setInterval(poll, POLL_MS);
}

// ---- Market switch from main thread ----

parentPort!.on("message", (msg: { type: string; ticker?: string }) => {
  if (msg.type === "switch") {
    const newTicker = msg.ticker || "";
    console.log(`[kalshi-worker] switching to ticker: ${newTicker || "(none)"}`);
    ticker = newTicker;
    startPolling(ticker);
  }
});

// ---- Start ----

startPolling(ticker);
