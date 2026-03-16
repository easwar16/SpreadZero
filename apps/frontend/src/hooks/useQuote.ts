import { useState, useEffect, useRef } from "react";

type Side = "yes" | "no";

export interface QuoteResult {
  [key: string]: unknown;
}

export interface UseQuoteReturn {
  amount: string;
  setAmount: React.Dispatch<React.SetStateAction<string>>;
  side: Side;
  setSide: React.Dispatch<React.SetStateAction<Side>>;
  result: QuoteResult | null;
  loading: boolean;
  error: string | null;
}

/**
 * useQuote — fetches a fill quote from the backend with 500ms debounce.
 *
 * Re-fetches when amount, side, or marketId changes.
 * Clears stale results immediately on market switch.
 */
export function useQuote(marketId: string | null): UseQuoteReturn {
  const [amount, setAmount] = useState<string>("");
  const [side, setSide] = useState<Side>("yes");
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevMarketRef = useRef<string | null>(marketId);

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
        const data: QuoteResult = await res.json();
        setResult(data);
        setError(null);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Quote failed";
        setError(message);
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
