#!/usr/bin/env bash
# ============================================================
#  APM 설치 패키지 수집 스크립트 (인터넷 연결 PC에서 실행)
#  실행 위치: APM 프로젝트 루트 디렉토리
#  출력물:    apm-installer-<날짜>.tar.gz
#
#  사용법:
#    ./scripts/collect.sh              # 빌드 → 폐쇄망 테스트 → 패키지 생성
#    ./scripts/collect.sh --skip-test  # 테스트 생략 (빠른 반복 개발용)
#
#  흐름:
#    이미지 빌드 → 파일 수집 → 폐쇄망 시뮬레이션 테스트
#      └── 통과 → OTel 에이전트 다운로드 → 최종 패키지 생성
#      └── 실패 → 중단 (패키지 미생성)
# ============================================================
set -euo pipefail

# ── 색상 출력 헬퍼 ───────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step()    { echo -e "\n${BOLD}── $* ${NC}"; }

# ── 인자 파싱 ────────────────────────────────────────────
SKIP_TEST=false
for arg in "$@"; do
  case "${arg}" in
    --skip-test) SKIP_TEST=true ;;
    --help|-h)
      echo "사용법: $0 [--skip-test]"
      echo ""
      echo "  (기본)      빌드 → 폐쇄망 테스트 → 패키지 생성"
      echo "  --skip-test 폐쇄망 테스트 생략 (빠른 반복 개발 시)"
      exit 0
      ;;
  esac
done

# ── 버전 설정 ────────────────────────────────────────────
APM_VERSION="1.0"
OTEL_AGENT_VERSION="2.11.0"
OTEL_AGENT_URL="https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${OTEL_AGENT_VERSION}/opentelemetry-javaagent.jar"
PACKAGE_NAME="apm-installer-$(date +%Y%m%d)"
HAMSTER_AGENT="hamster-agent.jar"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORK_DIR="${PROJECT_DIR}/.collect_tmp/${PACKAGE_NAME}"

# ── 사전 확인 ────────────────────────────────────────────
echo ""
echo "============================================================"
echo -e "  ${BOLD}APM 설치 패키지 수집 스크립트${NC}"
[ "${SKIP_TEST}" = true ] && echo -e "  ${YELLOW}[!] 폐쇄망 테스트 생략 모드${NC}"
echo "============================================================"
echo ""

[ -f "${PROJECT_DIR}/docker-compose.yml" ] || error "APM 프로젝트 루트에서 실행하세요."
command -v docker &>/dev/null              || error "Docker가 설치되어 있지 않습니다."
command -v curl   &>/dev/null              || error "curl이 설치되어 있지 않습니다."

info "출력 패키지: ${PACKAGE_NAME}.tar.gz"

# ── 임시 디렉토리 준비 ───────────────────────────────────
rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}/images" "${WORK_DIR}/agent" "${WORK_DIR}/docker" "${WORK_DIR}/scripts"

# ── 오류 시 임시 디렉토리 정리 ───────────────────────────
trap 'rm -rf "${PROJECT_DIR}/.collect_tmp"' ERR

# ── Step 1. Docker 이미지 빌드 ───────────────────────────
step "Step 1/5: Docker 이미지 빌드"

info "백엔드 이미지 빌드 중..."
docker build -t "apm-backend:${APM_VERSION}" "${PROJECT_DIR}/backend" \
  || error "백엔드 이미지 빌드 실패"
success "apm-backend:${APM_VERSION}"

info "프론트엔드 이미지 빌드 중... (React 빌드 포함, 수분 소요)"
docker build -t "apm-frontend:${APM_VERSION}" \
  -f "${PROJECT_DIR}/frontend/Dockerfile.prod" "${PROJECT_DIR}/frontend" \
  || error "프론트엔드 이미지 빌드 실패"
success "apm-frontend:${APM_VERSION}"

# ── Step 2. 베이스 이미지 Pull ───────────────────────────
step "Step 2/5: 베이스 이미지 Pull"

info "timescale/timescaledb:latest-pg15 pull 중..."
docker pull timescale/timescaledb:latest-pg15
success "timescale/timescaledb:latest-pg15"

# ── Step 3. 이미지 저장 + 구성 파일 수집 ─────────────────
step "Step 3/5: 이미지 저장, 구성 파일 수집 및 에이전트 빌드"

info "이미지 저장 중... (크기에 따라 수분 소요)"
docker save \
  "timescale/timescaledb:latest-pg15" \
  "apm-backend:${APM_VERSION}" \
  "apm-frontend:${APM_VERSION}" \
  | gzip > "${WORK_DIR}/images/apm-images.tar.gz"
IMAGE_SIZE=$(du -sh "${WORK_DIR}/images/apm-images.tar.gz" | cut -f1)
success "이미지 저장 완료 (${IMAGE_SIZE})"

info "구성 파일 수집 중..."
cp "${PROJECT_DIR}/docker-compose.prod.yml" "${WORK_DIR}/"
cp "${SCRIPT_DIR}/install.conf"             "${WORK_DIR}/"
cp -r "${PROJECT_DIR}/docker/"              "${WORK_DIR}/docker/"
cp "${SCRIPT_DIR}/install.sh"               "${WORK_DIR}/"
chmod +x "${WORK_DIR}/install.sh"

cat > "${WORK_DIR}/VERSION" <<EOF
APM_VERSION=${APM_VERSION}
OTEL_AGENT_VERSION=${OTEL_AGENT_VERSION}
BUILD_DATE=$(date '+%Y-%m-%d %H:%M:%S')
BUILD_HOST=$(hostname)
EOF

info "통합 햄스터 에이전트(Single JAR) 빌드 중... (OTel agent + Hamster 확장 포함, 수분 소요)"
bash "${PROJECT_DIR}/agent-extension/build-extension.sh" || error "에이전트 빌드 실패"
cp "${PROJECT_DIR}/agent-extension/dist/${HAMSTER_AGENT}" "${WORK_DIR}/agent/" \
  || error "agent-extension/dist/${HAMSTER_AGENT} 가 없습니다. 빌드 로그를 확인하세요."

info "실시간 스택 분석 에이전트 수집 중..."
cp "${SCRIPT_DIR}/thread-dump-agent.sh" "${WORK_DIR}/scripts/"
chmod +x "${WORK_DIR}/scripts/thread-dump-agent.sh"

info "설치 가이드 및 메서드 설정 샘플 생성 중..."
cp "${PROJECT_DIR}/agent-extension/AGENT_GUIDE.md" "${WORK_DIR}/AGENT_INSTALL_GUIDE.md"
cp "${PROJECT_DIR}/agent-extension/hamster-methods.conf.sample" "${WORK_DIR}/agent/"
cp "${PROJECT_DIR}/agent-extension/hamster-methods.conf"        "${WORK_DIR}/agent/"

success "구성 파일 및 에이전트 수집 완료"

# ── Step 4. 폐쇄망 설치 테스트 ───────────────────────────
step "Step 4/5: 폐쇄망 설치 테스트"

if [ "${SKIP_TEST}" = true ]; then
  warn "폐쇄망 테스트 생략 (--skip-test)"
  warn "최종 은행 전달 전 반드시 테스트를 수행하세요."
else
  # agent 없이 임시 패키지 생성 후 테스트
  # (agent는 선택 사항이므로 테스트에 영향 없음)
  info "테스트용 임시 패키지 생성 중 (agent 제외)..."
  TEST_TAR="${PROJECT_DIR}/.collect_tmp/${PACKAGE_NAME}-test.tar.gz"
  tar -czf "${TEST_TAR}" -C "${PROJECT_DIR}/.collect_tmp" "${PACKAGE_NAME}/"

  echo ""
  if bash "${SCRIPT_DIR}/test-airgap.sh" "${TEST_TAR}"; then
    rm -f "${TEST_TAR}"
    echo ""
    success "폐쇄망 테스트 통과 — 패키지 생성을 계속합니다."
  else
    rm -f "${TEST_TAR}"
    rm -rf "${PROJECT_DIR}/.collect_tmp"
    error "폐쇄망 테스트 실패 — 패키지 생성을 중단합니다.\n  위 로그에서 원인을 확인하고 수정 후 다시 실행하세요."
  fi
fi

step "Step 5/5: 통합 에이전트 확인"

# Maven shade (pom.xml) 가 OTel agent + Hamster 클래스 + SPI 를 이미 병합했으므로
# 별도 다운로드·수동 병합 불필요. Step 3 에서 복사한 파일을 그대로 사용한다.
success "통합 에이전트 확인 완료: ${HAMSTER_AGENT} ($(du -sh "${WORK_DIR}/agent/${HAMSTER_AGENT}" | cut -f1))"

# ── 최종 패키지 생성 ─────────────────────────────────────
echo ""
info "최종 패키지 압축 중..."
tar -czf "${PROJECT_DIR}/${PACKAGE_NAME}.tar.gz" \
  -C "${PROJECT_DIR}/.collect_tmp" "${PACKAGE_NAME}/"
rm -rf "${PROJECT_DIR}/.collect_tmp"

FINAL_SIZE=$(du -sh "${PROJECT_DIR}/${PACKAGE_NAME}.tar.gz" | cut -f1)

echo ""
echo "============================================================"
success "패키지 생성 완료!"
echo ""
echo "  파일:     ${PACKAGE_NAME}.tar.gz  (${FINAL_SIZE})"
echo ""
echo "  은행 서버 설치 방법:"
echo "  1. ${PACKAGE_NAME}.tar.gz 를 은행 서버로 전송"
echo "  2. tar -xzf ${PACKAGE_NAME}.tar.gz"
echo "  3. cd ${PACKAGE_NAME} && sudo ./install.sh"
echo "============================================================"
echo ""
