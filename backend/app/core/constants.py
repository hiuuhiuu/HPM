"""
APM 공유 상수 — 여러 서비스에서 중복 정의되던 상수를 단일 위치로 통합
"""
from typing import Dict, List

# ── 조회 범위 설정 ─────────────────────────────────────────────────────────
# key → interval(DB), step(time_bucket), step_s(초단위)
RANGE_CONFIG: Dict[str, Dict] = {
    "10m": {"interval": "10 minutes", "step": "1 minute",   "step_s": 60},
    "15m": {"interval": "15 minutes", "step": "1 minute",   "step_s": 60},
    "1h":  {"interval": "1 hour",     "step": "1 minute",   "step_s": 60},
    "6h":  {"interval": "6 hours",    "step": "5 minutes",  "step_s": 300},
    "24h": {"interval": "24 hours",   "step": "15 minutes", "step_s": 900},
    "7d":  {"interval": "7 days",     "step": "1 hour",     "step_s": 3600},
}

# 편의 뷰 — 기존 코드 패턴(개별 dict 참조) 호환
RANGE_INTERVAL:      Dict[str, str] = {k: v["interval"] for k, v in RANGE_CONFIG.items()}
RANGE_STEP:          Dict[str, str] = {k: v["step"]     for k, v in RANGE_CONFIG.items()}
RANGE_STEP_SECONDS:  Dict[str, int] = {k: v["step_s"]   for k, v in RANGE_CONFIG.items()}

# ── WAS 스레드풀 활성 스레드 메트릭명 목록 ─────────────────────────────────
# JEUS     : jeus.threadpool.active
# Tomcat   : tomcat.threads.busy
# WebLogic : weblogic.threadpool.execute_thread_total_count
# OTel 논리 키: was.threadpool.active (METRIC_ALIASES로 정규화 후 조회 시 사용)
WAS_THREAD_ACTIVE: List[str] = [
    "was.threadpool.active",
    "jeus.threadpool.active",
    "tomcat.threads.busy",
    "weblogic.threadpool.execute_thread_total_count",
]
