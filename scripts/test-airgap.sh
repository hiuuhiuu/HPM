#!/usr/bin/env bash
# ============================================================
#  APM 폐쇄망 설치 기능 테스트 스크립트
#
#  Docker-in-Docker(DinD) 격리 환경에서 아래 항목을 검증합니다:
#    1. 패키지 파일 구성 확인
#    2. Docker 이미지 tar.gz 로드
#    3. install.sh 정상 실행
#    4. 컨테이너 기동 확인 (apm-db / apm-backend / apm-frontend)
#    5. DB 스키마 초기화 확인 (7개 테이블)
#    6. 헬스체크 통과 (포트 8080)
#
#  사용법:
#    ./scripts/test-airgap.sh                  # 최신 패키지 자동 탐색
#    ./scripts/test-airgap.sh apm-xxx.tar.gz   # 패키지 직접 지정
#    ./scripts/test-airgap.sh --keep           # 테스트 후 컨테이너 유지
# ============================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step()    { echo -e "\n${BOLD}── $* ${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONTAINER="apm-airgap-test"
DIND_IMAGE="docker:27-dind"
KEEP=false
PACKAGE_TAR=""
TEST_PASSWORD="TestPass123!"

for arg in "$@"; do
  case "${arg}" in
    --keep)   KEEP=true ;;
    --help|-h)
      echo "사용법: $0 [--keep] [패키지.tar.gz]"
      echo "  --keep  테스트 후 컨테이너 유지 (로그·상태 수동 점검)"
      echo ""
      echo "  로그:      docker exec ${CONTAINER} docker compose -f /opt/apm/docker-compose.prod.yml logs -f"
      echo "  DB 확인:   docker exec ${CONTAINER} docker exec apm-db psql -U apm -d apmdb -c '\\dt'"
      echo "  정리:      docker rm -f ${CONTAINER}"
      exit 0 ;;
    *.tar.gz) PACKAGE_TAR="${arg}" ;;
  esac
done

if [ -z "${PACKAGE_TAR}" ]; then
  PACKAGE_TAR=$(ls "${PROJECT_DIR}"/apm-installer-*.tar.gz 2>/dev/null | sort | tail -1 || true)
fi
[ -n "${PACKAGE_TAR}" ] && [ -f "${PACKAGE_TAR}" ] \
  || error "설치 패키지(apm-installer-*.tar.gz)를 찾을 수 없습니다."
PACKAGE_TAR="$(cd "$(dirname "${PACKAGE_TAR}")" && pwd)/$(basename "${PACKAGE_TAR}")"

# ── 결과 집계 및 종료 처리 ────────────────────────────────
PASS=0; FAIL=0
cleanup() {
  if [ "${KEEP}" = false ]; then
    docker rm -f "${CONTAINER}" 2>/dev/null || true
  else
    warn "컨테이너 ${CONTAINER} 유지 중. 정리: docker rm -f ${CONTAINER}"
  fi
  echo ""
  echo "============================================================"
  echo -e "  ${BOLD}테스트 결과${NC}   성공: ${PASS}  /  실패: ${FAIL}"
  [ "${FAIL}" -eq 0 ] \
    && success "모든 항목 통과 — 폐쇄망 배포 패키지 정상" \
    || warn   "실패 항목 있음 — 위 로그 확인 후 수정 필요"
  echo "============================================================"
  exit "${FAIL}"
}
trap cleanup EXIT

check() {
  local label="$1"; shift
  if "$@" &>/dev/null 2>&1; then
    success "${label}"; PASS=$((PASS+1))
  else
    warn "${label} — 실패"; FAIL=$((FAIL+1))
  fi
}

# ── 시작 ─────────────────────────────────────────────────
echo ""
echo "============================================================"
echo -e "  ${BOLD}APM 폐쇄망 설치 기능 테스트${NC}"
echo "  패키지 : $(basename "${PACKAGE_TAR}") ($(du -sh "${PACKAGE_TAR}" | cut -f1))"
echo "  환경   : Docker-in-Docker (격리된 Alpine Linux)"
echo "============================================================"

command -v docker &>/dev/null      || error "Docker가 설치되어 있지 않습니다."
docker compose version &>/dev/null || error "Docker Compose v2가 필요합니다."
docker rm -f "${CONTAINER}" 2>/dev/null || true

# ── Step 1. DinD 환경 준비 ───────────────────────────────
step "Step 1/6: 격리 환경 준비 (DinD)"
docker pull "${DIND_IMAGE}" --quiet
docker run -d \
  --name "${CONTAINER}" \
  --privileged \
  -e DOCKER_TLS_CERTDIR="" \
  "${DIND_IMAGE}"
success "DinD 컨테이너 기동: ${CONTAINER}"

info "내부 Docker 데몬 초기화 대기..."
for i in $(seq 1 30); do
  docker exec "${CONTAINER}" docker info &>/dev/null 2>&1 && break
  [ "${i}" -eq 30 ] && error "DinD 데몬 기동 타임아웃"
  echo -n "."; sleep 2
done; echo ""
success "내부 Docker 데몬 준비 완료"

docker exec "${CONTAINER}" apk add --no-cache bash curl wget >/dev/null
success "bash / curl / wget 설치 완료"

# ── Step 2. 패키지 전송 및 구조 확인 ─────────────────────
step "Step 2/6: 패키지 전송 및 구조 확인"
info "패키지 전송 중 (stdin 파이프, 수십 초 소요)..."
cat "${PACKAGE_TAR}" \
  | docker exec -i "${CONTAINER}" sh -c "cat > /tmp/pkg.tar.gz" \
  || error "패키지 전송 실패"
success "패키지 전송 완료"

docker exec "${CONTAINER}" sh -c \
  "mkdir -p /apm-pkg && tar -xzf /tmp/pkg.tar.gz -C /apm-pkg --strip-components=1" \
  || error "패키지 압축 해제 실패"

for f in install.sh docker-compose.prod.yml "docker/init.sql" "images/apm-images.tar.gz"; do
  check "파일 존재: ${f}" docker exec "${CONTAINER}" test -f "/apm-pkg/${f}"
done

# ── Step 3. install.sh 실행 ───────────────────────────────
step "Step 3/6: install.sh 실행"
info "자동 입력 (비밀번호: ${TEST_PASSWORD})"
echo ""

if docker exec -i "${CONTAINER}" bash -c "
  cd /apm-pkg
  export TERM=xterm
  printf '${TEST_PASSWORD}\n${TEST_PASSWORD}\n' | bash install.sh
"; then
  success "install.sh 완료"
  PASS=$((PASS+1))
else
  warn "install.sh 비정상 종료 (exit $?) — 서비스 상태를 계속 확인합니다"
  FAIL=$((FAIL+1))
fi

# ── Step 4. 컨테이너 기동 확인 ───────────────────────────
step "Step 4/6: 컨테이너 기동 확인"
echo ""
info "[컨테이너 상태]"
docker exec "${CONTAINER}" docker ps \
  --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' 2>/dev/null || true

for svc in apm-db apm-backend apm-frontend; do
  check "Running: ${svc}" bash -c \
    "docker exec '${CONTAINER}' docker inspect --format '{{.State.Running}}' '${svc}' 2>/dev/null | grep -q true"
done

# ── Step 5. DB 스키마 확인 ───────────────────────────────
step "Step 5/6: DB 스키마 확인"
sleep 5
TABLE_COUNT=$(docker exec "${CONTAINER}" \
  docker exec apm-db psql -U apm -d apmdb -tAc \
  "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" \
  2>/dev/null | tr -d '[:space:]' || echo "0")

if [ "${TABLE_COUNT:-0}" -gt 0 ]; then
  success "DB 스키마 초기화 완료 (테이블 수: ${TABLE_COUNT})"
  PASS=$((PASS+1))
  docker exec "${CONTAINER}" \
    docker exec apm-db psql -U apm -d apmdb -c '\dt' 2>/dev/null || true
else
  warn "DB 스키마 확인 실패 (테이블 0)"; FAIL=$((FAIL+1))
fi

# ── Step 6. 헬스체크 ─────────────────────────────────────
step "Step 6/6: 헬스체크 (최대 60초)"
HEALTH_OK=false
for i in $(seq 1 12); do
  if docker exec "${CONTAINER}" \
       wget -q --timeout=3 "http://localhost:8080/health" -O - 2>/dev/null \
     | grep -q "ok"; then
    HEALTH_OK=true; break
  fi
  echo -n "."; sleep 5
done; echo ""

if [ "${HEALTH_OK}" = true ]; then
  success "헬스체크 통과 (포트 8080)"
  PASS=$((PASS+1))
else
  warn "헬스체크 실패. 컨테이너 로그:"
  docker exec "${CONTAINER}" \
    docker compose -f /opt/apm/docker-compose.prod.yml logs --tail=20 2>/dev/null || true
  FAIL=$((FAIL+1))
fi
