/**
 * polymarket.worker.ts — Thread 1: Polymarket WebSocket data fetcher.
 *
 * Maintains a live WebSocket connection to the Polymarket CLOB API.
 * On every book update, writes bids/asks into the SharedArrayBuffer
 * and increments POLY_SEQ so the aggregator thread knows to re-aggregate.
 *
 * Receives market-switch messages from the main thread via parentPort.
 */

import { workerData, parentPort, isMainThread } from "worker_threads";
import WebSocket from "ws";
import {
  normalizePolymarketSnapshot,
  applyPolymarketDelta,
} from "../normalizer";
import {
  HDR, STATUS, SECTION, writeLevels, mapToLevels,
} from "../shared/buffer";
import type { PolymarketBookMessage, PolymarketDelta } from "../types";

if (isMainThread) throw new Error("Must run as worker thread");

const { sharedBuffer, env, POLY_TOKEN_ID } = workerData as {
  sharedBuffer: SharedArrayBuffer;
  env: Record<string, string>;
  POLY_TOKEN_ID: string;
};

// Inject env vars so existing normalizer/ws code can read process.env
Object.assign(process.env, env);

const hdr = new Int32Array(sharedBuffer);

const PM_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

let ws: WebSocket | null = null;
let bidsMap = new Map<string, number>();
let asksMap = new Map<string, number>();
let tokenId = POLY_TOKEN_ID || "";
let reconnectDelay = 1000;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// ---- Publish to shared buffer ----

function publish(): void {
  const bids = mapToLevels(bidsMap, "bids");
  const asks = mapToLevels(asksMap, "asks");

  writeLevels(sharedBuffer, SECTION.POLY_BIDS, bids);
  Atomics.store(hdr, HDR.POLY_BID_COUNT, bids.length);

  writeLevels(sharedBuffer, SECTION.POLY_ASKS, asks);
  Atomics.store(hdr, HDR.POLY_ASK_COUNT, asks.length);

  Atomics.store(hdr, HDR.POLY_STATUS, STATUS.LIVE);

  // Increment sequence number — aggregator detects this change
  Atomics.add(hdr, HDR.POLY_SEQ, 1);
}

// ---- WebSocket connection ----

function connect(): void {
  if (!tokenId) {
    console.warn("[polymarket-worker] no token ID — skipping");
    return;
  }

  cleanup();

  ws = new WebSocket(PM_WS_URL);

  ws.on("open", () => {
    console.log("[polymarket-worker] connected");
    reconnectDelay = 1000;

    ws!.send(JSON.stringify({
      assets_ids: [tokenId],
      type: "market",
    }));
  });

  ws.on("message", (raw: WebSocket.RawData) => {
    try {
      const msgs = JSON.parse(raw.toString());
      const arr = Array.isArray(msgs) ? msgs : [msgs];

      for (const msg of arr) {
        if (msg.event_type === "book") {
          const result = normalizePolymarketSnapshot(msg as PolymarketBookMessage);
          bidsMap = result.bids;
          asksMap = result.asks;
          publish();
        } else if (msg.event_type === "price_change") {
          const deltas = (msg.changes || []) as PolymarketDelta[];
          applyPolymarketDelta(bidsMap, asksMap, deltas);
          publish();
        }
      }
    } catch (err) {
      // ignore malformed messages
    }
  });

  ws.on("close", () => {
    console.log("[polymarket-worker] disconnected — reconnecting");
    Atomics.store(hdr, HDR.POLY_STATUS, STATUS.DISCONNECTED);
    scheduleReconnect();
  });

  ws.on("error", (err: Error) => {
    console.error(`[polymarket-worker] error: ${err.message}`);
  });
}

function scheduleReconnect(): void {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connect();
  }, reconnectDelay);
}

function cleanup(): void {
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) {
    ws.removeAllListeners();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    ws = null;
  }
}

// ---- Market switch from main thread ----

parentPort!.on("message", (msg: { type: string; tokenId?: string }) => {
  if (msg.type === "switch" && msg.tokenId) {
    console.log(`[polymarket-worker] switching to token ${msg.tokenId}`);
    tokenId = msg.tokenId;
    bidsMap = new Map();
    asksMap = new Map();
    connect();
  }
});

// ---- Start ----

connect();
