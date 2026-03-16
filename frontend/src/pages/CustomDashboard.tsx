import React, { useState, useEffect, useRef } from 'react';
import GridLayout, { Layout as GLayout } from 'react-grid-layout';
import { usePolling, apiFetch } from '../hooks/useApi';
import { format, parseISO } from 'date-fns';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { Link } from 'react-router-dom';
import TraceWaterfall from '../components/TraceWaterfall';
import { TraceDetail } from '../types/index';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

// ── Types ────────────────────────────────────────────────────────
type WidgetType =
  | 'tps' | 'response_time' | 'error_rate'
  | 'active_transactions' | 'scatter'
  | 'top_endpoints' | 'recent_errors'
  | 'service_status' | 'instance_status'
  | 'insights';

interface WidgetDef {
  type: WidgetType;
  label: string;
  icon: string;
  defaultW: number;
  defaultH: number;
  minW: number;
  minH: number;
}

interface DashItem { id: string; type: WidgetType; }

interface SavedDashboard { items: DashItem[]; layout: GLayout[]; }

const STORAGE_KEY = 'hamster_custom_dashboard_v1';
const ROW_HEIGHT = 80;

const WIDGET_DEFS: WidgetDef[] = [
  { type: 'tps',                label: 'TPS 차트',          icon: '📈', defaultW: 6,  defaultH: 4, minW: 3, minH: 3 },
  { type: 'response_time',      label: '응답시간 차트',       icon: '⏱',  defaultW: 6,  defaultH: 4, minW: 3, minH: 3 },
  { type: 'error_rate',         label: '에러율 차트',         icon: '📉', defaultW: 6,  defaultH: 4, minW: 3, minH: 3 },
  { type: 'active_transactions', label: '실시간 활성 거래',   icon: '⚡', defaultW: 6,  defaultH: 5, minW: 4, minH: 4 },
  { type: 'scatter',            label: '트랜잭션 분포',       icon: '🔵', defaultW: 12, defaultH: 5, minW: 6, minH: 4 },
  { type: 'top_endpoints',      label: '느린 엔드포인트',     icon: '🐢', defaultW: 6,  defaultH: 5, minW: 4, minH: 4 },
  { type: 'recent_errors',      label: '최근 에러',           icon: '🚨', defaultW: 6,  defaultH: 5, minW: 4, minH: 4 },
  { type: 'service_status',     label: '서비스 상태',         icon: '🟢', defaultW: 12, defaultH: 4, minW: 6, minH: 3 },
  { type: 'instance_status',    label: '인스턴스 상태',       icon: '🖥',  defaultW: 12, defaultH: 4, minW: 6, minH: 3 },
  { type: 'insights',           label: '자동 인사이트',       icon: '🔍', defaultW: 12, defaultH: 4, minW: 6, minH: 3 },
];

const DEFAULT_DASHBOARD: SavedDashboard = {
  items: [
    { id: 'w1', type: 'tps' },
    { id: 'w2', type: 'active_transactions' },
    { id: 'w3', type: 'scatter' },
    { id: 'w4', type: 'top_endpoints' },
    { id: 'w5', type: 'recent_errors' },
    { id: 'w6', type: 'service_status' },
  ],
  layout: [
    { i: 'w1', x: 0, y: 0,  w: 6,  h: 4 },
    { i: 'w2', x: 6, y: 0,  w: 6,  h: 4 },
    { i: 'w3', x: 0, y: 4,  w: 12, h: 5 },
    { i: 'w4', x: 0, y: 9,  w: 6,  h: 5 },
    { i: 'w5', x: 6, y: 9,  w: 6,  h: 5 },
    { i: 'w6', x: 0, y: 14, w: 12, h: 4 },
  ],
};

// ── Data types ────────────────────────────────────────────────────
interface RatePoint {
  time: string;
  request_count: number;
  error_count: number;
  error_rate_pct: number;
  avg_ms: number;
  tps: number;
}
interface ActiveTx {
  trace_id: string;
  span_name: string;
  duration_ms: number;
  status: string;
}
interface ActiveSummary {
  service: string;
  instance: string;
  transactions: ActiveTx[];
}
interface ScatterPoint {
  trace_id: string;
  ts: number;
  duration_ms: number;
  status: 'OK' | 'ERROR';
  service: string;
  root_name: string;
}
interface TopEndpoint {
  name: string;
  service: string;
  request_count: number;
  avg_ms: number;
  p95_ms: number;
  error_count: number;
  error_rate_pct: number;
}
interface RecentError {
  id: number;
  time: string;
  service: string;
  error_type: string;
  message: string;
  trace_id: string | null;
}
interface ServiceActivity {
  service: string;
  last_seen: string;
  is_alive: boolean;
  request_count: number;
  error_count: number;
  avg_ms: number | null;
}
interface InstanceActivity {
  instance: string;
  service: string;
  last_seen: string;
  is_alive: boolean;
  request_count: number;
  error_count: number;
  avg_ms: number | null;
}
interface Insight {
  level: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  service: string | null;
  link: string;
}

// ── Helpers ───────────────────────────────────────────────────────
const CARD: React.CSSProperties = {
  background: '#1a1d2e',
  border: '1px solid #2d3148',
  borderRadius: 10,
  height: '100%',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
};
const HEAD_H = 40; // px

function WHead({ title, icon, extra }: { title: string; icon: string; extra?: React.ReactNode }) {
  return (
    <div style={{
      height: HEAD_H, padding: '0 14px',
      borderBottom: '1px solid #2d3148',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexShrink: 0, background: '#1a1c2e',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14 }}>{icon}</span>
        <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 13 }}>{title}</span>
      </div>
      {extra}
    </div>
  );
}

function Empty() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 13 }}>
      데이터 없음
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 24, height: 24, border: '2px solid #252840', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'cdSpin 1s linear infinite' }} />
    </div>
  );
}

function rtColor(ms?: number | null) {
  if (!ms) return undefined;
  return ms > 1000 ? '#f87171' : ms > 500 ? '#fb923c' : '#34d399';
}

// ── Widget: Time Series ───────────────────────────────────────────
function TimeSeriesWidget({ dataKey, label, color, unit, icon }: {
  dataKey: string; label: string; color: string; unit: string; icon: string;
}) {
  const { data, loading } = usePolling<RatePoint[]>(
    () => apiFetch('/api/dashboard/request-rate?range=1h'),
    30_000,
  );
  return (
    <div style={CARD}>
      <WHead title={label} icon={icon} extra={<span style={{ fontSize: 11, color: '#475569' }}>1시간</span>} />
      <div style={{ flex: 1, minHeight: 0, padding: '8px 4px 4px' }}>
        {loading ? <Spinner /> : !data?.length ? <Empty /> : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <defs>
                <linearGradient id={`cg-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.35} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" />
              <XAxis dataKey="time" tickFormatter={v => format(parseISO(v), 'HH:mm')}
                tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={36} />
              <Tooltip
                contentStyle={{ background: '#1e2035', border: '1px solid #2d3148', borderRadius: 6, fontSize: 12 }}
                labelFormatter={v => format(parseISO(v as string), 'HH:mm:ss')}
                formatter={(v: number) => [`${v}${unit}`, label]}
              />
              <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2}
                fill={`url(#cg-${dataKey})`} dot={false} activeDot={{ r: 3 }} connectNulls />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ── 콜트리 모달 (기본 대시보드와 동일) ──────────────────────────
function TraceCallTreeModal({ traceId, spanName, onClose }: {
  traceId: string; spanName: string; onClose: () => void;
}) {
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    apiFetch<TraceDetail>(`/api/traces/${traceId}`)
      .then(setTrace)
      .catch(() => setError('트레이스 정보를 불러오지 못했습니다.'))
      .finally(() => setLoading(false));
  }, [traceId]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <div style={{ background: '#1a1d2e', width: '100%', maxWidth: 1100, height: '85vh', borderRadius: 12, border: '1px solid #2d3148', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #2d3148', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <h3 style={{ margin: 0, color: '#f1f5f9', fontSize: 16 }}>콜트리 상세</h3>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 3, fontFamily: 'monospace' }}>{spanName}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>{traceId.slice(0, 16)}…</span>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 24, lineHeight: 1 }}>&times;</button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <div style={{ width: 36, height: 36, border: '3px solid #252840', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'cdSpin 1s linear infinite', margin: '0 auto 16px' }} />
              <div style={{ color: '#64748b', fontSize: 14 }}>콜트리 로딩 중...</div>
            </div>
          )}
          {error && <div style={{ textAlign: 'center', padding: '80px 0', color: '#f87171', fontSize: 14 }}>{error}</div>}
          {!loading && !error && trace && <TraceWaterfall trace={trace} />}
        </div>
        <div style={{ padding: '12px 24px', background: '#1a1c2e', borderTop: '1px solid #2d3148', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '8px 20px', background: '#374151', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>닫기</button>
        </div>
      </div>
    </div>
  );
}

// ── Widget: Active Transactions (기본 대시보드와 동일) ────────────
function ActiveTransactionsWidget() {
  const { data, loading } = usePolling<ActiveSummary[]>(
    () => apiFetch('/api/dashboard/active-summary'),
    3_000,
  );
  const [callTree, setCallTree] = useState<{ traceId: string; spanName: string } | null>(null);

  const rows = (data ?? [])
    .flatMap(g => g.transactions.map(tx => ({ ...tx, service: g.service, instance: g.instance })))
    .sort((a, b) => b.duration_ms - a.duration_ms);

  return (
    <div style={CARD}>
      <WHead
        title="실시간 활성 거래" icon="⚡"
        extra={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {rows.length > 0 && (
              <span style={{ fontSize: 11, background: '#312e81', color: '#a5b4fc', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{rows.length}건</span>
            )}
            <span style={{ fontSize: 11, color: '#475569' }}>30초 이내 · 3초 갱신 · 클릭 시 콜트리</span>
          </div>
        }
      />
      {loading && !data ? <Spinner /> : !rows.length ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 13 }}>
          최근 30초 이내 수행된 거래가 없습니다.
        </div>
      ) : (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '24%' }} /><col /><col style={{ width: 90 }} /><col style={{ width: 54 }} />
            </colgroup>
            <thead>
              <tr style={{ background: '#12142a', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ padding: '6px 12px', textAlign: 'left',   fontSize: 11, color: '#475569', fontWeight: 500 }}>서비스/인스턴스</th>
                <th style={{ padding: '6px 12px', textAlign: 'left',   fontSize: 11, color: '#475569', fontWeight: 500 }}>거래명</th>
                <th style={{ padding: '6px 12px', textAlign: 'right',  fontSize: 11, color: '#475569', fontWeight: 500 }}>지연 ▼</th>
                <th style={{ padding: '6px 12px', textAlign: 'center', fontSize: 11, color: '#475569', fontWeight: 500 }}>상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(tx => (
                <tr key={tx.trace_id}
                  onClick={() => setCallTree({ traceId: tx.trace_id, spanName: tx.span_name })}
                  style={{ borderTop: '1px solid #1e2035', cursor: 'pointer', transition: 'background 0.1s' }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1e2035')}
                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                >
                  <td style={{ padding: '6px 12px', overflow: 'hidden' }}>
                    <div style={{ fontSize: 12, color: '#818cf8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.service}</div>
                    <div style={{ fontSize: 11, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.instance || '—'}</div>
                  </td>
                  <td style={{ padding: '6px 12px', fontSize: 13, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.span_name}</td>
                  <td style={{ padding: '6px 12px', textAlign: 'right', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums',
                    color: tx.duration_ms > 3000 ? '#f87171' : tx.duration_ms > 1000 ? '#fb923c' : '#34d399' }}>
                    {tx.duration_ms >= 1000 ? `${(tx.duration_ms / 1000).toFixed(2)}s` : `${Math.round(tx.duration_ms)}ms`}
                  </td>
                  <td style={{ padding: '6px 12px', textAlign: 'center' }}>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
                      background: tx.status === 'ERROR' ? '#450a0a' : '#052e16',
                      color: tx.status === 'ERROR' ? '#fca5a5' : '#86efac' }}>
                      {tx.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {callTree && (
        <TraceCallTreeModal
          traceId={callTree.traceId}
          spanName={callTree.spanName}
          onClose={() => setCallTree(null)}
        />
      )}
    </div>
  );
}

// ── Widget: Scatter (기본 대시보드와 동일) ────────────────────────
const SPAD = { top: 8, right: 16, bottom: 28, left: 56 };
const SCATTER_H = 220;

function ScatterWidget() {
  const { data } = usePolling<ScatterPoint[]>(
    () => apiFetch('/api/dashboard/scatter?range=10m&limit=2000'),
    3_000,
  );
  const [tooltip, setTooltip] = useState<{ d: ScatterPoint; x: number; y: number } | null>(null);
  const [svgW, setSvgW] = useState(800);
  const [now, setNow] = useState(() => new Date());
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number; y: number } | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<ScatterPoint[]>([]);
  const [callTree, setCallTree] = useState<{ traceId: string; spanName: string } | null>(null);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!svgRef.current) return;
    const ro = new ResizeObserver(e => setSvgW(e[0].contentRect.width));
    ro.observe(svgRef.current.parentElement!);
    return () => ro.disconnect();
  }, []);

  const windowMs = 10 * 60 * 1000;
  const xMax = now.getTime();
  const xMin = xMax - windowMs;
  const plotW = svgW - SPAD.left - SPAD.right;
  const plotH = SCATTER_H - SPAD.top - SPAD.bottom;
  const items = data ?? [];
  const yMax = items.length > 0
    ? Math.ceil(Math.max(...items.map(d => d.duration_ms)) * 1.2 / 100) * 100
    : 1000;
  const toX = (ts: number) => Math.max(0, Math.min(plotW, ((ts - xMin) / windowMs) * plotW));
  const toY = (ms: number) => plotH - Math.max(0, Math.min(plotH, (ms / yMax) * plotH));
  const tickInterval = 60_000;
  const firstTick = Math.ceil(xMin / tickInterval) * tickInterval;
  const xTicks: number[] = [];
  for (let ts = firstTick; ts <= xMax; ts += tickInterval) xTicks.push(ts);
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => Math.round(r * yMax));

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left - SPAD.left;
    const y = e.clientY - rect.top - SPAD.top;
    if (x >= 0 && x <= plotW && y >= 0 && y <= plotH) {
      setIsDragging(true);
      setDragStart({ x, y });
      setDragEnd({ x, y });
      setSelectedPoints([]);
    }
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    setDragEnd({
      x: Math.max(0, Math.min(plotW, e.clientX - rect.left - SPAD.left)),
      y: Math.max(0, Math.min(plotH, e.clientY - rect.top - SPAD.top)),
    });
  };
  const handleMouseUp = () => {
    if (!isDragging || !dragStart || !dragEnd) return;
    setIsDragging(false);
    const minX = Math.min(dragStart.x, dragEnd.x);
    const maxX = Math.max(dragStart.x, dragEnd.x);
    const minY = Math.min(dragStart.y, dragEnd.y);
    const maxY = Math.max(dragStart.y, dragEnd.y);
    if (maxX - minX < 5 && maxY - minY < 5) {
      setDragStart(null); setDragEnd(null); setSelectedPoints([]);
      return;
    }
    const pts = items
      .filter(d => { const cx = toX(d.ts); const cy = toY(d.duration_ms); return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY; })
      .sort((a, b) => b.duration_ms - a.duration_ms);
    setSelectedPoints(pts);
  };

  const handleDotClick = (d: ScatterPoint) => {
    setSelectedTraceId(d.trace_id);
    setCallTree({ traceId: d.trace_id, spanName: d.root_name });
  };

  return (
    <div style={CARD}>
      <div style={{ padding: '10px 14px', borderBottom: '1px solid #2d3148', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, background: '#1a1c2e' }}>
        <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 13 }}>트랜잭션 분포 ({items.length}건)</span>
        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#64748b' }}>
          <span><span style={{ color: '#6366f1' }}>●</span> 정상</span>
          <span><span style={{ color: '#ef4444' }}>●</span> 에러</span>
          <span style={{ color: '#475569' }}>드래그 → 범위 선택</span>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: 'relative', userSelect: 'none', overflow: 'hidden' }}>
        <svg ref={svgRef} width="100%" height={SCATTER_H}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { setTooltip(null); handleMouseUp(); }}
        >
          <g transform={`translate(${SPAD.left},${SPAD.top})`}>
            {yTicks.map(v => (
              <g key={v}>
                <line x1={0} y1={toY(v)} x2={plotW} y2={toY(v)} stroke="#2d3148" strokeWidth={1} strokeDasharray="3 3" />
                <text x={-6} y={toY(v)} dy="0.35em" textAnchor="end" fill="#64748b" fontSize={10}>{v}ms</text>
              </g>
            ))}
            {xTicks.map(ts => (
              <g key={ts}>
                <line x1={toX(ts)} y1={0} x2={toX(ts)} y2={plotH} stroke="#2d3148" strokeWidth={1} strokeDasharray="3 3" />
                <text x={toX(ts)} y={plotH + 16} textAnchor="middle" fill="#64748b" fontSize={10}>{format(new Date(ts), 'HH:mm')}</text>
              </g>
            ))}
            {items.map(d => {
              const isSelected = d.trace_id === selectedTraceId;
              return (
                <circle key={d.trace_id}
                  cx={toX(d.ts)} cy={toY(d.duration_ms)}
                  r={isSelected ? 7 : 4}
                  fill={d.status === 'ERROR' ? '#ef4444' : '#6366f1'}
                  fillOpacity={isSelected ? 1 : 0.7}
                  stroke={isSelected ? '#fff' : 'none'} strokeWidth={isSelected ? 1.5 : 0}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleDotClick(d)}
                  onMouseEnter={e => {
                    const rect = svgRef.current!.getBoundingClientRect();
                    setTooltip({ d, x: e.clientX - rect.left, y: e.clientY - rect.top });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              );
            })}
            {dragStart && dragEnd && (
              <rect
                x={Math.min(dragStart.x, dragEnd.x)} y={Math.min(dragStart.y, dragEnd.y)}
                width={Math.abs(dragEnd.x - dragStart.x)} height={Math.abs(dragEnd.y - dragStart.y)}
                fill="#6366f1" fillOpacity={0.2} stroke="#6366f1" strokeWidth={1} strokeDasharray="4 4" pointerEvents="none"
              />
            )}
          </g>
        </svg>

        {/* 툴팁 */}
        {tooltip && (
          <div style={{
            position: 'absolute', left: tooltip.x + 12, top: tooltip.y - 10,
            background: '#1e2035', border: '1px solid #2d3148', borderRadius: 6,
            padding: '10px 14px', fontSize: 12, pointerEvents: 'none', zIndex: 10, whiteSpace: 'nowrap',
          }}>
            <div style={{ color: tooltip.d.status === 'ERROR' ? '#f87171' : '#a5b4fc', fontWeight: 600, marginBottom: 4 }}>{tooltip.d.root_name}</div>
            <div style={{ color: '#94a3b8' }}>서비스: <span style={{ color: '#e2e8f0' }}>{tooltip.d.service}</span></div>
            <div style={{ color: '#94a3b8' }}>시간: <span style={{ color: '#e2e8f0' }}>{format(new Date(tooltip.d.ts), 'HH:mm:ss')}</span></div>
            <div style={{ color: '#94a3b8' }}>응답: <span style={{ color: '#e2e8f0' }}>{tooltip.d.duration_ms.toFixed(1)} ms</span></div>
            <div style={{ color: '#64748b', marginTop: 4, fontSize: 11 }}>클릭하여 스택 보기</div>
          </div>
        )}

        {/* 드래그 선택 목록 */}
        {selectedPoints.length > 0 && (
          <div style={{
            position: 'absolute', top: SPAD.top, right: SPAD.right,
            width: 380, maxHeight: plotH, overflowY: 'auto',
            background: '#1a1c2ee6', border: '1px solid #2d3148',
            borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: 20, display: 'flex', flexDirection: 'column', backdropFilter: 'blur(4px)',
          }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #2d3148', display: 'flex', justifyContent: 'space-between', alignItems: 'center', position: 'sticky', top: 0, background: '#1a1c2ef2', zIndex: 21 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>선택된 트랜잭션 ({selectedPoints.length}건)</span>
              <button onClick={() => { setSelectedPoints([]); setDragStart(null); setDragEnd(null); }}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16 }}>✕</button>
            </div>
            <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {selectedPoints.map(p => (
                <div key={p.trace_id}
                  onClick={() => handleDotClick(p)}
                  style={{
                    padding: '8px 10px', borderRadius: 4, cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: selectedTraceId === p.trace_id ? '#252840' : 'transparent',
                    borderLeft: `3px solid ${p.status === 'ERROR' ? '#ef4444' : '#6366f1'}`,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = '#1e2035')}
                  onMouseLeave={e => (e.currentTarget.style.background = selectedTraceId === p.trace_id ? '#252840' : 'transparent')}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: p.status === 'ERROR' ? '#fca5a5' : '#e2e8f0', fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.root_name}</div>
                    <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>{format(new Date(p.ts), 'HH:mm:ss')} · {p.service}</div>
                  </div>
                  <div style={{ color: rtColor(p.duration_ms), fontSize: 12, fontWeight: 600, flexShrink: 0, paddingLeft: 10 }}>{p.duration_ms.toFixed(1)} ms</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {callTree && (
        <TraceCallTreeModal traceId={callTree.traceId} spanName={callTree.spanName} onClose={() => { setCallTree(null); setSelectedTraceId(null); }} />
      )}
    </div>
  );
}

// ── Widget: Top Endpoints ─────────────────────────────────────────
function TopEndpointsWidget() {
  const { data, loading } = usePolling<TopEndpoint[]>(
    () => apiFetch('/api/dashboard/top-endpoints?range=1h&limit=10'),
    30_000,
  );
  return (
    <div style={CARD}>
      <WHead title="느린 엔드포인트" icon="🐢"
        extra={<Link to="/traces" style={{ fontSize: 11, color: '#6366f1', textDecoration: 'none' }}>전체 →</Link>} />
      {loading && !data ? <Spinner /> : !data?.length ? <Empty /> : (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#12142a', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ padding: '7px 12px', textAlign: 'left',  color: '#64748b', fontWeight: 500 }}>엔드포인트</th>
                <th style={{ padding: '7px 12px', textAlign: 'right', color: '#64748b', fontWeight: 500 }}>Avg</th>
                <th style={{ padding: '7px 12px', textAlign: 'right', color: '#64748b', fontWeight: 500 }}>P95</th>
                <th style={{ padding: '7px 12px', textAlign: 'right', color: '#64748b', fontWeight: 500 }}>에러율</th>
              </tr>
            </thead>
            <tbody>
              {data.map((ep, i) => (
                <tr key={i} style={{ borderTop: '1px solid #1e2035' }}>
                  <td style={{ padding: '8px 12px', maxWidth: 160 }}>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#e2e8f0' }}>{ep.name}</div>
                    <div style={{ fontSize: 11, color: '#475569' }}>{ep.service}</div>
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: rtColor(ep.avg_ms) }}>{ep.avg_ms.toFixed(0)}ms</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: rtColor(ep.p95_ms) }}>{ep.p95_ms.toFixed(0)}ms</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', color: ep.error_rate_pct > 0 ? '#f87171' : '#34d399' }}>{ep.error_rate_pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Widget: Recent Errors ─────────────────────────────────────────
function RecentErrorsWidget() {
  const { data, loading } = usePolling<RecentError[]>(
    () => apiFetch('/api/dashboard/recent-errors?limit=8'),
    20_000,
  );
  return (
    <div style={CARD}>
      <WHead title="최근 미해결 에러" icon="🚨"
        extra={<Link to="/errors?resolved=false" style={{ fontSize: 11, color: '#6366f1', textDecoration: 'none' }}>전체 →</Link>} />
      {loading && !data ? <Spinner /> : !data?.length ? <Empty /> : (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {data.map(err => (
            <div key={err.id} style={{ padding: '10px 14px', borderBottom: '1px solid #1e2035' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: '#818cf8' }}>{err.service}</span>
                <span style={{ fontSize: 11, color: '#475569' }}>{format(parseISO(err.time), 'HH:mm:ss')}</span>
              </div>
              <div style={{ fontSize: 12, color: '#f87171', fontWeight: 500 }}>{err.error_type}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{err.message}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Widget: Service Status ────────────────────────────────────────
function ServiceStatusWidget() {
  const { data, loading } = usePolling<ServiceActivity[]>(
    () => apiFetch('/api/dashboard/service-activity?range=1h'),
    10_000,
  );
  return (
    <div style={CARD}>
      <WHead title="서비스 상태" icon="🟢" />
      {loading && !data ? <Spinner /> : !data?.length ? <Empty /> : (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#12142a', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ padding: '7px 14px', textAlign: 'left',   color: '#64748b', fontWeight: 500 }}>서비스</th>
                <th style={{ padding: '7px 14px', textAlign: 'center', color: '#64748b', fontWeight: 500 }}>상태</th>
                <th style={{ padding: '7px 14px', textAlign: 'right',  color: '#64748b', fontWeight: 500 }}>요청</th>
                <th style={{ padding: '7px 14px', textAlign: 'right',  color: '#64748b', fontWeight: 500 }}>에러율</th>
                <th style={{ padding: '7px 14px', textAlign: 'right',  color: '#64748b', fontWeight: 500 }}>응답시간</th>
              </tr>
            </thead>
            <tbody>
              {data.map(svc => {
                const errRate = svc.request_count > 0 ? (svc.error_count / svc.request_count * 100) : 0;
                return (
                  <tr key={svc.service} style={{
                    borderTop: '1px solid #1e2035',
                    borderLeft: `3px solid ${svc.is_alive ? '#22c55e' : '#ef4444'}`,
                    background: svc.is_alive ? 'transparent' : '#1a0808',
                  }}>
                    <td style={{ padding: '8px 14px', color: '#e2e8f0', fontWeight: 500 }}>{svc.service}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: svc.is_alive ? '#4ade80' : '#f87171' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
                          background: svc.is_alive ? '#22c55e' : '#ef4444',
                          boxShadow: svc.is_alive ? '0 0 5px #22c55e80' : 'none' }} />
                        {svc.is_alive ? 'UP' : 'DOWN'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color: '#94a3b8' }}>{svc.request_count.toLocaleString()}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color: errRate > 5 ? '#f87171' : errRate > 1 ? '#fb923c' : '#4ade80' }}>{errRate.toFixed(1)}%</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color: rtColor(svc.avg_ms) }}>{svc.avg_ms != null ? `${Math.round(svc.avg_ms)}ms` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Widget: Instance Status ───────────────────────────────────────
function InstanceStatusWidget() {
  const { data, loading } = usePolling<InstanceActivity[]>(
    () => apiFetch('/api/dashboard/instance-activity?range=1h'),
    10_000,
  );
  return (
    <div style={CARD}>
      <WHead title="인스턴스 상태" icon="🖥" />
      {loading && !data ? <Spinner /> : !data?.length ? <Empty /> : (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: '#12142a', position: 'sticky', top: 0, zIndex: 1 }}>
                <th style={{ padding: '7px 14px', textAlign: 'left',   color: '#64748b', fontWeight: 500 }}>서비스 / 인스턴스</th>
                <th style={{ padding: '7px 14px', textAlign: 'center', color: '#64748b', fontWeight: 500 }}>상태</th>
                <th style={{ padding: '7px 14px', textAlign: 'right',  color: '#64748b', fontWeight: 500 }}>요청</th>
                <th style={{ padding: '7px 14px', textAlign: 'right',  color: '#64748b', fontWeight: 500 }}>에러율</th>
                <th style={{ padding: '7px 14px', textAlign: 'right',  color: '#64748b', fontWeight: 500 }}>응답시간</th>
              </tr>
            </thead>
            <tbody>
              {data.map(inst => {
                const errRate = inst.request_count > 0 ? (inst.error_count / inst.request_count * 100) : 0;
                return (
                  <tr key={`${inst.service}/${inst.instance}`} style={{
                    borderTop: '1px solid #1e2035',
                    borderLeft: `3px solid ${inst.is_alive ? '#22c55e' : '#ef4444'}`,
                    background: inst.is_alive ? 'transparent' : '#1a0808',
                  }}>
                    <td style={{ padding: '8px 14px' }}>
                      <div style={{ color: '#818cf8', fontSize: 11 }}>{inst.service}</div>
                      <div style={{ color: '#e2e8f0', fontWeight: 500 }}>{inst.instance}</div>
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'center' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, color: inst.is_alive ? '#4ade80' : '#f87171' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
                          background: inst.is_alive ? '#22c55e' : '#ef4444',
                          boxShadow: inst.is_alive ? '0 0 5px #22c55e80' : 'none' }} />
                        {inst.is_alive ? 'UP' : 'DOWN'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color: '#94a3b8' }}>{inst.request_count.toLocaleString()}</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color: errRate > 5 ? '#f87171' : errRate > 1 ? '#fb923c' : '#4ade80' }}>{errRate.toFixed(1)}%</td>
                    <td style={{ padding: '8px 14px', textAlign: 'right', color: rtColor(inst.avg_ms) }}>{inst.avg_ms != null ? `${Math.round(inst.avg_ms)}ms` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Widget: Insights ──────────────────────────────────────────────
const LVCOLOR: Record<string, string> = { critical: '#f87171', warning: '#fb923c', info: '#60a5fa' };
const LVICON:  Record<string, string> = { performance: '🐢', error: '🚨', availability: '🔴', throughput: '📈', resource: '💾' };

function InsightsWidget() {
  const { data, loading } = usePolling<Insight[]>(
    () => apiFetch('/api/insights'),
    60_000,
  );
  return (
    <div style={CARD}>
      <WHead title="자동 인사이트" icon="🔍" />
      {loading && !data ? <Spinner /> : !data?.length ? <Empty /> : (
        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {data.map((ins, i) => (
            <div key={i} style={{
              padding: '10px 14px', borderBottom: '1px solid #1e2035',
              borderLeft: `3px solid ${LVCOLOR[ins.level] ?? '#64748b'}`,
              display: 'flex', gap: 10,
            }}>
              <span style={{ fontSize: 15, flexShrink: 0 }}>{LVICON[ins.category] ?? '💡'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: LVCOLOR[ins.level], background: LVCOLOR[ins.level] + '22', padding: '1px 6px', borderRadius: 4 }}>
                    {ins.level === 'critical' ? '위험' : ins.level === 'warning' ? '경고' : '정보'}
                  </span>
                  <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ins.title}</span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: 12 }}>{ins.description}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Widget renderer ───────────────────────────────────────────────
function renderWidget(type: WidgetType) {
  switch (type) {
    case 'tps':                return <TimeSeriesWidget dataKey="tps"            label="TPS 차트"    color="#34d399" unit=" tps" icon="📈" />;
    case 'response_time':      return <TimeSeriesWidget dataKey="avg_ms"         label="응답시간 차트" color="#818cf8" unit="ms"   icon="⏱" />;
    case 'error_rate':         return <TimeSeriesWidget dataKey="error_rate_pct" label="에러율 차트"  color="#f87171" unit="%"    icon="📉" />;
    case 'active_transactions': return <ActiveTransactionsWidget />;
    case 'scatter':            return <ScatterWidget />;
    case 'top_endpoints':      return <TopEndpointsWidget />;
    case 'recent_errors':      return <RecentErrorsWidget />;
    case 'service_status':     return <ServiceStatusWidget />;
    case 'instance_status':    return <InstanceStatusWidget />;
    case 'insights':           return <InsightsWidget />;
    default: return null;
  }
}

// ── Widget Wrapper (edit mode) ────────────────────────────────────
function WidgetWrapper({ item, editMode, onDelete }: {
  item: DashItem; editMode: boolean; onDelete: (id: string) => void;
}) {
  return (
    <div style={{ height: '100%', position: 'relative' }}>
      {editMode && (
        <>
          <div className="widget-drag-handle" style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 40, zIndex: 10,
            cursor: 'grab', background: 'rgba(99,102,241,0.2)',
            borderRadius: '10px 10px 0 0',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            borderBottom: '1px dashed #6366f1',
          }}>
            <span style={{ color: '#818cf8', fontSize: 11, userSelect: 'none', letterSpacing: '0.1em' }}>
              ⠿⠿⠿  드래그하여 이동
            </span>
          </div>
          <button
            onClick={() => onDelete(item.id)}
            title="위젯 삭제"
            style={{
              position: 'absolute', top: 8, right: 8, zIndex: 20,
              width: 24, height: 24, borderRadius: '50%',
              background: '#ef4444', border: 'none', color: '#fff',
              fontSize: 16, lineHeight: '1', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
            }}
          >
            ×
          </button>
        </>
      )}
      <div style={{ height: '100%', opacity: editMode ? 0.65 : 1, pointerEvents: editMode ? 'none' : 'auto' }}>
        {renderWidget(item.type)}
      </div>
    </div>
  );
}

// ── Widget Palette ────────────────────────────────────────────────
function WidgetPalette({ usedTypes, onAdd }: { usedTypes: Set<WidgetType>; onAdd: (t: WidgetType) => void }) {
  return (
    <div style={{
      width: 210, flexShrink: 0,
      background: '#12142a', border: '1px solid #2d3148', borderRadius: 10,
      padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 6,
      maxHeight: 'calc(100vh - 180px)', overflowY: 'auto',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '0 4px', marginBottom: 4 }}>
        위젯 추가
      </div>
      {WIDGET_DEFS.map(def => {
        const used = usedTypes.has(def.type);
        return (
          <button
            key={def.type}
            onClick={() => !used && onAdd(def.type)}
            disabled={used}
            style={{
              display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px',
              borderRadius: 7, border: `1px solid ${used ? '#1e2035' : '#3730a3'}`,
              background: used ? '#16182a' : '#1e2040',
              color: used ? '#374151' : '#e2e8f0',
              cursor: used ? 'default' : 'pointer', fontSize: 13, textAlign: 'left', width: '100%',
              transition: 'background 0.12s',
            }}
            onMouseEnter={e => { if (!used) (e.currentTarget as HTMLButtonElement).style.background = '#272a50'; }}
            onMouseLeave={e => { if (!used) (e.currentTarget as HTMLButtonElement).style.background = '#1e2040'; }}
          >
            <span style={{ fontSize: 16 }}>{def.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{def.label}</div>
              {used && <div style={{ fontSize: 10, color: '#374151', marginTop: 1 }}>이미 추가됨</div>}
            </div>
            {!used && <span style={{ color: '#6366f1', fontSize: 16, lineHeight: 1 }}>+</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export default function CustomDashboard() {
  const [editMode, setEditMode] = useState(false);
  const [items, setItems] = useState<DashItem[]>([]);
  const [layout, setLayout] = useState<GLayout[]>([]);
  const [savedMsg, setSavedMsg] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(0);

  // Load layout from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved: SavedDashboard = raw ? JSON.parse(raw) : DEFAULT_DASHBOARD;
      setItems(saved.items);
      setLayout(saved.layout);
    } catch {
      setItems(DEFAULT_DASHBOARD.items);
      setLayout(DEFAULT_DASHBOARD.layout);
    }
  }, []);

  // Measure container width
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(e => setContainerW(e[0].contentRect.width));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const handleSave = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, layout }));
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2500);
    setEditMode(false);
  };

  const handleDiscard = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved: SavedDashboard = raw ? JSON.parse(raw) : DEFAULT_DASHBOARD;
      setItems(saved.items);
      setLayout(saved.layout);
    } catch {
      setItems(DEFAULT_DASHBOARD.items);
      setLayout(DEFAULT_DASHBOARD.layout);
    }
    setEditMode(false);
  };

  const handleDelete = (id: string) => {
    setItems(prev => prev.filter(it => it.id !== id));
    setLayout(prev => prev.filter(l => l.i !== id));
  };

  const handleAddWidget = (type: WidgetType) => {
    const def = WIDGET_DEFS.find(d => d.type === type)!;
    const id = `w_${Date.now()}`;
    const maxY = layout.length > 0 ? Math.max(...layout.map(l => l.y + l.h)) : 0;
    setItems(prev => [...prev, { id, type }]);
    setLayout(prev => [...prev, { i: id, x: 0, y: maxY, w: def.defaultW, h: def.defaultH, minW: def.minW, minH: def.minH }]);
  };

  const handleReset = () => {
    if (!window.confirm('기본 레이아웃으로 초기화하시겠습니까?')) return;
    setItems(DEFAULT_DASHBOARD.items);
    setLayout(DEFAULT_DASHBOARD.layout);
  };

  const usedTypes = new Set(items.map(it => it.type));

  return (
    <div style={{ padding: '24px 24px 60px' }}>
      <style>{`
        @keyframes cdSpin { to { transform: rotate(360deg); } }
        .react-grid-item.react-grid-placeholder { background: #6366f1 !important; opacity: 0.15 !important; border-radius: 10px !important; }
        .react-resizable-handle { opacity: 0; transition: opacity 0.15s; }
        .react-grid-item:hover .react-resizable-handle { opacity: 1; }
        .react-resizable-handle::after { border-color: #6366f1 !important; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: '#f1f5f9', fontSize: 18, fontWeight: 700 }}>커스텀 대시보드</h2>
          <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 12 }}>
            {editMode
              ? '타이틀 바를 드래그하여 이동 · 모서리를 드래그하여 크기 조절 · 우측에서 위젯 추가'
              : '위젯을 자유롭게 배치하여 나만의 모니터링 화면을 구성합니다.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {savedMsg && <span style={{ fontSize: 13, color: '#34d399' }}>저장되었습니다 ✓</span>}
          {editMode ? (
            <>
              <button onClick={handleReset} style={BTN_GHOST}>기본값으로 초기화</button>
              <button onClick={handleDiscard} style={BTN_SECONDARY}>취소</button>
              <button onClick={handleSave} style={BTN_PRIMARY}>저장</button>
            </>
          ) : (
            <button onClick={() => setEditMode(true)} style={BTN_EDIT}>편집</button>
          )}
        </div>
      </div>

      {/* ── Main area ── */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Grid */}
        <div ref={containerRef} style={{ flex: 1, minWidth: 0 }}>
          {containerW > 0 && items.length > 0 ? (
            <GridLayout
              layout={layout}
              cols={12}
              rowHeight={ROW_HEIGHT}
              width={containerW}
              margin={[12, 12]}
              containerPadding={[0, 0]}
              isDraggable={editMode}
              isResizable={editMode}
              draggableHandle=".widget-drag-handle"
              onLayoutChange={(newLayout: GLayout[]) => setLayout(newLayout)}
              useCSSTransforms
            >
              {items.map(item => (
                <div key={item.id}>
                  <WidgetWrapper item={item} editMode={editMode} onDelete={handleDelete} />
                </div>
              ))}
            </GridLayout>
          ) : items.length === 0 ? (
            <div style={{
              border: '2px dashed #2d3148', borderRadius: 12, padding: '80px 40px',
              textAlign: 'center', color: '#475569',
            }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>위젯이 없습니다</div>
              <div style={{ fontSize: 13 }}>
                {editMode ? '오른쪽 팔레트에서 위젯을 추가해주세요.' : '편집 버튼을 눌러 위젯을 추가해주세요.'}
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>레이아웃 로딩 중...</div>
          )}
        </div>

        {/* Widget palette */}
        {editMode && (
          <WidgetPalette usedTypes={usedTypes} onAdd={handleAddWidget} />
        )}
      </div>
    </div>
  );
}

// ── Button styles ─────────────────────────────────────────────────
const BTN_PRIMARY: React.CSSProperties = {
  padding: '8px 20px', background: '#6366f1', border: 'none',
  color: '#fff', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600,
};
const BTN_SECONDARY: React.CSSProperties = {
  padding: '8px 16px', background: 'none', border: '1px solid #374151',
  color: '#e2e8f0', borderRadius: 7, cursor: 'pointer', fontSize: 13,
};
const BTN_GHOST: React.CSSProperties = {
  padding: '8px 16px', background: 'none', border: '1px solid #2d3148',
  color: '#94a3b8', borderRadius: 7, cursor: 'pointer', fontSize: 13,
};
const BTN_EDIT: React.CSSProperties = {
  padding: '8px 20px', background: '#1e2040', border: '1px solid #3730a3',
  color: '#a5b4fc', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 500,
};
