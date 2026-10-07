FROM golang:1.25-trixie
RUN apt-get update && apt-get install -y --no-install-recommends strace python3 && rm -rf /var/lib/apt/lists/*
ENV GOFLAGS=-mod=mod GOTOOLCHAIN=local
