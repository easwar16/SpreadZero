/**
 * OrderBookRow — Polymarket-style price level row.
 *
 * Price in cents, depth bar fills from right, no venue pills.
 */
export default function OrderBookRow({ level, side, maxSize }) {
  const priceColor = side === "ask" ? "text-[#f0364a]" : "text-[#00c87a]";
  const depthBg = side === "ask"
    ? "rgba(240, 54, 74, 0.15)"
    : "rgba(0, 200, 122, 0.15)";

  const priceCents = `${(level.price * 100).toFixed(0)}¢`;
  const shares = level.size.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const totalUsd =
    "$" +
    level.cumulative.toLocaleString("en-US", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });

  const depthPct = maxSize > 0 ? (level.size / maxSize) * 100 : 0;

  return (
    <div className="relative flex items-center px-4 py-[7px] hover:brightness-125 transition-[filter] duration-100 cursor-default">
      {/* Depth bar — fills from right */}
      <div
        className="absolute top-0 bottom-0 right-0 z-0 transition-[width] duration-150 ease-out"
        style={{ width: `${depthPct}%`, backgroundColor: depthBg }}
      />

      {/* Row content */}
      <div className="relative z-10 flex items-center w-full">
        <span className={`flex-[1.2] text-sm font-mono tabular-nums font-medium ${priceColor}`}>
          {priceCents}
        </span>
        <span className="flex-1 text-sm font-mono tabular-nums text-[#e2e8f0] text-right">
          {shares}
        </span>
        <span className="flex-1 text-sm font-mono tabular-nums text-[#9090a8] text-right">
          {totalUsd}
        </span>
      </div>
    </div>
  );
}
