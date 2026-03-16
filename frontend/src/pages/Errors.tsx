import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { usePolling, apiFetch, apiPatch } from '../hooks/useApi';
import { Service, ErrorList, ErrorItem, ErrorStats } from '../types';
import { format, parseISO } from 'date-fns';
import { useGlobalTime } from '../contexts/GlobalTimeContext';

type Range    = '1h' | '6h' | '24h' | '7d';
type Resolved = 'all' | 'unresolved' | 'resolved';

const RANGES: Range[]       = ['1h', '6h', '24h', '7d'];
const RESOLVED_OPTS = [
  { key: 'all',        label: '전체' },
  { key: 'unresolved', label: '미해결' },
  { key: 'resolved',   label: '해결됨' },
] as const;

export default function Errors() {
  const { globalRange, setGlobalRange } = useGlobalTime();
  const [service,  setService]  = useState('');
  const [range,    setRangeLocal] = useState<Range>(globalRange as Range);
  const setRange = (r: Range) => { setRangeLocal(r); setGlobalRange(r); };
  const [resolved, setResolved] = useState<Resolved>('all');
  const [page,     setPage]     = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [resolving, setResolving] = useState<number | null>(null);
  // 목록 강제 갱신용 카운터
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  const { data: services } = usePolling<Service[]>(
    () => apiFetch('/api/services'), 60_000,
  );

  // 통계
  const svcParam = service ? `&service=${service}` : '';
  const { data: stats } = usePolling<ErrorStats>(
    () => apiFetch(`/api/errors/stats?range=${range}${svcParam}`),
    30_000,
    [service, range, refreshKey],
  );

  // 목록
  const resolvedParam =
    resolved === 'unresolved' ? '&resolved=false' :
    resolved === 'resolved'   ? '&resolved=true'  : '';
  const { data: errorList, loading } = usePolling<ErrorList>(
    () => apiFetch(`/api/errors?range=${range}&page=${page}&limit=20${svcParam}${resolvedParam}`),
    30_000,
    [service, range, resolved, page, refreshKey],
  );

  const handleResolve = async (item: ErrorItem) => {
    setResolving(item.id);
    try {
      await apiPatch(`/api/errors/${item.id}/resolve`, { resolved: !item.resolved });
      refresh();
    } finally {
      setResolving(null);
    }
  };

  const totalPages = errorList ? Math.ceil(errorList.total / 20) : 1;
  const maxTypeCount = stats?.by_type[0]?.count || 1;

  return (
    <div>
      {/* 헤더 + 필터 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>에러 추적</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <select value={service} onChange={e => { setService(e.target.value); setPage(1); }} style={selStyle}>
            <option value="">전체 서비스</option>
            {services?.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 4 }}>
            {RESOLVED_OPTS.map(o => (
              <button key={o.key} onClick={() => { setResolved(o.key); setPage(1); }}
                style={{ ...btnStyle, background: resolved === o.key ? resolvedColor(o.key) : '#252840', color: resolved === o.key ? '#fff' : '#94a3b8' }}>
                {o.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {RANGES.map(r => (
              <button key={r} onClick={() => { setRange(r); setPage(1); }}
                style={{ ...btnStyle, background: range === r ? '#6366f1' : '#252840', color: range === r ? '#fff' : '#94a3b8' }}>
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 통계 카드 */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 2fr', gap: 16, marginBottom: 16 }}>
          <div className="card">
            <div className="card-title">전체 에러</div>
            <div className="stat-value">{stats.total}</div>
          </div>
          <div className="card">
            <div className="card-title">미해결</div>
            <div className="stat-value" style={{ color: stats.unresolved > 0 ? '#f87171' : undefined }}>
              {stats.unresolved}
            </div>
          </div>
          <div className="card">
            <div className="card-title">해결됨</div>
            <div className="stat-value" style={{ color: '#34d399' }}>{stats.resolved}</div>
          </div>

          {/* 에러 유형 분포 */}
          <div className="card">
            <div className="card-title">에러 유형 Top 5</div>
            {stats.by_type.slice(0, 5).map(t => (
              <div key={t.error_type} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: '#e2e8f0' }}>
                  {t.error_type}
                </div>
                <div style={{ flex: 1, background: '#252840', borderRadius: 3, height: 6 }}>
                  <div style={{
                    width: `${(t.count / maxTypeCount) * 100}%`,
                    background: '#ef4444', height: '100%', borderRadius: 3,
                  }} />
                </div>
                <div style={{ fontSize: 12, color: '#94a3b8', width: 28, textAlign: 'right' }}>{t.count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 에러 목록 */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1e2035', borderBottom: '1px solid #2d3148', color: '#64748b' }}>
              <th style={thS}>에러 유형</th>
              <th style={thS}>메시지</th>
              <th style={thS}>서비스</th>
              <th style={thS}>상태</th>
              <th style={thS}>발생 시각</th>
              <th style={thS}></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>로딩 중...</td></tr>
            )}
            {!loading && !errorList?.items.length && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                {service
                  ? `'${service}' 서비스의 ${range} 내 에러가 없습니다.`
                  : resolved !== 'all'
                    ? `${range} 내 ${resolved === 'unresolved' ? '미해결' : '해결된'} 에러가 없습니다.`
                    : `${range} 내 에러 데이터가 없습니다.`}
              </td></tr>
            )}
            {errorList?.items.map(item => {
              const isExpanded = expanded === item.id;
              return (
                <React.Fragment key={item.id}>
                  <tr
                    onClick={() => setExpanded(isExpanded ? null : item.id)}
                    style={{
                      borderBottom: '1px solid #1e2035', cursor: 'pointer',
                      background: isExpanded ? '#1e2035' : item.resolved ? 'transparent' : undefined,
                      opacity: item.resolved ? 0.6 : 1,
                      borderLeft: isExpanded ? '3px solid #ef4444' : '3px solid transparent',
                    }}
                  >
                    <td style={tdS}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                        background: '#450a0a', color: '#fca5a5', fontSize: 12,
                        maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {item.error_type}
                      </span>
                    </td>
                    <td style={{ ...tdS, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#e2e8f0' }}>
                      {item.message}
                    </td>
                    <td style={{ ...tdS, color: '#94a3b8' }}>
                      {item.service}
                      {item.instance && <span style={{ color: '#475569', fontSize: 11, display: 'block' }}>{item.instance}</span>}
                    </td>
                    <td style={tdS}>
                      <span className={`badge ${item.resolved ? 'badge-ok' : 'badge-error'}`}>
                        {item.resolved ? '해결됨' : '미해결'}
                      </span>
                    </td>
                    <td style={{ ...tdS, color: '#64748b', fontSize: 12 }}>
                      {format(parseISO(item.time), 'MM-dd HH:mm:ss')}
                    </td>
                    <td style={{ ...tdS, textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleResolve(item)}
                        disabled={resolving === item.id}
                        style={{
                          ...btnStyle, fontSize: 12, padding: '4px 10px',
                          background: item.resolved ? '#252840' : '#14532d',
                          color: item.resolved ? '#94a3b8' : '#86efac',
                          border: '1px solid ' + (item.resolved ? '#2d3148' : '#166534'),
                        }}
                      >
                        {resolving === item.id ? '처리 중...' : item.resolved ? '재오픈' : '해결'}
                      </button>
                    </td>
                  </tr>

                  {/* 상세 패널 */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={6} style={{ background: '#12141f', borderBottom: '1px solid #2d3148', padding: 0 }}>
                        <ErrorDetail item={item} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={pageBtn}>← 이전</button>
          <span style={{ color: '#94a3b8', fontSize: 13, alignSelf: 'center' }}>{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={pageBtn}>다음 →</button>
        </div>
      )}
    </div>
  );
}

// ── 에러 상세 패널 ────────────────────────────────────

function ErrorDetail({ item }: { item: ErrorItem }) {
  const [stackCopied, setStackCopied] = useState(false);

  const copyStack = () => {
    if (item.stack_trace) {
      navigator.clipboard.writeText(item.stack_trace);
      setStackCopied(true);
      setTimeout(() => setStackCopied(false), 2000);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* 에러 정보 */}
        <div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>에러 정보</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <InfoRow label="에러 유형"  value={item.error_type} />
            <InfoRow label="서비스"     value={item.service} />
            <InfoRow label="인스턴스"   value={item.instance || '—'} />
            <InfoRow label="발생 시각"  value={format(parseISO(item.time), 'yyyy-MM-dd HH:mm:ss.SSS')} />
          </div>
        </div>

        {/* 연관 트레이스 */}
        <div>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>연관 트레이스</div>
          {item.trace_id ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <InfoRow label="Trace ID" value={item.trace_id.slice(0, 20) + '…'} mono />
              <InfoRow label="Span ID"  value={(item.span_id || '').slice(0, 16) + '…'} mono />
              <div>
                <Link
                  to={`/traces?trace_id=${item.trace_id}`}
                  style={{ color: '#6366f1', fontSize: 13, textDecoration: 'none' }}
                >
                  트레이스에서 보기 →
                </Link>
              </div>
            </div>
          ) : (
            <div style={{ color: '#475569', fontSize: 13 }}>트레이스 정보 없음</div>
          )}
        </div>
      </div>

      {/* 에러 메시지 */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>메시지</div>
        <div style={{ background: '#1e2035', border: '1px solid #2d3148', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: '#fca5a5' }}>
          {item.message}
        </div>
      </div>

      {/* 스택 트레이스 */}
      {item.stack_trace && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 11, color: '#64748b' }}>스택 트레이스</div>
            <button onClick={copyStack} style={{ ...btnStyle, fontSize: 11, padding: '3px 8px', background: '#252840', color: '#94a3b8', border: '1px solid #2d3148' }}>
              {stackCopied ? '복사됨 ✓' : '복사'}
            </button>
          </div>
          <pre style={{
            background: '#0d0f18', border: '1px solid #2d3148', borderRadius: 6,
            padding: '12px 14px', fontSize: 12, color: '#e2e8f0',
            overflowX: 'auto', overflowY: 'auto', maxHeight: 260,
            margin: 0, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>
            {item.stack_trace}
          </pre>
        </div>
      )}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, fontSize: 13, alignItems: 'baseline' }}>
      <span style={{ color: '#64748b', width: 80, flexShrink: 0 }}>{label}</span>
      <span style={{ color: '#e2e8f0', fontFamily: mono ? 'monospace' : undefined }}>{value}</span>
    </div>
  );
}

function resolvedColor(key: string) {
  if (key === 'unresolved') return '#ef4444';
  if (key === 'resolved')   return '#22c55e';
  return '#6366f1';
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
