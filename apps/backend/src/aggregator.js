/**
 * aggregator.js — Holds venue books, merges them, detects staleness,
 * and notifies listeners (the WS server) on every update.
 */

const { mergePriceLevels } = require("./normalizer");

const STALE_THRESHOLD_MS = parseInt(process.env.STALE_THRESHOLD_MS, 10) || 15000;
const DISCONNECT_THRESHOLD_MS =
  parseInt(process.env.DISCONNECT_THRESHOLD_MS, 10) || 45000;

// Per-venue state
const venues = {
  polymarket: {
    book: null,
    lastUpdate: null,
    status: "disconnected",
    isMock: false,
  },
  kalshi: {
    book: null,
    lastUpdate: null,
    status: "disconnected",
    isMock: false,
  },
};

// Listeners registered via onUpdate()
const listeners = [];

/**
 * Register a callback that fires on every merged book update.
 * Callback receives the full aggregated book object.
 */
function onUpdate(cb) {
  listeners.push(cb);
}

/**
 * Called by venue clients whenever they receive new data.
 *   venue: "polymarket" | "kalshi"
 *   book:  { bids: Map<string,number>, asks: Map<string,number> }
 */
function update(venue, book) {
  const v = venues[venue];
  if (!v) return;

  v.book = book;
  v.lastUpdate = new Date();
  v.status = "live";

  const aggregated = getAggregatedBook();
  for (const cb of listeners) {
    try {
      cb(aggregated);
    } catch (err) {
      console.error(`[aggregator] listener error: ${err.message}`);
    }
  }
}

/**
 * Set mock flag for a venue.
 */
function setMock(venue, isMock) {
  if (venues[venue]) venues[venue].isMock = isMock;
}

/**
 * Build the full aggregated book from current venue states.
 */
function getAggregatedBook() {
  const { bids, asks } = mergePriceLevels(
    venues.polymarket.book,
    venues.kalshi.book
  );

  const bestBid = bids.length > 0 ? bids[0].price : 0;
  const bestAsk = asks.length > 0 ? asks[0].price : 1;
  const spread = Math.round((bestAsk - bestBid) * 10000) / 10000;
  const midpoint = Math.round(((bestAsk + bestBid) / 2) * 10000) / 10000;

  return {
    bids,
    asks,
    spread,
    midpoint,
    venueStatus: {
      polymarket: {
        status: venues.polymarket.status,
        lastUpdate: venues.polymarket.lastUpdate
          ? venues.polymarket.lastUpdate.toISOString()
          : null,
        isMock: venues.polymarket.isMock,
      },
      kalshi: {
        status: venues.kalshi.status,
        lastUpdate: venues.kalshi.lastUpdate
          ? venues.kalshi.lastUpdate.toISOString()
          : null,
        isMock: venues.kalshi.isMock,
      },
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Stale detection — run on an interval from index.js.
 * Downgrades venue status based on time since last update.
 */
function checkStaleness() {
  const now = Date.now();
  let changed = false;

  for (const [name, v] of Object.entries(venues)) {
    if (!v.lastUpdate) continue;
    const elapsed = now - v.lastUpdate.getTime();

    let newStatus = v.status;
    if (elapsed > DISCONNECT_THRESHOLD_MS) {
      newStatus = "disconnected";
    } else if (elapsed > STALE_THRESHOLD_MS) {
      newStatus = "stale";
    }

    if (newStatus !== v.status) {
      console.log(
        `[aggregator] ${name} status changed: ${v.status} → ${newStatus} (${elapsed}ms since last update)`
      );
      v.status = newStatus;
      changed = true;
    }
  }

  // Re-broadcast if any status changed so frontend sees updated venueStatus
  if (changed) {
    const aggregated = getAggregatedBook();
    for (const cb of listeners) {
      try {
        cb(aggregated);
      } catch (err) {
        console.error(`[aggregator] listener error: ${err.message}`);
      }
    }
  }
}

module.exports = {
  update,
  setMock,
  getAggregatedBook,
  onUpdate,
  checkStaleness,
};
