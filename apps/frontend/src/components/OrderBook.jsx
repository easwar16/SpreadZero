import { useState, useMemo } from "react";
import OrderBookRow from "./OrderBookRow";
import SpreadBar from "./SpreadBar";

const EMPTY_LEVELS = 8;

const GROUPING_OPTIONS = [
  { label: "1¢", value: 0.01 },
  { label: "5¢", value: 0.05 },
  { label: "10¢", value: 0.10 },
];

/**
 * groupLevels — bucket price levels by a grouping increment.
 *
 * Bids round DOWN, asks round UP to the nearest grouping boundary.
 * Aggregates size and per-venue sources within each bucket.
 * Re-sorts bids descending, asks ascending.
 */
function groupLevels(levels, grouping, side) {
  if (grouping <= 0.01) return levels;

  const buckets = new Map();
  for (const level of levels) {
    const bucketPrice =
      side === "bid"
        ? Math.floor(level.price / grouping) * grouping
        : Math.ceil(level.price / grouping) * grouping;

    // Round to avoid floating-point drift
    const key = Math.round(bucketPrice * 10000) / 10000;

    if (buckets.has(key)) {
      const existing = buckets.get(key);
      existing.size += level.size;
      existing.sources.polymarket =
        (existing.sources.polymarket || 0) + (level.sources.polymarket || 0);
      existing.sources.kalshi =
        (existing.sources.kalshi || 0) + (level.sources.kalshi || 0);
    } else {
      buckets.set(key, {
        price: key,
        size: level.size,
        sources: {
          polymarket: level.sources.polymarket || 0,
          kalshi: level.sources.kalshi || 0,
        },
        cumulative: 0,
      });
    }
  }

  const sorted = Array.from(buckets.values());
  sorted.sort((a, b) =>
    side === "bid" ? b.price - a.price : a.price - b.price
  );
  return sorted;
}

/**
 * addCumulative — recompute cumulative dollar totals after grouping.
 */
function addCumulative(levels) {
  let cum = 0;
  return levels.map((level) => {
    cum += level.price * level.size;
    return { ...level, cumulative: cum };
  });
}

/**
 * OrderBook — Polymarket-style order book table.
 *
 * Layout (top to bottom):
 *   1. Header — "Order Book (Yes)" + grouping dropdown
 *   2. Buy/Sell ratio bar
 *   3. Column headers — Price (¢) | Shares | Total (USD)
 *   4. Ask rows — worst ask at top, best ask nearest spread
 *   5. Spread row
 *   6. Bid rows — best bid nearest spread, worst bid at bottom
 */
export default function OrderBook({
  visibleBids,
  visibleAsks,
  spread,
  midpoint,
  maxSize,
}) {
  const [grouping, setGrouping] = useState(0.01);

  const groupedBids = useMemo(
    () => addCumulative(groupLevels(visibleBids, grouping, "bid")),
    [visibleBids, grouping]
  );
  const groupedAsks = useMemo(
    () => addCumulative(groupLevels(visibleAsks, grouping, "ask")),
    [visibleAsks, grouping]
  );

  const effectiveMaxSize = useMemo(() => {
    let m = 1;
    for (const level of [...groupedBids, ...groupedAsks]) {
      if (level.size > m) m = level.size;
    }
    return m;
  }, [groupedBids, groupedAsks]);

  const hasData = groupedBids.length > 0 || groupedAsks.length > 0;
  const displayAsks = [...groupedAsks].reverse();

  // Buy/Sell ratio from grouped data
  const bidTotal = groupedBids.reduce((sum, l) => sum + l.size, 0);
  const askTotal = groupedAsks.reduce((sum, l) => sum + l.size, 0);
  const total = bidTotal + askTotal || 1;
  const buyPct = (bidTotal / total) * 100;
  const sellPct = (askTotal / total) * 100;

  return (
    <div className="bg-[#12141a] border border-[#1e2330] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e2330]">
        <h3 className="text-sm font-semibold text-[#e2e8f0]">
          Order Book
        </h3>
        <select
          value={grouping}
          onChange={(e) => setGrouping(Number(e.target.value))}
          className="bg-[#1a1c24] border border-[#2a3040] rounded-md px-2.5 py-1 text-xs font-mono text-[#e2e8f0] outline-none cursor-pointer hover:border-[#64748b] transition-colors"
        >
          {GROUPING_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Buy/Sell ratio bar */}
      {hasData && (
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="text-xs font-semibold text-[#00c87a] tabular-nums">
            B {buyPct.toFixed(0)}%
          </span>
          <div className="flex-1 flex h-1.5 rounded-full overflow-hidden">
            <div
              className="h-full bg-[#00c87a] rounded-l-full transition-[width] duration-300"
              style={{ width: `${buyPct}%` }}
            />
            <div
              className="h-full bg-[#f0364a] rounded-r-full transition-[width] duration-300"
              style={{ width: `${sellPct}%` }}
            />
          </div>
          <span className="text-xs font-semibold text-[#f0364a] tabular-nums">
            {sellPct.toFixed(0)}% S
          </span>
        </div>
      )}

      {/* Column headers */}
      <div className="flex items-center px-4 py-1.5 text-[11px] text-[#64748b] font-medium">
        <span className="flex-[1.2]">Price (¢)</span>
        <span className="flex-1 text-right">Shares</span>
        <span className="flex-1 text-right">Total (USD)</span>
      </div>

      {/* Ask rows */}
      {hasData ? (
        displayAsks.map((level) => (
          <OrderBookRow
            key={`ask-${level.price}`}
            level={level}
            side="ask"
            maxSize={effectiveMaxSize}
          />
        ))
      ) : (
        <PlaceholderRows side="ask" />
      )}

      {/* Spread bar */}
      <SpreadBar spread={spread} midpoint={midpoint} hasData={hasData} />

      {/* Bid rows */}
      {hasData ? (
        groupedBids.map((level) => (
          <OrderBookRow
            key={`bid-${level.price}`}
            level={level}
            side="bid"
            maxSize={effectiveMaxSize}
          />
        ))
      ) : (
        <PlaceholderRows side="bid" />
      )}
    </div>
  );
}

function PlaceholderRows({ side }) {
  return Array.from({ length: EMPTY_LEVELS }, (_, i) => (
    <div key={`ph-${side}-${i}`} className="flex items-center px-4 py-[7px]">
      <span className="flex-[1.2] text-sm font-mono text-[#3a3a4a]">—</span>
      <span className="flex-1 text-sm font-mono text-[#3a3a4a] text-right">—</span>
      <span className="flex-1 text-sm font-mono text-[#3a3a4a] text-right">—</span>
    </div>
  ));
}
