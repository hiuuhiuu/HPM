import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  TooltipProps,
  ReferenceLine,
  ReferenceArea,
} from 'recharts';
import { TimeseriesPoint } from '../types';
import { format, parseISO } from 'date-fns';

export interface BaselineData {
  mean: number;
  stddev: number;
  upper: number;
  lower: number;
  sample_count: number;
}

export interface DeploymentMarker {
  id: number;
  service: string;
  version?: string | null;
  commit_sha?: string | null;
  environment?: string | null;
  description?: string | null;
  marker_time: string;
}

interface Props {
  title: string;
  data: TimeseriesPoint[];
  color?: string;
  /** value 변환 함수 (예: bytes → MB) */
  transform?: (v: number) => number;
  /** Y축 / 툴팁 단위 */
  unit?: string;
  /** 소수점 자리수 */
  decimals?: number;
  loading?: boolean;
  /** 여러 차트 간 커서 동기화 ID */
  syncId?: string;
  /** 통계적 베이스라인 (DB raw 단위 — 내부에서 transform 적용) */
  baseline?: BaselineData | null;
  /** 배포 마커 (차트 범위 내 marker_time만 표시) */
  deployments?: DeploymentMarker[];
}

const DEFAULT_COLOR = '#6366f1';

function CustomTooltip({
  active, payload, label, unit, decimals, baseline,
}: TooltipProps<number, string> & { unit?: string; decimals?: number; baseline?: BaselineData | null }) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  const fmt = val != null ? val.toFixed(decimals ?? 2) : '—';

  const isAbove = baseline && val != null && val > baseline.upper;
  const isBelow = baseline && val != null && val < baseline.lower;
  const sigma = baseline?.stddev && baseline.stddev > 0
    ? Math.abs(((val ?? 0) - baseline.mean) / baseline.stddev).toFixed(1)
    : null;

  return (
    <div style={{
      background: '#1e2035',
      border: `1px solid ${isAbove || isBelow ? '#f87171' : '#2d3148'}`,
      borderRadius: 6, padding: '8px 12px', fontSize: 13,
    }}>
      <div style={{ color: '#94a3b8', marginBottom: 4 }}>
        {label ? format(parseISO(label), 'HH:mm:ss') : ''}
      </div>
      <div style={{ color: isAbove || isBelow ? '#f87171' : '#f1f5f9', fontWeight: 600 }}>
        {fmt}{unit ? ` ${unit}` : ''}
        {(isAbove || isBelow) && sigma && (
          <span style={{ fontSize: 11, color: '#fb923c', marginLeft: 6 }}>+{sigma}σ</span>
        )}
      </div>
      {baseline && (
        <div style={{ marginTop: 5, fontSize: 11, color: '#475569', borderTop: '1px solid #2d3148', paddingTop: 4 }}>
          <div>평균: {baseline.mean.toFixed(decimals ?? 2)}{unit ? ` ${unit}` : ''}</div>
          <div>정상 범위: {baseline.lower.toFixed(decimals ?? 2)} ~ {baseline.upper.toFixed(decimals ?? 2)}{unit ? ` ${unit}` : ''}</div>
        </div>
      )}
    </div>
  );
}

export default function MetricChart({
  title, data, color = DEFAULT_COLOR,
  transform, unit, decimals = 2, loading, syncId, baseline, deployments,
}: Props) {
  const chartData = data.map(d => ({
    time: d.time,
    value: d.value !== null && transform ? transform(d.value) : d.value,
  }));

  // 배포 마커: 차트 x축 범위 내만 표시. 가장 가까운 data 포인트의 time에 스냅.
  const markers = (() => {
    if (!deployments?.length || !chartData.length) return [];
    const times = chartData.map(d => new Date(d.time).getTime());
    const minT = times[0], maxT = times[times.length - 1];
    return deployments
      .map(dep => {
        const t = new Date(dep.marker_time).getTime();
        if (t < minT || t > maxT) return null;
        // 가장 가까운 data.time 찾기 — Recharts ReferenceLine x는 data key 값이어야 함
        let bestIdx = 0;
        let bestDiff = Math.abs(times[0] - t);
        for (let i = 1; i < times.length; i++) {
          const d = Math.abs(times[i] - t);
          if (d < bestDiff) { bestDiff = d; bestIdx = i; }
        }
        return { dep, xKey: chartData[bestIdx].time };
      })
      .filter((x): x is { dep: DeploymentMarker; xKey: string } => x !== null);
  })();

  // baseline 값에 transform 적용 (DB는 raw 단위, 차트는 표시 단위)
  const bl: BaselineData | null = baseline && transform ? {
    ...baseline,
    mean:   transform(baseline.mean),
    upper:  transform(baseline.upper),
    lower:  Math.max(0, transform(baseline.lower)),
    stddev: transform(baseline.stddev),
  } : (baseline ?? null);

  const lastVal = chartData.length ? chartData[chartData.length - 1]?.value : null;
  const isAnomaly = bl && lastVal != null && (lastVal > bl.upper || lastVal < bl.lower);

  return (
    <div
      className="card"
      style={isAnomaly ? { borderColor: '#f87171', boxShadow: '0 0 0 1px rgba(248,113,113,0.25)' } : undefined}
    >
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>{title}</div>
        {isAnomaly && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
            background: '#450a0a', color: '#f87171', border: '1px solid #7f1d1d',
            letterSpacing: '0.03em',
          }}>
            ⚠ 이상 감지
          </span>
        )}
        {bl && !isAnomaly && (
          <span style={{ fontSize: 10, color: '#334155' }}>베이스라인 ✓</span>
        )}
      </div>

      {loading ? (
        <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
          로딩 중...
        </div>
      ) : chartData.length === 0 ? (
        <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
          데이터 없음
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} syncId={syncId}>
            <defs>
              <linearGradient id={`grad-${title}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" />
            <XAxis
              dataKey="time"
              tickFormatter={v => format(parseISO(v), 'HH:mm')}
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: '#64748b', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={45}
              tickFormatter={v => (decimals === 0 ? Math.round(v) : v.toFixed(decimals))}
            />
            <Tooltip
              content={<CustomTooltip unit={unit} decimals={decimals} baseline={bl} />}
              cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }}
            />

            {/* 정상 범위 밴드 (μ ± 2σ) */}
            {bl && (
              <ReferenceArea
                y1={bl.lower} y2={bl.upper}
                fill={color} fillOpacity={0.07}
                ifOverflow="extendDomain"
              />
            )}
            {/* 평균 점선 */}
            {bl && (
              <ReferenceLine
                y={bl.mean}
                stroke={color} strokeOpacity={0.4}
                strokeDasharray="5 4" strokeWidth={1}
                label={{
                  value: `μ ${bl.mean.toFixed(decimals ?? 1)}`,
                  position: 'insideTopRight',
                  fontSize: 9, fill: color, opacity: 0.6,
                }}
              />
            )}
            {/* 상한 이상 경계 */}
            {bl && (
              <ReferenceLine
                y={bl.upper}
                stroke="#f87171" strokeOpacity={0.3}
                strokeDasharray="3 5" strokeWidth={1}
              />
            )}

            {/* 배포 마커 수직선 */}
            {markers.map(({ dep, xKey }) => (
              <ReferenceLine
                key={dep.id}
                x={xKey}
                stroke="#a5b4fc"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                ifOverflow="extendDomain"
                label={{
                  value: `▼ ${dep.version || dep.environment || '배포'}`,
                  position: 'top',
                  fontSize: 10,
                  fill: '#a5b4fc',
                  offset: 2,
                }}
              />
            ))}

            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill={`url(#grad-${title})`}
              dot={false}
              activeDot={{ r: 4, fill: color }}
              connectNulls
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
