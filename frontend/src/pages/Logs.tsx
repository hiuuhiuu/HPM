import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip,
} from 'recharts';
import { usePolling, apiFetch, useDebounce } from '../hooks/useApi';
import { Service, LogList, LogItem, LogStats, LogLevel } from '../types';
import { format, parseISO } from 'date-fns';
import { useGlobalTime } from '../contexts/GlobalTimeContext';

type Range = '1h' | '6h' | '24h' | '7d';

const ALL_LEVELS: Array<'ALL' | LogLevel> = ['ALL', 'TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
const RANGES: Range[] = ['1h', '6h', '24h', '7d'];

const LEVEL_COLOR: Record<string, string> = {
  TRACE: '#64748b',
  DEBUG: '#60a5fa',
  INFO:  '#34d399',
  WARN:  '#fbbf24',
  ERROR: '#f87171',
  FATAL: '#f472b6',
};
const LEVEL_BG: Record<string, string> = {
  TRACE: '#1e293b',
  DEBUG: '#172554',
  INFO:  '#14532d',
  WARN:  '#431407',
  ERROR: '#450a0a',
  FATAL: '#500724',
};

export default function Logs() {
  const { globalRange, setGlobalRange } = useGlobalTime();
  const [service,  setService]  = useState('');
  const [level,    setLevel]    = useState<'ALL' | LogLevel>('ALL');
  const [range,    setRangeLocal] = useState<Range>(globalRange as Range);
  const setRange = (r: Range) => { setRangeLocal(r); setGlobalRange(r); };
  const [search,   setSearch]   = useState('');
  const [page,     setPage]     = useState(1);
  const [expanded, setExpanded] = useState<number | null>(null);

  const debouncedSearch = useDebounce(search, 500);

  const { data: services } = usePolling<Service[]>(
    () => apiFetch('/api/services'), 60_000,
  );

  // 통계
  const svcParam = service ? `&service=${service}` : '';
  const { data: stats } = usePolling<LogStats>(
    () => apiFetch(`/api/logs/stats?range=${range}${svcParam}`),
    30_000,
    [service, range],
  );

  // 로그 목록
  const searchParam = debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : '';
  const levelParam  = level !== 'ALL' ? `&level=${level}` : '';
  const { data: logList, loading } = usePolling<LogList>(
    () => apiFetch(`/api/logs?range=${range}&page=${page}&limit=50${svcParam}${levelParam}${searchParam}`),
    15_000,
    [service, level, range, debouncedSearch, page],
  );

  const totalPages = logList ? Math.ceil(logList.total / 50) : 1;

  return (
    <div>
      <PageHeader
        title="로그"
        actions={
          <>
            <select value={service} onChange={e => { setService(e.target.value); setPage(1); }} className="select">
              <option value="">전체 서비스</option>
              {services?.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
            <input
              type="text"
              placeholder="메시지 검색..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="input"
              style={{ width: 180 }}
            />
            <div className="tab-group">
              {RANGES.map(r => (
                <button key={r} onClick={() => { setRange(r); setPage(1); }}
                  className={`tab-btn${range === r ? ' active' : ''}`}>
                  {r}
                </button>
              ))}
            </div>
          </>
        }
      />

      {/* 레벨 필터 + 카운트 */}
      {stats && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {ALL_LEVELS.map(l => {
            const count = l === 'ALL' ? stats.total : stats.by_level[l] ?? 0;
            const isActive = level === l;
            return (
              <button
                key={l}
                onClick={() => { setLevel(l); setPage(1); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 14px', borderRadius: 6, cursor: 'pointer',
                  border: isActive
                    ? `1px solid ${l === 'ALL' ? '#6366f1' : LEVEL_COLOR[l]}`
                    : '1px solid #2d3148',
                  background: isActive
                    ? (l === 'ALL' ? '#1e2035' : LEVEL_BG[l])
                    : '#1a1d27',
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: l === 'ALL' ? '#94a3b8' : LEVEL_COLOR[l] }}>
                  {l}
                </span>
                <span style={{
                  fontSize: 13, fontWeight: 700,
                  color: l === 'ALL' ? '#f1f5f9' : LEVEL_COLOR[l],
                }}>
                  {count.toLocaleString()}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* 시간대별 로그 볼륨 차트 */}
      {stats && stats.timeline.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">시간대별 로그 볼륨</div>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={stats.timeline} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2d3148" />
              <XAxis
                dataKey="time"
                tickFormatter={v => format(parseISO(v), 'HH:mm')}
                tick={{ fill: '#64748b', fontSize: 10 }}
                axisLine={false} tickLine={false}
              />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
              <Tooltip
                contentStyle={{ background: '#1e2035', border: '1px solid #2d3148', borderRadius: 6, fontSize: 12 }}
                labelFormatter={v => format(parseISO(v as string), 'HH:mm:ss')}
              />
              {(['ERROR', 'WARN', 'INFO', 'DEBUG'] as LogLevel[]).map(l => (
                <Bar key={l} dataKey={l} stackId="a" fill={LEVEL_COLOR[l]} maxBarSize={20} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* 로그 스트림 테이블 */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: '#1e2035', borderBottom: '1px solid #2d3148', color: '#64748b' }}>
              <th style={{ ...thS, width: 140 }}>시각</th>
              <th style={{ ...thS, width: 70 }}>레벨</th>
              <th style={{ ...thS, width: 130 }}>서비스</th>
              <th style={thS}>메시지</th>
              <th style={{ ...thS, width: 36 }}></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>로딩 중...</td></tr>
            )}
            {!loading && !logList?.items.length && (
              <tr><td colSpan={5} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                {(service || level !== 'ALL' || debouncedSearch)
                  ? `검색 결과가 없습니다${debouncedSearch ? ` — "${debouncedSearch}"` : ''} — 다른 기간이나 조건으로 검색해 보세요.`
                  : '수집된 로그가 없습니다.'}
              </td></tr>
            )}
            {logList?.items.map((item, idx) => {
              const isExpanded = expanded === idx;
              return (
                <React.Fragment key={`${item.time}-${idx}`}>
                  <tr
                    onClick={() => setExpanded(isExpanded ? null : idx)}
                    style={{
                      borderBottom: '1px solid #1a1d27',
                      cursor: 'pointer',
                      background: isExpanded ? '#1e2035' : undefined,
                      borderLeft: `3px solid ${isExpanded ? LEVEL_COLOR[item.level] : 'transparent'}`,
                    }}
                  >
                    <td style={{ ...tdS, color: '#64748b', fontSize: 11, whiteSpace: 'nowrap' }}>
                      {format(parseISO(item.time), 'MM-dd HH:mm:ss.SSS')}
                    </td>
                    <td style={tdS}>
                      <LevelBadge level={item.level} />
                    </td>
                    <td style={{ ...tdS, color: '#94a3b8', fontSize: 12 }}>
                      {item.service}
                      {item.instance && (
                        <span style={{ color: '#475569', display: 'block', fontSize: 11 }}>{item.instance}</span>
                      )}
                    </td>
                    <td style={{ ...tdS, color: '#e2e8f0', maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.body}
                    </td>
                    <td style={{ ...tdS, color: '#475569', textAlign: 'center' }}>
                      {item.trace_id && <span title="트레이스 있음">●</span>}
                    </td>
                  </tr>

                  {/* 로그 상세 */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={5} style={{ background: '#12141f', borderBottom: '1px solid #2d3148', padding: 0 }}>
                        <LogDetail item={item} />
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
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={pageBtn}>← 이전</button>
          <span style={{ color: '#94a3b8', fontSize: 13 }}>{page} / {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={pageBtn}>다음 →</button>
        </div>
      )}
    </div>
  );
}

// ── 레벨 뱃지 ─────────────────────────────────────────

function LevelBadge({ level }: { level: string }) {
  return (
    <span style={{
      display: 'inline-block', padding: '2px 6px', borderRadius: 4,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.3px',
      background: LEVEL_BG[level] || '#1e293b',
      color: LEVEL_COLOR[level] || '#94a3b8',
    }}>
      {level}
    </span>
  );
}

// ── 로그 상세 패널 ────────────────────────────────────

function LogDetail({ item }: { item: LogItem }) {
  const [bodyCopied, setBodyCopied] = useState(false);

  const copyBody = () => {
    navigator.clipboard.writeText(item.body);
    setBodyCopied(true);
    setTimeout(() => setBodyCopied(false), 2000);
  };

  const attrEntries = Object.entries(item.attributes).filter(
    ([k]) => !k.startsWith('_histogram')
  );

  return (
    <div style={{ padding: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
      {/* 왼쪽: 메타 정보 */}
      <div>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>로그 정보</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Row label="레벨"     value={<LevelBadge level={item.level} />} />
          <Row label="서비스"   value={<span style={{ color: '#e2e8f0', fontSize: 13 }}>{item.service}</span>} />
          <Row label="인스턴스" value={<span style={{ color: '#94a3b8', fontSize: 13 }}>{item.instance || '—'}</span>} />
          <Row label="시각"     value={<span style={{ color: '#e2e8f0', fontSize: 13 }}>{format(parseISO(item.time), 'yyyy-MM-dd HH:mm:ss.SSS')}</span>} />
          {item.trace_id && (
            <>
              <Row label="Trace ID" value={
                <span style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 }}>{item.trace_id.slice(0, 20)}…</span>
              } />
              <Row label="" value={
                <Link to={`/traces?trace_id=${item.trace_id}`}
                  style={{ color: '#6366f1', fontSize: 12, textDecoration: 'none' }}>
                  트레이스에서 보기 →
                </Link>
              } />
            </>
          )}
        </div>

        {/* 속성 */}
        {attrEntries.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>속성</div>
            {attrEntries.map(([k, v]) => (
              <Row key={k} label={k} value={
                <span style={{ color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' }}>{String(v)}</span>
              } />
            ))}
          </div>
        )}
      </div>

      {/* 오른쪽: 메시지 */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div style={{ fontSize: 11, color: '#64748b' }}>메시지</div>
          <button onClick={copyBody} style={{ ...btnStyle, fontSize: 11, padding: '3px 8px', background: '#252840', color: '#94a3b8', border: '1px solid #2d3148' }}>
            {bodyCopied ? '복사됨 ✓' : '복사'}
          </button>
        </div>
        <pre style={{
          background: '#0d0f18', border: '1px solid #2d3148', borderRadius: 6,
          padding: '12px 14px', margin: 0,
          fontSize: 13, color: LEVEL_COLOR[item.level] || '#e2e8f0',
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          lineHeight: 1.6, maxHeight: 200, overflowY: 'auto',
        }}>
          {item.body}
        </pre>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'center', fontSize: 13 }}>
      <span style={{ color: '#64748b', width: 72, flexShrink: 0, fontSize: 12 }}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

const selStyle: React.CSSProperties = {
  background: '#252840', border: '1px solid #2d3148',
  color: '#e2e8f0', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: 'pointer',
};
const btnStyle: React.CSSProperties = {
  border: 'none', borderRadius: 6, padding: '6px 12px',
  fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
};
const thS: React.CSSProperties = { padding: '8px 12px', textAlign: 'left', fontWeight: 500, fontSize: 12 };
const tdS: React.CSSProperties = { padding: '7px 12px' };
const pageBtn: React.CSSProperties = {
  background: '#252840', border: '1px solid #2d3148', color: '#94a3b8',
  borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontSize: 13,
};
