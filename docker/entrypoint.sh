#!/bin/sh
set -e

mkdir -p /sockets
chown appuser:appuser /sockets

OUTPUT_DIR="${OUTPUT_DIR:-${SHARED_VOLUME_DIR:-/shared}/video-frame-extract}"
mkdir -p "$OUTPUT_DIR"
chown appuser:appuser "$OUTPUT_DIR"

exec gosu appuser "$@"