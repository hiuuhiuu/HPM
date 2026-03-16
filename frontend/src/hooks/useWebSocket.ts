import { useState, useEffect, useCallback, useRef } from 'react';

// ── 공통: WS URL 빌더 ──────────────────────────────────────
function buildWsUrl(path: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const apiUrl = process.env.REACT_APP_API_URL || '';
  if (apiUrl) {
    const origin = new URL(apiUrl).origin;
    const wsProtocol = origin.startsWith('https') ? 'wss:' : 'ws:';
    const host = origin.replace(/^https?:\/\//, '');
    return `${wsProtocol}//${host}${path}`;
  }
  return `${protocol}//${window.location.host}${path}`;
}

interface DashboardStats {
  unresolved: number;
  activeAlerts: number;
  isConnected: boolean;
}

export function useDashboardWebSocket(url: string = '/ws/dashboard'): DashboardStats {
  const [unresolved, setUnresolved] = useState<number>(0);
  const [activeAlerts, setActiveAlerts] = useState<number>(0);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    const fullUrl = buildWsUrl(url);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }
    const ws = new WebSocket(fullUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WebSocket] Connected to Dashboard');
      setIsConnected(true);
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'init' || data.type === 'update') {
          if (data.unresolved !== undefined) {
            setUnresolved(data.unresolved);
          }
          if (data.active_alerts !== undefined) {
            setActiveAlerts(data.active_alerts);
          }
        }
      } catch (e) {
        console.error('[WebSocket] Error parsing message:', e);
      }
    };

    ws.onclose = () => {
      console.log('[WebSocket] Disconnected from Dashboard');
      setIsConnected(false);
      wsRef.current = null;
      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = (error) => {
      console.error('[WebSocket] Error:', error);
      ws.close(); // Force close to trigger reconnect
    };
  }, [url]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return { unresolved, activeAlerts, isConnected };
}

// ── 메트릭 실시간 스트리밍 훅 ──────────────────────────────

export interface LiveMetric {
  cpu: number | null;
  memory_used_mb: number | null;
  memory_max_mb: number | null;
  threads: number | null;
  avg_response_ms: number;
  tps: number;
  error_rate: number;
  request_count_5m: number;
  error_count_5m: number;
}

export interface MetricsSnapshot {
  ts: number;
  services: Record<string, LiveMetric>;
}

export function useMetricsStream(): { snapshot: MetricsSnapshot | null; isConnected: boolean } {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    const fullUrl = buildWsUrl('/ws/metrics');
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(fullUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'metrics_snapshot') {
          setSnapshot(data as MetricsSnapshot);
        }
      } catch { /* 무시 */ }
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;
      reconnectRef.current = setTimeout(connect, 5000);
    };

    ws.onerror = () => ws.close();
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  return { snapshot, isConnected };
}
