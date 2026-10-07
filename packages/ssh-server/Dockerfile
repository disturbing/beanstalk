# syntax=docker/dockerfile:1
# check=skip=FromPlatformFlagConstDisallowed
# The SSH server image (git over SSH, docs/claude-opus/21-git-over-ssh.md): one Rust binary on
# Debian trixie, linux/amd64 (Cloudflare Containers run amd64 only, hence the constant platform).
# The build context is the repo root, so the Cargo workspace and Cargo.lock are visible:
#   docker buildx build --platform linux/amd64 -f packages/ssh-server/Dockerfile .

ARG RUST_VERSION=1.96.0
ARG DEBIAN_RELEASE=trixie

# Rust compiles on the build host's own architecture and links for x86_64 (as the runner image
# does), so Apple Silicon builds do not run rustc under emulation. ring's C parts use the same
# cross compiler.
FROM --platform=$BUILDPLATFORM rust:${RUST_VERSION}-slim-${DEBIAN_RELEASE} AS chef
ARG RUST_VERSION
ENV RUSTUP_TOOLCHAIN=${RUST_VERSION} \
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc \
    CC_x86_64_unknown_linux_gnu=x86_64-linux-gnu-gcc \
    AR_x86_64_unknown_linux_gnu=x86_64-linux-gnu-ar
RUN set -eux; \
    if [ "$(dpkg --print-architecture)" != amd64 ]; then \
      apt-get update; \
      apt-get install -y --no-install-recommends gcc-x86-64-linux-gnu libc6-dev-amd64-cross; \
      rm -rf /var/lib/apt/lists/*; \
    else \
      ln -s "$(command -v gcc)" /usr/local/bin/x86_64-linux-gnu-gcc; \
      ln -s "$(command -v ar)" /usr/local/bin/x86_64-linux-gnu-ar; \
    fi; \
    rustup target add x86_64-unknown-linux-gnu; \
    cargo install cargo-chef --locked --version 0.1.78
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --target x86_64-unknown-linux-gnu -p ssh-server --recipe-path recipe.json
COPY . .
RUN cargo build --release --locked --target x86_64-unknown-linux-gnu -p ssh-server

FROM --platform=linux/amd64 debian:${DEBIAN_RELEASE}-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --no-create-home --shell /usr/sbin/nologin ssh-server
COPY --from=builder /app/target/x86_64-unknown-linux-gnu/release/ssh-server /usr/local/bin/ssh-server
USER ssh-server
# SSH_HOST_KEY comes from the owning Worker (a secret, passed per start); never baked in.
ENV SSH_PORT=2222 \
    PORT=8080 \
    GATEWAY_URL=http://gateway.internal \
    RUST_LOG=info
EXPOSE 2222 8080
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/ssh-server"]
