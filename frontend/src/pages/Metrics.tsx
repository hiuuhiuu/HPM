import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { usePolling, apiFetch } from '../hooks/useApi';
import { Service, ServiceSummary, Timeseries } from '../types';
import StatCard, { AnomalyInfo } from '../components/StatCard';
import MetricChart, { BaselineData, DeploymentMarker } from '../components/MetricChart';
import { useGlobalTime } from '../contexts/GlobalTimeContext';
import { useMetricsStream } from '../hooks/useWebSocket';
import PageHeader from '../components/PageHeader';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Legend
} from 'recharts';
import { format, parseISO } from 'date-fns';

type Range = '1h' | '6h' | '24h' | '7d';
const RANGES: Range[] = ['1h', '6h', '24h', '7d'];

// JVM 기본 차트 (항상 표시)
const JVM_CHARTS = [
  {
    key:    'jvm.cpu.usage',
    title:  'CPU 사용률',
    color:  '#6366f1',
    unit:   '%',
    transform: (v: number) => v * 100,
    decimals: 1,
  },
  {
    key:    'jvm.memory.used',
    title:  '힙 메모리 사용량',
    color:  '#10b981',
    unit:   'MB',
    transform: (v: number) => v / 1024 / 1024,
    decimals: 1,
  },
  {
    key:    'http.server.request.duration',
    title:  'HTTP 평균 응답시간',
    color:  '#f59e0b',
    unit:   'ms',
    transform: (v: number) => v * 1000,
    decimals: 1,
  },
  {
    key:    'jvm.threads.count',
    title:  'JVM 스레드 수',
    color:  '#ec4899',
    unit:   '개',
    decimals: 0,
  },
];

// WAS 전용 차트 후보 (해당 메트릭이 수집된 경우에만 표시)
// detect: 실제 DB에 저장되는 WAS별 원본 메트릭명 (하나라도 있으면 차트 활성화)
const WAS_CHART_CANDIDATES = [
  {
    key:     'was.threadpool.active',
    title:   'WAS 스레드풀 활성 스레드',
    color:   '#0ea5e9',
    unit:    '개',
    decimals: 0,
    detect:  ['jeus.threadpool.active', 'tomcat.threads.busy', 'weblogic.threadpool.execute_thread_total_count'],
  },
  {
    key:     'was.threadpool.total',
    title:   'WAS 스레드풀 전체 스레드',
    color:   '#8b5cf6',
    unit:    '개',
    decimals: 0,
    detect:  ['jeus.threadpool.max', 'tomcat.threads.current', 'weblogic.threadpool.thread_total_count'],
  },
  {
    key:     'was.jdbc.active',
    title:   'JDBC 활성 커넥션',
    color:   '#34d399',
    unit:    '개',
    decimals: 0,
    detect:  ['jeus.jcp.active', 'db.client.connections.usage', 'tomcat.jdbc.connections.active', 'weblogic.jdbc.connection_pool.active_count'],
  },
  {
    key:     'was.jdbc.wait',
    title:   'JDBC 대기 커넥션',
    color:   '#fb923c',
    unit:    '개',
    decimals: 0,
    detect:  ['jeus.jcp.wait', 'db.client.connections.pending_requests', 'weblogic.jdbc.connection_pool.waiting_for_connection_current_count'],
  },
];

export default function Metrics() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { globalRange, setGlobalRange } = useGlobalTime();
  const [selectedService, setSelectedService] = useState(searchParams.get('service') || '');
  const [range, setRangeLocal] = useState<Range>(globalRange as Range);
  const setRange = (r: Range) => { setRangeLocal(r); setGlobalRange(r); };
  const [availableMetrics, setAvailableMetrics] = useState<string[]>([]);

  // WebSocket 실시간 메트릭 스트림
  const { snapshot, isConnected: wsConnected } = useMetricsStream();
  const liveData = selectedService ? snapshot?.services?.[selectedService] : undefined;

  // 배포 마커 (서비스 변경 시 재조회, 30초 주기)
  const { data: deployments } = usePolling<DeploymentMarker[]>(
    () => selectedService
      ? apiFetch(`/api/deployments?service=${encodeURIComponent(selectedService)}&range=${range}`)
      : Promise.resolve([]),
    30_000, [selectedService, range],
  );

  // 통계적 베이스라인 (서비스·레인지 변경 시 재조회)
  const [baselines, setBaselines] = useState<Record<string, BaselineData | null>>({});
  useEffect(() => {
    if (!selectedService) return;
    const keys = allCharts.map(c => c.key).join(',');
    apiFetch<Record<string, BaselineData | null>>(
      `/api/metrics/${selectedService}/baselines?metrics=${encodeURIComponent(keys)}`
    ).then(res => setBaselines(res || {})).catch(() => setBaselines({}));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedService]);

  // 이상 감지: 현재 live 값이 베이스라인을 벗어나는지 판단 (표시 단위 기준)
  function checkAnomaly(
    displayValue: number | null | undefined,
    rawBaseline: BaselineData | null | undefined,
    transform?: (v: number) => number,
  ): AnomalyInfo | null {
    if (displayValue == null || !rawBaseline || !rawBaseline.stddev) return null;
    const t = transform ?? ((v: number) => v);
    const mean   = t(rawBaseline.mean);
    const stddev = t(rawBaseline.stddev);
    const upper  = t(rawBaseline.upper);
    const lower  = t(rawBaseline.lower);
    if (stddev <= 0) return null;
    if (displayValue > upper) return { sigma: (displayValue - mean) / stddev, direction: 'above' };
    if (displayValue < lower) return { sigma: (mean - displayValue) / stddev, direction: 'below' };
    return null;
  }

  // 서비스 목록
  const { data: services } = usePolling<Service[]>(
    () => apiFetch('/api/services'),
    60_000,
  );

  // 서비스가 로드되면 첫 번째로 자동 선택
  useEffect(() => {
    if (!selectedService && services?.length) {
      setSelectedService(services[0].name);
    }
  }, [services, selectedService]);

  // 서비스가 바뀌면 수집된 메트릭 목록 조회 (WAS 차트 동적 활성화용)
  useEffect(() => {
    if (!selectedService) return;
    apiFetch<string[]>(`/api/metrics/${selectedService}/available`)
      .then(res => setAvailableMetrics(res || []))
      .catch(() => setAvailableMetrics([]));
  }, [selectedService]);

  // WAS 전용 차트: 실제 수집 메트릭이 하나라도 있는 후보만 활성화
  const wasCharts = WAS_CHART_CANDIDATES.filter(c =>
    c.detect.some(m => availableMetrics.includes(m))
  );

  // 전체 차트 목록 = JVM 기본 + WAS 동적
  const allCharts = [...JVM_CHARTS, ...wasCharts];

  // 서비스 요약
  const { data: summary, loading: sumLoading } = usePolling<ServiceSummary>(
    () => selectedService ? apiFetch(`/api/metrics/${selectedService}/summary`) : Promise.resolve(null as any),
    30_000,
    [selectedService],
  );

  // 차트 데이터 (전체 병렬)
  const [charts, setCharts] = useState<Record<string, Timeseries | null>>({});
  const [chartsLoading, setChartsLoading] = useState(false);

  useEffect(() => {
    if (!selectedService) return;
    setChartsLoading(true);

    Promise.allSettled(
      allCharts.map(c =>
        apiFetch<Timeseries>(
          `/api/metrics/${selectedService}/timeseries?metric=${encodeURIComponent(c.key)}&range=${range}`
        ).then(data => ({ key: c.key, data }))
      )
    ).then(results => {
      const next: Record<string, Timeseries | null> = {};
      results.forEach((r, i) => {
        next[allCharts[i].key] = r.status === 'fulfilled' ? r.value.data : null;
      });
      setCharts(next);
      setChartsLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedService, range, wasCharts.length]);

  const handleServiceChange = (name: string) => {
    setSelectedService(name);
    setSearchParams({ service: name });
  };

  return (
    <div>
      <PageHeader
        title="메트릭"
        actions={
          <>
            {wsConnected ? (
              <span className="badge badge-ok" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span className="live-dot" />
                LIVE
              </span>
            ) : (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>연결 중...</span>
            )}
            <select
              value={selectedService}
              onChange={e => handleServiceChange(e.target.value)}
              className="select"
            >
              {!services?.length && <option value="">서비스 없음</option>}
              {services?.map(s => (
                <option key={s.name} value={s.name}>{s.name}</option>
              ))}
            </select>
            <div className="tab-group">
              {RANGES.map(r => (
                <button key={r} onClick={() => setRange(r)}
                  className={`tab-btn${range === r ? ' active' : ''}`}>
                  {r}
                </button>
              ))}
            </div>
          </>
        }
      />

      {!selectedService ? (
        <div className="card">
          <p style={{ color: '#64748b', fontSize: 14 }}>서비스를 선택하세요.</p>
        </div>
      ) : (
        <>
          {/* 요약 카드 — WebSocket 실시간 데이터 우선, 없으면 polling 폴백 */}
          {(() => {
            const cpuVal  = liveData?.cpu ?? summary?.cpu_usage_percent;
            const memVal  = liveData?.memory_used_mb ?? summary?.memory_used_mb;
            const rtVal   = liveData?.avg_response_ms ?? summary?.avg_response_time_ms;
            const thrVal  = liveData?.threads ?? summary?.thread_count;
            const cpuTransform  = (v: number) => v * 100;
            const memTransform  = (v: number) => v / 1048576;
            const rtTransform   = (v: number) => v * 1000;
            return (
              <div className="grid-4" style={{ marginBottom: 8 }}>
                <StatCard
                  title="CPU 사용률"
                  value={liveData ? (liveData.cpu?.toFixed(1) ?? '—') : sumLoading ? null : (summary?.cpu_usage_percent?.toFixed(1) ?? '—')}
                  unit="%"
                  color={!checkAnomaly(cpuVal, baselines['jvm.cpu.usage'], cpuTransform) ? cpuColor(cpuVal) : undefined}
                  anomaly={checkAnomaly(cpuVal, baselines['jvm.cpu.usage'], cpuTransform)}
                />
                <StatCard
                  title="힙 메모리"
                  value={liveData ? (liveData.memory_used_mb?.toFixed(0) ?? '—') : sumLoading ? null : (summary?.memory_used_mb?.toFixed(0) ?? '—')}
                  unit="MB"
                  sub={(() => {
                    const max = liveData?.memory_max_mb ?? summary?.memory_max_mb;
                    if (!max) return undefined;
                    const pct = memVal ? Math.round(memVal / max * 100) : '—';
                    return `최대 ${max.toFixed(0)} MB (${pct}%)`;
                  })()}
                  anomaly={checkAnomaly(memVal, baselines['jvm.memory.used'], memTransform)}
                />
                <StatCard
                  title="평균 응답시간"
                  value={liveData ? liveData.avg_response_ms.toFixed(1) : sumLoading ? null : (summary?.avg_response_time_ms?.toFixed(1) ?? '—')}
                  unit="ms"
                  sub={`요청 ${liveData?.request_count_5m ?? summary?.request_count_5m ?? 0}건 / 5분`}
                  color={!checkAnomaly(rtVal, baselines['http.server.request.duration'], rtTransform) ? rtColor(rtVal) : undefined}
                  anomaly={checkAnomaly(rtVal, baselines['http.server.request.duration'], rtTransform)}
                />
                <StatCard
                  title="스레드 수"
                  value={liveData ? (liveData.threads ?? '—') : sumLoading ? null : (summary?.thread_count ?? '—')}
                  unit="개"
                  sub={`에러 ${liveData?.error_count_5m ?? summary?.error_count_5m ?? 0}건 / 5분`}
                  anomaly={checkAnomaly(typeof thrVal === 'number' ? thrVal : null, baselines['jvm.threads.count'])}
                />
              </div>
            );
          })()}

          {/* JVM 기본 차트 2x2 — syncId로 커서 동기화 */}
          <div className="grid-2">
            {JVM_CHARTS.map(c => (
              <MetricChart
                key={c.key}
                title={c.title}
                data={(charts[c.key] as any)?.data ?? []}
                color={c.color}
                unit={c.unit}
                transform={c.transform}
                decimals={c.decimals}
                loading={chartsLoading}
                syncId="jvm-metrics"
                baseline={baselines[c.key] ?? null}
                deployments={deployments ?? []}
              />
            ))}
          </div>
          {/* WAS 전용 차트 (수집된 경우에만 표시) */}
          {wasCharts.length > 0 && (
            <>
              <div style={{ margin: '20px 0 8px', fontSize: 13, color: '#64748b', fontWeight: 600, letterSpacing: '0.05em' }}>
                WAS 런타임
              </div>
              <div className="grid-2">
                {wasCharts.map(c => (
                  <MetricChart
                    key={c.key}
                    title={c.title}
                    data={(charts[c.key] as any)?.data ?? []}
                    color={c.color}
                    unit={c.unit}
                    decimals={c.decimals}
                    loading={chartsLoading}
                    syncId="jvm-metrics"
                    baseline={baselines[c.key] ?? null}
                    deployments={deployments ?? []}
                  />
                ))}
              </div>
            </>
          )}

          {/* JVM 상세 (Deep Monitoring) */}
          <JvmDeepMonitoring sectionService={selectedService} sectionRange={range} />
        </>
      )}
    </div>
  );
}

// ── JVM Deep Monitoring 섹션 ────────────────────────────────
interface PoolPoint { time: string; value: number; }
interface JvmPoolsResponse { pools: Record<string, PoolPoint[]>; }

function JvmDeepMonitoring({ sectionService, sectionRange }: { sectionService: string, sectionRange: Range }) {
  const { data: pools, loading: poolsLoading } = usePolling<JvmPoolsResponse>(
    () => sectionService
      ? apiFetch<JvmPoolsResponse>(`/api/metrics/${sectionService}/jvm-pools?range=${sectionRange}`)
      : Promise.resolve({ pools: {} } as JvmPoolsResponse),
    30_000, [sectionService, sectionRange]
  );
  const { data: gcDuration } = usePolling<Timeseries>(
    () => apiFetch(`/api/metrics/${sectionService}/timeseries?metric=jvm.gc.duration&range=${sectionRange}`),
    30_000, [sectionService, sectionRange]
  );
  const { data: gcCount } = usePolling<Timeseries>(
    () => apiFetch(`/api/metrics/${sectionService}/timeseries?metric=jvm.gc.count&range=${sectionRange}`),
    30_000, [sectionService, sectionRange]
  );

  if (!gcDuration?.data?.length && !pools?.pools) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        margin: '0 0 16px', padding: '0 4px',
        borderLeft: '4px solid #6366f1'
      }}>
        <span style={{ fontSize: 18 }}>🚀</span>
        <h3 style={{ margin: 0, color: '#f1f5f9', fontSize: 16 }}>JVM 심층 지표 (Deep Monitoring)</h3>
      </div>

      <div className="grid-2">
        {/* 메모리 풀 (Eden, Old, Survivor) */}
        <MemoryPoolChart pools={pools?.pools ?? {}} loading={poolsLoading ?? false} />

        {/* GC 지표 */}
        <div style={{ display: 'grid', gridTemplateRows: '1fr 1fr', gap: 16 }}>
          <MetricChart
            title="GC 지연 시간 (Pause Time)"
            data={gcDuration?.data ?? []}
            color="#ef4444" unit="ms" decimals={1}
          />
          <MetricChart
            title="GC 발생 횟수 (Collections)"
            data={gcCount?.data ?? []}
            color="#fb923c" unit="회" decimals={0}
          />
        </div>
      </div>
    </div>
  );
}

// ── 메모리 풀 전용 차트 (Stacked) ───────────────────────────
interface MemoryPoolRow {
  time: string;
  [pool: string]: string | number;
}

function MemoryPoolChart({ pools, loading }: { pools: Record<string, PoolPoint[]>, loading: boolean }) {
  const { chartData, poolNames } = useMemo(() => {
    const names = Object.keys(pools);
    const timeMap: Record<string, MemoryPoolRow> = {};
    names.forEach(name => {
      (pools[name] ?? []).forEach(pt => {
        if (pt == null || pt.value == null || !Number.isFinite(pt.value)) return;
        if (!timeMap[pt.time]) timeMap[pt.time] = { time: pt.time };
        timeMap[pt.time][name] = pt.value / 1024 / 1024; // MB
      });
    });
    const rows = Object.values(timeMap).sort((a, b) => a.time.localeCompare(b.time));
    return { chartData: rows, poolNames: names };
  }, [pools]);
  const colors: Record<string, string> = {
    'Eden': '#34d399', 'Old': '#6366f1', 'Survivor': '#f59e0b',
    'G1 Eden Space': '#34d399', 'G1 Old Gen': '#6366f1', 'G1 Survivor Space': '#f59e0b',
  };

  return (
    <div className="card">
      <div className="card-title">JVM 메모리 풀 상세 (Stacked)</div>
      {loading ? (
        <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>로딩 중...</div>
      ) : chartData.length === 0 ? (
        <div style={{ height: 380, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>데이터 없음</div>
      ) : (
        <ResponsiveContainer width="100%" height={380}>
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" />
            <XAxis dataKey="time" tickFormatter={v => format(parseISO(v), 'HH:mm')} tick={{ fill: '#64748b', fontSize: 11 }} />
            <YAxis unit="M" tick={{ fill: '#64748b', fontSize: 11 }} width={50} />
            <ReTooltip
              contentStyle={{ background: '#1e2035', border: '1px solid #2d3148', borderRadius: 6, fontSize: 12 }}
              itemStyle={{ padding: '2px 0' }}
              labelFormatter={v => format(parseISO(v as string), 'HH:mm:ss')}
            />
            <Legend verticalAlign="top" height={36}/>
            {poolNames.sort().reverse().map(name => (
              <Area
                key={name} type="monotone" dataKey={name} stackId="1"
                stroke={colors[name] || '#64748b'} fill={colors[name] || '#64748b'}
                fillOpacity={0.6}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function cpuColor(v?: number | null) {
  if (!v) return undefined;
  return v > 80 ? '#f87171' : v > 60 ? '#fb923c' : '#34d399';
}
function rtColor(v?: number | null) {
  if (!v) return undefined;
  return v > 1000 ? '#f87171' : v > 500 ? '#fb923c' : '#34d399';
}

const selectStyle: React.CSSProperties = {
  background: '#252840', border: '1px solid #2d3148',
  color: '#e2e8f0', borderRadius: 6, padding: '6px 12px',
  fontSize: 14, cursor: 'pointer',
};
const btnStyle: React.CSSProperties = {
  border: 'none', borderRadius: 6, padding: '6px 12px',
  fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
};
