#!/bin/bash
# Hamster APM Java Agent Build Script
# OTel agent JAR에 Hamster extension 클래스를 추가한 올인원 JAR 빌드

echo "Building Hamster APM Agent (all-in-one)..."
cd "$(dirname "$0")"

# Build the docker image
docker build -t hamster-agent-builder .

# Run the container and mount current directory to get the JAR
mkdir -p dist
docker run --rm -v "$(pwd)/dist:/out" hamster-agent-builder

echo "--------------------------------------------------"
echo "Build Complete!"
echo "Artifact: agent-extension/dist/hamster-agent.jar"
echo ""
echo "How to use (WAS JVM 옵션):"
echo " -javaagent:/waslib/hamster-agent.jar"
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
