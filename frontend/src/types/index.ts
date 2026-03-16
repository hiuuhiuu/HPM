export interface Service {
  id: number;
  name: string;
  description?: string;
  last_seen: string;
}

export interface ServiceHealth {
  name: string;
  last_seen: string;
  avg_response_ms: number | null;
  error_count_5m: number;
  is_alive: boolean;
}

export interface Overview {
  services_count: number;
  avg_response_time_ms: number | null;
  error_rate_percent: number;
  active_alerts: number;
}

export interface ServiceSummary {
  service: string;
  cpu_usage_percent: number | null;
  memory_used_mb: number | null;
  memory_max_mb: number | null;
  memory_used_percent: number | null;
  avg_response_time_ms: number | null;
  request_count_5m: number;
  error_count_5m: number;
  thread_count: number | null;
}

export interface TimeseriesPoint {
  time: string;
  value: number | null;
  min: number | null;
  max: number | null;
}

export interface Timeseries {
  metric: string;
  service: string;
  unit: string;
  range: string;
  data: TimeseriesPoint[];
}

// ── 트레이스 ──────────────────────────────────────────────

export interface TraceListItem {
  trace_id: string;
  start_time: string;
  duration_ms: number;
  span_count: number;
  root_name: string;
  service: string;
  status: 'OK' | 'ERROR';
}

export interface TraceList {
  total: number;
  page: number;
  limit: number;
  items: TraceListItem[];
}

export interface SpanEvent {
  name: string;
  time: string;
  attributes: Record<string, unknown>;
}

export type SpanKind = 'UNSPECIFIED' | 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';

export interface SpanDetail {
  span_id: string;
  parent_span_id: string | null;
  service: string;
  instance: string;
  name: string;
  start_time: string;
  end_time: string;
  start_offset_ms: number;
  duration_ms: number;
  status: 'OK' | 'ERROR';
  span_kind: SpanKind;
  attributes: Record<string, unknown>;
  events: SpanEvent[];
}

export interface TraceDetail {
  trace_id: string;
  start_time: string;
  duration_ms: number;
  span_count: number;
  spans: SpanDetail[];
}

export interface TraceStats {
  service: string;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  avg_ms: number;
  total_count: number;
  error_count: number;
  error_rate_percent: number;
}

// ── 에러 추적 ──────────────────────────────────────────

export interface ErrorItem {
  id: number;
  time: string;
  service: string;
  instance: string;
  error_type: string;
  message: string;
  stack_trace: string | null;
  trace_id: string | null;
  span_id: string | null;
  resolved: boolean;
  attributes: Record<string, unknown>;
}

export interface ErrorList {
  total: number;
  page: number;
  limit: number;
  items: ErrorItem[];
}

export interface ErrorTypeCount {
  error_type: string;
  count: number;
}

export interface ErrorTimelinePoint {
  time: string;
  count: number;
}

export interface ErrorStats {
  service: string;
  total: number;
  unresolved: number;
  resolved: number;
  by_type: ErrorTypeCount[];
  timeline: ErrorTimelinePoint[];
}

// ── 로그 ──────────────────────────────────────────────

export type LogLevel = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';

export interface LogItem {
  id: number | null;
  time: string;
  service: string;
  instance: string;
  level: LogLevel;
  body: string;
  trace_id: string | null;
  span_id: string | null;
  attributes: Record<string, unknown>;
}

export interface LogList {
  total: number;
  page: number;
  limit: number;
  items: LogItem[];
}

export interface LogByLevel {
  TRACE: number;
  DEBUG: number;
  INFO:  number;
  WARN:  number;
  ERROR: number;
  FATAL: number;
}

export interface LogTimelinePoint extends LogByLevel {
  time: string;
}

export interface LogStats {
  service: string;
  total: number;
  by_level: LogByLevel;
  timeline: LogTimelinePoint[];
}

// ── 알림 ──────────────────────────────────────────────

export type AlertCondition = 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
export type AlertSeverity  = 'info' | 'warning' | 'critical';
export type AlertStatus    = 'firing' | 'resolved';

export interface AlertRule {
  id: number;
  name: string;
  description: string | null;
  service: string | null;
  metric_name: string;
  condition: AlertCondition;
  threshold: number;
  duration_s: number;
  severity: AlertSeverity;
  enabled: boolean;
  created_at: string;
  active_events: number;
}

export interface AlertRuleBody {
  name: string;
  description?: string;
  service?: string;
  metric_name: string;
  condition: AlertCondition;
  threshold: number;
  duration_s: number;
  severity: AlertSeverity;
  enabled: boolean;
}

export interface AlertEvent {
  id: number;
  rule_id: number;
  rule_name: string;
  severity: AlertSeverity;
  service: string | null;
  metric_name: string;
  condition: AlertCondition;
  threshold: number;
  fired_at: string;
  resolved_at: string | null;
  value: number | null;
  message: string;
  status: AlertStatus;
}

export interface AlertEventList {
  total: number;
  page: number;
  limit: number;
  items: AlertEvent[];
}
