"""
OTLP (OpenTelemetry Protocol) 데이터 파싱 및 DB 저장 서비스

Java Agent → OTLP HTTP (protobuf binary) → 이 서비스 → PostgreSQL
"""
import json
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────
# 공통 유틸
# ─────────────────────────────────────────────

def _ns_to_dt(ns: int) -> datetime:
    """나노초 타임스탬프 → datetime (UTC)"""
    if not ns:
        return datetime.now(tz=timezone.utc)
    return datetime.fromtimestamp(ns / 1e9, tz=timezone.utc)


def _bytes_to_hex(b: bytes) -> Optional[str]:
    """bytes → hex string (trace_id, span_id 변환)"""
    if not b:
        return None
    return b.hex()


def _extract_attr_value(value) -> Any:
    """protobuf AnyValue → Python 값"""
    kind = value.WhichOneof("value")
    if kind == "string_value":
        return value.string_value
    elif kind == "int_value":
        return value.int_value
    elif kind == "double_value":
        return value.double_value
    elif kind == "bool_value":
        return value.bool_value
    elif kind == "array_value":
        return [_extract_attr_value(v) for v in value.array_value.values]
    elif kind == "kvlist_value":
        return {kv.key: _extract_attr_value(kv.value) for kv in value.kvlist_value.values}
    return None


def _extract_attrs(attributes) -> Dict[str, Any]:
    """protobuf KeyValue 목록 → dict"""
    return {kv.key: _extract_attr_value(kv.value) for kv in attributes}


_STATIC_EXTENSIONS = frozenset(
    ".css .js .map .ts .jsx .tsx "
    ".png .jpg .jpeg .gif .svg .ico .webp .avif "
    ".woff .woff2 .ttf .eot "
    ".html .htm .json .xml "
    ".mp4 .mp3 .webm .ogg".split()
)

# WAS별 정적 리소스 서블릿이 만들어내는 wildcard 스팬 패턴
# - JEUS  : DefaultServlet → "*", "GET *"
# - Tomcat: DefaultServlet → "/", "GET /"
# - WebLogic: FileServlet → "FileServlet", "GET FileServlet"
# - Spring Boot: ResourceHttpRequestHandler → "/**", "/static/**", "/webjars/**"
_STATIC_SPAN_SUFFIXES = frozenset([
    "*", "/**", "/*", "/",
    "/static/**", "/static/*",
    "/webjars/**", "/webjars/*",
    "/resources/**", "/resources/*",
    "/public/**", "/public/*",
])
_STATIC_SPAN_EXACT = frozenset([
    "FileServlet",          # WebLogic
    "DefaultServlet",       # 일부 컨테이너가 그대로 노출
    "ResourceHttpRequestHandler",  # Spring Boot
])

def _normalize_attrs(attrs: Dict[str, Any]) -> Dict[str, Any]:
    """
    OTel HTTP semantic convention 신/구 속성 정규화.

    OTel Java Agent < 1.20  : http.method, http.url, http.target, http.status_code
    OTel Java Agent >= 1.20 : http.request.method, url.full, url.path, http.response.status_code

    신규 이름을 구버전 이름으로 복사해 하위 호환성을 유지한다.
    원본 신규 키는 그대로 보존하므로 UI에서도 모두 볼 수 있다.
    """
    # http.request.method → http.method
    if "http.request.method" in attrs and "http.method" not in attrs:
        attrs["http.method"] = attrs["http.request.method"]

    # url.full → http.url
    if "url.full" in attrs and "http.url" not in attrs:
        attrs["http.url"] = attrs["url.full"]

    # url.path → http.target
    if "url.path" in attrs and "http.target" not in attrs:
        attrs["http.target"] = attrs["url.path"]

    # http.response.status_code → http.status_code
    if "http.response.status_code" in attrs and "http.status_code" not in attrs:
        attrs["http.status_code"] = attrs["http.response.status_code"]

    return attrs


# OTel SpanKind 정수 → 문자열
_SPAN_KIND_MAP = {
    0: "UNSPECIFIED",
    1: "INTERNAL",
    2: "SERVER",
    3: "CLIENT",
    4: "PRODUCER",
    5: "CONSUMER",
}


def _normalize_span_name(name: str, attrs: Dict[str, Any]) -> str:
    """
    J2EE WAS(JEUS / Tomcat / WebLogic) + Spring Boot 공통 스팬 이름 정규화.

    판별 우선순위:
    1. http.target / url.path 확장자가 정적 파일 확장자인 경우 → '[정적 리소스]'
    2. 스팬 이름(route 부분)이 WAS별 정적 리소스 wildcard 패턴인 경우 → '[정적 리소스]'
    3. 스팬 이름이 WAS 정적 서블릿 클래스명인 경우 → '[정적 리소스]'
    4. 스팬 이름에 와일드카드(*)가 포함된 경우 → 실제 경로(http.target/url.path)로 대체
    """
    method = attrs.get("http.method") or attrs.get("http.request.method", "")
    target = attrs.get("http.target", "") or attrs.get("url.path", "")
    path   = target.split("?")[0]
    ext    = ("." + path.rsplit(".", 1)[-1].lower()) if "." in path else ""

    def _static_name() -> str:
        return f"{method} [정적 리소스]".strip() if method else "[정적 리소스]"

    # 1) 확장자 기반
    if ext in _STATIC_EXTENSIONS:
        return _static_name()

    # 2) route wildcard 패턴 ("GET *", "GET /**", "GET /static/**" 등)
    bare = name.strip()
    # HTTP 메서드 prefix 제거 후 route 부분만 추출
    parts = bare.split(" ", 1)
    route = parts[-1].strip()  # "GET /static/**" → "/static/**"

    if route in _STATIC_SPAN_SUFFIXES:
        return _static_name()

    # 3) 서블릿 클래스명 노출 (WebLogic FileServlet 등)
    if route in _STATIC_SPAN_EXACT or bare in _STATIC_SPAN_EXACT:
        return _static_name()

    # 4) 와일드카드(*) 포함 route 템플릿 → 실제 경로로 대체
    #    예: "POST /backbone/*" → "POST /rp/api/ctm/mbr/CTM1300U00/listMembInfo.ap"
    if "*" in route and path:
        return f"{method} {path}".strip() if method else path

    return name


async def _upsert_service(db: AsyncSession, service_name: str) -> None:
    """서비스 등록 및 last_seen 갱신"""
    await db.execute(
        text("""
            INSERT INTO services (name, last_seen)
            VALUES (:name, NOW())
            ON CONFLICT (name) DO UPDATE SET last_seen = NOW()
        """),
        {"name": service_name},
    )


# ─────────────────────────────────────────────
# 메트릭 처리
# ─────────────────────────────────────────────

async def process_metrics(db: AsyncSession, body: bytes) -> int:
    """
    OTLP Metrics protobuf 파싱 → metrics 테이블 저장

    지원 타입:
      - Gauge     : 현재 값 (jvm.memory.used, cpu.usage 등)
      - Sum       : 누적 카운터 (http.server.request.count 등)
      - Histogram : 분포 (http.server.request.duration 등)
                    → sum/count 평균값 저장, 버킷은 attributes에 JSON으로 보관
    """
    from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import (
        ExportMetricsServiceRequest,
    )

    req = ExportMetricsServiceRequest()
    req.ParseFromString(body)

    rows: List[Dict] = []
    services_seen = set()

    for rm in req.resource_metrics:
        resource_attrs = _extract_attrs(rm.resource.attributes)
        service = resource_attrs.get("service.name", "unknown")
        instance = resource_attrs.get("service.instance.id", "default")

        if service not in services_seen:
            await _upsert_service(db, service)
            services_seen.add(service)

        for sm in rm.scope_metrics:
            for metric in sm.metrics:
                data_type = metric.WhichOneof("data")

                if data_type == "gauge":
                    for dp in metric.gauge.data_points:
                        val_kind = dp.WhichOneof("value")
                        value = dp.as_double if val_kind == "as_double" else float(dp.as_int)
                        rows.append(_build_metric_row(
                            service, instance, metric.name, metric.unit,
                            _ns_to_dt(dp.time_unix_nano), value,
                            _extract_attrs(dp.attributes),
                        ))

                elif data_type == "sum":
                    for dp in metric.sum.data_points:
                        val_kind = dp.WhichOneof("value")
                        value = dp.as_double if val_kind == "as_double" else float(dp.as_int)
                        rows.append(_build_metric_row(
                            service, instance, metric.name, metric.unit,
                            _ns_to_dt(dp.time_unix_nano), value,
                            _extract_attrs(dp.attributes),
                        ))

                elif data_type == "histogram":
                    for dp in metric.histogram.data_points:
                        avg = (dp.sum / dp.count) if dp.count > 0 else 0.0
                        attrs = _extract_attrs(dp.attributes)
                        attrs["_histogram_count"] = dp.count
                        attrs["_histogram_sum"] = dp.sum
                        # 버킷 경계 및 카운트 보관 (분위수 계산용)
                        attrs["_histogram_bounds"] = list(dp.explicit_bounds)
                        attrs["_histogram_bucket_counts"] = list(dp.bucket_counts)
                        rows.append(_build_metric_row(
                            service, instance, metric.name, metric.unit,
                            _ns_to_dt(dp.time_unix_nano), avg, attrs,
                        ))

    if rows:
        await db.execute(
            text("""
                INSERT INTO metrics (time, service, instance, name, value, unit, attributes)
                VALUES (:time, :service, :instance, :name, :value, :unit, CAST(:attributes AS jsonb))
            """),
            rows,
        )
        await db.commit()

    logger.info(f"[Metrics] 저장: {len(rows)}개 데이터포인트")
    return len(rows)


def _build_metric_row(
    service: str, instance: str, name: str, unit: str,
    time: datetime, value: float, attrs: Dict,
) -> Dict:
    return {
        "time": time,
        "service": service,
        "instance": instance,
        "name": name,
        "value": value,
        "unit": unit,
        "attributes": json.dumps(attrs),
    }


# ─────────────────────────────────────────────
# 트레이스 처리
# ─────────────────────────────────────────────

async def process_traces(db: AsyncSession, body: bytes) -> int:
    """
    OTLP Traces protobuf 파싱 → traces 테이블 저장
    에러 스팬은 errors 테이블에도 동시 저장
    """
    from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
        ExportTraceServiceRequest,
    )

    req = ExportTraceServiceRequest()
    req.ParseFromString(body)

    span_rows: List[Dict] = []
    error_rows: List[Dict] = []
    services_seen = set()

    for rs in req.resource_spans:
        resource_attrs = _extract_attrs(rs.resource.attributes)
        service = resource_attrs.get("service.name", "unknown")
        instance = resource_attrs.get("service.instance.id", "default")

        if service not in services_seen:
            await _upsert_service(db, service)
            services_seen.add(service)

        for ss in rs.scope_spans:
            for span in ss.spans:
                trace_id = _bytes_to_hex(span.trace_id)
                span_id = _bytes_to_hex(span.span_id)
                parent_span_id = _bytes_to_hex(span.parent_span_id) if span.parent_span_id else None

                start_time = _ns_to_dt(span.start_time_unix_nano)
                end_time = _ns_to_dt(span.end_time_unix_nano)
                duration_ms = (span.end_time_unix_nano - span.start_time_unix_nano) / 1e6

                # 상태: 0=UNSET, 1=OK, 2=ERROR
                status_code = span.status.code
                status = "ERROR" if status_code == 2 else "OK"

                attrs = _normalize_attrs(_extract_attrs(span.attributes))
                span_kind = _SPAN_KIND_MAP.get(span.kind, "INTERNAL")
                norm_name = _normalize_span_name(span.name, attrs)

                # 정적 리소스 스팬 — DB 저장 생략 (용량·성능 절약)
                if "[정적 리소스]" in norm_name:
                    continue

                events = [
                    {
                        "name": e.name,
                        "time": _ns_to_dt(e.time_unix_nano).isoformat(),
                        "attributes": _extract_attrs(e.attributes),
                    }
                    for e in span.events
                ]

                span_rows.append({
                    "trace_id": trace_id,
                    "span_id": span_id,
                    "parent_span_id": parent_span_id,
                    "service": service,
                    "instance": instance,
                    "name": norm_name,
                    "start_time": start_time,
                    "end_time": end_time,
                    "duration_ms": duration_ms,
                    "status": status,
                    "span_kind": span_kind,
                    "attributes": json.dumps(attrs),
                    "events": json.dumps(events),
                })

                # 에러 스팬 → errors 테이블
                if status_code == 2:
                    # OTel 스펙: 예외 정보는 span attributes가 아닌
                    # name="exception" 인 span event의 attributes에 기록됨
                    exc_attrs: Dict[str, Any] = {}
                    for evt in events:
                        if evt.get("name") == "exception":
                            exc_attrs = evt.get("attributes", {})
                            break

                    error_rows.append({
                        "service": service,
                        "instance": instance,
                        "error_type": (
                            exc_attrs.get("exception.type")
                            or attrs.get("exception.type")
                            or span.status.message
                            or "UnknownError"
                        ),
                        "message": (
                            span.status.message
                            or exc_attrs.get("exception.message")
                            or attrs.get("exception.message")
                            or "Unknown error"
                        ),
                        "stack_trace": (
                            exc_attrs.get("exception.stacktrace")
                            or attrs.get("exception.stacktrace")
                        ),
                        "trace_id": trace_id,
                        "span_id": span_id,
                        "attributes": json.dumps(attrs),
                    })

    if span_rows:
        await db.execute(
            text("""
                INSERT INTO traces
                    (trace_id, span_id, parent_span_id, service, instance, name,
                     start_time, end_time, duration_ms, status, span_kind, attributes, events)
                VALUES
                    (:trace_id, :span_id, :parent_span_id, :service, :instance, :name,
                     :start_time, :end_time, :duration_ms, :status, :span_kind, CAST(:attributes AS jsonb), CAST(:events AS jsonb))
                ON CONFLICT (trace_id, span_id, start_time) DO NOTHING
            """),
            span_rows,
        )

    if error_rows:
        await db.execute(
            text("""
                INSERT INTO errors
                    (service, instance, error_type, message, stack_trace,
                     trace_id, span_id, attributes)
                VALUES
                    (:service, :instance, :error_type, :message, :stack_trace,
                     :trace_id, :span_id, CAST(:attributes AS jsonb))
            """),
            error_rows,
        )

    if span_rows or error_rows:
        await db.commit()
        
        # Broadcast updated error stats if new errors were ingested
        if error_rows:
            try:
                from app.core.websocket import manager
                from app.services.errors_service import get_error_stats
                stats = await get_error_stats(db, None, "1h")
                await manager.broadcast({
                    "type": "update",
                    "unresolved": stats.get("unresolved", 0)
                })
            except Exception as e:
                logger.error(f"Failed to broadcast error update: {e}")

    logger.info(f"[Traces] 스팬 저장: {len(span_rows)}개 | 에러: {len(error_rows)}개")
    return len(span_rows)


# ─────────────────────────────────────────────
# 로그 처리
# ─────────────────────────────────────────────

# severity_number → 레벨 문자열
_SEVERITY_MAP = [
    (4,  "TRACE"),
    (8,  "DEBUG"),
    (12, "INFO"),
    (16, "WARN"),
    (20, "ERROR"),
    (24, "FATAL"),
]


def _severity_to_level(sev: int) -> str:
    for threshold, level in _SEVERITY_MAP:
        if sev <= threshold:
            return level
    return "FATAL"


async def process_logs(db: AsyncSession, body: bytes) -> int:
    """OTLP Logs protobuf 파싱 → logs 테이블 저장"""
    from opentelemetry.proto.collector.logs.v1.logs_service_pb2 import (
        ExportLogsServiceRequest,
    )

    req = ExportLogsServiceRequest()
    req.ParseFromString(body)

    rows: List[Dict] = []
    services_seen = set()

    for rl in req.resource_logs:
        resource_attrs = _extract_attrs(rl.resource.attributes)
        service = resource_attrs.get("service.name", "unknown")
        instance = resource_attrs.get("service.instance.id", "default")

        if service not in services_seen:
            await _upsert_service(db, service)
            services_seen.add(service)

        for sl in rl.scope_logs:
            for log in sl.log_records:
                level = _severity_to_level(log.severity_number)

                body_kind = log.body.WhichOneof("value")
                body_text = (
                    log.body.string_value if body_kind == "string_value"
                    else str(log.body)
                )

                ts_ns = log.time_unix_nano or log.observed_time_unix_nano

                rows.append({
                    "time": _ns_to_dt(ts_ns),
                    "service": service,
                    "instance": instance,
                    "level": level,
                    "body": body_text,
                    "trace_id": _bytes_to_hex(log.trace_id),
                    "span_id": _bytes_to_hex(log.span_id),
                    "attributes": json.dumps(_extract_attrs(log.attributes)),
                })

    if rows:
        await db.execute(
            text("""
                INSERT INTO logs
                    (time, service, instance, level, body, trace_id, span_id, attributes)
                VALUES
                    (:time, :service, :instance, :level, :body, :trace_id, :span_id, CAST(:attributes AS jsonb))
            """),
            rows,
        )
        await db.commit()

    logger.info(f"[Logs] 저장: {len(rows)}개")
    return len(rows)
