import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { usePolling, apiFetch } from '../hooks/useApi';
import { Overview, TraceDetail } from '../types';
import StatCard from '../components/StatCard';
import TraceWaterfall from '../components/TraceWaterfall';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useGlobalTime } from '../contexts/GlobalTimeContext';
import CustomDashboard from './CustomDashboard';

const CUSTOM_DASHBOARD_KEY = 'hamster_custom_dashboard_v1';

type Range = '1h' | '6h' | '24h' | '7d';
type Level = 'service' | 'instance';
const RANGES: Range[] = ['1h', '6h', '24h', '7d'];

interface Insight {
  level: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  service: string | null;
  link: string;
}

interface RatePoint {
  time: string;
  request_count: number;
  error_count: number;
  error_rate_pct: number;
  avg_ms: number;
  tps: number;
}
interface ActiveAlert {
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
interface ScatterPoint {
  ts: number;
  duration_ms: number;
  trace_id: string;
  service: string;
  root_name: string;
  status: 'OK' | 'ERROR';
}
interface ActiveTransaction {
  trace_id: string;
  span_name: string;
  duration_ms: number;
  status: 'OK' | 'ERROR';
  started_at: string | null;
}
interface ActiveSummary {
  service: string;
  instance: string;
  transactions: ActiveTransaction[];
}

export default function Dashboard() {
  const navigate = useNavigate();
  const { globalRange, setGlobalRange } = useGlobalTime();
  const [range, setRangeLocal] = useState<Range>(globalRange as Range);
  const setRange = (r: Range) => { setRangeLocal(r); setGlobalRange(r); };
  const defaultLevel = (localStorage.getItem('dashboard_default_level') as Level) || 'instance';
  const [level, setLevel] = useState<Level>(defaultLevel);
  const [service, setService] = useState('');
  const [instance, setInstance] = useState('');
  const [now, setNow] = useState(new Date());
  const [selectedTrace, setSelectedTrace] = useState<TraceDetail | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [activeCallTree, setActiveCallTree] = useState<{ traceId: string; spanName: string } | null>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const [dashTab, setDashTab] = useState<'default' | 'custom'>('default');
  const [hasCustomLayout, setHasCustomLayout] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(CUSTOM_DASHBOARD_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setHasCustomLayout(parsed?.items?.length > 0);
      } catch { /* ignore */ }
    }
  }, []);

  // 1초마다 현재 시간 갱신
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // 벨 외부 클릭 시 닫기
  useEffect(() => {
    if (!bellOpen) return;
    const handler = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setBellOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [bellOpen]);

  const handleDotClick = useCallback(async (traceId: string) => {
    if (traceLoading) return;
    if (selectedTrace?.trace_id === traceId) {
      setSelectedTrace(null);
      return;
    }
    setTraceLoading(true);
    try {
      const detail = await apiFetch<TraceDetail>(`/api/traces/${traceId}`);
      setSelectedTrace(detail);
    } finally {
      setTraceLoading(false);
    }
  }, [traceLoading, selectedTrace]);

  // 레벨에 따라 필터 파라미터 결정
  const filterParam = level === 'instance'
    ? (instance ? `&instance=${instance}` : '')
    : (service  ? `&service=${service}`   : '');

  const { data: overview, lastUpdated } = usePolling<Overview>(
    () => apiFetch('/api/metrics/overview'), 3_000,
  );
  const { data: services } = usePolling<ServiceActivity[]>(
    () => apiFetch(`/api/dashboard/service-activity?range=${range}`),
    3_000, [range],
  );
  const { data: instances } = usePolling<InstanceActivity[]>(
    () => apiFetch(`/api/dashboard/instance-activity?range=${range}`),
    3_000, [range],
  );
  const { data: rateData } = usePolling<RatePoint[]>(
    () => apiFetch(`/api/dashboard/request-rate?range=${range}${filterParam}`),
    3_000, [range, filterParam],
  );
  const { data: topEndpoints } = usePolling<TopEndpoint[]>(
    () => apiFetch(`/api/dashboard/top-endpoints?range=${range}&limit=8${filterParam}`),
    3_000, [range, filterParam],
  );
  const { data: recentErrors } = usePolling<RecentError[]>(
    () => apiFetch(`/api/dashboard/recent-errors?limit=6${level === 'service' && service ? `&service=${service}` : ''}`),
    3_000, [service, level],
  );
  const { data: scatterData } = usePolling<ScatterPoint[]>(
    () => apiFetch(`/api/dashboard/scatter?range=10m&limit=2000${filterParam}`),
    3_000, [filterParam],
  );
  const { data: activeAlerts } = usePolling<ActiveAlert[]>(
    () => apiFetch('/api/alerts/active'),
    3_000,
  );
  const { data: insights } = usePolling<Insight[]>(
    () => apiFetch('/api/insights'),
    10_000,
  );
  const { data: activeSummary } = usePolling<ActiveSummary[]>(
    () => apiFetch('/api/dashboard/active-summary'),
    3_000,
  );

  const svcNames      = services?.map(s => s.service) || [];
  const instanceNames = instances?.map(i => i.instance) || [];

  if (dashTab === 'custom') {
    return (
      <div>
        {/* 커스텀 대시보드 탭 헤더 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <div style={{
            display: 'flex', background: '#12141f',
            border: '1px solid #2d3148', borderRadius: 8, padding: 3,
          }}>
            <button
              onClick={() => setDashTab('default')}
              style={{
                padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: 'none', color: '#64748b', fontSize: 13, fontWeight: 500,
              }}
            >
              기본 대시보드
            </button>
            <button
              style={{
                padding: '5px 14px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: '#6366f1', color: '#fff', fontSize: 13, fontWeight: 600,
              }}
            >
              커스텀 대시보드
            </button>
          </div>
        </div>
        <CustomDashboard />
      </div>
    );
  }

  return (
    <div>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2 className="page-title" style={{ marginBottom: 0 }}>대시보드</h2>
          {/* 대시보드 탭 */}
          <div style={{
            display: 'flex', background: '#12141f',
            border: '1px solid #2d3148', borderRadius: 8, padding: 3,
          }}>
            <button
              style={{
                padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: '#6366f1', color: '#fff', fontSize: 12, fontWeight: 600,
              }}
            >
              기본
            </button>
            <button
              onClick={() => setDashTab('custom')}
              style={{
                padding: '4px 12px', borderRadius: 6, border: 'none', cursor: 'pointer',
                background: 'none', color: hasCustomLayout ? '#a5b4fc' : '#475569',
                fontSize: 12, fontWeight: 500, position: 'relative',
              }}
            >
              커스텀
              {hasCustomLayout && (
                <span style={{
                  position: 'absolute', top: 2, right: 2,
                  width: 6, height: 6, borderRadius: '50%',
                  background: '#6366f1',
                }} />
              )}
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ color: '#475569', fontSize: 12 }}>
            {format(now, 'yyyy-MM-dd HH:mm:ss')}
          </span>
          {lastUpdated && (
            <span style={{ color: '#334155', fontSize: 11 }}>
              갱신 {format(lastUpdated, 'HH:mm:ss')}
            </span>
          )}
          {/* 활성 알림 벨 아이콘 */}
          <div ref={bellRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setBellOpen(v => !v)}
              style={{
                position: 'relative', background: bellOpen ? '#252840' : 'none',
                border: '1px solid ' + (bellOpen ? '#6366f1' : '#2d3148'),
                borderRadius: 8, padding: '6px 8px', cursor: 'pointer',
                color: (activeAlerts?.length ?? 0) > 0 ? '#f87171' : '#64748b',
                display: 'flex', alignItems: 'center',
              }}
              title="활성 알림"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {(activeAlerts?.length ?? 0) > 0 && (
                <span style={{
                  position: 'absolute', top: -4, right: -4,
                  background: '#ef4444', color: '#fff',
                  borderRadius: '50%', width: 16, height: 16,
                  fontSize: 10, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {activeAlerts!.length > 9 ? '9+' : activeAlerts!.length}
                </span>
              )}
            </button>
            {bellOpen && (
              <div style={{
                position: 'absolute', top: '100%', right: 0, marginTop: 6,
                width: 360, background: '#1a1c2e', border: '1px solid #2d3148',
                borderRadius: 10, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                zIndex: 100, overflow: 'hidden',
              }}>
                <div style={{
                  padding: '12px 16px', borderBottom: '1px solid #2d3148',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 14 }}>활성 알림</span>
                  <Link
                    to="/alerts"
                    onClick={() => setBellOpen(false)}
                    style={{ color: '#6366f1', fontSize: 12, textDecoration: 'none' }}
                  >
                    전체 보기 →
                  </Link>
                </div>
                <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                  {!activeAlerts?.length ? (
                    <div style={{ padding: '20px 16px', color: '#475569', fontSize: 13, textAlign: 'center' }}>
                      활성 알림 없음 ✓
                    </div>
                  ) : (
                    activeAlerts.map(alert => (
                      <div key={alert.id} style={{
                        padding: '12px 16px', borderBottom: '1px solid #1e2035',
                        borderLeft: `3px solid ${severityColor(alert.severity)}`,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <span style={{
                            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                            color: severityColor(alert.severity),
                            background: severityColor(alert.severity) + '22',
                            padding: '2px 6px', borderRadius: 4,
                          }}>
                            {alert.severity}
                          </span>
                          <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500 }}>
                            {alert.rule_name}
                          </span>
                        </div>
                        <div style={{ color: '#94a3b8', fontSize: 12, marginBottom: 4, wordBreak: 'break-all' }}>
                          {alert.message}
                        </div>
                        <div style={{ display: 'flex', gap: 12, fontSize: 11, color: '#475569' }}>
                          {alert.service && <span>서비스: {alert.service}</span>}
                          <span>발화: {formatDistanceToNow(parseISO(alert.fired_at), { addSuffix: true, locale: ko })}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
          {/* 서비스 / 인스턴스 토글 — 설정에서 인스턴스 고정 시 숨김 */}
          {defaultLevel !== 'instance' && (
            <div style={{ display: 'flex', background: '#1e2235', borderRadius: 8, padding: 3 }}>
              {(['service', 'instance'] as Level[]).map(lv => (
                <button key={lv} onClick={() => { setLevel(lv); setService(''); setInstance(''); }}
                  style={{
                    ...btnStyle, padding: '4px 12px',
                    background: level === lv ? '#4f46e5' : 'transparent',
                    color: level === lv ? '#fff' : '#94a3b8',
                  }}>
                  {lv === 'service' ? '서비스' : '인스턴스'}
                </button>
              ))}
            </div>
          )}

          {/* 필터 드롭다운 */}
          {level === 'service' ? (
            <select value={service} onChange={e => setService(e.target.value)} style={selStyle}>
              <option value="">전체 서비스</option>
              {svcNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          ) : (
            <SearchableSelect
              value={instance}
              onChange={setInstance}
              options={instanceNames}
              placeholder="전체 인스턴스"
            />
          )}
          <div style={{ display: 'flex', gap: 4 }}>
            {RANGES.map(r => (
              <button key={r} onClick={() => setRange(r)}
                style={{ ...btnStyle, background: range === r ? '#6366f1' : '#252840', color: range === r ? '#fff' : '#94a3b8' }}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── 상단 요약 카드 (5개) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 16 }}>
        <StatCard
          title={level === 'service' ? '서비스' : '인스턴스'}
          value={level === 'service' ? (overview?.services_count ?? '—') : (instances?.length ?? '—')}
          unit="개"
        />
        <StatCard
          title="현재 TPS"
          value={rateData?.length ? (rateData[rateData.length - 1].tps?.toFixed(1) ?? '0.0') : '—'}
          unit=" req/s"
          color="#34d399"
        />
        <StatCard
          title="평균 응답시간"
          value={overview?.avg_response_time_ms?.toFixed(1) ?? '—'}
          unit="ms"
          color={rtColor(overview?.avg_response_time_ms)}
        />
        <StatCard
          title="에러율 (5분)"
          value={overview?.error_rate_percent?.toFixed(2) ?? '0.00'}
          unit="%"
          color={errColor(overview?.error_rate_percent)}
        />
        <StatCard
          title="활성 거래 (30초)"
          value={activeSummary?.reduce((s, g) => s + g.transactions.length, 0) ?? 0}
          unit="건"
          color={
            (activeSummary?.reduce((s, g) => s + g.transactions.length, 0) ?? 0) > 0
              ? '#a5b4fc' : undefined
          }
        />
      </div>

      {/* ── 인사이트 배너 ── */}
      {insights && insights.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <InsightsPanel insights={insights} />
        </div>
      )}

      {/* ── 1행: TPS 차트(좌) + 실시간 활성 거래(우) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <MiniTimeChart
          title="TPS (초당 트랜잭션)"
          data={rateData ?? []}
          dataKey="tps"
          color="#34d399"
          range={range}
          unit=" tps"
        />
        <ActiveTransactionsPanel
          data={activeSummary ?? []}
          onTraceClick={(traceId, spanName) => setActiveCallTree({ traceId, spanName })}
          hideService={defaultLevel === 'instance'}
        />
      </div>

      {/* ── 2행: 산점도 (전체 너비) ── */}
      <div style={{ marginBottom: 16 }}>
        <ScatterTransactionChart
          data={scatterData ?? []}
          selectedTraceId={selectedTrace?.trace_id ?? null}
          onDotClick={handleDotClick}
          hideService={defaultLevel === 'instance'}
        />
      </div>

      {/* ── 선택된 트레이스 Waterfall (전체 너비) ── */}
      {(selectedTrace || traceLoading) && (
        <div className="card" style={{ position: 'relative', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span className="card-title" style={{ marginBottom: 0 }}>트레이스 스택</span>
            <button onClick={() => setSelectedTrace(null)}
              style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
          </div>
          {traceLoading
            ? <div style={{ color: '#475569', fontSize: 13, padding: '24px 0', textAlign: 'center' }}>로딩 중…</div>
            : selectedTrace && <TraceWaterfall trace={selectedTrace} />}
        </div>
      )}

      {/* ── 3행: 느린 엔드포인트(좌) + 최근 에러(우) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16, alignItems: 'start' }}>
        {/* Top 엔드포인트 */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid #2d3148' }}>
            <span className="card-title" style={{ marginBottom: 0 }}>느린 엔드포인트 Top {topEndpoints?.length ?? 0}</span>
          </div>
          {!topEndpoints?.length ? (
            <p style={{ padding: '16px', color: '#475569', fontSize: 13 }}>데이터 없음</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ color: '#64748b', borderBottom: '1px solid #2d3148' }}>
                  <th style={thS}>엔드포인트</th>
                  <th style={{ ...thS, textAlign: 'right' }}>Avg</th>
                  <th style={{ ...thS, textAlign: 'right' }}>P95</th>
                  <th style={{ ...thS, textAlign: 'right' }}>에러율</th>
                </tr>
              </thead>
              <tbody>
                {topEndpoints.map((ep, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #1e2035' }}>
                    <td style={{ ...tdS, maxWidth: 200 }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#e2e8f0' }}>
                        {stripMethod(ep.name)}
                      </div>
                      {!service && defaultLevel !== 'instance' && (
                        <div style={{ color: '#475569', fontSize: 11 }}>{ep.service}</div>
                      )}
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', color: rtColor(ep.avg_ms) }}>
                      {ep.avg_ms.toFixed(0)}ms
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', color: rtColor(ep.p95_ms) }}>
                      {ep.p95_ms.toFixed(0)}ms
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', color: ep.error_rate_pct > 0 ? '#f87171' : '#34d399' }}>
                      {ep.error_rate_pct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ padding: '10px 16px', borderTop: '1px solid #2d3148' }}>
            <Link to="/traces" style={{ color: '#6366f1', fontSize: 12, textDecoration: 'none' }}>
              트레이스 전체 보기 →
            </Link>
          </div>
        </div>

        {/* 최근 미해결 에러 */}
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span className="card-title" style={{ marginBottom: 0 }}>최근 미해결 에러</span>
            <Link to="/errors?resolved=false" style={{ color: '#6366f1', fontSize: 12, textDecoration: 'none' }}>
              전체 보기 →
            </Link>
          </div>
          {!recentErrors?.length ? (
            <p style={{ color: '#475569', fontSize: 13 }}>미해결 에러 없음 ✓</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {recentErrors.map(err => (
                <div key={err.id} style={{
                  padding: '10px 12px', background: '#1e2035', borderRadius: 6,
                  borderLeft: '3px solid #ef4444',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 12, color: '#fca5a5', fontWeight: 600 }}>
                      {err.error_type}
                    </span>
                    {!service && defaultLevel !== 'instance' && (
                      <span style={{ fontSize: 11, color: '#475569' }}>{err.service}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {err.message}
                  </div>
                  <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>
                    {formatDistanceToNow(parseISO(err.time), { addSuffix: true, locale: ko })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 거래 콜트리 모달 */}
      {activeCallTree && (
        <TraceCallTreeModal
          traceId={activeCallTree.traceId}
          spanName={activeCallTree.spanName}
          onClose={() => setActiveCallTree(null)}
        />
      )}

      {/* ── 서비스 / 인스턴스 상태 (전체 너비) ── */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 10px', borderBottom: '1px solid #2d3148', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="card-title" style={{ marginBottom: 0 }}>
            {level === 'service' ? '서비스 상태' : '인스턴스 상태'}
          </span>
          <span style={{ color: '#475569', fontSize: 12 }}>{range} 기준</span>
        </div>

        {level === 'service' ? (
          /* ── 서비스 테이블 ── */
          !services?.length ? (
            <p style={{ padding: 16, color: '#475569', fontSize: 13 }}>
              연결된 서비스가 없습니다. Java Agent를 연결하거나 테스트 스크립트를 실행하세요.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#64748b', borderBottom: '1px solid #2d3148', background: '#1e2035' }}>
                  <th style={thS}>서비스</th>
                  <th style={thS}>상태</th>
                  <th style={{ ...thS, textAlign: 'right' }}>요청 수</th>
                  <th style={{ ...thS, textAlign: 'right' }}>에러율</th>
                  <th style={{ ...thS, textAlign: 'right' }}>평균 응답시간</th>
                  <th style={thS}>마지막 수신</th>
                  <th style={thS}></th>
                </tr>
              </thead>
              <tbody>
                {services.map(svc => {
                  const errRate = svc.request_count > 0 ? (svc.error_count / svc.request_count * 100) : 0;
                  return (
                    <tr key={svc.service}
                      style={{
                        borderBottom: '1px solid #1e2035', cursor: 'pointer',
                        borderLeft: `3px solid ${svc.is_alive ? '#22c55e' : '#ef4444'}`,
                        background: svc.is_alive ? 'transparent' : '#1a0808',
                        transition: 'background 0.1s',
                      }}
                      onClick={() => navigate(`/metrics?service=${svc.service}`)}
                      onMouseEnter={e => { if (svc.is_alive) e.currentTarget.style.background = '#1e2035'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = svc.is_alive ? 'transparent' : '#1a0808'; }}
                    >
                      <td style={{ ...tdS, fontWeight: 500, color: '#f1f5f9' }}>{svc.service}</td>
                      <td style={tdS}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          fontSize: 12, fontWeight: 700,
                          color: svc.is_alive ? '#4ade80' : '#f87171',
                        }}>
                          <span style={{
                            width: 7, height: 7, borderRadius: '50%',
                            background: svc.is_alive ? '#22c55e' : '#ef4444',
                            boxShadow: svc.is_alive ? '0 0 6px #22c55e80' : 'none',
                            flexShrink: 0,
                          }} />
                          {svc.is_alive ? 'UP' : 'DOWN'}
                        </span>
                      </td>
                      <td style={{ ...tdS, textAlign: 'right', color: '#94a3b8' }}>
                        {svc.request_count.toLocaleString()}
                      </td>
                      <td style={{ ...tdS, textAlign: 'right' }}>
                        <span style={{ color: errRate > 5 ? '#f87171' : errRate > 1 ? '#fb923c' : '#4ade80', fontWeight: errRate > 0 ? 600 : 400 }}>
                          {errRate.toFixed(1)}%
                        </span>
                      </td>
                      <td style={{ ...tdS, textAlign: 'right', color: rtColor(svc.avg_ms) }}>
                        {svc.avg_ms != null ? `${svc.avg_ms.toFixed(1)} ms` : '—'}
                      </td>
                      <td style={{ ...tdS, color: '#475569', fontSize: 12 }}>
                        {svc.last_seen
                          ? formatDistanceToNow(parseISO(svc.last_seen), { addSuffix: true, locale: ko })
                          : '—'}
                      </td>
                      <td style={tdS}>
                        <span style={{ color: '#6366f1', fontSize: 12 }}>메트릭 →</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        ) : (
          /* ── 인스턴스 테이블 ── */
          !instances?.length ? (
            <p style={{ padding: 16, color: '#475569', fontSize: 13 }}>
              인스턴스 데이터가 없습니다.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#64748b', borderBottom: '1px solid #2d3148', background: '#1e2035' }}>
                  {defaultLevel !== 'instance' && <th style={thS}>서비스</th>}
                  <th style={thS}>인스턴스</th>
                  <th style={thS}>상태</th>
                  <th style={{ ...thS, textAlign: 'right' }}>요청 수</th>
                  <th style={{ ...thS, textAlign: 'right' }}>에러율</th>
                  <th style={{ ...thS, textAlign: 'right' }}>평균 응답시간</th>
                  <th style={thS}>마지막 수신</th>
                </tr>
              </thead>
              <tbody>
                {instances.map(ins => {
                  const errRate = ins.request_count > 0 ? (ins.error_count / ins.request_count * 100) : 0;
                  return (
                    <tr key={ins.instance}
                      style={{
                        borderBottom: '1px solid #1e2035', cursor: 'pointer',
                        borderLeft: `3px solid ${ins.is_alive ? '#22c55e' : '#ef4444'}`,
                        background: ins.is_alive
                          ? (instance === ins.instance ? '#1e2340' : 'transparent')
                          : '#1a0808',
                        transition: 'background 0.1s',
                      }}
                      onClick={() => setInstance(prev => prev === ins.instance ? '' : ins.instance)}
                      onMouseEnter={e => { if (ins.is_alive && instance !== ins.instance) e.currentTarget.style.background = '#1e2035'; }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = ins.is_alive
                          ? (instance === ins.instance ? '#1e2340' : 'transparent')
                          : '#1a0808';
                      }}
                    >
                      {defaultLevel !== 'instance' && <td style={{ ...tdS, color: '#64748b', fontSize: 12 }}>{ins.service}</td>}
                      <td style={{ ...tdS, fontWeight: 500, color: '#f1f5f9' }}>{ins.instance}</td>
                      <td style={tdS}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 5,
                          fontSize: 12, fontWeight: 700,
                          color: ins.is_alive ? '#4ade80' : '#f87171',
                        }}>
                          <span style={{
                            width: 7, height: 7, borderRadius: '50%',
                            background: ins.is_alive ? '#22c55e' : '#ef4444',
                            boxShadow: ins.is_alive ? '0 0 6px #22c55e80' : 'none',
                            flexShrink: 0,
                          }} />
                          {ins.is_alive ? 'UP' : 'DOWN'}
                        </span>
                      </td>
                      <td style={{ ...tdS, textAlign: 'right', color: '#94a3b8' }}>
                        {ins.request_count.toLocaleString()}
                      </td>
                      <td style={{ ...tdS, textAlign: 'right' }}>
                        <span style={{ color: errRate > 5 ? '#f87171' : errRate > 1 ? '#fb923c' : '#4ade80', fontWeight: errRate > 0 ? 600 : 400 }}>
                          {errRate.toFixed(1)}%
                        </span>
                      </td>
                      <td style={{ ...tdS, textAlign: 'right', color: rtColor(ins.avg_ms) }}>
                        {ins.avg_ms != null ? `${ins.avg_ms.toFixed(1)} ms` : '—'}
                      </td>
                      <td style={{ ...tdS, color: '#475569', fontSize: 12 }}>
                        {ins.last_seen
                          ? formatDistanceToNow(parseISO(ins.last_seen), { addSuffix: true, locale: ko })
                          : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        )}
      </div>
    </div>
  );
}

// ── 인사이트 패널 ─────────────────────────────────────────

const INSIGHT_ICON: Record<string, string> = {
  availability: '🔴',
  error:        '⚠️',
  performance:  '🐢',
  alert:        '🔔',
};

const LEVEL_COLOR: Record<string, string> = {
  critical: '#ef4444',
  warning:  '#fb923c',
  info:     '#60a5fa',
};

function InsightsPanel({ insights }: { insights: Insight[] }) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = React.useState(false);

  const criticalCount = insights.filter(i => i.level === 'critical').length;
  const warningCount  = insights.filter(i => i.level === 'warning').length;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', border: `1px solid ${criticalCount > 0 ? '#7f1d1d' : '#78350f'}` }}>
      <div
        style={{
          padding: '12px 16px',
          borderBottom: collapsed ? 'none' : '1px solid #2d3148',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', background: '#1a1c2e',
        }}
        onClick={() => setCollapsed(v => !v)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15 }}>🔍</span>
          <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 14 }}>자동 분석 인사이트</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {criticalCount > 0 && (
              <span style={{
                background: '#7f1d1d', color: '#fca5a5',
                fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
              }}>
                위험 {criticalCount}
              </span>
            )}
            {warningCount > 0 && (
              <span style={{
                background: '#78350f', color: '#fdba74',
                fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
              }}>
                경고 {warningCount}
              </span>
            )}
          </div>
        </div>
        <span style={{ color: '#475569', fontSize: 12 }}>{collapsed ? '▼ 펼치기' : '▲ 접기'}</span>
      </div>

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {insights.map((ins, i) => (
            <a
              key={i}
              href={ins.link}
              onClick={e => { e.preventDefault(); if (ins.link) navigate(ins.link); }}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '12px 16px',
                borderBottom: i < insights.length - 1 ? '1px solid #1e2035' : 'none',
                borderLeft: `3px solid ${LEVEL_COLOR[ins.level] ?? '#64748b'}`,
                textDecoration: 'none',
                background: 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1e2035')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                {INSIGHT_ICON[ins.category] ?? '💡'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    color: LEVEL_COLOR[ins.level],
                    background: LEVEL_COLOR[ins.level] + '22',
                    padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                  }}>
                    {ins.level === 'critical' ? '위험' : ins.level === 'warning' ? '경고' : '정보'}
                  </span>
                  <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ins.title}
                  </span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
                  {ins.description}
                </div>
              </div>
              <span style={{ color: '#475569', fontSize: 12, flexShrink: 0, marginTop: 2 }}>→</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 트랜잭션 산점도 차트 (Pure SVG) ──────────────────────

const PAD = { top: 8, right: 16, bottom: 28, left: 56 };
const SVG_H = 220;

function ScatterTransactionChart({
  data, selectedTraceId, onDotClick, hideService,
}: {
  data: ScatterPoint[];
  selectedTraceId: string | null;
  onDotClick: (traceId: string) => void;
  hideService?: boolean;
}) {
  const [tooltip, setTooltip] = useState<{ d: ScatterPoint; x: number; y: number } | null>(null);
  const [svgW, setSvgW]       = useState(800);
  const [now,  setNow]        = useState(() => new Date());
  
  // 드래그 선택 상태
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number, y: number } | null>(null);
  const [dragEnd, setDragEnd] = useState<{ x: number, y: number } | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<ScatterPoint[]>([]);

  const ref = React.useRef<SVGSVGElement>(null);

  // 매초 자체 갱신
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(e => setSvgW(e[0].contentRect.width));
    ro.observe(ref.current.parentElement!);
    return () => ro.disconnect();
  }, []);

  const windowMs = 10 * 60 * 1000;
  const xMax = now.getTime();
  const xMin = xMax - windowMs;
  const plotW = svgW - PAD.left - PAD.right;
  const plotH = SVG_H - PAD.top - PAD.bottom;

  const yMax = data.length > 0
    ? Math.ceil(Math.max(...data.map(d => d.duration_ms)) * 1.2 / 100) * 100
    : 1000;

  const toX = (ts: number) => Math.max(0, Math.min(plotW, ((ts - xMin) / windowMs) * plotW));
  const toY = (ms: number) => plotH - Math.max(0, Math.min(plotH, (ms / yMax) * plotH));

  // 절대 시각 기준 1분 배수 tick → xMin 변화에 따라 tick 위치가 실제로 이동
  const tickInterval = 60_000;
  const firstTick = Math.ceil(xMin / tickInterval) * tickInterval;
  const xTicks: number[] = [];
  for (let ts = firstTick; ts <= xMax; ts += tickInterval) {
    xTicks.push(ts);
  }
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => Math.round(r * yMax));

  // 마우스 이벤트 핸들러
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const svg = ref.current.getBoundingClientRect();
    const x = e.clientX - svg.left - PAD.left;
    const y = e.clientY - svg.top - PAD.top;
    if (x >= 0 && x <= plotW && y >= 0 && y <= plotH) {
      setIsDragging(true);
      setDragStart({ x, y });
      setDragEnd({ x, y });
      setSelectedPoints([]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !ref.current) return;
    const svg = ref.current.getBoundingClientRect();
    let x = e.clientX - svg.left - PAD.left;
    let y = e.clientY - svg.top - PAD.top;
    x = Math.max(0, Math.min(plotW, x));
    y = Math.max(0, Math.min(plotH, y));
    setDragEnd({ x, y });
  };

  const handleMouseUp = () => {
    if (!isDragging || !dragStart || !dragEnd) return;
    setIsDragging(false);
    
    const minX = Math.min(dragStart.x, dragEnd.x);
    const maxX = Math.max(dragStart.x, dragEnd.x);
    const minY = Math.min(dragStart.y, dragEnd.y);
    const maxY = Math.max(dragStart.y, dragEnd.y);
    
    // 클릭과 드래그 구분 (너무 작으면 초기화)
    if (maxX - minX < 5 && maxY - minY < 5) {
      setDragStart(null);
      setDragEnd(null);
      setSelectedPoints([]);
      return;
    }

    const points = data.filter(d => {
      const cx = toX(d.ts);
      const cy = toY(d.duration_ms);
      return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
    });
    
    // 트랜잭션 수신 시간(최신순) 혹은 소요 시간(느린순) 등을 정렬 기준 삼을 수 있습니다.
    // 여기서는 가장 느린 트랜잭션이 먼저 보이도록 소요 시간 역순 정렬
    points.sort((a, b) => b.duration_ms - a.duration_ms);
    setSelectedPoints(points);
  };

  return (
    <div className="card" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="card-title" style={{ marginBottom: 0 }}>
          트랜잭션 분포 ({data.length}건)
        </span>
        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#64748b' }}>
          <span><span style={{ color: '#6366f1' }}>●</span> 정상</span>
          <span><span style={{ color: '#ef4444' }}>●</span> 에러</span>
          <span style={{ color: '#475569' }}>드래그 → 범위 내 트랜잭션 목록 조회</span>
        </div>
      </div>

      <div style={{ position: 'relative', width: '100%', userSelect: 'none' }}>
        <svg
          ref={ref}
          width="100%" height={SVG_H}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={(e) => {
            setTooltip(null);
            handleMouseUp();
          }}
        >
          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {/* 격자 + Y축 눈금 */}
            {yTicks.map(v => (
              <g key={v}>
                <line x1={0} y1={toY(v)} x2={plotW} y2={toY(v)}
                  stroke="#2d3148" strokeWidth={1} strokeDasharray="3 3" />
                <text x={-6} y={toY(v)} dy="0.35em"
                  textAnchor="end" fill="#64748b" fontSize={10}>
                  {v}ms
                </text>
              </g>
            ))}

            {/* X축 눈금 (1분 단위) */}
            {xTicks.map(ts => (
              <g key={ts}>
                <line x1={toX(ts)} y1={0} x2={toX(ts)} y2={plotH}
                  stroke="#2d3148" strokeWidth={1} strokeDasharray="3 3" />
                <text x={toX(ts)} y={plotH + 16}
                  textAnchor="middle" fill="#64748b" fontSize={10}>
                  {format(new Date(ts), 'HH:mm')}
                </text>
              </g>
            ))}

            {/* 데이터 포인트 */}
            {data.map(d => {
              const cx = toX(d.ts);
              const cy = toY(d.duration_ms);
              const isSelected = d.trace_id === selectedTraceId;
              const isError    = d.status === 'ERROR';
              return (
                <circle
                  key={d.trace_id}
                  cx={cx} cy={cy}
                  r={isSelected ? 7 : 4}
                  fill={isError ? '#ef4444' : '#6366f1'}
                  fillOpacity={isSelected ? 1 : 0.7}
                  stroke={isSelected ? '#fff' : 'none'}
                  strokeWidth={isSelected ? 1.5 : 0}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onDotClick(d.trace_id)}
                  onMouseEnter={e => {
                    const svg = ref.current!.getBoundingClientRect();
                    setTooltip({ d, x: e.clientX - svg.left, y: e.clientY - svg.top });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              );
            })}

            {/* 드래그 선택 박스 */}
            {dragStart && dragEnd && (
              <rect
                x={Math.min(dragStart.x, dragEnd.x)}
                y={Math.min(dragStart.y, dragEnd.y)}
                width={Math.abs(dragEnd.x - dragStart.x)}
                height={Math.abs(dragEnd.y - dragStart.y)}
                fill="#6366f1"
                fillOpacity={0.2}
                stroke="#6366f1"
                strokeWidth={1}
                strokeDasharray="4 4"
                pointerEvents="none"
              />
            )}
          </g>
        </svg>

        {/* 툴팁 */}
        {tooltip && (
          <div style={{
            position: 'absolute',
            left: tooltip.x + 12, top: tooltip.y - 10,
            background: '#1e2035', border: '1px solid #2d3148',
            borderRadius: 6, padding: '10px 14px', fontSize: 12,
            pointerEvents: 'none', zIndex: 10, whiteSpace: 'nowrap',
          }}>
            <div style={{ color: tooltip.d.status === 'ERROR' ? '#f87171' : '#a5b4fc', fontWeight: 600, marginBottom: 4 }}>
              {stripMethod(tooltip.d.root_name)}
            </div>
            {!hideService && <div style={{ color: '#94a3b8' }}>서비스: <span style={{ color: '#e2e8f0' }}>{tooltip.d.service}</span></div>}
            <div style={{ color: '#94a3b8' }}>시간: <span style={{ color: '#e2e8f0' }}>{format(new Date(tooltip.d.ts), 'HH:mm:ss')}</span></div>
            <div style={{ color: '#94a3b8' }}>응답: <span style={{ color: '#e2e8f0' }}>{tooltip.d.duration_ms.toFixed(1)} ms</span></div>
            <div style={{ color: '#64748b', marginTop: 4, fontSize: 11 }}>클릭하여 스택 보기</div>
          </div>
        )}

        {/* 선택된 트랜잭션 목록 팝업 */}
        {selectedPoints.length > 0 && (
          <div style={{
            position: 'absolute',
            top: PAD.top, right: PAD.right, // 오른쪽 상단에 배치
            width: 380, maxHeight: plotH, overflowY: 'auto',
            background: '#1a1c2ee6', border: '1px solid #2d3148',
            borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: 20, display: 'flex', flexDirection: 'column',
            backdropFilter: 'blur(4px)',
          }}>
            <div style={{ 
              padding: '10px 14px', borderBottom: '1px solid #2d3148', display: 'flex', 
              justifyContent: 'space-between', alignItems: 'center', position: 'sticky', 
              top: 0, background: '#1a1c2ef2', zIndex: 21 
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>
                선택된 트랜잭션 ({selectedPoints.length}건)
              </span>
              <button
                onClick={() => { setSelectedPoints([]); setDragStart(null); setDragEnd(null); }}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
              >✕</button>
            </div>
            <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {selectedPoints.map(p => (
                <div
                  key={p.trace_id}
                  onClick={() => onDotClick(p.trace_id)}
                  style={{
                    padding: '8px 10px', borderRadius: 4, cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: selectedTraceId === p.trace_id ? '#252840' : 'transparent',
                    borderLeft: `3px solid ${p.status === 'ERROR' ? '#ef4444' : '#6366f1'}`
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#1e2035'}
                  onMouseLeave={e => e.currentTarget.style.background = selectedTraceId === p.trace_id ? '#252840' : 'transparent'}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: p.status === 'ERROR' ? '#fca5a5' : '#e2e8f0', fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {stripMethod(p.root_name)}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                      {format(new Date(p.ts), 'HH:mm:ss')}{!hideService && ` · ${p.service}`}
                    </div>
                  </div>
                  <div style={{ color: rtColor(p.duration_ms), fontSize: 12, fontWeight: 600, flexShrink: 0, paddingLeft: 10 }}>
                    {p.duration_ms.toFixed(1)} ms
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── 미니 시계열 차트 ────────────────────────────────────

function MiniTimeChart({
  title, data, dataKey, color, range, unit = '',
}: {
  title: string;
  data: RatePoint[];
  dataKey: keyof RatePoint;
  color: string;
  range: Range;
  unit?: string;
}) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="card-title">{title}</div>
      <div style={{ flex: 1, minHeight: 140 }}>
        {data.length === 0 ? (
          <div style={{ height: '100%', minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
            데이터 없음
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" />
              <XAxis
                dataKey="time"
                tickFormatter={v => format(parseISO(v), range === '7d' ? 'MM-dd' : 'HH:mm')}
                tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={false} tickLine={false}
              />
              <YAxis
                tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={false} tickLine={false} width={36}
              />
              <Tooltip
                contentStyle={{ background: '#1e2035', border: '1px solid #2d3148', borderRadius: 6, fontSize: 12 }}
                labelFormatter={v => format(parseISO(v as string), 'HH:mm:ss')}
                formatter={(v: number) => [`${v}${unit}`, title]}
              />
              <Area
                type="monotone" dataKey={dataKey as string}
                stroke={color} strokeWidth={2}
                fill={`url(#grad-${dataKey})`}
                dot={false} activeDot={{ r: 3 }} connectNulls
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

// ── 헬퍼 ──────────────────────────────────────────────

function rtColor(ms?: number | null) {
  if (!ms) return undefined;
  return ms > 1000 ? '#f87171' : ms > 500 ? '#fb923c' : '#34d399';
}
function errColor(pct?: number | null) {
  if (pct == null) return '#34d399';
  return pct > 5 ? '#f87171' : pct > 1 ? '#fb923c' : '#34d399';
}
function severityColor(severity: string) {
  return severity === 'critical' ? '#f87171' : severity === 'warning' ? '#fb923c' : '#60a5fa';
}

// HTTP 메서드 prefix 제거 (GET /path → /path)
function stripMethod(name: string): string {
  const methods = ['DELETE', 'OPTIONS', 'PATCH', 'POST', 'PUT', 'GET', 'HEAD'];
  for (const m of methods) {
    if (name.startsWith(m + ' ')) return name.slice(m.length + 1);
  }
  return name;
}

// ── 검색 가능한 드롭다운 ───────────────────────────────
function SearchableSelect({
  value, onChange, options, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = options.filter(o => o.toLowerCase().includes(query.toLowerCase()));

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(v => !v); setQuery(''); }}
        style={{
          background: '#252840', border: '1px solid #2d3148',
          color: value ? '#e2e8f0' : '#64748b', borderRadius: 6,
          padding: '6px 28px 6px 12px', fontSize: 13, cursor: 'pointer',
          textAlign: 'left', minWidth: 160, position: 'relative',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          maxWidth: 220,
        }}
      >
        {value || placeholder}
        <span style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          color: '#64748b', fontSize: 10, pointerEvents: 'none',
        }}>▼</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          background: '#1a1c2e', border: '1px solid #2d3148', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 200, minWidth: 220,
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid #1e2035' }}>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="검색..."
              style={{
                width: '100%', background: '#252840', border: '1px solid #2d3148',
                color: '#e2e8f0', borderRadius: 5, padding: '5px 9px', fontSize: 12,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            <div
              onClick={() => { onChange(''); setOpen(false); setQuery(''); }}
              style={{
                padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                color: !value ? '#a5b4fc' : '#94a3b8',
                background: !value ? '#1e1b4b' : 'transparent',
              }}
              onMouseEnter={e => { if (value) (e.currentTarget as HTMLDivElement).style.background = '#252840'; }}
              onMouseLeave={e => { if (value) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              {placeholder}
            </div>
            {filtered.map(o => (
              <div
                key={o}
                onClick={() => { onChange(o); setOpen(false); setQuery(''); }}
                style={{
                  padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                  color: value === o ? '#a5b4fc' : '#e2e8f0',
                  background: value === o ? '#1e1b4b' : 'transparent',
                }}
                onMouseEnter={e => { if (value !== o) (e.currentTarget as HTMLDivElement).style.background = '#252840'; }}
                onMouseLeave={e => { if (value !== o) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                {o}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '8px 12px', color: '#475569', fontSize: 12 }}>결과 없음</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const selStyle: React.CSSProperties = {
  background: '#252840', border: '1px solid #2d3148',
  color: '#e2e8f0', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer',
};
const btnStyle: React.CSSProperties = {
  border: 'none', borderRadius: 6, padding: '6px 12px',
  fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
};
// ── 실시간 활성 거래 패널 ────────────────────────────────
function ActiveTransactionsPanel({
  data, onTraceClick, hideService,
}: {
  data: ActiveSummary[];
  onTraceClick: (traceId: string, spanName: string) => void;
  hideService?: boolean;
}) {
  const rows = data
    .flatMap(g => g.transactions.map(tx => ({ ...tx, service: g.service, instance: g.instance })))
    .sort((a, b) => b.duration_ms - a.duration_ms);

  return (
    <div className="card" style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 16 }}>⚡</span>
          <span className="card-title" style={{ marginBottom: 0 }}>실시간 활성 거래</span>
          {rows.length > 0 && (
            <span style={{ fontSize: 11, background: '#312e81', color: '#a5b4fc', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>
              {rows.length}건
            </span>
          )}
        </div>
        <span style={{ fontSize: 12, color: '#475569' }}>응답 미수신(수행 중) · 지연 순 · 3초 갱신 · 클릭 시 콜트리 조회</span>
      </div>

      {!rows.length ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: '#475569', fontSize: 13 }}>
          현재 수행 중인 거래가 없습니다.
        </div>
      ) : (
        <div style={{ border: '1px solid #2d3148', borderRadius: 8, overflow: 'hidden' }}>
          {/* 고정 헤더 */}
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '25%' }} />  {/* 인스턴스(+서비스) */}
              <col />                             {/* 거래명 */}
              <col style={{ width: 96 }} />      {/* 지연시간 */}
              <col style={{ width: 56 }} />      {/* 상태 */}
            </colgroup>
            <thead>
              <tr style={{ background: '#12142a' }}>
                <th style={{ padding: '7px 14px', textAlign: 'left', fontSize: 11, color: '#475569', fontWeight: 500 }}>{hideService ? '인스턴스' : '서비스 / 인스턴스'}</th>
                <th style={{ padding: '7px 14px', textAlign: 'left', fontSize: 11, color: '#475569', fontWeight: 500 }}>거래명</th>
                <th style={{ padding: '7px 14px', textAlign: 'right', fontSize: 11, color: '#475569', fontWeight: 500 }}>지연 ▼</th>
                <th style={{ padding: '7px 14px', textAlign: 'center', fontSize: 11, color: '#475569', fontWeight: 500 }}>상태</th>
              </tr>
            </thead>
          </table>
          {/* 스크롤 영역 */}
          <div style={{ maxHeight: 280, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '25%' }} />
                <col />
                <col style={{ width: 96 }} />
                <col style={{ width: 56 }} />
              </colgroup>
              <tbody>
                {rows.map((tx) => (
                  <tr
                    key={tx.trace_id}
                    onClick={() => onTraceClick(tx.trace_id, tx.span_name)}
                    style={{ borderTop: '1px solid #1e2035', cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#1e2035')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* 인스턴스 (+ 서비스 - 인스턴스 모드에서 숨김) */}
                    <td style={{ padding: '7px 14px', overflow: 'hidden' }}>
                      {!hideService && (
                        <div style={{ fontSize: 12, color: '#818cf8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tx.service}
                        </div>
                      )}
                      <div style={{ fontSize: hideService ? 12 : 11, color: hideService ? '#818cf8' : '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: hideService ? 0 : 1 }}>
                        {tx.instance || '—'}
                      </div>
                    </td>
                    <td style={{ padding: '7px 14px', fontSize: 13, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {stripMethod(tx.span_name)}
                    </td>
                    <td style={{
                      padding: '7px 14px', textAlign: 'right', fontSize: 13,
                      fontVariantNumeric: 'tabular-nums', fontWeight: 600,
                      color: tx.duration_ms > 3000 ? '#f87171' : tx.duration_ms > 1000 ? '#fb923c' : '#34d399',
                    }}>
                      {tx.duration_ms >= 1000
                        ? `${(tx.duration_ms / 1000).toFixed(2)}s`
                        : `${Math.round(tx.duration_ms)}ms`}
                    </td>
                    <td style={{ padding: '7px 14px', textAlign: 'center' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 700, padding: '2px 5px', borderRadius: 3,
                        background: tx.status === 'ERROR' ? '#450a0a' : '#052e16',
                        color: tx.status === 'ERROR' ? '#fca5a5' : '#86efac',
                      }}>{tx.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const thS: React.CSSProperties = { padding: '8px 14px', textAlign: 'left', fontWeight: 500, fontSize: 12 };
const tdS: React.CSSProperties = { padding: '10px 14px' };

// ── 거래 콜트리 모달 ──────────────────────────────────────
function TraceCallTreeModal({ traceId, spanName, onClose }: {
  traceId: string;
  spanName: string;
  onClose: () => void;
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
        {/* 헤더 */}
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

        {/* 본문 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <div style={{ width: 36, height: 36, border: '3px solid #252840', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'ctSpin 1s linear infinite', margin: '0 auto 16px' }} />
              <div style={{ color: '#64748b', fontSize: 14 }}>콜트리 로딩 중...</div>
            </div>
          )}
          {error && (
            <div style={{ textAlign: 'center', padding: '80px 0', color: '#f87171', fontSize: 14 }}>{error}</div>
          )}
          {!loading && !error && trace && <TraceWaterfall trace={trace} />}
        </div>

        <div style={{ padding: '12px 24px', background: '#1a1c2e', borderTop: '1px solid #2d3148', display: 'flex', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onClose} style={{ padding: '8px 20px', background: '#374151', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>닫기</button>
        </div>
      </div>
      <style>{`@keyframes ctSpin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
