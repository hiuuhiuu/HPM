import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart, Bar,
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { apiFetch, usePolling } from '../hooks/useApi';
import { Service } from '../types';
import StatCard from '../components/StatCard';
import { format, parseISO } from 'date-fns';

type Granularity = 'minute' | 'hour' | 'day';

interface StatPoint {
  time: string;
  request_count: number;
  error_count: number;
  error_rate_pct: number;
  avg_ms: number;
  tps: number;
}

interface StatsSummary {
  total_requests: number;
  total_errors: number;
  avg_response_ms: number;
  error_rate_percent: number;
  peak_tps: number;
  data_points: number;
  truncated: boolean;
}

interface StatsResponse {
  summary: StatsSummary;
  data: StatPoint[];
}

function toLocalIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function tickFormatter(granularity: Granularity, iso: string): string {
  try {
    const d = parseISO(iso);
    if (granularity === 'minute') return format(d, 'HH:mm');
    if (granularity === 'hour')   return format(d, 'MM-dd HH:mm');
    return format(d, 'MM-dd');
  } catch {
    return iso;
  }
}

export default function Statistics() {
  const now = new Date();
  const [granularity, setGranularity] = useState<Granularity>('hour');
  const [fromStr, setFromStr] = useState<string>(toLocalIso(new Date(now.getTime() - 24 * 3600_000)));
  const [toStr, setToStr]     = useState<string>(toLocalIso(now));
  const [service, setService] = useState('');
  const [result, setResult]   = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // 서비스 목록 (60초 폴링)
  const { data: services } = usePolling<Service[]>(
    () => apiFetch('/api/services'),
    60_000,
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ granularity });
        if (fromStr) params.set('from', new Date(fromStr).toISOString());
        if (toStr)   params.set('to',   new Date(toStr).toISOString());
        if (service) params.set('service', service);

        const data = await apiFetch<StatsResponse>(`/api/stats?${params}`);
        if (!cancelled) {
          setResult(data);
          setLastUpdated(new Date());
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [granularity, fromStr, toStr, service]);

  const summary = result?.summary;
  const data    = result?.data ?? [];

  return (
    <div style={{ padding: '24px 28px' }}>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#e2e8f0' }}>통계</h1>
        {lastUpdated && (
          <span style={{ fontSize: 12, color: '#64748b', marginLeft: 'auto' }}>
            마지막 조회: {lastUpdated.toLocaleTimeString('ko-KR')}
          </span>
        )}
      </div>

      {/* 필터 바 */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 20, padding: '12px 16px' }}>
        {/* 단위 버튼 */}
        <div style={{ display: 'flex', gap: 4 }}>
          {(['minute', 'hour', 'day'] as Granularity[]).map(g => (
            <button
              key={g}
              onClick={() => setGranularity(g)}
              style={{
                padding: '4px 12px', borderRadius: 6, fontSize: 13, fontWeight: 600,
                border: 'none', cursor: 'pointer',
                background: granularity === g ? '#6366f1' : '#2d3148',
                color: granularity === g ? '#fff' : '#94a3b8',
              }}
            >
              {g === 'minute' ? '분' : g === 'hour' ? '시' : '일'}
            </button>
          ))}
        </div>

        <div style={{ width: 1, height: 24, background: '#2d3148' }} />

        {/* 날짜 범위 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="datetime-local"
            value={fromStr}
            onChange={e => setFromStr(e.target.value)}
            style={{
              background: '#1a1d27', color: '#e2e8f0', border: '1px solid #2d3148',
              borderRadius: 6, padding: '4px 8px', fontSize: 13,
              colorScheme: 'dark',
            }}
          />
          <span style={{ color: '#64748b', fontSize: 13 }}>~</span>
          <input
            type="datetime-local"
            value={toStr}
            onChange={e => setToStr(e.target.value)}
            style={{
              background: '#1a1d27', color: '#e2e8f0', border: '1px solid #2d3148',
              borderRadius: 6, padding: '4px 8px', fontSize: 13,
              colorScheme: 'dark',
            }}
          />
        </div>

        <div style={{ width: 1, height: 24, background: '#2d3148' }} />

        {/* 서비스 드롭다운 */}
        <select
          value={service}
          onChange={e => setService(e.target.value)}
          style={{
            background: '#1a1d27', color: '#e2e8f0', border: '1px solid #2d3148',
            borderRadius: 6, padding: '4px 8px', fontSize: 13,
          }}
        >
          <option value="">전체 서비스</option>
          {(services ?? []).map(s => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
        </select>

        {/* 데이터 포인트 수 */}
        {summary && (
          <span style={{ fontSize: 12, color: '#64748b', marginLeft: 'auto' }}>
            {summary.data_points.toLocaleString()} 포인트
            {summary.truncated && <span style={{ color: '#f59e0b', marginLeft: 4 }}>(잘림)</span>}
          </span>
        )}
      </div>

      {/* 에러 */}
      {error && (
        <div style={{ background: '#2d1515', border: '1px solid #7f1d1d', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#fca5a5', fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* 로딩 */}
      {loading && !result && (
        <div style={{ color: '#64748b', padding: '40px 0', textAlign: 'center' }}>데이터 조회 중…</div>
      )}

      {/* 요약 카드 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
        <StatCard
          title="총 요청"
          value={summary ? summary.total_requests.toLocaleString() : null}
        />
        <StatCard
          title="총 에러"
          value={summary ? summary.total_errors.toLocaleString() : null}
          color={summary && summary.total_errors > 0 ? '#ef4444' : undefined}
          sub={summary ? `에러율 ${summary.error_rate_percent.toFixed(2)}%` : undefined}
        />
        <StatCard
          title="평균 응답시간"
          value={summary ? summary.avg_response_ms.toFixed(1) : null}
          unit="ms"
        />
        <StatCard
          title="피크 TPS"
          value={summary ? summary.peak_tps.toFixed(3) : null}
          unit=" req/s"
        />
      </div>

      {/* BarChart: 요청수 + 에러수 */}
      <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
        <div className="card-title">요청수 / 에러수</div>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" />
            <XAxis
              dataKey="time"
              tickFormatter={v => tickFormatter(granularity, v)}
              tick={{ fill: '#64748b', fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fill: '#64748b', fontSize: 11 }} width={40} />
            <Tooltip
              contentStyle={{ background: '#1a1d27', border: '1px solid #2d3148', fontSize: 12 }}
              labelFormatter={v => tickFormatter(granularity, v)}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: '#94a3b8' }} />
            <Bar dataKey="request_count" name="요청수" fill="#6366f1" radius={[2, 2, 0, 0]} />
            <Bar dataKey="error_count"   name="에러수" fill="#ef4444" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* AreaChart: 평균 응답시간 */}
      <div className="card" style={{ marginBottom: 16, padding: '14px 16px' }}>
        <div className="card-title">평균 응답시간 (ms)</div>
        <ResponsiveContainer width="100%" height={160}>
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="avgMsGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#22d3ee" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" />
            <XAxis
              dataKey="time"
              tickFormatter={v => tickFormatter(granularity, v)}
              tick={{ fill: '#64748b', fontSize: 11 }}
              interval="preserveStartEnd"
            />
            <YAxis tick={{ fill: '#64748b', fontSize: 11 }} width={40} />
            <Tooltip
              contentStyle={{ background: '#1a1d27', border: '1px solid #2d3148', fontSize: 12 }}
              labelFormatter={v => tickFormatter(granularity, v)}
            />
            <Area
              type="monotone"
              dataKey="avg_ms"
              name="평균 ms"
              stroke="#22d3ee"
              fill="url(#avgMsGrad)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* 테이블 */}
      <div className="card" style={{ padding: '14px 16px' }}>
        <div className="card-title" style={{ marginBottom: 10 }}>상세 데이터</div>
        {data.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>데이터 없음</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2d3148' }}>
                  {['버킷 시각', '요청수', '에러수', '에러율(%)', '평균 응답(ms)', 'TPS'].map(h => (
                    <th key={h} style={{ padding: '6px 10px', textAlign: 'right', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {h === '버킷 시각' ? <span style={{ textAlign: 'left', display: 'block' }}>{h}</span> : h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, i) => (
                  <tr key={row.time} style={{ borderBottom: '1px solid #1e2235', background: i % 2 === 0 ? 'transparent' : '#161928' }}>
                    <td style={{ padding: '5px 10px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                      {tickFormatter(granularity, row.time)}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: '#e2e8f0' }}>
                      {row.request_count.toLocaleString()}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: row.error_count > 0 ? '#ef4444' : '#e2e8f0' }}>
                      {row.error_count.toLocaleString()}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: row.error_rate_pct > 5 ? '#f59e0b' : '#e2e8f0' }}>
                      {row.error_rate_pct.toFixed(2)}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: '#e2e8f0' }}>
                      {row.avg_ms.toFixed(1)}
                    </td>
                    <td style={{ padding: '5px 10px', textAlign: 'right', color: '#e2e8f0' }}>
                      {row.tps.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
