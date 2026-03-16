#!/usr/bin/env bash
# ============================================================
#  APM Thread Dump Companion Agent
#  JEUS 서버에서 백그라운드 실행하여 APM의 스레드 덤프 수집 요청에 응답
#
#  환경변수:
#    APM_URL       - APM 서버 URL  (기본: http://localhost:8080)
#    INSTANCE_NAME - 인스턴스 식별자 (기본: hostname)
#    POLL_INTERVAL - 폴링 간격(초) (기본: 5)
#    JEUS_PID      - jstack 대상 PID (미설정 시 자동 탐색)
#
#  실행 예시:
#    APM_URL=http://apm-server:8080 INSTANCE_NAME=jeus-node1 ./thread-dump-agent.sh
# ============================================================
set -euo pipefail

APM_URL="${APM_URL:-http://localhost:8080}"
INSTANCE="${INSTANCE_NAME:-$(hostname)}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] [thread-dump-agent] $*" >&2; }

# jstack 실행 가능 여부 확인
if ! command -v jstack &>/dev/null; then
  log "경고: jstack 명령어를 찾을 수 없습니다. JAVA_HOME을 확인하세요."
fi

find_jeus_pid() {
  if [ -n "${JEUS_PID:-}" ]; then
    echo "${JEUS_PID}"
    return
  fi
  # JEUS 프로세스 PID 탐색 (우선순위 순)
  local pid=""
  pid=$(pgrep -f "jeus" 2>/dev/null | head -1) || true
  if [ -z "${pid}" ]; then
    pid=$(pgrep -f "DomainAdminServer\|ManagedServer\|NodeManager" 2>/dev/null | head -1) || true
  fi
  if [ -z "${pid}" ]; then
    # 로컬 테스트용: 현재 JVM 프로세스 탐색
    pid=$(pgrep -f "java" 2>/dev/null | head -1) || true
  fi
  echo "${pid}"
}

run_jstack() {
  local pid="$1"
  if ! kill -0 "${pid}" 2>/dev/null; then
    echo "PID ${pid} 프로세스가 존재하지 않습니다."
    return
  fi
  jstack "${pid}" 2>&1 || echo "jstack 실행 실패 (PID: ${pid})"
}

json_escape() {
  # python3로 안전하게 JSON 문자열 이스케이프
  python3 -c "import sys, json; print(json.dumps(sys.stdin.read()))" 2>/dev/null \
    || echo '""'
}

log "시작 — APM: ${APM_URL} | 인스턴스: ${INSTANCE} | 폴링: ${POLL_INTERVAL}초"

while true; do
  # 1. pending 요청 폴링
  PENDING=""
  PENDING=$(curl -sf --max-time 5 \
    "${APM_URL}/api/thread-dumps/pending?instance=${INSTANCE}" 2>/dev/null) || true

  if [ -n "${PENDING}" ] && [ "${PENDING}" != "null" ]; then
    REQ_ID=$(echo "${PENDING}" | python3 -c \
      "import sys, json; d=json.load(sys.stdin); print(d.get('id',''))" 2>/dev/null) || REQ_ID=""

    if [ -n "${REQ_ID}" ]; then
      log "수집 요청 감지 (request_id=${REQ_ID}) — jstack 실행 중..."

      PID=$(find_jeus_pid)
      if [ -z "${PID}" ]; then
        DUMP_TEXT="오류: JEUS 프로세스를 찾을 수 없습니다."
        log "경고: JEUS PID를 찾을 수 없습니다."
      else
        log "대상 PID: ${PID}"
        DUMP_TEXT=$(run_jstack "${PID}")
      fi

      # 2. 결과 제출
      DUMP_JSON=$(echo "${DUMP_TEXT}" | json_escape)
      RESULT=$(curl -sf --max-time 10 -X POST \
        "${APM_URL}/api/thread-dumps/result" \
        -H "Content-Type: application/json" \
        -d "{\"request_id\":${REQ_ID},\"dump_text\":${DUMP_JSON}}" 2>/dev/null) || RESULT=""

      if [ -n "${RESULT}" ]; then
        log "결과 제출 완료 (request_id=${REQ_ID})"
      else
        log "경고: 결과 제출 실패 (request_id=${REQ_ID})"
      fi
    fi
  fi

  sleep "${POLL_INTERVAL}"
done
