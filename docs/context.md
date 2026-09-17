# Context

> Working memory, not a historical record.
> Continuously edited, not append-only — unlike DECISIONS.md.
> When something here resolves: delete it if it was only ever local/temporary, or promote it to DECISIONS.md if it turned out to matter beyond this moment.
> Don't let resolved items pile up here.

## Current focus

Nothing in progress — repo is in a stable, maintenance state.

## Open questions

None currently.

## Known limitations / non-goals (for now)

- **No hashing here — `core` sends the extracted frame paths to `image-hash` itself.**
  This is a deliberate scope narrowing from an earlier HTTP-based design, where this same service also hashed each extracted frame via a call back to `asset-dedup-core`'s own `POST /hash` and combined the per-frame hashes into one — see `docs/DECISIONS.md`, 2026-07-24, for the full before/after.
  If you find yourself wanting to add hash computation or a combine-strategy here, that almost certainly means the feature belongs in `image-hash`, not here.

- **`scene-change-detection` pads instead of returning a short result.**
  `selectTimestamps()` in `videoProvider.ts` never returns fewer than `frame_count` frames. `uniform` has nothing to pad against (bounded by the video's own duration), but for `scene-change-detection`, when detected cuts fall short of `frame_count`, `fillRemainderWithEven()` tops the result up with evenly spaced timestamps so `paths` always has exactly `frame_count` entries.
  This is intentional (see `docs/DECISIONS.md`, 2026-07-27), not an oversight — don't "fix" it to return a short array without checking first, downstream code may rely on the count being stable.
  Padding is delegated to the pure `fillRemainderWithEven()` in `timestampSelection.ts`, kept separate from the ffmpeg-spawning provider so it's unit-testable in isolation (mirrors how `pdf-page-extract` keeps `pageSelection.ts` separate from `pdfProvider.ts`).

## Implementation notes

- **Real scene-change detection, not I-frame probing — and a bug that hid in the gap.**
  `sampling_strategy: "scene-change-detection"` uses ffmpeg's `scene` score filter (`select='gt(scene,0)'` via the `movie` lavfi filter) to find actual visual cuts, ranked by score — not `-skip_frame nokey` I-frame probing, which answers a different question (codec compression keyframes, not content changes).
  An earlier version of `probeSceneChangeTimestamps()` requested `frame=pkt_pts_time`, which current ffmpeg (6.1.x, what `docker/Dockerfile`'s `apt-get install ffmpeg` pulls in) has renamed to `pts_time`. The old field name was silently dropped from ffprobe's CSV output rather than erroring, which shifted every remaining column over by one — every parsed "timestamp" was actually a score, every score was `undefined`, and the `Number.isFinite` guard silently rejected every candidate. The net effect: `scene-change-detection` always fell back to `uniform` sampling, with no error anywhere.
  It was caught only because a test asserted the actual detected timestamps against values verified independently against real `ffprobe` output, instead of asserting just the returned array's length — a length-only assertion passes identically whether real detection ran or the fallback silently took over.
  If you touch `probeSceneChangeTimestamps()`, keep (or strengthen) that value-level assertion in `videoProvider.test.ts`; don't quietly weaken it back to a length check.

## Ideas / future plans

None currently.
