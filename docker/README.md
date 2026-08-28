# asset-dedup-video-frame-extract

Frame-extraction extension for `asset-dedup-core`. Given one or more video paths on a shared volume, it extracts N frames per video and writes each as a PNG file back onto that same volume. Hashing is out of scope — `core` sends the extracted frame paths to `image-hash` itself afterward. There is no HTTP API: `core` connects to this service as a client over a single persistent Unix domain socket on the shared volume, and that socket is the only interface this service exposes.

## Quick Start

```bash
docker run --rm \
  -v video-frame-extract-sockets:/sockets \
  -v asset-dedup-shared:/shared \
  -e SOCKET_PATH=/sockets/video-frame-extract.sock \
  -e SHARED_VOLUME_DIR=/shared \
  pimbay/asset-dedup-video-frame-extract:latest
```

Both volumes must also be mounted into the `asset-dedup-core` container so it can reach the socket file and the source videos/extracted frames. This service does not do anything useful standalone — it only responds to `extract` requests sent by `core`.

## Docker Compose

```yaml
services:
  video-frame-extract:
    image: pimbay/asset-dedup-video-frame-extract:latest
    volumes:
      - video-frame-extract-sockets:/sockets
      - asset-dedup-shared:/shared
    environment:
      SOCKET_PATH: /sockets/video-frame-extract.sock
      SHARED_VOLUME_DIR: /shared
    restart: unless-stopped

  # asset-dedup-core must mount the same two volumes to reach this service.
```

No `depends_on`/health-gating is required on `core`'s side — this service creates the socket directory and starts listening on boot, and `core` simply retries the connection until the socket exists. No ports are published; there's nothing to expose besides the socket file on the shared volume.

## Environment Variables

| Variable                | Required | Default                                    | Description                                                                                              |
| ----------------------- | -------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `SOCKET_PATH`           | Yes      | —                                          | Filesystem path of the Unix domain socket this service listens on.                                       |
| `SHARED_VOLUME_DIR`     | Yes      | —                                          | Base directory shared with `core`: source videos are read from here, and `OUTPUT_DIR` defaults under it. |
| `OUTPUT_DIR`            | No       | `${SHARED_VOLUME_DIR}/video-frame-extract` | Directory extracted PNG frames are written into.                                                         |
| `MAX_VIDEO_DURATION_S`  | No       | `3600`                                     | Videos longer than this are rejected as `video_too_long` before extraction starts.                       |
| `LOG_LEVEL`             | No       | `info`                                     | pino level: `trace`\|`debug`\|`info`\|`warn`\|`error`\|`fatal`\|`silent`.                                |
| `FFMPEG_TIMEOUT_MS`     | No       | `20000`                                    | Hard timeout (ms) for a single `ffmpeg`/`ffprobe` invocation.                                            |
| `TTL_SWEEP_INTERVAL_MS` | No       | `300000`                                   | How often the background sweep of `OUTPUT_DIR` runs.                                                     |
| `TTL_RETENTION_MS`      | No       | `3600000`                                  | Age past which the TTL sweep deletes a leftover output file — a backstop if `core` crashes mid-pipeline. |

`FFMPEG_BIN`/`FFPROBE_BIN` already point at the `ffmpeg`/`ffprobe` binaries baked into the image; only set them if you're mounting in custom binaries.

## Volumes

| Container path | Description                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| `/sockets`     | Mount point for `SOCKET_PATH` — shared with `core` so it can connect as a client.                          |
| `/shared`      | Mount point for `SHARED_VOLUME_DIR` — source videos in, extracted PNG frames out. Also shared with `core`. |

Neither path needs to exist beforehand — the container creates and `chown`s both to its non-root runtime user on startup. They do need to be the same volumes (or equivalent bind mounts) that `asset-dedup-core` mounts, or `core` won't be able to reach the socket or the video/frame files.

## Ports / Sockets

| Port / Path                                                 | Protocol    | Description                                                                                                                                                    |
| ----------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `${SOCKET_PATH}` (e.g. `/sockets/video-frame-extract.sock`) | Unix socket | Length-prefixed JSON protocol. `core` connects as the client; this service is the server. No auth beyond the socket being reachable only on the shared volume. |

No TCP ports are exposed.

## Tags

| Tag      | Description                         |
| -------- | ----------------------------------- |
| `latest` | latest stable release               |
| `1.0`    | major.minor — updated on each patch |
| `1.0.0`  | exact version                       |

Images are published to both registries on each release:

```bash
docker pull pimbay/asset-dedup-video-frame-extract:latest
docker pull ghcr.io/pimbay-svc/asset-dedup-video-frame-extract:latest
```

## License

Public domain — Unlicense

Created by Jan Sarmir · No conditions · No copyright
