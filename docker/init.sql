-- TimescaleDB 확장 활성화
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- 메트릭 테이블 (시계열)
CREATE TABLE IF NOT EXISTS metrics (
    time        TIMESTAMPTZ NOT NULL,
    service     TEXT NOT NULL,
    instance    TEXT NOT NULL,
    name        TEXT NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    unit        TEXT,
    attributes  JSONB DEFAULT '{}'
);
SELECT create_hypertable('metrics', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_metrics_service ON metrics (service, time DESC);

-- 트레이스 테이블 (하이퍼테이블 변환을 위해 PK 제거 및 복합 인덱스로 대체)
CREATE TABLE IF NOT EXISTS traces (
    trace_id    TEXT NOT NULL,
    span_id     TEXT NOT NULL,
    parent_span_id TEXT,
    service     TEXT NOT NULL,
    instance    TEXT,
    name        TEXT NOT NULL,
    start_time  TIMESTAMPTZ NOT NULL,
    end_time    TIMESTAMPTZ NOT NULL,
    duration_ms DOUBLE PRECISION NOT NULL,
    status      TEXT DEFAULT 'OK',
    span_kind   TEXT DEFAULT 'INTERNAL',
    attributes  JSONB DEFAULT '{}',
    events      JSONB DEFAULT '[]'
);
SELECT create_hypertable('traces', 'start_time', if_not_exists => TRUE, chunk_time_interval => INTERVAL '1 day');
CREATE UNIQUE INDEX IF NOT EXISTS idx_traces_pk ON traces (trace_id, span_id, start_time);
CREATE INDEX IF NOT EXISTS idx_traces_service ON traces (service, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_traces_trace_id ON traces (trace_id);
-- 서비스/인스턴스 상태 조회를 위한 최적화 인덱스
CREATE INDEX IF NOT EXISTS idx_traces_service_parent_time ON traces (service, start_time DESC) WHERE parent_span_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_traces_instance_service_time ON traces (instance, service, start_time DESC);

-- 시스템 설정 (Settings) 테이블
CREATE TABLE IF NOT EXISTS system_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 기본 보존 주기(Retention) 설정 데이터 삽입
INSERT INTO system_settings (key, value, description) VALUES
    ('retention_traces_days', '14', '트레이스 데이터 보존 기간(일)'),
    ('retention_metrics_days', '30', '메트릭 데이터 보존 기간(일)'),
    ('retention_logs_days', '30', '로그 데이터 보존 기간(일)')
ON CONFLICT (key) DO NOTHING;

-- 기본 TimescaleDB 보존 정책(Retention Policy) 생성 (TimescaleDB 함수 활용)
-- (생성 시 이미 존재하면 에러가 날 수 있으므로, 초기화 스크립트에서는 생략하고 백엔드 서버 구동 시 초기화하거나 에러를 무시하는 프로시저를 쓰기도 합니다. 여기서는 백엔드 서버에서 실행하도록 남겨둡니다.)


-- 로그 테이블 (시계열)
CREATE TABLE IF NOT EXISTS logs (
    time        TIMESTAMPTZ NOT NULL,
    service     TEXT NOT NULL,
    instance    TEXT,
    level       TEXT NOT NULL,
    body        TEXT NOT NULL,
    trace_id    TEXT,
    span_id     TEXT,
    attributes  JSONB DEFAULT '{}'
);
SELECT create_hypertable('logs', 'time', if_not_exists => TRUE);
CREATE INDEX IF NOT EXISTS idx_logs_service ON logs (service, time DESC);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs (level, time DESC);
CREATE INDEX IF NOT EXISTS idx_logs_trace_id ON logs (trace_id);

-- 에러 추적 테이블
CREATE TABLE IF NOT EXISTS errors (
    id          SERIAL PRIMARY KEY,
    time        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    service     TEXT NOT NULL,
    instance    TEXT,
    error_type  TEXT NOT NULL,
    message     TEXT NOT NULL,
    stack_trace TEXT,
    trace_id    TEXT,
    span_id     TEXT,
    resolved    BOOLEAN DEFAULT FALSE,
    attributes  JSONB DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_errors_service ON errors (service, time DESC);
CREATE INDEX IF NOT EXISTS idx_errors_resolved ON errors (resolved, time DESC);

-- 알림 규칙 테이블
CREATE TABLE IF NOT EXISTS alert_rules (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    service     TEXT,
    metric_name TEXT NOT NULL,
    condition   TEXT NOT NULL,  -- gt, lt, gte, lte, eq
    threshold   DOUBLE PRECISION NOT NULL,
    duration_s  INTEGER DEFAULT 60,
    severity    TEXT DEFAULT 'warning',  -- info, warning, critical
    enabled     BOOLEAN DEFAULT TRUE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 알림 발생 이력 테이블
CREATE TABLE IF NOT EXISTS alert_events (
    id          SERIAL PRIMARY KEY,
    rule_id     INTEGER REFERENCES alert_rules(id),
    fired_at    TIMESTAMPTZ DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    value       DOUBLE PRECISION,
    message     TEXT,
    status      TEXT DEFAULT 'firing'  -- firing, resolved
);
CREATE INDEX IF NOT EXISTS idx_alert_events_rule ON alert_events (rule_id, fired_at DESC);

-- 서비스 등록 테이블
CREATE TABLE IF NOT EXISTS services (
    id          SERIAL PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    last_seen   TIMESTAMPTZ DEFAULT NOW()
);

-- 스레드 덤프 수집 요청 큐 (커맨드 큐)
CREATE TABLE IF NOT EXISTS thread_dump_requests (
    id           SERIAL PRIMARY KEY,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    service      TEXT NOT NULL,
    instance     TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending',  -- pending | collected | failed | timeout
    completed_at TIMESTAMPTZ
);

-- 스레드 덤프 수집 결과 저장
CREATE TABLE IF NOT EXISTS thread_dumps (
    id           SERIAL PRIMARY KEY,
    collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    service      TEXT NOT NULL,
    instance     TEXT NOT NULL,
    dump_text    TEXT NOT NULL,
    request_id   INTEGER REFERENCES thread_dump_requests(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_thread_dumps_instance ON thread_dumps (service, instance, collected_at DESC);
