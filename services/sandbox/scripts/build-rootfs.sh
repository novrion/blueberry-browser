#!/usr/bin/env bash
set -euo pipefail

# Builds a minimal Alpine rootfs ext4 image with python3, bash, coreutils,
# and the in-VM agent binary as PID 1 (init).
#
# Requirements (host): docker
# Output: <dest>/rootfs.ext4
#
# Usage:
#   ./build-rootfs.sh [destination-dir]

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${1:-$ROOT/assets}"
mkdir -p "$DEST"

OUT="$DEST/rootfs.ext4"
SIZE_MB="${SANDBOX_ROOTFS_MB:-2048}"
ALPINE_VER="${ALPINE_VER:-3.20}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker required to build rootfs" >&2
  exit 1
fi

# Cross-compile guest-agent for x86_64-unknown-linux-musl using a Rust container.
echo "building guest agent (musl)…"
docker run --rm \
  -v "$ROOT":/work \
  -w /work \
  rust:1.85-alpine sh -c '
    apk add --no-cache musl-dev pkgconf openssl-dev openssl-libs-static linux-headers && \
    rustup target add x86_64-unknown-linux-musl && \
    cargo build --release --target x86_64-unknown-linux-musl -p sandbox-guest-agent
  '

AGENT_BIN="$ROOT/target/x86_64-unknown-linux-musl/release/sandbox-agent"
if [[ ! -x "$AGENT_BIN" ]]; then
  echo "agent binary missing: $AGENT_BIN" >&2
  exit 1
fi

# Build rootfs by extracting an Alpine Docker image.
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
ROOTFS_DIR="$WORK/rootfs"
mkdir -p "$ROOTFS_DIR"

echo "extracting alpine:$ALPINE_VER…"
CID=$(docker create "alpine:$ALPINE_VER")
docker export "$CID" | tar -x -C "$ROOTFS_DIR"
docker rm "$CID" >/dev/null

# Install runtime packages inside the rootfs via chroot in a throwaway container.
# Pulls from the community repo for the data-science Python wheels.
docker run --rm \
  -v "$ROOTFS_DIR":/rootfs \
  "alpine:$ALPINE_VER" sh -c '
    set -e
    cat > /rootfs/etc/apk/repositories <<EOF
http://dl-cdn.alpinelinux.org/alpine/v'"$ALPINE_VER"'/main
http://dl-cdn.alpinelinux.org/alpine/v'"$ALPINE_VER"'/community
EOF
    apk --root /rootfs --update-cache --initdb add \
      alpine-baselayout busybox openrc \
      bash coreutils findutils grep sed gawk \
      ca-certificates curl wget \
      iproute2 \
      tzdata \
      git \
      jq \
      file \
      tar gzip xz zip unzip \
      sqlite \
      ffmpeg-libs \
      imagemagick \
      poppler-utils \
      python3 py3-pip \
      py3-numpy \
      py3-pandas \
      py3-scipy \
      py3-matplotlib \
      py3-pillow \
      py3-openpyxl \
      py3-xlsxwriter \
      py3-xlrd \
      py3-requests \
      py3-beautifulsoup4 \
      py3-lxml \
      py3-html5lib \
      py3-yaml \
      py3-jinja2 \
      py3-tabulate \
      py3-tqdm \
      py3-dateutil \
      py3-six
  '

# Install agent
install -Dm0755 "$AGENT_BIN" "$ROOTFS_DIR/usr/local/bin/sandbox-agent"

# Custom PID-1 at /init (boot_args: init=/init). Bypasses Alpine OpenRC entirely.
# Bring up filesystems, set hostname, then exec agent as supervisor.
cat > "$ROOTFS_DIR/init" <<'INIT'
#!/bin/sh
mount -t proc  proc  /proc 2>/dev/null || true
mount -t sysfs sys   /sys  2>/dev/null || true
mount -t devtmpfs dev /dev 2>/dev/null || true
mkdir -p /dev/pts /run /tmp /work
mount -t devpts devpts /dev/pts 2>/dev/null || true
mount -t tmpfs  tmpfs  /run 2>/dev/null || true
mount -t tmpfs  tmpfs  /tmp 2>/dev/null || true
hostname sandbox 2>/dev/null || true
ip link set lo up 2>/dev/null || true

# Run the agent forever; respawn if it dies (don't panic kernel)
while :; do
  /usr/local/bin/sandbox-agent
  echo "sandbox-agent exited, respawning in 1s" >&2
  sleep 1
done
INIT
chmod 0755 "$ROOTFS_DIR/init"

# Create a /work scratch dir for user code
mkdir -p "$ROOTFS_DIR/work"

# Skeleton resolv.conf (will be overwritten if networking is wired up)
echo "nameserver 1.1.1.1" > "$ROOTFS_DIR/etc/resolv.conf"

# Make ext4 image
echo "packing ext4 image (${SIZE_MB} MiB) → $OUT"
truncate -s "${SIZE_MB}M" "$OUT"
mkfs.ext4 -F -L sandbox-root "$OUT" >/dev/null

MNT="$(mktemp -d)"
sudo mount -o loop "$OUT" "$MNT"
sudo cp -a "$ROOTFS_DIR"/. "$MNT"/
sudo umount "$MNT"
rmdir "$MNT"

echo "rootfs ready: $OUT ($(stat -c '%s' "$OUT") bytes)"
