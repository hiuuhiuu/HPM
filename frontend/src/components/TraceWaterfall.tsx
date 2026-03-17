import React, { useState, useEffect, useMemo } from 'react';
import { SpanDetail, TraceDetail, LogItem, LogList } from '../types';
import { format, parseISO } from 'date-fns';
import { apiFetch } from '../hooks/useApi';

// ── 스팬 트리 빌더 ──────────────────────────────────────

interface SpanNode extends SpanDetail {
  depth: number;
  children: SpanNode[];
}

function buildTree(spans: SpanDetail[]): { roots: SpanNode[]; flat: SpanNode[]; criticalPath: Set<string> } {
  const map = new Map<string, SpanNode>();
  spans.forEach(s => map.set(s.span_id, { ...s, depth: 0, children: [] }));

  const roots: SpanNode[] = [];
  map.forEach(node => {
    const parent = node.parent_span_id ? map.get(node.parent_span_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  function setDepth(node: SpanNode, d: number) {
    node.depth = d;
    node.children.sort((a, b) => a.start_offset_ms - b.start_offset_ms);
    node.children.forEach(c => setDepth(c, d + 1));
  }
  roots.forEach(r => setDepth(r, 0));

  // Critical Path
  const criticalPath = new Set<string>();
  function markCritical(nodes: SpanNode[]) {
    if (!nodes.length) return;
    const longest = nodes.reduce((p, c) => c.duration_ms > p.duration_ms ? c : p);
    if (longest.duration_ms > 0) { criticalPath.add(longest.span_id); markCritical(longest.children); }
  }
  markCritical(roots);

  const flat: SpanNode[] = [];
  function traverse(node: SpanNode) { flat.push(node); node.children.forEach(traverse); }
  roots.forEach(traverse);

  return { roots, flat, criticalPath };
}

// ── 헬스체크/노이즈 스팬 감지 ──────────────────────────

// DB 커넥션풀 헬스체크/검증 쿼리 판별
// stmt: db.statement 또는 db.query.text (대문자, trim)
// name: span name (대문자, trim)
function isDbValidationQuery(stmt: string, name: string): boolean {
  // ── 공통 ──────────────────────────────────────────────────
  // span name이 "SELECT <단순식별자>" 패턴 (DBCP validationQuery 결과)
  // 예: "SELECT covi_smart", "SELECT ORCL"
  if (/^SELECT\s+\w+$/.test(name)) return true;

  // ── PostgreSQL ─────────────────────────────────────────────
  if (stmt === 'SELECT 1' || stmt === 'SELECT 1;') return true;
  if (stmt.startsWith('SELECT VERSION(') || stmt.startsWith('SELECT VERSION ')) return true;
  if (stmt.includes('PG_IS_IN_RECOVERY') || stmt.includes('PG_CATALOG.')) return true;
  // MySQL/PostgreSQL SHOW 계열 (짧은 관리 쿼리)
  if (stmt.startsWith('SHOW ') && stmt.length < 40) return true;

  // ── MySQL / MariaDB ────────────────────────────────────────
  if (stmt === '/* PING */' || stmt === 'SELECT 1 /* PING */') return true;
  if (stmt === 'SELECT 1 + 1' || stmt === 'SELECT 1+1') return true;
  // MySQL Connector/J가 보내는 검증 쿼리
  if (stmt === '/* JDBC PING */ SELECT 1') return true;
  // HikariCP MySQL 기본 검증
  if (stmt === 'SELECT 1' || stmt === 'SELECT 1;') return true;

  // ── MSSQL (SQL Server) ────────────────────────────────────
  if (stmt.startsWith('SELECT TOP 1') && stmt.length < 50) return true;
  if (stmt === 'SELECT GETDATE()' || stmt === 'SELECT GETDATE() AS NOW') return true;
  if (stmt === 'SELECT @@VERSION' || stmt === 'SELECT @@SERVERNAME') return true;
  if (stmt === 'SELECT 1' || stmt === 'SELECT 1;') return true;

  // ── Oracle ────────────────────────────────────────────────
  if (stmt === 'SELECT 1 FROM DUAL' || stmt === 'SELECT 1 FROM DUAL;') return true;
  if (stmt === 'SELECT SYSDATE FROM DUAL' || stmt === 'SELECT SYSDATE FROM DUAL;') return true;
  if (stmt === 'SELECT * FROM DUAL' || stmt === 'SELECT 0 FROM DUAL') return true;
  if (stmt === 'SELECT 1 FROM SYS.DUAL') return true;
  // Oracle JDBC ping
  if (stmt.startsWith('BEGIN') && stmt.includes('NULL') && stmt.length < 30) return true;

  // ── Tibero ────────────────────────────────────────────────
  // Tibero는 Oracle 호환이나 고유 패턴 포함
  if (stmt === 'SELECT 1 FROM DUAL' || stmt === 'SELECT SYSDATE FROM DUAL') return true;
  if (stmt === 'SELECT * FROM V$VERSION' || stmt.startsWith('SELECT BANNER FROM V$VERSION')) return true;
  // Tibero JDBC 기본 검증
  if (stmt === 'SELECT CURRENT_TIMESTAMP FROM DUAL') return true;

  // ── Altibase ──────────────────────────────────────────────
  if (stmt === 'SELECT 1 FROM DUAL' || stmt === 'SELECT SYSDATE FROM DUAL') return true;
  if (stmt === 'SELECT 1 FROM V$VERSION') return true;

  // ── H2 / 임베디드 DB ──────────────────────────────────────
  if (stmt === 'SELECT 1' || stmt === 'SELECT H2VERSION()') return true;

  // ── WAS/DBCP 공통 짧은 검증 패턴 ─────────────────────────
  // 매우 짧고 결과 없는 쿼리 (20자 이하 단순 SELECT)
  if (stmt.length <= 20 && stmt.startsWith('SELECT') && !stmt.includes('FROM ')) return true;

  return false;
}

function isHealthCheck(span: SpanDetail): boolean {
  const attrs = span.attributes as Record<string, unknown>;
  const stmt = String(attrs['db.statement'] || attrs['db.query.text'] || '').trim().toUpperCase();
  const name = span.name.trim().toUpperCase();

  // HTTP 헬스체크 엔드포인트
  if (name === '/HEALTH' || name === 'GET /HEALTH' || name === 'HEALTH' ||
      name === 'GET /ACTUATOR/HEALTH' || name === '/ACTUATOR/HEALTH') return true;

  // DB 커넥션풀 검증 쿼리
  if (isDbValidationQuery(stmt, name)) return true;

  return false;
}

// ── 콜 트리 빌더 ──────────────────────────────────────

interface CallTreeRow extends SpanNode { treePrefix: string }

// visibleSpanIds: null이면 모두 표시, Set이면 Set에 포함된 span_id만 표시
function buildCallTreeRows(
  nodes: SpanNode[],
  parentPrefix: string,
  collapsed: Set<string>,
  hideHC: boolean,
  visibleSpanIds: Set<string> | null,
): CallTreeRow[] {
  const visible = nodes.filter(n => {
    if (hideHC && isHealthCheck(n)) return false;
    if (visibleSpanIds !== null && !visibleSpanIds.has(n.span_id)) return false;
    return true;
  });
  const rows: CallTreeRow[] = [];
  visible.forEach((node, idx) => {
    const isLast = idx === visible.length - 1;
    const connector = node.depth === 0 ? '' : (isLast ? '└─ ' : '├─ ');
    rows.push({ ...node, treePrefix: parentPrefix + connector });
    if (node.children.length > 0 && !collapsed.has(node.span_id)) {
      const childPrefix = parentPrefix + (node.depth === 0 ? '' : (isLast ? '   ' : '│  '));
      rows.push(...buildCallTreeRows(node.children, childPrefix, collapsed, hideHC, visibleSpanIds));
    }
  });
  return rows;
}

// ── 스팬 색상 ─────────────────────────────────────────

function spanColor(span: SpanDetail): string {
  const a = span.attributes as Record<string, unknown>;
  if (a['db.system'])                               return '#10b981'; // DB - green
  if (a['messaging.system'])                         return '#f59e0b'; // MQ - amber
  if (a['rpc.system'])                               return '#a78bfa'; // RPC - violet
  if (a['http.method'] || a['http.request.method']) {
    return span.span_kind === 'CLIENT'              ? '#38bdf8'        // 외부 호출 - sky
                                                   : '#6366f1';       // 진입 요청 - indigo
  }
  if (span.span_kind === 'PRODUCER' || span.span_kind === 'CONSUMER') return '#f59e0b';
  if (span.span_kind === 'CLIENT')                   return '#38bdf8';
  return '#64748b';
}

// 뱃지 텍스트: 역할 중심 (HTTP GET 대신 SERVER / CLIENT)
function spanTypeBadge(span: SpanDetail): string {
  const a = span.attributes as Record<string, unknown>;
  if (a['db.system'])        return String(a['db.system']).toUpperCase();
  if (a['messaging.system']) return span.span_kind === 'PRODUCER' ? 'JMS PUB' : 'JMS SUB';
  if (a['rpc.system'])       return 'RPC';
  if (a['http.method'] || a['http.request.method']) {
    return span.span_kind === 'CLIENT' ? 'HTTP CLIENT' : 'HTTP SERVER';
  }
  return span.span_kind || 'INTERNAL';
}

// 콜 트리 1행에 표시할 주 이름: METHOD + URI (중복 제거)
function spanDisplayName(span: SpanDetail): string {
  const a = span.attributes as Record<string, unknown>;
  const method = (a['http.method'] || a['http.request.method']) as string | undefined;
  if (method) {
    // OTel 스팬명이 이미 "GET /path" 형태인 경우 그대로 사용
    if (span.name.startsWith(method + ' ')) return span.name;
    // 아닌 경우 route → target → path 순서로 조합
    const route = (a['http.route'] || a['http.target'] || a['url.path']) as string | undefined;
    if (route) return `${method} ${route.split('?')[0]}`;
  }
  return span.name;
}

// 2행 서브 정보: DB → SQL, CLIENT HTTP → 대상 호스트, ERROR → exception
function spanSubInfo(span: SpanDetail): string | null {
  const a = span.attributes as Record<string, unknown>;
  const stmt = (a['db.statement'] || a['db.query.text']) as string | undefined;
  if (stmt) return stmt.replace(/\s+/g, ' ').trim();
  // CLIENT HTTP 스팬: 대상 URL 표시
  if ((a['http.method'] || a['http.request.method']) && span.span_kind === 'CLIENT') {
    const url = (a['url.full'] || a['http.url']) as string | undefined;
    if (url) { try { const u = new URL(url); return u.host + u.pathname; } catch { return url; } }
  }
  // ERROR 스팬: exception 정보 표시 (exception event 우선)
  if (span.status === 'ERROR') {
    const exc = getExceptionFromSpan(span);
    if (exc) return exc.message ? `${exc.type}: ${exc.message}` : exc.type;
  }
  return null;
}

// HTTP 에러 상태코드 (4xx/5xx만 표시, 200은 노이즈)
function httpErrorCode(span: SpanDetail): number | null {
  const a = span.attributes as Record<string, unknown>;
  const code = Number(a['http.status_code'] || a['http.response.status_code'] || 0);
  return code >= 400 ? code : null;
}

// OTel exception event 또는 span attributes에서 예외 정보 추출
function getExceptionFromSpan(span: SpanDetail): { type: string; message: string; stacktrace?: string } | null {
  // 1순위: span events (OTel 스펙 표준)
  const excEvent = span.events.find(e => e.name === 'exception');
  if (excEvent) {
    const type = String(excEvent.attributes['exception.type'] || '');
    if (type) return {
      type,
      message: String(excEvent.attributes['exception.message'] || ''),
      stacktrace: excEvent.attributes['exception.stacktrace'] as string | undefined,
    };
  }
  // 2순위: span attributes (구형 방식)
  const a = span.attributes as Record<string, unknown>;
  const type = a['exception.type'] as string | undefined;
  if (type) return {
    type,
    message: String(a['exception.message'] || ''),
    stacktrace: a['exception.stacktrace'] as string | undefined,
  };
  return null;
}

// ── 자기 실행 시간 ─────────────────────────────────────

function selfTime(node: SpanNode): number {
  return Math.max(0, node.duration_ms - node.children.reduce((s, c) => s + c.duration_ms, 0));
}

// ── 메인 컴포넌트 ──────────────────────────────────────

interface Props { trace: TraceDetail }

export default function TraceWaterfall({ trace }: Props) {
  const [viewTab, setViewTab]           = useState<'calltree' | 'waterfall'>('calltree');
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [collapsed, setCollapsed]       = useState<Set<string>>(new Set());
  const [hideHealthChecks, setHideHealthChecks] = useState(true);
  const minSpanMs = Number(localStorage.getItem('trace_min_span_ms') || '0');
  const [showLogs, setShowLogs]         = useState(false);
  const [traceLogs, setTraceLogs]       = useState<LogItem[]>([]);
  const [logsLoading, setLogsLoading]   = useState(false);

  const { roots, flat, criticalPath } = useMemo(
    () => buildTree(trace.spans),
    [trace.spans],
  );
  const totalMs = Math.max(trace.duration_ms, 1);
  const selectedSpan = trace.spans.find(s => s.span_id === selectedSpanId) ?? null;

  const toggleCollapse = (id: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  useEffect(() => {
    if (!showLogs) return;
    setLogsLoading(true);
    apiFetch<LogList>(`/api/logs?trace_id=${trace.trace_id}&limit=100`)
      .then(res => setTraceLogs(res?.items ?? []))
      .catch(() => setTraceLogs([]))
      .finally(() => setLogsLoading(false));
  }, [showLogs, trace.trace_id]);

  // 단기 스팬 가시성 사전 계산 — O(N) bottom-up 탐색으로 중복 재귀 호출 제거
  const visibleSpanIds = useMemo(() => {
    if (minSpanMs <= 0) return null;
    const ids = new Set<string>();
    function mark(node: SpanNode): boolean {
      const self = node.status === 'ERROR' || node.duration_ms >= minSpanMs;
      const child = node.children.some(c => mark(c));
      if (self || child) ids.add(node.span_id);
      return self || child;
    }
    roots.forEach(mark);
    return ids;
  }, [roots, minSpanMs, criticalPath]);

  const callTreeRows = useMemo(
    () => buildCallTreeRows(roots, '', collapsed, hideHealthChecks, visibleSpanIds),
    [roots, collapsed, hideHealthChecks, visibleSpanIds],
  );

  const { hiddenCount, minDurationHiddenCount } = useMemo(() => {
    let hc = 0, minDur = 0;
    for (const n of flat) {
      if (isHealthCheck(n)) { hc++; continue; }
      if (visibleSpanIds !== null && !visibleSpanIds.has(n.span_id)) minDur++;
    }
    return { hiddenCount: hc, minDurationHiddenCount: minDur };
  }, [flat, visibleSpanIds]);

  return (
    <div>
      {/* 트레이스 헤더 */}
      <div style={{ marginBottom: 12, padding: '10px 16px', background: '#1e2035', borderRadius: 8, border: '1px solid #2d3148' }}>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13, alignItems: 'center' }}>
          <span style={{ color: '#64748b' }}>
            Trace: <span style={{ color: '#a5b4fc', fontFamily: 'monospace' }}>{trace.trace_id.slice(0, 16)}…</span>
          </span>
          <span style={{ color: '#64748b' }}>
            시작: <span style={{ color: '#e2e8f0' }}>{format(parseISO(trace.start_time), 'MM-dd HH:mm:ss.SSS')}</span>
          </span>
          <span style={{ color: '#64748b' }}>
            총 시간: <span style={{ color: '#f1f5f9', fontWeight: 700 }}>{totalMs.toFixed(2)} ms</span>
          </span>
          <span style={{ color: '#64748b' }}>
            스팬: <span style={{ color: '#e2e8f0' }}>{trace.span_count}개</span>
          </span>
          <button onClick={() => setShowLogs(!showLogs)} style={{
            marginLeft: 'auto', padding: '3px 10px',
            background: showLogs ? '#6366f1' : '#2d3148',
            color: '#e2e8f0', border: '1px solid #4f46e5', borderRadius: 5,
            cursor: 'pointer', fontSize: 12, fontWeight: 500,
          }}>
            📋 연관 로그 {showLogs ? '닫기' : '보기'}
          </button>
        </div>
      </div>

      {/* 탭 + 필터 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ display: 'flex', background: '#12141f', border: '1px solid #2d3148', borderRadius: 7, padding: 2 }}>
          {(['calltree', 'waterfall'] as const).map(tab => (
            <button key={tab} onClick={() => setViewTab(tab)} style={{
              border: 'none', borderRadius: 5, padding: '4px 14px', fontSize: 12, cursor: 'pointer',
              background: viewTab === tab ? '#6366f1' : 'transparent',
              color:      viewTab === tab ? '#fff'    : '#64748b',
            }}>
              {tab === 'calltree' ? '🌲 콜 트리' : '📊 워터폴'}
            </button>
          ))}
        </div>

        {/* 헬스체크 필터 */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 12, color: '#94a3b8', userSelect: 'none' }}>
          <input
            type="checkbox"
            checked={hideHealthChecks}
            onChange={e => setHideHealthChecks(e.target.checked)}
            style={{ accentColor: '#6366f1', cursor: 'pointer' }}
          />
          내부 체크 쿼리 숨김
          {hiddenCount > 0 && (
            <span style={{ fontSize: 11, color: '#475569', background: '#1e2035', borderRadius: 10, padding: '0 6px' }}>
              {hiddenCount}개
            </span>
          )}
        </label>

        {/* 단기 스팬 필터 — 설정값 표시 전용 (변경은 설정 페이지에서) */}
        {minSpanMs > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: '#475569', userSelect: 'none' }}>
            <span style={{ background: '#1e2035', border: '1px solid #2d3148', borderRadius: 4, padding: '2px 8px' }}>
              {minSpanMs}ms 이하 숨김
            </span>
            {minDurationHiddenCount > 0 && (
              <span style={{ fontSize: 11, color: '#475569', background: '#1e2035', borderRadius: 10, padding: '0 6px' }}>
                {minDurationHiddenCount}개
              </span>
            )}
          </div>
        )}

        {/* 콜 트리 전체 펼치기/접기 */}
        {viewTab === 'calltree' && (
          <button onClick={() => setCollapsed(new Set())} style={smallBtn}>모두 펼치기</button>
        )}
      </div>

      {/* ── 콜 트리 뷰 ── */}
      {viewTab === 'calltree' && (
        <div style={{ border: '1px solid #2d3148', borderRadius: 8, overflow: 'hidden' }}>
          {/* 컬럼 헤더 */}
          <div style={{ display: 'flex', alignItems: 'center', padding: '6px 12px', background: '#1a1d2e', borderBottom: '1px solid #2d3148', fontSize: 11, color: '#475569' }}>
            <div style={{ flex: 1 }}>스팬</div>
            <div style={{ width: 160, flexShrink: 0 }}>실행 시간 (비율)</div>
            <div style={{ width: 75, textAlign: 'right', flexShrink: 0 }}>시간</div>
            <div style={{ width: 60, textAlign: 'right', flexShrink: 0 }}>자기 시간</div>
          </div>

          {/* 행 목록 */}
          <div style={{ maxHeight: 500, overflowY: 'auto', background: '#0f1117' }}>
            {callTreeRows.length === 0 && (
              <div style={{ padding: 32, textAlign: 'center', color: '#475569', fontSize: 13 }}>
                표시할 스팬이 없습니다.
              </div>
            )}
            {callTreeRows.map(row => {
              const isSelected  = row.span_id === selectedSpanId;
              const isError     = row.status === 'ERROR';
              const isCritical  = criticalPath.has(row.span_id);
              const color       = isError ? '#ef4444' : spanColor(row);
              const pct         = Math.min(100, (row.duration_ms / totalMs) * 100);
              const selfMs      = selfTime(row);
              const subInfo     = spanSubInfo(row);
              const typeLabel   = spanTypeBadge(row);
              const displayName = spanDisplayName(row);
              const errCode     = httpErrorCode(row);
              const hasChildren = row.children.length > 0;
              const isCollapsed = collapsed.has(row.span_id);
              // exception event가 있는 INTERNAL/CLIENT 스팬 = 예외 최초 발생 지점
              // SERVER 스팬은 진입점이므로 제외
              const isThrowOrigin = isError
                && (row.span_kind === 'INTERNAL' || row.span_kind === 'CLIENT')
                && row.events.some(e => e.name === 'exception');

              return (
                <div
                  key={row.span_id}
                  onClick={() => setSelectedSpanId(isSelected ? null : row.span_id)}
                  style={{
                    display: 'flex', alignItems: 'center',
                    padding: '5px 12px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #1a1d2e',
                    background: isSelected ? '#1e2035' : isError ? '#1a0f0f' : 'transparent',
                    borderLeft: isSelected ? '3px solid #6366f1' : isError ? '3px solid #ef4444' : '3px solid transparent',
                    transition: 'background 0.1s',
                  }}
                >
                  {/* 왼쪽: 트리 + 정보 */}
                  <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', gap: 4, overflow: 'hidden', minWidth: 0 }}>
                    {/* 트리 프리픽스 */}
                    <span style={{
                      fontFamily: '"JetBrains Mono", "Fira Code", "Consolas", monospace',
                      fontSize: 11, color: '#374151', whiteSpace: 'pre', flexShrink: 0,
                      lineHeight: '18px',
                    }}>
                      {row.treePrefix}
                    </span>

                    {/* 펼치기/접기 버튼 */}
                    {hasChildren && (
                      <button
                        onClick={e => { e.stopPropagation(); toggleCollapse(row.span_id); }}
                        style={{
                          flexShrink: 0, width: 16, height: 16, padding: 0, border: 'none',
                          background: 'transparent', color: '#6366f1', cursor: 'pointer',
                          fontSize: 9, lineHeight: 1, marginTop: 1,
                        }}
                      >
                        {isCollapsed ? '▶' : '▼'}
                      </button>
                    )}
                    {!hasChildren && <div style={{ width: 16, flexShrink: 0 }} />}

                    {/* 타입 뱃지 */}
                    <span style={{
                      flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
                      padding: '1px 5px', borderRadius: 3, lineHeight: '16px', marginTop: 1,
                      background: color + '22', color: color,
                      border: `1px solid ${color}44`,
                      whiteSpace: 'nowrap',
                    }}>
                      {typeLabel}
                    </span>

                    {/* 스팬 이름 + 서브 정보 */}
                    <div style={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12,
                        color: isError ? '#fca5a5' : isCritical ? '#f1f5f9' : '#cbd5e1',
                        fontWeight: isCritical ? 600 : 400,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        lineHeight: '18px', display: 'flex', alignItems: 'center', gap: 5,
                      }}>
                        {isCritical && <span style={{ color: '#fbbf24', fontSize: 10, flexShrink: 0 }}>⚡</span>}
                        {isThrowOrigin && (
                          <span style={{
                            flexShrink: 0, fontSize: 9, fontWeight: 700, letterSpacing: '0.03em',
                            padding: '1px 5px', borderRadius: 3,
                            background: '#7f1d1d', color: '#fca5a5', border: '1px solid #ef444466',
                          }}>
                            💥 THROW
                          </span>
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {displayName}
                        </span>
                        {/* HTTP 에러 코드만 표시 (200 같은 정상 코드는 생략) */}
                        {errCode && (
                          <span style={{
                            flexShrink: 0, fontSize: 10, fontWeight: 700,
                            padding: '0 5px', borderRadius: 3,
                            background: errCode >= 500 ? '#7f1d1d' : '#78350f',
                            color: errCode >= 500 ? '#fca5a5' : '#fcd34d',
                          }}>
                            {errCode}
                          </span>
                        )}
                      </div>
                      {subInfo && (
                        <div style={{
                          fontSize: 10,
                          color: isError ? '#f87171' : '#4b5563',
                          fontFamily: 'monospace',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          marginTop: 1, lineHeight: '14px',
                          opacity: isError ? 0.9 : 1,
                        }}>
                          {subInfo.length > 100 ? subInfo.slice(0, 100) + '…' : subInfo}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 실행 시간 바 */}
                  <div style={{ width: 160, flexShrink: 0, padding: '0 8px', display: 'flex', alignItems: 'center' }}>
                    <div style={{ flex: 1, height: 6, background: '#1e2035', borderRadius: 3, overflow: 'hidden', position: 'relative' }}>
                      <div style={{
                        position: 'absolute',
                        left: `${(row.start_offset_ms / totalMs) * 100}%`,
                        width: `${Math.max(0.5, pct)}%`,
                        height: '100%',
                        background: color,
                        borderRadius: 3,
                        opacity: isCritical ? 1 : 0.75,
                        boxShadow: isCritical ? `0 0 6px ${color}88` : 'none',
                      }} />
                    </div>
                  </div>

                  {/* 시간 */}
                  <div style={{
                    width: 75, textAlign: 'right', fontSize: 12, flexShrink: 0,
                    color: isError ? '#fca5a5' : isCritical ? '#f1f5f9' : '#94a3b8',
                    fontWeight: isCritical ? 600 : 400,
                  }}>
                    {row.duration_ms >= 1000
                      ? `${(row.duration_ms / 1000).toFixed(2)}s`
                      : `${row.duration_ms.toFixed(1)}ms`}
                  </div>

                  {/* 자기 시간 */}
                  <div style={{ width: 60, textAlign: 'right', fontSize: 11, flexShrink: 0, color: '#475569' }}>
                    {hasChildren && selfMs > 0.1
                      ? selfMs >= 1000
                        ? `${(selfMs / 1000).toFixed(1)}s`
                        : `${selfMs.toFixed(0)}ms`
                      : ''}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 워터폴 뷰 ── */}
      {viewTab === 'waterfall' && (
        <WaterfallView
          nodes={flat.filter(n => {
            if (hideHealthChecks && isHealthCheck(n)) return false;
            if (visibleSpanIds !== null && !visibleSpanIds.has(n.span_id)) return false;
            return true;
          })}
          totalMs={totalMs}
          criticalPath={criticalPath}
          selectedSpanId={selectedSpanId}
          setSelectedSpanId={setSelectedSpanId}
        />
      )}

      {/* 선택된 스팬 상세 */}
      {selectedSpan && <SpanDetailPanel span={selectedSpan} />}

      {/* 연관 로그 */}
      {showLogs && <TraceLogsPanel logs={traceLogs} loading={logsLoading} traceId={trace.trace_id} />}
    </div>
  );
}

// ── 워터폴 뷰 ─────────────────────────────────────────

function WaterfallView({
  nodes, totalMs, criticalPath, selectedSpanId, setSelectedSpanId,
}: {
  nodes: SpanNode[];
  totalMs: number;
  criticalPath: Set<string>;
  selectedSpanId: string | null;
  setSelectedSpanId: (id: string | null) => void;
}) {
  return (
    <div>
      {/* 타임라인 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, padding: '0 8px', fontSize: 11, color: '#475569' }}>
        <div style={{ width: 260, flexShrink: 0 }}>스팬</div>
        <div style={{ flex: 1, position: 'relative', height: 20 }}>
          {[0, 25, 50, 75, 100].map(p => (
            <span key={p} style={{
              position: 'absolute', left: p === 100 ? undefined : `${p}%`, right: p === 100 ? 0 : undefined,
              transform: p > 0 && p < 100 ? 'translateX(-50%)' : undefined,
            }}>
              {p === 0 ? '0' : `${(totalMs * p / 100).toFixed(0)}ms`}
            </span>
          ))}
        </div>
        <div style={{ width: 70, flexShrink: 0 }} />
      </div>
      <div style={{ borderTop: '1px solid #2d3148', marginBottom: 2 }} />

      <div style={{ maxHeight: 460, overflowY: 'auto' }}>
        {nodes.map(node => {
          const leftPct    = (node.start_offset_ms / totalMs) * 100;
          const widthPct   = Math.max(0.5, (node.duration_ms / totalMs) * 100);
          const color      = spanColor(node);
          const isError    = node.status === 'ERROR';
          const isSelected = node.span_id === selectedSpanId;
          const isCritical = criticalPath.has(node.span_id);

          return (
            <div
              key={node.span_id}
              onClick={() => setSelectedSpanId(isSelected ? null : node.span_id)}
              style={{
                display: 'flex', alignItems: 'center', padding: '4px 8px',
                cursor: 'pointer', borderRadius: 4, borderLeft: isSelected ? '2px solid #6366f1' : '2px solid transparent',
                background: isSelected ? '#1e2035' : 'transparent',
              }}
            >
              <div style={{ width: 260, flexShrink: 0, paddingLeft: node.depth * 14, display: 'flex', alignItems: 'center', gap: 5, overflow: 'hidden' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: isError ? '#f87171' : color, flexShrink: 0, boxShadow: isCritical ? `0 0 6px ${isError ? '#ef4444' : color}` : 'none' }} />
                <span style={{ fontSize: 12, color: isError ? '#fca5a5' : '#cbd5e1', fontWeight: isCritical ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {isCritical && '⚡'}{node.name}
                </span>
              </div>
              <div style={{ flex: 1, position: 'relative', height: 18 }}>
                {[25, 50, 75].map(p => (
                  <div key={p} style={{ position: 'absolute', left: `${p}%`, top: 0, bottom: 0, width: 1, background: '#2d3148' }} />
                ))}
                <div style={{
                  position: 'absolute', left: `${leftPct}%`, width: `${widthPct}%`,
                  top: isCritical ? '10%' : '20%', height: isCritical ? '80%' : '60%',
                  background: isError ? '#ef4444' : color, borderRadius: 2,
                  opacity: isCritical ? 1 : 0.7, minWidth: 2,
                  boxShadow: isCritical ? `0 0 8px ${isError ? '#ef4444' : color}44` : 'none',
                }} />
              </div>
              <div style={{ width: 70, flexShrink: 0, textAlign: 'right', fontSize: 12, color: isCritical ? '#e2e8f0' : '#64748b', fontWeight: isCritical ? 600 : 400 }}>
                {node.duration_ms.toFixed(1)}ms
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 스팬 상세 패널 ─────────────────────────────────────

function SpanDetailPanel({ span }: { span: SpanDetail }) {
  const attrs = span.attributes as Record<string, unknown>;
  const importantKeys = [
    'http.method', 'http.url', 'http.route', 'http.status_code', 'http.target',
    'http.request.method', 'url.full', 'url.path', 'http.response.status_code',
    'db.system', 'db.name', 'db.statement', 'db.operation',
    'exception.type', 'exception.message', 'exception.stacktrace',
    'messaging.system', 'messaging.destination.name', 'messaging.operation',
    'rpc.system', 'rpc.service', 'rpc.method',
  ];
  const shownKeys     = importantKeys.filter(k => attrs[k] !== undefined);
  const remainingKeys = Object.keys(attrs).filter(k => !importantKeys.includes(k) && !k.startsWith('_histogram'));

  return (
    <div style={{ marginTop: 10, padding: 14, background: '#1a1d27', border: '1px solid #2d3148', borderRadius: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
            background: spanColor(span) + '22', color: spanColor(span), border: `1px solid ${spanColor(span)}44`,
          }}>
            {spanTypeBadge(span)}
          </span>
          <span style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9' }}>{span.name}</span>
        </div>
        <span className={`badge ${span.status === 'ERROR' ? 'badge-error' : 'badge-ok'}`}>{span.status}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '5px 20px', fontSize: 12 }}>
        <Detail label="Span ID"    value={span.span_id.slice(0, 16) + '…'} mono />
        <Detail label="서비스"     value={span.service} />
        <Detail label="시작"       value={format(parseISO(span.start_time), 'HH:mm:ss.SSS')} />
        <Detail label="지속 시간"  value={`${span.duration_ms.toFixed(2)} ms`} />
        {shownKeys.map(k => {
          const val = String(attrs[k]);
          // HTTP 상태코드: 에러면 빨간색으로 강조
          const isStatusKey = k === 'http.status_code' || k === 'http.response.status_code';
          const statusCode  = isStatusKey ? Number(val) : 0;
          return (
            <Detail key={k} label={k} value={val}
              mono={k.includes('stacktrace') || k.includes('statement')}
              wrap={k.includes('stacktrace') || k.includes('statement')}
              highlight={statusCode >= 400 ? (statusCode >= 500 ? 'error' : 'warn') : undefined}
            />
          );
        })}
        {remainingKeys.map(k => <Detail key={k} label={k} value={String(attrs[k])} />)}
      </div>

      {span.events.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid #2d3148' }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>EVENTS</div>
          {span.events.map((e, i) => {
            const isExcEvent = e.name === 'exception';
            const excType    = isExcEvent ? String(e.attributes['exception.type'] || '') : '';
            const excMsg     = isExcEvent ? String(e.attributes['exception.message'] || '') : '';
            const excStack   = isExcEvent ? (e.attributes['exception.stacktrace'] as string | undefined) : undefined;
            return (
              <div key={i} style={{ marginBottom: isExcEvent ? 10 : 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: isExcEvent ? 4 : 0 }}>
                  <span style={{ color: '#6366f1', fontFamily: 'monospace', fontSize: 11 }}>
                    {format(parseISO(e.time), 'HH:mm:ss.SSS')}
                  </span>
                  <span style={{ color: isExcEvent ? '#fca5a5' : '#94a3b8', fontWeight: isExcEvent ? 700 : 400 }}>
                    {isExcEvent ? '💥' : '●'} {e.name}
                  </span>
                  {isExcEvent && excType && (
                    <span style={{ fontSize: 11, color: '#fca5a5', fontFamily: 'monospace' }}>{excType}</span>
                  )}
                </div>
                {isExcEvent && (excMsg || excStack) && (
                  <div style={{
                    marginLeft: 0, background: '#0d0f18',
                    border: '1px solid #7f1d1d', borderRadius: 5,
                    padding: '8px 12px', fontSize: 11,
                  }}>
                    {excMsg && (
                      <div style={{ color: '#fca5a5', marginBottom: excStack ? 6 : 0, fontWeight: 500 }}>
                        {excMsg}
                      </div>
                    )}
                    {excStack && (
                      <pre style={{
                        margin: 0, color: '#94a3b8', fontFamily: 'monospace', fontSize: 10,
                        whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.6,
                        maxHeight: 180, overflowY: 'auto',
                      }}>
                        {excStack}
                      </pre>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, mono = false, wrap = false, highlight }: {
  label: string; value: string; mono?: boolean; wrap?: boolean;
  highlight?: 'error' | 'warn';
}) {
  const valueColor = highlight === 'error' ? '#fca5a5' : highlight === 'warn' ? '#fcd34d' : '#e2e8f0';
  return (
    <div style={{ overflow: 'hidden' }}>
      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 1 }}>{label}</div>
      <div style={{
        color: valueColor, fontFamily: mono ? 'monospace' : undefined, fontSize: mono ? 11 : 12,
        whiteSpace: wrap ? 'pre-wrap' : 'nowrap', overflow: wrap ? 'visible' : 'hidden',
        textOverflow: wrap ? undefined : 'ellipsis', wordBreak: wrap ? 'break-all' : undefined,
        fontWeight: highlight ? 600 : undefined,
      }}>
        {value}
      </div>
    </div>
  );
}

// ── 연관 로그 패널 ─────────────────────────────────────

const LOG_LEVEL_COLORS: Record<string, string> = {
  TRACE: '#64748b', DEBUG: '#94a3b8', INFO: '#38bdf8', WARN: '#f59e0b', ERROR: '#ef4444', FATAL: '#dc2626',
};

function TraceLogsPanel({ logs, loading, traceId }: { logs: LogItem[]; loading: boolean; traceId: string }) {
  return (
    <div style={{ marginTop: 10, padding: 14, background: '#1a1d27', border: '1px solid #2d3148', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 13, color: '#f1f5f9' }}>📋 연관 로그 ({logs.length}건)</span>
        <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>trace_id: {traceId.slice(0, 16)}…</span>
      </div>
      {loading && <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8' }}>로그를 불러오는 중...</div>}
      {!loading && !logs.length && <div style={{ textAlign: 'center', padding: 20, color: '#64748b', fontSize: 13 }}>연관 로그가 없습니다.</div>}
      {!loading && logs.length > 0 && (
        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {logs.map((log, idx) => (
            <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 6px', borderBottom: '1px solid #1e2035', fontSize: 12 }}>
              <span style={{ flexShrink: 0, padding: '1px 6px', borderRadius: 3, fontSize: 10, fontWeight: 700, background: (LOG_LEVEL_COLORS[log.level] || '#64748b') + '22', color: LOG_LEVEL_COLORS[log.level] || '#64748b', minWidth: 40, textAlign: 'center' }}>
                {log.level}
              </span>
              <span style={{ flexShrink: 0, color: '#6366f1', fontFamily: 'monospace', fontSize: 11 }}>
                {(() => { try { return format(parseISO(log.time), 'HH:mm:ss.SSS'); } catch { return log.time; } })()}
              </span>
              <span style={{ flexShrink: 0, color: '#94a3b8', fontSize: 11 }}>[{log.service}]</span>
              <span style={{ color: '#e2e8f0', wordBreak: 'break-all', whiteSpace: 'pre-wrap', flex: 1 }}>{log.body}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const smallBtn: React.CSSProperties = {
  padding: '3px 10px', background: '#1e2035', border: '1px solid #2d3148',
  color: '#94a3b8', borderRadius: 5, cursor: 'pointer', fontSize: 11,
};
