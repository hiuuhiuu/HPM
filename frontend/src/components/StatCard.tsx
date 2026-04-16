import React, { useEffect, useRef, useState } from 'react';

export interface AnomalyInfo {
  sigma: number;
  direction: 'above' | 'below';
}

interface Props {
  title: string;
  value: string | number | null;
  unit?: string;
  sub?: string;
  color?: string;
  anomaly?: AnomalyInfo | null;
}

export default function StatCard({ title, value, unit, sub, color, anomaly }: Props) {
  const isAnomaly = !!anomaly;
  const accentHex = isAnomaly ? '#f87171' : (color ?? '#6366f1');

  // 값 변화 시 짧은 flash. 실시간 스트리밍 체감용.
  const prevRef = useRef<typeof value>(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (prevRef.current !== value && prevRef.current !== null && value !== null) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 600);
      prevRef.current = value;
      return () => clearTimeout(t);
    }
    prevRef.current = value;
  }, [value]);

  return (
    <div
      className="card"
      style={isAnomaly ? {
        borderColor: 'rgba(248,113,113,0.3)',
        boxShadow: '0 4px 20px rgba(248,113,113,0.1), 0 0 0 1px rgba(248,113,113,0.15)',
      } : undefined}
    >
      {/* 상단 accent 라인 */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0, right: 0,
        height: 2,
        background: `linear-gradient(90deg, transparent 0%, ${accentHex}80 30%, ${accentHex} 50%, ${accentHex}80 70%, transparent 100%)`,
        borderRadius: '14px 14px 0 0',
      }} />

      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>{title}</div>
        {isAnomaly && (
          <span style={{
            fontSize: 10, fontWeight: 700,
            padding: '2px 7px', borderRadius: 20,
            background: 'var(--color-error-soft)',
            color: 'var(--color-error)',
            border: '1px solid rgba(248,113,113,0.25)',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            {anomaly!.direction === 'above' ? '↑' : '↓'} {anomaly!.sigma.toFixed(1)}σ
          </span>
        )}
      </div>

      {/* 수치 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 3, lineHeight: 1 }}>
        <div
          className="stat-value"
          style={{
            ...(isAnomaly ? { color: 'var(--color-error)' } : color ? { color } : {}),
            transition: 'color 120ms ease-out, text-shadow 120ms ease-out',
            ...(flash ? {
              color: accentHex,
              textShadow: `0 0 12px ${accentHex}80`,
            } : {}),
          }}
        >
          {value ?? '—'}
        </div>
        {unit && value !== null && (
          <span className="stat-unit">{unit}</span>
        )}
      </div>

      {/* 보조 텍스트 */}
      {sub && (
        <div style={{
          fontSize: 11, color: 'var(--text-muted)',
          marginTop: 7, display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {sub}
        </div>
      )}

      {/* 이상 감지 설명 */}
      {isAnomaly && (
        <div style={{
          fontSize: 11, color: 'var(--color-warning)',
          marginTop: 5, display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{ opacity: 0.8 }}>
            {anomaly!.direction === 'above' ? '평소보다 높음' : '평소보다 낮음'}
            &nbsp;(+{anomaly!.sigma.toFixed(1)}σ 이탈)
          </span>
        </div>
      )}
    </div>
  );
}
