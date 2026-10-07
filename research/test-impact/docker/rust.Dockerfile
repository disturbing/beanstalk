FROM rust:1.90-slim-trixie
RUN apt-get update && apt-get install -y --no-install-recommends strace python3 && rm -rf /var/lib/apt/lists/*
