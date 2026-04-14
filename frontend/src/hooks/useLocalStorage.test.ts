import { renderHook, act } from '@testing-library/react';
import { useLocalStorage, useLocalStorageString } from './useLocalStorage';

beforeEach(() => {
  localStorage.clear();
});

describe('useLocalStorage', () => {
  it('defaultValue를 초기값으로 반환한다', () => {
    const { result } = renderHook(() => useLocalStorage<number>('k-number', 42));
    expect(result.current[0]).toBe(42);
  });

  it('set 호출 시 값과 localStorage가 동시에 갱신된다', () => {
    const { result } = renderHook(() => useLocalStorage<number>('k-number', 0));
    act(() => { result.current[1](7); });
    expect(result.current[0]).toBe(7);
    expect(localStorage.getItem('k-number')).toBe('7');
  });

  it('함수형 업데이터도 지원한다', () => {
    const { result } = renderHook(() => useLocalStorage<number>('k-count', 1));
    act(() => { result.current[1](n => n + 5); });
    expect(result.current[0]).toBe(6);
  });

  it('remove()는 기본값으로 되돌린다', () => {
    const { result } = renderHook(() => useLocalStorage<number>('k-del', 0));
    act(() => { result.current[1](9); });
    expect(result.current[0]).toBe(9);
    act(() => { result.current[2](); });
    expect(result.current[0]).toBe(0);
    expect(localStorage.getItem('k-del')).toBeNull();
  });

  it('같은 키를 쓰는 다른 훅 인스턴스에 이벤트로 전파된다', () => {
    const h1 = renderHook(() => useLocalStorage<string>('shared', 'a'));
    const h2 = renderHook(() => useLocalStorage<string>('shared', 'a'));
    act(() => { h1.result.current[1]('b'); });
    expect(h2.result.current[0]).toBe('b');
  });

  it('파싱 실패 시 defaultValue로 폴백한다', () => {
    localStorage.setItem('k-bad', '{not-json');
    const { result } = renderHook(() => useLocalStorage<number>('k-bad', 42));
    expect(result.current[0]).toBe(42);
  });
});

describe('useLocalStorageString', () => {
  it('문자열을 JSON 인코딩 없이 저장한다', () => {
    const { result } = renderHook(() => useLocalStorageString('s', 'x'));
    act(() => { result.current[1]('hello'); });
    expect(localStorage.getItem('s')).toBe('hello');   // JSON.stringify면 "hello"
  });
});
