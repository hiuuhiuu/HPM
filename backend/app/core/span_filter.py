"""
스팬 노이즈 필터 — 수집 단계에서 의미 없는 자동 스팬을 drop.

APM에서 "실제 비즈니스 가시성"에는 기여하지 않으면서 트레이스·토폴로지·
슬로우 쿼리·에러 통계를 오염시키는 전형적 스팬들을 기본 차단한다.

카테고리:
- quartz       : Quartz 스케줄러 자체 + QRTZ_* 테이블 폴링
- actuator     : Spring Boot Actuator 엔드포인트 (/actuator/*)
- healthcheck  : K8s/LB 헬스체크 (/health, /healthz, /readyz, /livez, /ping, /status)
- favicon      : /favicon.ico
- metrics_scrape: Prometheus scrape (/metrics, /prometheus)

토글:
- 전체 비활성 : FILTER_NOISY_SPANS=false
- 개별 비활성 : FILTER_<CATEGORY>=false  (예: FILTER_ACTUATOR=false)
"""
import os
import re
from typing import Dict, Optional


def _enabled(env_key: str, default: bool = True) -> bool:
    v = os.getenv(env_key)
    if v is None:
        return default
    return v.lower() != "false"


# 전체 on/off 마스터 스위치
_ENABLED = _enabled("FILTER_NOISY_SPANS")

# 카테고리별 on/off
_CATEGORIES = {
    "quartz":         _enabled("FILTER_QUARTZ"),
    "actuator":       _enabled("FILTER_ACTUATOR"),
    "healthcheck":    _enabled("FILTER_HEALTHCHECK"),
    "favicon":        _enabled("FILTER_FAVICON"),
    "metrics_scrape": _enabled("FILTER_METRICS_SCRAPE"),
}


# ── Quartz ─────────────────────────────────────────────────────
_QUARTZ_NS_PREFIXES = (
    "org.quartz",
    "org.springframework.scheduling.quartz",
)
_QUARTZ_TABLE_RE = re.compile(r"\bQRTZ_[A-Z_]+", re.IGNORECASE)


def _is_quartz(name: Optional[str], attrs: Dict) -> bool:
    ns = attrs.get("code.namespace") or attrs.get("code.function") or ""
    if isinstance(ns, str) and ns.startswith(_QUARTZ_NS_PREFIXES):
        return True
    stmt = attrs.get("db.statement") or ""
    if isinstance(stmt, str) and _QUARTZ_TABLE_RE.search(stmt):
        return True
    if name:
        if name.startswith(_QUARTZ_NS_PREFIXES):
            return True
        if _QUARTZ_TABLE_RE.search(name):
            return True
    return False


# ── HTTP 경로 기반 필터 공통 ───────────────────────────────────
def _http_path(attrs: Dict) -> Optional[str]:
    """OTel 신/구 semconv 모두 커버"""
    for key in ("url.path", "http.target", "http.route", "http.url", "http.path"):
        v = attrs.get(key)
        if isinstance(v, str) and v:
            # URL 전체가 들어올 수도 있으므로 path만 추출
            if "://" in v:
                try:
                    from urllib.parse import urlparse
                    return urlparse(v).path
                except Exception:
                    return v
            # 쿼리스트링 제거
            q = v.find("?")
            return v[:q] if q >= 0 else v
    return None


# ── Actuator ───────────────────────────────────────────────────
def _is_actuator(name: Optional[str], attrs: Dict) -> bool:
    path = _http_path(attrs)
    if path and "/actuator/" in path:
        return True
    if name and "/actuator/" in name:
        return True
    return False


# ── Health Check ───────────────────────────────────────────────
# K8s/LB/Consul의 전형적 헬스체크 경로. 비즈니스 API가 이 경로를 쓸 가능성은 낮다.
_HEALTH_PATHS = frozenset({
    "/health", "/healthz", "/readyz", "/livez", "/liveness", "/readiness",
    "/ping", "/status", "/up",
})


def _is_healthcheck(name: Optional[str], attrs: Dict) -> bool:
    path = _http_path(attrs)
    if path:
        # 정확 일치 또는 마지막 세그먼트가 헬스체크 키워드인 경우
        if path in _HEALTH_PATHS:
            return True
    # span 이름이 "GET /health" 같은 패턴일 때
    if name:
        for h in _HEALTH_PATHS:
            if name.endswith(" " + h) or name == h:
                return True
    return False


# ── favicon ────────────────────────────────────────────────────
def _is_favicon(name: Optional[str], attrs: Dict) -> bool:
    path = _http_path(attrs)
    if path == "/favicon.ico":
        return True
    if name and "/favicon.ico" in name:
        return True
    return False


# ── Prometheus / Metrics scrape ────────────────────────────────
_METRICS_PATHS = frozenset({"/metrics", "/prometheus"})


def _is_metrics_scrape(name: Optional[str], attrs: Dict) -> bool:
    path = _http_path(attrs)
    if path in _METRICS_PATHS:
        return True
    if name:
        for p in _METRICS_PATHS:
            if name.endswith(" " + p) or name == p:
                return True
    return False


# ── 공개 진입점 ────────────────────────────────────────────────
def is_noisy_span(name: Optional[str], attrs: Optional[Dict]) -> bool:
    """해당 스팬을 저장에서 제외할지 판단."""
    if not _ENABLED:
        return False
    a = attrs or {}

    if _CATEGORIES["quartz"]         and _is_quartz(name, a):         return True
    if _CATEGORIES["actuator"]       and _is_actuator(name, a):       return True
    if _CATEGORIES["healthcheck"]    and _is_healthcheck(name, a):    return True
    if _CATEGORIES["favicon"]        and _is_favicon(name, a):        return True
    if _CATEGORIES["metrics_scrape"] and _is_metrics_scrape(name, a): return True
    return False


def is_enabled() -> bool:
    """기동 시 상태 로그용."""
    return _ENABLED


def active_categories() -> Dict[str, bool]:
    """현재 활성화된 카테고리 스냅샷."""
    return dict(_CATEGORIES) if _ENABLED else {k: False for k in _CATEGORIES}
