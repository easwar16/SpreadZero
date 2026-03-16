/**
 * kalshi.js — WebSocket client for Kalshi order book.
 *
 * Connects to wss://trading-api.kalshi.com/trade-api/ws/v2 with
 * RSA-signed auth headers. Subscribes to orderbook_delta channel
 * and maintains a local YES order book using the reciprocal model.
 *
 * Fallback chain: Kalshi WS → DFlow → Mock mode
 */

const crypto = require("crypto");
const WebSocket = require("ws");
const {
  normalizeKalshiSnapshot,
  applyKalshiDelta,
  reconstructKalshiBook,
} = require("../normalizer");
const aggregator = require("../aggregator");

const KALSHI_WS_URL = "wss://trading-api.kalshi.com/trade-api/ws/v2";
const KALSHI_WS_PATH = "/trade-api/ws/v2";

let ws = null;
let yesMap = new Map(); // raw YES bids keyed by native price
let noMap = new Map();  // raw NO bids keyed by native price
let lastSequence = 0;
let reconnectDelay = 1000;
let reconnectTimer = null;
let mockInterval = null;
let useDflowFallback = false;

const status = {
  connected: false,
  lastUpdate: null,
  reconnectAttempts: 0,
  isMock: false,
};

// ---- Auth / Signing ----

/**
 * Sign a Kalshi request using the private key (RSA-SHA256).
 * If KALSHI_API_SECRET looks like a PEM key, use RSA signing.
 * Otherwise treat it as an HMAC secret.
 */
function signRequest(timestampMs) {
  const secret = process.env.KALSHI_API_SECRET;
  if (!secret) return null;

  const message = timestampMs + "GET" + KALSHI_WS_PATH;

  try {
    if (secret.includes("-----BEGIN")) {
      // RSA-SHA256 signing with PEM private key
      const sign = crypto.createSign("RSA-SHA256");
      sign.update(message);
      sign.end();
      const signature = sign.sign(secret, "base64url");
      return signature;
    } else {
      // HMAC-SHA256 signing with raw secret
      const hmac = crypto.createHmac("sha256", secret);
      hmac.update(message);
      return hmac.digest("base64url");
    }
  } catch (err) {
    console.error(`[kalshi] signing error: ${err.message}`);
    return null;
  }
}

// ---- WebSocket Connection ----

function connect() {
  const apiKey = process.env.KALSHI_API_KEY;
  const apiSecret = process.env.KALSHI_API_SECRET;
  const ticker = process.env.KALSHI_TICKER;

  if (!ticker) {
    console.warn("[kalshi] KALSHI_TICKER not set — skipping connection");
    return;
  }

  if (!apiKey || !apiSecret) {
    console.warn("[kalshi] KALSHI_API_KEY or KALSHI_API_SECRET not set");
    activateFallback();
    return;
  }

  cleanup();

  const timestampMs = Date.now().toString();
  const signature = signRequest(timestampMs);

  if (!signature) {
    console.error("[kalshi] failed to generate signature — activating fallback");
    activateFallback();
    return;
  }

  console.log(`[kalshi] connecting to ${KALSHI_WS_URL}...`);

  ws = new WebSocket(KALSHI_WS_URL, {
    headers: {
      "KALSHI-ACCESS-KEY": apiKey,
      "KALSHI-ACCESS-SIGNATURE": signature,
      "KALSHI-ACCESS-TIMESTAMP": timestampMs,
    },
  });

  ws.on("open", () => {
    console.log("[kalshi] connected");
    status.connected = true;
    status.reconnectAttempts = 0;
    reconnectDelay = 1000;

    // Subscribe to orderbook deltas for our ticker
    const sub = {
      id: 1,
      cmd: "subscribe",
      params: {
        channels: ["orderbook_delta"],
        market_ticker: ticker,
      },
    };
    ws.send(JSON.stringify(sub));
    console.log(`[kalshi] subscribed to orderbook_delta for ${ticker}`);
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(msg);
    } catch (err) {
      console.error(`[kalshi] message parse error: ${err.message}`);
    }
  });

  ws.on("close", (code, reason) => {
    console.log(
      `[kalshi] disconnected (code=${code}, reason=${reason || "none"}) at ${new Date().toISOString()}`
    );
    status.connected = false;
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error(`[kalshi] ws error: ${err.message}`);
  });
}

function handleMessage(msg) {
  const type = msg.type || msg.msg_type;

  // Auth error — switch to fallback
  if (type === "error") {
    console.error(`[kalshi] server error: ${JSON.stringify(msg)}`);
    cleanup();
    activateFallback();
    return;
  }

  if (type === "orderbook_snapshot") {
    // Full snapshot — reset local maps
    const result = normalizeKalshiSnapshot(msg);
    yesMap = result.bids;
    noMap = result.asks; // note: normalizeKalshiSnapshot returns asks derived from no bids,
    // but we need the raw noMap for delta application, so rebuild from msg
    yesMap = new Map();
    noMap = new Map();

    for (const [priceStr, sizeStr] of msg.yes_dollars_fp || []) {
      const price = parseFloat(priceStr).toFixed(4);
      const size = parseFloat(sizeStr);
      if (size > 0) yesMap.set(price, size);
    }
    for (const [priceStr, sizeStr] of msg.no_dollars_fp || []) {
      const price = parseFloat(priceStr).toFixed(4);
      const size = parseFloat(sizeStr);
      if (size > 0) noMap.set(price, size);
    }

    lastSequence = msg.seq || 0;
    status.lastUpdate = new Date();

    const book = reconstructKalshiBook(yesMap, noMap);
    aggregator.update("kalshi", book);
  } else if (type === "orderbook_delta") {
    // Check for sequence gaps — if gap detected, resubscribe for fresh snapshot
    if (msg.seq && lastSequence > 0 && msg.seq !== lastSequence + 1) {
      console.warn(
        `[kalshi] sequence gap: expected ${lastSequence + 1}, got ${msg.seq} — resubscribing`
      );
      resubscribe();
      return;
    }
    lastSequence = msg.seq || lastSequence;

    applyKalshiDelta(yesMap, noMap, msg);
    status.lastUpdate = new Date();

    const book = reconstructKalshiBook(yesMap, noMap);
    aggregator.update("kalshi", book);
  }
}

/**
 * Resubscribe to get a fresh snapshot after a sequence gap.
 */
function resubscribe() {
  const ticker = process.env.KALSHI_TICKER;
  if (!ws || ws.readyState !== WebSocket.OPEN || !ticker) return;

  // Unsubscribe then resubscribe to trigger a new snapshot
  ws.send(
    JSON.stringify({
      id: 2,
      cmd: "unsubscribe",
      params: {
        channels: ["orderbook_delta"],
        market_ticker: ticker,
      },
    })
  );

  setTimeout(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          id: 3,
          cmd: "subscribe",
          params: {
            channels: ["orderbook_delta"],
            market_ticker: ticker,
          },
        })
      );
    }
  }, 500);
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  status.reconnectAttempts++;
  console.log(
    `[kalshi] reconnecting in ${reconnectDelay}ms (attempt ${status.reconnectAttempts}) at ${new Date().toISOString()}`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connect();
  }, reconnectDelay);
}

// ---- Fallback Chain ----

/**
 * Activate DFlow fallback or mock mode.
 */
function activateFallback() {
  // Try DFlow first
  let dflow;
  try {
    dflow = require("./dflow");
  } catch (e) {
    // dflow module not available
  }

  if (dflow) {
    console.log("[kalshi] activating DFlow fallback");
    useDflowFallback = true;
    dflow.connect();
    return;
  }

  // Last resort: mock mode
  startMockMode();
}

/**
 * Generate mock order book data for development/testing.
 * Produces a realistic-looking book around midpoint 0.63.
 */
function startMockMode() {
  console.log("[kalshi] entering MOCK mode — generating synthetic order book");
  status.isMock = true;
  aggregator.setMock("kalshi", true);

  function generateMockBook() {
    const midpoint = 0.63;
    const bids = new Map();
    const asks = new Map();

    // 5 bid levels below midpoint
    for (let i = 1; i <= 5; i++) {
      const price = (midpoint - i * 0.01 + (Math.random() - 0.5) * 0.002).toFixed(4);
      const size = Math.floor(100 + Math.random() * 900);
      bids.set(price, size);
    }

    // 5 ask levels above midpoint
    for (let i = 1; i <= 5; i++) {
      const price = (midpoint + i * 0.01 + (Math.random() - 0.5) * 0.002).toFixed(4);
      const size = Math.floor(100 + Math.random() * 900);
      asks.set(price, size);
    }

    return { bids, asks };
  }

  // Initial mock book
  const book = generateMockBook();
  status.lastUpdate = new Date();
  aggregator.update("kalshi", book);

  // Refresh with jitter every 3 seconds
  mockInterval = setInterval(() => {
    const book = generateMockBook();
    status.lastUpdate = new Date();
    aggregator.update("kalshi", book);
  }, 3000);
}

function cleanup() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (mockInterval) {
    clearInterval(mockInterval);
    mockInterval = null;
  }
  if (ws) {
    ws.removeAllListeners();
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
    ws = null;
  }
}

function getBook() {
  return reconstructKalshiBook(yesMap, noMap);
}

module.exports = { connect, getBook, status };
