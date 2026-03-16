import React, { useState, useCallback } from 'react';
import { usePolling, apiFetch, apiPost, apiPut, apiPatch, apiDelete } from '../hooks/useApi';
import {
  Service, AlertRule, AlertRuleBody, AlertEvent,
  AlertEventList, AlertCondition, AlertSeverity,
} from '../types';
import { format, parseISO, formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

type Tab = 'rules' | 'history';

// 메트릭 프리셋 (이름, 레이블, 단위 힌트)
const METRIC_PRESETS = [
  { value: 'jvm.cpu.usage',                 label: 'CPU 사용률',         hint: '0~1 범위 (예: 0.8 = 80%)' },
  { value: 'jvm.memory.used',               label: '힙 메모리 사용량',   hint: 'bytes (예: 524288000 = 500MB)' },
  { value: 'jvm.threads.count',             label: '스레드 수',           hint: '개 (예: 200)' },
  { value: 'http.server.request.duration',  label: 'HTTP 평균 응답시간',  hint: '초 (예: 1.0 = 1초)' },
  { value: 'jvm.gc.duration',               label: 'GC 소요시간',         hint: '초 (예: 0.5 = 500ms)' },
];

const CONDITIONS: { value: AlertCondition; label: string }[] = [
  { value: 'gt',  label: '> (초과)' },
  { value: 'gte', label: '≥ (이상)' },
  { value: 'lt',  label: '< (미만)' },
  { value: 'lte', label: '≤ (이하)' },
  { value: 'eq',  label: '= (같음)' },
];
const SEVERITIES: { value: AlertSeverity; label: string; color: string }[] = [
  { value: 'info',     label: 'INFO',     color: '#60a5fa' },
  { value: 'warning',  label: 'WARNING',  color: '#fbbf24' },
  { value: 'critical', label: 'CRITICAL', color: '#f87171' },
];
const COND_LABEL: Record<string, string> = { gt: '>', lt: '<', gte: '≥', lte: '≤', eq: '=' };
const SEV_COLOR: Record<string, string>  = { info: '#60a5fa', warning: '#fbbf24', critical: '#f87171' };
const SEV_BG: Record<string, string>     = { info: '#172554', warning: '#431407', critical: '#450a0a' };

const EMPTY_FORM: AlertRuleBody = {
  name: '', description: '', service: '', metric_name: 'jvm.cpu.usage',
  condition: 'gt', threshold: 0.8, duration_s: 60, severity: 'warning', enabled: true,
};

export default function Alerts() {
  const [tab,         setTab]         = useState<Tab>('rules');
  const [showModal,   setShowModal]   = useState(false);
  const [editTarget,  setEditTarget]  = useState<AlertRule | null>(null);
  const [refreshKey,  setRefreshKey]  = useState(0);
  const [histPage,    setHistPage]    = useState(1);
  const [histStatus,  setHistStatus]  = useState<'all' | 'firing' | 'resolved'>('all');

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  const { data: services }    = usePolling<Service[]>(() => apiFetch('/api/services'), 60_000);
  const { data: rules, loading: rLoading } = usePolling<AlertRule[]>(
    () => apiFetch('/api/alerts/rules'), 30_000, [refreshKey],
  );
  const { data: activeEvents } = usePolling<AlertEvent[]>(
    () => apiFetch('/api/alerts/active'), 30_000, [refreshKey],
  );
  const statusParam = histStatus !== 'all' ? `&status=${histStatus}` : '';
  const { data: history, loading: hLoading } = usePolling<AlertEventList>(
    () => apiFetch(`/api/alerts/events?page=${histPage}&limit=20${statusParam}`),
    30_000, [histPage, histStatus, refreshKey],
  );

  const handleToggle = async (rule: AlertRule) => {
    await apiPatch(`/api/alerts/rules/${rule.id}/toggle`, {});
    refresh();
  };
  const handleDelete = async (rule: AlertRule) => {
    if (!window.confirm(`"${rule.name}" 규칙을 삭제하시겠습니까?`)) return;
    await apiDelete(`/api/alerts/rules/${rule.id}`);
    refresh();
  };
  const handleEdit = (rule: AlertRule) => {
    setEditTarget(rule);
    setShowModal(true);
  };
  const handleNew = () => {
    setEditTarget(null);
    setShowModal(true);
  };
  const handleSave = async (body: AlertRuleBody) => {
    if (editTarget) {
      await apiPut(`/api/alerts/rules/${editTarget.id}`, body);
    } else {
      await apiPost('/api/alerts/rules', body);
    }
    setShowModal(false);
    refresh();
  };

  const totalHistPages = history ? Math.ceil(history.total / 20) : 1;

  return (
    <div>
      {/* 헤더 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>알림</h2>
        <button onClick={handleNew} style={newBtnStyle}>+ 새 규칙</button>
      </div>

      {/* 현재 발화 중인 알림 배너 */}
      {(activeEvents?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 16, padding: '12px 16px', background: '#450a0a', border: '1px solid #ef4444', borderRadius: 8 }}>
          <div style={{ fontWeight: 600, color: '#fca5a5', marginBottom: 8 }}>
            🔴 발화 중인 알림 {activeEvents!.length}건
          </div>
          {activeEvents!.map(e => (
            <div key={e.id} style={{ fontSize: 13, color: '#fda4af', marginBottom: 4 }}>
              [{e.severity.toUpperCase()}] {e.message}
              <span style={{ color: '#64748b', marginLeft: 8 }}>
                {formatDistanceToNow(parseISO(e.fired_at), { addSuffix: true, locale: ko })}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 탭 */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
        {([['rules', '규칙 관리'], ['history', '알림 이력']] as [Tab, string][]).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ ...btnStyle, background: tab === key ? '#6366f1' : '#252840', color: tab === key ? '#fff' : '#94a3b8' }}>
            {label}
            {key === 'history' && (history?.total ?? 0) > 0 && (
              <span style={{ marginLeft: 6, background: '#4f46e5', borderRadius: 10, padding: '1px 6px', fontSize: 11 }}>
                {history!.total}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── 규칙 탭 ── */}
      {tab === 'rules' && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#1e2035', borderBottom: '1px solid #2d3148', color: '#64748b' }}>
                <th style={thS}>상태</th>
                <th style={thS}>규칙 이름</th>
                <th style={thS}>조건</th>
                <th style={thS}>서비스</th>
                <th style={thS}>중요도</th>
                <th style={thS}>주기</th>
                <th style={thS}></th>
              </tr>
            </thead>
            <tbody>
              {rLoading && <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>로딩 중...</td></tr>}
              {!rLoading && !rules?.length && (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>
                  알림 규칙이 없습니다. "새 규칙" 버튼으로 추가하세요.
                </td></tr>
              )}
              {rules?.map(rule => (
                <tr key={rule.id} style={{ borderBottom: '1px solid #1e2035' }}>
                  <td style={tdS}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={() => handleToggle(rule)}
                        style={{
                          width: 36, height: 20, borderRadius: 10, border: 'none',
                          background: rule.enabled ? '#4f46e5' : '#374151', cursor: 'pointer',
                          position: 'relative', transition: 'background 0.2s',
                        }}
                      >
                        <span style={{
                          position: 'absolute', top: 2,
                          left: rule.enabled ? 18 : 2,
                          width: 16, height: 16, borderRadius: '50%',
                          background: '#fff', transition: 'left 0.2s',
                        }} />
                      </button>
                      {rule.active_events > 0 && (
                        <span style={{ color: '#f87171', fontSize: 11, fontWeight: 700 }}>FIRING</span>
                      )}
                    </div>
                  </td>
                  <td style={tdS}>
                    <div style={{ color: '#f1f5f9', fontWeight: 500 }}>{rule.name}</div>
                    {rule.description && <div style={{ color: '#475569', fontSize: 12 }}>{rule.description}</div>}
                  </td>
                  <td style={{ ...tdS, fontFamily: 'monospace', fontSize: 12, color: '#e2e8f0' }}>
                    {rule.metric_name}<br />
                    <span style={{ color: '#94a3b8' }}>
                      {COND_LABEL[rule.condition]} {rule.threshold}
                    </span>
                  </td>
                  <td style={{ ...tdS, color: '#94a3b8' }}>{rule.service || '전체'}</td>
                  <td style={tdS}>
                    <span style={{
                      padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600,
                      background: SEV_BG[rule.severity], color: SEV_COLOR[rule.severity],
                    }}>
                      {rule.severity.toUpperCase()}
                    </span>
                  </td>
                  <td style={{ ...tdS, color: '#64748b' }}>{rule.duration_s}초</td>
                  <td style={{ ...tdS, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button onClick={() => handleEdit(rule)} style={smallBtn}>편집</button>
                    <button onClick={() => handleDelete(rule)}
                      style={{ ...smallBtn, color: '#f87171', borderColor: '#450a0a' }}>삭제</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 이력 탭 ── */}
      {tab === 'history' && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {(['all', 'firing', 'resolved'] as const).map(s => (
              <button key={s} onClick={() => { setHistStatus(s); setHistPage(1); }}
                style={{ ...btnStyle, background: histStatus === s ? '#6366f1' : '#252840', color: histStatus === s ? '#fff' : '#94a3b8' }}>
                {s === 'all' ? '전체' : s === 'firing' ? '발화 중' : '해결됨'}
              </button>
            ))}
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#1e2035', borderBottom: '1px solid #2d3148', color: '#64748b' }}>
                  <th style={thS}>규칙</th>
                  <th style={thS}>중요도</th>
                  <th style={thS}>값</th>
                  <th style={thS}>발화 시각</th>
                  <th style={thS}>해결 시각</th>
                  <th style={thS}>상태</th>
                </tr>
              </thead>
              <tbody>
                {hLoading && <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>로딩 중...</td></tr>}
                {!hLoading && !history?.items.length && (
                  <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#64748b' }}>알림 이력이 없습니다.</td></tr>
                )}
                {history?.items.map(ev => (
                  <tr key={ev.id} style={{ borderBottom: '1px solid #1e2035' }}>
                    <td style={tdS}>
                      <div style={{ color: '#f1f5f9' }}>{ev.rule_name}</div>
                      <div style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>
                        {ev.metric_name} {COND_LABEL[ev.condition]} {ev.threshold}
                      </div>
                    </td>
                    <td style={tdS}>
                      <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 600, background: SEV_BG[ev.severity], color: SEV_COLOR[ev.severity] }}>
                        {ev.severity.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ ...tdS, fontFamily: 'monospace', color: '#fca5a5' }}>
                      {ev.value != null ? ev.value.toFixed(4) : '—'}
                    </td>
                    <td style={{ ...tdS, color: '#94a3b8', fontSize: 12 }}>
                      {ev.fired_at ? format(parseISO(ev.fired_at), 'MM-dd HH:mm:ss') : '—'}
                    </td>
                    <td style={{ ...tdS, color: '#64748b', fontSize: 12 }}>
                      {ev.resolved_at ? format(parseISO(ev.resolved_at), 'MM-dd HH:mm:ss') : '—'}
                    </td>
                    <td style={tdS}>
                      <span className={`badge ${ev.status === 'firing' ? 'badge-error' : 'badge-ok'}`}>
                        {ev.status === 'firing' ? '발화 중' : '해결됨'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalHistPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 16 }}>
              <button onClick={() => setHistPage(p => Math.max(1, p - 1))} disabled={histPage === 1} style={pageBtn}>← 이전</button>
              <span style={{ color: '#94a3b8', fontSize: 13 }}>{histPage} / {totalHistPages}</span>
              <button onClick={() => setHistPage(p => Math.min(totalHistPages, p + 1))} disabled={histPage === totalHistPages} style={pageBtn}>다음 →</button>
            </div>
          )}
        </>
      )}

      {/* 규칙 생성/수정 모달 */}
      {showModal && (
        <RuleModal
          initial={editTarget}
          services={services?.map(s => s.name) ?? []}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

// ── 규칙 폼 모달 ───────────────────────────────────────

function RuleModal({
  initial, services, onSave, onClose,
}: {
  initial: AlertRule | null;
  services: string[];
  onSave: (body: AlertRuleBody) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<AlertRuleBody>(
    initial ? {
      name: initial.name, description: initial.description ?? '',
      service: initial.service ?? '', metric_name: initial.metric_name,
      condition: initial.condition, threshold: initial.threshold,
      duration_s: initial.duration_s, severity: initial.severity,
      enabled: initial.enabled,
    } : EMPTY_FORM,
  );
  const [saving,   setSaving]   = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const set = (key: keyof AlertRuleBody, val: unknown) =>
    setForm(f => ({ ...f, [key]: val }));

  const preset = METRIC_PRESETS.find(p => p.value === form.metric_name);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    try {
      await onSave({ ...form, service: form.service || undefined });
    } catch (err: any) {
      setSaveError(err?.message ?? '저장 중 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        background: '#1a1d27', border: '1px solid #2d3148', borderRadius: 12,
        padding: 28, width: 520, maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 style={{ color: '#f1f5f9', fontSize: 16 }}>
            {initial ? '알림 규칙 수정' : '새 알림 규칙'}
          </h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#64748b', fontSize: 20, cursor: 'pointer' }}>×</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="규칙 이름 *">
              <input value={form.name} onChange={e => set('name', e.target.value)}
                required style={inputStyle} placeholder="예: CPU 사용률 임계값" />
            </Field>

            <Field label="설명">
              <input value={form.description ?? ''} onChange={e => set('description', e.target.value)}
                style={inputStyle} placeholder="선택 입력" />
            </Field>

            <Field label="서비스">
              <select value={form.service ?? ''} onChange={e => set('service', e.target.value)} style={inputStyle}>
                <option value="">전체 서비스</option>
                {services.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>

            <Field label="메트릭 *">
              <select value={form.metric_name} onChange={e => set('metric_name', e.target.value)} style={inputStyle}>
                {METRIC_PRESETS.map(p => (
                  <option key={p.value} value={p.value}>{p.label} ({p.value})</option>
                ))}
              </select>
              {preset && (
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>단위: {preset.hint}</div>
              )}
            </Field>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="조건 *">
                <select value={form.condition} onChange={e => set('condition', e.target.value as AlertCondition)} style={inputStyle}>
                  {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              <Field label="임계값 *">
                <input type="number" step="any" value={form.threshold}
                  onChange={e => set('threshold', parseFloat(e.target.value))}
                  required style={inputStyle} />
              </Field>
            </div>

            <Field label="평가 기간 (초)">
              <input type="number" value={form.duration_s}
                onChange={e => set('duration_s', parseInt(e.target.value))}
                min={10} max={3600} style={inputStyle} />
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                {[60, 300, 900].map(s => (
                  <button key={s} type="button" onClick={() => set('duration_s', s)}
                    style={{ ...smallBtn, background: form.duration_s === s ? '#4f46e5' : '#252840' }}>
                    {s < 60 ? `${s}초` : `${s/60}분`}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="중요도">
              <div style={{ display: 'flex', gap: 8 }}>
                {SEVERITIES.map(s => (
                  <button key={s.value} type="button"
                    onClick={() => set('severity', s.value)}
                    style={{
                      ...smallBtn, flex: 1,
                      background: form.severity === s.value ? SEV_BG[s.value] : '#252840',
                      color:      form.severity === s.value ? SEV_COLOR[s.value] : '#94a3b8',
                      border: `1px solid ${form.severity === s.value ? SEV_COLOR[s.value] : '#2d3148'}`,
                    }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {saveError && (
            <div style={{ marginTop: 16, padding: '8px 12px', background: '#450a0a', border: '1px solid #ef4444', borderRadius: 6, color: '#fca5a5', fontSize: 13 }}>
              {saveError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="button" onClick={onClose} style={{ ...smallBtn, padding: '8px 20px' }}>취소</button>
            <button type="submit" disabled={saving}
              style={{ ...smallBtn, padding: '8px 20px', background: '#4f46e5', color: '#fff', border: 'none' }}>
              {saving ? '저장 중...' : (initial ? '수정' : '생성')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: '#252840', border: '1px solid #2d3148',
  color: '#e2e8f0', borderRadius: 6, padding: '8px 12px', fontSize: 13,
};
const newBtnStyle: React.CSSProperties = {
  background: '#4f46e5', color: '#fff', border: 'none',
  borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer',
};
const btnStyle: React.CSSProperties = {
  border: 'none', borderRadius: 6, padding: '7px 16px',
  fontSize: 13, cursor: 'pointer', transition: 'all 0.15s',
};
const smallBtn: React.CSSProperties = {
  background: '#252840', border: '1px solid #2d3148',
  color: '#94a3b8', borderRadius: 5, padding: '4px 10px',
  fontSize: 12, cursor: 'pointer',
};
const thS: React.CSSProperties = { padding: '10px 14px', textAlign: 'left', fontWeight: 500, fontSize: 12 };
const tdS: React.CSSProperties = { padding: '10px 14px' };
const pageBtn: React.CSSProperties = {
  background: '#252840', border: '1px solid #2d3148', color: '#94a3b8',
  borderRadius: 6, padding: '6px 16px', cursor: 'pointer', fontSize: 13,
};
