# APM 업그레이드 가이드 — 2026-04-14

이번 릴리스는 **실시간 UX + 도메인 기능 확장 + 기술 부채 정리**가 집중적으로 포함되어 있습니다.
아래 항목을 **반드시** 숙지한 뒤 반입·재기동하십시오.

---

## 🔴 반입 전 필독 사항

### 1. 프론트엔드 포트 변경: **3000 → 9700**
- `docker-compose.yml`에서 프론트 컨테이너가 **호스트 9700 포트**로 노출됩니다.
- 브라우저 북마크·바로가기·방화벽 룰·리버스 프록시 설정 업데이트가 필요합니다.
- **운영 환경(`docker-compose.prod.yml`)은 영향 없음** (nginx 8080 유지).
- 기존 3000 포트를 계속 쓰고 싶다면 `docker-compose.yml`의 `9700:3000`을 다시 `3000:3000`으로 변경.

### 2. 기본 활성화된 스팬 노이즈 필터 (신규)
다음 스팬이 수집 단계에서 **저장되지 않습니다**. 트레이스·토폴로지·슬로우 쿼리·에러 통계에서 완전히 제외됩니다.

| 카테고리 | 차단 대상 |
|---|---|
| quartz | Quartz 스케줄러(`org.quartz.*`)·`QRTZ_*` 테이블 폴링 쿼리 |
| actuator | Spring Boot Actuator(`/actuator/*`) 요청 |
| healthcheck | K8s/LB 헬스체크 (`/health`, `/healthz`, `/readyz`, `/livez`, `/ping`, `/status`, `/up` 등) |
| favicon | `/favicon.ico` |
| metrics_scrape | Prometheus 수집 경로 (`/metrics`, `/prometheus`) |

**운영 토글** (필터를 해제하려면 `.env` 또는 compose env에 추가):
```
FILTER_NOISY_SPANS=false         # 전체 해제
FILTER_QUARTZ=false              # Quartz 필터만 해제
FILTER_ACTUATOR=false
FILTER_HEALTHCHECK=false
FILTER_FAVICON=false
FILTER_METRICS_SCRAPE=false
```
기동 로그에서 활성 카테고리 확인 가능:
```
[SpanFilter] enabled=True active=quartz,actuator,healthcheck,favicon,metrics_scrape
```

### 3. 관리자 인증 (옵트인, 기본 비활성)
- `DELETE /api/instances/*`, `DELETE /api/services/*` 엔드포인트에 **API Key 인증 체계**가 추가되었습니다.
- **기본은 비활성** — `ADMIN_API_KEY`를 설정하지 않으면 지금처럼 무인증으로 동작합니다.
- 활성화하려면:
  1. `.env`에 `ADMIN_API_KEY=<강한 랜덤 문자열>` 추가 후 백엔드 재기동
  2. 관리자 브라우저 콘솔에서 `localStorage.setItem('hamster_admin_api_key', '<동일값>')` 실행
  3. 미설정 브라우저는 DELETE 요청 시 401 수신 → 삭제 불가
- 생성 예: `openssl rand -hex 32`

---

## 🟡 스키마 변경 (자동 마이그레이션)

서버 기동 시 자동으로 수행됩니다. **별도 수동 작업 불필요**.

| 테이블 | 변경 |
|---|---|
| `errors` | `fingerprint TEXT` 컬럼 추가 + 인덱스 생성 + 기존 레코드 백필 |
| `deployments` | **신규 테이블** — 배포 마커 기록용 |

로그 확인:
```
[DB] errors 마이그레이션 완료 (count/first_seen/dedup/unique/fingerprint, backfill=N)
[DB] deployments 테이블 확인 완료
```

---

## 🟢 신규 기능

### 실시간 메트릭 스트리밍
- 대시보드 StatCard가 **2초 주기 WebSocket push**로 갱신 (기존 3초 폴링 제거됨)
- 값 변화 시 짧은 색상 플래시 애니메이션
- 헤더 좌측에 `🟢 LIVE` 뱃지 — 연결 상태 시각화

### ⌘K 통합 검색 팔레트
- 어디서든 `Cmd+K` / `Ctrl+K` 또는 사이드바 "검색" 버튼으로 활성화
- 페이지 / 서비스 / 인스턴스 / 빠른 액션 통합 검색 + 최근 방문 5개 기록

### 배포 마커
- **Settings > 배포 마커** 섹션에서 수동 기록 가능
- CI/CD 통합:
  ```bash
  curl -X POST http://<apm>/api/deployments -H "Content-Type: application/json" \
    -d '{"service":"my-service","version":"v1.2.3","commit_sha":"abc123","description":"..."}'
  ```
- 대시보드 TPS 차트 + 모든 Metric 차트에 `▼ v1.2.3` 수직선 오버레이

### 에러 자동 그룹핑
- **에러 페이지**에 "그룹 / 개별" 탭 토글 (기본 그룹)
- URL의 ID/UUID/숫자 정규화 + 스택 상위 5프레임 해시 기반 fingerprint 그룹핑
- 수백 개 에러 → 의미 단위 10~20개 그룹으로 축약
- 그룹 클릭 시 하위 변형 에러 목록 + 샘플 trace 원클릭 열기

### 토폴로지 실시간 애니메이션
- 엣지에 트래픽 흐름 애니메이션(dashed 이동), 에러 엣지는 빨간색 빠른 펄스
- 활성 노드 외곽에 TPS 비례 펄스 링, 에러율 높은 노드는 빨간 펄스

---

## 🔧 운영·성능 개선

### 대시보드 폴링 최적화
- 기존 9개 모두 3초 → **용도별 차등화** (3/5/10/15/30초)
- 분당 요청 약 60% 감소 — 백엔드 부담 완화

### Dashboard 컴포넌트 분해
- `Dashboard.tsx` 1637줄 → 775줄 (−53%)
- 하위 컴포넌트 6개로 분리 (InsightsPanel, ScatterTransactionChart, MiniTimeChart, SearchableSelect, ActiveTransactionsPanel, TraceCallTreeModal)
- **사용자 체감 변화 없음** (순수 리팩토링)

### 접근성
- 사이드바, 모달, 아이콘 버튼에 `aria-*` 속성 추가 — 스크린리더·키보드 탐색 가능

---

## 🧪 테스트 인프라 (신규)

반입 후 필요 시 다음 명령으로 검증 가능합니다.

### 백엔드 pytest (43 tests)
```bash
docker compose exec backend python -m pytest tests/ -v
```

### 프론트엔드 Jest (22 tests)
```bash
cd frontend && npm test -- --watchAll=false
```

### E2E Playwright (9 smoke scenarios)
```bash
cd frontend && npm run test:e2e
# 사전 조건: docker compose가 기동된 상태 (기본 http://localhost:9700)
```

---

## ⚠️ 반입 시 주의사항

### Docker Compose 재기동 순서
```bash
# 1. 새 패키지 압축 해제 (기존 디렉토리 백업 권장)
tar -xzf apm-installer-<날짜>.tar.gz
cd apm-installer-<날짜>

# 2. install.sh로 재설치
sudo ./install.sh

# 3. 기동 로그 확인
docker compose logs -f apm-backend | head -50
#   반드시 보여야 할 로그:
#   [DB] errors 마이그레이션 완료 (...)
#   [DB] deployments 테이블 확인 완료
#   [SpanFilter] enabled=True active=quartz,actuator,...
#   [MetricsStreamer] 시작 (간격: 2초)
```

### 데이터 보존
- 기존 `traces`·`metrics`·`errors`·`logs` 데이터는 **유지**됩니다.
- errors 테이블은 fingerprint가 자동 backfill되며 기존 count/first_seen도 보존.
- 배포 마커(deployments)는 신규 빈 테이블로 생성.

### Rollback
- 문제 발생 시: 이전 `apm-installer-20260319.tar.gz` 등으로 재설치.
- 단, DB 스키마는 **forward-compatible**이므로 구버전 서버가 fingerprint 컬럼을 무시할 뿐 데이터 손실 없음.

---

## 📞 트러블슈팅

| 증상 | 원인 | 해결 |
|---|---|---|
| 브라우저에서 `localhost:3000`이 연결 안 됨 | 프론트 포트 9700으로 변경됨 | `http://localhost:9700` 접속 |
| 대시보드 LIVE 뱃지가 "연결 중..."에서 멈춤 | `/ws/metrics` WebSocket 차단 | 리버스 프록시에 Upgrade/Connection 헤더 확인 |
| DELETE API 401 응답 | ADMIN_API_KEY 설정 후 브라우저 키 미설정 | 콘솔에서 `localStorage.setItem('hamster_admin_api_key', '...')` |
| 배포 마커가 차트에 안 보임 | 범위 밖 시각 | `range` 파라미터 내 `marker_time` 필요 |
| 토폴로지 / 에러 페이지에 Quartz가 사라졌다 | 정상 (필터 기본 활성) | `FILTER_QUARTZ=false`로 해제 가능 |
| Actuator `/actuator/health` 스팬이 안 보임 | 정상 (필터 기본 활성) | `FILTER_ACTUATOR=false`로 해제 가능 |

---

## 참고
- 상세 릴리스 커밋: `git log 8dff37a`
- 변경 파일 수: **52개** (수정 29 + 신규 23)
- 총 테스트 건수: 74 (backend 43 + frontend 22 + e2e 9) — 모두 통과
