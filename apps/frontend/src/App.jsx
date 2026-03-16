import { useState } from "react";
import { useWebSocket } from "./hooks/useWebSocket";
import { useOrderBook } from "./hooks/useOrderBook";
import { useMarkets } from "./hooks/useMarkets";
import { useQuote } from "./hooks/useQuote";
import VenueStatus from "./components/VenueStatus";
import VenueToggle from "./components/VenueToggle";
import OrderBook from "./components/OrderBook";
import QuoteCalculator from "./components/QuoteCalculator";
import FillBreakdown from "./components/FillBreakdown";
import MarketSelector from "./components/MarketSelector";
import MarketStats from "./components/MarketStats";
import DepthChart from "./components/DepthChart";
import PriceChart from "./components/PriceChart";
import KalshiPairing from "./components/KalshiPairing";

export default function App() {
  const { book, connectionState } = useWebSocket();
  const [activeVenue, setActiveVenue] = useState("combined");
  const { visibleBids, visibleAsks, spread, midpoint, maxSize } =
    useOrderBook(book, activeVenue);
  const { markets, activeMarket, activeId, selectMarket, pairKalshi } = useMarkets();
  const { amount, setAmount, side, setSide, result, loading, error } = useQuote(activeId);

  // Full-screen loading state
  if (connectionState === "connecting" && !book) {
    return (
      <div className="min-h-screen bg-[#0d0f14] flex flex-col items-center justify-center gap-4">
        <div className="w-8 h-8 border-2 border-[#4a4a5a] border-t-transparent rounded-full animate-spin" />
        <p className="text-[#4a4a5a] text-sm">Connecting to SpreadZero...</p>
      </div>
    );
  }

  // Full-screen error state
  if (connectionState === "error" && !book) {
    return (
      <div className="min-h-screen bg-[#0d0f14] flex flex-col items-center justify-center gap-4 px-4">
        <div className="w-10 h-10 rounded-full bg-[#f0364a]/10 flex items-center justify-center">
          <span className="text-[#f0364a] text-lg font-bold">!</span>
        </div>
        <p className="text-[#9090a8] text-sm text-center">
          Unable to connect to backend. Is the server running on port 3001?
        </p>
      </div>
    );
  }

  const hasData = visibleBids.length > 0 || visibleAsks.length > 0;

  return (
    <div className="min-h-screen bg-[#0d0f14] text-[#e2e8f0] flex flex-col">
      {/* Top bar — market selector + stats */}
      <header className="border-b border-[#1e2330] px-4 py-3">
        <div className="flex items-center gap-4">
          <h1 className="text-sm font-bold tracking-tight text-[#e2e8f0] shrink-0">SpreadZero</h1>
          <div className="flex-1 min-w-0">
            <MarketSelector
              markets={markets}
              activeId={activeId}
              activeMarket={activeMarket}
              onSelect={selectMarket}
            />
          </div>
        </div>
        {hasData && (
          <div className="mt-2 border-t border-[#1e2330] pt-2">
            <div className="flex items-center justify-between">
              <MarketStats
                book={book}
                visibleBids={visibleBids}
                visibleAsks={visibleAsks}
                spread={spread}
                midpoint={midpoint}
              />
              <KalshiPairing
                activeMarket={activeMarket}
                activeId={activeId}
                onPair={pairKalshi}
                onUnpair={pairKalshi}
              />
            </div>
          </div>
        )}
      </header>

      {/* Main content area */}
      <div className="flex flex-1 min-h-0">
        {/* Center — charts + order book */}
        <main className="flex-1 min-w-0 px-4 py-4 space-y-4 overflow-y-auto">
          {/* Price Chart + Depth Chart stacked, Order Book on right */}
          <div className="flex gap-4 items-start">
            <div className="w-1/2 sticky top-4 space-y-3">
              <PriceChart midpoint={midpoint} spread={spread} venueFilter={activeVenue} marketId={activeId} />
              <DepthChart
                bids={visibleBids}
                asks={visibleAsks}
                midpoint={midpoint}
              />
            </div>

            <div className="w-1/2 space-y-3">
              <VenueToggle activeVenue={activeVenue} onChange={setActiveVenue} />
              <OrderBook
                visibleBids={visibleBids}
                visibleAsks={visibleAsks}
                spread={spread}
                midpoint={midpoint}
                maxSize={maxSize}
              />
            </div>
          </div>
        </main>

        {/* Right sidebar — quote calculator */}
        <aside className="w-[340px] shrink-0 border-l border-[#1e2330] bg-[#0d0f14] px-4 py-4 sticky top-0 h-[calc(100vh-80px)] overflow-y-auto space-y-4">
          <QuoteCalculator
            amount={amount}
            setAmount={setAmount}
            side={side}
            setSide={setSide}
            result={result}
            loading={loading}
            error={error}
          />
          <FillBreakdown result={result} loading={loading} />
        </aside>
      </div>

      {/* Fixed bottom-left venue status */}
      <VenueStatus venueStatus={book?.venueStatus} />
    </div>
  );
}
