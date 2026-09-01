# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/).

## [Unreleased]

## [1.0.1] - 2026-09-01

## [1.0.0] - 2026-08-24

### Added

- Unix-domain-socket extraction service: `core` is the client, this service is the server, connecting once and staying open (`docs/DECISIONS.md`, 2026-07-24) — no HTTP, no auth beyond the shared-volume socket file itself.
- Single `op: "extract"` request/response over the socket (see `docs/api.md`), plus a standalone `presentation/uds/healthcheck.ts` script invoked directly by Docker `HEALTHCHECK`, not exposed as a network endpoint.
- Two frame-sampling strategies — `uniform` (evenly spaced timestamps) and `scene-change-detection` (real cut detection via ffmpeg's `scene` score filter), with automatic fallback to `uniform` when scene-change detection finds nothing or fails.
- Both input video and every extracted frame are paths on a shared volume, never in-process buffers.
- `MAX_VIDEO_DURATION_S` safety limit — rejects a video as `video_too_long` before extracting any frame if its probed duration exceeds it.
- Background TTL sweep of `OUTPUT_DIR` as a defensive backstop against leaked disk space if `core` crashes before consuming/deleting its output.
