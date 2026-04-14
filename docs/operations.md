# APM 운영 매뉴얼

## 기술 스택

| 구성 요소 | 기술 | 역할 |
|-----------|------|------|
| DB | TimescaleDB (PostgreSQL 15 확장) | 시계열 메트릭/로그/트레이스 저장 |
| 백엔드 | Python 3.11 + FastAPI + asyncpg | OTLP 수신, REST API |
| 프론트엔드 | React 18 + TypeScript + Recharts | 대시보드 UI |
| 인프라 | Docker + Docker Compose | 컨테이너 오케스트레이션 |
| 수집 프로토콜 | OpenTelemetry OTLP HTTP (protobuf) | Java Agent → APM 서버 |

---

## 포트 정보

| 포트 | 서비스 | 설명 |
|------|--------|------|
| **9700** | 프론트엔드 | 대시보드 UI (`http://localhost:9700`) |
| **8000** | 백엔드 API | REST API / OTLP 수신 (`http://localhost:8000`) |
| **5432** | TimescaleDB | PostgreSQL (컨테이너 내부: `apm-db:5432`) |

> OTLP 수신 엔드포인트: `http://localhost:8000/otlp/v1/{metrics|traces|logs}`

---

## 기동 / 종료

### 전체 스택 기동

```bash
cd /Users/jeonghyun.hwang/Documents/Project/APM

# 최초 실행 (이미지 빌드 포함)
docker compose up --build -d

# 이후 실행 (빌드 생략)
docker compose up -d
```

### 전체 스택 종료

```bash
# 컨테이너 중지 (데이터 보존)
docker compose down

# 컨테이너 + 볼륨 삭제 (데이터 초기화)
docker compose down -v
```

### 개별 서비스 재시작

```bash
docker compose restart backend
docker compose restart frontend
docker compose restart db
```

### 코드 수정 후 재빌드

```bash
# 백엔드만 재빌드
docker compose up --build -d backend

# 프론트엔드만 재빌드
docker compose up --build -d frontend
```

---

## 상태 확인

```bash
# 컨테이너 실행 상태
docker compose ps

# 백엔드 헬스체크
curl http://localhost:8000/

# 백엔드 로그 실시간 확인
docker logs -f apm-backend

# 프론트엔드 로그 확인
docker logs -f apm-frontend

# DB 로그 확인
docker logs -f apm-db
```

---

## 테스트 데이터 주입

Java Agent 없이 가짜 OTLP 데이터를 주입하는 스크립트입니다.

```bash
# 의존성 설치 (최초 1회)
pip3 install opentelemetry-proto protobuf requests

# 단일 서비스, 10회 주입
python3 scripts/test_otlp.py --service my-service --repeat 10

# 여러 서비스 동시 주입 (백그라운드)
python3 scripts/test_otlp.py --service order-service   --repeat 200 --interval 3 &
python3 scripts/test_otlp.py --service payment-service --repeat 200 --interval 3 &
python3 scripts/test_otlp.py --service user-service    --repeat 200 --interval 3 &
```

| 옵션 | 기본값 | 설명 |
|------|--------|------|
| `--service` | `test-java-app` | 서비스 이름 |
| `--repeat` | `1` | 반복 횟수 |
| `--interval` | `1.0` | 반복 간격 (초) |
| `--host` | `localhost` | APM 서버 호스트 |
| `--port` | `8000` | APM 서버 포트 |

---

## Java Agent 연동 (실제 서비스)

```bash
java \
  -javaagent:/path/to/opentelemetry-javaagent.jar \
  -Dotel.service.name=my-service \
  -Dotel.exporter.otlp.endpoint=http://localhost:8000/otlp \
  -Dotel.exporter.otlp.protocol=http/protobuf \
  -jar my-app.jar
```

> 자세한 설정은 `docs/java-agent-setup.md` 참고

---

## 주요 API 엔드포인트

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/metrics/overview` | 전체 요약 (서비스 수, 응답시간, 에러율) |
| GET | `/api/metrics/summary/{service}` | 서비스별 메트릭 요약 |
| GET | `/api/traces` | 트레이스 목록 |
| GET | `/api/traces/{trace_id}` | 트레이스 상세 (Waterfall) |
| GET | `/api/errors` | 에러 목록 |
| GET | `/api/logs` | 로그 목록 |
| GET | `/api/alerts/rules` | 알림 규칙 목록 |
| GET | `/api/alerts/active` | 현재 발화 중인 알림 |
| POST | `/otlp/v1/metrics` | OTLP 메트릭 수신 |
| POST | `/otlp/v1/traces` | OTLP 트레이스 수신 |
| POST | `/otlp/v1/logs` | OTLP 로그 수신 |

전체 API 문서: `http://localhost:8000/docs` (Swagger UI)

---

## DB 접속

```bash
# 컨테이너 내부 psql 접속
docker exec -it apm-db psql -U apm -d apmdb

# 주요 테이블
\dt

-- 최근 메트릭 확인
SELECT service, name, value, time FROM metrics ORDER BY time DESC LIMIT 10;

-- 서비스 목록
SELECT * FROM services;
```

| 항목 | 값 |
|------|-----|
| 호스트 | `localhost:5432` |
| DB명 | `apmdb` |
| 사용자 | `apm` |
| 비밀번호 | `apm1234` |

---

## 데이터 초기화

```bash
# DB 볼륨 포함 전체 삭제 후 재시작
docker compose down -v
docker compose up -d
```
