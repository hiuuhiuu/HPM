#!/usr/bin/env python3
"""
JEUS 8 연동 샘플 시뮬레이터

실제 JEUS 인스턴스 없이 이 APM에 트레이스·메트릭을 전송합니다.
OTel Java Agent가 JEUS에 붙었을 때와 동일한 데이터 구조를 재현하므로
연동 구성 검증 후 실제 JEUS에 -javaagent 옵션만 추가하면 됩니다.

메서드 후킹 시뮬레이션:
  hamster-methods.conf 에 등록된 클래스/메서드와 동일한 이름의
  INTERNAL 스팬을 생성합니다. 트레이싱 > 콜 트리 뷰에서 확인하세요.
"""
import json
import os
import time
import random
import threading
import logging
import urllib.request
import urllib.error
from contextlib import contextmanager
from datetime import datetime

from opentelemetry import trace, metrics
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
from opentelemetry.sdk.resources import Resource
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.trace import SpanKind, StatusCode

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("jeus-sim")

# ── 환경 변수 ───────────────────────────────────────────
OTLP = os.getenv("OTLP_ENDPOINT",      "http://backend:8000/otlp")
SVC  = os.getenv("SERVICE_NAME",       "jeus-sample")
INST = os.getenv("SERVICE_INSTANCE_ID","jeus8-node1")

# ── OTel 리소스 (JEUS 8 / JDK 8처럼 표시) ─────────────
resource = Resource.create({
    "service.name":            SVC,
    "service.instance.id":     INST,
    "telemetry.sdk.language":  "java",
    "process.runtime.name":    "OpenJDK Runtime Environment",
    "process.runtime.version": "1.8.0_392",
})

# ── 트레이서 ───────────────────────────────────────────
_tp = TracerProvider(resource=resource)
_tp.add_span_processor(
    BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{OTLP}/v1/traces"))
)
trace.set_tracer_provider(_tp)
tracer = trace.get_tracer("jeus.sample")

# ── 멀티 서비스 토폴로지용 TracerProvider ──────────────
_TOPO_SERVICES = [
    "api-gateway",
    "order-service",
    "payment-service",
    "inventory-service",
    "notification-service",
    "user-service",
    "cache-service",
]
_topo_tracers: dict = {}

def _make_topo_tracer(svc_name: str, instance_id: str = ""):
    res = Resource.create({
        "service.name":           svc_name,
        "service.instance.id":    instance_id or f"{svc_name}-node1",
        "telemetry.sdk.language": "python",
    })
    tp = TracerProvider(resource=res)
    tp.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=f"{OTLP}/v1/traces"))
    )
    return tp.get_tracer(svc_name)

# ── 시뮬레이션 상태 ──────────────────────────────────
_s = {
    "heap_mb":    256,
    "threads":    20,
    "tp_active":  5,
    "jcp_active": 2,
    "cpu_pct":    0.25,
    "gc_count":   0,
    "gc_time_ms": 0,
    "heap_eden":  100,
    "heap_old":   120,
    "heap_surv":  36,
}

def _fluct(v, lo, hi, d=5):
    return max(lo, min(hi, v + random.randint(-d, d)))


# ── 메서드 스팬 헬퍼 ─────────────────────────────────
# hamster-methods.conf 에 등록된 클래스.메서드와 동일한 이름으로 스팬 생성

@contextmanager
def method_span(class_name: str, method: str, extra_attrs: dict | None = None):
    """INTERNAL 스팬 — hamster-methods.conf 후킹된 메서드 시뮬레이션.
    자식 스팬에서 예외가 발생하면 이 스팬도 ERROR로 표시하고 상위로 재전파한다."""
    short = class_name.split(".")[-1]  # OrderController
    span_name = f"{short}.{method}"
    with tracer.start_as_current_span(
        span_name,
        kind=SpanKind.INTERNAL,
        attributes={
            "code.namespace": class_name,
            "code.function":  method,
            **(extra_attrs or {}),
        },
        record_exception=False,  # exception event는 실제 발생 지점(JDBC)에서만 기록
    ) as span:
        try:
            yield span
        except Exception as e:
            span.set_status(StatusCode.ERROR, str(e))
            raise


# ── JDBC 예외 헬퍼 ───────────────────────────────────
def _raise_jdbc_exception(db_span, java_type: str, message: str, at_line: str):
    """
    JDBC 스팬에 OTel exception event를 기록하고 Python 예외를 발생시켜
    상위 method_span 들이 ERROR status를 전파하도록 한다.
    """
    stacktrace = (
        f"{java_type}: {message}\n"
        f"  at {at_line}\n"
        f"  at com.example.service.OrderService.<method>(OrderService.java:82)\n"
        f"  at com.example.controller.OrderController.<method>(OrderController.java:31)\n"
        f"  at org.springframework.web.servlet.FrameworkServlet.processRequest(FrameworkServlet.java:1014)\n"
        f"  at org.springframework.web.servlet.DispatcherServlet.doPost(DispatcherServlet.java:952)"
    )
    db_span.add_event("exception", {
        "exception.type":       java_type,
        "exception.message":    message,
        "exception.stacktrace": stacktrace,
    })
    db_span.set_status(StatusCode.ERROR, java_type)
    raise RuntimeError(f"{java_type}: {message}")


# ── 엔드포인트 시나리오 ──────────────────────────────
# (HTTP 메서드, 경로, 최소ms, 최대ms, 에러율, 핸들러)
def _handle_get_orders(is_err: bool, total_ms: int):
    """GET /api/orders → OrderController.getOrders → OrderService.findActiveOrders → DAO"""
    with method_span("com.example.controller.OrderController", "getOrders"):
        svc_ms = int(total_ms * 0.15)
        time.sleep(svc_ms / 1000)
        with method_span("com.example.service.OrderService", "findActiveOrders"):
            db_ms = int(total_ms * 0.55)
            with method_span("com.example.dao.OrderDao", "findByStatus"):
                with tracer.start_as_current_span(
                    "JDBC.execute", kind=SpanKind.CLIENT,
                    attributes={
                        "db.system":    "oracle",
                        "db.name":      "mydb",
                        "db.operation": "SELECT",
                        "db.statement": "SELECT * FROM orders WHERE status = ?",
                    }
                ) as db_span:
                    time.sleep(db_ms / 1000)
                    if is_err:
                        _raise_jdbc_exception(
                            db_span,
                            "java.sql.SQLTimeoutException",
                            "Query execution timed out after 30000ms",
                            "com.example.dao.OrderDao.findByStatus(OrderDao.java:67)",
                        )
            time.sleep(max(0, int(total_ms * 0.2)) / 1000)


def _handle_get_order(is_err: bool, total_ms: int):
    """GET /api/orders/{id} → OrderController.getOrder → OrderService.findById → DAO"""
    with method_span("com.example.controller.OrderController", "getOrder"):
        time.sleep(int(total_ms * 0.1) / 1000)
        with method_span("com.example.service.OrderService", "findById"):
            db_ms = int(total_ms * 0.6)
            with method_span("com.example.dao.OrderDao", "findById"):
                with tracer.start_as_current_span(
                    "JDBC.execute", kind=SpanKind.CLIENT,
                    attributes={
                        "db.system":    "oracle",
                        "db.name":      "mydb",
                        "db.operation": "SELECT",
                        "db.statement": "SELECT * FROM orders WHERE id = ?",
                    }
                ) as db_span:
                    time.sleep(db_ms / 1000)
                    if is_err:
                        _raise_jdbc_exception(
                            db_span,
                            "java.sql.SQLTimeoutException",
                            "Timeout waiting for connection from pool (30000ms)",
                            "com.example.dao.OrderDao.findById(OrderDao.java:45)",
                        )
            time.sleep(int(total_ms * 0.2) / 1000)


def _handle_post_order(is_err: bool, total_ms: int):
    """POST /api/orders → OrderController.createOrder → Service(validate+process) → DAO"""
    with method_span("com.example.controller.OrderController", "createOrder"):
        time.sleep(int(total_ms * 0.05) / 1000)
        with method_span("com.example.service.OrderService", "process"):
            # 1) 유효성 검사
            with method_span("com.example.service.OrderValidator", "validate"):
                time.sleep(int(total_ms * 0.1) / 1000)

            # 2) DB INSERT
            db_ms = int(total_ms * 0.35)
            with method_span("com.example.dao.OrderDao", "insert"):
                with tracer.start_as_current_span(
                    "JDBC.execute", kind=SpanKind.CLIENT,
                    attributes={
                        "db.system":    "oracle",
                        "db.name":      "mydb",
                        "db.operation": "INSERT",
                        "db.statement": "INSERT INTO orders (customer_id, product_id, amount, status) VALUES (?, ?, ?, ?)",
                    }
                ) as db_span:
                    time.sleep(db_ms / 1000)
                    if is_err:
                        _raise_jdbc_exception(
                            db_span,
                            "java.sql.SQLIntegrityConstraintViolationException",
                            "Duplicate entry for key 'order_no'",
                            "com.example.dao.OrderDao.insert(OrderDao.java:89)",
                        )

            # 3) 알림 (에러 없을 때)
            if not is_err:
                with method_span("com.example.service.NotificationService", "sendConfirm"):
                    time.sleep(int(total_ms * 0.15) / 1000)

            time.sleep(int(total_ms * 0.1) / 1000)


def _handle_get_customers(is_err: bool, total_ms: int):
    """GET /api/customers → CustomerController.getCustomers → Service → DAO"""
    with method_span("com.example.controller.CustomerController", "getCustomers"):
        time.sleep(int(total_ms * 0.1) / 1000)
        with method_span("com.example.service.CustomerService", "findAll"):
            db_ms = int(total_ms * 0.65)
            with method_span("com.example.dao.CustomerDao", "findAll"):
                with tracer.start_as_current_span(
                    "JDBC.execute", kind=SpanKind.CLIENT,
                    attributes={
                        "db.system":    "oracle",
                        "db.name":      "mydb",
                        "db.operation": "SELECT",
                        "db.statement": "SELECT * FROM customers LIMIT 100",
                    }
                ):
                    time.sleep(db_ms / 1000)
            time.sleep(int(total_ms * 0.15) / 1000)


def _handle_get_customer(is_err: bool, total_ms: int):
    """GET /api/customers/{id} → CustomerController.getCustomer → Service → DAO"""
    with method_span("com.example.controller.CustomerController", "getCustomer"):
        time.sleep(int(total_ms * 0.1) / 1000)
        with method_span("com.example.service.CustomerService", "findById"):
            db_ms = int(total_ms * 0.6)
            with method_span("com.example.dao.CustomerDao", "findById"):
                with tracer.start_as_current_span(
                    "JDBC.execute", kind=SpanKind.CLIENT,
                    attributes={
                        "db.system":    "oracle",
                        "db.name":      "mydb",
                        "db.operation": "SELECT",
                        "db.statement": "SELECT * FROM customers WHERE id = ?",
                    }
                ):
                    time.sleep(db_ms / 1000)
            time.sleep(int(total_ms * 0.2) / 1000)


def _handle_get_products(is_err: bool, total_ms: int):
    """GET /api/products → ProductController.getProducts → ProductService → DAO"""
    with method_span("com.example.controller.ProductController", "getProducts"):
        time.sleep(int(total_ms * 0.08) / 1000)
        with method_span("com.example.service.ProductService", "findAvailable"):
            db_ms = int(total_ms * 0.7)
            with method_span("com.example.dao.ProductDao", "findActive"):
                with tracer.start_as_current_span(
                    "JDBC.execute", kind=SpanKind.CLIENT,
                    attributes={
                        "db.system":    "oracle",
                        "db.name":      "mydb",
                        "db.operation": "SELECT",
                        "db.statement": "SELECT * FROM products WHERE active = TRUE",
                    }
                ):
                    time.sleep(db_ms / 1000)
            time.sleep(int(total_ms * 0.15) / 1000)


def _handle_health(_is_err: bool, total_ms: int):
    with tracer.start_as_current_span(
        "JDBC.execute", kind=SpanKind.CLIENT,
        attributes={"db.system": "oracle", "db.statement": "SELECT 1"}
    ):
        time.sleep(total_ms / 1000)


# 엔드포인트 → (HTTP 메서드, 경로, 최소ms, 최대ms, 에러율, 핸들러)
def _handle_batch_order(is_err: bool, total_ms: int):
    """대량 주문 일괄 처리 — 5~12초 소요, DB Lock 경합 시뮬레이션"""
    with method_span("com.example.controller.OrderController", "batchCreateOrders"):
        with method_span("com.example.service.OrderService", "processBatch"):
            batch_size = random.randint(50, 200)
            chunk_ms = total_ms // max(batch_size // 10, 1)
            for i in range(min(batch_size // 10, 8)):
                with method_span("com.example.dao.OrderDao", "insertBatch",
                                 {"batch.chunk": str(i), "batch.size": str(batch_size)}):
                    with tracer.start_as_current_span(
                        "INSERT batch orders", kind=SpanKind.CLIENT,
                        attributes={"db.system": "postgresql", "db.statement": "INSERT INTO orders ..."}
                    ):
                        time.sleep(chunk_ms / 1000)
                        if is_err and i == batch_size // 20:
                            raise RuntimeError("java.sql.BatchUpdateException: Deadlock detected")


def _handle_report_export(is_err: bool, total_ms: int):
    """리포트 생성/내보내기 — 8~20초 소요"""
    with method_span("com.example.controller.OrderController", "exportReport"):
        with method_span("com.example.service.OrderService", "generateReport"):
            time.sleep(total_ms * 0.3 / 1000)
            with method_span("com.example.service.OrderService", "aggregateData"):
                with tracer.start_as_current_span(
                    "SELECT aggregate report", kind=SpanKind.CLIENT,
                    attributes={"db.system": "postgresql",
                                "db.statement": "SELECT ... GROUP BY ... HAVING ..."}
                ):
                    time.sleep(total_ms * 0.4 / 1000)
            with method_span("com.example.service.NotificationService", "sendConfirm"):
                time.sleep(total_ms * 0.2 / 1000)
            time.sleep(total_ms * 0.1 / 1000)


def _handle_external_sync(is_err: bool, total_ms: int):
    """외부 시스템 동기화 — 3~8초 소요, 외부 API 응답 대기"""
    with method_span("com.example.controller.CustomerController", "syncExternal"):
        with method_span("com.example.service.CustomerService", "fetchFromExternal"):
            with tracer.start_as_current_span(
                "HTTP GET https://external-crm.bank.co.kr/api/sync", kind=SpanKind.CLIENT,
                attributes={"http.method": "GET",
                             "http.url": "https://external-crm.bank.co.kr/api/sync",
                             "net.peer.name": "external-crm.bank.co.kr"}
            ):
                time.sleep(total_ms * 0.7 / 1000)
                if is_err:
                    raise RuntimeError("java.net.SocketTimeoutException: Read timed out")
            time.sleep(total_ms * 0.3 / 1000)


ENDPOINTS = [
    ("GET",  "/api/orders",           120, 300, 0.05, _handle_get_orders),
    ("GET",  "/api/orders/{id}",       60, 150, 0.03, _handle_get_order),
    ("POST", "/api/orders",           200, 500, 0.08, _handle_post_order),
    ("GET",  "/api/customers",         50, 200, 0.02, _handle_get_customers),
    ("GET",  "/api/customers/{id}",    40, 120, 0.02, _handle_get_customer),
    ("GET",  "/api/products",          30, 100, 0.01, _handle_get_products),
    ("GET",  "/api/health",             5,  20, 0.00, _handle_health),
    # 느린 거래 (활성 거래 패널 확인용)
    ("POST", "/api/orders/batch",    5000,12000, 0.10, _handle_batch_order),
    ("GET",  "/api/reports/export",  8000,20000, 0.05, _handle_report_export),
    ("POST", "/api/customers/sync",  3000, 8000, 0.15, _handle_external_sync),
]


# ── 활성 거래 비콘 (에이전트 동작 시뮬레이션) ───────────────
_active_txns_lock = threading.Lock()
_active_txns: dict = {}  # span_name → {"trace_id", "span_name", "started_at", "start_ms"}

def _register_active(span_name: str, trace_id: str):
    with _active_txns_lock:
        _active_txns[span_name + trace_id] = {
            "trace_id": trace_id,
            "span_name": span_name,
            "started_at": datetime.utcnow().isoformat() + "Z",
            "start_ms": time.time() * 1000,
        }

def _unregister_active(span_name: str, trace_id: str):
    with _active_txns_lock:
        _active_txns.pop(span_name + trace_id, None)

def _beacon_loop():
    """3초마다 현재 활성 거래를 APM 서버에 비콘 전송"""
    beacon_url = OTLP.replace("/otlp", "") + "/api/dashboard/active-transactions/beacon"
    log.info(f"활성 거래 비콘 시작 → {beacon_url}")
    while True:
        time.sleep(3)
        try:
            now_ms = time.time() * 1000
            with _active_txns_lock:
                txns = [
                    {
                        "trace_id": v["trace_id"],
                        "span_name": v["span_name"],
                        "duration_ms": round(now_ms - v["start_ms"], 1),
                        "status": "OK",
                        "started_at": v["started_at"],
                    }
                    for v in _active_txns.values()
                ]
            payload = json.dumps({"service": SVC, "instance": INST, "transactions": txns})
            req = urllib.request.Request(
                beacon_url,
                data=payload.encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=3)
        except Exception:
            pass


def _simulate_request():
    method, path, lo, hi, err_rate, handler = random.choice(ENDPOINTS)
    is_err   = random.random() < err_rate
    total_ms = int(random.randint(lo, hi) * (1.8 if is_err else 1.0))

    span_label = f"{method} {path}"
    with tracer.start_as_current_span(
        span_label,
        kind=SpanKind.SERVER,
        attributes={
            "http.method":      method,
            "http.target":      path,
            "http.scheme":      "http",
            "http.host":        f"{INST}:8180",
            "http.status_code": 200,
            "net.host.name":    INST,
            "net.host.port":    8180,
        },
    ) as root:
        trace_id = root.get_span_context().trace_id
        trace_id_hex = format(trace_id, '032x')
        _register_active(span_label, trace_id_hex)
        try:
            handler(is_err, total_ms)
        except RuntimeError as e:
            # 하위 method_span 에서 전파된 예외 — 루트 스팬에 500 표시
            root.set_status(StatusCode.ERROR, "Internal Server Error")
            root.set_attribute("http.status_code", 500)
            root.add_event("exception", {
                "exception.type":    "javax.servlet.ServletException",
                "exception.message": f"Request processing failed; nested exception is {e}",
            })
            log.warning(f"ERROR  {method:4} {path} ({total_ms}ms)")
            _unregister_active(span_label, trace_id_hex)
            return
        except Exception:
            pass
        finally:
            _unregister_active(span_label, trace_id_hex)

        if is_err:
            root.set_status(StatusCode.ERROR, "Internal Server Error")
            root.set_attribute("http.status_code",  500)
            log.warning(f"ERROR  {method:4} {path} ({total_ms}ms)")
        else:
            if random.random() < 0.1:
                log.error(f"실제로는 에러가 발생했으나 스팬 status가 OK인 경우 시뮬레이션: {path}")
            log.info(f"OK     {method:4} {path} ({total_ms}ms)")


# ── 멀티 서비스 토폴로지 ─────────────────────────────

def _child_span(tracer_obj, name: str, parent_ctx, ms: int, err: bool, kind=SpanKind.SERVER):
    span = tracer_obj.start_span(name, context=parent_ctx, kind=kind)
    time.sleep(ms / 1000)
    if err:
        span.set_status(StatusCode.ERROR, "downstream error")
        span.set_attribute("exception.type", "DownstreamServiceException")
        span.set_attribute("exception.message", "downstream error")
    span.end()
    return trace.set_span_in_context(span)


def _simulate_chain():
    gw   = _topo_tracers["api-gateway"]
    ord1 = _topo_tracers["order-service"]
    ord2 = _topo_tracers["order-service-node2"]
    pay  = _topo_tracers["payment-service"]
    inv  = _topo_tracers["inventory-service"]
    ntf  = _topo_tracers["notification-service"]
    usr  = _topo_tracers["user-service"]
    cac  = _topo_tracers["cache-service"]

    scenario = random.choices(
        ["order_flow", "order_node2_flow", "user_flow", "inventory_check", "order_cancel"],
        weights=[35, 25, 20, 12, 8],
    )[0]

    is_err = random.random() < 0.06

    if scenario == "order_flow":
        gw_span  = gw.start_span("POST /api/orders", kind=SpanKind.SERVER)
        gw_ctx   = trace.set_span_in_context(gw_span)
        time.sleep(random.randint(5, 20) / 1000)

        ord_span = ord1.start_span("order-service: createOrder", context=gw_ctx, kind=SpanKind.SERVER)
        ord_ctx  = trace.set_span_in_context(ord_span)
        time.sleep(random.randint(30, 80) / 1000)

        pay_err  = is_err and random.random() < 0.7
        pay_span = pay.start_span("payment-service: processPayment", context=ord_ctx, kind=SpanKind.SERVER)
        pay_ctx  = trace.set_span_in_context(pay_span)
        time.sleep(random.randint(50, 150) / 1000)
        if pay_err:
            pay_span.set_status(StatusCode.ERROR, "payment declined")
            pay_span.set_attribute("exception.type", "PaymentDeclinedException")
            pay_span.set_attribute("exception.message", "payment declined")
        pay_span.end()

        if not pay_err:
            ntf_span = ntf.start_span("notification-service: sendOrderConfirm", context=pay_ctx, kind=SpanKind.SERVER)
            time.sleep(random.randint(10, 30) / 1000)
            ntf_span.end()

        inv_span = inv.start_span("inventory-service: reserveStock", context=ord_ctx, kind=SpanKind.SERVER)
        time.sleep(random.randint(15, 40) / 1000)
        inv_span.end()

        if pay_err:
            ord_span.set_status(StatusCode.ERROR, "payment failed")
            ord_span.set_attribute("exception.type", "PaymentFailedException")
            ord_span.set_attribute("exception.message", "payment failed")
            gw_span.set_status(StatusCode.ERROR, "order failed")
            gw_span.set_attribute("exception.type", "OrderProcessingException")
            gw_span.set_attribute("exception.message", "order failed")
        ord_span.end()
        gw_span.end()
        log.info(f"[topo] order_flow(node1) {'ERR' if pay_err else 'OK'}")

    elif scenario == "order_node2_flow":
        gw_span  = gw.start_span("POST /api/orders", kind=SpanKind.SERVER)
        gw_ctx   = trace.set_span_in_context(gw_span)
        time.sleep(random.randint(5, 15) / 1000)

        ord_span = ord2.start_span("order-service: createOrder", context=gw_ctx, kind=SpanKind.SERVER)
        ord_ctx  = trace.set_span_in_context(ord_span)
        time.sleep(random.randint(20, 60) / 1000)

        cac_span = cac.start_span("cache-service: getOrderCache", context=ord_ctx, kind=SpanKind.SERVER)
        time.sleep(random.randint(5, 20) / 1000)
        cac_span.end()

        pay_err  = is_err and random.random() < 0.5
        pay_span = pay.start_span("payment-service: processPayment", context=ord_ctx, kind=SpanKind.SERVER)
        time.sleep(random.randint(50, 130) / 1000)
        if pay_err:
            pay_span.set_status(StatusCode.ERROR, "payment declined")
            pay_span.set_attribute("exception.type", "PaymentDeclinedException")
            pay_span.set_attribute("exception.message", "payment declined")
        pay_span.end()

        if pay_err:
            ord_span.set_status(StatusCode.ERROR, "payment failed")
            ord_span.set_attribute("exception.type", "PaymentFailedException")
            ord_span.set_attribute("exception.message", "payment failed")
            gw_span.set_status(StatusCode.ERROR, "order failed")
            gw_span.set_attribute("exception.type", "OrderProcessingException")
            gw_span.set_attribute("exception.message", "order failed")
        ord_span.end()
        gw_span.end()
        log.info(f"[topo] order_flow(node2) {'ERR' if pay_err else 'OK'}")

    elif scenario == "user_flow":
        gw_span  = gw.start_span("GET /api/users/{id}", kind=SpanKind.SERVER)
        gw_ctx   = trace.set_span_in_context(gw_span)
        time.sleep(random.randint(5, 15) / 1000)

        usr_err  = is_err
        usr_span = usr.start_span("user-service: getUser", context=gw_ctx, kind=SpanKind.SERVER)
        time.sleep(random.randint(20, 60) / 1000)
        if usr_err:
            usr_span.set_status(StatusCode.ERROR, "user not found")
            usr_span.set_attribute("exception.type", "UserNotFoundException")
            usr_span.set_attribute("exception.message", "user not found")
            gw_span.set_status(StatusCode.ERROR, "404")
            gw_span.set_attribute("exception.type", "NotFoundException")
            gw_span.set_attribute("exception.message", "user not found")
        usr_span.end()
        gw_span.end()
        log.info(f"[topo] user_flow {'ERR' if usr_err else 'OK'}")

    elif scenario == "inventory_check":
        ord_span = ord1.start_span("order-service: checkStock", kind=SpanKind.SERVER)
        ord_ctx  = trace.set_span_in_context(ord_span)
        time.sleep(random.randint(10, 30) / 1000)

        inv_span = inv.start_span("inventory-service: getStock", context=ord_ctx, kind=SpanKind.SERVER)
        inv_ctx  = trace.set_span_in_context(inv_span)
        time.sleep(random.randint(20, 50) / 1000)
        inv_span.end()

        if random.random() < 0.3:
            cb_span = ord1.start_span("order-service: stockCallback", context=inv_ctx, kind=SpanKind.SERVER)
            time.sleep(random.randint(5, 15) / 1000)
            cb_span.end()

        ord_span.end()
        log.info("[topo] inventory_check OK")

    else:  # order_cancel
        gw_span  = gw.start_span("DELETE /api/orders/{id}", kind=SpanKind.SERVER)
        gw_ctx   = trace.set_span_in_context(gw_span)
        time.sleep(random.randint(5, 10) / 1000)

        ord_span = ord1.start_span("order-service: cancelOrder", context=gw_ctx, kind=SpanKind.SERVER)
        ord_ctx  = trace.set_span_in_context(ord_span)
        time.sleep(random.randint(20, 40) / 1000)

        inv_span = inv.start_span("inventory-service: restoreStock", context=ord_ctx, kind=SpanKind.SERVER)
        time.sleep(random.randint(15, 35) / 1000)
        inv_span.end()

        ord_span.end()
        gw_span.end()
        log.info("[topo] order_cancel OK")


def _topology_loop():
    log.info("토폴로지 트래픽 생성 시작")
    while True:
        try:
            _simulate_chain()
        except Exception as e:
            log.error(f"토폴로지 시뮬레이션 오류: {e}")
        time.sleep(random.uniform(0.5, 2.0))


def _state_loop():
    while True:
        time.sleep(30)
        _s["heap_mb"]    = _fluct(_s["heap_mb"],    128, 450, 20)
        _s["threads"]    = _fluct(_s["threads"],      15,  80,  3)
        _s["tp_active"]  = _fluct(_s["tp_active"],     0,  50,  5)
        _s["jcp_active"] = _fluct(_s["jcp_active"],    0,  10,  2)
        _s["cpu_pct"]    = max(0.05, min(0.90, _s["cpu_pct"] + random.uniform(-0.05, 0.05)))

        if random.random() < 0.3:
            inc = random.randint(1, 3)
            _s["gc_count"] += inc
            _s["gc_time_ms"] += inc * random.randint(50, 200)
            _s["heap_eden"] = 20
            _s["heap_old"] = min(400, _s["heap_old"] + random.randint(5, 15))
        else:
            _s["heap_eden"] = _fluct(_s["heap_eden"], 20, 200, 15)
            _s["heap_surv"] = _fluct(_s["heap_surv"], 10, 50, 2)

        _s["heap_mb"] = _s["heap_eden"] + _s["heap_old"] + _s["heap_surv"]


def _traffic_loop():
    log.info("트래픽 생성 시작 (메서드 후킹 스팬 포함)")
    while True:
        try:
            _simulate_request()
        except Exception as e:
            log.error(f"시뮬레이션 오류: {e}")
        time.sleep(random.uniform(0.3, 1.5))


def _setup_metrics():
    reader = PeriodicExportingMetricReader(
        OTLPMetricExporter(endpoint=f"{OTLP}/v1/metrics"),
        export_interval_millis=30_000,
    )
    mp = MeterProvider(resource=resource, metric_readers=[reader])
    metrics.set_meter_provider(mp)

    m = metrics.get_meter("jeus.sample.metrics")

    m.create_observable_gauge(
        "jvm.cpu.usage", unit="1", description="JVM CPU Usage",
        callbacks=[lambda _: [metrics.Observation(_s["cpu_pct"])]],
    )
    m.create_observable_gauge(
        "jvm.memory.heap.used", unit="By", description="JVM Heap Used",
        callbacks=[lambda _: [metrics.Observation(_s["heap_mb"] * 1_048_576)]],
    )
    m.create_observable_gauge(
        "jvm.memory.heap.max", unit="By", description="JVM Heap Max",
        callbacks=[lambda _: [metrics.Observation(512 * 1_048_576)]],
    )

    def pool_cb(_):
        return [
            metrics.Observation(_s["heap_eden"] * 1048576, {"jvm.memory.pool.name": "G1 Eden Space"}),
            metrics.Observation(_s["heap_surv"] * 1048576, {"jvm.memory.pool.name": "G1 Survivor Space"}),
            metrics.Observation(_s["heap_old"] * 1048576,  {"jvm.memory.pool.name": "G1 Old Gen"}),
        ]
    m.create_observable_gauge(
        "jvm.memory.used", unit="By", description="JVM Memory Pool Used",
        callbacks=[pool_cb]
    )

    m.create_observable_gauge(
        "jvm.gc.duration", unit="ms", description="GC Duration",
        callbacks=[lambda _: [metrics.Observation(_s["gc_time_ms"])]]
    )
    m.create_observable_gauge(
        "jvm.gc.count", unit="1", description="GC Count",
        callbacks=[lambda _: [metrics.Observation(_s["gc_count"])]]
    )
    m.create_observable_gauge(
        "jvm.threads.count", unit="{threads}", description="JVM Thread Count",
        callbacks=[lambda _: [metrics.Observation(_s["threads"])]],
    )
    m.create_observable_gauge(
        "jeus.threadpool.active", unit="{threads}", description="JEUS Active Threads",
        callbacks=[lambda _: [metrics.Observation(_s["tp_active"], {"pool.name": "default"})]],
    )
    m.create_observable_gauge(
        "jeus.threadpool.idle", unit="{threads}", description="JEUS Idle Threads",
        callbacks=[lambda _: [metrics.Observation(
            max(0, 50 - _s["tp_active"]), {"pool.name": "default"}
        )]],
    )
    m.create_observable_gauge(
        "jeus.threadpool.max", unit="{threads}", description="JEUS Max Thread Pool",
        callbacks=[lambda _: [metrics.Observation(50, {"pool.name": "default"})]],
    )
    m.create_observable_gauge(
        "jeus.jcp.active", unit="{connections}", description="JCP Active Connections",
        callbacks=[lambda _: [metrics.Observation(
            _s["jcp_active"], {"pool.name": "myDataSource"}
        )]],
    )
    m.create_observable_gauge(
        "jeus.jcp.idle", unit="{connections}", description="JCP Idle Connections",
        callbacks=[lambda _: [metrics.Observation(
            max(0, 10 - _s["jcp_active"]), {"pool.name": "myDataSource"}
        )]],
    )
    m.create_observable_gauge(
        "jeus.jcp.wait", unit="{requests}", description="JCP Wait Count",
        callbacks=[lambda _: [metrics.Observation(
            1 if _s["jcp_active"] >= 10 else 0, {"pool.name": "myDataSource"}
        )]],
    )


def _wait_for_backend(max_retries: int = 30, delay: int = 5) -> None:
    health_url = OTLP.replace("/otlp", "") + "/"
    for i in range(max_retries):
        try:
            urllib.request.urlopen(health_url, timeout=3)
            log.info("백엔드 연결 확인 완료")
            return
        except Exception:
            log.info(f"백엔드 대기 중... ({i + 1}/{max_retries})")
            time.sleep(delay)
    log.warning("백엔드 응답 없음, 시뮬레이션 시작")


def _dump_loop():
    log.info("스레드 덤프 폴링 루프 시작")
    pending_url = OTLP.replace("/otlp", "/api/thread-dumps/pending") + f"?instance={INST}"
    result_url  = OTLP.replace("/otlp", "/api/thread-dumps/result")

    while True:
        try:
            with urllib.request.urlopen(pending_url, timeout=3) as res:
                data = json.loads(res.read().decode())
                if data and "id" in data:
                    req_id = data["id"]
                    log.info(f"[Dump] 요청 수신 (ID: {req_id})")
                    dump = _generate_mock_dump()
                    req = urllib.request.Request(
                        result_url,
                        data=json.dumps({"request_id": req_id, "dump_text": dump}).encode(),
                        headers={"Content-Type": "application/json"}
                    )
                    with urllib.request.urlopen(req, timeout=3):
                        log.info(f"[Dump] 제출 완료 (ID: {req_id})")
        except Exception:
            pass
        time.sleep(3)


def _generate_mock_dump():
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    header = f"Full thread dump {INST} ({ts}):\n\n"
    threads = []

    # Active HTTP 스레드 — 비즈니스 메서드 스택 포함
    method_stacks = [
        [
            f'"http-thread-{i}" #5{i} prio=5 os_prio=0 tid=0x00007f nid=0x12{i} runnable',
            "   java.lang.Thread.State: RUNNABLE",
            f"   at com.example.dao.OrderDao.findByStatus(OrderDao.java:{random.randint(80, 200)})",
            f"   at com.example.service.OrderService.findActiveOrders(OrderService.java:{random.randint(50, 150)})",
            f"   at com.example.controller.OrderController.getOrders(OrderController.java:{random.randint(30, 80)})",
            "   at sun.reflect.NativeMethodAccessorImpl.invoke0(Native Method)",
            "   at javax.servlet.http.HttpServlet.service(HttpServlet.java:790)",
        ],
        [
            f'"http-thread-{i+3}" #5{i+3} prio=5 os_prio=0 tid=0x00007f nid=0x13{i} runnable',
            "   java.lang.Thread.State: RUNNABLE",
            f"   at com.example.dao.OrderDao.insert(OrderDao.java:{random.randint(120, 250)})",
            f"   at com.example.service.OrderService.process(OrderService.java:{random.randint(70, 180)})",
            f"   at com.example.service.OrderValidator.validate(OrderValidator.java:{random.randint(20, 60)})",
            f"   at com.example.controller.OrderController.createOrder(OrderController.java:{random.randint(40, 90)})",
            "   at javax.servlet.http.HttpServlet.service(HttpServlet.java:790)",
        ],
    ]
    for i, stack in enumerate(method_stacks):
        threads.append("\n".join(stack))

    # Waiting 스레드
    for i in range(5):
        stack = [
            f'"JEUS-Thread-Pool-{i}" #1{i} prio=5 tid=0x00007f waiting on condition',
            "   java.lang.Thread.State: WAITING (parking)",
            "   at sun.misc.Unsafe.park(Native Method)",
            "   at java.util.concurrent.locks.LockSupport.park(LockSupport.java:175)",
            "   at java.util.concurrent.ThreadPoolExecutor.getTask(ThreadPoolExecutor.java:1074)",
        ]
        threads.append("\n".join(stack))

    return header + "\n\n".join(threads)


if __name__ == "__main__":
    log.info("JEUS 샘플 시뮬레이터 시작 (메서드 후킹 콜 트리 포함)")
    log.info(f"  service  = {SVC}")
    log.info(f"  instance = {INST}")
    log.info(f"  OTLP     = {OTLP}")
    log.info("  콜 트리: Controller → Service → DAO → JDBC 계층 구조 생성 중")

    _wait_for_backend()
    _setup_metrics()

    for svc in _TOPO_SERVICES:
        _topo_tracers[svc] = _make_topo_tracer(svc)
    _topo_tracers["order-service-node2"] = _make_topo_tracer("order-service", "order-service-node2")
    log.info(f"토폴로지 서비스 등록: {', '.join(_TOPO_SERVICES)} + order-service-node2")

    threading.Thread(target=_state_loop,    daemon=True).start()
    threading.Thread(target=_traffic_loop,  daemon=True).start()
    threading.Thread(target=_topology_loop, daemon=True).start()
    threading.Thread(target=_dump_loop,     daemon=True).start()
    threading.Thread(target=_beacon_loop,   daemon=True).start()

    while True:
        time.sleep(60)
