import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch, apiPut, apiPost, apiDelete, apiPatch } from '../hooks/useApi';
import { useLocalStorage, useLocalStorageString } from '../hooks/useLocalStorage';
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

        {/* ── 배포 마커 관리 ── */}
        <DeploymentsManager onGlobalMessage={setMessage} />

        {/* ── 에이전트 설정 ── */}
        <AgentConfigManager onGlobalMessage={setMessage} />

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
  const [defaultLevel, setDefaultLevel] = useLocalStorageString('dashboard_default_level', 'instance');
  const [saved, setSaved] = useState(false);

  const handleChange = (level: 'service' | 'instance') => {
    setDefaultLevel(level);
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
  const [minSpanMs, setMinSpanMs] = useLocalStorage<number>('trace_min_span_ms', 0);
  const [minTraceDurationMs, setMinTraceDurationMs] = useLocalStorage<number>('trace_min_duration_ms', 0);
  const [saved, setSaved] = useState(false);

  const markSaved = () => { setSaved(true); setTimeout(() => setSaved(false), 1500); };

  const handleSpanChange = (val: number) => {
    setMinSpanMs(Math.max(0, val));
    markSaved();
  };

  const handleDurationChange = (val: number) => {
    setMinTraceDurationMs(Math.max(0, val));
    markSaved();
  };

  const inputStyle: React.CSSProperties = {
    width: 80, background: '#161827', border: '1px solid #2d3148',
    color: '#e2e8f0', borderRadius: 6, padding: '6px 10px', fontSize: 13,
    outline: 'none',
  };

  return (
    <section className="settings-section">
      <h2>트레이스 뷰 설정</h2>
      <p className="section-desc">
        트레이싱 페이지의 표시 노이즈를 줄이기 위한 최소 시간 필터입니다.<br />
        ERROR 트레이스/스팬은 설정값에 관계없이 항상 표시됩니다.
      </p>

      {/* 트랜잭션 분포 최소 시간 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <label style={{ fontSize: 13, color: '#94a3b8', minWidth: 200 }}>
          트랜잭션 분포 최소 표시 시간
        </label>
        <input
          type="number"
          min={0}
          step={1}
          value={minTraceDurationMs}
          onChange={e => handleDurationChange(Number(e.target.value))}
          style={inputStyle}
        />
        <span style={{ fontSize: 13, color: '#64748b' }}>ms &nbsp;(0 = 모두 표시)</span>
      </div>
      <p style={{ fontSize: 12, color: '#475569', marginTop: 6, marginLeft: 212 }}>
        분산 트레이싱 목록·산점도·히스토그램에서 이 값 미만인 트레이스를 숨깁니다.
      </p>

      {/* 콜 트리 최소 스팬 시간 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <label style={{ fontSize: 13, color: '#94a3b8', minWidth: 200 }}>
          콜 트리 최소 스팬 표시 시간
        </label>
        <input
          type="number"
          min={0}
          step={1}
          value={minSpanMs}
          onChange={e => handleSpanChange(Number(e.target.value))}
          style={inputStyle}
        />
        <span style={{ fontSize: 13, color: '#64748b' }}>ms &nbsp;(0 = 모두 표시)</span>
      </div>
      <p style={{ fontSize: 12, color: '#475569', marginTop: 6, marginLeft: 212 }}>
        콜 트리/워터폴 내 이 값 미만인 스팬을 숨깁니다.
      </p>

      {saved && <span style={{ fontSize: 12, color: '#4ade80', display: 'block', marginTop: 12 }}>저장됨 ✓</span>}
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

// ── 에이전트 설정 관리 컴포넌트 ─────────────────────────

interface AgentConfig {
  instance: string;
  min_span_duration_ms: number;
  updated_at: string | null;
}

function AgentConfigManager({
  onGlobalMessage,
}: {
  onGlobalMessage: (msg: { type: 'success' | 'error'; text: string } | null) => void;
}) {
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Record<string, string>>({}); // instance → draft value
  const [saving, setSaving] = useState<string | null>(null);

  const fetchConfigs = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiFetch<AgentConfig[]>('/api/agents');
      setConfigs(data ?? []);
    } catch {
      /* 에이전트가 아직 없으면 빈 배열로 처리 */
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  const handleSave = async (instance: string) => {
    const raw = editing[instance];
    const ms = parseInt(raw ?? '0', 10);
    if (isNaN(ms) || ms < 0) {
      onGlobalMessage({ type: 'error', text: '0 이상의 정수를 입력해 주세요.' });
      return;
    }
    setSaving(instance);
    try {
      const updated = await apiPatch<AgentConfig>(`/api/agents/${encodeURIComponent(instance)}/config`, { min_span_duration_ms: ms });
      onGlobalMessage({ type: 'success', text: `[${instance}] 설정이 저장됐습니다. 에이전트 다음 폴링(최대 60초) 후 반영됩니다.` });
      setEditing(prev => { const n = { ...prev }; delete n[instance]; return n; });
      setConfigs(prev => prev.map(c => c.instance === instance ? updated : c));
    } catch {
      onGlobalMessage({ type: 'error', text: `[${instance}] 설정 저장 실패.` });
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="settings-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>에이전트 설정</h2>
          <p className="section-desc" style={{ margin: 0 }}>
            인스턴스별로 에이전트 동작을 제어합니다. 변경 사항은 최대 60초 후 에이전트에 반영됩니다.
          </p>
        </div>
        <button onClick={fetchConfigs} style={{ ...btnStyle, background: '#252840', color: '#94a3b8' }}>
          새로 고침
        </button>
      </div>

      {loading ? (
        <div style={{ color: '#64748b', fontSize: 13, padding: '16px 0' }}>로딩 중...</div>
      ) : configs.length === 0 ? (
        <div style={{ color: '#64748b', fontSize: 13, padding: '16px 0' }}>
          아직 등록된 에이전트가 없습니다. 에이전트를 시작하면 자동으로 등록됩니다.
        </div>
      ) : (
        <div style={cardStyle}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#64748b', fontSize: 11 }}>
                <th style={thStyle}>인스턴스</th>
                <th style={thStyle}>최소 처리시간 필터 (ms)</th>
                <th style={thStyle}>최종 변경</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>저장</th>
              </tr>
            </thead>
            <tbody>
              {configs.map(cfg => {
                const draft = editing[cfg.instance];
                const isDirty = draft !== undefined && draft !== String(cfg.min_span_duration_ms);
                return (
                  <tr key={cfg.instance} style={{ borderTop: '1px solid #2d3148' }}>
                    <td style={tdStyle}>{cfg.instance}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input
                          type="number"
                          min={0}
                          value={draft ?? cfg.min_span_duration_ms}
                          onChange={e => setEditing(prev => ({ ...prev, [cfg.instance]: e.target.value }))}
                          style={{
                            width: 90, padding: '4px 8px', borderRadius: 6,
                            border: `1px solid ${isDirty ? '#6366f1' : '#2d3148'}`,
                            background: '#0d0f18', color: '#f1f5f9', fontSize: 13,
                          }}
                        />
                        <span style={{ fontSize: 11, color: '#64748b' }}>
                          {Number(draft ?? cfg.min_span_duration_ms) === 0
                            ? '비활성'
                            : `${draft ?? cfg.min_span_duration_ms}ms 미만 제거`}
                        </span>
                      </div>
                    </td>
                    <td style={{ ...tdStyle, color: '#64748b', fontSize: 12 }}>
                      {cfg.updated_at ? new Date(cfg.updated_at).toLocaleString('ko-KR') : '—'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button
                        onClick={() => handleSave(cfg.instance)}
                        disabled={!isDirty || saving === cfg.instance}
                        style={{
                          ...btnStyle, fontSize: 12,
                          background: isDirty ? '#3730a3' : '#1e2238',
                          color:      isDirty ? '#a5b4fc' : '#475569',
                          cursor: isDirty ? 'pointer' : 'default',
                        }}
                      >
                        {saving === cfg.instance ? '저장 중...' : '적용'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ── 배포 마커 관리 컴포넌트 ─────────────────────────────

interface DeploymentRecord {
  id: number;
  service: string;
  version: string | null;
  commit_sha: string | null;
  environment: string | null;
  description: string | null;
  marker_time: string;
  created_at: string;
}

function DeploymentsManager({
  onGlobalMessage,
}: {
  onGlobalMessage: (msg: { type: 'success' | 'error'; text: string } | null) => void;
}) {
  const [records, setRecords] = useState<DeploymentRecord[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    service: '',
    version: '',
    commit_sha: '',
    environment: 'production',
    description: '',
  });

  const fetchAll = useCallback(async () => {
    try {
      setLoading(true);
      const [deps, svcs] = await Promise.all([
        apiFetch<DeploymentRecord[]>('/api/deployments?limit=100'),
        apiFetch<Array<{ name: string }>>('/api/services'),
      ]);
      setRecords(deps ?? []);
      setServices((svcs ?? []).map(s => s.name));
    } catch {
      onGlobalMessage({ type: 'error', text: '배포 기록을 불러오지 못했습니다.' });
    } finally {
      setLoading(false);
    }
  }, [onGlobalMessage]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.service.trim()) {
      onGlobalMessage({ type: 'error', text: '서비스명을 지정해 주세요.' });
      return;
    }
    setSubmitting(true);
    try {
      await apiPost('/api/deployments', {
        service:     form.service.trim(),
        version:     form.version.trim() || null,
        commit_sha:  form.commit_sha.trim() || null,
        environment: form.environment.trim() || 'production',
        description: form.description.trim() || null,
      });
      onGlobalMessage({ type: 'success', text: `[${form.service}] 배포 기록이 추가되었습니다.` });
      setForm({ service: form.service, version: '', commit_sha: '', environment: form.environment, description: '' });
      await fetchAll();
    } catch {
      onGlobalMessage({ type: 'error', text: '배포 기록 추가 중 오류가 발생했습니다.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await apiDelete(`/api/deployments/${id}`);
      setRecords(prev => prev.filter(r => r.id !== id));
      onGlobalMessage({ type: 'success', text: '배포 기록이 삭제되었습니다.' });
    } catch {
      onGlobalMessage({ type: 'error', text: '배포 기록 삭제 중 오류가 발생했습니다.' });
    }
  };

  const inputStyle: React.CSSProperties = {
    background: '#0d0f18', border: '1px solid #2d3148',
    color: '#f1f5f9', borderRadius: 6, padding: '6px 10px',
    fontSize: 13, outline: 'none',
  };

  return (
    <section className="settings-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <h2 style={{ marginBottom: 4 }}>배포 마커 (Deployment Markers)</h2>
          <p className="section-desc" style={{ margin: 0 }}>
            배포 시점을 기록하면 대시보드/메트릭 차트에 수직선으로 표시되어,
            "이 배포 이후 지연이 증가했다"는 연관 분석이 가능해집니다.
          </p>
        </div>
        <button onClick={fetchAll} style={{ ...btnStyle, background: '#252840', color: '#94a3b8' }}>
          새로 고침
        </button>
      </div>

      {/* 새 배포 기록 폼 */}
      <form onSubmit={handleCreate} style={{ ...cardStyle, marginTop: 12 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
          <div>
            <label style={labelStyle}>서비스 *</label>
            <input
              list="dm-services"
              value={form.service}
              onChange={e => setForm(p => ({ ...p, service: e.target.value }))}
              placeholder="jeus-sample"
              style={{ ...inputStyle, width: '100%' }}
              required
            />
            <datalist id="dm-services">
              {services.map(s => <option key={s} value={s} />)}
            </datalist>
          </div>
          <div>
            <label style={labelStyle}>버전</label>
            <input
              value={form.version}
              onChange={e => setForm(p => ({ ...p, version: e.target.value }))}
              placeholder="v1.2.3"
              style={{ ...inputStyle, width: '100%' }}
            />
          </div>
          <div>
            <label style={labelStyle}>커밋 SHA</label>
            <input
              value={form.commit_sha}
              onChange={e => setForm(p => ({ ...p, commit_sha: e.target.value }))}
              placeholder="a1b2c3d"
              style={{ ...inputStyle, width: '100%' }}
            />
          </div>
          <div>
            <label style={labelStyle}>환경</label>
            <input
              value={form.environment}
              onChange={e => setForm(p => ({ ...p, environment: e.target.value }))}
              placeholder="production"
              style={{ ...inputStyle, width: '100%' }}
            />
          </div>
        </div>
        <div style={{ marginTop: 10 }}>
          <label style={labelStyle}>메모 (선택)</label>
          <input
            value={form.description}
            onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            placeholder="결제 모듈 hotfix"
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button
            type="submit"
            disabled={submitting}
            style={{ ...btnStyle, background: '#3730a3', color: '#a5b4fc', fontWeight: 600 }}
          >
            {submitting ? '기록 중…' : '지금 배포 기록'}
          </button>
        </div>
      </form>

      {/* 기록 목록 */}
      <div style={{ marginTop: 12 }}>
        {loading ? (
          <div style={{ color: '#64748b', fontSize: 13, padding: '12px 0' }}>로딩 중...</div>
        ) : records.length === 0 ? (
          <div style={{ color: '#64748b', fontSize: 13, padding: '12px 0' }}>
            아직 기록된 배포가 없습니다. 위 폼에서 첫 기록을 추가하십시오.
          </div>
        ) : (
          <div style={cardStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#64748b', fontSize: 11 }}>
                  <th style={thStyle}>시각</th>
                  <th style={thStyle}>서비스</th>
                  <th style={thStyle}>버전 / 커밋</th>
                  <th style={thStyle}>환경</th>
                  <th style={thStyle}>메모</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>삭제</th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => (
                  <tr key={r.id} style={{ borderTop: '1px solid #2d3148' }}>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {new Date(r.marker_time).toLocaleString('ko-KR')}
                    </td>
                    <td style={tdStyle}>{r.service}</td>
                    <td style={{ ...tdStyle, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                      {r.version || '—'}
                      {r.commit_sha && <span style={{ color: '#64748b', marginLeft: 6 }}>{r.commit_sha.slice(0, 8)}</span>}
                    </td>
                    <td style={tdStyle}>
                      <span style={{
                        display: 'inline-block', padding: '2px 8px', borderRadius: 4,
                        fontSize: 11, fontWeight: 600,
                        background: r.environment === 'production' ? '#1e3a5f' : '#3f2a5f',
                        color:      r.environment === 'production' ? '#60a5fa' : '#c4b5fd',
                      }}>
                        {r.environment || '—'}
                      </span>
                    </td>
                    <td style={{ ...tdStyle, color: '#94a3b8', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.description || '—'}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      <button
                        onClick={() => handleDelete(r.id)}
                        style={{ ...btnStyle, background: '#252840', color: '#f87171', fontSize: 12 }}
                      >
                        삭제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, color: '#64748b',
  marginBottom: 4, fontWeight: 500,
};

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
