import { useMemo } from "react";

const MAX_VISIBLE_LEVELS = 8;

/**
 * useOrderBook — filters and shapes the raw aggregated book for display.
 *
 * When activeVenue is "combined", the book passes through as-is.
 * When set to a single venue ("polymarket" or "kalshi"), levels are
 * rebuilt using only that venue's size from the sources field, and
 * levels with zero size for that venue are filtered out.
 *
 * Also precomputes:
 *   - cumulative dollar totals (price * cumulative size from best price inward)
 *   - maxSize for depth bar scaling
 *   - top 8 visible levels for each side
 */
export function useOrderBook(book, activeVenue) {
  return useMemo(() => {
    if (!book) {
      return {
        visibleBids: [],
        visibleAsks: [],
        spread: 0,
        midpoint: 0,
        maxSize: 1,
      };
    }

    let bids = book.bids || [];
    let asks = book.asks || [];

    // Filter to single venue if not "combined"
    if (activeVenue !== "combined") {
      bids = filterByVenue(bids, activeVenue);
      asks = filterByVenue(asks, activeVenue);
    }

    // Trim to top 8 levels (bids already sorted desc, asks sorted asc)
    const topBids = bids.slice(0, MAX_VISIBLE_LEVELS);
    const topAsks = asks.slice(0, MAX_VISIBLE_LEVELS);

    // Find max size across all visible levels for depth bar scaling
    let maxSize = 1;
    for (const level of [...topBids, ...topAsks]) {
      if (level.size > maxSize) maxSize = level.size;
    }

    // Precompute cumulative dollar totals from best price inward.
    // For bids: best bid is first (index 0), cumulate downward.
    // For asks: best ask is first (index 0), cumulate upward.
    const visibleBids = addCumulativeDollars(topBids);
    const visibleAsks = addCumulativeDollars(topAsks);

    // Recalculate spread/midpoint for filtered view
    const bestBid = visibleBids.length > 0 ? visibleBids[0].price : 0;
    const bestAsk = visibleAsks.length > 0 ? visibleAsks[0].price : 1;
    const spread = Math.round((bestAsk - bestBid) * 10000) / 10000;
    const midpoint =
      Math.round(((bestAsk + bestBid) / 2) * 10000) / 10000;

    return { visibleBids, visibleAsks, spread, midpoint, maxSize };
  }, [book, activeVenue]);
}

/**
 * Rebuild levels using only a single venue's size.
 * Filters out levels where that venue has zero contribution.
 */
function filterByVenue(levels, venue) {
  return levels
    .map((level) => ({
      ...level,
      size: level.sources[venue] || 0,
      sources: {
        polymarket: venue === "polymarket" ? level.sources.polymarket || 0 : 0,
        kalshi: venue === "kalshi" ? level.sources.kalshi || 0 : 0,
      },
    }))
    .filter((level) => level.size > 0);
}

/**
 * Add cumulative dollar totals to each level.
 * Cumulative = sum of (price * size) from best price through this level.
 */
function addCumulativeDollars(levels) {
  let cumulative = 0;
  return levels.map((level) => {
    cumulative += level.price * level.size;
    return { ...level, cumulative };
  });
}
