import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Insight } from '../../types/dashboard';
import { INSIGHT_ICON, LEVEL_COLOR } from '../../utils/dashboardColors';

export default function InsightsPanel({ insights }: { insights: Insight[] }) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = React.useState(false);

  const criticalCount = insights.filter(i => i.level === 'critical').length;
  const warningCount  = insights.filter(i => i.level === 'warning').length;

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', border: `1px solid ${criticalCount > 0 ? '#7f1d1d' : '#78350f'}` }}>
      <div
        style={{
          padding: '12px 16px',
          borderBottom: collapsed ? 'none' : '1px solid #2d3148',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', background: '#1a1c2e',
        }}
        onClick={() => setCollapsed(v => !v)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 15 }}>🔍</span>
          <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 14 }}>자동 분석 인사이트</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {criticalCount > 0 && (
              <span style={{
                background: '#7f1d1d', color: '#fca5a5',
                fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
              }}>
                위험 {criticalCount}
              </span>
            )}
            {warningCount > 0 && (
              <span style={{
                background: '#78350f', color: '#fdba74',
                fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 10,
              }}>
                경고 {warningCount}
              </span>
            )}
          </div>
        </div>
        <span style={{ color: '#475569', fontSize: 12 }}>{collapsed ? '▼ 펼치기' : '▲ 접기'}</span>
      </div>

      {!collapsed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {insights.map((ins, i) => (
            <a
              key={i}
              href={ins.link}
              onClick={e => { e.preventDefault(); if (ins.link) navigate(ins.link); }}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '12px 16px',
                borderBottom: i < insights.length - 1 ? '1px solid #1e2035' : 'none',
                borderLeft: `3px solid ${LEVEL_COLOR[ins.level] ?? '#64748b'}`,
                textDecoration: 'none',
                background: 'transparent',
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#1e2035')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>
                {INSIGHT_ICON[ins.category] ?? '💡'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                    color: LEVEL_COLOR[ins.level],
                    background: LEVEL_COLOR[ins.level] + '22',
                    padding: '1px 6px', borderRadius: 4, flexShrink: 0,
                  }}>
                    {ins.level === 'critical' ? '위험' : ins.level === 'warning' ? '경고' : '정보'}
                  </span>
                  <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ins.title}
                  </span>
                </div>
                <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.5 }}>
                  {ins.description}
                </div>
              </div>
              <span style={{ color: '#475569', fontSize: 12, flexShrink: 0, marginTop: 2 }}>→</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
