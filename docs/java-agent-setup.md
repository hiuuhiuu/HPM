# OpenTelemetry Java Agent 설정 가이드

## 1. Agent JAR 다운로드

폐쇄망 환경이므로 외부 인터넷이 가능한 환경에서 미리 다운로드 후 서버에 배포합니다.

```bash
# 최신 버전 다운로드 (외부 인터넷 가능한 환경에서 실행)
curl -L -o opentelemetry-javaagent.jar \
  https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar
```

권장 배포 경로: `/opt/apm/opentelemetry-javaagent.jar`

---

## 2. JVM 실행 인자 설정

### 기본 설정 (최소 필수)

```bash
java \
  -javaagent:/opt/apm/opentelemetry-javaagent.jar \
  -Dotel.service.name=my-java-app \
  -Dotel.exporter.otlp.endpoint=http://<APM_SERVER_IP>:8000/otlp \
  -Dotel.exporter.otlp.protocol=http/protobuf \
  -jar your-application.jar
```

### 전체 설정 (권장)

```bash
java \
  -javaagent:/opt/apm/opentelemetry-javaagent.jar \
  \
  # 서비스 식별
  -Dotel.service.name=my-java-app \
  -Dotel.service.version=1.0.0 \
  -Dotel.resource.attributes=deployment.environment=production,service.instance.id=instance-01 \
  \
  # APM 서버 연결
  -Dotel.exporter.otlp.endpoint=http://<APM_SERVER_IP>:8000/otlp \
  -Dotel.exporter.otlp.protocol=http/protobuf \
  \
  # 수집 항목 활성화
  -Dotel.metrics.exporter=otlp \
  -Dotel.traces.exporter=otlp \
  -Dotel.logs.exporter=otlp \
  \
  # 메트릭 수집 주기 (기본 60초 → 10초로 단축)
  -Dotel.metric.export.interval=10000 \
  \
  # JVM 메트릭 활성화
  -Dotel.instrumentation.jvm-metrics.enabled=true \
  \
  -jar your-application.jar
```

---

## 3. 환경 변수 방식 (JVM 인자 대신 사용 가능)

```bash
export OTEL_SERVICE_NAME=my-java-app
export OTEL_SERVICE_VERSION=1.0.0
export OTEL_EXPORTER_OTLP_ENDPOINT=http://<APM_SERVER_IP>:8000/otlp
export OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
export OTEL_METRICS_EXPORTER=otlp
export OTEL_TRACES_EXPORTER=otlp
export OTEL_LOGS_EXPORTER=otlp
export OTEL_METRIC_EXPORT_INTERVAL=10000
export OTEL_RESOURCE_ATTRIBUTES=deployment.environment=production,service.instance.id=instance-01

java -javaagent:/opt/apm/opentelemetry-javaagent.jar -jar your-application.jar
```

---

## 4. Spring Boot / Tomcat 설정 예시

### Spring Boot (application.properties)

```properties
# application.properties에는 직접 설정 불가, JVM 인자 또는 환경 변수 사용
```

### Tomcat (setenv.sh)

```bash
# $CATALINA_HOME/bin/setenv.sh
JAVA_OPTS="$JAVA_OPTS -javaagent:/opt/apm/opentelemetry-javaagent.jar"
JAVA_OPTS="$JAVA_OPTS -Dotel.service.name=my-tomcat-app"
JAVA_OPTS="$JAVA_OPTS -Dotel.exporter.otlp.endpoint=http://<APM_SERVER_IP>:8000/otlp"
JAVA_OPTS="$JAVA_OPTS -Dotel.exporter.otlp.protocol=http/protobuf"
JAVA_OPTS="$JAVA_OPTS -Dotel.metrics.exporter=otlp"
JAVA_OPTS="$JAVA_OPTS -Dotel.traces.exporter=otlp"
JAVA_OPTS="$JAVA_OPTS -Dotel.logs.exporter=otlp"
```

---

## 5. 자동 계측 대상 (주요 프레임워크)

| 프레임워크 / 라이브러리 | 계측 항목 |
|------------------------|-----------|
| Spring MVC / WebFlux   | HTTP 요청/응답, 응답시간 |
| Spring Boot            | 애플리케이션 메트릭 |
| JDBC                   | SQL 쿼리 추적 |
| Hibernate              | ORM 쿼리 추적 |
| Redis (Jedis/Lettuce)  | Redis 명령 추적 |
| Kafka                  | 메시지 생산/소비 추적 |
| gRPC                   | RPC 호출 추적 |
| JVM                    | 메모리, CPU, GC, 스레드 |

---

## 6. 수집되는 주요 메트릭

### JVM 메트릭

| 메트릭 이름 | 설명 | 단위 |
|------------|------|------|
| `jvm.memory.used` | JVM 힙/논힙 메모리 사용량 | bytes |
| `jvm.memory.max` | JVM 최대 메모리 | bytes |
| `jvm.cpu.usage` | JVM 프로세스 CPU 사용률 | 1 (0~1) |
| `jvm.threads.count` | 스레드 수 | 개 |
| `jvm.gc.duration` | GC 소요 시간 | seconds |
| `jvm.class.count` | 로드된 클래스 수 | 개 |

### HTTP 서버 메트릭

| 메트릭 이름 | 설명 | 단위 |
|------------|------|------|
| `http.server.request.duration` | HTTP 요청 처리 시간 (히스토그램) | seconds |
| `http.server.active_requests` | 현재 처리 중인 요청 수 | 개 |

---

## 7. 연결 확인

Agent 연결 후 APM 서버 로그에서 아래 메시지 확인:

```
[Metrics] 저장: N개 데이터포인트
[Traces] 스팬 저장: N개 | 에러: N개
[Logs] 저장: N개
```

또는 API로 서비스 등록 여부 확인:

```bash
curl http://<APM_SERVER_IP>:8000/health
```

---

## 8. 폐쇄망 주의사항

1. **JAR 파일 사전 배포**: 모든 Java 인스턴스 서버에 `opentelemetry-javaagent.jar` 배포
2. **방화벽 규칙**: Java 서버 → APM 서버 8000 포트 TCP 허용
3. **타임존 통일**: 모든 서버의 시스템 시간을 NTP로 동기화 (시계열 데이터 정확도)
4. **로그 appender**: OTel Java Agent 1.x 이상에서 Log4j2/Logback 자동 계측 지원
