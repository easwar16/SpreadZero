# SpreadZero

**Real-time prediction market order book aggregator**

SpreadZero pulls live order book data from Polymarket and Kalshi, normalizes it into a common schema, merges the two books into a unified view, and streams the result to a browser UI over WebSocket. The combined book shows where liquidity sits across both venues with per-venue breakdowns at every price level. A quote calculator lets you enter a dollar amount and see how many shares you'd receive, split across venues, before placing any order.

---

## Features

- **Combined order book** merging Polymarket and Kalshi with per-venue source attribution
- **Real-time price chart** tracking midpoint over time with change indicators
- **Depth chart** showing cumulative liquidity on each side
- **Price grouping** (1c/5c/10c) to aggregate levels into wider buckets
- **Venue toggle** — switch between Combined / Polymarket-only / Kalshi-only views
- **Quote calculator** with cross-venue fill simulation, potential payout, and ROI projection
- **Venue routing breakdown** showing how fills split across venues with price edge detection
- **Manual Kalshi pairing** — link any Polymarket market to a Kalshi ticker, persisted to disk
- **Auto market matching** — text-similarity matching with order book validation to filter dead matches
- **Market stats bar** — YES/NO prices, spread, midpoint, bid/ask depth, total liquidity
- **Venue health indicators** — live, stale, or disconnected with auto-reconnection
- **Graceful degradation** — continues with one venue if the other drops

---

## Architecture

```
Polymarket WS ──────┐
                     ├──→ Node.js Backend (3 worker threads)
Kalshi REST ────────┘         │
                              ├──→ Thread 1: Polymarket WS client
                              ├──→ Thread 2: Kalshi REST poller (3s interval)
                              └──→ Thread 3: Aggregator (60fps merge via SharedArrayBuffer)
                                        │
                                        └──→ WS Server ──→ React Frontend
```

The backend uses three worker threads sharing a `SharedArrayBuffer` for zero-copy data passing. The aggregator thread polls both venue buffers at 60fps and posts merged books to the main thread, which broadcasts to connected WebSocket clients.

**Why a backend?** Kalshi requires signed API authentication that can't live in a browser. Polymarket's CLOB WebSocket has CORS restrictions. The aggregation logic — normalizing two different order book models, applying deltas, tracking staleness — is state management that belongs server-side.

---

## Tech Stack

| Frontend | Backend |
|----------|---------|
| React 18 | Node.js + TypeScript |
| Vite | Express |
| Tailwind CSS | ws (WebSocket server) |
| SVG charts | SharedArrayBuffer + Worker Threads |

---

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm

### Installation

```bash
git clone <repo-url>
cd SpreadZero
pnpm install
```

### Configuration

```bash
cp apps/backend/.env.example apps/backend/.env
```

Edit `apps/backend/.env` — the only required field is `KALSHI_TICKER` if you want Kalshi data on startup. Polymarket markets are fetched automatically from the Gamma API.

For Kalshi API access, you need an API key from [kalshi.com](https://kalshi.com) → Settings → API Keys.

### Running

```bash
# Both frontend + backend via Turborepo
pnpm dev
```

Or separately:

```bash
# Terminal 1
cd apps/backend && pnpm dev

# Terminal 2
cd apps/frontend && pnpm dev
```

Open [http://localhost:5173](http://localhost:5173).

### Pairing Markets

Polymarket markets load automatically. To add Kalshi data:

1. Use the **Kalshi** input in the header bar
2. Enter a Kalshi ticker (e.g. `KX2028DRUN-28-ZMAM`)
3. Click **Link** — the backend starts polling that ticker and Kalshi data flows into the aggregated book
4. Pairings persist across restarts in `data/pairings.json`

---

## Key Design Decisions

**Kalshi's reciprocal book model**

Kalshi binary markets don't return asks. They return bids for YES and bids for NO. A NO bid at $0.54 is economically identical to a YES ask at $0.46 (they sum to $1.00). The normalizer reconstructs the full YES book: `yes_ask_price = 1.0 - no_bid_price`.

**Normalizing to a common schema early**

All venue data is transformed into `Map<priceString, size>` in `normalizer.ts` before reaching the aggregator. The aggregator merges Maps without knowing which venue produced them.

**Two-phase market loading**

Phase 1 fetches the first page of Polymarket (~200ms) and starts the server immediately. Phase 2 runs in the background — fetching all pages from both APIs, text-matching, and validating Kalshi order books. Data streams to the frontend within ~1 second of startup.

**Order book validation for auto-matches**

After text-similarity matching, each candidate Kalshi ticker is checked for a non-empty order book. This prevents false "paired" badges on markets where Kalshi has no liquidity.

**SharedArrayBuffer for inter-thread communication**

The three worker threads communicate via a shared buffer with atomic operations. No serialization overhead — the aggregator reads venue data directly from memory at 60fps.

---

## Assumptions & Tradeoffs

- **Quote is indicative only.** The fill simulation walks the current book assuming static state. No real orders are placed.

- **Cross-venue price differences are real.** Polymarket and Kalshi often price the same event differently. The aggregated book surfaces these as arbitrage opportunities rather than filtering them.

- **Kalshi polling at 3s.** Kalshi's public REST endpoint is used (no WebSocket auth complexity). This means Kalshi data is up to 3 seconds stale vs Polymarket's real-time WebSocket.

- **Manual pairing required for most markets.** Automated text matching finds some overlaps, but the two platforms structure markets differently. Manual pairing gives the user full control over which markets are linked.

- **Session-only price history.** The price chart tracks midpoint from the live feed — no historical data API is used. History resets on market/venue switch.

---

## What I'd Improve With More Time

- **Kalshi WebSocket integration** — use authenticated WebSocket for real-time Kalshi data instead of 3s REST polling
- **Historical price data** — integrate with a price history API for charts beyond the current session
- **Smart order routing** — account for venue-specific fees when calculating optimal fill splits
- **Price impact visualization** — overlay projected midpoint shift on the depth chart for a given order size
- **Unit tests for the normalizer** — the reciprocal reconstruction and delta application are the most fragile logic
- **Sequence gap recovery** — buffer out-of-order Kalshi deltas during resync instead of dropping them

---

## API Reference

### REST

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Server uptime and venue status |
| `GET` | `/api/markets` | All markets with pairing info |
| `POST` | `/api/markets/:id/select` | Switch active market |
| `POST` | `/api/markets/:id/pair` | Link/unlink Kalshi ticker `{ kalshiTicker }` |
| `GET` | `/api/orderbook` | Current aggregated book |
| `GET` | `/api/quote?side=yes&amount=100` | Fill simulation |

### WebSocket

```
ws://localhost:3001/ws
```

Sends `snapshot` on connect, then `update` messages as the book changes.

---

## License

MIT
