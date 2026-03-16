/**
 * MarketStats — horizontal bar of key market metrics.
 * Derived from the live order book data.
 */
export default function MarketStats({ book, visibleBids, visibleAsks, spread, midpoint }) {
  if (!book) return null;

  const bestBid = visibleBids[0];
  const bestAsk = visibleAsks[0];

  // Total liquidity across visible levels
  const bidLiquidity = visibleBids.reduce((sum, l) => sum + l.price * l.size, 0);
  const askLiquidity = visibleAsks.reduce((sum, l) => sum + l.price * l.size, 0);
  const totalLiquidity = bidLiquidity + askLiquidity;

  // Total shares on book
  const bidDepth = visibleBids.reduce((sum, l) => sum + l.size, 0);
  const askDepth = visibleAsks.reduce((sum, l) => sum + l.size, 0);

  const stats = [
    {
      label: "Yes",
      value: bestBid ? `${(bestBid.price * 100).toFixed(1)}¢` : "—",
      color: "#00c87a",
    },
    {
      label: "No",
      value: bestAsk ? `${((1 - bestAsk.price) * 100).toFixed(1)}¢` : "—",
      color: "#f0364a",
    },
    {
      label: "Spread",
      value: spread > 0 ? `${(spread * 100).toFixed(1)}¢` : "—",
    },
    {
      label: "Midpoint",
      value: midpoint > 0 ? `${(midpoint * 100).toFixed(1)}¢` : "—",
    },
    {
      label: "Bid Depth",
      value: bidDepth > 0 ? fmtCompact(bidDepth) : "—",
      color: "#00c87a",
    },
    {
      label: "Ask Depth",
      value: askDepth > 0 ? fmtCompact(askDepth) : "—",
      color: "#f0364a",
    },
    {
      label: "Liquidity",
      value: totalLiquidity > 0 ? `$${fmtCompact(totalLiquidity)}` : "—",
    },
  ];

  return (
    <div className="flex items-center gap-5 px-1 py-1 overflow-x-auto">
      {stats.map((s) => (
        <div key={s.label} className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-[#4a4a5a] uppercase tracking-wider">{s.label}</span>
          <span
            className="text-[11px] font-mono tabular-nums font-semibold"
            style={{ color: s.color || "#9090a8" }}
          >
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function fmtCompact(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}
