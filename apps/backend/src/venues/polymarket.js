/**
 * polymarket.js — WebSocket client for Polymarket CLOB order book.
 *
 * Connects to wss://ws-subscriptions-clob.polymarket.com/ws/market,
 * subscribes to a single token ID, and maintains a local order book
 * from snapshots and incremental deltas.
 */

const WebSocket = require("ws");
const {
  normalizePolymarketSnapshot,
  applyPolymarketDelta,
} = require("../normalizer");
const aggregator = require("../aggregator");

const WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

let ws = null;
let bidsMap = new Map();
let asksMap = new Map();
let reconnectDelay = 1000; // starts at 1s, doubles up to 30s
let reconnectTimer = null;

const status = {
  connected: false,
  lastUpdate: null,
  reconnectAttempts: 0,
};

function connect() {
  const tokenId = process.env.POLYMARKET_TOKEN_ID;
  if (!tokenId) {
    console.warn("[polymarket] POLYMARKET_TOKEN_ID not set — skipping connection");
    return;
  }

  cleanup();
  console.log(`[polymarket] connecting to ${WS_URL}...`);

  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log("[polymarket] connected");
    status.connected = true;
    status.reconnectAttempts = 0;
    reconnectDelay = 1000; // reset backoff on success

    // Subscribe to the target market
    const sub = {
      type: "Market",
      assets_ids: [tokenId],
    };
    ws.send(JSON.stringify(sub));
    console.log(`[polymarket] subscribed to token ${tokenId}`);
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(msg);
    } catch (err) {
      console.error(`[polymarket] message parse error: ${err.message}`);
    }
  });

  ws.on("close", (code, reason) => {
    console.log(
      `[polymarket] disconnected (code=${code}, reason=${reason || "none"}) at ${new Date().toISOString()}`
    );
    status.connected = false;
    scheduleReconnect();
  });

  ws.on("error", (err) => {
    console.error(`[polymarket] ws error: ${err.message}`);
    // 'close' will fire after this, triggering reconnect
  });
}

function handleMessage(msg) {
  // Polymarket sends an array of events or a single event
  const events = Array.isArray(msg) ? msg : [msg];

  for (const event of events) {
    if (event.event_type === "book" || event.type === "book") {
      // Full snapshot — replace local book entirely
      const result = normalizePolymarketSnapshot(event);
      bidsMap = result.bids;
      asksMap = result.asks;
      status.lastUpdate = new Date();
      aggregator.update("polymarket", { bids: bidsMap, asks: asksMap });
    } else if (
      event.event_type === "price_change" ||
      event.type === "price_change"
    ) {
      // Incremental delta — array of changes
      const deltas = event.changes || event.data || [];
      if (Array.isArray(deltas) && deltas.length > 0) {
        const result = applyPolymarketDelta(bidsMap, asksMap, deltas);
        bidsMap = result.bids;
        asksMap = result.asks;
        status.lastUpdate = new Date();
        aggregator.update("polymarket", { bids: bidsMap, asks: asksMap });
      }
    }
    // Ignore other message types (heartbeats, etc.)
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;

  status.reconnectAttempts++;
  console.log(
    `[polymarket] reconnecting in ${reconnectDelay}ms (attempt ${status.reconnectAttempts}) at ${new Date().toISOString()}`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    // Double the delay for next attempt, cap at 30s
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    connect();
  }, reconnectDelay);
}

function cleanup() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
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
  return { bids: bidsMap, asks: asksMap };
}

module.exports = { connect, getBook, status };
