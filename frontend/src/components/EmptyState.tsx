import React from 'react';

type EmptyStateVariant = 'data' | 'search' | 'error' | 'loading';

interface EmptyStateProps {
  variant?: EmptyStateVariant;
  title?: string;
  message?: string;
  action?: React.ReactNode;
}

const ICONS: Record<EmptyStateVariant, React.ReactNode> = {
  data: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect x="8" y="14" width="32" height="24" rx="4" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.3"/>
      <rect x="14" y="20" width="20" height="2" rx="1" fill="currentColor" opacity="0.4"/>
      <rect x="14" y="25" width="14" height="2" rx="1" fill="currentColor" opacity="0.3"/>
      <rect x="14" y="30" width="17" height="2" rx="1" fill="currentColor" opacity="0.25"/>
      <circle cx="37" cy="10" r="5" fill="var(--color-primary)" opacity="0.5"/>
      <path d="M35 10h4M37 8v4" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  ),
  search: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <circle cx="21" cy="21" r="12" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.35"/>
      <path d="M30 30l8 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.35"/>
      <path d="M17 21h8M21 17v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.25"/>
    </svg>
  ),
  error: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="16" stroke="var(--color-error)" strokeWidth="2" fill="none" opacity="0.35"/>
      <path d="M24 16v10" stroke="var(--color-error)" strokeWidth="2.5" strokeLinecap="round" opacity="0.5"/>
      <circle cx="24" cy="31" r="1.5" fill="var(--color-error)" opacity="0.5"/>
    </svg>
  ),
  loading: (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ animation: 'spin 1s linear infinite' }}>
      <circle cx="24" cy="24" r="16" stroke="var(--border)" strokeWidth="3" fill="none"/>
      <path d="M24 8a16 16 0 0 1 16 16" stroke="var(--color-primary)" strokeWidth="3" strokeLinecap="round"/>
    </svg>
  ),
};

const DEFAULTS: Record<EmptyStateVariant, { title: string; message: string }> = {
  data:    { title: '데이터 없음',        message: '아직 수집된 데이터가 없습니다.' },
  search:  { title: '검색 결과 없음',     message: '조건에 맞는 항목을 찾을 수 없습니다.' },
  error:   { title: '데이터를 불러올 수 없습니다', message: '잠시 후 다시 시도해주세요.' },
  loading: { title: '불러오는 중...',      message: '' },
};

export default function EmptyState({ variant = 'data', title, message, action }: EmptyStateProps) {
  const defaults = DEFAULTS[variant];
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{ICONS[variant]}</div>
      <div className="empty-state-title">{title ?? defaults.title}</div>
      {(message ?? defaults.message) && (
        <div className="empty-state-message">{message ?? defaults.message}</div>
      )}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
