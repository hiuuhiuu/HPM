# Build Stage
FROM maven:3.8.4-openjdk-8-slim AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests

# Download OTel agent JAR (extension-only 방식이므로 agent 별도 배포 필요)
FROM alpine:latest AS downloader
RUN apk add --no-cache curl
ARG OTEL_AGENT_VERSION=2.11.0
RUN curl -fsSL -o /opentelemetry-javaagent.jar \
    "https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/download/v${OTEL_AGENT_VERSION}/opentelemetry-javaagent.jar"

# Final Stage — 두 JAR 모두 /out/ 으로 복사
FROM alpine:latest
WORKDIR /dist
COPY --from=build /app/target/hamster-extension-0.1.0.jar /dist/hamster-extension.jar
COPY --from=downloader /opentelemetry-javaagent.jar /dist/opentelemetry-javaagent.jar
CMD ["sh", "-c", "cp /dist/hamster-extension.jar /out/ && cp /dist/opentelemetry-javaagent.jar /out/"]
