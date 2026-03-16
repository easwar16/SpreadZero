import { useState, useEffect, useCallback } from "react";

export interface Market {
  id: string;
  kalshiTicker?: string;
  [key: string]: unknown;
}

interface MarketsApiResponse {
  markets: Market[];
  activeId: string | null;
}

export interface UseMarketsReturn {
  markets: Market[];
  activeMarket: Market | null;
  activeId: string | null;
  selectMarket: (id: string) => Promise<void>;
  pairKalshi: (marketId: string, kalshiTicker: string) => Promise<void>;
  loading: boolean;
}

/**
 * useMarkets — fetches available mock markets and handles switching.
 *
 * On mount, fetches GET /api/markets to get the list and active market.
 * Exposes selectMarket() which POSTs to switch and updates local state.
 */
export function useMarkets(): UseMarketsReturn {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    fetch("/api/markets")
      .then((res) => res.json())
      .then((data: MarketsApiResponse) => {
        setMarkets(data.markets || []);
        setActiveId(data.activeId);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const selectMarket = useCallback(
    async (id: string): Promise<void> => {
      if (id === activeId) return;

      try {
        const res = await fetch(`/api/markets/${id}/select`, {
          method: "POST",
        });
        if (res.ok) {
          setActiveId(id);
        }
      } catch {
        // Silently fail — book will update via WebSocket when backend switches
      }
    },
    [activeId]
  );

  const pairKalshi = useCallback(
    async (marketId: string, kalshiTicker: string): Promise<void> => {
      try {
        const res = await fetch(`/api/markets/${marketId}/pair`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kalshiTicker }),
        });
        if (res.ok) {
          setMarkets((prev) =>
            prev.map((m) =>
              m.id === marketId ? { ...m, kalshiTicker } : m
            )
          );
        }
      } catch {
        // Silently fail
      }
    },
    []
  );

  const activeMarket = markets.find((m) => m.id === activeId) || null;

  return { markets, activeMarket, activeId, selectMarket, pairKalshi, loading };
}
