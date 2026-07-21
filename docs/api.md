# API Reference

`core` opens a single persistent Unix domain socket connection to this service and keeps it open, reconnecting on drop — see `AGENTS.md`, "UDS connection lifecycle".
Every message, both directions, is length-prefixed JSON: `[4-byte big-endian length][UTF-8 JSON payload]` (`src/infrastructure/uds/framing.ts`).
There is no per-request connect/disconnect and no auth — the socket file itself, reachable only on the shared volume, is the trust boundary.

Socket path: `SOCKET_PATH` (see [docs/configuration.md](configuration.md)).
Requests are dispatched by their `op` field (`src/presentation/uds/server.ts`); an unrecognized `op` is logged and silently ignored — no error frame is sent back, since there's no request id to correlate a reply to on a fire-and-forget bad message.

## Error format

Per-item errors (not connection- or transport-level failures) share one shape, keyed under `outputs[<id>].error`:

```json
{ "code": "corrupt_input", "message": "human-readable message" }
```

| Code             | Meaning                                                                                                                                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corrupt_input`  | The video itself is unreadable/malformed — no valid stream, `ffmpeg`/`ffprobe` rejects the container, a frame couldn't be rendered.                                                                               |
| `internal_error` | `ffmpeg`/`ffprobe` failed to start, timed out, or crashed for reasons unrelated to the input file's validity — also used for a request-level problem like an unsupported `sampling_strategy`.                     |
| `video_too_long` | Probed duration exceeds `MAX_VIDEO_DURATION_S`. An extension-specific addition beyond the shared spec's two standard codes — a policy rejection of an otherwise-valid file, not a corruption or internal failure. |

A failure on one item in a batch never prevents the rest from being attempted — each input is handled independently, and its result (success or error, never both) is reported under its own key in `outputs`, mirroring the request's `inputs` keys exactly.

---

## `op: "extract"`

Extracts `frame_count` frames from each input video and writes each as a PNG on the shared volume.
Handled by `src/presentation/uds/socket/extract.socket.ts`.

**Request**

```json
{
  "op": "extract",
  "config": {
    "sampling_strategy": "uniform",
    "frame_count": 5
  },
  "inputs": {
    "id1": { "path": "/shared/asset-abc123.mp4" }
  }
}
```

| Field                      | Type                                      | Description                                                                                                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.sampling_strategy` | `"uniform"` \| `"scene-change-detection"` | `uniform`: evenly spaced timestamps across the video's duration. `scene-change-detection`: real cut detection via ffmpeg's `scene` score filter, falling back to `uniform` per-video if detection finds nothing or fails. Invalid value fails the whole batch (see below), not per item. |
| `config.frame_count`       | `number`                                  | Frames to extract per input video.                                                                                                                                                                                                                                                       |
| `inputs.<id>.path`         | `string`                                  | Absolute path to the source video, already readable on the shared volume — never file bytes. `<id>` is request-scoped only (never used to derive output filenames — see `AGENTS.md`, "Paths in, paths out") and can repeat across separate requests.                                     |

**Note — `scene-change-detection` always returns exactly `frame_count` frames.**
If fewer real cuts are detected than requested, the remainder is topped up with evenly spaced timestamps (`fillRemainderWithEven`) rather than returning a shorter `paths` array — see `docs/DECISIONS.md`.
Callers wanting only real cuts, however many exist, should use `uniform` and interpret the result themselves.

**Response**

```json
{
  "outputs": {
    "id1": { "paths": ["/shared/video-frame-extract/a1b2c3d4-0.png", "/shared/video-frame-extract/a1b2c3d4-1.png"] }
  }
}
```

One entry per input key, in the same shape as the request's `inputs`: either `{ "paths": string[] }` on success (one path per extracted frame, in timestamp order) or `{ "error": { "code", "message" } }` on failure — never both.
Output filenames follow `{uniqueId}-{index}.png` under `OUTPUT_DIR`, where `uniqueId` is generated per input item (not derived from the request's own `id` keys).

**Errors**

| Code             | Cause                                                                                                                                                                                                                                                                                                                   |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `corrupt_input`  | Per item. Duration probe or frame extraction failed against that specific video.                                                                                                                                                                                                                                        |
| `video_too_long` | Per item. That video's probed duration exceeds `MAX_VIDEO_DURATION_S`.                                                                                                                                                                                                                                                  |
| `internal_error` | Per item, for an `ffmpeg`/`ffprobe` process failure unrelated to the input; or for every item in the batch at once if `config.sampling_strategy` isn't a recognized value — a malformed request-level config is reported the same way for every `id` in `inputs`, rather than silently substituting a default strategy. |

**Example** (using `scripts/dev/extract.sh`, which speaks this protocol directly — there is no `curl` equivalent since this isn't HTTP):

```bash
scripts/dev/extract.sh --video /shared/clip.mp4 --frame-count 8 --sampling-strategy scene-change-detection
```

---

Any other `op` value is logged as a warning and ignored; no response frame is sent.
A structurally malformed `extract` message (missing `config`/`inputs`, wrong field types) fails zod validation (`ExtractRequestSchema` in `extract.socket.ts`) the same way — logged as a warning and dropped entirely, no response frame — rather than throwing and taking down the connection.
