#!/usr/bin/env bash
# ============================================================
#  APM 설치 스크립트 (은행 내부 서버에서 실행)
#  실행 위치: 압축 해제된 패키지 디렉토리 내부
#  필요 권한: sudo 또는 root
# ============================================================
set -euo pipefail

# ── 색상 출력 헬퍼 ───────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }
step()    { echo -e "\n${BOLD}── $* ${NC}"; }

# ── 스크립트 위치 확인 ───────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 설치 환경 설정 로드 ───────────────────────────────────
# 기본값 설정
INSTALL_DIR="/opt/apm"
DATA_DIR="/data/apm"
AGENT_DIR="/waslib"
APM_PORT="8080"

# install.conf 파일이 있으면 로드하여 기본값 덮어쓰기
CONF_FILE="${SCRIPT_DIR}/install.conf"
if [ -f "${CONF_FILE}" ]; then
  info "설정 파일 로드 중: ${CONF_FILE}"
  source "${CONF_FILE}"
else
  warn "설정 파일(${CONF_FILE})을 찾을 수 없어 기본값을 사용합니다."
fi

# ── 사전 확인 ────────────────────────────────────────────
echo ""
echo "============================================================"
echo -e "  ${BOLD}APM 서버 설치 스크립트${NC}"
[ -f "${SCRIPT_DIR}/VERSION" ] && source "${SCRIPT_DIR}/VERSION" && echo "  버전: ${APM_VERSION:-1.0}  |  빌드일: ${BUILD_DATE:-미상}"
echo "============================================================"
echo ""

# root 또는 sudo 확인
[ "$(id -u)" -eq 0 ] || error "root 또는 sudo 권한으로 실행하세요: sudo ./install.sh"

# Docker 확인
command -v docker &>/dev/null || error "Docker가 설치되어 있지 않습니다. Docker를 먼저 설치 후 재실행하세요."
command -v docker &>/dev/null && docker compose version &>/dev/null || \
  error "Docker Compose(v2)가 필요합니다."

# 필요 파일 확인
[ -f "${SCRIPT_DIR}/images/apm-images.tar.gz" ] || error "images/apm-images.tar.gz 파일이 없습니다."
[ -f "${SCRIPT_DIR}/docker-compose.prod.yml" ]  || error "docker-compose.prod.yml 파일이 없습니다."
[ -f "${SCRIPT_DIR}/docker/init.sql" ]           || error "docker/init.sql 파일이 없습니다."

# ── 설정 입력 ────────────────────────────────────────────
step "설치 환경 설정"

echo ""
echo "  설치 디렉토리   : ${INSTALL_DIR}"
echo "  데이터 디렉토리 : ${DATA_DIR}"
echo "  UI 접속 포트    : ${APM_PORT}"
echo ""

# DB 비밀번호
while true; do
  read -rsp "  DB 비밀번호 설정 (8자 이상): " DB_PASSWORD; echo ""
  [ ${#DB_PASSWORD} -ge 8 ] && break
  warn "8자 이상 입력하세요."
done
read -rsp "  DB 비밀번호 확인: " DB_PASSWORD_CONFIRM; echo ""
[ "${DB_PASSWORD}" = "${DB_PASSWORD_CONFIRM}" ] || error "비밀번호가 일치하지 않습니다."

# SECRET_KEY 자동 생성
SECRET_KEY="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || date +%s%N | sha256sum | head -c 64)"
info "SECRET_KEY 자동 생성됨 (64자 랜덤)"

# DB 비밀번호 URL 인코딩 (DATABASE_URL 내 특수문자 처리: @, :, /, # 등)
DB_PASSWORD_ENCODED=""
if command -v python3 &>/dev/null; then
  DB_PASSWORD_ENCODED="$(python3 -c \
    "import urllib.parse, sys; print(urllib.parse.quote(sys.argv[1], safe=''))" \
    "${DB_PASSWORD}" 2>/dev/null)" || DB_PASSWORD_ENCODED=""
fi
if [ -z "${DB_PASSWORD_ENCODED}" ]; then
  warn "python3 URL 인코딩 불가 — 원본 패스워드 사용 (특수문자 @, :, # 등 포함 시 연결 오류 발생 가능)"
  DB_PASSWORD_ENCODED="${DB_PASSWORD}"
fi

echo ""
success "설정 완료"

# ── Step 1. 디렉토리 생성 ────────────────────────────────
step "Step 1/5: 디렉토리 생성"

mkdir -p "${INSTALL_DIR}"
mkdir -p "${DATA_DIR}/db"
mkdir -p "${AGENT_DIR}"

cp -r "${SCRIPT_DIR}/docker"              "${INSTALL_DIR}/"
cp    "${SCRIPT_DIR}/docker-compose.prod.yml" "${INSTALL_DIR}/"

chmod 700 "${DATA_DIR}"
success "디렉토리 구성 완료"

# ── Step 2. .env 파일 생성 ───────────────────────────────
step "Step 2/5: 환경 설정 파일 생성"

# printf 사용: heredoc은 $, ` 등 특수문자를 해석하므로 패스워드가 깨질 수 있음
{
  printf '# APM 환경 설정 - %s 생성\n' "$(date '+%Y-%m-%d %H:%M:%S')"
  printf 'DB_USER=apm\n'
  printf 'DB_PASSWORD=%s\n'   "${DB_PASSWORD}"
  printf 'SECRET_KEY=%s\n'    "${SECRET_KEY}"
  printf 'DATA_DIR=%s\n'      "${DATA_DIR}"
  printf 'DATABASE_URL=postgresql+asyncpg://apm:%s@db:5432/apmdb\n' "${DB_PASSWORD_ENCODED}"
  printf 'DEBUG=false\n'
} > "${INSTALL_DIR}/.env"
chmod 600 "${INSTALL_DIR}/.env"
success ".env 생성 완료 (권한 600)"

# ── Step 3. Docker 이미지 로드 ───────────────────────────
step "Step 3/5: Docker 이미지 로드"

info "이미지 로드 중... (수분 소요될 수 있습니다)"
docker load < "${SCRIPT_DIR}/images/apm-images.tar.gz"
success "이미지 로드 완료"

docker images | grep -E "timescale|apm-backend|apm-frontend" || true

# ── Step 4. Hamster 에이전트 배포 ────────────────────────
step "Step 4/5: Hamster 에이전트 배포"

# OTel Java Agent JAR
OTEL_JAR="${SCRIPT_DIR}/agent/opentelemetry-javaagent.jar"
if [ -f "${OTEL_JAR}" ]; then
  cp "${OTEL_JAR}" "${AGENT_DIR}/"
  chmod 644 "${AGENT_DIR}/opentelemetry-javaagent.jar"
  OTEL_SIZE=$(du -sh "${AGENT_DIR}/opentelemetry-javaagent.jar" | cut -f1)
  success "OTel Java Agent 배포 완료: ${AGENT_DIR}/opentelemetry-javaagent.jar (${OTEL_SIZE})"
else
  warn "opentelemetry-javaagent.jar 파일이 없습니다 — 건너뜁니다: ${OTEL_JAR}"
  warn "나중에 수동으로 복사: cp opentelemetry-javaagent.jar ${AGENT_DIR}/"
fi

# Hamster Extension JAR
HAMSTER_JAR="${SCRIPT_DIR}/agent/hamster-extension.jar"
if [ -f "${HAMSTER_JAR}" ]; then
  cp "${HAMSTER_JAR}" "${AGENT_DIR}/"
  chmod 644 "${AGENT_DIR}/hamster-extension.jar"
  AGENT_SIZE=$(du -sh "${AGENT_DIR}/hamster-extension.jar" | cut -f1)
  success "Hamster Extension 배포 완료: ${AGENT_DIR}/hamster-extension.jar (${AGENT_SIZE})"
else
  warn "hamster-extension.jar 파일이 없습니다 — 건너뜁니다: ${HAMSTER_JAR}"
  warn "나중에 수동으로 복사: cp hamster-extension.jar ${AGENT_DIR}/"
fi

# 메서드 후킹 설정 파일 배포 (이미 존재하면 덮어쓰지 않음)
METHODS_CONF="${SCRIPT_DIR}/agent/hamster-methods.conf"
METHODS_SAMPLE="${SCRIPT_DIR}/agent/hamster-methods.conf.sample"
if [ -f "${METHODS_CONF}" ] && [ ! -f "${AGENT_DIR}/hamster-methods.conf" ]; then
  cp "${METHODS_CONF}" "${AGENT_DIR}/hamster-methods.conf"
  chmod 644 "${AGENT_DIR}/hamster-methods.conf"
  success "메서드 후킹 설정 배포: ${AGENT_DIR}/hamster-methods.conf"
  info "  파일 편집 후 WAS를 재시작하면 콜 트리에 메서드가 표시됩니다."
elif [ -f "${METHODS_SAMPLE}" ] && [ ! -f "${AGENT_DIR}/hamster-methods.conf" ]; then
  cp "${METHODS_SAMPLE}" "${AGENT_DIR}/hamster-methods.conf.sample"
  info "메서드 후킹 설정 샘플 배포: ${AGENT_DIR}/hamster-methods.conf.sample"
fi

# ── Step 5. 서비스 시작 ──────────────────────────────────
step "Step 5/6: APM 서비스 시작"

cd "${INSTALL_DIR}"
docker compose -f docker-compose.prod.yml --env-file .env up -d

info "서비스 초기화 대기 중..."
sleep 10

# 헬스체크
MAX_RETRY=18   # 최대 90초 대기
for i in $(seq 1 ${MAX_RETRY}); do
  if curl -sf "http://localhost:${APM_PORT}/health" &>/dev/null; then
    success "프론트엔드 응답 확인 (포트 ${APM_PORT})"
    break
  fi
  if curl -sf "http://localhost:8000/health" &>/dev/null; then
    success "백엔드 응답 확인 (포트 8000)"
    break
  fi
  if [ "${i}" -eq "${MAX_RETRY}" ]; then
    warn "헬스체크 타임아웃. 서비스 로그를 확인하세요:"
    echo "  docker compose -f ${INSTALL_DIR}/docker-compose.prod.yml logs --tail=30"
  else
    echo -n "."
    sleep 5
  fi
done
echo ""

# ── Step 6. DB 스키마 초기화 확인 ────────────────────────
step "Step 6/6: DB 스키마 초기화"

info "DB 준비 대기 중..."
DB_READY=0
for i in $(seq 1 30); do
  if docker exec apm-db pg_isready -U "${DB_USER:-apm}" -d apmdb &>/dev/null; then
    DB_READY=1
    break
  fi
  echo -n "."
  sleep 2
done
echo ""

if [ "${DB_READY}" -eq 0 ]; then
  warn "DB 연결 실패. 스키마 초기화를 건너뜁니다. 나중에 수동으로 실행하세요:"
  echo "  docker exec -i apm-db psql -U apm -d apmdb < ${INSTALL_DIR}/docker/init.sql"
else
  # 테이블 존재 여부 확인 (public 스키마 내 테이블 수)
  TABLE_COUNT=$(docker exec apm-db psql -U "${DB_USER:-apm}" -d apmdb -tAc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';" 2>/dev/null | tr -d '[:space:]')

  if [ "${TABLE_COUNT:-0}" -eq 0 ]; then
    info "스키마가 없습니다. init.sql 적용 중..."
    docker exec -i apm-db psql -U "${DB_USER:-apm}" -d apmdb < "${INSTALL_DIR}/docker/init.sql"
    success "DB 스키마 초기화 완료"
  else
    success "DB 스키마 이미 존재 (테이블 수: ${TABLE_COUNT}) — 건너뜀"
  fi
fi

# 컨테이너 상태 출력
docker compose -f docker-compose.prod.yml ps

# ── 설치 완료 ────────────────────────────────────────────
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}') \
  || SERVER_IP=$(ip route get 1 2>/dev/null | awk '/src/{print $NF}') \
  || SERVER_IP="<서버 IP>"

echo ""
echo "============================================================"
success "APM 설치 완료!"
echo ""
echo -e "  ${BOLD}APM 대시보드${NC}"
echo "  http://${SERVER_IP}:${APM_PORT}"
echo ""
echo -e "  ${BOLD}JEUS WAS 에이전트 JVM 옵션${NC}"
echo "  -javaagent:${AGENT_DIR}/opentelemetry-javaagent.jar"
echo "  -Dotel.javaagent.extensions=${AGENT_DIR}/hamster-extension.jar"
echo "  -Dotel.exporter.otlp.endpoint=http://${SERVER_IP}:${APM_PORT}/otlp"
echo "  -Dotel.exporter.otlp.protocol=http/protobuf"
echo "  -Dotel.service.name=<서비스명>"
echo "  -Dotel.resource.attributes=service.instance.id=<인스턴스명>"
echo "  -Dotel.metrics.exporter=otlp"
echo "  -Dotel.logs.exporter=otlp"
echo "  -Dotel.traces.exporter=otlp"
echo ""
echo -e "  ${BOLD}관리 명령어${NC}"
echo "  서비스 상태:  docker compose -f ${INSTALL_DIR}/docker-compose.prod.yml ps"
echo "  로그 조회:    docker compose -f ${INSTALL_DIR}/docker-compose.prod.yml logs -f"
echo "  서비스 중지:  docker compose -f ${INSTALL_DIR}/docker-compose.prod.yml down"
echo "  서비스 재시작: docker compose -f ${INSTALL_DIR}/docker-compose.prod.yml restart"
echo ""
echo -e "  ${BOLD}데이터 보존 정책 (설치 후 선택 적용)${NC}"
echo "  docker exec apm-db psql -U apm -d apmdb -c \\"
echo "    \"SELECT add_retention_policy('traces', INTERVAL '30 days');\""
echo ""
echo -e "  ${BOLD}스레드 덤프 companion 에이전트 (JEUS 서버에서 실행)${NC}"
echo "  # thread-dump-agent.sh를 JEUS 서버로 복사 후 실행:"
echo "  APM_URL=http://${SERVER_IP}:${APM_PORT} \\"
echo "  INSTANCE_NAME=<인스턴스명> \\"
echo "  nohup ./thread-dump-agent.sh >> /var/log/thread-dump-agent.log 2>&1 &"
echo ""
echo "  # systemd 서비스로 등록 (선택):"
echo "  # /etc/systemd/system/thread-dump-agent.service 생성 후:"
echo "  #   [Service]"
echo "  #   ExecStart=/opt/apm-agent/thread-dump-agent.sh"
echo "  #   Environment=APM_URL=http://${SERVER_IP}:${APM_PORT}"
echo "  #   Environment=INSTANCE_NAME=<인스턴스명>"
echo "  #   Restart=always"
echo "  # systemctl enable --now thread-dump-agent"
echo "============================================================"
echo ""
