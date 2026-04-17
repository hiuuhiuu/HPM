#!/bin/bash
# Hamster APM Agent Build Script
# OTel 공식 Agent + Hamster 확장 JAR 분리 빌드
#
# 산출물:
#   dist/opentelemetry-javaagent.jar  — 공식 OTel Java Agent (원본)
#   dist/hamster-extension.jar        — Hamster 확장 (클래스 + SPI)

echo "Building Hamster APM Agent..."
cd "$(dirname "$0")"

# Build the docker image (소스 변경이 항상 반영되도록 --no-cache 사용)
docker build --no-cache -t hamster-agent-builder .

# Run the container and mount current directory to get the JARs
mkdir -p dist
docker run --rm -v "$(pwd)/dist:/out" hamster-agent-builder

echo "--------------------------------------------------"
echo "Build Complete!"
echo ""
echo "산출물:"
ls -lh dist/opentelemetry-javaagent.jar dist/hamster-extension.jar 2>/dev/null
echo ""
echo "WAS JVM 옵션:"
echo " -javaagent:/waslib/opentelemetry-javaagent.jar"
echo " -Dotel.javaagent.extensions=/waslib/hamster-extension.jar"
echo " -Dotel.exporter.otlp.endpoint=http://<APM-SERVER-IP>:8080/otlp"
echo " -Dotel.exporter.otlp.protocol=http/protobuf"
echo " -Dotel.service.name=<서비스명>"
echo " -Dotel.resource.attributes=service.instance.id=<인스턴스명>"
echo " -Dotel.metrics.exporter=otlp"
echo " -Dotel.traces.exporter=otlp"
echo " -Dotel.logs.exporter=otlp"
echo ""
echo "메서드 후킹 설정 (선택):"
echo " /waslib/hamster-methods.conf 파일 생성 후 WAS 재시작"
echo "--------------------------------------------------"
