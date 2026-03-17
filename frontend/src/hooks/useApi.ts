import { useEffect, useRef, useState } from 'react';

// 상대경로 사용: nginx가 /api/, /otlp/ 를 백엔드로 프록시
// REACT_APP_API_URL은 개발환경(localhost:3000)에서만 설정 필요
const BASE_URL = process.env.REACT_APP_API_URL || '';

/** 글로벌 API 에러 이벤트 발행 (App.tsx의 Toast가 수신) */
export function notifyApiError(message: string): void {
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

export async function apiDelete(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}${path}`, { method: 'DELETE' });
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
