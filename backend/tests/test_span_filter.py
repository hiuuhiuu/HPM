"""
노이즈 스팬 필터 단위 테스트 (Quartz + Actuator + 헬스체크 + favicon + Prometheus).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.span_filter import is_noisy_span  # noqa: E402


# ── Quartz ─────────────────────────────────────────────────────
class TestQuartz:
    def test_quartz_namespace(self):
        assert is_noisy_span("execute", {"code.namespace": "org.quartz.core.QuartzSchedulerThread"})

    def test_spring_quartz_namespace(self):
        assert is_noisy_span("run", {"code.namespace": "org.springframework.scheduling.quartz.LocalDataSourceJobStore"})

    def test_qrtz_triggers_select(self):
        assert is_noisy_span("SELECT", {"db.statement": "SELECT * FROM QRTZ_TRIGGERS WHERE STATE = ?"})

    def test_qrtz_scheduler_state_update(self):
        assert is_noisy_span("UPDATE", {"db.statement": "UPDATE qrtz_scheduler_state SET LAST_CHECKIN_TIME = ?"})

    def test_qrtz_in_span_name(self):
        assert is_noisy_span("SELECT QRTZ_LOCKS", {})

    def test_business_namespace_not_noisy(self):
        assert not is_noisy_span("execute", {"code.namespace": "com.example.service.OrderService"})

    def test_business_query_not_noisy(self):
        assert not is_noisy_span("SELECT orders", {"db.statement": "SELECT * FROM orders WHERE user_id = ?"})


# ── Actuator ───────────────────────────────────────────────────
class TestActuator:
    def test_actuator_health_via_url_path(self):
        assert is_noisy_span("GET /actuator/health", {"url.path": "/actuator/health"})

    def test_actuator_prometheus_via_http_target(self):
        assert is_noisy_span("GET", {"http.target": "/actuator/prometheus"})

    def test_actuator_in_span_name_only(self):
        assert is_noisy_span("GET /actuator/info", {})

    def test_normal_api_not_matched(self):
        assert not is_noisy_span("GET /api/users", {"url.path": "/api/users"})


# ── 헬스체크 ───────────────────────────────────────────────────
class TestHealthcheck:
    def test_health_exact(self):
        assert is_noisy_span("GET /health", {"url.path": "/health"})

    def test_healthz(self):
        assert is_noisy_span("GET /healthz", {"url.path": "/healthz"})

    def test_readyz(self):
        assert is_noisy_span("GET /readyz", {"http.target": "/readyz"})

    def test_livez(self):
        assert is_noisy_span("GET /livez", {"http.target": "/livez"})

    def test_ping(self):
        assert is_noisy_span("GET /ping", {"url.path": "/ping"})

    def test_nested_health_not_matched(self):
        """비즈니스 API가 실수로 /api/users/health 같은 경로를 쓸 경우 필터 안 함"""
        assert not is_noisy_span("GET /api/users/health", {"url.path": "/api/users/health"})


# ── favicon ────────────────────────────────────────────────────
class TestFavicon:
    def test_favicon_via_url_path(self):
        assert is_noisy_span("GET /favicon.ico", {"url.path": "/favicon.ico"})

    def test_favicon_in_span_name_only(self):
        assert is_noisy_span("GET /favicon.ico", {})


# ── Prometheus scrape ──────────────────────────────────────────
class TestMetricsScrape:
    def test_metrics_path(self):
        assert is_noisy_span("GET /metrics", {"url.path": "/metrics"})

    def test_prometheus_path(self):
        assert is_noisy_span("GET /prometheus", {"http.target": "/prometheus"})

    def test_api_metrics_subpath_not_matched(self):
        assert not is_noisy_span("GET /api/metrics/summary", {"url.path": "/api/metrics/summary"})


# ── URL 전체 → path 추출 ───────────────────────────────────────
class TestUrlParsing:
    def test_full_http_url_with_query(self):
        assert is_noisy_span(
            "GET",
            {"http.url": "http://backend:8080/actuator/health?format=json"},
        )

    def test_query_string_stripped_for_exact_match(self):
        assert is_noisy_span(
            "GET /health",
            {"url.path": "/health?check=db"},
        )


# ── 커넥션 풀 검증 쿼리 ────────────────────────────────────────
class TestConnectionValidation:
    def test_select_1(self):
        assert is_noisy_span("SELECT", {"db.statement": "SELECT 1"})

    def test_select_1_case_insensitive(self):
        assert is_noisy_span("select", {"db.statement": "select 1"})
        assert is_noisy_span("Select", {"db.statement": "Select 1"})

    def test_select_1_with_semicolon(self):
        assert is_noisy_span("SELECT", {"db.statement": "SELECT 1;"})

    def test_select_1_with_whitespace(self):
        assert is_noisy_span("SELECT", {"db.statement": "  SELECT  1  "})

    def test_select_1_with_block_comment(self):
        assert is_noisy_span("SELECT", {"db.statement": "/* ping */ SELECT 1"})

    def test_select_1_with_line_comment(self):
        assert is_noisy_span("SELECT", {"db.statement": "-- health check\nSELECT 1"})

    def test_select_1_from_dual_oracle(self):
        assert is_noisy_span("SELECT", {"db.statement": "SELECT 1 FROM DUAL"})

    def test_select_1_from_sysibm_db2(self):
        assert is_noisy_span("SELECT", {"db.statement": "SELECT 1 FROM SYSIBM.SYSDUMMY1"})

    def test_select_x_quoted(self):
        assert is_noisy_span("SELECT", {"db.statement": "SELECT 'x'"})

    def test_values_1_derby(self):
        assert is_noisy_span("VALUES", {"db.statement": "VALUES 1"})

    def test_select_version_mysql(self):
        assert is_noisy_span("SELECT", {"db.statement": "SELECT VERSION()"})

    def test_select_current_timestamp(self):
        assert is_noisy_span("SELECT", {"db.statement": "SELECT CURRENT_TIMESTAMP"})

    def test_business_select_not_matched(self):
        assert not is_noisy_span("SELECT", {"db.statement": "SELECT 1 FROM users WHERE id = ?"})

    def test_select_constant_in_business_query_not_matched(self):
        assert not is_noisy_span("SELECT", {"db.statement": "SELECT 1, name FROM users"})

    def test_no_statement_not_matched(self):
        assert not is_noisy_span("SELECT", {})


# ── env 토글 ───────────────────────────────────────────────────
class TestEnvToggles:
    def test_full_disable(self, monkeypatch):
        monkeypatch.setenv("FILTER_NOISY_SPANS", "false")
        import importlib, app.core.span_filter as sf  # noqa
        importlib.reload(sf)
        try:
            assert sf.is_noisy_span("execute", {"code.namespace": "org.quartz.Job"}) is False
            assert sf.is_enabled() is False
        finally:
            monkeypatch.delenv("FILTER_NOISY_SPANS", raising=False)
            importlib.reload(sf)

    def test_single_category_disable(self, monkeypatch):
        """Actuator만 비활성 — Quartz는 여전히 차단되어야 함"""
        monkeypatch.setenv("FILTER_ACTUATOR", "false")
        import importlib, app.core.span_filter as sf  # noqa
        importlib.reload(sf)
        try:
            assert sf.is_noisy_span("GET /actuator/health", {"url.path": "/actuator/health"}) is False
            assert sf.is_noisy_span("SELECT", {"db.statement": "SELECT * FROM QRTZ_TRIGGERS"}) is True
            assert sf.active_categories()["actuator"] is False
            assert sf.active_categories()["quartz"] is True
        finally:
            monkeypatch.delenv("FILTER_ACTUATOR", raising=False)
            importlib.reload(sf)


# ── 음성 케이스 ────────────────────────────────────────────────
class TestNegative:
    def test_empty(self):
        assert not is_noisy_span("business-op", {})
        assert not is_noisy_span("business-op", None)

    def test_normal_http_not_matched(self):
        attrs = {
            "http.method": "POST",
            "url.path": "/api/order",
            "code.namespace": "com.acme.controller.OrderController",
        }
        assert not is_noisy_span("POST /api/order", attrs)
