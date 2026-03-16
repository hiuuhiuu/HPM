import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, apiPost, apiDelete } from '../hooks/useApi';

// ─── 타입 정의 ───────────────────────────────────────────

interface DumpItem {
  id: number;
  collected_at: string;
  service: string;
  instance: string;
  request_id: number | null;
  requested_at: string | null;
  request_status: string | null;
}

interface DumpDetail extends DumpItem {
  dump_text: string;
}

interface DumpListResponse {
  total: number;
  page: number;
  limit: number;
  items: DumpItem[];
}

interface RequestStatus {
  id: number;
  status: string;
  dump_id: number | null;
  completed_at: string | null;
}

// ─── 컴포넌트 ────────────────────────────────────────────

export default function ThreadDumps() {
  // 서비스/인스턴스 목록
  const [services, setServices] = useState<string[]>([]);
  const [instances, setInstances] = useState<string[]>([]);

  // 필터 상태
  const [selectedService, setSelectedService] = useState('');
  const [selectedInstance, setSelectedInstance] = useState('');

  // 수집 상태
  const [collecting, setCollecting] = useState(false);
  const [collectMessage, setCollectMessage] = useState('');

  // 목록
  const [dumps, setDumps] = useState<DumpItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  // 상세 모달
  const [detail, setDetail] = useState<DumpDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 서비스 목록 로드 ──────────────────────────────────
  useEffect(() => {
    apiFetch<{ name: string }[]>('/api/services')
      .then(r => setServices(Array.isArray(r) ? r.map(s => s.name) : []))
      .catch(() => {});
  }, []);

  // ── 서비스 선택 시 인스턴스 목록 갱신 ────────────────
  useEffect(() => {
    setSelectedInstance('');
    setInstances([]);
    if (!selectedService) return;
    apiFetch<{ instances: string[] }>(
      `/api/thread-dumps/instances?service=${encodeURIComponent(selectedService)}`
    )
      .then(r => setInstances(r.instances ?? []))
      .catch(() => {});
  }, [selectedService]);

  // ── 덤프 목록 로드 ───────────────────────────────────
  const loadDumps = useCallback(async (p: number) => {
    const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
    if (selectedService)  params.set('service',  selectedService);
    if (selectedInstance) params.set('instance', selectedInstance);
    try {
      const r = await apiFetch<DumpListResponse>(`/api/thread-dumps?${params}`);
      setDumps(r.items);
      setTotal(r.total);
    } catch {
      // 무시
    }
  }, [selectedService, selectedInstance]);

  useEffect(() => {
    setPage(1);
    loadDumps(1);
  }, [selectedService, selectedInstance, loadDumps]);

  useEffect(() => {
    loadDumps(page);
  }, [page, loadDumps]);

  // ── 수집 버튼 ────────────────────────────────────────
  const handleCollect = async () => {
    if (!selectedService || !selectedInstance) {
      setCollectMessage('서비스와 인스턴스를 선택하세요.');
      return;
    }
    setCollecting(true);
    setCollectMessage('수집 요청 전송 중...');
    try {
      const req = await apiPost<{ id: number }>('/api/thread-dumps/request', {
        service: selectedService, instance: selectedInstance,
      });
      setCollectMessage('수집 중... (companion 스크립트 응답 대기)');
      startPolling(req.id);
    } catch {
      setCollectMessage('수집 요청 실패');
      setCollecting(false);
    }
  };

  const startPolling = (requestId: number) => {
    let elapsed = 0;
    pollTimerRef.current = setInterval(async () => {
      elapsed += 3;
      try {
        const status = await apiFetch<RequestStatus>(
          `/api/thread-dumps/request/${requestId}`
        );
        if (status.status === 'collected') {
          clearInterval(pollTimerRef.current!);
          setCollecting(false);
          setCollectMessage('수집 완료!');
          loadDumps(1);
          setPage(1);
          setTimeout(() => setCollectMessage(''), 3000);
        } else if (status.status === 'timeout' || status.status === 'failed') {
          clearInterval(pollTimerRef.current!);
          setCollecting(false);
          setCollectMessage(
            status.status === 'timeout'
              ? '수집 타임아웃 (30초 초과). companion 스크립트가 실행 중인지 확인하세요.'
              : '수집 실패'
          );
        } else if (elapsed >= 30) {
          clearInterval(pollTimerRef.current!);
          setCollecting(false);
          setCollectMessage('타임아웃: companion 스크립트 응답 없음');
        }
      } catch {
        // 일시적 오류 무시
      }
    }, 3000);
  };

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // ── 상세 조회 ─────────────────────────────────────────
  const openDetail = async (id: number) => {
    setLoadingDetail(true);
    setDetail(null);
    try {
      const d = await apiFetch<DumpDetail>(`/api/thread-dumps/${id}`);
      setDetail(d);
    } catch {
      // 무시
    } finally {
      setLoadingDetail(false);
    }
  };

  // ── 다운로드 ─────────────────────────────────────────
  const handleDownload = (d: DumpDetail) => {
    const blob = new Blob([d.dump_text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date(d.collected_at).toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `thread-dump_${d.instance}_${ts}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── 삭제 ─────────────────────────────────────────────
  const handleDelete = async (id: number) => {
    if (!window.confirm('이 덤프를 삭제하시겠습니까?')) return;
    try {
      await apiDelete(`/api/thread-dumps/${id}`);
      if (detail?.id === id) setDetail(null);
      loadDumps(page);
    } catch {
      // 무시
    }
  };

  // ── 렌더 ─────────────────────────────────────────────
  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div style={{ padding: '24px', color: '#e2e8f0' }}>
      <h2 style={{ margin: '0 0 20px', fontSize: 20, fontWeight: 700 }}>스레드 덤프</h2>

      {/* 필터 + 수집 버튼 */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 20, flexWrap: 'wrap' }}>
        <select
          value={selectedService}
          onChange={e => setSelectedService(e.target.value)}
          style={selectStyle}
        >
          <option value="">서비스 선택</option>
          {services.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          value={selectedInstance}
          onChange={e => setSelectedInstance(e.target.value)}
          disabled={!selectedService}
          style={{ ...selectStyle, opacity: selectedService ? 1 : 0.5 }}
        >
          <option value="">인스턴스 선택</option>
          {instances.map(i => <option key={i} value={i}>{i}</option>)}
        </select>

        <button
          onClick={handleCollect}
          disabled={collecting || !selectedService || !selectedInstance}
          style={{
            padding: '8px 18px',
            background: collecting ? '#374151' : '#6366f1',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            cursor: collecting ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            fontSize: 14,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {collecting && <Spinner />}
          {collecting ? '수집 중...' : '스레드 덤프 수집'}
        </button>

        {collectMessage && (
          <span style={{
            fontSize: 13,
            color: collectMessage.includes('완료') ? '#4ade80'
                 : collectMessage.includes('실패') || collectMessage.includes('타임아웃') ? '#f87171'
                 : '#94a3b8',
          }}>
            {collectMessage}
          </span>
        )}
      </div>

      {/* 목록 테이블 */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #2d3148', color: '#94a3b8' }}>
              <th style={thStyle}>수집 시각</th>
              <th style={thStyle}>서비스</th>
              <th style={thStyle}>인스턴스</th>
              <th style={thStyle}>상태</th>
              <th style={thStyle}>작업</th>
            </tr>
          </thead>
          <tbody>
            {dumps.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '32px', color: '#475569' }}>
                  수집된 스레드 덤프가 없습니다.
                </td>
              </tr>
            ) : dumps.map(d => (
              <tr
                key={d.id}
                style={{ borderBottom: '1px solid #1e2035', cursor: 'pointer' }}
                onClick={() => openDetail(d.id)}
              >
                <td style={tdStyle}>{fmtDate(d.collected_at)}</td>
                <td style={tdStyle}>{d.service}</td>
                <td style={tdStyle}>{d.instance}</td>
                <td style={tdStyle}>
                  <StatusBadge status={d.request_status ?? 'collected'} />
                </td>
                <td style={{ ...tdStyle, whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                  <button
                    style={actionBtnStyle}
                    onClick={async () => {
                      const full = await apiFetch<DumpDetail>(`/api/thread-dumps/${d.id}`);
                      handleDownload(full);
                    }}
                  >
                    다운로드
                  </button>
                  <button
                    style={{ ...actionBtnStyle, background: '#7f1d1d', marginLeft: 4 }}
                    onClick={() => handleDelete(d.id)}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'center' }}>
          <button
            style={pageBtnStyle}
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >이전</button>
          <span style={{ lineHeight: '32px', fontSize: 13, color: '#94a3b8' }}>
            {page} / {totalPages}
          </span>
          <button
            style={pageBtnStyle}
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >다음</button>
        </div>
      )}

      {/* 상세 모달 */}
      {(detail || loadingDetail) && (
        <Modal onClose={() => setDetail(null)}>
          {loadingDetail ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
              <Spinner />&nbsp; 로딩 중...
            </div>
          ) : detail ? (
            <DumpDetailView
              dump={detail}
              onDownload={() => handleDownload(detail)}
              onDelete={() => handleDelete(detail.id)}
              onClose={() => setDetail(null)}
            />
          ) : null}
        </Modal>
      )}
    </div>
  );
}

// ─── 서브 컴포넌트 ───────────────────────────────────────

function DumpDetailView({
  dump, onDownload, onDelete, onClose,
}: {
  dump: DumpDetail;
  onDownload: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 헤더 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        padding: '16px 20px', borderBottom: '1px solid #2d3148',
      }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
            스레드 덤프 — {dump.instance}
          </div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {fmtDate(dump.collected_at)} · {dump.service}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={actionBtnStyle} onClick={onDownload}>다운로드</button>
          <button style={{ ...actionBtnStyle, background: '#7f1d1d' }} onClick={() => { onDelete(); onClose(); }}>삭제</button>
          <button style={{ ...actionBtnStyle, background: '#374151' }} onClick={onClose}>닫기</button>
        </div>
      </div>

      {/* 덤프 텍스트 */}
      <pre style={{
        flex: 1,
        margin: 0,
        padding: '16px 20px',
        overflowY: 'auto',
        fontFamily: '"JetBrains Mono", "Fira Code", "Courier New", monospace',
        fontSize: 12,
        lineHeight: 1.6,
        color: '#d1fae5',
        background: '#0f172a',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}>
        {dump.dump_text}
      </pre>
    </div>
  );
}

function Modal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1a1d27',
          border: '1px solid #2d3148',
          borderRadius: 10,
          width: '90vw',
          maxWidth: 1000,
          height: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    collected: { label: '수집됨', color: '#166534' },
    pending:   { label: '대기 중', color: '#854d0e' },
    timeout:   { label: '타임아웃', color: '#7f1d1d' },
    failed:    { label: '실패', color: '#7f1d1d' },
  };
  const s = map[status] ?? { label: status, color: '#374151' };
  return (
    <span style={{
      background: s.color,
      color: '#f0f0f0',
      borderRadius: 4,
      padding: '2px 8px',
      fontSize: 11,
      fontWeight: 600,
    }}>
      {s.label}
    </span>
  );
}

function Spinner() {
  return (
    <span style={{
      display: 'inline-block',
      width: 14, height: 14,
      border: '2px solid rgba(255,255,255,0.3)',
      borderTopColor: '#fff',
      borderRadius: '50%',
      animation: 'spin 0.8s linear infinite',
    }} />
  );
}

// ─── 유틸 ────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

// ─── 스타일 상수 ─────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: '#1e2035',
  border: '1px solid #2d3148',
  borderRadius: 6,
  color: '#e2e8f0',
  fontSize: 14,
  minWidth: 160,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 12px',
  fontWeight: 600,
  fontSize: 12,
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px',
  verticalAlign: 'middle',
};

const actionBtnStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: '#1e40af',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
};

const pageBtnStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: '#1e2035',
  color: '#e2e8f0',
  border: '1px solid #2d3148',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
};
