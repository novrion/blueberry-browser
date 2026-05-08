#!/usr/bin/env bash
set -euo pipefail

# Fetches a known-good Firecracker-compatible vmlinux kernel image.
# Usage: ./fetch-kernel.sh [destination-dir]
#
# Output: <dest>/vmlinux

DEST="${1:-$(cd "$(dirname "$0")/.." && pwd)/assets}"
mkdir -p "$DEST"

ARCH=$(uname -m)
case "$ARCH" in
  x86_64)  KARCH="x86_64" ;;
  aarch64) KARCH="aarch64" ;;
  *) echo "unsupported arch: $ARCH" >&2; exit 1 ;;
esac

# Firecracker CI publishes prebuilt guest kernels in this S3 bucket.
FC_VER="${FC_VER:-v1.11}"
KVER="${KVER:-6.1.102}"
URL="https://s3.amazonaws.com/spec.ccfc.min/firecracker-ci/${FC_VER}/${KARCH}/vmlinux-${KVER}"
OUT="$DEST/vmlinux"

echo "fetching kernel: $URL"
curl -fL --retry 3 --connect-timeout 15 -o "$OUT" "$URL"
chmod 0644 "$OUT"
echo "kernel saved → $OUT ($(stat -c '%s' "$OUT") bytes)"
