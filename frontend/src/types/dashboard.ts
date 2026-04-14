export type Range = '1h' | '6h' | '24h' | '7d';
export type Level = 'service' | 'instance';

export interface Insight {
  level: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  service: string | null;
  link: string;
}

export interface RatePoint {
  time: string;
  request_count: number;
  error_count: number;
  error_rate_pct: number;
  avg_ms: number;
  tps: number;
}

export interface ActiveAlert {
  id: number;
  rule_id: number;
  rule_name: string;
  severity: 'info' | 'warning' | 'critical';
  service: string | null;
  metric_name: string;
  fired_at: string;
  value: number | null;
  message: string;
  status: string;
}

export interface TopEndpoint {
  name: string;
  service: string;
  request_count: number;
  avg_ms: number;
  p95_ms: number;
  error_count: number;
  error_rate_pct: number;
}

export interface RecentError {
  id: number;
  time: string;
  service: string;
  error_type: string;
  message: string;
  trace_id: string | null;
  count: number;
}

export interface ServiceActivity {
  service: string;
  last_seen: string;
  is_alive: boolean;
  request_count: number;
  error_count: number;
  avg_ms: number | null;
}

export interface InstanceActivity {
  instance: string;
  service: string;
  last_seen: string;
  is_alive: boolean;
  request_count: number;
  error_count: number;
  avg_ms: number | null;
}

export interface ScatterPoint {
  ts: number;
  duration_ms: number;
  trace_id: string;
  service: string;
  root_name: string;
  status: 'OK' | 'ERROR';
}

export interface ActiveTransaction {
  trace_id: string;
  span_name: string;
  duration_ms: number;
  status: 'OK' | 'ERROR';
  started_at: string | null;
}

export interface ActiveSummary {
  service: string;
  instance: string;
  transactions: ActiveTransaction[];
}
