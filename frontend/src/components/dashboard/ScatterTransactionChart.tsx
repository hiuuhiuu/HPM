import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import type { ScatterPoint } from '../../types/dashboard';
import { rtColor, stripMethod } from '../../utils/dashboardColors';

const PAD = { top: 8, right: 16, bottom: 28, left: 56 };
const SVG_H = 220;

export default function ScatterTransactionChart({
  data, selectedTraceId, onDotClick, hideService,
}: {
  data: ScatterPoint[];
  selectedTraceId: string | null;
  onDotClick: (traceId: string) => void;
  hideService?: boolean;
}) {
  const [tooltip, setTooltip] = useState<{ d: ScatterPoint; x: number; y: number } | null>(null);
  const [svgW, setSvgW]       = useState(800);
  const [now,  setNow]        = useState(() => new Date());

  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart]   = useState<{ x: number, y: number } | null>(null);
  const [dragEnd, setDragEnd]       = useState<{ x: number, y: number } | null>(null);
  const [selectedPoints, setSelectedPoints] = useState<ScatterPoint[]>([]);

  const ref = React.useRef<SVGSVGElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(e => setSvgW(e[0].contentRect.width));
    ro.observe(ref.current.parentElement!);
    return () => ro.disconnect();
  }, []);

  const windowMs = 10 * 60 * 1000;
  const xMax = now.getTime();
  const xMin = xMax - windowMs;
  const plotW = svgW - PAD.left - PAD.right;
  const plotH = SVG_H - PAD.top - PAD.bottom;

  const yMax = data.length > 0
    ? Math.ceil(Math.max(...data.map(d => d.duration_ms)) * 1.2 / 100) * 100
    : 1000;

  const toX = (ts: number) => Math.max(0, Math.min(plotW, ((ts - xMin) / windowMs) * plotW));
  const toY = (ms: number) => plotH - Math.max(0, Math.min(plotH, (ms / yMax) * plotH));

  const tickInterval = 60_000;
  const firstTick = Math.ceil(xMin / tickInterval) * tickInterval;
  const xTicks: number[] = [];
  for (let ts = firstTick; ts <= xMax; ts += tickInterval) {
    xTicks.push(ts);
  }
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(r => Math.round(r * yMax));

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!ref.current) return;
    const svg = ref.current.getBoundingClientRect();
    const x = e.clientX - svg.left - PAD.left;
    const y = e.clientY - svg.top - PAD.top;
    if (x >= 0 && x <= plotW && y >= 0 && y <= plotH) {
      setIsDragging(true);
      setDragStart({ x, y });
      setDragEnd({ x, y });
      setSelectedPoints([]);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || !ref.current) return;
    const svg = ref.current.getBoundingClientRect();
    let x = e.clientX - svg.left - PAD.left;
    let y = e.clientY - svg.top - PAD.top;
    x = Math.max(0, Math.min(plotW, x));
    y = Math.max(0, Math.min(plotH, y));
    setDragEnd({ x, y });
  };

  const handleMouseUp = () => {
    if (!isDragging || !dragStart || !dragEnd) return;
    setIsDragging(false);

    const minX = Math.min(dragStart.x, dragEnd.x);
    const maxX = Math.max(dragStart.x, dragEnd.x);
    const minY = Math.min(dragStart.y, dragEnd.y);
    const maxY = Math.max(dragStart.y, dragEnd.y);

    if (maxX - minX < 5 && maxY - minY < 5) {
      setDragStart(null);
      setDragEnd(null);
      setSelectedPoints([]);
      return;
    }

    const points = data.filter(d => {
      const cx = toX(d.ts);
      const cy = toY(d.duration_ms);
      return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
    });
    points.sort((a, b) => b.duration_ms - a.duration_ms);
    setSelectedPoints(points);
  };

  return (
    <div className="card" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span className="card-title" style={{ marginBottom: 0 }}>
          트랜잭션 분포 ({data.length}건)
        </span>
        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: '#64748b' }}>
          <span><span style={{ color: '#6366f1' }}>●</span> 정상</span>
          <span><span style={{ color: '#ef4444' }}>●</span> 에러</span>
          <span style={{ color: '#475569' }}>드래그 → 범위 내 트랜잭션 목록 조회</span>
        </div>
      </div>

      <div style={{ position: 'relative', width: '100%', userSelect: 'none' }}>
        <svg
          ref={ref}
          width="100%" height={SVG_H}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={() => { setTooltip(null); handleMouseUp(); }}
        >
          <g transform={`translate(${PAD.left},${PAD.top})`}>
            {yTicks.map(v => (
              <g key={v}>
                <line x1={0} y1={toY(v)} x2={plotW} y2={toY(v)}
                  stroke="#2d3148" strokeWidth={1} strokeDasharray="3 3" />
                <text x={-6} y={toY(v)} dy="0.35em"
                  textAnchor="end" fill="#64748b" fontSize={10}>
                  {v}ms
                </text>
              </g>
            ))}

            {xTicks.map(ts => (
              <g key={ts}>
                <line x1={toX(ts)} y1={0} x2={toX(ts)} y2={plotH}
                  stroke="#2d3148" strokeWidth={1} strokeDasharray="3 3" />
                <text x={toX(ts)} y={plotH + 16}
                  textAnchor="middle" fill="#64748b" fontSize={10}>
                  {format(new Date(ts), 'HH:mm')}
                </text>
              </g>
            ))}

            {data.map(d => {
              const cx = toX(d.ts);
              const cy = toY(d.duration_ms);
              const isSelected = d.trace_id === selectedTraceId;
              const isError    = d.status === 'ERROR';
              return (
                <circle
                  key={d.trace_id}
                  cx={cx} cy={cy}
                  r={isSelected ? 7 : 4}
                  fill={isError ? '#ef4444' : '#6366f1'}
                  fillOpacity={isSelected ? 1 : 0.7}
                  stroke={isSelected ? '#fff' : 'none'}
                  strokeWidth={isSelected ? 1.5 : 0}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onDotClick(d.trace_id)}
                  onMouseEnter={e => {
                    const svg = ref.current!.getBoundingClientRect();
                    setTooltip({ d, x: e.clientX - svg.left, y: e.clientY - svg.top });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                />
              );
            })}

            {dragStart && dragEnd && (
              <rect
                x={Math.min(dragStart.x, dragEnd.x)}
                y={Math.min(dragStart.y, dragEnd.y)}
                width={Math.abs(dragEnd.x - dragStart.x)}
                height={Math.abs(dragEnd.y - dragStart.y)}
                fill="#6366f1"
                fillOpacity={0.2}
                stroke="#6366f1"
                strokeWidth={1}
                strokeDasharray="4 4"
                pointerEvents="none"
              />
            )}
          </g>
        </svg>

        {tooltip && (
          <div style={{
            position: 'absolute',
            left: tooltip.x + 12, top: tooltip.y - 10,
            background: '#1e2035', border: '1px solid #2d3148',
            borderRadius: 6, padding: '10px 14px', fontSize: 12,
            pointerEvents: 'none', zIndex: 10, whiteSpace: 'nowrap',
          }}>
            <div style={{ color: tooltip.d.status === 'ERROR' ? '#f87171' : '#a5b4fc', fontWeight: 600, marginBottom: 4 }}>
              {stripMethod(tooltip.d.root_name)}
            </div>
            {!hideService && <div style={{ color: '#94a3b8' }}>서비스: <span style={{ color: '#e2e8f0' }}>{tooltip.d.service}</span></div>}
            <div style={{ color: '#94a3b8' }}>시간: <span style={{ color: '#e2e8f0' }}>{format(new Date(tooltip.d.ts), 'HH:mm:ss')}</span></div>
            <div style={{ color: '#94a3b8' }}>응답: <span style={{ color: '#e2e8f0' }}>{tooltip.d.duration_ms.toFixed(1)} ms</span></div>
            <div style={{ color: '#64748b', marginTop: 4, fontSize: 11 }}>클릭하여 스택 보기</div>
          </div>
        )}

        {selectedPoints.length > 0 && (
          <div style={{
            position: 'absolute',
            top: PAD.top, right: PAD.right,
            width: 380, maxHeight: plotH, overflowY: 'auto',
            background: '#1a1c2ee6', border: '1px solid #2d3148',
            borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
            zIndex: 20, display: 'flex', flexDirection: 'column',
            backdropFilter: 'blur(4px)',
          }}>
            <div style={{
              padding: '10px 14px', borderBottom: '1px solid #2d3148', display: 'flex',
              justifyContent: 'space-between', alignItems: 'center', position: 'sticky',
              top: 0, background: '#1a1c2ef2', zIndex: 21
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: '#f1f5f9' }}>
                선택된 트랜잭션 ({selectedPoints.length}건)
              </span>
              <button
                onClick={() => { setSelectedPoints([]); setDragStart(null); setDragEnd(null); }}
                style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                aria-label="선택 닫기"
              >✕</button>
            </div>
            <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {selectedPoints.map(p => (
                <div
                  key={p.trace_id}
                  onClick={() => onDotClick(p.trace_id)}
                  style={{
                    padding: '8px 10px', borderRadius: 4, cursor: 'pointer',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: selectedTraceId === p.trace_id ? '#252840' : 'transparent',
                    borderLeft: `3px solid ${p.status === 'ERROR' ? '#ef4444' : '#6366f1'}`
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#1e2035'}
                  onMouseLeave={e => e.currentTarget.style.background = selectedTraceId === p.trace_id ? '#252840' : 'transparent'}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: p.status === 'ERROR' ? '#fca5a5' : '#e2e8f0', fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {stripMethod(p.root_name)}
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: 11, marginTop: 2 }}>
                      {format(new Date(p.ts), 'HH:mm:ss')}{!hideService && ` · ${p.service}`}
                    </div>
                  </div>
                  <div style={{ color: rtColor(p.duration_ms), fontSize: 12, fontWeight: 600, flexShrink: 0, paddingLeft: 10 }}>
                    {p.duration_ms.toFixed(1)} ms
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
