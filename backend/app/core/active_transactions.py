"""
활성 거래 비콘 저장소 (인메모리).

에이전트가 3초 주기로 POST하는 "현재 처리 중인 거래" 목록을 보관한다.
DB 미사용 — 비콘은 휘발성이며 에이전트 비응답 시 30초 후 자동 만료.
"""
import time
import threading
from typing import Any, Dict, List, Optional

BEACON_EXPIRE_S = 30

_lock = threading.Lock()
_beacons: Dict[str, Dict[str, Any]] = {}
# key = "service/instance"
# value = { "service", "instance", "transactions": [...], "received_at": epoch }


def receive_beacon(
    service: str,
    instance: str,
    transactions: List[Dict[str, Any]],
) -> None:
    """에이전트로부터 비콘 수신."""
    key = f"{service}/{instance}"
    with _lock:
        _beacons[key] = {
            "service": service,
            "instance": instance,
            "transactions": transactions,
            "received_at": time.time(),
        }


def get_active_summary() -> List[Dict[str, Any]]:
    """만료되지 않은 비콘에서 활성 거래 요약을 반환.
    프론트의 ActiveTransactionsPanel 데이터 형식과 호환."""
    now = time.time()
    result = []
    expired_keys = []

    with _lock:
        for key, beacon in _beacons.items():
            age = now - beacon["received_at"]
            if age > BEACON_EXPIRE_S:
                expired_keys.append(key)
                continue
            txns = beacon["transactions"]
            if txns:
                result.append({
                    "service": beacon["service"],
                    "instance": beacon["instance"],
                    "transactions": txns,
                })
        for k in expired_keys:
            del _beacons[k]

    return sorted(result, key=lambda x: (x["service"], x["instance"]))


def get_stats() -> Dict[str, Any]:
    """디버그용 통계."""
    with _lock:
        total_txns = sum(len(b["transactions"]) for b in _beacons.values())
        return {
            "instances": len(_beacons),
            "total_active_transactions": total_txns,
        }
