import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiPut, apiDelete } from '../hooks/useApi';
import './Settings.css';

// ── 타입 ────────────────────────────────────────────────

interface SystemSettings {
  retention_traces_days: string;
  retention_metrics_days: string;
  retention_logs_days: string;
  [key: string]: string;
}

interface InstanceInfo {
  service: string;
  instance: string;
  last_seen: string | null;
  is_alive: boolean;
}

// ── 메인 컴포넌트 ────────────────────────────────────────

const Settings: React.FC = () => {
  const [settings, setSettings] = useState<SystemSettings>({
    retention_traces_days: '14',
    retention_metrics_days: '30',
    retention_logs_days: '30',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const data = await apiFetch<SystemSettings>('/api/settings');
      if (data) setSettings(prev => ({ ...prev, ...data }));
    } catch {
      setMessage({ type: 'error', text: '설정을 불러오는데 실패했습니다.' });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSaving(true);
      setMessage(null);
      await apiPut('/api/settings', { settings });
      setMessage({ type: 'success', text: '설정이 성공적으로 저장되었습니다. (보존 정책 갱신 완료)' });
    } catch {
      setMessage({ type: 'error', text: '설정 저장 과정에서 오류가 발생했습니다.' });
    } finally {
      setSaving(false);
    }
  };

  const handleChange = (key: keyof SystemSettings, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  if (loading) return <div className="settings-page loading">설정 불러오는 중...</div>;

  return (
    <div className="settings-page">
      <header className="page-header">
        <h1 className="page-title">시스템 설정 (관리자 전용)</h1>
        <p className="page-subtitle">데이터 보존 정책 및 서비스/인스턴스를 관리합니다.</p>
      </header>

      {message && (
        <div className={`message-banner ${message.type}`}>
          {message.text}
        </div>
      )}

      <div className="settings-content">
        {/* ── 대시보드 기본 뷰 ── */}
        <DashboardViewSettings />

        {/* ── 트레이스 뷰 ── */}
        <TraceViewSettings />

        {/* ── 데이터 보존 정책 ── */}
        <section className="settings-section">
          <h2>데이터 보존 (Retention) 주기 설정</h2>
          <p className="section-desc">
            과거 수집된 텔레메트리 데이터를 자동으로 삭제하여 스토리지를 최적화하는 기준일입니다.
          </p>

          <form onSubmit={handleSave} className="settings-form">
            <div className="form-group">
              <label>트레이스(Traces) 보존 기간 (일)</label>
              <input
                type="number" min="1" max="365"
                value={settings.retention_traces_days}
                onChange={e => handleChange('retention_traces_days', e.target.value)}
                required
              />
              <span className="help-text">가장 많은 공간을 차지하므로 7~14일을 권장합니다.</span>
            </div>

            <div className="form-group">
              <label>메트릭(Metrics) 보존 기간 (일)</label>
              <input
                type="number" min="1" max="365"
                value={settings.retention_metrics_days}
                onChange={e => handleChange('retention_metrics_days', e.target.value)}
                required
              />
              <span className="help-text">장기 추이 분석을 위해 30일 이상을 권장합니다.</span>
            </div>

            <div className="form-group">
              <label>로그(Logs) 보존 기간 (일)</label>
              <input
                type="number" min="1" max="365"
                value={settings.retention_logs_days}
                onChange={e => handleChange('retention_logs_days', e.target.value)}
                required
              />
              <span className="help-text">에러 분석을 위해 30일 정도를 권장합니다.</span>
            </div>

            <div className="form-actions">
              <button type="submit" className="save-button" disabled={saving}>
                {saving ? '저장 중...' : '저장 및 정책 반영'}
              </button>
            </div>
          </form>
        </section>

        {/* ── 서비스/인스턴스 관리 ── */}
        <InstanceManager onGlobalMessage={setMessage} />

        {/* ── 보안 안내 ── */}
        <section className="settings-section info-only">
          <h2>보안 및 권한 관리에 대하여</h2>
          <p className="section-desc">
            현재 개발 모드에서는 모든 사용자가 이 페이지에 접근할 수 있습니다.<br />
            추후 <strong>RBAC 기반 계정 및 권한 관리 기능</strong> 구현 시, 관리자(Admin) 권한을 가진 계정만 접근 가능하도록 변경될 예정입니다.
          </p>
        </section>
      </div>
    </div>
  );
};

export default Settings;

// ── 대시보드 기본 뷰 설정 ────────────────────────────────

function DashboardViewSettings() {
  const [defaultLevel, setDefaultLevel] = useState<'service' | 'instance'>(
    () => (localStorage.getItem('dashboard_default_level') as 'service' | 'instance') || 'instance'
  );
  const [saved, setSaved] = useState(false);

  const handleChange = (level: 'service' | 'instance') => {
    setDefaultLevel(level);
    localStorage.setItem('dashboard_default_level', level);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <section className="settings-section">
      <h2>대시보드 기본 뷰</h2>
      <p className="section-desc">
        대시보드 접근 시 기본으로 표시할 모니터링 단위를 설정합니다.<br />
        인스턴스 단위 모니터링은 지연 발생 트랜잭션을 빠르게 식별하는 데 유리합니다.
      </p>
      <div style={{ display: 'flex', gap: 12, marginTop: 12 }}>
        {(['instance', 'service'] as const).map(lv => (
          <label
            key={lv}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer',
              padding: '10px 16px', borderRadius: 8, border: '1px solid',
              borderColor: defaultLevel === lv ? '#6366f1' : '#2d3148',
              background: defaultLevel === lv ? '#1e1b4b' : '#161827',
              color: defaultLevel === lv ? '#a5b4fc' : '#94a3b8',
              fontSize: 13, fontWeight: defaultLevel === lv ? 600 : 400,
              transition: 'all 0.15s',
            }}
          >
            <input
              type="radio"
              name="dashboard_default_level"
              value={lv}
              checked={defaultLevel === lv}
              onChange={() => handleChange(lv)}
              style={{ accentColor: '#6366f1' }}
            />
            {lv === 'instance' ? '인스턴스 단위 (권장)' : '서비스 단위'}
          </label>
        ))}
        {saved && (
          <span style={{ fontSize: 12, color: '#4ade80', alignSelf: 'center' }}>저장됨 ✓</span>
        )}
      </div>
    </section>
  );
}

// ── 트레이스 뷰 설정 ────────────────────────────────────

function TraceViewSettings() {
  const [minSpanMs, setMinSpanMs] = useState(() =>
    Number(localStorage.getItem('trace_min_span_ms') || '0')
  );
  const [saved, setSaved] = useState(false);

  const handleChange = (val: number) => {
    const v = Math.max(0, val);
    setMinSpanMs(v);
    localStorage.setItem('trace_min_span_ms', String(v));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <section className="settings-section">
      <h2>트레이스 콜 트리 뷰 설정</h2>
      <p className="section-desc">
        트레이싱 상세 페이지의 콜 트리/워터폴에서 매우 짧은 스팬을 숨겨 노이즈를 줄입니다.<br />
        ERROR 스팬은 설정값에 관계없이 항상 표시됩니다.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <label style={{ fontSize: 13, color: '#94a3b8' }}>
          콜 트리 최소 스팬 표시 시간
        </label>
        <input
          type="number"
          min={0}
          step={1}
          value={minSpanMs}
          onChange={e => handleChange(Number(e.target.value))}
          style={{
            width: 80, background: '#161827', border: '1px solid #2d3148',
            color: '#e2e8f0', borderRadius: 6, padding: '6px 10px', fontSize: 13,
            outline: 'none',
          }}
        />
        <span style={{ fontSize: 13, color: '#64748b' }}>ms &nbsp;(0 = 모두 표시)</span>
        {saved && <span style={{ fontSize: 12, color: '#4ade80' }}>저장됨 ✓</span>}
      </div>
      <p style={{ fontSize: 12, color: '#475569', marginTop: 8 }}>
        예: 5 입력 시 5ms 미만인 내부 메서드 스팬이 콜 트리에서 숨겨집니다. 트레이스 뷰를 열 때 이 값이 자동 적용됩니다.
      </p>
    </section>
  );
}

// ── 서비스/인스턴스 관리 컴포넌트 ────────────────────────

function InstanceManager({
  onGlobalMessage,
}: {
  onGlobalMessage: (msg: { type: 'success' | 'error'; text: string } | null) => void;
}) {
  const [instances, setInstances] = useState<InstanceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null); // "service" | "service/instance"
  const [confirmTarget, setConfirmTarget] = useState<{
    type: 'instance' | 'service';
    service: string;
    instance?: string;
  } | null>(null);
  const [filterDown, setFilterDown] = useState(false);

  const fetchInstances = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch<InstanceInfo[]>('/api/instances');
      setInstances(data ?? []);
    } catch {
      onGlobalMessage({ type: 'error', text: '인스턴스 목록을 불러오는데 실패했습니다.' });
    } finally {
      setLoading(false);
    }
  }, [onGlobalMessage]);

  useEffect(() => { fetchInstances(); }, [fetchInstances]);

  const handleDeleteInstance = async (service: string, instance: string) => {
    const key = `${service}/${instance}`;
    setDeleting(key);
    try {
      await apiDelete(`/api/instances/${encodeURIComponent(service)}/${encodeURIComponent(instance)}`);
      onGlobalMessage({ type: 'success', text: `인스턴스 [${instance}] 데이터가 삭제되었습니다.` });
      await fetchInstances();
    } catch {
      onGlobalMessage({ type: 'error', text: `인스턴스 [${instance}] 삭제 중 오류가 발생했습니다.` });
    } finally {
      setDeleting(null);
      setConfirmTarget(null);
    }
  };

  const handleDeleteService = async (service: string) => {
    setDeleting(service);
    try {
      await apiDelete(`/api/services/${encodeURIComponent(service)}`);
      onGlobalMessage({ type: 'success', text: `서비스 [${service}] 및 모든 데이터가 삭제되었습니다.` });
      await fetchInstances();
    } catch {
      onGlobalMessage({ type: 'error', text: `서비스 [${service}] 삭제 중 오류가 발생했습니다.` });
    } finally {
      setDeleting(null);
      setConfirmTarget(null);
    }
  };

  const displayed = filterDown ? instances.filter(i => !i.is_alive) : instances;

  // 서비스별 그룹화
  const byService = displayed.reduce<Record<string, InstanceInfo[]>>((acc, inst) => {
    (acc[inst.service] ??= []).push(inst);
    return acc;
  }, {});

  const formatLastSeen = (ts: string | null) => {
    if (!ts) return '—';
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60)   return `${diff}초 전`;
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    return `${Math.floor(diff / 86400)}일 전`;
  };

  return (
    <section className="settings-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>서비스 / 인스턴스 관리</h2>
          <p className="section-desc" style={{ margin: 0 }}>
            더 이상 사용하지 않는 인스턴스나 서비스를 삭제합니다.
            인스턴스 삭제 시 해당 인스턴스의 metrics·traces·logs 데이터가 제거됩니다.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <label style={{ fontSize: 13, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={filterDown}
              onChange={e => setFilterDown(e.target.checked)}
            />
            Down만 보기
          </label>
          <button
            onClick={fetchInstances}
            style={{ ...btnStyle, background: '#252840', color: '#94a3b8' }}
          >
            새로 고침
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ color: '#64748b', fontSize: 13, padding: '16px 0' }}>로딩 중...</div>
      ) : Object.keys(byService).length === 0 ? (
        <div style={{ color: '#64748b', fontSize: 13, padding: '16px 0' }}>
          {filterDown ? 'Down 상태인 인스턴스가 없습니다.' : '수집된 인스턴스가 없습니다.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Object.entries(byService).map(([svc, insts]) => (
            <div key={svc} style={cardStyle}>
              {/* 서비스 헤더 */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 14, color: '#f1f5f9' }}>{svc}</span>
                <button
                  onClick={() => setConfirmTarget({ type: 'service', service: svc })}
                  disabled={deleting === svc}
                  style={{ ...btnStyle, background: '#3f1515', color: '#f87171', fontSize: 12 }}
                >
                  서비스 전체 삭제
                </button>
              </div>

              {/* 인스턴스 목록 */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: '#64748b', fontSize: 11 }}>
                    <th style={thStyle}>인스턴스</th>
                    <th style={thStyle}>상태</th>
                    <th style={thStyle}>마지막 수신</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {insts.map(inst => {
                    const key = `${inst.service}/${inst.instance}`;
                    return (
                      <tr key={inst.instance} style={{ borderTop: '1px solid #2d3148' }}>
                        <td style={tdStyle}>{inst.instance}</td>
                        <td style={tdStyle}>
                          <span style={{
                            display: 'inline-block',
                            padding: '2px 8px',
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 600,
                            background: inst.is_alive ? '#14532d' : '#3f1515',
                            color:      inst.is_alive ? '#4ade80'  : '#f87171',
                          }}>
                            {inst.is_alive ? 'Active' : 'Down'}
                          </span>
                        </td>
                        <td style={{ ...tdStyle, color: inst.is_alive ? '#94a3b8' : '#f87171' }}>
                          {formatLastSeen(inst.last_seen)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                          <button
                            onClick={() => setConfirmTarget({ type: 'instance', service: inst.service, instance: inst.instance })}
                            disabled={deleting === key}
                            style={{ ...btnStyle, background: '#252840', color: '#f87171', fontSize: 12 }}
                          >
                            {deleting === key ? '삭제 중...' : '삭제'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {/* 삭제 확인 다이얼로그 */}
      {confirmTarget && (
        <ConfirmDialog
          title={confirmTarget.type === 'service'
            ? `서비스 [${confirmTarget.service}] 전체 삭제`
            : `인스턴스 [${confirmTarget.instance}] 삭제`}
          description={confirmTarget.type === 'service'
            ? `서비스 [${confirmTarget.service}]의 모든 metrics, traces, logs, errors 데이터와 서비스 레지스트리가 영구 삭제됩니다. 되돌릴 수 없습니다.`
            : `인스턴스 [${confirmTarget.instance}]의 모든 metrics, traces, logs 데이터가 영구 삭제됩니다. 되돌릴 수 없습니다.`}
          onConfirm={() => {
            if (confirmTarget.type === 'service') {
              handleDeleteService(confirmTarget.service);
            } else if (confirmTarget.instance) {
              handleDeleteInstance(confirmTarget.service, confirmTarget.instance);
            }
          }}
          onCancel={() => setConfirmTarget(null)}
        />
      )}
    </section>
  );
}

// ── 확인 다이얼로그 ──────────────────────────────────────

function ConfirmDialog({
  title, description, onConfirm, onCancel,
}: {
  title: string;
  description: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000,
    }}>
      <div style={{
        background: '#1e2035',
        border: '1px solid #2d3148',
        borderRadius: 10,
        padding: 24,
        maxWidth: 420, width: '90%',
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: '#f87171', marginBottom: 10 }}>
          ⚠️ {title}
        </div>
        <p style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, marginBottom: 20 }}>
          {description}
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ ...btnStyle, background: '#252840', color: '#94a3b8' }}>
            취소
          </button>
          <button onClick={onConfirm} style={{ ...btnStyle, background: '#7f1d1d', color: '#fca5a5' }}>
            영구 삭제
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 스타일 상수 ─────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: '#161827',
  border: '1px solid #2d3148',
  borderRadius: 8,
  padding: 16,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '4px 8px',
  fontWeight: 500,
};

const tdStyle: React.CSSProperties = {
  padding: '8px 8px',
  color: '#e2e8f0',
};

const btnStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 6,
  padding: '5px 12px',
  fontSize: 13,
  cursor: 'pointer',
  transition: 'all 0.15s',
};
