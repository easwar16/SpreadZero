import { useState, useEffect } from "react";
import { formatTimeSince } from "../utils/format";

const DOT_COLORS = {
  live: "#22c55e",
  stale: "#f59e0b",
  disconnected: "#ef4444",
  connecting: "#64748b",
};

/**
 * VenueStatus — fixed bottom-right pills showing live connection status.
 */
export default function VenueStatus({ venueStatus }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (!venueStatus) return null;

  return (
    <div className="fixed bottom-4 left-4 flex gap-2 z-50">
      <VenuePill venue="Polymarket" data={venueStatus.polymarket} />
      <VenuePill venue="Kalshi" data={venueStatus.kalshi} />
    </div>
  );
}

function VenuePill({ venue, data }) {
  const status = data?.status || "disconnected";
  const dotColor = DOT_COLORS[status] || DOT_COLORS.disconnected;
  const isPulsing = status === "connecting";

  return (
    <div className="flex items-center gap-2 bg-[#141720] border border-[#1e2330] rounded-lg px-3 py-1.5 shadow-lg">
      <span
        className={`inline-block w-2 h-2 rounded-full shrink-0 ${isPulsing ? "animate-pulse-dot" : ""}`}
        style={{ backgroundColor: dotColor }}
      />
      <span className="text-xs font-medium text-[#e2e8f0]">{venue}</span>
      {data?.isMock && (
        <span className="text-[10px] text-[#f59e0b]">(sim)</span>
      )}
      <span className="text-[10px] text-[#64748b]">{status}</span>
    </div>
  );
}
