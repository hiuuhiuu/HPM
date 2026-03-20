# Stage 1: Hamster extension-only JAR 빌드
FROM maven:3.8.4-openjdk-8-slim AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests

# Stage 2: OTel agent JAR에 extension 클래스 + SPI 파일을 추가하여 올인원 JAR 생성
#
# Maven Shade로 OTel agent fat JAR을 재shading하면 ServicesResourceTransformer가
# SPI 파일을 드랍하는 문제가 있음. 대신 'jar uf'로 직접 추가하는 방식 사용:
#   - OTel agent JAR을 베이스로 복사 (MANIFEST, Premain-Class 그대로 유지)
#   - 기존 SPI 항목 추출 후 우리 항목과 머지 (덮어쓰기 방지)
#   - extension 클래스 + 머지된 SPI 파일만 추가 (MANIFEST.MF, maven 메타데이터 제외)
FROM maven:3.8.4-openjdk-8-slim AS merge
WORKDIR /merge

ARG OTEL_AGENT_VERSION=2.11.0

# 빌드 스테이지의 Maven 로컬 캐시에서 OTel agent JAR 복사
COPY --from=build \
  /root/.m2/repository/io/opentelemetry/javaagent/opentelemetry-javaagent/${OTEL_AGENT_VERSION}/opentelemetry-javaagent-${OTEL_AGENT_VERSION}.jar \
  ./base-agent.jar
COPY --from=build /app/target/hamster-extension-0.1.0.jar ./hamster-extension.jar

RUN set -e && \
    \
    # OTel agent를 최종 JAR의 베이스로 복사 (Premain-Class, MANIFEST 등 원본 유지)
    cp base-agent.jar hamster-agent.jar && \
    \
    # extension JAR을 임시 디렉토리로 추출
    mkdir -p ext-classes && \
    cd ext-classes && jar xf ../hamster-extension.jar && cd .. && \
    \
    # ── SPI 파일 머지 ──────────────────────────────────────────────────────────
    # OTel agent에 동명 SPI 파일이 있으면 기존 항목 추출 (없으면 빈 파일)
    # 그 뒤 우리 항목을 추가하여 중복 없이 머지
    SPI_CUSTOMIZER="META-INF/services/io.opentelemetry.sdk.autoconfigure.spi.AutoConfigurationCustomizerProvider" && \
    SPI_INSTR="META-INF/services/io.opentelemetry.javaagent.extension.instrumentation.InstrumentationModule" && \
    \
    unzip -p base-agent.jar "$SPI_CUSTOMIZER" > /tmp/existing_customizer.txt 2>/dev/null || true && \
    unzip -p base-agent.jar "$SPI_INSTR"       > /tmp/existing_instr.txt       2>/dev/null || true && \
    \
    cat /tmp/existing_customizer.txt "ext-classes/$SPI_CUSTOMIZER" 2>/dev/null \
        | grep -v '^[[:space:]]*$' | sort -u > /tmp/merged_customizer.txt && \
    cat /tmp/existing_instr.txt "ext-classes/$SPI_INSTR" 2>/dev/null \
        | grep -v '^[[:space:]]*$' | sort -u > /tmp/merged_instr.txt && \
    \
    cp /tmp/merged_customizer.txt "ext-classes/$SPI_CUSTOMIZER" && \
    cp /tmp/merged_instr.txt      "ext-classes/$SPI_INSTR" && \
    \
    # ── OTel agent의 MANIFEST.MF 보호 ─────────────────────────────────────────
    # extension JAR의 MANIFEST.MF를 제외하지 않으면 jar uf가 Premain-Class 등을 덮어씀
    rm -f ext-classes/META-INF/MANIFEST.MF && \
    rm -rf ext-classes/META-INF/maven && \
    \
    # extension 클래스 + 머지된 SPI 파일을 agent JAR에 추가/업데이트
    cd ext-classes && jar uf ../hamster-agent.jar . && cd .. && \
    \
    # ── 빌드 결과 검증 ────────────────────────────────────────────────────────
    echo "=== MANIFEST (Premain-Class 확인) ===" && \
    unzip -p hamster-agent.jar META-INF/MANIFEST.MF | grep -E "Premain|Agent-Class" && \
    echo "=== SPI: AutoConfigurationCustomizerProvider ===" && \
    unzip -p hamster-agent.jar "$SPI_CUSTOMIZER" && \
    echo "=== Hamster 클래스 포함 확인 ===" && \
    unzip -l hamster-agent.jar | grep -i hamster | grep "\.class"

# Stage 3: 최종 JAR만 출력
FROM alpine:latest
WORKDIR /dist
COPY --from=merge /merge/hamster-agent.jar /dist/hamster-agent.jar
CMD ["cp", "/dist/hamster-agent.jar", "/out/"]
