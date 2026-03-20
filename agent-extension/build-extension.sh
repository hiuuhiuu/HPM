#!/bin/bash
# Hamster APM Java Agent Build Script
# Extension-only JAR + OTel agent JAR 을 dist/ 에 빌드

echo "Building Hamster APM Extension JAR..."
cd "$(dirname "$0")"

# Build the docker image
docker build -t hamster-agent-builder .

# Run the container and mount current directory to get the JARs
mkdir -p dist
docker run --rm -v "$(pwd)/dist:/out" hamster-agent-builder

echo "--------------------------------------------------"
echo "Build Complete!"
echo "Artifacts:"
echo "  agent-extension/dist/hamster-extension.jar      (Hamster 확장 JAR)"
echo "  agent-extension/dist/opentelemetry-javaagent.jar (OTel Java Agent)"
echo ""
echo "How to use (WAS JVM 옵션):"
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
