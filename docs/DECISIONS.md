# Decisions

> Append-only architectural decision log — the "why", not the "what's next" (that's context.md).
> One entry per decision: what was decided and why, not a discussion transcript.
> If it's a cheap/local implementation detail → docs/context.md instead.
> If it's a pattern repeated across multiple repos → AGENTS.md instead, not here.

## Video input via temp file, extracted frames via `image2pipe` to memory

**Date:** 2026-07-21

**Decision:** Temp file for input only; frames via `ffmpeg -f image2pipe ... pipe:1`, captured from `stdout`.

**Why:** `ffmpeg`/`ffprobe` need a seekable input to extract frames at arbitrary timestamps, which piped stdin generally can't provide reliably for container formats like mp4 (metadata may be at the end of the file) — so the input has to be a real file either way.
Unlike `pdftoppm` (which has no single-page-to-stdout mode for the multi-page case), `ffmpeg` can emit a single extracted frame directly over `image2pipe`, so there's no equivalent forcing function to also write frames to disk.
Keeping frames in memory avoids a second layer of temp-file bookkeeping (naming, sorting by index, reading back) for no benefit.

**Alternatives considered:** write both the input video and every extracted frame to a per-request temp directory (matching `asset-dedup-pdf-page-extract`'s `pdftoppm` approach).

## Unix domain socket, paths on a shared volume, no hashing in this service

**Date:** 2026-07-24

**Decision:** UDS, paths only, no hashing — `core` connects once and keeps the connection open; this service only extracts frames and writes them as PNGs, `core` sends the resulting paths to `image-hash` itself.

**Why:** base64-over-HTTP made every request pay a full video's encode/decode cost even for large files, and coupled this service's own logic to hash computation it has no business owning — splitting sampling/extraction from hashing lets each extension evolve independently and lets `core` batch frame paths across extensions however it wants.
Paths-on-a-shared-volume also removes the need for this service to buffer an entire video or frame set in memory at once.
See `AGENTS.md` and `docs/context.md` for what actually ships now.

**Alternatives considered:** keep the original HTTP `POST /hash` design (base64 video in, frames captured via `image2pipe` to memory, hashed here, result returned).

**Supersedes:** Video input via temp file, extracted frames via `image2pipe` to memory.

## `scene-change-detection` tops up short results instead of returning fewer frames

**Date:** 2026-07-27

**Decision:** `fillRemainderWithEven()` continues topping a short `scene-change-detection` result up to exactly `frame_count` with evenly spaced timestamps, rather than returning fewer frames — documented here as a deliberate choice, not changed in passing.

**Why:** `frame_count` is used downstream (e.g. sizing a per-video hash pool) where a caller may reasonably expect a stable count per request; the top-up was already covered by regression tests (see `docs/context.md`, `videoProvider.test.ts`'s "forces the fillRemainderWithEven top-up path").
Returning a short result instead is a real option, but it's a behavior change with downstream impact, not a bug fix — worth revisiting deliberately rather than in passing.

**Alternatives considered:** return however many real cuts were detected, even if fewer than `frame_count`.
