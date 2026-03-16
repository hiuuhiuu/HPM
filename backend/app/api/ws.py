import asyncio
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.websocket import manager, metrics_manager
from app.core.database import get_db
from app.services import errors_service

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ws", tags=["websocket"])

@router.websocket("/dashboard")
async def websocket_dashboard(websocket: WebSocket, db: AsyncSession = Depends(get_db)):
    """
    WebSocket endpoint for real-time dashboard updates.
    Sends the initial state on connection, then keeps the connection open.
    The ConnectionManager handles broadcasting updates to all connected clients.
    """
    await manager.connect(websocket)
    logger.info(f"Client connected to dashboard WebSocket. Total connections: {len(manager.active_connections)}")
    
    try:
        # Send initial state immediately upon connection
        from app.services.metrics_service import get_overview
        
        try:
            # Need to get current stats via services
            # This is a bit tricky with AsyncSession Dependency in WebSockets,
            # but we can fetch the initial state and send it.
            stats = await errors_service.get_error_stats(db, None, "1h")
            unresolved = stats.get("unresolved", 0)
            
            overview = await get_overview(db)
            active_alerts = overview.get("active_alerts", 0)
            
            initial_msg = {
                "type": "init",
                "unresolved": unresolved,
                "active_alerts": active_alerts
            }
            await websocket.send_json(initial_msg)
        except Exception as e:
            logger.error(f"Error fetching initial WS state: {e}")
            
        # Keep connection alive and wait for client messages (if any) or disconnect
        while True:
            # We don't expect the client to send much, but we need to await receive 
            # to detect disconnections properly.
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
                
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info(f"Client disconnected from dashboard WebSocket. Total connections: {len(manager.active_connections)}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        manager.disconnect(websocket)


@router.websocket("/metrics")
async def websocket_metrics(websocket: WebSocket):
    """메트릭 실시간 스트리밍 WebSocket — 5초마다 서비스별 최신 지표 push"""
    await metrics_manager.connect(websocket)
    logger.info(f"Client connected to metrics WebSocket. Total: {len(metrics_manager.active_connections)}")

    # 연결 즉시 최초 스냅샷 전송
    try:
        from app.core.metrics_streamer import _snapshot
        from app.core.database import AsyncSessionLocal
        import time
        async with AsyncSessionLocal() as db:
            snapshot = await _snapshot(db)
        if snapshot:
            await websocket.send_json({
                "type": "metrics_snapshot",
                "ts":   int(time.time() * 1000),
                "services": snapshot,
            })
    except Exception as e:
        logger.error(f"Failed to send initial metrics snapshot: {e}")

    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        metrics_manager.disconnect(websocket)
        logger.info(f"Client disconnected from metrics WebSocket. Total: {len(metrics_manager.active_connections)}")
    except Exception as e:
        logger.error(f"Metrics WebSocket error: {e}")
        metrics_manager.disconnect(websocket)
