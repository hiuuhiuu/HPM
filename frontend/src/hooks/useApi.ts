import { useEffect, useRef, useState } from 'react';

// 상대경로 사용: nginx가 /api/, /otlp/ 를 백엔드로 프록시
// REACT_APP_API_URL은 개발환경(localhost:9700)에서만 설정 필요
const BASE_URL = process.env.REACT_APP_API_URL || '';

/** 동일 메시지를 30초 내 재발행 억제 */
const _errorLastSeen = new Map<string, number>();
const ERROR_DEDUP_MS = 30_000;

/** 글로벌 API 에러 이벤트 발행 (App.tsx의 Toast가 수신) */
export function notifyApiError(message: string): void {
  const now = Date.now();
  const last = _errorLastSeen.get(message);
  if (last && now - last < ERROR_DEDUP_MS) return;
  // 만료된 항목 정리 (Map 무한 증가 방지)
  _errorLastSeen.forEach((ts, key) => { if (now - ts >= ERROR_DEDUP_MS) _errorLastSeen.delete(key); });
  _errorLastSeen.set(message, now);
  window.dispatchEvent(new CustomEvent('api-error', { detail: message }));
}

/** HTTP 오류 응답에서 상태코드 + 응답 내용을 포함한 Error를 생성 */
async function toApiError(res: Response): Promise<Error> {
  let detail = '';
  try {
    const body = await res.json();
    detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body);
  } catch {
    detail = await res.text().catch(() => '');
  }
  const msg = detail ? `API 오류: ${res.status} - ${detail}` : `API 오류: ${res.status}`;
  return new Error(msg);
}

export async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

/** 파괴적 관리자 API에 사용되는 localStorage 키. Settings 화면에서 설정한다. */
export const ADMIN_API_KEY_STORAGE = 'hamster_admin_api_key';

export async function apiDelete(path: string): Promise<void> {
  const headers: Record<string, string> = {};
  try {
    const key = localStorage.getItem(ADMIN_API_KEY_STORAGE);
    if (key) headers['X-Admin-API-Key'] = key;
  } catch { /* localStorage 접근 실패 시 무시 */ }
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers });
  if (!res.ok) throw await toApiError(res);
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await toApiError(res);
  return res.json();
}

/** 데이터를 주기적으로 폴링하는 범용 훅 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  intervalMs: number = 30_000,
  deps: unknown[] = [],
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const fetcherRef = useRef(fetcher);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // 렌더링마다 최신 fetcher를 ref에 동기화
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const result = await fetcherRef.current();
        if (!cancelled) {
          setData(result);
          setError(null);
          setLastUpdated(new Date());
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message);
          notifyApiError(e.message);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    timerRef.current = setInterval(load, intervalMs);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs]);

  return { data, loading, error, lastUpdated };
}

/** 입력값 변경 후 일정 시간이 지나면 값을 확정하는 훅 */
export function useDebounce<T>(value: T, delayMs: number = 400): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
