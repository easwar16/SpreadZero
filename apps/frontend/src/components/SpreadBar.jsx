/**
 * SpreadBar — Polymarket-style spread divider between asks and bids.
 * Shows spread in cents + percentage.
 */
export default function SpreadBar({ spread, midpoint, hasData }) {
  const spreadCents = hasData ? `${(spread * 100).toFixed(0)}¢` : "—";
  const spreadPct =
    hasData && midpoint > 0
      ? `${((spread / midpoint) * 100).toFixed(3)}%`
      : "—";

  return (
    <div className="flex items-center px-4 py-2 border-y border-[#2a3040] bg-[#1a1c24]">
      <span className="text-xs text-[#64748b] font-medium flex-1">Spread</span>
      <span className="text-xs font-mono tabular-nums text-[#9090a8] mr-8">
        {spreadCents}
      </span>
      <span className="text-xs font-mono tabular-nums text-[#9090a8]">
        {spreadPct}
      </span>
    </div>
  );
}
