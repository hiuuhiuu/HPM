# Build Stage
FROM maven:3.8.4-openjdk-8-slim AS build
WORKDIR /app
COPY pom.xml .
COPY src ./src
RUN mvn clean package -DskipTests

# Final Stage (just to copy the artifact out)
FROM alpine:latest
WORKDIR /dist
COPY --from=build /app/target/hamster-agent-0.1.0.jar /dist/hamster-agent.jar
CMD ["cp", "/dist/hamster-agent.jar", "/out/"]
