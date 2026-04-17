# ============================================================
#  Hamster APM Agent Build
#
#  산출물:
#    /out/opentelemetry-javaagent.jar  — 공식 OTel Java Agent (원본)
#    /out/hamster-extension.jar        — Hamster 확장 (SPI + 클래스)
#
#  사용법 (WAS JVM 옵션):
#    -javaagent:/waslib/opentelemetry-javaagent.jar
#    -Dotel.javaagent.extensions=/waslib/hamster-extension.jar
# ============================================================

# ── 1단계: 확장 JAR 빌드 ──────────────────────────────────
FROM maven:3.8.4-openjdk-8-slim AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src

# extension-only JAR (shade 없이 순수 Hamster 클래스 + SPI만 포함)
RUN mvn clean package -DskipTests -DskipShade=true \
    && mv target/hamster-agent.jar target/hamster-extension.jar

# ── 2단계: 공식 OTel Agent 다운로드 ─────────────────────────
FROM alpine:latest AS download
ARG OTEL_VERSION=2.11.0
RUN apk add --no-cache curl \
    && curl -sSL -o /tmp/opentelemetry-javaagent.jar \
       "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${OTEL_VERSION}/opentelemetry-javaagent.jar"

# ── 3단계: 산출물 조합 ──────────────────────────────────────
FROM alpine:latest
WORKDIR /dist
COPY --from=build    /app/target/hamster-extension.jar  /dist/hamster-extension.jar
COPY --from=download /tmp/opentelemetry-javaagent.jar  /dist/opentelemetry-javaagent.jar
CMD ["sh", "-c", "cp /dist/opentelemetry-javaagent.jar /out/ && cp /dist/hamster-extension.jar /out/"]
