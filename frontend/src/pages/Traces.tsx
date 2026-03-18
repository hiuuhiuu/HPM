import React, { useEffect, useRef, useState } from 'react';
import {
  ResponsiveContainer, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip,
  ReferenceLine,
  BarChart, Bar, Cell,
} from 'recharts';
import { usePolling, apiFetch, apiPost } from '../hooks/useApi';
import { Service, TraceList, TraceListItem, TraceDetail, TraceStats } from '../types';
import TraceWaterfall from '../components/TraceWaterfall';
import { format, parseISO } from 'date-fns';
import { useGlobalTime } from '../contexts/GlobalTimeContext';
import PageHeader from '../components/PageHeader';
import { useLocation } from 'react-router-dom';

type Range     = '15m' | '1h' | '6h' | '24h' | '7d';
type Status    = 'ALL' | 'OK' | 'ERROR';
type ViewMode  = 'table' | 'scatter';

const RANGES: Range[]       = ['15m', '1h', '6h', '24h', '7d'];
const STATUS_OPTS: Status[] = ['ALL', 'OK', 'ERROR'];

export default function Traces() {
  const location = useLocation();
  const { globalRange, setGlobalRange } = useGlobalTime();
  const [service, setService]   = useState('');
  const [range, setRangeLocal]  = useState<Range>((globalRange as Range) || '1h');
  const setRange = (r: Range) => { setRangeLocal(r); setGlobalRange(r); };
  const [status, setStatus]     = useState<Status>('ALL');
  const [page, setPage]         = useState(1);
  const [viewMode, setViewMode]         = useState<ViewMode>('table');
  const [selected, setSelected]         = useState<TraceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [hideSystemTraces, setHideSystemTraces] = useState(true);
  const [hideStaticResources, setHideStaticResources] = useState(false);
  const minTraceDurationMs = Number(localStorage.getItem('trace_min_duration_ms') || '0');

  // Errors 페이지에서 trace_id 파라미터로 이동 시 자동 선택
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const traceId = params.get('trace_id');
    if (!traceId) return;
    apiFetch<TraceDetail>(`/api/traces/${traceId}`)
      .then(detail => setSelected(detail))
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 서비스 목록
  const { data: services } = usePolling<Service[]>(
    () => apiFetch('/api/services'), 60_000,
  );

  // 트레이스 통계
  const { data: stats } = usePolling<TraceStats | null>(
    () => service
      ? apiFetch(`/api/traces/stats/${service}?range=${range}`)
      : Promise.resolve(null),
    30_000,
    [service, range],
  );

  // 트레이스 목록
  const statusParam  = status !== 'ALL' ? `&status=${status}` : '';
  const serviceParam = service ? `&service=${service}` : '';
  // 산점도 모드: 최대 500건 1페이지, 테이블 모드: 20건 페이지네이션
  const fetchLimit = viewMode === 'scatter' ? 500 : 20;
  const fetchPage  = viewMode === 'scatter' ? 1   : page;
  const { data: traceList, loading } = usePolling<TraceList>(
    () => apiFetch(`/api/traces?range=${range}&page=${fetchPage}&limit=${fetchLimit}${serviceParam}${statusParam}`),
    viewMode === 'scatter' ? 15_000 : 30_000,  // 산점도: 15초 자동 갱신
    [service, range, status, fetchPage, fetchLimit],
  );

  // 페이지 바뀔 때 선택 초기화
  useEffect(() => { setSelected(null); }, [service, range, status, page]);

  const handleRowClick = async (item: TraceListItem) => {
    if (selected?.trace_id === item.trace_id) {
      setSelected(null);
      return;
    }
    setDetailLoading(true);
    try {
      const detail = await apiFetch<TraceDetail>(`/api/traces/${item.trace_id}`);
      setSelected(detail);
    } finally {
      setDetailLoading(false);
    }
  };

  // 시스템/헬스체크 트레이스 필터
  const isSystemTrace = (item: TraceListItem) => {
    const n = item.root_name.toUpperCase();
    // HTTP 헬스체크
    if (n === '/HEALTH' || n === 'GET /HEALTH' || n === 'HEALTH' ||
        n === 'GET /ACTUATOR/HEALTH' || n === '/ACTUATOR/HEALTH') return true;
    // SELECT <단순식별자> 패턴 — DBCP validationQuery (예: SELECT covi_smart)
    if (/^SELECT\s+\w+$/.test(n)) return true;
    // PostgreSQL
    if (n === 'SELECT 1' || n === 'SELECT 1;') return true;
    if (n.startsWith('SELECT VERSION')) return true;
    if (n.includes('PG_CATALOG') || n.includes('PG_IS_IN_RECOVERY')) return true;
    if (n.startsWith('SHOW ') && n.length < 40) return true;
    // MSSQL
    if (n.startsWith('SELECT TOP 1') && n.length < 50) return true;
    if (n === 'SELECT GETDATE()' || n === 'SELECT @@VERSION' || n === 'SELECT @@SERVERNAME') return true;
    // Oracle / Tibero / Altibase
    if (n === 'SELECT 1 FROM DUAL' || n === 'SELECT SYSDATE FROM DUAL' ||
        n === 'SELECT * FROM DUAL' || n === 'SELECT 0 FROM DUAL' ||
        n === 'SELECT 1 FROM SYS.DUAL' || n === 'SELECT CURRENT_TIMESTAMP FROM DUAL') return true;
    if (n === 'SELECT * FROM V$VERSION' || n.startsWith('SELECT BANNER FROM V$VERSION')) return true;
    // MySQL / MariaDB
    if (n === '/* PING */' || n === 'SELECT 1 + 1' || n === 'SELECT 1+1') return true;
    if (n === '/* JDBC PING */ SELECT 1') return true;
    // 공통: 20자 이하 FROM 없는 단순 SELECT
    if (n.length <= 20 && n.startsWith('SELECT') && !n.includes('FROM ')) return true;
    return false;
  };

  // 정적 리소스 필터
  const isStaticResource = (item: TraceListItem) => {
    const { path } = parseRootName(item.root_name);
    return STATIC_EXTS.some(ext => path.toLowerCase().endsWith(ext) || path.toLowerCase().includes(ext + '?'));
  };

  const allItems = traceList?.items ?? [];
  const systemCount = allItems.filter(isSystemTrace).length;
  const staticCount = allItems.filter(i => !isSystemTrace(i) && isStaticResource(i)).length;

  const displayItems = allItems
    .filter(i => !hideSystemTraces || !isSystemTrace(i))
    .filter(i => !hideStaticResources || !isStaticResource(i))
    .filter(i => minTraceDurationMs <= 0 || i.status === 'ERROR' || i.duration_ms >= minTraceDurationMs);

  const totalPages = traceList ? Math.ceil(traceList.total / 20) : 1;

  return (
    <div>
      <PageHeader
        title="분산 트레이싱"
        actions={
          <>
            <div className="tab-group">
              {(['table', 'scatter'] as ViewMode[]).map(m => (
                <button key={m} onClick={() => setViewMode(m)}
                  className={`tab-btn${viewMode === m ? ' active' : ''}`}>
                  {m === 'table' ? '≡ 테이블' : '⬡ 산점도'}
                </button>
              ))}
            </div>
            <select value={service} onChange={e => { setService(e.target.value); setPage(1); }} className="select">
              <option value="">전체 서비스</option>
              {services?.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
            <div className="tab-group">
              {STATUS_OPTS.map(s => (
                <button key={s} onClick={() => { setStatus(s); setPage(1); }}
                  className={`tab-btn${status === s ? ' active' : ''}`}>
                  {s}
                </button>
              ))}
            </div>
            <div className="tab-group">
              {RANGES.map(r => (
                <button key={r} onClick={() => { setRange(r); setPage(1); }}
                  className={`tab-btn${range === r ? ' active' : ''}`}>
                  {r}
                </button>
              ))}
            </div>
          </>
        }
        controls={
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)', userSelect: 'none' }}>
              <input type="checkbox" checked={hideSystemTraces} onChange={e => setHideSystemTraces(e.target.checked)} style={{ accentColor: '#6366f1', cursor: 'pointer' }} />
              시스템 쿼리 제외
              {systemCount > 0 && <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 10 }}>{systemCount}</span>}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)', userSelect: 'none' }}>
              <input type="checkbox" checked={hideStaticResources} onChange={e => setHideStaticResources(e.target.checked)} style={{ accentColor: '#6366f1', cursor: 'pointer' }} />
              정적 리소스 제외
              {staticCount > 0 && <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: 10 }}>{staticCount}</span>}
            </label>
            {minTraceDurationMs > 0 && (
              <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                {minTraceDurationMs}ms 미만 제외
              </span>
            )}
          </div>
        }
      />

      {/* 통계 카드 (서비스 선택 시) */}
      {stats && (
        <div className="grid-4" style={{ marginBottom: 16 }}>
          {[
            { label: 'P50',   value: stats.p50_ms,  unit: 'ms' },
            { label: 'P95',   value: stats.p95_ms,  unit: 'ms' },
            { label: 'P99',   value: stats.p99_ms,  unit: 'ms' },
            { label: '에러율', value: stats.error_rate_percent, unit: '%' },
          ].map(({ label, value, unit }) => (
            <div key={label} className="card">
              <div className="card-title">{label}</div>
              <div className="stat-value">
                {value.toFixed(1)}
                <span className="stat-unit">{unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 응답시간 분포 히스토그램 */}
      {displayItems.length > 0 && (
        <ResponseTimeHistogram items={displayItems} />
      )}

      {/* 산점도 뷰 */}
      {viewMode === 'scatter' && (
        <ScatterView
          items={displayItems}
          loading={loading}
          selected={selected}
          onSelect={handleRowClick}
        />
      )}

      {/* 테이블 뷰 */}
      {viewMode === 'table' && <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1e2035', borderBottom: '1px solid #2d3148', color: '#64748b' }}>
              <th style={thS}>서비스</th>
              <th style={thS}>루트 스팬</th>
              <th style={thS}>상태</th>
              <th style={thS}>지속 시간</th>
              <th style={thS}>스팬 수</th>
              <th style={thS}>시작 시각</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>로딩 중...</td></tr>
            )}
            {!loading && !displayItems.length && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                {service
                  ? `'${service}' 서비스의 ${range} 내 트레이스가 없습니다.`
                  : status !== 'ALL'
                    ? `${range} 내 ${status} 상태 트레이스가 없습니다.`
                    : `${range} 내 수집된 트레이스가 없습니다.`}
              </td></tr>
            )}
            {displayItems.map(item => {
              const isSelected = selected?.trace_id === item.trace_id;
              return (
                <React.Fragment key={item.trace_id}>
                  <tr
                    onClick={() => handleRowClick(item)}
                    style={{
                      borderBottom: '1px solid #1e2035', cursor: 'pointer',
                      background: isSelected ? '#1e2035' : 'transparent',
                      borderLeft: isSelected ? '3px solid #6366f1' : '3px solid transparent',
                    }}
                  >
                    <td style={tdS}>{item.service || '—'}</td>
                    <td style={{ ...tdS, maxWidth: 280 }}>
                      <RootNameCell rootName={item.root_name} />
                    </td>
                    <td style={tdS}>
                      <span className={`badge ${item.status === 'ERROR' ? 'badge-error' : 'badge-ok'}`}>
                        {item.status}
                      </span>
                    </td>
                    <td style={{ ...tdS, color: durationColor(item.duration_ms) }}>
                      {item.duration_ms.toFixed(1)} ms
                    </td>
                    <td style={{ ...tdS, color: '#94a3b8' }}>{item.span_count}</td>
                    <td style={{ ...tdS, color: '#64748b', fontSize: 12 }}>
                      {format(parseISO(item.start_time), 'MM-dd HH:mm:ss.SSS')}
                    </td>
                  </tr>

                  {/* Waterfall 인라인 확장 */}
                  {isSelected && (
                    <tr>
                      <td colSpan={6} style={{ padding: '12px 16px', background: '#12141f', borderBottom: '1px solid #2d3148' }}>
                        {detailLoading
                          ? <div style={{ textAlign: 'center', color: '#64748b', padding: 24 }}>로딩 중...</div>
                          : <>
                              <TraceWaterfall trace={selected!} />
                              <ThreadDumpPanel trace={selected!} />
                            </>
                        }
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>}

      {/* 페이지네이션 (테이블 모드) */}
      {viewMode === 'table' && totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={pageBtn}>
            ← 이전
          </button>
          <span style={{ color: '#94a3b8', fontSize: 13, alignSelf: 'center' }}>
            {page} / {totalPages}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={pageBtn}>
            다음 →
          </button>
        </div>
      )}
    </div>
  );
}

// ── 응답시간 분포 히스토그램 ────────────────────────────────

const BUCKETS = [
  { label: '0~100ms',    min: 0,    max: 100,  color: '#34d399' },
  { label: '100~300ms',  min: 100,  max: 300,  color: '#6366f1' },
  { label: '300~500ms',  min: 300,  max: 500,  color: '#fbbf24' },
  { label: '500ms~1s',   min: 500,  max: 1000, color: '#fb923c' },
  { label: '1s~3s',      min: 1000, max: 3000, color: '#f87171' },
  { label: '3s+',        min: 3000, max: Infinity, color: '#dc2626' },
];

function ResponseTimeHistogram({ items }: { items: TraceListItem[] }) {
  const data = BUCKETS.map(b => ({
    label: b.label,
    count: items.filter(i => i.duration_ms >= b.min && i.duration_ms < b.max).length,
    color: b.color,
  })).filter(d => d.count > 0);

  if (data.length === 0) return null;

  const CustomBarTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d = payload[0].payload;
    return (
      <div style={{ background: '#1e2035', border: '1px solid #2d3148', borderRadius: 6, padding: '6px 10px', fontSize: 12 }}>
        <div style={{ color: d.color, fontWeight: 600 }}>{d.label}</div>
        <div style={{ color: '#e2e8f0', marginTop: 2 }}>{d.count.toLocaleString()}건</div>
        <div style={{ color: '#64748b', marginTop: 2 }}>
          {((d.count / items.length) * 100).toFixed(1)}%
        </div>
      </div>
    );
  };

  return (
    <div className="card" style={{ marginBottom: 16, padding: '14px 16px 8px' }}>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10, fontWeight: 500 }}>응답시간 분포</div>
      <ResponsiveContainer width="100%" height={100}>
        <BarChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%">
          <XAxis dataKey="label" tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis hide />
          <ReTooltip content={<CustomBarTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey="count" radius={[3, 3, 0, 0]}>
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── 산점도 뷰 ────────────────────────────────────────────

interface ScatterPoint {
  x: number;       // timestamp ms
  y: number;       // duration_ms
  trace_id: string;
  service: string;
  root_name: string;
  status: 'OK' | 'ERROR';
  span_count: number;
}

function ScatterView({
  items, loading, selected, onSelect,
}: {
  items: TraceListItem[];
  loading: boolean;
  selected: TraceDetail | null;
  onSelect: (item: TraceListItem) => void;
}) {
  const toPoint = (t: TraceListItem): ScatterPoint => ({
    x:          new Date(t.start_time).getTime(),
    y:          t.duration_ms,
    trace_id:   t.trace_id,
    service:    t.service,
    root_name:  t.root_name,
    status:     t.status,
    span_count: t.span_count,
  });

  const okData    = items.filter(t => t.status === 'OK').map(toPoint);
  const errorData = items.filter(t => t.status === 'ERROR').map(toPoint);

  const tickFmt = (v: number) => format(new Date(v), 'HH:mm:ss');

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const d: ScatterPoint = payload[0].payload;
    return (
      <div style={{
        background: '#1e2035', border: '1px solid #2d3148',
        borderRadius: 6, padding: '8px 12px', fontSize: 12,
      }}>
        <div style={{ color: '#94a3b8', marginBottom: 4 }}>{format(new Date(d.x), 'HH:mm:ss.SSS')}</div>
        <div style={{ color: '#e2e8f0', fontWeight: 600, marginBottom: 2 }}>{d.service}</div>
        <div style={{ maxWidth: 220 }}>
          <RootNameCell rootName={d.root_name} />
        </div>
        <div style={{ marginTop: 4, display: 'flex', gap: 12 }}>
          <span style={{ color: d.y > 1000 ? '#f87171' : d.y > 500 ? '#fb923c' : '#34d399' }}>
            {d.y.toFixed(1)} ms
          </span>
          <span style={{ color: '#64748b' }}>{d.span_count}개 스팬</span>
          <span style={{ color: d.status === 'ERROR' ? '#f87171' : '#6366f1' }}>{d.status}</span>
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: '#475569' }}>클릭하여 Waterfall 보기</div>
      </div>
    );
  };

  const handleClick = (point: ScatterPoint) => {
    const item = items.find(t => t.trace_id === point.trace_id);
    if (item) onSelect(item);
  };

  return (
    <div>
      {/* 카운트 정보 */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 13, color: '#64748b' }}>
        <span>총 <b style={{ color: '#e2e8f0' }}>{items.length}</b>건</span>
        <span style={{ color: '#6366f1' }}>● OK: {okData.length}</span>
        <span style={{ color: '#f87171' }}>● ERROR: {errorData.length}</span>
        {loading && <span style={{ color: '#475569' }}>갱신 중...</span>}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#475569' }}>15초마다 자동 갱신</span>
      </div>

      {/* 산점도 */}
      <div className="card" style={{ padding: '16px 8px 8px' }}>
        {items.length === 0 ? (
          <div style={{ textAlign: 'center', color: '#64748b', padding: 40, fontSize: 14 }}>
            수집된 트레이스가 없습니다.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={380}>
            <ScatterChart margin={{ top: 10, right: 24, left: 0, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" />
              <XAxis
                dataKey="x" type="number"
                domain={['auto', 'auto']}
                tickFormatter={tickFmt}
                tick={{ fontSize: 11, fill: '#64748b' }}
                name="시각"
              />
              <YAxis
                dataKey="y" type="number"
                tick={{ fontSize: 11, fill: '#64748b' }}
                name="응답시간"
                unit="ms"
                width={60}
              />
              <ReTooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3', stroke: '#475569' }} />
              {/* 500ms, 1000ms 경계선 */}
              <ReferenceLine y={500}  stroke="#fb923c" strokeDasharray="4 4" strokeOpacity={0.5}
                label={{ value: '500ms', position: 'insideTopRight', fontSize: 10, fill: '#fb923c' }} />
              <ReferenceLine y={1000} stroke="#f87171" strokeDasharray="4 4" strokeOpacity={0.5}
                label={{ value: '1s', position: 'insideTopRight', fontSize: 10, fill: '#f87171' }} />
              {/* OK 트레이스 */}
              <Scatter
                name="OK"
                data={okData}
                fill="#6366f1"
                fillOpacity={0.75}
                onClick={(d: ScatterPoint) => handleClick(d)}
                cursor="pointer"
              />
              {/* ERROR 트레이스 */}
              <Scatter
                name="ERROR"
                data={errorData}
                fill="#f87171"
                fillOpacity={0.9}
                onClick={(d: ScatterPoint) => handleClick(d)}
                cursor="pointer"
              />
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* 선택된 트레이스 Waterfall */}
      {selected && (
        <div className="card" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
            선택된 트레이스: <span style={{ color: '#e2e8f0', fontFamily: 'monospace' }}>
              {selected.trace_id.slice(0, 16)}…
            </span>
          </div>
          <TraceWaterfall trace={selected} />
        </div>
      )}
    </div>
  );
}

// ── 스레드 덤프 패널 ──────────────────────────────────────

function ThreadDumpPanel({ trace }: { trace: TraceDetail }) {
  const rootSpan = trace.spans.find(s => !s.parent_span_id) ?? trace.spans[0];
  const service  = rootSpan?.service;
  const instance = rootSpan?.instance;

  const [status, setStatus]   = useState<'idle' | 'collecting' | 'done' | 'timeout'>('idle');
  const [dumpText, setDumpText] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 트레이스가 바뀌면 상태 초기화
  useEffect(() => {
    setStatus('idle');
    setDumpText(null);
    setExpanded(false);
    if (pollRef.current) clearInterval(pollRef.current);
  }, [trace.trace_id]);

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  const handleCollect = async () => {
    if (!service || !instance) return;
    setStatus('collecting');
    setDumpText(null);

    let reqId: number;
    try {
      const req = await apiPost<{ id: number }>('/api/thread-dumps/request', { service, instance });
      reqId = req.id;
    } catch {
      setStatus('timeout');
      return;
    }

    let elapsed = 0;
    pollRef.current = setInterval(async () => {
      elapsed += 3;
      try {
        const r = await apiFetch<{ status: string; dump_id: number | null }>(
          `/api/thread-dumps/request/${reqId}`
        );
        if (r.status === 'collected' && r.dump_id) {
          clearInterval(pollRef.current!);
          const dump = await apiFetch<{ dump_text: string }>(`/api/thread-dumps/${r.dump_id}`);
          setDumpText(dump.dump_text);
          setStatus('done');
          setExpanded(true);
        } else if (r.status === 'timeout' || r.status === 'failed' || elapsed >= 33) {
          clearInterval(pollRef.current!);
          setStatus('timeout');
        }
      } catch { /* 무시 */ }
    }, 3000);
  };

  const handleDownload = () => {
    if (!dumpText) return;
    const blob = new Blob([dumpText], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = `thread-dump_${instance}_${trace.trace_id.slice(0, 8)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!service || !instance) return null;

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #2d3148', paddingTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: '#64748b' }}>
          인스턴스: <span style={{ color: '#94a3b8' }}>{instance}</span>
        </span>
        <button
          onClick={handleCollect}
          disabled={status === 'collecting'}
          style={{
            padding: '4px 12px',
            background: status === 'collecting' ? '#374151' : '#6366f1',
            color: '#fff', border: 'none', borderRadius: 5,
            cursor: status === 'collecting' ? 'not-allowed' : 'pointer',
            fontSize: 12, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 6,
          }}
        >
          {status === 'collecting' && (
            <span style={{
              display: 'inline-block', width: 10, height: 10,
              border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            }} />
          )}
          {status === 'collecting' ? '수집 중...' : '스레드 덤프 수집'}
        </button>

        {status === 'done' && (
          <>
            <button
              onClick={() => setExpanded(e => !e)}
              style={{ padding: '4px 10px', background: '#1e3a5f', color: '#93c5fd', border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}
            >
              {expanded ? '접기' : '덤프 보기'}
            </button>
            <button
              onClick={handleDownload}
              style={{ padding: '4px 10px', background: '#1e2035', color: '#94a3b8', border: '1px solid #2d3148', borderRadius: 5, cursor: 'pointer', fontSize: 12 }}
            >
              다운로드
            </button>
          </>
        )}

        {status === 'timeout' && (
          <span style={{ fontSize: 12, color: '#f87171' }}>
            수집 실패 — companion 스크립트가 실행 중인지 확인하세요
          </span>
        )}
      </div>

      {expanded && dumpText && (
        <pre style={{
          marginTop: 10,
          padding: '12px 14px',
          background: '#0f172a',
          border: '1px solid #1e3a5f',
          borderRadius: 6,
          fontSize: 11,
          lineHeight: 1.6,
          color: '#d1fae5',
          overflowX: 'auto',
          maxHeight: 400,
          overflowY: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
        }}>
          {dumpText}
        </pre>
      )}
    </div>
  );
}

// HTTP 메서드 뱃지 색상
const METHOD_COLORS: Record<string, { bg: string; text: string }> = {
  GET:     { bg: '#14532d', text: '#4ade80' },
  POST:    { bg: '#1e1b4b', text: '#818cf8' },
  PUT:     { bg: '#431407', text: '#fb923c' },
  PATCH:   { bg: '#2e1065', text: '#c084fc' },
  DELETE:  { bg: '#450a0a', text: '#f87171' },
  HEAD:    { bg: '#1e293b', text: '#64748b' },
  OPTIONS: { bg: '#1e293b', text: '#64748b' },
};

// 정적 리소스로 판별할 확장자 목록
const STATIC_EXTS = [
  '.js', '.mjs', '.ts',
  '.css', '.scss', '.less',
  '.html', '.htm',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.map', '.json',
  '.mp4', '.mp3', '.ogg', '.wav', '.webm',
  '.pdf', '.zip',
];

function parseRootName(rootName: string): { method: string | null; path: string } {
  const methods = ['DELETE', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'GET', 'HEAD'];
  for (const m of methods) {
    if (rootName.startsWith(m + ' ')) return { method: m, path: rootName.slice(m.length + 1) };
  }
  return { method: null, path: rootName };
}

function isStaticPath(path: string): boolean {
  const lower = path.toLowerCase().split('?')[0];
  return STATIC_EXTS.some(ext => lower.endsWith(ext));
}

function RootNameCell({ rootName }: { rootName: string }) {
  const { method, path } = parseRootName(rootName);
  const methodColor = method ? (METHOD_COLORS[method] ?? { bg: '#1e293b', text: '#94a3b8' }) : null;
  const isStatic = isStaticPath(path);

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden', minWidth: 0 }}>
      {/* HTTP 메서드 뱃지 */}
      {methodColor && (
        <span style={{
          flexShrink: 0, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
          padding: '1px 5px', borderRadius: 3,
          background: methodColor.bg, color: methodColor.text,
          fontFamily: 'monospace',
        }}>
          {method}
        </span>
      )}
      {/* 경로 */}
      <span style={{
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: isStatic ? '#64748b' : '#e2e8f0', fontSize: 13, flex: 1,
      }}>
        {path || rootName}
      </span>
      {/* 정적 리소스 뱃지 */}
      {isStatic && (
        <span style={{
          flexShrink: 0, fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
          background: '#1e293b', color: '#475569', border: '1px solid #334155',
          letterSpacing: '0.03em',
        }}>
          정적
        </span>
      )}
    </span>
  );
}

function statusColor(s: Status) {
  if (s === 'ERROR') return '#ef4444';
  if (s === 'OK')    return '#22c55e';
  return '#6366f1';
}
function durationColor(ms: number) {
  if (ms > 1000) return '#f87171';
  if (ms > 500)  return '#fb923c';
  return '#e2e8f0';
}

const selStyle: React.CSSProperties = {
  background: '#252840', border: '1px solid #2d3148',
  color: '#e2e8f0', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer',
};
const btnStyle: React.CSSProperties = {
  border: 'none', borderRadius: 6, padding: '6px 12px',
  fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
};
const thS: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontWeight: 500, fontSize: 12 };
const tdS: React.CSSProperties = { padding: '10px 14px' };
const pageBtn: React.CSSProperties = {
  background: '#252840', border: '1px solid #2d3148', color: '#94a3b8',
  borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontSize: 13,
};
