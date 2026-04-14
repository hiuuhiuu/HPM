import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../hooks/useApi';

// ── 타입 정의 ────────────────────────────────────────────────
type ItemKind = 'page' | 'service' | 'instance' | 'action' | 'recent';

interface PaletteItem {
  id: string;
  kind: ItemKind;
  title: string;
  subtitle?: string;
  keywords?: string;
  onSelect: () => void;
}

interface Props {
  open: boolean;
  onClose: () => void;
}

// ── 상수 ────────────────────────────────────────────────────
const RECENT_STORAGE = 'hamster_palette_recent_v1';
const RECENT_MAX = 5;

const PAGES: Array<{ title: string; path: string; keywords: string; icon: string }> = [
  { title: '대시보드',         path: '/',                 keywords: 'dashboard home overview',           icon: '📊' },
  { title: '커스텀 대시보드',   path: '/custom-dashboard', keywords: 'custom dashboard grid',             icon: '🧩' },
  { title: '메트릭',           path: '/metrics',          keywords: 'metrics cpu memory jvm',            icon: '📈' },
  { title: '트레이싱',         path: '/traces',           keywords: 'trace span waterfall',              icon: '🛰' },
  { title: '로그',             path: '/logs',             keywords: 'log severity',                       icon: '📝' },
  { title: '에러 추적',         path: '/errors',           keywords: 'error exception stacktrace',         icon: '⚠' },
  { title: '알림',             path: '/alerts',           keywords: 'alert rule notification',           icon: '🔔' },
  { title: '통계',             path: '/statistics',       keywords: 'statistics stats summary',          icon: '📊' },
  { title: '토폴로지',          path: '/topology',         keywords: 'topology service map graph',        icon: '🕸' },
  { title: '스레드 덤프',       path: '/thread-dumps',     keywords: 'thread dump jvm stack',             icon: '🧵' },
  { title: 'SQL 슬로우 쿼리',   path: '/slow-queries',     keywords: 'sql slow query db database',        icon: '🐌' },
  { title: '설정',             path: '/settings',         keywords: 'settings preferences config',       icon: '⚙' },
];

// ── 유틸: fuzzy substring 매치 ────────────────────────────────
function matches(item: PaletteItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const hay = `${item.title} ${item.subtitle ?? ''} ${item.keywords ?? ''}`.toLowerCase();
  return hay.includes(q);
}

// ── 최근 선택 항목 ───────────────────────────────────────────
function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE);
    return raw ? (JSON.parse(raw) as string[]).slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

function pushRecent(id: string) {
  try {
    const prev = loadRecent().filter(x => x !== id);
    localStorage.setItem(RECENT_STORAGE, JSON.stringify([id, ...prev].slice(0, RECENT_MAX)));
  } catch { /* 저장 실패 무시 */ }
}

// ── 메인 컴포넌트 ───────────────────────────────────────────
export default function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [services, setServices] = useState<Array<{ name: string }>>([]);
  const [instances, setInstances] = useState<Array<{ service: string; instance: string }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 팔레트 열릴 때 데이터 lazy 로드 + 포커스
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedIdx(0);
    setTimeout(() => inputRef.current?.focus(), 30);

    apiFetch<Array<{ name: string }>>('/api/services').then(setServices).catch(() => {});
    apiFetch<Array<{ service: string; instance: string }>>('/api/instances').then(setInstances).catch(() => {});
  }, [open]);

  // 아이템 구성 (쿼리 변경 시 재계산)
  const items = useMemo<PaletteItem[]>(() => {
    const go = (path: string) => () => { navigate(path); onClose(); };

    const pageItems: PaletteItem[] = PAGES.map(p => ({
      id: `page:${p.path}`,
      kind: 'page',
      title: p.title,
      subtitle: p.path,
      keywords: p.keywords,
      onSelect: go(p.path),
    }));

    const serviceItems: PaletteItem[] = services.map(s => ({
      id: `service:${s.name}`,
      kind: 'service',
      title: s.name,
      subtitle: '서비스 메트릭 보기',
      keywords: 'service metric ' + s.name,
      onSelect: go(`/metrics?service=${encodeURIComponent(s.name)}`),
    }));

    const instanceItems: PaletteItem[] = instances.map(i => ({
      id: `instance:${i.service}/${i.instance}`,
      kind: 'instance',
      title: i.instance,
      subtitle: `${i.service} 인스턴스`,
      keywords: `instance ${i.service} ${i.instance}`,
      onSelect: go(`/?instance=${encodeURIComponent(i.instance)}`),
    }));

    const actionItems: PaletteItem[] = [
      {
        id: 'action:new-alert',
        kind: 'action',
        title: '새 알림 규칙 추가',
        subtitle: '알림 페이지로 이동',
        keywords: 'alert rule new create',
        onSelect: go('/alerts'),
      },
      {
        id: 'action:retention',
        kind: 'action',
        title: '데이터 보존 정책 변경',
        subtitle: '설정 페이지로 이동',
        keywords: 'retention settings policy data',
        onSelect: go('/settings'),
      },
      {
        id: 'action:topology',
        kind: 'action',
        title: '서비스 토폴로지 맵 보기',
        keywords: 'topology service map graph',
        onSelect: go('/topology'),
      },
    ];

    return [...pageItems, ...serviceItems, ...instanceItems, ...actionItems];
  }, [services, instances, navigate, onClose]);

  // 쿼리 기반 필터링 + 최근 항목 상위 배치
  const filtered = useMemo(() => {
    const hit = items.filter(it => matches(it, query));
    if (query) return hit;

    const recent = loadRecent();
    const recentSet = new Set(recent);
    const recentItems = recent
      .map(id => items.find(it => it.id === id))
      .filter((x): x is PaletteItem => !!x)
      .map(it => ({ ...it, kind: 'recent' as const }));
    const rest = hit.filter(it => !recentSet.has(it.id));
    return [...recentItems, ...rest];
  }, [items, query]);

  // 키보드 네비게이션
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx(i => Math.min(filtered.length - 1, i + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const it = filtered[selectedIdx];
        if (it) { pushRecent(it.id); it.onSelect(); }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, filtered, selectedIdx, onClose]);

  // 쿼리 변경 시 선택 인덱스 리셋
  useEffect(() => { setSelectedIdx(0); }, [query]);

  // 선택 항목 자동 스크롤
  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${selectedIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIdx]);

  if (!open) return null;

  return (
    <div
      onMouseDown={onClose}
      role="presentation"
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(10, 12, 20, 0.72)',
        backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: '12vh',
        animation: 'page-enter 0.12s ease-out',
      }}
    >
      <div
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="통합 검색 팔레트"
        style={{
          width: 'min(640px, 92vw)',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(99, 102, 241, 0.15)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          maxHeight: '68vh',
        }}
      >
        {/* 입력 영역 */}
        <div style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            aria-hidden="true"
            style={{ opacity: 0.5, flexShrink: 0 }}>
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="페이지, 서비스, 인스턴스, 작업 검색…"
            aria-label="검색어 입력"
            style={{
              flex: 1, border: 'none', outline: 'none', background: 'transparent',
              color: 'var(--text-primary)', fontSize: 15, fontFamily: 'inherit',
            }}
          />
          <kbd style={{
            background: '#252840', border: '1px solid var(--border)',
            borderRadius: 4, padding: '2px 6px', fontSize: 10, color: 'var(--text-muted)',
            fontFamily: 'inherit',
          }}>ESC</kbd>
        </div>

        {/* 결과 영역 */}
        <div
          ref={listRef}
          style={{ overflowY: 'auto', padding: '6px 0' }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              일치하는 항목이 없습니다.
            </div>
          ) : (
            filtered.map((it, idx) => (
              <div
                key={it.id}
                data-idx={idx}
                onMouseEnter={() => setSelectedIdx(idx)}
                onClick={() => { pushRecent(it.id); it.onSelect(); }}
                style={{
                  padding: '10px 16px',
                  display: 'flex', alignItems: 'center', gap: 12,
                  cursor: 'pointer',
                  background: idx === selectedIdx ? 'rgba(99, 102, 241, 0.12)' : 'transparent',
                  borderLeft: idx === selectedIdx ? '2px solid #6366f1' : '2px solid transparent',
                }}
              >
                <KindBadge kind={it.kind} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--text-primary)', fontSize: 13, fontWeight: 500,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.title}
                  </div>
                  {it.subtitle && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 2,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {it.subtitle}
                    </div>
                  )}
                </div>
                {idx === selectedIdx && (
                  <kbd style={{
                    background: '#252840', border: '1px solid var(--border)',
                    borderRadius: 4, padding: '2px 6px', fontSize: 10, color: 'var(--text-muted)',
                    fontFamily: 'inherit',
                  }}>↵</kbd>
                )}
              </div>
            ))
          )}
        </div>

        {/* 하단 힌트 */}
        <div style={{
          borderTop: '1px solid var(--border)',
          padding: '8px 16px',
          display: 'flex', alignItems: 'center', gap: 14,
          fontSize: 11, color: 'var(--text-muted)',
        }}>
          <span><kbd style={kbdStyle}>↑</kbd><kbd style={kbdStyle}>↓</kbd> 이동</span>
          <span><kbd style={kbdStyle}>↵</kbd> 선택</span>
          <span><kbd style={kbdStyle}>ESC</kbd> 닫기</span>
          <span style={{ marginLeft: 'auto' }}>{filtered.length}개 결과</span>
        </div>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  background: '#252840', border: '1px solid var(--border)',
  borderRadius: 3, padding: '1px 5px', marginRight: 3,
  fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'inherit',
};

function KindBadge({ kind }: { kind: ItemKind }) {
  const map: Record<ItemKind, { label: string; color: string }> = {
    page:     { label: '페이지',  color: '#6366f1' },
    service:  { label: '서비스',  color: '#10b981' },
    instance: { label: '인스턴스', color: '#f59e0b' },
    action:   { label: '액션',    color: '#ec4899' },
    recent:   { label: '최근',    color: '#64748b' },
  };
  const m = map[kind];
  return (
    <span style={{
      background: `${m.color}22`, color: m.color,
      border: `1px solid ${m.color}44`,
      borderRadius: 4, padding: '2px 7px',
      fontSize: 10, fontWeight: 600,
      minWidth: 54, textAlign: 'center', flexShrink: 0,
    }}>
      {m.label}
    </span>
  );
}
