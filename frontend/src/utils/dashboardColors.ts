export function rtColor(ms?: number | null): string | undefined {
  if (!ms) return undefined;
  return ms > 1000 ? '#f87171' : ms > 500 ? '#fb923c' : '#34d399';
}

export function errColor(pct?: number | null): string {
  if (pct == null) return '#34d399';
  return pct > 5 ? '#f87171' : pct > 1 ? '#fb923c' : '#34d399';
}

export function severityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#ef4444';
    case 'warning':  return '#fb923c';
    default:         return '#60a5fa';
  }
}

/** HTTP 메서드 프리픽스 제거: "GET /api/users" → "/api/users" */
export function stripMethod(name: string): string {
  return name.replace(/^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+/i, '');
}

export const INSIGHT_ICON: Record<string, string> = {
  availability: '🔴',
  error:        '⚠️',
  performance:  '🐢',
  alert:        '🔔',
};

export const LEVEL_COLOR: Record<string, string> = {
  critical: '#ef4444',
  warning:  '#fb923c',
  info:     '#60a5fa',
};
