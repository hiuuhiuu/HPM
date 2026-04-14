import React from 'react';
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import type { RatePoint, Range } from '../../types/dashboard';
import type { DeploymentMarker } from '../MetricChart';

export default function MiniTimeChart({
  title, data, dataKey, color, range, unit = '', deployments,
}: {
  title: string;
  data: RatePoint[];
  dataKey: keyof RatePoint;
  color: string;
  range: Range;
  unit?: string;
  deployments?: DeploymentMarker[];
}) {
  // 배포 마커: 데이터 범위 내 marker_time을 가장 가까운 시점으로 스냅
  const markers = React.useMemo(() => {
    if (!deployments?.length || !data.length) return [];
    const times = data.map(d => new Date(d.time).getTime());
    const minT = times[0], maxT = times[times.length - 1];
    return deployments
      .map(dep => {
        const t = new Date(dep.marker_time).getTime();
        if (t < minT || t > maxT) return null;
        let bestIdx = 0;
        let bestDiff = Math.abs(times[0] - t);
        for (let i = 1; i < times.length; i++) {
          const d = Math.abs(times[i] - t);
          if (d < bestDiff) { bestDiff = d; bestIdx = i; }
        }
        return { dep, xKey: data[bestIdx].time };
      })
      .filter((x): x is { dep: DeploymentMarker; xKey: string } => x !== null);
  }, [deployments, data]);

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
