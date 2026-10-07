FROM maven:3.9-eclipse-temurin-21
RUN apt-get update && apt-get install -y --no-install-recommends strace python3 && rm -rf /var/lib/apt/lists/*
# JUnit 5 jars resolved once at image build, so test runs are offline.
COPY java-deps.pom.xml /deps/pom.xml
RUN cd /deps && mvn -q dependency:copy-dependencies -DoutputDirectory=/opt/junit && ls /opt/junit
