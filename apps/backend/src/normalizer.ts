/**
 * normalizer.ts — Price normalization and order book transformation utilities.
 *
 * All prices are normalized to 0–1 floats rounded to 4 decimal places.
 * Kalshi binary markets only expose bids for YES and NO sides;
 * we reconstruct full YES order books using the reciprocal relationship:
 *   YES ask price = 1.0 - NO bid price
 */

import type {
  VenueBook,
  PriceLevel,
  PolymarketBookMessage,
  PolymarketDelta,
  KalshiSnapshotMessage,
  KalshiDeltaMessage,
  DFlowOrderbookResponse,
} from "./types";

/**
 * Safely parse a value to a float and round to 4 decimal places.
 * Handles strings, numbers, and edge cases (NaN → 0).
 */
export function safeFloat(val: string | number): number {
  const n = parseFloat(String(val));
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Polymarket
// ---------------------------------------------------------------------------

/**
 * Parse a full Polymarket "book" snapshot into bid/ask Maps.
 *
 * Input format (from WS):
 *   { bids: [{ price: "0.64", size: "500" }], asks: [...] }
 *
 * Output: { bids: Map<priceStr, sizeFloat>, asks: Map<priceStr, sizeFloat> }
 * Map keys are price strings (e.g. "0.6400") so we can merge by exact price.
 */
export function normalizePolymarketSnapshot(rawMsg: PolymarketBookMessage): VenueBook {
  const bids = new Map<string, number>();
  const asks = new Map<string, number>();

  for (const level of rawMsg.bids || []) {
    const price = safeFloat(level.price).toFixed(4);
    const size = safeFloat(level.size);
    if (size > 0) bids.set(price, size);
  }

  for (const level of rawMsg.asks || []) {
    const price = safeFloat(level.price).toFixed(4);
    const size = safeFloat(level.size);
    if (size > 0) asks.set(price, size);
  }

  return { bids, asks };
}

/**
 * Apply an incremental Polymarket delta to existing bid/ask Maps.
 *
 * Delta array items: { asset_id, side: "BUY"|"SELL", price, size }
 *   - side "BUY"  → bid
 *   - side "SELL" → ask
 *   - size == 0   → remove the level entirely
 *   - size > 0    → set (replace) the level
 *
 * Mutates and returns the same Maps for efficiency.
 */
export function applyPolymarketDelta(
  bidsMap: Map<string, number>,
  asksMap: Map<string, number>,
  deltaArray: PolymarketDelta[]
): VenueBook {
  for (const delta of deltaArray) {
    const price = safeFloat(delta.price).toFixed(4);
    const size = safeFloat(delta.size);
    const map = delta.side === "BUY" ? bidsMap : asksMap;

    if (size === 0) {
      map.delete(price);
    } else {
      map.set(price, size);
    }
  }

  return { bids: bidsMap, asks: asksMap };
}

// ---------------------------------------------------------------------------
// Kalshi
// ---------------------------------------------------------------------------

/**
 * Parse a Kalshi orderbook_snapshot into raw YES and NO bid Maps.
 *
 * Kalshi binary markets only return bids for each side:
 *   yes_dollars_fp: [["0.4200", "333.00"], ...]  ← YES bids
 *   no_dollars_fp:  [["0.5400", "20.00"],  ...]  ← NO bids
 *
 * Prices are already dollar strings in 0–1 range (do NOT divide by 100).
 *
 * Returns raw Maps (keyed by native prices) for delta application.
 * Call reconstructKalshiBook() to get the canonical VenueBook.
 */
export function parseKalshiSnapshotMaps(
  rawMsg: KalshiSnapshotMessage
): { yesMap: Map<string, number>; noMap: Map<string, number> } {
  const yesMap = new Map<string, number>();
  const noMap = new Map<string, number>();

  for (const [priceStr, sizeStr] of rawMsg.yes_dollars_fp || []) {
    const price = safeFloat(priceStr).toFixed(4);
    const size = safeFloat(sizeStr);
    if (size > 0) yesMap.set(price, size);
  }

  for (const [priceStr, sizeStr] of rawMsg.no_dollars_fp || []) {
    const price = safeFloat(priceStr).toFixed(4);
    const size = safeFloat(sizeStr);
    if (size > 0) noMap.set(price, size);
  }

  return { yesMap, noMap };
}

/**
 * Apply a Kalshi orderbook_delta to the raw YES and NO bid Maps.
 *
 * Delta message fields:
 *   price_dollars: "0.6400"  — the price level affected
 *   delta_fp:      "-54.00"  — positive adds, negative removes, "0" clears
 *   side:          "yes"|"no" — which side's bids are changing
 *
 * We maintain separate yes/no Maps (keyed by their native prices) because
 * deltas arrive in native side prices. After applying the delta we
 * reconstruct the full YES book from both Maps.
 *
 * Mutates and returns the Maps.
 */
export function applyKalshiDelta(
  yesMap: Map<string, number>,
  noMap: Map<string, number>,
  deltaMsg: KalshiDeltaMessage
): { yesMap: Map<string, number>; noMap: Map<string, number> } {
  const price = safeFloat(deltaMsg.price_dollars).toFixed(4);
  const delta = safeFloat(deltaMsg.delta_fp);
  const map = deltaMsg.side === "yes" ? yesMap : noMap;

  if (delta === 0) {
    // delta of 0 means remove the level entirely
    map.delete(price);
  } else {
    const current = map.get(price) || 0;
    const updated = safeFloat(current + delta);

    if (updated <= 0) {
      // Size went to zero or negative — remove the level
      map.delete(price);
    } else {
      map.set(price, updated);
    }
  }

  return { yesMap, noMap };
}

/**
 * Reconstruct a full YES order book from raw yes/no bid Maps.
 * Called after every Kalshi delta or snapshot to produce the canonical form.
 *
 * Reciprocal reconstruction:
 *   YES bids = yes_dollars_fp directly
 *   YES asks = derived from NO bids:
 *     yes_ask_price = 1.0 - no_bid_price
 *     yes_ask_size  = no_bid_size  (same dollar amount at play)
 */
export function reconstructKalshiBook(
  yesMap: Map<string, number>,
  noMap: Map<string, number>
): VenueBook {
  const bids = new Map<string, number>(yesMap); // YES bids are direct

  // YES asks derived from NO bids via reciprocal
  const asks = new Map<string, number>();
  for (const [priceStr, size] of noMap) {
    const noBidPrice = safeFloat(priceStr);
    // If someone bids $0.54 for NO, that implies a YES ask at $0.46 (1 - 0.54)
    const yesAskPrice = safeFloat(1.0 - noBidPrice).toFixed(4);
    if (size > 0) asks.set(yesAskPrice, size);
  }

  return { bids, asks };
}

// ---------------------------------------------------------------------------
// DFlow
// ---------------------------------------------------------------------------

/**
 * Normalize a DFlow orderbook response into YES bid/ask Maps.
 *
 * Input format:
 *   { yes_bids: { "0.6400": 500, ... }, no_bids: { "0.5400": 20, ... }, sequence: 123 }
 *
 * Same reciprocal reconstruction as Kalshi — DFlow proxies Kalshi data.
 */
export function normalizeDFlowOrderbook(rawResponse: DFlowOrderbookResponse): VenueBook {
  const bids = new Map<string, number>();
  const asks = new Map<string, number>();

  // YES bids come directly
  for (const [priceStr, size] of Object.entries(rawResponse.yes_bids || {})) {
    const price = safeFloat(priceStr).toFixed(4);
    const s = safeFloat(size);
    if (s > 0) bids.set(price, s);
  }

  // YES asks from reciprocal of NO bids (same logic as Kalshi)
  for (const [priceStr, size] of Object.entries(rawResponse.no_bids || {})) {
    const noBidPrice = safeFloat(priceStr);
    const yesAskPrice = safeFloat(1.0 - noBidPrice).toFixed(4);
    const s = safeFloat(size);
    if (s > 0) asks.set(yesAskPrice, s);
  }

  return { bids, asks };
}

// ---------------------------------------------------------------------------
// Aggregation — merge books from multiple venues
// ---------------------------------------------------------------------------

/**
 * Merge one side (bids or asks) from two Maps into PriceLevel[].
 * Each Map is keyed by price string → size number.
 */
function mergeSide(
  polyMap: Map<string, number>,
  kalshiMap: Map<string, number>
): PriceLevel[] {
  const allPrices = new Set([...polyMap.keys(), ...kalshiMap.keys()]);
  const levels: PriceLevel[] = [];

  for (const priceStr of allPrices) {
    const polySize = polyMap.get(priceStr) || 0;
    const kalshiSize = kalshiMap.get(priceStr) || 0;
    const totalSize = safeFloat(polySize + kalshiSize);

    if (totalSize > 0) {
      levels.push({
        price: parseFloat(priceStr),
        size: totalSize,
        sources: {
          polymarket: safeFloat(polySize),
          kalshi: safeFloat(kalshiSize),
        },
      });
    }
  }

  return levels;
}

/**
 * Merge price levels from two venue books into a single aggregated book.
 *
 * For each unique price across both venues:
 *   - combined size = polySize + kalshiSize
 *   - sources tracks per-venue contribution
 *
 * Returns: { bids: PriceLevel[], asks: PriceLevel[] }
 *   bids sorted descending, asks sorted ascending
 */
export function mergePriceLevels(
  polyBook: VenueBook | null,
  kalshiBook: VenueBook | null
): { bids: PriceLevel[]; asks: PriceLevel[] } {
  const mergedBids = mergeSide(
    polyBook?.bids ?? new Map(),
    kalshiBook?.bids ?? new Map()
  );

  const mergedAsks = mergeSide(
    polyBook?.asks ?? new Map(),
    kalshiBook?.asks ?? new Map()
  );

  // Sort bids descending by price (highest first)
  mergedBids.sort((a, b) => b.price - a.price);
  // Sort asks ascending by price (lowest first)
  mergedAsks.sort((a, b) => a.price - b.price);

  return { bids: mergedBids, asks: mergedAsks };
}
