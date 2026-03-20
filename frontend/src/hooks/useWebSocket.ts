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

// ── 지수 백오프 헬퍼 ───────────────────────────────────────
// 재시도 횟수에 따라 대기시간을 늘려 404 반복 로그 스팸을 방지한다.
// 0회: 3s, 1회: 6s, 2회: 12s, ... 최대 300s(5분)
function backoffDelay(retryCount: number, base = 3000, max = 300_000): number {
  return Math.min(base * Math.pow(2, retryCount), max);
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
  const retryCountRef = useRef<number>(0);

  const connect = useCallback(() => {
    const fullUrl = buildWsUrl(url);
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }
    const ws = new WebSocket(fullUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WebSocket] Connected to Dashboard');
      retryCountRef.current = 0;   // 연결 성공 시 재시도 카운터 리셋
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
          if (data.unresolved !== undefined) setUnresolved(data.unresolved);
          if (data.active_alerts !== undefined) setActiveAlerts(data.active_alerts);
        }
      } catch (e) {
        console.error('[WebSocket] Error parsing message:', e);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;
      const delay = backoffDelay(retryCountRef.current);
      console.warn(`[WebSocket] Dashboard disconnected. Reconnecting in ${delay / 1000}s (retry #${retryCountRef.current + 1})`);
      retryCountRef.current += 1;
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    ws.onerror = (error) => {
      console.error('[WebSocket] Dashboard error:', error);
      ws.close();
    };
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (wsRef.current) wsRef.current.close();
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

// SSE 폴백 임계치: WS 연결이 이 횟수 이상 실패하면 SSE로 전환
const WS_MAX_RETRY = 3;

export function useMetricsStream(): { snapshot: MetricsSnapshot | null; isConnected: boolean } {
  const [snapshot, setSnapshot] = useState<MetricsSnapshot | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const reconnectRef = useRef<NodeJS.Timeout | null>(null);
  const retryCountRef = useRef<number>(0);
  const sseActiveRef = useRef<boolean>(false);

  // SSE 모드로 전환: EventSource('/api/metrics/stream') 연결
  const connectSSE = useCallback(() => {
    if (sseRef.current) return; // 이미 연결됨
    console.info('[Metrics] Switching to SSE fallback (/api/metrics/stream)');
    sseActiveRef.current = true;

    const es = new EventSource('/api/metrics/stream');
    sseRef.current = es;

    es.onopen = () => {
      console.info('[SSE] /api/metrics/stream connected');
      setIsConnected(true);
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'metrics_snapshot') {
          setSnapshot(data as MetricsSnapshot);
        }
      } catch { /* 무시 */ }
    };

    es.onerror = () => {
      // EventSource는 자체 재연결을 수행하므로 별도 retry 로직 불필요
      setIsConnected(false);
      console.warn('[SSE] /api/metrics/stream connection error — browser will retry automatically');
    };
  }, []);

  const connect = useCallback(() => {
    // SSE 모드가 이미 활성화된 경우 WS 시도 생략
    if (sseActiveRef.current) return;

    const fullUrl = buildWsUrl('/ws/metrics');
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(fullUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      retryCountRef.current = 0;   // 연결 성공 시 재시도 카운터 리셋
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
      retryCountRef.current += 1;

      if (retryCountRef.current >= WS_MAX_RETRY) {
        // WS 연결 3회 실패 → SSE 폴백으로 전환
        console.warn(`[WebSocket] /ws/metrics failed ${retryCountRef.current} times — switching to SSE fallback`);
        connectSSE();
        return;
      }

      const delay = backoffDelay(retryCountRef.current - 1);
      console.warn(`[WebSocket] /ws/metrics disconnected. Reconnecting in ${delay / 1000}s (retry #${retryCountRef.current})`);
      reconnectRef.current = setTimeout(connect, delay);
    };

    ws.onerror = () => ws.close();
  }, [connectSSE]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) wsRef.current.close();
      if (sseRef.current) { sseRef.current.close(); sseRef.current = null; }
    };
  }, [connect]);

  return { snapshot, isConnected };
}
