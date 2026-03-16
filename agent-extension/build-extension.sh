#!/bin/bash
# Hamster APM Java Agent Extension Build Script
# This script builds the extension JAR using Docker.

echo "Building Hamster Java Agent Extension..."
cd "$(dirname "$0")"

# Build the docker image
docker build -t hamster-extension-builder .

# Run the container and mount current directory to get the JAR
mkdir -p dist
docker run --rm -v "$(pwd)/dist:/out" hamster-extension-builder

echo "--------------------------------------------------"
echo "Build Complete!"
echo "Artifact: agent-extension/dist/hamster-agent-extension.jar"
echo ""
echo "How to use:"
echo "Add the following options to your WAS JVM arguments:"
echo " -javaagent:/path/to/opentelemetry-javaagent.jar \\"
echo " -Dotel.javaagent.extensions=/path/to/hamster-agent-extension.jar \\"
echo " -Dhamster.backend.url=http://<backend-ip>:8000"
echo "--------------------------------------------------"
