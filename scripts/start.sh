#!/bin/bash
echo "APM 서버 시작 중..."
docker-compose up -d

echo ""
echo "서비스 상태 확인 중..."
sleep 5
docker-compose ps

echo ""
echo "접속 주소:"
echo "  대시보드:   http://localhost:3000"
echo "  API 서버:   http://localhost:8000"
echo "  API 문서:   http://localhost:8000/docs"
echo "  OTLP HTTP: http://localhost:8000/otlp (Java Agent 연결)"
