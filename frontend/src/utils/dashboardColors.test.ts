import {
  rtColor,
  errColor,
  severityColor,
  stripMethod,
  INSIGHT_ICON,
  LEVEL_COLOR,
} from './dashboardColors';

describe('rtColor', () => {
  it('0 또는 null은 undefined를 반환한다', () => {
    expect(rtColor(0)).toBeUndefined();
    expect(rtColor(null)).toBeUndefined();
    expect(rtColor(undefined)).toBeUndefined();
  });
  it('1000ms 초과는 빨강', () => {
    expect(rtColor(1500)).toBe('#f87171');
  });
  it('500~1000ms는 주황', () => {
    expect(rtColor(700)).toBe('#fb923c');
    expect(rtColor(600)).toBe('#fb923c');
  });
  it('500ms 이하는 녹색', () => {
    expect(rtColor(100)).toBe('#34d399');
    expect(rtColor(500)).toBe('#34d399');
  });
});

describe('errColor', () => {
  it('null은 기본 녹색', () => {
    expect(errColor(null)).toBe('#34d399');
  });
  it('5% 초과는 빨강, 1% 초과는 주황, 1% 이하는 녹색', () => {
    expect(errColor(10)).toBe('#f87171');
    expect(errColor(2)).toBe('#fb923c');
    expect(errColor(0.5)).toBe('#34d399');
    expect(errColor(0)).toBe('#34d399');
  });
});

describe('severityColor', () => {
  it.each([
    ['critical', '#ef4444'],
    ['warning',  '#fb923c'],
    ['info',     '#60a5fa'],
    ['unknown',  '#60a5fa'],
  ])('%s → %s', (severity, expected) => {
    expect(severityColor(severity)).toBe(expected);
  });
});

describe('stripMethod', () => {
  it('HTTP 메서드 프리픽스를 제거한다', () => {
    expect(stripMethod('GET /api/users')).toBe('/api/users');
    expect(stripMethod('POST /api/login')).toBe('/api/login');
    expect(stripMethod('DELETE /api/x/1')).toBe('/api/x/1');
  });
  it('프리픽스가 없으면 그대로 반환한다', () => {
    expect(stripMethod('/api/users')).toBe('/api/users');
    expect(stripMethod('GETTER something')).toBe('GETTER something');
  });
  it('대소문자 구분없이 처리한다', () => {
    expect(stripMethod('get /api/x')).toBe('/api/x');
  });
});

describe('상수 매핑', () => {
  it('INSIGHT_ICON 핵심 카테고리 존재', () => {
    expect(INSIGHT_ICON.availability).toBeDefined();
    expect(INSIGHT_ICON.error).toBeDefined();
    expect(INSIGHT_ICON.performance).toBeDefined();
  });
  it('LEVEL_COLOR 3단계 존재', () => {
    expect(LEVEL_COLOR.critical).toBe('#ef4444');
    expect(LEVEL_COLOR.warning).toBe('#fb923c');
    expect(LEVEL_COLOR.info).toBe('#60a5fa');
  });
});
