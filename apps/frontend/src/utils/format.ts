/**
 * format.ts — Number formatting utilities for the trading UI.
 */

/** Format price to 4 decimal places: 0.6423 → "0.6423" */
export function formatPrice(price: number | string): string {
  return Number(price).toFixed(4);
}

/** Format price as cents: 0.6423 → "64.2¢" */
export function formatCents(price: number | string): string {
  return `${(Number(price) * 100).toFixed(1)}¢`;
}

/** Format size with comma separators: 12345 → "12,345" */
export function formatSize(size: number | string): string {
  return Math.round(Number(size)).toLocaleString("en-US");
}

/** Format dollar amount: 1234.56 → "$1,234.56" */
export function formatDollars(amount: number | string): string {
  return `$${Number(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format time since last update.
 *   < 5s  → "just now"
 *   5–30s → "Xs ago"
 *   > 30s → exact time "HH:MM:SS"
 */
export function formatTimeSince(isoString: string | null | undefined): string {
  if (!isoString) return "never";

  const then = new Date(isoString).getTime();
  const elapsed = Date.now() - then;

  if (elapsed < 5000) return "just now";
  if (elapsed <= 30000) return `${Math.floor(elapsed / 1000)}s ago`;

  // Show exact time for stale data
  const d = new Date(isoString);
  return d.toLocaleTimeString("en-US", { hour12: false });
}
