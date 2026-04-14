import { useCallback, useEffect, useState } from 'react';

/**
 * 타입 안전한 localStorage 훅.
 *
 * - 초기값을 스토리지에서 읽되 파싱 실패/접근 실패 시 defaultValue 사용
 * - setValue는 같은 탭에서의 다른 훅 인스턴스까지 즉시 갱신하기 위해
 *   커스텀 이벤트('hamster-storage')를 디스패치한다
 * - 다른 탭(브라우저 storage 이벤트) 동기화도 지원
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  deserializer: (raw: string) => T = JSON.parse,
  serializer: (value: T) => string = JSON.stringify,
): [T, (value: T | ((prev: T) => T)) => void, () => void] {
  const read = useCallback((): T => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return defaultValue;
      return deserializer(raw);
    } catch {
      return defaultValue;
    }
  }, [key, defaultValue, deserializer]);

  const [value, setLocal] = useState<T>(read);

  const setValue = useCallback((next: T | ((prev: T) => T)) => {
    setLocal(prev => {
      const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
      try {
        localStorage.setItem(key, serializer(resolved));
        window.dispatchEvent(new CustomEvent('hamster-storage', { detail: key }));
      } catch { /* 쿼터 초과 등은 무시 */ }
      return resolved;
    });
  }, [key, serializer]);

  const remove = useCallback(() => {
    try {
      localStorage.removeItem(key);
      window.dispatchEvent(new CustomEvent('hamster-storage', { detail: key }));
    } catch { /* 접근 실패 무시 */ }
    setLocal(defaultValue);
  }, [key, defaultValue]);

  // 다른 컴포넌트/탭에서 같은 키를 변경하면 재동기화
  useEffect(() => {
    const handler = (e: Event) => {
      if (e instanceof StorageEvent) {
        if (e.key !== null && e.key !== key) return;
      } else if (e instanceof CustomEvent) {
        if (e.detail && e.detail !== key) return;
      }
      setLocal(read());
    };
    window.addEventListener('storage', handler);
    window.addEventListener('hamster-storage', handler as EventListener);
    return () => {
      window.removeEventListener('storage', handler);
      window.removeEventListener('hamster-storage', handler as EventListener);
    };
  }, [key, read]);

  return [value, setValue, remove];
}

/** 문자열 전용(파싱 오버헤드 없음) */
export function useLocalStorageString(
  key: string,
  defaultValue: string,
): [string, (value: string | ((prev: string) => string)) => void, () => void] {
  return useLocalStorage<string>(key, defaultValue, raw => raw, v => v);
}
