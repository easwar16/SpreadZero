import { useMemo } from "react";

/**
 * DepthChart — cumulative depth visualization rendered with SVG.
 * Bids (green) on the left, asks (red) on the right, meeting at the midpoint.
 */
export default function DepthChart({ bids, asks, midpoint }) {
  const { bidPoints, askPoints, priceMin, priceMax, maxCumulative } =
    useMemo(() => {
      if (!bids?.length && !asks?.length) {
        return { bidPoints: [], askPoints: [], priceMin: 0, priceMax: 1, maxCumulative: 1 };
      }

      // Build cumulative bid curve (sorted descending by price)
      const sortedBids = [...bids].sort((a, b) => b.price - a.price);
      let cumBid = 0;
      const bidPts = sortedBids.map((l) => {
        cumBid += l.size;
        return { price: l.price, cumSize: cumBid };
      });

      // Build cumulative ask curve (sorted ascending by price)
      const sortedAsks = [...asks].sort((a, b) => a.price - b.price);
      let cumAsk = 0;
      const askPts = sortedAsks.map((l) => {
        cumAsk += l.size;
        return { price: l.price, cumSize: cumAsk };
      });

      const allPrices = [...bidPts, ...askPts].map((p) => p.price);
      const pMin = allPrices.length ? Math.min(...allPrices) : 0;
      const pMax = allPrices.length ? Math.max(...allPrices) : 1;
      const maxCum = Math.max(cumBid, cumAsk, 1);

      return { bidPoints: bidPts, askPoints: askPts, priceMin: pMin, priceMax: pMax, maxCumulative: maxCum };
    }, [bids, asks]);

  const W = 400;
  const H = 260;
  const PAD = { top: 20, right: 16, bottom: 30, left: 50 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const scaleX = (price) => {
    const range = priceMax - priceMin || 1;
    return PAD.left + ((price - priceMin) / range) * plotW;
  };
  const scaleY = (cum) => {
    return PAD.top + plotH - (cum / maxCumulative) * plotH;
  };

  const buildPath = (points) => {
    if (!points.length) return "";
    return points.map((p, i) => `${i === 0 ? "M" : "L"}${scaleX(p.price).toFixed(1)},${scaleY(p.cumSize).toFixed(1)}`).join(" ");
  };

  const buildArea = (points, side) => {
    if (!points.length) return "";
    const line = buildPath(points);
    const last = points[points.length - 1];
    const first = points[0];
    if (side === "bid") {
      return `${line} L${scaleX(last.price).toFixed(1)},${scaleY(0).toFixed(1)} L${scaleX(first.price).toFixed(1)},${scaleY(0).toFixed(1)} Z`;
    }
    return `${line} L${scaleX(last.price).toFixed(1)},${scaleY(0).toFixed(1)} L${scaleX(first.price).toFixed(1)},${scaleY(0).toFixed(1)} Z`;
  };

  const hasData = bidPoints.length > 0 || askPoints.length > 0;

  // Y-axis ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((pct) => Math.round(maxCumulative * pct));

  // X-axis ticks
  const xTicks = hasData
    ? Array.from({ length: 5 }, (_, i) => +(priceMin + ((priceMax - priceMin) * i) / 4).toFixed(3))
    : [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="bg-panel border border-border rounded-lg p-4 h-full flex flex-col">
      <h2 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-3">
        Depth Chart
      </h2>
      <div className="flex-1 min-h-0">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          {/* Grid lines */}
          {yTicks.map((t) => (
            <line
              key={`yg-${t}`}
              x1={PAD.left} y1={scaleY(t)}
              x2={W - PAD.right} y2={scaleY(t)}
              stroke="#1f1f26" strokeWidth="0.5"
            />
          ))}

          {/* Midpoint line */}
          {midpoint > 0 && hasData && (
            <line
              x1={scaleX(midpoint)} y1={PAD.top}
              x2={scaleX(midpoint)} y2={PAD.top + plotH}
              stroke="#9090a8" strokeWidth="0.5" strokeDasharray="4 3"
            />
          )}

          {/* Bid area */}
          <path d={buildArea(bidPoints, "bid")} fill="rgba(0,200,122,0.12)" />
          <path d={buildPath(bidPoints)} fill="none" stroke="#00c87a" strokeWidth="1.5" />

          {/* Ask area */}
          <path d={buildArea(askPoints, "ask")} fill="rgba(240,54,74,0.12)" />
          <path d={buildPath(askPoints)} fill="none" stroke="#f0364a" strokeWidth="1.5" />

          {/* Y-axis labels */}
          {yTicks.map((t) => (
            <text
              key={`yl-${t}`}
              x={PAD.left - 6} y={scaleY(t) + 3}
              textAnchor="end" fontSize="9" fill="#55556a" fontFamily="monospace"
            >
              {t >= 1000 ? `${(t / 1000).toFixed(1)}k` : t}
            </text>
          ))}

          {/* X-axis labels */}
          {xTicks.map((t) => (
            <text
              key={`xl-${t}`}
              x={scaleX(t)} y={H - 6}
              textAnchor="middle" fontSize="9" fill="#55556a" fontFamily="monospace"
            >
              {t.toFixed(2)}
            </text>
          ))}

          {/* Empty state */}
          {!hasData && (
            <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="12" fill="#55556a">
              Waiting for data...
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
