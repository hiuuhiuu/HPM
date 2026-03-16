"""
OTLP 데이터 전송 테스트 스크립트

Java Agent 없이 APM 서버의 수신 파이프라인을 검증합니다.

사용법:
  pip install opentelemetry-proto protobuf requests
  python scripts/test_otlp.py --host localhost --port 8000
"""
import argparse
import json
import random
import time

import requests
from opentelemetry.proto.collector.logs.v1.logs_service_pb2 import (
    ExportLogsServiceRequest,
)
from opentelemetry.proto.collector.metrics.v1.metrics_service_pb2 import (
    ExportMetricsServiceRequest,
)
from opentelemetry.proto.collector.trace.v1.trace_service_pb2 import (
    ExportTraceServiceRequest,
)
from opentelemetry.proto.common.v1.common_pb2 import AnyValue, KeyValue
from opentelemetry.proto.logs.v1.logs_pb2 import LogRecord, ResourceLogs, ScopeLogs
from opentelemetry.proto.metrics.v1.metrics_pb2 import (
    Gauge,
    Histogram,
    HistogramDataPoint,
    Metric,
    NumberDataPoint,
    ResourceMetrics,
    ScopeMetrics,
    Sum,
)
from opentelemetry.proto.resource.v1.resource_pb2 import Resource
from opentelemetry.proto.trace.v1.trace_pb2 import (
    ResourceSpans,
    ScopeSpans,
    Span,
    Status,
)

CONTENT_TYPE = "application/x-protobuf"


def make_resource(service_name: str, instance_id: str = "test-instance-01") -> Resource:
    return Resource(
        attributes=[
            KeyValue(key="service.name", value=AnyValue(string_value=service_name)),
            KeyValue(key="service.instance.id", value=AnyValue(string_value=instance_id)),
            KeyValue(key="service.version", value=AnyValue(string_value="1.0.0")),
        ]
    )


def now_ns() -> int:
    return int(time.time() * 1e9)


# ─────────────────────────────────────────────
# 메트릭 테스트 데이터
# ─────────────────────────────────────────────

def build_metrics_request(service: str) -> bytes:
    req = ExportMetricsServiceRequest()
    rm = req.resource_metrics.add()
    rm.resource.CopyFrom(make_resource(service))
    sm = rm.scope_metrics.add()

    ts = now_ns()

    # 1) JVM 메모리 사용량 (Gauge)
    m1 = sm.metrics.add()
    m1.name = "jvm.memory.used"
    m1.unit = "By"
    m1.gauge.CopyFrom(Gauge())
    dp1 = m1.gauge.data_points.add()
    dp1.time_unix_nano = ts
    dp1.as_double = random.uniform(50, 200) * 1024 * 1024  # 50~200MB
    dp1.attributes.append(
        KeyValue(key="jvm.memory.pool.name", value=AnyValue(string_value="heap"))
    )

    # 2) CPU 사용률 (Gauge)
    m2 = sm.metrics.add()
    m2.name = "jvm.cpu.usage"
    m2.unit = "1"
    m2.gauge.CopyFrom(Gauge())
    dp2 = m2.gauge.data_points.add()
    dp2.time_unix_nano = ts
    dp2.as_double = random.uniform(0.01, 0.85)

    # 3) HTTP 요청 처리 시간 (Histogram)
    m3 = sm.metrics.add()
    m3.name = "http.server.request.duration"
    m3.unit = "s"
    m3.histogram.CopyFrom(Histogram())
    hdp = m3.histogram.data_points.add()
    hdp.time_unix_nano = ts
    count = random.randint(10, 100)
    hdp.count = count
    hdp.sum = count * random.uniform(0.05, 0.5)
    hdp.explicit_bounds.extend([0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5])
    hdp.bucket_counts.extend([1, 2, 3, count - 10, 2, 1, 1, 0, 0, 0])
    hdp.attributes.append(
        KeyValue(key="http.method", value=AnyValue(string_value="GET"))
    )
    hdp.attributes.append(
        KeyValue(key="http.route", value=AnyValue(string_value="/api/users"))
    )

    # 4) 스레드 수 (Gauge)
    m4 = sm.metrics.add()
    m4.name = "jvm.threads.count"
    m4.unit = "{thread}"
    m4.gauge.CopyFrom(Gauge())
    dp4 = m4.gauge.data_points.add()
    dp4.time_unix_nano = ts
    dp4.as_double = random.randint(20, 80)

    return req.SerializeToString()


# ─────────────────────────────────────────────
# 트레이스 테스트 데이터
# ─────────────────────────────────────────────

def build_traces_request(service: str) -> bytes:
    req = ExportTraceServiceRequest()
    rs = req.resource_spans.add()
    rs.resource.CopyFrom(make_resource(service))
    ss = rs.scope_spans.add()

    trace_id = bytes(random.getrandbits(8) for _ in range(16))
    start_ns = now_ns() - int(random.uniform(0.05, 0.5) * 1e9)

    # 루트 스팬 (HTTP 요청)
    root_span = ss.spans.add()
    root_span.trace_id = trace_id
    root_span.span_id = bytes(random.getrandbits(8) for _ in range(8))
    root_span.name = "GET /api/orders"
    root_span.start_time_unix_nano = start_ns
    root_span.end_time_unix_nano = start_ns + int(0.3 * 1e9)
    root_span.kind = Span.SPAN_KIND_SERVER
    root_span.status.CopyFrom(Status(code=Status.STATUS_CODE_OK))
    root_span.attributes.extend([
        KeyValue(key="http.method", value=AnyValue(string_value="GET")),
        KeyValue(key="http.route", value=AnyValue(string_value="/api/orders")),
        KeyValue(key="http.status_code", value=AnyValue(int_value=200)),
        KeyValue(key="http.url", value=AnyValue(string_value="http://localhost:8080/api/orders")),
    ])

    # 자식 스팬 (DB 쿼리)
    db_span = ss.spans.add()
    db_span.trace_id = trace_id
    db_span.span_id = bytes(random.getrandbits(8) for _ in range(8))
    db_span.parent_span_id = root_span.span_id
    db_span.name = "SELECT orders"
    db_span.start_time_unix_nano = start_ns + int(0.01 * 1e9)
    db_span.end_time_unix_nano = start_ns + int(0.2 * 1e9)
    db_span.kind = Span.SPAN_KIND_CLIENT
    db_span.status.CopyFrom(Status(code=Status.STATUS_CODE_OK))
    db_span.attributes.extend([
        KeyValue(key="db.system", value=AnyValue(string_value="postgresql")),
        KeyValue(key="db.statement", value=AnyValue(string_value="SELECT * FROM orders WHERE user_id = ?")),
    ])

    # 에러 스팬 (5% 확률)
    if random.random() < 0.05:
        err_span = ss.spans.add()
        err_trace_id = bytes(random.getrandbits(8) for _ in range(16))
        err_span.trace_id = err_trace_id
        err_span.span_id = bytes(random.getrandbits(8) for _ in range(8))
        err_span.name = "POST /api/payments"
        err_span.start_time_unix_nano = now_ns()
        err_span.end_time_unix_nano = now_ns() + int(0.1 * 1e9)
        err_span.kind = Span.SPAN_KIND_SERVER
        err_span.status.CopyFrom(Status(
            code=Status.STATUS_CODE_ERROR,
            message="Payment processing failed"
        ))
        err_span.attributes.extend([
            KeyValue(key="http.method", value=AnyValue(string_value="POST")),
            KeyValue(key="http.status_code", value=AnyValue(int_value=500)),
            KeyValue(key="exception.type", value=AnyValue(string_value="PaymentException")),
            KeyValue(key="exception.message", value=AnyValue(string_value="Payment gateway timeout")),
            KeyValue(key="exception.stacktrace", value=AnyValue(string_value=(
                "com.example.PaymentException: Payment gateway timeout\n"
                "  at com.example.PaymentService.process(PaymentService.java:42)\n"
                "  at com.example.PaymentController.create(PaymentController.java:28)"
            ))),
        ])

    return req.SerializeToString()


# ─────────────────────────────────────────────
# 로그 테스트 데이터
# ─────────────────────────────────────────────

def build_logs_request(service: str) -> bytes:
    req = ExportLogsServiceRequest()
    rl = req.resource_logs.add()
    rl.resource.CopyFrom(make_resource(service))
    sl = rl.scope_logs.add()

    log_samples = [
        (9,  "Application started successfully"),                        # INFO
        (9,  "Processing request for user: user_12345"),                 # INFO
        (13, "Connection pool running low: 3/10 available"),            # WARN
        (9,  "Cache hit rate: 87.3%"),                                   # INFO
        (17, "Failed to connect to external API after 3 retries"),      # ERROR
        (5,  "Entering method: OrderService.createOrder()"),             # DEBUG
    ]

    for sev, msg in random.sample(log_samples, k=min(3, len(log_samples))):
        log = sl.log_records.add()
        log.time_unix_nano = now_ns()
        log.observed_time_unix_nano = now_ns()
        log.severity_number = sev
        log.body.CopyFrom(AnyValue(string_value=msg))
        log.attributes.extend([
            KeyValue(key="thread.name", value=AnyValue(string_value="http-nio-8080-exec-1")),
            KeyValue(key="logger.name", value=AnyValue(string_value=f"com.example.{service}")),
        ])

    return req.SerializeToString()


# ─────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────

def send(url: str, data: bytes, label: str) -> None:
    try:
        resp = requests.post(
            url,
            data=data,
            headers={"Content-Type": CONTENT_TYPE},
            timeout=5,
        )
        status = "OK" if resp.status_code == 200 else f"FAIL({resp.status_code})"
        print(f"  [{label}] {status} — {len(data)} bytes 전송")
    except Exception as e:
        print(f"  [{label}] 연결 실패: {e}")


def main():
    parser = argparse.ArgumentParser(description="APM OTLP 테스트")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--service", default="test-java-app")
    parser.add_argument("--repeat", type=int, default=1, help="반복 횟수")
    parser.add_argument("--interval", type=float, default=1.0, help="반복 간격(초)")
    args = parser.parse_args()

    base = f"http://{args.host}:{args.port}/otlp"
    print(f"\nAPM 서버: {base}")
    print(f"서비스명: {args.service}")
    print(f"반복: {args.repeat}회 / 간격: {args.interval}초\n")

    for i in range(args.repeat):
        if args.repeat > 1:
            print(f"[{i + 1}/{args.repeat}]")

        send(f"{base}/v1/metrics", build_metrics_request(args.service), "Metrics")
        send(f"{base}/v1/traces",  build_traces_request(args.service),  "Traces ")
        send(f"{base}/v1/logs",    build_logs_request(args.service),    "Logs   ")

        if i < args.repeat - 1:
            time.sleep(args.interval)

    print("\n완료. APM 대시보드에서 데이터를 확인하세요.")


if __name__ == "__main__":
    main()
