import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, NavLink, useNavigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Metrics from './pages/Metrics';
import Traces from './pages/Traces';
import Errors from './pages/Errors';
import Logs from './pages/Logs';
import Alerts from './pages/Alerts';
import Topology from './pages/Topology';
import Statistics from './pages/Statistics';
import Settings from './pages/Settings';
import ThreadDumps from './pages/ThreadDumps';
import CustomDashboard from './pages/CustomDashboard';
import SlowQueries from './pages/SlowQueries';
import { useDashboardWebSocket } from './hooks/useWebSocket';
import { GlobalTimeProvider } from './contexts/GlobalTimeContext';
import './App.css';

function App() {
  const { unresolved, activeAlerts } = useDashboardWebSocket();
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail;
      const id = Date.now();
      setToasts(prev => [...prev, { id, message: msg }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
    };
    window.addEventListener('api-error', handler);
    return () => window.removeEventListener('api-error', handler);
  }, []);

  return (
    <Router>
      <GlobalTimeProvider>
      <div className="app">
        <nav className="sidebar">
          <HamsterLogo />
          <ul className="nav-links">
            <li>
              <NavLink to="/" end>대시보드</NavLink>
            </li>
            <li>
              <NavLink to="/custom-dashboard">커스텀 대시보드</NavLink>
            </li>
            <li>
              <NavLink to="/metrics">메트릭</NavLink>
            </li>
            <li>
              <NavLink to="/traces">트레이싱</NavLink>
            </li>
            <li>
              <NavLink to="/errors">
                에러 추적
                {unresolved > 0 && <Badge count={unresolved} color="#ef4444" />}
              </NavLink>
            </li>
            <li>
              <NavLink to="/logs">로그</NavLink>
            </li>
            <li>
              <NavLink to="/alerts">
                알림
                {activeAlerts > 0 && <Badge count={activeAlerts} color="#f59e0b" />}
              </NavLink>
            </li>
            <li><NavLink to="/topology">토폴로지</NavLink></li>
            <li><NavLink to="/statistics">통계</NavLink></li>
            <li><NavLink to="/thread-dumps">스레드 덤프</NavLink></li>
            <li><NavLink to="/slow-queries">SQL 슬로우 쿼리</NavLink></li>
          </ul>
          <div className="settings-nav">
            <NavLink to="/settings" className="settings-link">
              설정(Settings)
            </NavLink>
          </div>
          <SidebarFooter />
        </nav>
        <main className="main-content">
          <Routes>
            <Route path="/"       element={<Dashboard />} />
            <Route path="/metrics" element={<Metrics />} />
            <Route path="/traces"  element={<Traces />} />
            <Route path="/errors"  element={<Errors />} />
            <Route path="/logs"    element={<Logs />} />
            <Route path="/alerts"  element={<Alerts />} />
            <Route path="/topology" element={<Topology />} />
            <Route path="/statistics" element={<Statistics />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/thread-dumps" element={<ThreadDumps />} />
            <Route path="/custom-dashboard" element={<CustomDashboard />} />
            <Route path="/slow-queries" element={<SlowQueries />} />
          </Routes>
        </main>
      </div>

      {/* 글로벌 에러 Toast */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 9999 }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: 'var(--bg-elevated)', border: '1px solid var(--color-error)',
            borderLeft: '4px solid var(--color-error)', borderRadius: 'var(--radius)',
            padding: '10px 16px', color: 'var(--color-error)',
            fontSize: 13, maxWidth: 340, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
            animation: 'page-enter 0.2s ease',
          }}>
            <span style={{ marginRight: 6, fontWeight: 700 }}>⚠</span>
            {t.message}
          </div>
        ))}
      </div>
      </GlobalTimeProvider>
    </Router>
  );
}

function HamsterLogo() {
  const navigate = useNavigate();
  // 쳇바퀴: 중심(50,46) 반지름 40 → 내부 바닥 y=86
  // 햄스터 발이 y≈85에 닿고, 전체가 쳇바퀴 안에 들어가도록 좌표 배치
  const WX = 50, WY = 46, WR = 40;
  const spokes = [0, 45, 90, 135];

  return (
    <div className="hamster-logo" onClick={() => navigate('/')} title="대시보드로 이동">
      <svg viewBox="0 0 100 100" width="88" height="88">

        {/* ── 쳇바퀴 (회전) ── */}
        <g className="hamster-wheel-spin">
          <circle cx={WX} cy={WY} r={WR} fill="none" stroke="#6366f1" strokeWidth="3.5" />
          <circle cx={WX} cy={WY} r={WR * 0.62} fill="none" stroke="#4f46e5"
            strokeWidth="1" strokeDasharray="5 4" opacity="0.4" />
          {spokes.map(a => {
            const r = (a * Math.PI) / 180;
            return (
              <line key={a}
                x1={WX + WR * Math.cos(r)} y1={WY + WR * Math.sin(r)}
                x2={WX - WR * Math.cos(r)} y2={WY - WR * Math.sin(r)}
                stroke="#6366f1" strokeWidth="1.8"
              />
            );
          })}
          <circle cx={WX} cy={WY} r="5" fill="#6366f1" />
          <circle cx={WX} cy={WY} r="2.2" fill="#1a1d27" />
        </g>

        {/* ── 골든 햄스터 (측면, 오른쪽이 앞, 쳇바퀴 안) — 몸통 바운스 그룹 ── */}
        <g className="hamster-body-group">

          {/* 꼬리: 아주 짧은 뭉텅이 */}
          <ellipse cx="32" cy="73" rx="3" ry="2" fill="#9a6200"
            transform="rotate(-10 32 73)" />

          {/* 뒷다리 */}
          <g className="hamster-back-legs">
            <line x1="38" y1="77" x2="32" y2="86"
              stroke="#7a4e00" strokeWidth="4.5" strokeLinecap="round" />
            <line x1="38" y1="77" x2="44" y2="86"
              stroke="#c8860a" strokeWidth="4" strokeLinecap="round" />
          </g>

          {/* 몸통 - 통통하고 둥근 골든햄스터 */}
          <ellipse cx="50" cy="72" rx="19" ry="12" fill="#c8860a" />
          {/* 배 - 크림색 */}
          <ellipse cx="51" cy="73" rx="11" ry="8" fill="#fff3dc" />

          {/* 앞다리 */}
          <g className="hamster-front-legs">
            <line x1="63" y1="77" x2="57" y2="86"
              stroke="#7a4e00" strokeWidth="4.5" strokeLinecap="round" />
            <line x1="63" y1="77" x2="69" y2="86"
              stroke="#c8860a" strokeWidth="4" strokeLinecap="round" />
          </g>

          {/* 머리 */}
          <circle cx="67" cy="62" r="12" fill="#c8860a" />

          {/* 볼 주머니 - 골든햄스터 특징, 자연스러운 크기 */}
          <ellipse cx="75" cy="66" rx="6.5" ry="5.5" fill="#fff3dc" />

          {/* 귀: 작고 둥글게 세운 모양 */}
          <ellipse cx="63" cy="51" rx="4" ry="5" fill="#c8860a" />
          <ellipse cx="63" cy="51" rx="2.4" ry="3.2" fill="#f0a0a0" />

          {/* 눈: 크고 검은, 반짝이는 */}
          <circle cx="74" cy="59" r="3.2" fill="#1a0a00" />
          <circle cx="75.2" cy="57.8" r="1.1" fill="white" />

          {/* 코: 작은 분홍 */}
          <ellipse cx="79" cy="64" rx="1.5" ry="1.1" fill="#cc7a8a" />

          {/* 입 */}
          <path d="M78 65.5 Q79.5 67 78 68"
            fill="none" stroke="#a05060" strokeWidth="0.8" strokeLinecap="round" />

          {/* 수염 */}
          <line x1="78.5" y1="63.5" x2="85" y2="61.5"
            stroke="#9a6200" strokeWidth="0.6" strokeLinecap="round" opacity="0.7" />
          <line x1="78.5" y1="65" x2="85" y2="65"
            stroke="#9a6200" strokeWidth="0.6" strokeLinecap="round" opacity="0.7" />
          <line x1="78.5" y1="66.5" x2="85" y2="68"
            stroke="#9a6200" strokeWidth="0.6" strokeLinecap="round" opacity="0.7" />

        </g>
      </svg>
      <span className="hamster-label">Performance Monitor</span>
    </div>
  );
}

function Badge({ count, color }: { count: number; color: string }) {
  return (
    <span style={{
      marginLeft: 'auto',
      background: color, color: '#fff',
      borderRadius: 10, padding: '1px 6px',
      fontSize: 11, fontWeight: 700, lineHeight: 1.5,
    }}>
      {count > 99 ? '99+' : count}
    </span>
  );
}

function SidebarFooter() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{
      padding: '12px 16px',
      borderTop: '1px solid var(--border)',
      fontSize: 11,
      color: 'var(--text-muted)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>현재 시각</span>
        <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
          {time.toLocaleTimeString('ko-KR')}
        </span>
      </div>
      <div style={{ marginTop: 4, color: 'var(--text-disabled)' }}>v0.1.0</div>
    </div>
  );
}

export default App;
