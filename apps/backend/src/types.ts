/** Single price level in the aggregated order book */
export interface PriceLevel {
  price: number;
  size: number;
  sources: {
    polymarket: number;
    kalshi: number;
  };
}

/** Status of a single venue connection */
export interface VenueConnectionStatus {
  status: "live" | "stale" | "disconnected";
  lastUpdate: string | null;
  isMock: boolean;
}

/** Active market metadata included in book updates */
export interface MarketInfo {
  id: string;
  title: string;
  category: string;
}

/** Full aggregated order book sent to clients */
export interface AggregatedBook {
  market: MarketInfo;
  bids: PriceLevel[];
  asks: PriceLevel[];
  spread: number;
  midpoint: number;
  venueStatus: {
    polymarket: VenueConnectionStatus;
    kalshi: VenueConnectionStatus;
  };
  timestamp: string;
}

/** Normalized book from a single venue — Maps keyed by price string */
export interface VenueBook {
  bids: Map<string, number>;
  asks: Map<string, number>;
}

/** Polymarket WS snapshot message */
export interface PolymarketBookMessage {
  type?: string;
  event_type?: string;
  bids?: Array<{ price: string; size: string }>;
  asks?: Array<{ price: string; size: string }>;
}

/** Polymarket WS delta item */
export interface PolymarketDelta {
  asset_id?: string;
  side: "BUY" | "SELL";
  price: string;
  size: string;
}

/** Polymarket WS price_change event */
export interface PolymarketPriceChangeMessage {
  type?: string;
  event_type?: string;
  changes?: PolymarketDelta[];
  data?: PolymarketDelta[];
}

/** Kalshi WS orderbook_snapshot message */
export interface KalshiSnapshotMessage {
  type?: string;
  msg_type?: string;
  yes_dollars_fp?: [string, string][];
  no_dollars_fp?: [string, string][];
  seq?: number;
}

/** Kalshi WS orderbook_delta message */
export interface KalshiDeltaMessage {
  type?: string;
  msg_type?: string;
  price_dollars: string;
  delta_fp: string;
  side: "yes" | "no";
  seq?: number;
}

/** DFlow REST orderbook response */
export interface DFlowOrderbookResponse {
  yes_bids?: Record<string, number>;
  no_bids?: Record<string, number>;
  sequence?: number;
}

/** DFlow WS message */
export interface DFlowWsMessage {
  type?: string;
  event?: string;
  data?: DFlowOrderbookResponse;
}

/** Internal venue tracking state */
export interface VenueState {
  book: VenueBook | null;
  lastUpdate: Date | null;
  status: "live" | "stale" | "disconnected";
  isMock: boolean;
}

export type VenueName = "polymarket" | "kalshi";

// ---------------------------------------------------------------------------
// Polymarket Gamma API response types
// ---------------------------------------------------------------------------

/** A market from the Polymarket Gamma API (camelCase response) */
export interface GammaMarket {
  id: string;
  conditionId: string;
  question: string;
  description?: string;
  slug?: string;
  outcomes?: string;           // JSON string: '["Yes", "No"]'
  outcomePrices?: string;      // JSON string: '["0.63", "0.37"]'
  clobTokenIds?: string;       // JSON string: '["token1", "token2"]'
  enableOrderBook?: boolean;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  volume?: string;
  volumeNum?: number;
  liquidity?: string;
  liquidityNum?: number;
  image?: string;
  icon?: string;
  endDate?: string;
  groupItemTitle?: string;
}

/** Normalized market used within our application */
export interface Market {
  id: string;              // condition_id
  title: string;           // question
  category: string;        // first tag or "Uncategorized"
  midpoint: number;        // Yes token price
  tokenId: string;         // Yes token's token_id for WS subscription
  volatility: number;      // synthetic volatility based on price distance from 0.5
  polymarketSlug?: string;
  kalshiTicker?: string;
}

/** Quote request result */
export interface QuoteResult {
  inputAmount: number;
  side: string;
  shares: number;
  avgFillPrice: number;
  fills: Array<{
    venue: string;
    shares: number;
    avgPrice: number;
    cost: number;
  }>;
  totalCost: number;
  partialFill: boolean;
  remainingUnfilled: number;
}
