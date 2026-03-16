import { useState, useEffect, useRef, useMemo } from "react";

const MAX_POINTS = 300; // ~5 min at 1 update/sec
const CHART_W = 600;
const CHART_H = 200;
const PAD = { top: 12, right: 55, bottom: 24, left: 10 };

/**
 * PriceChart — real-time midpoint price line chart.
 * Tracks midpoint from the live WebSocket feed during the session.
 */
export default function PriceChart({ midpoint, spread, venueFilter, marketId }) {
  const [history, setHistory] = useState([]);
  const prevMid = useRef(null);
  const lastJumpRef = useRef(0);

  // Reset history when venue filter or market changes
  useEffect(() => {
    setHistory([]);
    prevMid.current = null;
  }, [venueFilter, marketId]);

  useEffect(() => {
    if (!midpoint || midpoint <= 0.001) return;
    // Only record if price actually changed
    if (prevMid.current === midpoint) return;

    // Detect market switch: if price jumps >20%, reset history
    if (prevMid.current !== null && prevMid.current > 0.001) {
      const pctChange = Math.abs(midpoint - prevMid.current) / prevMid.current;
      if (pctChange > 0.2 && Date.now() - lastJumpRef.current > 2000) {
        lastJumpRef.current = Date.now();
        setHistory([]);
        prevMid.current = midpoint;
        return;
      }
    }

    prevMid.current = midpoint;

    setHistory((prev) => {
      const now = Date.now();
      const next = [...prev, { time: now, price: midpoint }];
      return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
    });
  }, [midpoint]);

  const { points, priceLine, areaPath, yTicks, xTicks, priceMin, priceMax, change, changePct, lastPrice } =
    useMemo(() => {
      if (history.length < 2) {
        return { points: [], priceLine: "", areaPath: "", yTicks: [], xTicks: [], priceMin: 0, priceMax: 1, change: 0, changePct: 0, lastPrice: midpoint || 0 };
      }

      const prices = history.map((h) => h.price);
      const times = history.map((h) => h.time);

      const pMin = Math.min(...prices);
      const pMax = Math.max(...prices);
      const tMin = times[0];
      const tMax = times[times.length - 1];

      // Add 2% padding to price range
      const range = pMax - pMin || 0.01;
      const padded = range * 0.15;
      const yMin = pMin - padded;
      const yMax = pMax + padded;

      const plotW = CHART_W - PAD.left - PAD.right;
      const plotH = CHART_H - PAD.top - PAD.bottom;
      const tRange = tMax - tMin || 1;

      const scX = (t) => PAD.left + ((t - tMin) / tRange) * plotW;
      const scY = (p) => PAD.top + plotH - ((p - yMin) / (yMax - yMin)) * plotH;

      const pts = history.map((h) => ({ x: scX(h.time), y: scY(h.price) }));

      const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${pts[0].x.toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`;

      // Y-axis ticks (4-5 levels)
      const ySteps = 4;
      const yTickArr = [];
      for (let i = 0; i <= ySteps; i++) {
        const price = yMin + (yMax - yMin) * (i / ySteps);
        yTickArr.push({ price, y: scY(price) });
      }

      // X-axis ticks (time labels)
      const xSteps = Math.min(5, history.length - 1);
      const xTickArr = [];
      for (let i = 0; i <= xSteps; i++) {
        const t = tMin + tRange * (i / xSteps);
        const d = new Date(t);
        xTickArr.push({
          label: d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }),
          x: scX(t),
        });
      }

      const first = prices[0];
      const last = prices[prices.length - 1];
      const chg = last - first;
      const chgPct = first > 0 ? (chg / first) * 100 : 0;

      return {
        points: pts,
        priceLine: line,
        areaPath: area,
        yTicks: yTickArr,
        xTicks: xTickArr,
        priceMin: pMin,
        priceMax: pMax,
        change: chg,
        changePct: chgPct,
        lastPrice: last,
      };
    }, [history, midpoint]);

  const cents = (lastPrice * 100).toFixed(1);
  const isUp = change >= 0;
  const lineColor = isUp ? "#00c87a" : "#f0364a";
  const areaFill = isUp ? "rgba(0,200,122,0.08)" : "rgba(240,54,74,0.08)";

  return (
    <div className="bg-[#12141a] border border-[#1e2330] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#1e2330]">
        <div className="flex items-center gap-3">
          <span className="text-xs font-medium text-[#64748b] uppercase tracking-wider">Price</span>
          <span className="text-sm font-mono font-semibold text-[#e2e8f0] tabular-nums">{cents}¢</span>
          {history.length >= 2 && (
            <span className={`text-xs font-mono tabular-nums ${isUp ? "text-[#00c87a]" : "text-[#f0364a]"}`}>
              {isUp ? "+" : ""}{(change * 100).toFixed(1)}¢ ({isUp ? "+" : ""}{changePct.toFixed(1)}%)
            </span>
          )}
        </div>
        <span className="text-[10px] text-[#4a4a5a]">
          {history.length < 2 ? "Collecting data..." : `${history.length} ticks`}
        </span>
      </div>

      {/* Chart */}
      <div className="px-2 py-1">
        <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          {/* Grid lines */}
          {yTicks.map((t, i) => (
            <line key={`yg-${i}`} x1={PAD.left} y1={t.y} x2={CHART_W - PAD.right} y2={t.y}
              stroke="#1e2330" strokeWidth="0.5" />
          ))}

          {/* Area fill */}
          {areaPath && <path d={areaPath} fill={areaFill} />}

          {/* Price line */}
          {priceLine && (
            <path d={priceLine} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinejoin="round" />
          )}

          {/* Current price dot */}
          {points.length > 0 && (
            <>
              <circle cx={points[points.length - 1].x} cy={points[points.length - 1].y} r="3" fill={lineColor} />
              {/* Price label on right */}
              <rect
                x={CHART_W - PAD.right + 4}
                y={points[points.length - 1].y - 8}
                width="46" height="16" rx="3"
                fill={lineColor}
              />
              <text
                x={CHART_W - PAD.right + 27}
                y={points[points.length - 1].y + 1}
                textAnchor="middle" fontSize="9" fill="white" fontFamily="monospace" fontWeight="600"
              >
                {cents}¢
              </text>
            </>
          )}

          {/* Y-axis labels */}
          {yTicks.map((t, i) => (
            <text key={`yl-${i}`} x={CHART_W - PAD.right + 6} y={t.y + 3}
              fontSize="8" fill="#4a4a5a" fontFamily="monospace">
              {(t.price * 100).toFixed(0)}
            </text>
          ))}

          {/* X-axis labels */}
          {xTicks.map((t, i) => (
            <text key={`xl-${i}`} x={t.x} y={CHART_H - 4}
              textAnchor="middle" fontSize="8" fill="#4a4a5a" fontFamily="monospace">
              {t.label}
            </text>
          ))}

          {/* Empty state */}
          {history.length < 2 && (
            <text x={CHART_W / 2} y={CHART_H / 2} textAnchor="middle" fontSize="11" fill="#4a4a5a">
              Waiting for price data...
            </text>
          )}
        </svg>
      </div>
    </div>
  );
}
