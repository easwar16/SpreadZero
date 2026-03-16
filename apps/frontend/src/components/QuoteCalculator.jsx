import { formatDollars, formatCents } from "../utils/format";

const QUICK_AMOUNTS = [10, 50, 200, 1000];

/**
 * QuoteCalculator — informative trade simulation panel.
 * Shows input, quick amounts, fill stats, payout projection, and venue split.
 */
export default function QuoteCalculator({ amount, setAmount, side, setSide, result, loading, error }) {
  const numAmount = parseFloat(amount) || 0;

  // Potential payout: each share pays $1 if correct
  const potentialPayout = result ? result.shares : 0;
  const potentialProfit = result ? result.shares - result.totalCost : 0;
  const roi = result && result.totalCost > 0
    ? ((potentialProfit / result.totalCost) * 100).toFixed(1)
    : null;

  const slippage = result
    ? Math.abs(result.avgFillPrice - (result.fills?.[0]?.avgPrice || result.avgFillPrice)) * 100
    : null;

  return (
    <div className="space-y-3">
      {/* Side toggle */}
      <div className="flex rounded-lg overflow-hidden border border-[#2a3040]">
        <button
          onClick={() => setSide("yes")}
          className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wide transition-all duration-150 ${
            side === "yes"
              ? "bg-[#00c87a] text-white"
              : "bg-[#12141a] text-[#4a4a5a] hover:text-[#7a7a8a]"
          }`}
        >
          Buy Yes
        </button>
        <button
          onClick={() => setSide("no")}
          className={`flex-1 py-2.5 text-xs font-bold uppercase tracking-wide transition-all duration-150 ${
            side === "no"
              ? "bg-[#f0364a] text-white"
              : "bg-[#12141a] text-[#4a4a5a] hover:text-[#7a7a8a]"
          }`}
        >
          Buy No
        </button>
      </div>

      {/* Amount input + quick buttons */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-[11px] text-[#64748b] font-medium">Amount</label>
          {numAmount > 0 && (
            <button
              onClick={() => setAmount("")}
              className="text-[10px] text-[#64748b] hover:text-[#9090a8] transition-colors"
            >
              Clear
            </button>
          )}
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#4a4a5a] font-mono">$</span>
          <input
            type="number"
            min="1"
            step="1"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full bg-[#12141a] border border-[#2a3040] rounded-lg pl-7 pr-3 py-2.5 text-base font-mono font-semibold text-[#e2e8f0] placeholder-[#2a2a3a] outline-none focus:border-[#4a4a5a] transition-colors"
          />
        </div>
        <div className="flex gap-1.5 mt-2">
          {QUICK_AMOUNTS.map((q) => (
            <button
              key={q}
              onClick={() => setAmount(String(numAmount + q))}
              className="flex-1 py-1.5 text-[11px] font-mono font-medium text-[#9090a8] bg-[#12141a] border border-[#2a3040] rounded-md hover:border-[#4a4a5a] hover:text-[#e2e8f0] transition-colors"
            >
              +${q}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && !result && (
        <div className="animate-subtle-pulse py-4 text-center text-xs text-[#4a4a5a]">
          Simulating fill...
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="border border-[#f0364a]/20 rounded-lg px-3 py-2">
          <p className="text-[11px] text-[#f0364a]">Quote failed — is the server running?</p>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className={`space-y-3 ${loading ? "animate-subtle-pulse" : ""}`}>
          {/* Fill summary */}
          <div className="bg-[#12141a] border border-[#2a3040] rounded-lg p-3 space-y-2">
            <Row label="Avg Price" value={formatCents(result.avgFillPrice)} />
            <Row label="Shares" value={result.shares.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
            <Row label="Total Cost" value={formatDollars(result.totalCost)} />
            <Row
              label="Price Impact"
              value={slippage !== null ? `${slippage.toFixed(2)}¢` : "—"}
              warn={slippage > 0.5}
            />
          </div>

          {/* Payout projection */}
          <div className="bg-[#12141a] border border-[#2a3040] rounded-lg p-3 space-y-2">
            <Row
              label="If you win"
              value={formatDollars(potentialPayout)}
              highlight
            />
            <Row
              label="Profit"
              value={`${potentialProfit >= 0 ? "+" : ""}${formatDollars(potentialProfit)}`}
              color={potentialProfit >= 0 ? "#00c87a" : "#f0364a"}
            />
            {roi !== null && (
              <Row
                label="ROI"
                value={`${roi}%`}
                color={potentialProfit >= 0 ? "#00c87a" : "#f0364a"}
              />
            )}
          </div>

          {/* Partial fill warning */}
          {result.partialFill && (
            <div className="border border-[#f59e0b]/20 rounded-lg px-3 py-2">
              <span className="text-[11px] text-[#f59e0b] leading-relaxed">
                Partial fill — book only has {formatDollars(result.totalCost)} of{" "}
                {formatDollars(result.inputAmount)} liquidity on this side.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, highlight = false, warn = false, color }) {
  let valueColor = "#9090a8";
  if (highlight) valueColor = "#e2e8f0";
  if (warn) valueColor = "#f59e0b";
  if (color) valueColor = color;

  return (
    <div className="flex justify-between items-center">
      <span className="text-[11px] text-[#64748b]">{label}</span>
      <span
        className="text-xs font-mono tabular-nums font-medium"
        style={{ color: valueColor }}
      >
        {value}
      </span>
    </div>
  );
}
