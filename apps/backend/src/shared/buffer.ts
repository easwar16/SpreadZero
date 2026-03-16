/**
 * buffer.ts — SharedArrayBuffer layout shared between all three worker threads.
 *
 * Layout:
 *   [0..63]     Int32 header (16 slots × 4 bytes)
 *   [64..1663]  Polymarket bids  — MAX_LEVELS × 16 bytes (price f64, size f64)
 *   [1664..3263] Polymarket asks
 *   [3264..4863] Kalshi bids
 *   [4864..6463] Kalshi asks
 *
 * Writers (polymarket/kalshi workers) atomically increment their SEQ after
 * writing a full snapshot. The aggregator worker detects the change by
 * polling SEQ values.
 */

// ---- Header slots (Int32Array indices) ----

export const HDR = {
  POLY_SEQ:        0,  // incremented by polymarket worker on each publish
  KS_SEQ:          1,  // incremented by kalshi worker on each publish
  POLY_STATUS:     2,  // 0=disconnected 1=live 2=stale
  KS_STATUS:       3,
  POLY_BID_COUNT:  4,  // number of levels currently written
  POLY_ASK_COUNT:  5,
  KS_BID_COUNT:    6,
  KS_ASK_COUNT:    7,
} as const;

export const STATUS = { DISCONNECTED: 0, LIVE: 1, STALE: 2 } as const;

// ---- Geometry ----

export const MAX_LEVELS   = 100;
const HEADER_BYTES        = 64;   // 16 × Int32, padded to cache-line boundary
const LEVEL_BYTES         = 16;   // price(f64=8B) + size(f64=8B)
const SECTION_BYTES       = MAX_LEVELS * LEVEL_BYTES; // 1600 bytes per section

export const SECTION = {
  POLY_BIDS: HEADER_BYTES,
  POLY_ASKS: HEADER_BYTES + SECTION_BYTES,
  KS_BIDS:   HEADER_BYTES + SECTION_BYTES * 2,
  KS_ASKS:   HEADER_BYTES + SECTION_BYTES * 3,
} as const;

export const BUFFER_SIZE = HEADER_BYTES + SECTION_BYTES * 4; // 6464 bytes

// ---- Primitive types ----

export interface RawLevel {
  price: number;
  size: number;
}

// ---- Read / Write helpers ----

/**
 * Write sorted price levels into a section of the SharedArrayBuffer.
 * Does NOT bump SEQ — caller must do that after all sections are written.
 */
export function writeLevels(
  buf: SharedArrayBuffer,
  sectionByteOffset: number,
  levels: RawLevel[]
): void {
  const f64 = new Float64Array(buf);
  const n = Math.min(levels.length, MAX_LEVELS);
  for (let i = 0; i < n; i++) {
    const idx = (sectionByteOffset + i * LEVEL_BYTES) / 8;
    f64[idx]     = levels[i].price;
    f64[idx + 1] = levels[i].size;
  }
}

/**
 * Read `count` price levels from a section of the SharedArrayBuffer.
 */
export function readLevels(
  buf: SharedArrayBuffer,
  sectionByteOffset: number,
  count: number
): RawLevel[] {
  const f64 = new Float64Array(buf);
  const n = Math.min(count, MAX_LEVELS);
  const result: RawLevel[] = [];
  for (let i = 0; i < n; i++) {
    const idx = (sectionByteOffset + i * LEVEL_BYTES) / 8;
    result.push({ price: f64[idx], size: f64[idx + 1] });
  }
  return result;
}

/**
 * Convert a price→size Map into a sorted RawLevel array.
 * bids: descending price. asks: ascending price.
 */
export function mapToLevels(
  map: Map<string, number>,
  side: "bids" | "asks"
): RawLevel[] {
  const levels = Array.from(map.entries()).map(([p, s]) => ({
    price: parseFloat(p),
    size: s,
  }));
  if (side === "bids") levels.sort((a, b) => b.price - a.price);
  else                  levels.sort((a, b) => a.price - b.price);
  return levels.slice(0, MAX_LEVELS);
}
