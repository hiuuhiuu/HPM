import React, { useEffect, useRef, useState } from 'react';

export default function SearchableSelect({
  value, onChange, options, placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const filtered = options.filter(o => o.toLowerCase().includes(query.toLowerCase()));

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(v => !v); setQuery(''); }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={placeholder}
        style={{
          background: '#252840', border: '1px solid #2d3148',
          color: value ? '#e2e8f0' : '#64748b', borderRadius: 6,
          padding: '6px 28px 6px 12px', fontSize: 13, cursor: 'pointer',
          textAlign: 'left', minWidth: 160, position: 'relative',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          maxWidth: 220,
        }}
      >
        {value || placeholder}
        <span aria-hidden="true" style={{
          position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
          color: '#64748b', fontSize: 10, pointerEvents: 'none',
        }}>▼</span>
      </button>
      {open && (
        <div role="listbox" style={{
          position: 'absolute', top: '100%', left: 0, marginTop: 4,
          background: '#1a1c2e', border: '1px solid #2d3148', borderRadius: 8,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 200, minWidth: 220,
        }}>
          <div style={{ padding: 8, borderBottom: '1px solid #1e2035' }}>
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="검색..."
              aria-label="옵션 검색"
              style={{
                width: '100%', background: '#252840', border: '1px solid #2d3148',
                color: '#e2e8f0', borderRadius: 5, padding: '5px 9px', fontSize: 12,
                outline: 'none', boxSizing: 'border-box',
              }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            <div
              role="option"
              aria-selected={!value}
              onClick={() => { onChange(''); setOpen(false); setQuery(''); }}
              style={{
                padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                color: !value ? '#a5b4fc' : '#94a3b8',
                background: !value ? '#1e1b4b' : 'transparent',
              }}
              onMouseEnter={e => { if (value) (e.currentTarget as HTMLDivElement).style.background = '#252840'; }}
              onMouseLeave={e => { if (value) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
            >
              {placeholder}
            </div>
            {filtered.map(o => (
              <div
                key={o}
                role="option"
                aria-selected={value === o}
                onClick={() => { onChange(o); setOpen(false); setQuery(''); }}
                style={{
                  padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                  color: value === o ? '#a5b4fc' : '#e2e8f0',
                  background: value === o ? '#1e1b4b' : 'transparent',
                }}
                onMouseEnter={e => { if (value !== o) (e.currentTarget as HTMLDivElement).style.background = '#252840'; }}
                onMouseLeave={e => { if (value !== o) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
              >
                {o}
              </div>
            ))}
            {filtered.length === 0 && (
              <div style={{ padding: '8px 12px', color: '#475569', fontSize: 12 }}>결과 없음</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
