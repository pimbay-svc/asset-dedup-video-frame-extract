# asset-dedup-video-frame-extract

[![Docker Image](https://img.shields.io/badge/docker.io-pimbay%2Fasset--dedup--video--frame--extract-blue?style=flat-square&logo=docker)](https://hub.docker.com/r/pimbay/asset-dedup-video-frame-extract)
[![Node Version](https://img.shields.io/badge/node-%3E%3D24-339933?style=flat-square&logo=node.js)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-Unlicense-green?style=flat-square)](LICENSE)
[![Coverage](https://img.shields.io/badge/coverage-100%25-brightgreen?style=flat-square)](https://codeberg.org/pimbay-svc/asset-dedup-video-frame-extract)
[![Mutation Score](https://img.shields.io/badge/MSI-100%25-brightgreen?style=flat-square)](https://codeberg.org/pimbay-svc/asset-dedup-video-frame-extract)

Frame-extraction extension for `asset-dedup-core`.
Given one or more video paths on a shared volume, extracts N frames per video and writes each as a PNG file on that same volume.
Hashing is out of scope — `core` sends the extracted frame paths to `image-hash` itself afterward.
Communication is a single persistent Unix-domain-socket connection from `core` (this service is the server), never HTTP — see the cross-repo protocol spec for the full design.

## Quick Start (Local)

```bash
git clone https://codeberg.org/pimbay-svc/asset-dedup-video-frame-extract.git
cd asset-dedup-video-frame-extract
npm install
cp .env.example .env
npm run dev
```

Requires `ffmpeg`/`ffprobe` on `PATH` (or `FFMPEG_BIN`/`FFPROBE_BIN` pointing at them):

```bash
# Debian/Ubuntu
sudo apt-get install ffmpeg
```

`SOCKET_PATH` and `SHARED_VOLUME_DIR` must point at paths this process can actually read/write — a volume shared with `asset-dedup-core` in production, any local directory for standalone dev.

## Quick Start (Docker)

```bash
docker compose up --build
```

Builds the image (Node runtime + `ffmpeg` in the same container, see `docker/Dockerfile`) and mounts two named volumes shared with `asset-dedup-core`: one for the socket file, one for source videos/extracted frames.
No TCP port is published — the only interface this service has is the socket file on the shared volume.

Published images (built from the same tag, pushed to both registries on release — see `.github/workflows/release.yml`):

```bash
docker pull pimbay/asset-dedup-video-frame-extract:latest
docker pull ghcr.io/pimbay-svc/asset-dedup-video-frame-extract:latest
```

## Usage

The smallest useful thing this service does: extract the default 5 frames (`uniform` sampling) from one video already sitting on the shared volume.
`scripts/dev/extract.sh` sends an `extract` op directly to a running instance — no full `core` client setup needed.

```bash
scripts/dev/extract.sh --video /shared/clip.mp4
```

```text
extract op -> ./var/dev/video-frame-extract.sock  (path: /shared/clip.mp4, frame_count: 5, sampling_strategy: uniform)
{
  "outputs": {
    "id1": {
      "paths": [
        "/shared/video-frame-extract/a1b2c3d4-0.png",
        "/shared/video-frame-extract/a1b2c3d4-1.png",
        "/shared/video-frame-extract/a1b2c3d4-2.png",
        "/shared/video-frame-extract/a1b2c3d4-3.png",
        "/shared/video-frame-extract/a1b2c3d4-4.png"
      ]
    }
  }
}
```

`--frame-count`, `--sampling-strategy` (`uniform`/`scene-change-detection`), and `--socket-path` are all optional:

```bash
scripts/dev/extract.sh --video /shared/clip.mp4
scripts/dev/extract.sh --video /shared/clip.mp4 --frame-count 8
scripts/dev/extract.sh --video /shared/clip.mp4 --frame-count 8 --sampling-strategy scene-change-detection
scripts/dev/extract.sh --socket-path /sockets/video-frame-extract.sock --video /shared/clip.mp4 --frame-count 8 --sampling-strategy uniform
```

The video path must already be readable by the running instance — a path on the shared volume, not your host machine; only the path is sent, never file bytes.
Not HTTP, so there's no `curl` equivalent — full request/response shapes, error codes, and batch requests: **[docs/api.md](docs/api.md)**.

## Configuration

Env-only.

| Variable               | Required | Description                                                                              |
| ---------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `SOCKET_PATH`          | yes      | Path of the Unix domain socket this service listens on.                                  |
| `SHARED_VOLUME_DIR`    | yes      | Base directory shared with `asset-dedup-core`: source videos read, frames written.       |
| `OUTPUT_DIR`           | no       | Where extracted frames are written. Default `${SHARED_VOLUME_DIR}/video-frame-extract`.  |
| `MAX_VIDEO_DURATION_S` | no       | Safety limit — videos longer than this are rejected as `video_too_long`. Default `3600`. |

Full reference (all env vars, incl. `FFMPEG_BIN`/`FFPROBE_BIN`, timeouts, TTL sweep settings): **[docs/configuration.md](docs/configuration.md)**.

## API

Length-prefixed JSON protocol over a private Unix domain socket shared with `asset-dedup-core`; no auth beyond the socket file itself being reachable only on that shared volume.

| Op        | Description                                                                          | Success response       |
| --------- | ------------------------------------------------------------------------------------ | ---------------------- |
| `extract` | Extracts `frame_count` frames per input video, written as PNGs to the shared volume. | `{ "outputs": {...} }` |

Full request/response shapes, error codes, and a usage example: **[docs/api.md](docs/api.md)**.

## Testing

```bash
npm run test:unit          # includes real ffmpeg/ffprobe runs against test/fixtures/ — nothing mocked at the OS level
npm run test:integration   # real DI container wiring, a real UDS socket pair
npm run test:all           # both
npm run test:coverage      # both, with a coverage report (target: 100%, enforced)
npm run test:mutation      # StrykerJS mutation testing (target: 100% MSI, enforced)
```

## Development Helpers

```bash
npm run js:lint       # check
npm run js:lint:fix   # fix
npm run js:format     # check
npm run js:format:fix # fix
npm run js:typecheck  # tsc --noEmit
```

## Architecture & Decisions

- **[docs/context.md](docs/context.md)** — current working state and non-obvious gotchas.
- **[docs/DECISIONS.md](docs/DECISIONS.md)** — why things are built the way they are, in the order the decisions were made.
- **[docs/CHANGELOG.md](docs/CHANGELOG.md)** — version history.

## License

Public domain — [Unlicense](LICENSE)

Created by [Jan Sarmir](https://pimbay.dev) · No conditions · No copyright

Bundled third-party dependencies and their licenses: **[docs/THIRD-PARTY-NOTICES.md](docs/THIRD-PARTY-NOTICES.md)**.
