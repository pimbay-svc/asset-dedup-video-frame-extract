#!/usr/bin/env bash
for arg in "$@"; do
  if [ "$arg" = "lavfi" ]; then
    sleep 60
    exit 0
  fi
done
exec ffprobe "$@"
