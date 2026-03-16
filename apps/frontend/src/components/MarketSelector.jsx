import { useState, useRef, useEffect } from "react";

const CATEGORY_COLORS = {
  Economics: "#7c6df0",
  Politics: "#f0364a",
  Crypto: "#f59e0b",
  "Tech & Policy": "#a78bfa",
  Science: "#00c87a",
  Stocks: "#22d3ee",
  Sports: "#f97316",
};

/**
 * MarketSelector — searchable dropdown of available markets.
 */
export default function MarketSelector({
  markets,
  activeId,
  activeMarket,
  onSelect,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const inputRef = useRef(null);
  const containerRef = useRef(null);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Only show markets that have a Kalshi pairing (cross-venue)
  const paired = markets.filter((m) => !!m.kalshiTicker);
  const filtered = paired.filter((m) =>
    m.title.toLowerCase().includes(search.toLowerCase()) ||
    m.category.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="relative" ref={containerRef}>
      {/* Active market display / toggle button */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          setSearch("");
        }}
        className="w-full flex items-center justify-between gap-3 bg-panel border border-border rounded-lg px-4 py-3 hover:border-accent/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          {activeMarket?.kalshiTicker ? (
            <>
              <span
                className="inline-block px-2 py-0.5 text-[10px] font-semibold rounded uppercase tracking-wider shrink-0"
                style={{
                  backgroundColor: `${CATEGORY_COLORS[activeMarket.category] || "#64748b"}20`,
                  color: CATEGORY_COLORS[activeMarket.category] || "#64748b",
                }}
              >
                {activeMarket.category}
              </span>
              <span className="text-sm text-text-primary truncate">
                {activeMarket.title}
              </span>
            </>
          ) : (
            <span className="text-sm text-text-muted">
              {paired.length === 0 ? "No paired markets — link a Kalshi ticker first" : "Select a market"}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-text-muted shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-panel border border-border rounded-lg shadow-xl overflow-hidden">
          {/* Search input */}
          <div className="px-3 py-2 border-b border-border">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search markets..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-page border border-border rounded-md px-3 py-1.5 text-sm text-text-primary placeholder-text-muted outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Market list */}
          <div className="max-h-[300px] overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-4 py-4 text-center text-xs text-text-muted">
                No markets found
              </div>
            ) : (
              filtered.map((market) => {
                const isActive = market.id === activeId;
                const catColor = CATEGORY_COLORS[market.category] || "#55556a";

                return (
                  <button
                    key={market.id}
                    onClick={() => {
                      onSelect(market.id);
                      setIsOpen(false);
                      setSearch("");
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                      isActive
                        ? "bg-raised"
                        : "hover:bg-raised/60"
                    }`}
                  >
                    <span
                      className="inline-block px-2 py-0.5 text-[10px] font-semibold rounded uppercase tracking-wider shrink-0"
                      style={{
                        backgroundColor: `${catColor}20`,
                        color: catColor,
                      }}
                    >
                      {market.category}
                    </span>
                    <span className="text-sm text-text-primary truncate flex-1">
                      {market.title}
                    </span>
                    <span className="text-xs font-mono text-text-secondary shrink-0">
                      {(market.midpoint * 100).toFixed(0)}¢
                    </span>
                    {market.kalshiTicker && (
                      <span className="text-[8px] px-1 py-0.5 rounded bg-[#22d3ee]/10 text-[#22d3ee] font-semibold shrink-0">
                        2V
                      </span>
                    )}
                    {isActive && (
                      <span className="w-1.5 h-1.5 rounded-full bg-buy shrink-0" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
