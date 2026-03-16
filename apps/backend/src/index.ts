/**
 * index.ts — SpreadZero backend entry point.
 *
 * Spawns three worker threads sharing a single SharedArrayBuffer:
 *   Thread 1 (polymarket.worker): fetches Polymarket WS order book
 *   Thread 2 (kalshi.worker):     fetches Kalshi REST order book
 *   Thread 3 (aggregator.worker): merges both books at ~60fps, posts updates
 *
 * Main thread: serves Express REST API + WebSocket server for frontend.
 */

import "dotenv/config";
import path from "path";
import { Worker } from "worker_threads";

import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";

import { getAllMarkets, setActiveMarket, getActiveMarket, initMarketsQuick, initMarketsFull, setOnMarketsUpdated, setManualPairing } from "./markets";
import { BUFFER_SIZE } from "./shared/buffer";
import type { AggregatedBook } from "./types";

const PORT      = parseInt(process.env.PORT || "", 10) || 3001;
const startTime = Date.now();

// ---- Shared memory ----

const sharedBuffer = new SharedArrayBuffer(BUFFER_SIZE);

// Env vars to forward to workers (they don't inherit process.env automatically)
function workerEnv(): Record<string, string> {
  const keys = [
    "KALSHI_TICKER", "KALSHI_DEMO", "KALSHI_API_KEY", "KALSHI_API_SECRET",
    "STALE_THRESHOLD_MS", "DISCONNECT_THRESHOLD_MS",
  ];
  const out: Record<string, string> = {};
  for (const k of keys) {
    if (process.env[k]) out[k] = process.env[k]!;
  }
  return out;
}

// Worker paths — require tsx/cjs so TypeScript files load inside each worker
const WORKER_DIR = path.join(__dirname, "workers");
const TSX_CJS    = require.resolve("tsx/cjs");

function spawnWorker(filename: string, extra: object): Worker {
  return new Worker(path.join(WORKER_DIR, filename), {
    execArgv: ["--require", TSX_CJS],
    workerData: { sharedBuffer, env: workerEnv(), ...extra },
  });
}

// ---- Express setup ----

const app = express();
app.use(cors());
app.use(express.json());

// Latest aggregated book kept in main thread for REST endpoints
let latestBook: AggregatedBook | null = null;

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    uptime: Math.floor((Date.now() - startTime) / 1000),
    venueStatus: latestBook?.venueStatus ?? null,
  });
});

app.get("/api/markets", (_req, res) => {
  const markets = getAllMarkets();
  const active  = getActiveMarket();
  res.json({
    markets: markets.map((m) => ({
      id: m.id, title: m.title, category: m.category, midpoint: m.midpoint,
      kalshiTicker: m.kalshiTicker || null,
    })),
    activeId: active.id,
  });
});

app.post("/api/markets/:id/select", (req, res) => {
  const market = setActiveMarket(req.params.id);
  if (!market) { res.status(404).json({ error: "Market not found" }); return; }

  console.log(`[spreadzero] switching to market: "${market.title}"`);

  // Tell venue workers to switch to the matched tickers
  const hasKalshiMatch = !!market.kalshiTicker;
  polyWorker.postMessage({ type: "switch", tokenId: market.tokenId });
  // Only poll Kalshi if we have a matched ticker — otherwise send empty to stop polling
  kalshiWorker.postMessage({ type: "switch", ticker: hasKalshiMatch ? market.kalshiTicker : "" });
  aggWorker.postMessage({
    type: "market",
    market: { id: market.id, title: market.title, category: market.category },
    kalshiEnabled: hasKalshiMatch,
  });

  res.json({ id: market.id, title: market.title, category: market.category, midpoint: market.midpoint });
});

app.post("/api/markets/:id/pair", (req, res) => {
  const { kalshiTicker } = req.body as { kalshiTicker?: string };
  if (kalshiTicker === undefined) { res.status(400).json({ error: "kalshiTicker is required" }); return; }

  const market = setManualPairing(req.params.id, kalshiTicker);
  if (!market) { res.status(404).json({ error: "Market not found" }); return; }

  console.log(`[spreadzero] manual pairing: "${market.title.slice(0, 50)}" → ${kalshiTicker || "(cleared)"}`);

  // Always update workers — the user paired this market, so make it active and switch
  setActiveMarket(market.id);
  const hasKalshi = !!kalshiTicker;
  polyWorker.postMessage({ type: "switch", tokenId: market.tokenId });
  kalshiWorker.postMessage({ type: "switch", ticker: hasKalshi ? kalshiTicker : "" });
  aggWorker.postMessage({
    type: "market",
    market: { id: market.id, title: market.title, category: market.category },
    kalshiEnabled: hasKalshi,
  });

  res.json({
    id: market.id, title: market.title, category: market.category,
    midpoint: market.midpoint, kalshiTicker: market.kalshiTicker || null,
  });
});

app.get("/api/orderbook", (_req, res) => {
  if (!latestBook || (latestBook.bids.length === 0 && latestBook.asks.length === 0)) {
    res.json({ status: "initializing", venueStatus: latestBook?.venueStatus ?? null });
    return;
  }
  res.json(latestBook);
});

app.get("/api/quote", (req, res) => {
  const side   = ((req.query.side as string) || "yes").toLowerCase();
  const amount = parseFloat(req.query.amount as string);

  if (!amount || amount <= 0) { res.status(400).json({ error: "amount must be positive" }); return; }
  if (side !== "yes" && side !== "no") { res.status(400).json({ error: "side must be yes or no" }); return; }

  const book   = latestBook;
  const levels = book ? (side === "yes" ? book.asks : book.bids) : [];

  if (!levels.length) {
    res.json({ inputAmount: amount, side, shares: 0, avgFillPrice: 0, fills: [], totalCost: 0, partialFill: true, remainingUnfilled: amount });
    return;
  }

  let remaining = amount, totalShares = 0, totalCost = 0;
  const venueFills: Record<string, { shares: number; cost: number }> = {
    polymarket: { shares: 0, cost: 0 }, kalshi: { shares: 0, cost: 0 },
  };

  for (const level of levels) {
    if (remaining <= 0) break;
    const spend  = Math.min(remaining, level.price * level.size);
    const shares = spend / level.price;
    totalShares += shares; totalCost += spend; remaining -= spend;
    for (const [venue, vs] of Object.entries(level.sources)) {
      if (vs <= 0) continue;
      const frac = vs / level.size;
      if (venueFills[venue]) { venueFills[venue].shares += shares * frac; venueFills[venue].cost += spend * frac; }
    }
  }

  res.json({
    inputAmount: amount, side,
    shares: Math.round(totalShares * 10000) / 10000,
    avgFillPrice: totalShares > 0 ? Math.round((totalCost / totalShares) * 10000) / 10000 : 0,
    fills: Object.entries(venueFills).filter(([, f]) => f.shares > 0).map(([venue, f]) => ({
      venue, shares: Math.round(f.shares * 10000) / 10000,
      avgPrice: Math.round((f.cost / f.shares) * 10000) / 10000,
      cost: Math.round(f.cost * 10000) / 10000,
    })),
    totalCost: Math.round(totalCost * 10000) / 10000,
    partialFill: remaining > 0.0001,
    remainingUnfilled: Math.round(remaining * 10000) / 10000,
  });
});

// ---- HTTP + WebSocket server ----

const server = http.createServer(app);
const wss    = new WebSocketServer({ server, path: "/ws" });

let connectedClients = 0;
interface AliveWebSocket extends WebSocket { isAlive: boolean; }

wss.on("connection", (clientWs: WebSocket, req) => {
  const aws = clientWs as AliveWebSocket;
  connectedClients++;
  console.log(`[ws] client connected from ${req.socket.remoteAddress} (total: ${connectedClients})`);

  aws.isAlive = true;
  aws.on("pong", () => { aws.isAlive = true; });
  aws.on("close", () => { connectedClients--; });
  aws.on("error", (err: Error) => console.error(`[ws] client error: ${err.message}`));

  // Send current snapshot immediately
  if (latestBook) {
    aws.send(JSON.stringify({ type: "snapshot", data: latestBook }));
  }
});

function broadcast(book: AggregatedBook): void {
  const payload = JSON.stringify({ type: "update", data: book });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      try { client.send(payload); } catch { /* ignore */ }
    }
  }
}

// Ping/pong heartbeat
const pingInterval = setInterval(() => {
  for (const client of wss.clients) {
    const aws = client as AliveWebSocket;
    if (!aws.isAlive) { aws.terminate(); connectedClients--; continue; }
    aws.isAlive = false;
    aws.ping();
  }
}, 30000);
wss.on("close", () => clearInterval(pingInterval));

// Status logger
setInterval(() => {
  const vs = latestBook?.venueStatus;
  console.log(
    `[status] poly=${vs?.polymarket.status ?? "?"} kalshi=${vs?.kalshi.status ?? "?"} | clients=${connectedClients} | spread=${latestBook?.spread ?? "?"} mid=${latestBook?.midpoint ?? "?"}`
  );
}, 10000);

// ---- Workers ----

let polyWorker:  Worker;
let kalshiWorker: Worker;
let aggWorker:   Worker;

// ---- Startup ----

async function startup(): Promise<void> {
  // Phase 1: Quick fetch — one Polymarket page (~200ms)
  const quickMarkets = await initMarketsQuick();
  const active = getActiveMarket();

  console.log(`[spreadzero] ${quickMarkets.length} markets ready, starting server...`);

  server.listen(PORT, () => {
    console.log(`[spreadzero] listening on port ${PORT}`);

    // Spawn Thread 1: Polymarket — starts streaming immediately
    polyWorker = spawnWorker("polymarket.worker.ts", { POLY_TOKEN_ID: active.tokenId });
    polyWorker.on("error", (err) => console.error(`[polymarket-worker] fatal: ${err.message}`));
    polyWorker.on("exit",  (code) => code !== 0 && console.error(`[polymarket-worker] exited with code ${code}`));

    // Spawn Thread 2: Kalshi — idle until cross-venue matching completes
    kalshiWorker = spawnWorker("kalshi.worker.ts", { KALSHI_TICKER_OVERRIDE: "" });
    kalshiWorker.on("error", (err) => console.error(`[kalshi-worker] fatal: ${err.message}`));
    kalshiWorker.on("exit",  (code) => code !== 0 && console.error(`[kalshi-worker] exited with code ${code}`));

    // Spawn Thread 3: Aggregator — Polymarket-only until matching completes
    aggWorker = spawnWorker("aggregator.worker.ts", {
      market: { id: active.id, title: active.title, category: active.category },
      kalshiEnabled: false,
    } as object);
    aggWorker.on("message", (msg: { type: string; data: AggregatedBook }) => {
      if (msg.type === "update") {
        latestBook = msg.data;
        broadcast(msg.data);
      }
    });
    aggWorker.on("error", (err) => console.error(`[aggregator-worker] fatal: ${err.message}`));
    aggWorker.on("exit",  (code) => code !== 0 && console.error(`[aggregator-worker] exited with code ${code}`));

    console.log(`[spreadzero] streaming "${active.title.slice(0, 50)}" — matching Kalshi in background...`);

    // Phase 2: Full cross-venue matching runs in background
    // When it finishes, hot-update workers if current market got a Kalshi match
    setOnMarketsUpdated(() => {
      const current = getActiveMarket();
      if (current.kalshiTicker) {
        kalshiWorker.postMessage({ type: "switch", ticker: current.kalshiTicker });
        aggWorker.postMessage({
          type: "market",
          market: { id: current.id, title: current.title, category: current.category },
          kalshiEnabled: true,
        });
        console.log(`[spreadzero] Kalshi matched → ${current.kalshiTicker}`);
      }
    });

    initMarketsFull().catch((err) => {
      console.error(`[spreadzero] full market fetch failed: ${(err as Error).message}`);
    });
  });
}

startup().catch((err) => {
  console.error(`[spreadzero] startup failed: ${err.message}`);
  process.exit(1);
});
