# ---- build stage: orchestrator -------------------------------------------
FROM rust:1.85-bookworm AS build

WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends \
        pkg-config libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml ./Cargo.toml
COPY orchestrator ./orchestrator
COPY guest-agent  ./guest-agent
COPY proto        ./proto

RUN cargo build --release -p sandbox-orchestrator \
    && cp /src/target/release/sandbox-orchestrator /usr/local/bin/sandbox-orchestrator


# ---- runtime stage --------------------------------------------------------
FROM debian:bookworm-slim AS runtime

ARG FC_VERSION=v1.10.1
ARG TARGETARCH=amd64

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    case "${TARGETARCH}" in \
      amd64) ARCH="x86_64" ;; \
      arm64) ARCH="aarch64" ;; \
      *) echo "unsupported arch: ${TARGETARCH}"; exit 1 ;; \
    esac; \
    curl -fL "https://github.com/firecracker-microvm/firecracker/releases/download/${FC_VERSION}/firecracker-${FC_VERSION}-${ARCH}.tgz" \
        -o /tmp/fc.tgz; \
    mkdir -p /tmp/fc; \
    tar -xzf /tmp/fc.tgz -C /tmp/fc; \
    install -Dm0755 "/tmp/fc/release-${FC_VERSION}-${ARCH}/firecracker-${FC_VERSION}-${ARCH}" /usr/local/bin/firecracker; \
    rm -rf /tmp/fc /tmp/fc.tgz

COPY --from=build /usr/local/bin/sandbox-orchestrator /usr/local/bin/sandbox-orchestrator

RUN mkdir -p /opt/sandbox /var/lib/sandbox

ENV SANDBOX_BIND=0.0.0.0:8080 \
    SANDBOX_KERNEL=/opt/sandbox/vmlinux \
    SANDBOX_ROOTFS=/opt/sandbox/rootfs.ext4 \
    SANDBOX_FC_BIN=/usr/local/bin/firecracker \
    SANDBOX_WORK_DIR=/var/lib/sandbox \
    RUST_LOG=info,sandbox_orchestrator=info

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/sandbox-orchestrator"]
