import React from 'react';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  /** 페이지 하단 필터/컨트롤 바 */
  controls?: React.ReactNode;
}

/**
 * 모든 페이지 공통 헤더 컴포넌트
 * - title: 페이지 제목
 * - subtitle: 부제목 (선택)
 * - actions: 우측 버튼/뱃지 영역 (선택)
 * - controls: 제목 하단 필터 바 (선택)
 */
export default function PageHeader({ title, subtitle, actions, controls }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="page-header-top">
        <div className="page-header-text">
          <h1 className="page-title" style={{ marginBottom: subtitle ? 4 : 0 }}>{title}</h1>
          {subtitle && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 0 }}>{subtitle}</p>
          )}
        </div>
        {actions && (
          <div className="page-header-actions">{actions}</div>
        )}
      </div>
      {controls && (
        <div className="page-header-controls">{controls}</div>
      )}
    </div>
  );
}
