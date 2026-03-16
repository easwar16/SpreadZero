import { useState, useEffect, useRef } from "react";

/**
 * useQuote — fetches a fill quote from the backend with 500ms debounce.
 *
 * Re-fetches when amount, side, or marketId changes.
 * Clears stale results immediately on market switch.
 */
export function useQuote(marketId) {
  const [amount, setAmount] = useState("");
  const [side, setSide] = useState("yes");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);
  const prevMarketRef = useRef(marketId);

  // Clear stale result immediately when market changes
  useEffect(() => {
    if (prevMarketRef.current !== marketId) {
      prevMarketRef.current = marketId;
      setResult(null);
      setError(null);
    }
  }, [marketId]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      setResult(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    timerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/quote?amount=${encodeURIComponent(numAmount)}&side=${encodeURIComponent(side)}`
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data = await res.json();
        setResult(data);
        setError(null);
      } catch (err) {
        setError(err.message || "Quote failed");
        setResult(null);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [amount, side, marketId]);

  return { amount, setAmount, side, setSide, result, loading, error };
}
