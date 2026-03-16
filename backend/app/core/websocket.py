import json
from fastapi import WebSocket

class ConnectionManager:
    def __init__(self):
        self.active_connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: dict):
        """Send a JSON message to all connected clients."""
        if not self.active_connections:
            return

        json_msg = json.dumps(message)
        dead_connections = []

        for connection in self.active_connections:
            try:
                await connection.send_text(json_msg)
            except Exception:
                dead_connections.append(connection)

        for dead in dead_connections:
            self.disconnect(dead)

    async def ping_all(self):
        """주기적 핑으로 좀비 연결을 조기 탐지·제거"""
        if not self.active_connections:
            return
        dead_connections = []
        for connection in self.active_connections:
            try:
                await connection.send_text('{"type":"ping"}')
            except Exception:
                dead_connections.append(connection)
        for dead in dead_connections:
            self.disconnect(dead)

# Global manager instances
manager = ConnectionManager()          # 대시보드 알림용
metrics_manager = ConnectionManager()  # 메트릭 실시간 스트리밍용
