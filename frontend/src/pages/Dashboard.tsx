import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePolling, apiFetch } from '../hooks/useApi';
import { useMetricsStream } from '../hooks/useWebSocket';
import { useLocalStorageString } from '../hooks/useLocalStorage';
import { Overview, TraceDetail } from '../types';
import StatCard from '../components/StatCard';
import type { DeploymentMarker } from '../components/MetricChart';
import InsightsPanel from '../components/dashboard/InsightsPanel';
import ScatterTransactionChart from '../components/dashboard/ScatterTransactionChart';
import MiniTimeChart from '../components/dashboard/MiniTimeChart';
import SearchableSelect from '../components/dashboard/SearchableSelect';
import ActiveTransactionsPanel from '../components/dashboard/ActiveTransactionsPanel';
import TraceCallTreeModal from '../components/dashboard/TraceCallTreeModal';
import type {
  Range, Level, Insight, RatePoint, ActiveAlert, TopEndpoint,
  RecentError, ServiceActivity, InstanceActivity, ScatterPoint, ActiveSummary,
} from '../types/dashboard';
import { rtColor, errColor, severityColor, stripMethod } from '../utils/dashboardColors';
import TraceWaterfall from '../components/TraceWaterfall';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { useGlobalTime } from '../contexts/GlobalTimeContext';
import CustomDashboard from './CustomDashboard';

const CUSTOM_DASHBOARD_KEY = 'hamster_custom_dashboard_v1';
const RANGES: Range[] = ['1h', '6h', '24h', '7d'];

const thS: React.CSSProperties = { padding: '8px 14px', textAlign: 'left', fontWeight: 500, fontSize: 12 };
const tdS: React.CSSProperties = { padding: '10px 14px' };
const selStyle: React.CSSProperties = {
  background: '#252840', border: '1px solid #2d3148',
  color: '#e2e8f0', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer',
};
const btnStyle: React.CSSProperties = {
  border: 'none', borderRadius: 6, padding: '6px 12px',
  fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { globalRange, setGlobalRange } = useGlobalTime();
  const [range, setRangeLocal] = useState<Range>(globalRange as Range);
  const setRange = (r: Range) => { setRangeLocal(r); setGlobalRange(r); };
  const [defaultLevel] = useLocalStorageString('dashboard_default_level', 'instance');
  const [level, setLevel] = useState<Level>((defaultLevel as Level) || 'instance');
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

  // 폴링 주기: 실시간성이 중요한 지표는 짧게, 변화가 느린 집계는 길게.
  const { data: overview, lastUpdated } = usePolling<Overview>(
    () => apiFetch('/api/metrics/overview'), 3_000,
  );
  const { data: activeSummary } = usePolling<ActiveSummary[]>(
    () => apiFetch('/api/dashboard/active-summary'),
    3_000,
  );
  const { data: activeAlerts } = usePolling<ActiveAlert[]>(
    () => apiFetch('/api/alerts/active'),
    5_000,
  );
  const { data: rateData } = usePolling<RatePoint[]>(
    () => apiFetch(`/api/dashboard/request-rate?range=${range}${filterParam}`),
    10_000, [range, filterParam],
  );
  const { data: scatterData } = usePolling<ScatterPoint[]>(
    () => apiFetch(`/api/dashboard/scatter?range=10m&limit=2000${filterParam}`),
    15_000, [filterParam],
  );
  const { data: topEndpoints } = usePolling<TopEndpoint[]>(
    () => apiFetch(`/api/dashboard/top-endpoints?range=${range}&limit=8${filterParam}`),
    15_000, [range, filterParam],
  );
  const { data: recentErrors } = usePolling<RecentError[]>(
    () => apiFetch(`/api/dashboard/recent-errors?limit=6${level === 'service' && service ? `&service=${service}` : ''}`),
    10_000, [service, level],
  );
  const { data: services } = usePolling<ServiceActivity[]>(
    () => apiFetch(`/api/dashboard/service-activity?range=${range}`),
    15_000, [range],
  );
  const { data: instances } = usePolling<InstanceActivity[]>(
    () => apiFetch(`/api/dashboard/instance-activity?range=${range}`),
    15_000, [range],
  );
  const { data: insights } = usePolling<Insight[]>(
    () => apiFetch('/api/insights'),
    30_000,
  );
  const { data: deployments } = usePolling<DeploymentMarker[]>(
    () => apiFetch(
      `/api/deployments?range=${range}${level === 'service' && service ? `&service=${service}` : ''}`
    ),
    30_000, [range, level, service],
  );

  const svcNames      = services?.map(s => s.service) || [];
  const instanceNames = instances?.map(i => i.instance) || [];

  // ── 실시간 WebSocket 스트림: 모든 서비스 합산한 대시보드 집계 ──
  const { snapshot: liveSnapshot, isConnected: liveConnected } = useMetricsStream();
  const liveAgg = useMemo(() => {
    if (!liveSnapshot?.services) return null;
    const entries = Object.entries(liveSnapshot.services);
    if (!entries.length) return null;

    // 레벨 필터 적용: 서비스 뷰에서 특정 서비스 선택 시 해당 서비스만 집계.
    const filtered = level === 'service' && service
      ? entries.filter(([name]) => name === service)
      : entries;
    if (!filtered.length) return null;

    let totalReq = 0;
    let totalErr = 0;
    let weightedMs = 0;
    let tpsSum = 0;
    filtered.forEach(([, m]) => {
      totalReq += m.request_count_5m || 0;
      totalErr += m.error_count_5m || 0;
      weightedMs += (m.avg_response_ms || 0) * (m.request_count_5m || 0);
      tpsSum += m.tps || 0;
    });
    return {
      tps: tpsSum,
      avgMs: totalReq > 0 ? weightedMs / totalReq : 0,
      errorRate: totalReq > 0 ? (totalErr / totalReq) * 100 : 0,
    };
  }, [liveSnapshot, level, service]);

  // 스트림 우선, 없으면 폴링 값으로 폴백
  const effTps = liveAgg
    ? liveAgg.tps
    : (rateData?.length ? rateData[rateData.length - 1].tps : null);
  const effAvgMs = liveAgg ? liveAgg.avgMs : (overview?.avg_response_time_ms ?? null);
  const effErrorRate = liveAgg ? liveAgg.errorRate : (overview?.error_rate_percent ?? null);

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
          {liveConnected ? (
            <span className="badge badge-ok" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span className="live-dot" />
              LIVE
            </span>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>연결 중…</span>
          )}
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
              aria-label={`활성 알림 ${activeAlerts?.length ?? 0}건`}
              aria-expanded={bellOpen}
              aria-haspopup="menu"
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
                stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                aria-hidden="true">
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

      {/* ── 상단 요약 카드 (5개, 반응형) ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 16 }}>
        <StatCard
          title={level === 'service' ? '서비스' : '인스턴스'}
          value={level === 'service' ? (overview?.services_count ?? '—') : (instances?.length ?? '—')}
          unit="개"
        />
        <StatCard
          title="현재 TPS"
          value={effTps != null ? effTps.toFixed(1) : '—'}
          unit=" req/s"
          color="#34d399"
        />
        <StatCard
          title="평균 응답시간"
          value={effAvgMs != null ? effAvgMs.toFixed(1) : '—'}
          unit="ms"
          color={rtColor(effAvgMs ?? undefined)}
        />
        <StatCard
          title="에러율 (5분)"
          value={effErrorRate != null ? effErrorRate.toFixed(2) : '0.00'}
          unit="%"
          color={errColor(effErrorRate ?? undefined)}
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16, alignItems: 'stretch' }}>
        <MiniTimeChart
          title="TPS (초당 트랜잭션)"
          data={rateData ?? []}
          dataKey="tps"
          color="#34d399"
          range={range}
          unit=" tps"
          deployments={deployments ?? []}
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16, alignItems: 'stretch' }}>
        {/* Top 엔드포인트 */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid #2d3148' }}>
            <span className="card-title" style={{ marginBottom: 0 }}>느린 엔드포인트 Top {topEndpoints?.length ?? 0}</span>
          </div>
          {!topEndpoints?.length ? (
            <p style={{ padding: '16px', color: '#475569', fontSize: 13 }}>데이터 없음</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
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
                    <td style={{ ...tdS }}>
                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#e2e8f0', maxWidth: '40vw' }}>
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
                    {err.count > 1 && (
                      <span style={{
                        fontSize: 10, color: '#fff', background: '#ef4444',
                        borderRadius: 10, padding: '1px 6px', fontWeight: 700,
                      }}>
                        {err.count}
                      </span>
                    )}
                    {!service && defaultLevel !== 'instance' && (
                      <span style={{ fontSize: 11, color: '#475569' }}>{err.service}</span>
                    )}
                    {err.trace_id && (
                      <Link
                        to={`/traces?trace_id=${err.trace_id}`}
                        onClick={e => e.stopPropagation()}
                        style={{ marginLeft: 'auto', fontSize: 10, color: '#6366f1', textDecoration: 'none', whiteSpace: 'nowrap' }}
                      >
                        트레이스 →
                      </Link>
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
