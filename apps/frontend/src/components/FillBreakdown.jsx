import { formatDollars, formatCents } from "../utils/format";

/**
 * FillBreakdown — venue fill details with proportional bar.
 * Information-dense: shows each venue's share of the fill,
 * price difference between venues, and arbitrage opportunity.
 */
export default function FillBreakdown({ result, loading }) {
  if (!result || !result.fills?.length) return null;

  const totalShares = result.fills.reduce((sum, f) => sum + f.shares, 0) || 1;
  const totalCost = result.fills.reduce((sum, f) => sum + f.cost, 0) || 1;
  const pmFill = result.fills.find((f) => f.venue === "polymarket");
  const ksFill = result.fills.find((f) => f.venue === "kalshi");
  const pmPct = pmFill ? (pmFill.shares / totalShares) * 100 : 0;
  const ksPct = ksFill ? (ksFill.shares / totalShares) * 100 : 0;

  // Price edge between venues (if both have fills)
  const priceEdge = pmFill && ksFill
    ? Math.abs(pmFill.avgPrice - ksFill.avgPrice) * 100
    : null;

  return (
    <div className={`space-y-3 ${loading ? "animate-subtle-pulse" : ""}`}>
      <h3 className="text-[11px] font-semibold text-[#64748b] uppercase tracking-wider">
        Venue Routing
      </h3>

      {/* Split bar */}
      <div className="bg-[#12141a] border border-[#2a3040] rounded-lg p-3">
        <div className="flex justify-between text-[10px] font-mono text-[#64748b] mb-1.5">
          <span><span className="text-[#a78bfa]">PM</span> {pmPct.toFixed(0)}%</span>
          <span>{ksPct.toFixed(0)}% <span className="text-[#22d3ee]">KS</span></span>
        </div>
        <div className="flex h-1 rounded-full overflow-hidden bg-[#1e2330]">
          {pmPct > 0 && (
            <div className="h-full bg-[#a78bfa] transition-all duration-300" style={{ width: `${pmPct}%` }} />
          )}
          {ksPct > 0 && (
            <div className="h-full bg-[#22d3ee] transition-all duration-300" style={{ width: `${ksPct}%` }} />
          )}
        </div>

        {/* Price edge info */}
        {priceEdge !== null && priceEdge > 0 && (
          <div className="flex justify-between mt-2 pt-2 border-t border-[#1e2330]">
            <span className="text-[10px] text-[#64748b]">Price edge</span>
            <span className="text-[10px] font-mono text-[#f59e0b]">{priceEdge.toFixed(2)}¢</span>
          </div>
        )}
      </div>

      {/* Venue detail cards */}
      <div className="space-y-1.5">
        {result.fills.map((fill) => {
          const isPM = fill.venue === "polymarket";
          const accent = isPM ? "#a78bfa" : "#22d3ee";
          const pctOfCost = ((fill.cost / totalCost) * 100).toFixed(0);
          const pctOfShares = ((fill.shares / totalShares) * 100).toFixed(0);

          return (
            <div
              key={fill.venue}
              className="bg-[#12141a] border border-[#2a3040] rounded-lg p-3"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accent }} />
                  <span className="text-[11px] font-semibold text-[#e2e8f0]">
                    {isPM ? "Polymarket" : "Kalshi"}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-[#64748b]">
                  {pctOfShares}% of fill
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
                <div>
                  <div className="text-[#4a4a5a] mb-0.5">Shares</div>
                  <div className="text-[#e2e8f0] tabular-nums">
                    {fill.shares.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                  </div>
                </div>
                <div>
                  <div className="text-[#4a4a5a] mb-0.5">Avg Price</div>
                  <div className="text-[#e2e8f0] tabular-nums">{formatCents(fill.avgPrice)}</div>
                </div>
                <div>
                  <div className="text-[#4a4a5a] mb-0.5">Cost</div>
                  <div className="text-[#e2e8f0] tabular-nums">{formatDollars(fill.cost)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
