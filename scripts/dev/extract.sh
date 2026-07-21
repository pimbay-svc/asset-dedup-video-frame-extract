#!/usr/bin/env bash
# Usage: scripts/dev/extract.sh --video <path> [--frame-count <n>] [--sampling-strategy <uniform|scene-change-detection>] [--socket-path <path>]
#
# All parameters are named flags and can be given in any order. --video is the only required one.
#
# Examples:
#   scripts/dev/extract.sh --video /shared/asset-abc123.mp4
#   scripts/dev/extract.sh --video /shared/asset-abc123.mp4 --frame-count 8
#   scripts/dev/extract.sh --video /shared/asset-abc123.mp4 --frame-count 8 --sampling-strategy scene-change-detection
#   scripts/dev/extract.sh --socket-path /sockets/video-frame-extract.sock --video /shared/asset-abc123.mp4 --frame-count 8 --sampling-strategy uniform
#
# VIDEO_PATH must already be a path this extension can read directly — i.e. somewhere on the shared
# volume, not a path on your host machine. Only the path is sent over the socket, never file bytes.
set -euo pipefail

usage() {
  echo "usage: extract.sh --video <video-path-on-shared-volume> [--frame-count <n>] [--sampling-strategy <uniform|scene-change-detection>] [--socket-path <path>]" >&2
  exit 1
}

VIDEO_PATH=""
FRAME_COUNT="5"
SAMPLING_STRATEGY="uniform"
SOCKET_PATH="./var/dev/video-frame-extract.sock"

while [ $# -gt 0 ]; do
  case "$1" in
    --video)
      VIDEO_PATH="${2:?--video requires a value}"
      shift 2
      ;;
    --frame-count)
      FRAME_COUNT="${2:?--frame-count requires a value}"
      shift 2
      ;;
    --sampling-strategy)
      SAMPLING_STRATEGY="${2:?--sampling-strategy requires a value}"
      shift 2
      ;;
    --socket-path)
      SOCKET_PATH="${2:?--socket-path requires a value}"
      shift 2
      ;;
    -h | --help)
      usage
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage
      ;;
  esac
done

[ -n "$VIDEO_PATH" ] || usage

echo "extract op -> $SOCKET_PATH  (path: $VIDEO_PATH, frame_count: $FRAME_COUNT, sampling_strategy: $SAMPLING_STRATEGY)" >&2

npx tsx "$(dirname "$0")/extract-client.ts" "$SOCKET_PATH" "$VIDEO_PATH" "$FRAME_COUNT" "$SAMPLING_STRATEGY"
