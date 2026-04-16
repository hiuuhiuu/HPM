# Build Stage
FROM maven:3.8.4-openjdk-8-slim AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests

# Repack Stage — Hamster extension 클래스를 OTel inst/ 규약으로 재배치
# OTel AgentClassLoader는 inst/ 하위 .classdata 파일만 extension으로 인식한다.
# maven-shade가 최상위에 놓은 Hamster 클래스를 inst/ 구조로 이동한다.
FROM eclipse-temurin:8-jdk AS repack
WORKDIR /repack
COPY --from=build /app/target/hamster-agent.jar /repack/hamster-agent.jar

RUN set -e \
    && mkdir work && cd work \
    && jar xf ../hamster-agent.jar \
    #
    # 1. Hamster .class → inst/ 하위 .classdata 로 이동
    #
    && for f in $(find io/opentelemetry/extension/hamster -name "*.class" 2>/dev/null); do \
         target="inst/${f%.class}.classdata"; \
         mkdir -p "$(dirname "$target")"; \
         mv "$f" "$target"; \
       done \
    && rm -rf io/opentelemetry/extension/hamster \
    #
    # 2. inst/META-INF/services/ SPI에 Hamster 항목 추가 (줄바꿈 보장)
    #
    && printf '\nio.opentelemetry.extension.hamster.HamsterExtensionCustomizer\n' \
       >> inst/META-INF/services/io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider \
    && printf '\nio.opentelemetry.extension.hamster.HamsterInstrumentationModule\n' \
       >> inst/META-INF/services/io.opentelemetry.javaagent.extension.instrumentation.InstrumentationModule \
    #
    # 3. 최상위 SPI에서 Hamster 항목 제거 (중복 방지)
    #
    && sed -i '/hamster/d' META-INF/services/io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider 2>/dev/null || true \
    && sed -i '/hamster/d' META-INF/services/io.opentelemetry.javaagent.extension.instrumentation.InstrumentationModule 2>/dev/null || true \
    #
    # 4. 올인원 JAR 재패키징 (MANIFEST 보존)
    #
    && jar cf ../hamster-agent-repacked.jar -C . . \
    && cp META-INF/MANIFEST.MF /tmp/MANIFEST.MF \
    && jar cfm ../hamster-agent-repacked.jar /tmp/MANIFEST.MF -C . .

# Final Stage
FROM alpine:latest
WORKDIR /dist
COPY --from=repack /repack/hamster-agent-repacked.jar /dist/hamster-agent.jar
CMD ["cp", "/dist/hamster-agent.jar", "/out/"]
