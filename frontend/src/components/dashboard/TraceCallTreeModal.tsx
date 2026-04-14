import React, { useEffect, useState } from 'react';
import { apiFetch } from '../../hooks/useApi';
import { TraceDetail } from '../../types';
import TraceWaterfall from '../TraceWaterfall';

export default function TraceCallTreeModal({ traceId, spanName, onClose }: {
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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ct-modal-title"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}
    >
      <div style={{ background: '#1a1d2e', width: '100%', maxWidth: 1100, height: '85vh', borderRadius: 12, border: '1px solid #2d3148', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 50px rgba(0,0,0,0.5)' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid #2d3148', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div>
            <h3 id="ct-modal-title" style={{ margin: 0, color: '#f1f5f9', fontSize: 16 }}>콜트리 상세</h3>
            <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 3, fontFamily: 'monospace' }}>{spanName}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>{traceId.slice(0, 16)}…</span>
            <button onClick={onClose} aria-label="닫기" style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 24, lineHeight: 1 }}>&times;</button>
          </div>
        </div>

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
