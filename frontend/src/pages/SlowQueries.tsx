import React, { useState } from 'react';
import { usePolling, apiFetch } from '../hooks/useApi';
import { Service } from '../types';
import PageHeader from '../components/PageHeader';

type Range = '15m' | '1h' | '6h' | '24h' | '7d';
const RANGES: Range[] = ['15m', '1h', '6h', '24h', '7d'];

interface SlowQuery {
  statement: string;
  db_system: string;
  service: string;
  call_count: number;
  avg_ms: number;
  max_ms: number;
  p95_ms: number;
  error_count: number;
}

export default function SlowQueries() {
  const [service, setService] = useState('');
  const [range, setRange] = useState<Range>('1h');
  const [expanded, setExpanded] = useState<number | null>(null);

  const { data: services } = usePolling<Service[]>(
    () => apiFetch('/api/services'), 60_000,
  );

  const { data: rows, loading } = usePolling<SlowQuery[]>(
    () => apiFetch(`/api/slow-queries?range=${range}${service ? `&service=${service}` : ''}`),
    30_000,
    [service, range],
  );

  return (
    <div>
      <PageHeader
        title="SQL 슬로우 쿼리"
        subtitle="db.statement 속성이 있는 스팬을 평균 응답시간 내림차순으로 집계합니다."
        actions={
          <>
            <select value={service} onChange={e => setService(e.target.value)} className="select">
              <option value="">전체 서비스</option>
              {services?.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
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

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1e2035', borderBottom: '1px solid #2d3148', color: '#64748b' }}>
              <th style={thS}>#</th>
              <th style={thS}>구문 (미리보기)</th>
              <th style={thS}>DB</th>
              <th style={thS}>서비스</th>
              <th style={{ ...thS, textAlign: 'right' }}>호출 수</th>
              <th style={{ ...thS, textAlign: 'right' }}>평균 ms</th>
              <th style={{ ...thS, textAlign: 'right' }}>P95 ms</th>
              <th style={{ ...thS, textAlign: 'right' }}>최대 ms</th>
              <th style={{ ...thS, textAlign: 'right' }}>에러</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>로딩 중...</td></tr>
            )}
            {!loading && (!rows || rows.length === 0) && (
              <tr><td colSpan={9} style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>
                {service
                  ? `'${service}' 서비스의 ${range} 내 SQL 쿼리 데이터가 없습니다.`
                  : `${range} 내 수집된 SQL 쿼리가 없습니다.`}
              </td></tr>
            )}
            {rows?.map((row, idx) => {
              const isExpanded = expanded === idx;
              const preview = row.statement.replace(/\s+/g, ' ').slice(0, 80);
              const hasMore = row.statement.length > 80;
              return (
                <React.Fragment key={idx}>
                  <tr
                    onClick={() => setExpanded(isExpanded ? null : idx)}
                    style={{
                      borderBottom: isExpanded ? 'none' : '1px solid #1e2035',
                      cursor: 'pointer',
                      background: isExpanded ? '#1a1d27' : 'transparent',
                      borderLeft: isExpanded ? '3px solid #6366f1' : '3px solid transparent',
                    }}
                  >
                    <td style={{ ...tdS, color: '#475569', width: 36 }}>{idx + 1}</td>
                    <td style={{ ...tdS, maxWidth: 340 }}>
                      <span style={{ fontFamily: '"JetBrains Mono", monospace', fontSize: 12, color: '#e2e8f0' }}>
                        {preview}{hasMore && !isExpanded ? <span style={{ color: '#475569' }}>…</span> : ''}
                      </span>
                    </td>
                    <td style={tdS}>
                      <span style={{
                        fontSize: 11, padding: '2px 7px', borderRadius: 10,
                        background: '#1e2035', color: '#93c5fd', border: '1px solid #2d3148',
                      }}>
                        {row.db_system}
                      </span>
                    </td>
                    <td style={{ ...tdS, color: '#94a3b8' }}>{row.service || '—'}</td>
                    <td style={{ ...tdS, textAlign: 'right', color: '#94a3b8' }}>
                      {row.call_count.toLocaleString()}
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', color: avgColor(row.avg_ms), fontWeight: 600 }}>
                      {row.avg_ms.toFixed(1)}
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', color: avgColor(row.p95_ms) }}>
                      {row.p95_ms.toFixed(1)}
                    </td>
                    <td style={{ ...tdS, textAlign: 'right', color: avgColor(row.max_ms) }}>
                      {row.max_ms.toFixed(1)}
                    </td>
                    <td style={{ ...tdS, textAlign: 'right' }}>
                      {row.error_count > 0
                        ? <span style={{ color: '#f87171', fontWeight: 600 }}>{row.error_count}</span>
                        : <span style={{ color: '#475569' }}>0</span>}
                    </td>
                  </tr>

                  {/* 확장: 전체 SQL */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={9} style={{
                        padding: '0 16px 16px 16px',
                        background: '#1a1d27',
                        borderBottom: '1px solid #2d3148',
                        borderLeft: '3px solid #6366f1',
                      }}>
                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, marginTop: 4 }}>전체 SQL 구문</div>
                        <pre style={{
                          background: '#0f172a',
                          border: '1px solid #1e3a5f',
                          borderRadius: 6,
                          padding: '12px 14px',
                          fontSize: 12,
                          lineHeight: 1.6,
                          color: '#93c5fd',
                          overflowX: 'auto',
                          maxHeight: 240,
                          overflowY: 'auto',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          margin: 0,
                          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                        }}>
                          {row.statement}
                        </pre>
                        <div style={{ display: 'flex', gap: 20, marginTop: 10, fontSize: 12, color: '#64748b' }}>
                          <span>호출 수: <b style={{ color: '#e2e8f0' }}>{row.call_count.toLocaleString()}</b></span>
                          <span>평균: <b style={{ color: avgColor(row.avg_ms) }}>{row.avg_ms.toFixed(1)}ms</b></span>
                          <span>P95: <b style={{ color: avgColor(row.p95_ms) }}>{row.p95_ms.toFixed(1)}ms</b></span>
                          <span>최대: <b style={{ color: avgColor(row.max_ms) }}>{row.max_ms.toFixed(1)}ms</b></span>
                          {row.error_count > 0 && (
                            <span>에러: <b style={{ color: '#f87171' }}>{row.error_count}</b></span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function avgColor(ms: number): string {
  if (ms > 1000) return '#f87171';
  if (ms > 300)  return '#fb923c';
  if (ms > 100)  return '#fbbf24';
  return '#e2e8f0';
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
