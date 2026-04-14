import React from 'react';
import type { ActiveSummary } from '../../types/dashboard';
import { stripMethod } from '../../utils/dashboardColors';

export default function ActiveTransactionsPanel({
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
          <span aria-hidden="true" style={{ fontSize: 16 }}>⚡</span>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '25%' }} />
              <col />
              <col style={{ width: 96 }} />
              <col style={{ width: 56 }} />
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
