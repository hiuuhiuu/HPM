import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, usePolling } from '../hooks/useApi';

import { useGlobalTime, Range } from '../contexts/GlobalTimeContext';

/* ─── 타입 ─── */
interface TopoNode {
  id: string;
  service?: string;   // 인스턴스 모드에서만 존재
  span_count: number;
  request_count: number;
  avg_ms: number;
  error_count: number;
  error_rate_pct: number;
}
interface TopoEdge {
  source: string;
  target: string;
  source_service?: string;
  target_service?: string;
  call_count: number;
  avg_ms: number;
  error_count: number;
  error_rate_pct: number;
}
interface TopoData  { nodes: TopoNode[]; edges: TopoEdge[]; }
interface LayoutNode extends TopoNode { x: number; y: number; }

type Level    = 'service' | 'instance';

const RANGES: Range[] = ['1h', '6h', '24h', '7d'];

/* ─── 서비스별 색상 팔레트 (인스턴스 모드용) ─── */
const SERVICE_PALETTE = [
  '#6366f1', '#06b6d4', '#10b981', '#f59e0b',
  '#ec4899', '#8b5cf6', '#14b8a6', '#f97316',
];
function buildServiceColorMap(nodes: TopoNode[]): Map<string, string> {
  const services = Array.from(new Set(nodes.map(n => n.service ?? n.id)));
  return new Map(services.map((s, i) => [s, SERVICE_PALETTE[i % SERVICE_PALETTE.length]]));
}

/* ─── Fruchterman-Reingold 포스 시뮬레이션 ─── */
function runForceLayout(
  nodes: TopoNode[],
  edges: TopoEdge[],
  width: number,
  height: number,
): LayoutNode[] {
  const n = nodes.length;
  if (n === 0) return [];
  const PAD = 80;
  const W = width - PAD * 2;
  const H = height - PAD * 2;

  const pos = nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    const r = Math.min(W, H) * 0.38;
    return { ...node, x: W / 2 + r * Math.cos(angle) + PAD, y: H / 2 + r * Math.sin(angle) + PAD, vx: 0, vy: 0 };
  });

  if (n === 1) return pos;

  const k = Math.sqrt((W * H) / n);

  for (let iter = 0; iter < 120; iter++) {
    const temp = 1 - iter / 120;

    for (let i = 0; i < n; i++) {
      let fx = 0, fy = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const rep = (k * k) / dist;
        fx += (dx / dist) * rep;
        fy += (dy / dist) * rep;
      }
      pos[i].vx = fx;
      pos[i].vy = fy;
    }

    for (const e of edges) {
      const si = pos.findIndex(p => p.id === e.source);
      const ti = pos.findIndex(p => p.id === e.target);
      if (si < 0 || ti < 0) continue;
      const dx = pos[ti].x - pos[si].x;
      const dy = pos[ti].y - pos[si].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const att = (dist * dist) / k;
      const fx = (dx / dist) * att;
      const fy = (dy / dist) * att;
      pos[si].vx += fx; pos[si].vy += fy;
      pos[ti].vx -= fx; pos[ti].vy -= fy;
    }

    for (let i = 0; i < n; i++) {
      const mag = Math.sqrt(pos[i].vx ** 2 + pos[i].vy ** 2) || 0.01;
      const move = Math.min(mag, temp * 60);
      pos[i].x = Math.max(PAD, Math.min(width - PAD, pos[i].x + (pos[i].vx / mag) * move));
      pos[i].y = Math.max(PAD, Math.min(height - PAD, pos[i].y + (pos[i].vy / mag) * move));
    }
  }

  return pos.map(({ vx, vy, ...rest }) => rest);
}

/* ─── 색상 유틸 ─── */
function errColor(errRate: number): string {
  if (errRate <= 0) return '#34d399';
  if (errRate < 5)  return '#fbbf24';
  return '#f87171';
}

function nodeRadius(spanCount: number, allCounts: number[]): number {
  const max = Math.max(...allCounts, 1);
  const min = Math.min(...allCounts, 0);
  const t   = max === min ? 0.5 : (spanCount - min) / (max - min);
  return 22 + (Math.log1p(t * 9) / Math.log1p(9)) * 24;
}

function edgeWidth(callCount: number, allCounts: number[]): number {
  const max = Math.max(...allCounts, 1);
  return 1.5 + (Math.log1p(callCount) / Math.log1p(max)) * 3.5;
}

/* ─── 툴팁 타입 ─── */
type TooltipState =
  | { kind: 'node'; node: LayoutNode; x: number; y: number }
  | { kind: 'edge'; edge: TopoEdge;   x: number; y: number }
  | null;

/* ─── 메인 컴포넌트 ─── */
export default function Topology() {
  const navigate = useNavigate();
  const { globalRange, setGlobalRange } = useGlobalTime();
  const [range, setRangeLocal] = useState<Range>(globalRange as Range);
  const setRange = (r: Range) => { setRangeLocal(r); setGlobalRange(r); };
  const [level, setLevel] = useState<Level>('service');

  const { data, loading, error, lastUpdated } = usePolling<TopoData>(
    () => apiFetch(`/api/dashboard/topology?range=${range}&level=${level}`),
    30_000,
    [range, level],
  );

  /* SVG 반응형 너비 */
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgW, setSvgW] = useState(800);
  const SVG_H = 520;

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(e => setSvgW(e[0].contentRect.width));
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  /* 포스 레이아웃 */
  const [layoutNodes, setLayoutNodes] = useState<LayoutNode[]>([]);
  useEffect(() => {
    if (!data) return;
    setLayoutNodes(runForceLayout(data.nodes, data.edges, svgW, SVG_H));
  }, [data, svgW]);

  /* 툴팁 */
  const [tooltip, setTooltip] = useState<TooltipState>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const handleNodeEnter = useCallback((e: React.MouseEvent, node: LayoutNode) => {
    const rect = svgRef.current!.getBoundingClientRect();
    // 줌/팬 트랜스폼 역산 필요 (툴팁은 SVG 절대좌표가 좋음)
    setTooltip({ kind: 'node', node, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);
  const handleEdgeEnter = useCallback((e: React.MouseEvent, edge: TopoEdge) => {
    const rect = svgRef.current!.getBoundingClientRect();
    setTooltip({ kind: 'edge', edge, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }, []);

  /* 줌 / 팬 상태 */
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newK = Math.max(0.1, Math.min(5, transform.k * scaleFactor));
    setTransform(prev => ({ ...prev, k: newK }));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX - transform.x, y: e.clientY - transform.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setTransform(prev => ({
      ...prev,
      x: e.clientX - dragStart.current.x,
      y: e.clientY - dragStart.current.y
    }));
  };

  const handleMouseUp = () => setIsDragging(false);
  const resetZoom = () => setTransform({ x: 0, y: 0, k: 1 });

  if (loading) return <div style={styles.loading}>토폴로지 로딩 중...</div>;
  if (error)   return <div style={styles.error}>오류: {error}</div>;
  if (!data)   return null;

  const { nodes, edges } = data;
  const allSpans = layoutNodes.map(n => n.span_count);
  const allCalls = edges.map(e => e.call_count);

  /* 인스턴스 모드: 서비스별 색상 맵 */
  const svcColorMap = level === 'instance' ? buildServiceColorMap(nodes) : new Map<string, string>();

  /* 양방향 엣지 */
  const edgeKeySet = new Set(edges.map(e => `${e.source}::${e.target}`));
  const isBidir = (e: TopoEdge) => edgeKeySet.has(`${e.target}::${e.source}`);

  const posMap = new Map(layoutNodes.map(n => [n.id, n]));

  /* 노드 클릭 시 트레이싱 필터 */
  const handleNodeClick = (node: TopoNode) => {
    const svc = node.service ?? node.id;
    navigate(`/traces?service=${encodeURIComponent(svc)}`);
  };

  return (
    <div style={styles.page}>
      {/* ── 헤더 ── */}
      <div style={styles.header}>
        <h2 style={styles.title}>서비스 토폴로지</h2>

        {/* 서비스 / 인스턴스 토글 */}
        <div style={styles.levelBar}>
          {(['service', 'instance'] as Level[]).map(lv => (
            <button
              key={lv}
              onClick={() => setLevel(lv)}
              style={{ ...styles.levelBtn, ...(level === lv ? styles.levelBtnActive : {}) }}
            >
              {lv === 'service' ? '서비스' : '인스턴스'}
            </button>
          ))}
        </div>

        {/* 시간 범위 */}
        <div style={styles.rangeBar}>
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{ ...styles.rangeBtn, ...(range === r ? styles.rangeBtnActive : {}) }}
            >
              {r}
            </button>
          ))}
        </div>

        <div style={styles.zoomControls}>
          <button onClick={() => setTransform(prev => ({ ...prev, k: Math.min(prev.k * 1.2, 5) }))} style={styles.zoomBtn} title="확대">+</button>
          <button onClick={() => setTransform(prev => ({ ...prev, k: Math.max(prev.k / 1.2, 0.1) }))} style={styles.zoomBtn} title="축소">-</button>
          <button onClick={resetZoom} style={styles.resetBtn}>줌 초기화</button>
        </div>

        {lastUpdated && (
          <span style={styles.updated}>갱신: {lastUpdated.toLocaleTimeString('ko-KR')}</span>
        )}
      </div>

      {/* 인스턴스 모드: 서비스 범례 */}
      {level === 'instance' && svcColorMap.size > 0 && (
        <div style={styles.legend}>
          {Array.from(svcColorMap.entries()).map(([svc, color]) => (
            <span key={svc} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, background: color }} />
              {svc}
            </span>
          ))}
        </div>
      )}

      {/* ── SVG 캔버스 ── */}
      <div ref={containerRef} style={styles.svgWrap}>
        {layoutNodes.length === 0 ? (
          <div style={styles.empty}>데이터 없음</div>
        ) : (
          <svg 
            ref={svgRef} 
            width={svgW} 
            height={SVG_H} 
            style={{ display: 'block', cursor: isDragging ? 'grabbing' : 'grab' }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { setTooltip(null); handleMouseUp(); }}
          >
            <defs>
              <marker id="arrow-ok"  markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#6366f1" />
              </marker>
              <marker id="arrow-err" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#ef4444" />
              </marker>
            </defs>

            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
              {/* 엣지 */}
              {edges.map((edge, i) => {
              const src = posMap.get(edge.source);
              const tgt = posMap.get(edge.target);
              if (!src || !tgt) return null;

              const r   = nodeRadius(tgt.span_count, allSpans);
              const dx  = tgt.x - src.x;
              const dy  = tgt.y - src.y;
              const len = Math.sqrt(dx * dx + dy * dy) || 1;
              const ex  = tgt.x - (dx / len) * (r + 8);
              const ey  = tgt.y - (dy / len) * (r + 8);

              const isErr  = edge.error_rate_pct >= 5;
              const stroke = isErr ? '#ef4444' : '#6366f1';
              const marker = isErr ? 'url(#arrow-err)' : 'url(#arrow-ok)';
              const sw     = edgeWidth(edge.call_count, allCalls);

              let d: string;
              if (isBidir(edge)) {
                const mx = (src.x + tgt.x) / 2;
                const my = (src.y + tgt.y) / 2;
                const offset = 20;
                d = `M ${src.x} ${src.y} Q ${mx + (-dy / len) * offset} ${my + (dx / len) * offset} ${ex} ${ey}`;
              } else {
                d = `M ${src.x} ${src.y} L ${ex} ${ey}`;
              }

              return (
                <path key={i} d={d} fill="none" stroke={stroke} strokeWidth={sw}
                  strokeOpacity={0.7} markerEnd={marker} style={{ cursor: 'pointer' }}
                  onMouseEnter={e => handleEdgeEnter(e, edge)}
                  onMouseLeave={() => setTooltip(null)} />
              );
            })}

            {/* 노드 */}
            {layoutNodes.map(node => {
              const r = nodeRadius(node.span_count, allSpans);

              // 서비스 모드: 에러율 기반 색상
              // 인스턴스 모드: 소속 서비스 색상 + 에러율 기반 스트로크
              const isInstanceMode = level === 'instance';
              const svcKey  = node.service ?? node.id;
              const fill    = isInstanceMode ? (svcColorMap.get(svcKey) ?? '#6366f1') : errColor(node.error_rate_pct);
              const stroke  = isInstanceMode ? errColor(node.error_rate_pct) : '#1a1d27';
              const strokeW = isInstanceMode ? 3 : 2;

              return (
                <g key={node.id}>
                  <circle cx={node.x} cy={node.y} r={r}
                    fill={fill} fillOpacity={0.85}
                    stroke={stroke} strokeWidth={strokeW}
                    style={{ cursor: 'pointer' }}
                    onMouseEnter={e => handleNodeEnter(e, node)}
                    onMouseLeave={() => setTooltip(null)}
                    onClick={() => handleNodeClick(node)}
                  />
                  {/* 인스턴스 모드: 인스턴스명(위) + 서비스명(아래, 작게) */}
                  <text x={node.x} y={node.y + r + 13} textAnchor="middle"
                    fontSize={11} fill="#cbd5e1"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}>
                    {node.id}
                  </text>
                  {isInstanceMode && node.service && (
                    <text x={node.x} y={node.y + r + 25} textAnchor="middle"
                      fontSize={9} fill="#64748b"
                      style={{ pointerEvents: 'none', userSelect: 'none' }}>
                      {node.service}
                    </text>
                  )}
                </g>
              );
            })}
            </g>

            {/* 툴팁 */}
            {tooltip && (
              <foreignObject x={tooltip.x + 12} y={tooltip.y - 10}
                width={220} height={140} style={{ overflow: 'visible', pointerEvents: 'none' }}>
                <div style={styles.tooltip}>
                  {tooltip.kind === 'node' ? (
                    <>
                      <div style={styles.ttTitle}>{tooltip.node.id}</div>
                      {tooltip.node.service && (
                        <div style={{ color: '#94a3b8', marginBottom: 2 }}>
                          서비스: {tooltip.node.service}
                        </div>
                      )}
                      <div>요청수: {tooltip.node.request_count.toLocaleString()}</div>
                      <div>에러율: {tooltip.node.error_rate_pct.toFixed(1)}%</div>
                      <div>평균 응답: {tooltip.node.avg_ms.toFixed(1)}ms</div>
                    </>
                  ) : (
                    <>
                      <div style={styles.ttTitle}>
                        {tooltip.edge.source} → {tooltip.edge.target}
                      </div>
                      {tooltip.edge.source_service && (
                        <div style={{ color: '#94a3b8', marginBottom: 2, fontSize: 11 }}>
                          {tooltip.edge.source_service} → {tooltip.edge.target_service}
                        </div>
                      )}
                      <div>호출수: {tooltip.edge.call_count.toLocaleString()}</div>
                      <div>에러율: {tooltip.edge.error_rate_pct.toFixed(1)}%</div>
                      <div>평균 응답: {tooltip.edge.avg_ms.toFixed(1)}ms</div>
                    </>
                  )}
                </div>
              </foreignObject>
            )}
          </svg>
        )}
      </div>

      {/* ── 하단 테이블 ── */}
      <div style={styles.tables}>
        {/* 노드 요약 */}
        <div style={styles.tableCard}>
          <div style={styles.tableTitle}>
            {level === 'service' ? '서비스 요약' : '인스턴스 요약'}
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                {level === 'instance' && <th style={styles.th}>서비스</th>}
                <th style={styles.th}>{level === 'service' ? '서비스' : '인스턴스'}</th>
                {['요청수', '에러수', '에러율', '평균ms'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {nodes.map(n => (
                <tr key={n.id} style={styles.tr}>
                  {level === 'instance' && (
                    <td style={styles.td}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <span style={{
                          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                          background: svcColorMap.get(n.service ?? '') ?? '#6366f1',
                        }} />
                        {n.service}
                      </span>
                    </td>
                  )}
                  <td style={styles.td}>
                    <span style={{ color: '#818cf8', cursor: 'pointer' }}
                      onClick={() => handleNodeClick(n)}>
                      {n.id}
                    </span>
                  </td>
                  <td style={styles.tdNum}>{n.request_count.toLocaleString()}</td>
                  <td style={styles.tdNum}>{n.error_count.toLocaleString()}</td>
                  <td style={{ ...styles.tdNum, color: n.error_rate_pct >= 5 ? '#f87171' : '#34d399' }}>
                    {n.error_rate_pct.toFixed(1)}%
                  </td>
                  <td style={styles.tdNum}>{n.avg_ms.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 호출 관계 */}
        <div style={styles.tableCard}>
          <div style={styles.tableTitle}>호출 관계</div>
          <table style={styles.table}>
            <thead>
              <tr>
                {['출발', '도착', '호출수', '에러율', '평균ms'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {edges.map((e, i) => (
                <tr key={i} style={styles.tr}>
                  <td style={styles.td}>
                    <div>{e.source}</div>
                    {e.source_service && <div style={{ fontSize: 10, color: '#475569' }}>{e.source_service}</div>}
                  </td>
                  <td style={styles.td}>
                    <div>{e.target}</div>
                    {e.target_service && <div style={{ fontSize: 10, color: '#475569' }}>{e.target_service}</div>}
                  </td>
                  <td style={styles.tdNum}>{e.call_count.toLocaleString()}</td>
                  <td style={{ ...styles.tdNum, color: e.error_rate_pct >= 5 ? '#f87171' : '#34d399' }}>
                    {e.error_rate_pct.toFixed(1)}%
                  </td>
                  <td style={styles.tdNum}>{e.avg_ms.toFixed(1)}</td>
                </tr>
              ))}
              {edges.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ ...styles.td, textAlign: 'center', color: '#475569' }}>
                    호출 관계 없음
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ─── 스타일 ─── */
const styles: Record<string, React.CSSProperties> = {
  page:    { padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 },
  header:  { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  title:   { margin: 0, fontSize: 20, fontWeight: 700, color: '#e2e8f0' },
  levelBar: {
    display: 'flex', gap: 0,
    background: '#1e2235', borderRadius: 8, padding: 3,
  },
  levelBtn: {
    padding: '4px 14px', borderRadius: 6, border: 'none',
    background: 'transparent', color: '#94a3b8',
    cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
  levelBtnActive: { background: '#4f46e5', color: '#fff' },
  rangeBar: {
    display: 'flex', gap: 4,
    background: '#1e2235', borderRadius: 8, padding: 4,
  },
  rangeBtn: {
    padding: '4px 12px', borderRadius: 6, border: 'none',
    background: 'transparent', color: '#94a3b8',
    cursor: 'pointer', fontSize: 13, fontWeight: 500,
  },
  rangeBtnActive: { background: '#6366f1', color: '#fff' },
  resetBtn: {
    padding: '4px 12px', borderRadius: 6, border: '1px solid #374151',
    background: '#1e2235', color: '#cbd5e1',
    cursor: 'pointer', fontSize: 12, fontWeight: 500,
    marginLeft: 8,
  },
  updated: { marginLeft: 'auto', fontSize: 12, color: '#475569' },
  zoomControls: {
    display: 'flex', gap: 4, marginLeft: 8,
  },
  zoomBtn: {
    width: 28, height: 28, borderRadius: 6, border: '1px solid #374151',
    background: '#1e2235', color: '#cbd5e1',
    cursor: 'pointer', fontSize: 16, fontWeight: 600,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  legend: {
    display: 'flex', flexWrap: 'wrap', gap: 12,
    padding: '8px 12px', background: '#131625',
    borderRadius: 8, border: '1px solid #2d3148',
  },
  legendItem: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' },
  legendDot:  { width: 10, height: 10, borderRadius: '50%', flexShrink: 0 },
  svgWrap: {
    background: '#131625', borderRadius: 12,
    border: '1px solid #2d3148', position: 'relative',
    minHeight: 520, overflow: 'hidden',
  },
  empty: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    height: 520, color: '#475569', fontSize: 14,
  },
  tables:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  tableCard: {
    background: '#131625', borderRadius: 12,
    border: '1px solid #2d3148', padding: 16, overflow: 'auto',
  },
  tableTitle: { fontSize: 14, fontWeight: 600, color: '#94a3b8', marginBottom: 12 },
  table:     { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'left', padding: '6px 8px',
    color: '#64748b', fontWeight: 500, borderBottom: '1px solid #1e2235',
  },
  tr:    { borderBottom: '1px solid #1a1d27' },
  td:    { padding: '6px 8px', color: '#cbd5e1' },
  tdNum: { padding: '6px 8px', color: '#94a3b8', textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  tooltip: {
    background: '#1e2235', border: '1px solid #374151',
    borderRadius: 8, padding: '8px 12px', fontSize: 12,
    color: '#cbd5e1', lineHeight: 1.8,
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
  },
  ttTitle: { fontWeight: 700, color: '#e2e8f0', marginBottom: 4 },
  loading: { padding: 40, textAlign: 'center', color: '#64748b' },
  error:   { padding: 40, textAlign: 'center', color: '#f87171' },
};
