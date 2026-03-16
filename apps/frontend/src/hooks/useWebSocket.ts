import { useState, useEffect, useRef, useCallback } from "react";

const WS_URL = `ws://${window.location.hostname}:3001/ws`;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 2000;
const HEARTBEAT_INTERVAL_MS = 25000;

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

export interface BookData {
  bids: BookLevel[];
  asks: BookLevel[];
  [key: string]: unknown;
}

export interface BookLevel {
  price: number;
  size: number;
  sources: Record<string, number>;
  [key: string]: unknown;
}

interface WsMessage {
  type: "snapshot" | "update" | "pong" | string;
  data?: BookData;
}

export interface UseWebSocketReturn {
  book: BookData | null;
  connectionState: ConnectionState;
  lastUpdateTime: number | null;
}

/**
 * useWebSocket — manages the WebSocket lifecycle for the aggregated order book.
 *
 * Connects on mount, handles "snapshot" and "update" message types,
 * reconnects with a fixed 2s delay up to 5 attempts, and sends
 * periodic heartbeat pings to keep the connection alive.
 */
export function useWebSocket(): UseWebSocketReturn {
  const [book, setBook] = useState<BookData | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [lastUpdateTime, setLastUpdateTime] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef<number>(0);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guard against connecting after unmount
  const mountedRef = useRef<boolean>(true);

  const clearTimers = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const connectWs = useCallback(() => {
    if (!mountedRef.current) return;

    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.onopen = null;
      wsRef.current.onmessage = null;
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
    }

    setConnectionState("connecting");

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      if (!mountedRef.current) return;
      setConnectionState("connected");
      attemptRef.current = 0;

      // Start heartbeat pings every 25s
      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, HEARTBEAT_INTERVAL_MS);
    };

    ws.onmessage = (event: MessageEvent) => {
      if (!mountedRef.current) return;
      try {
        const msg: WsMessage = JSON.parse(event.data as string);
        if (msg.type === "snapshot" || msg.type === "update") {
          setBook(msg.data as BookData);
          setLastUpdateTime(Date.now());
        }
      } catch {
        // Ignore malformed messages
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      clearTimers();
      scheduleReconnect();
    };

    ws.onerror = () => {
      // onclose will fire after this, which handles reconnection
    };
  }, [clearTimers]);

  const scheduleReconnect = useCallback(() => {
    if (!mountedRef.current) return;

    attemptRef.current++;
    if (attemptRef.current > MAX_RECONNECT_ATTEMPTS) {
      setConnectionState("error");
      return;
    }

    setConnectionState("disconnected");
    reconnectTimerRef.current = setTimeout(() => {
      connectWs();
    }, RECONNECT_DELAY_MS);
  }, [connectWs]);

  useEffect(() => {
    mountedRef.current = true;
    connectWs();

    return () => {
      mountedRef.current = false;
      clearTimers();
      if (wsRef.current) {
        wsRef.current.onopen = null;
        wsRef.current.onmessage = null;
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connectWs, clearTimers]);

  return { book, connectionState, lastUpdateTime };
}
