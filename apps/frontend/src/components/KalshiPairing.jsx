import { useState } from "react";

/**
 * KalshiPairing — compact inline control for linking/unlinking a Kalshi ticker
 * to the active Polymarket market.
 */
export default function KalshiPairing({ activeMarket, activeId, onPair, onUnpair }) {
  const [ticker, setTicker] = useState("");

  if (!activeMarket) return null;

  const linked = !!activeMarket.kalshiTicker;

  const handleLink = () => {
    const trimmed = ticker.trim();
    if (!trimmed) return;
    onPair(activeId, trimmed);
    setTicker("");
  };

  const handleUnlink = () => {
    onUnpair(activeId, null);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleLink();
  };

  if (linked) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-[#4a4a5a] uppercase tracking-wider">Kalshi</span>
        <span className="text-[11px] font-mono font-medium text-[#9090a8]">
          {activeMarket.kalshiTicker}
        </span>
        <button
          onClick={handleUnlink}
          className="px-2 py-0.5 text-[10px] font-medium rounded bg-[#2a3040] text-[#64748b] hover:text-[#e2e8f0] hover:bg-[#3a4050] transition-colors cursor-pointer"
        >
          Unlink
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-[#4a4a5a] uppercase tracking-wider">Kalshi</span>
      <input
        type="text"
        value={ticker}
        onChange={(e) => setTicker(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ticker..."
        className="w-28 px-2 py-0.5 text-[11px] font-mono bg-[#12141a] border border-[#2a3040] rounded text-[#e2e8f0] placeholder-[#4a4a5a] outline-none focus:border-[#22d3ee] transition-colors"
      />
      <button
        onClick={handleLink}
        disabled={!ticker.trim()}
        className="px-2.5 py-0.5 text-[10px] font-semibold rounded bg-[#00c87a] text-[#12141a] hover:brightness-110 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Link
      </button>
    </div>
  );
}
