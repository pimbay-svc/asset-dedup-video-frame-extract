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

## Implementation notes

- **`core` is the client, this service is the server.**
  `core` opens the connection to this service's Unix domain socket and keeps it open, reconnecting on drop — not the other way around.
  `presentation/uds/server.ts` accepts connections via `net.createServer`; it never initiates an outbound connection to `core`.
  A connection only becomes "active" once it sends its first valid frame, not merely on accept — this is what lets the Docker healthcheck (a short-lived connect-and-close probe with no `op` sent) coexist with the real, persistent connection from `core` without racing it.
  If you're touching connection-lifecycle logic, read the comment at the top of `buildUdsServer` first; the healthcheck race is easy to reintroduce by treating any accepted connection as authoritative.
  Startup also removes a stale Unix domain socket file left by an unclean shutdown (`removeStaleSocket()`) — it probe-connects first, so a _genuinely_ live listener still fails `listen()` loudly with a real `EADDRINUSE` rather than silently having its socket file stolen.

- **Paths in, paths out — never buffers.**
  Socket messages carry only paths and metadata, never raw file bytes (see spec, "Binary data policy").
  `VideoProvider.extractFrames()` reads the input video directly from its given path (`ffmpeg -i <path>`) and writes each extracted frame straight to a file (`ffmpeg` with a concrete output path, not `-f image2pipe` to `stdout`).
  The output filename convention is `{unique_id}-{sequence_index}.png`, where `unique_id` is generated per input (never derived from the request's own `id` keys, which are request-scoped only and can collide across concurrent requests — see spec, "Id scope and temp file naming").

- **`scene-change-detection` pads instead of returning a short result — implementation.**
  `selectTimestamps()` in `videoProvider.ts` delegates padding to `timestampSelection.ts`'s pure `fillRemainderWithEven()`, kept separate from the ffmpeg-spawning provider so it's unit-testable in isolation (mirrors how `pdf-page-extract` keeps `pageSelection.ts` separate from `pdfProvider.ts`).

- **Real scene-change detection, not I-frame probing — and a bug that hid in the gap.**
  `sampling_strategy: "scene-change-detection"` uses ffmpeg's `scene` score filter (`select='gt(scene,0)'` via the `movie` lavfi filter) to find actual visual cuts, ranked by score — not `-skip_frame nokey` I-frame probing, which answers a different question (codec compression keyframes, not content changes).
  An earlier version of `probeSceneChangeTimestamps()` requested `frame=pkt_pts_time`, which current ffmpeg (6.1.x, what `docker/Dockerfile`'s `apt-get install ffmpeg` pulls in) has renamed to `pts_time`. The old field name was silently dropped from ffprobe's CSV output rather than erroring, which shifted every remaining column over by one — every parsed "timestamp" was actually a score, every score was `undefined`, and the `Number.isFinite` guard silently rejected every candidate. The net effect: `scene-change-detection` always fell back to `uniform` sampling, with no error anywhere.
  It was caught only because a test asserted the actual detected timestamps against values verified independently against real `ffprobe` output, instead of asserting just the returned array's length — a length-only assertion passes identically whether real detection ran or the fallback silently took over.
  If you touch `probeSceneChangeTimestamps()`, keep (or strengthen) that value-level assertion in `videoProvider.test.ts`; don't quietly weaken it back to a length check.

- **`extract.socket.ts` request validation.**
  Requests are validated against `ExtractRequestSchema` (zod) before anything else runs; a structurally malformed message (missing `config`/`inputs`, wrong field types) is logged as a warning and dropped — no response frame — rather than throwing and crashing the connection. `dispatch()` in `server.ts` reads the `op` field via `extractOp()`, which returns `undefined` for a bare `null` message instead of throwing on `null.op` — a `null` JSON frame is valid JSON and must be handled the same way as any other unrecognized `op`, not crash the process.

- **`videoProvider.ts` is excluded from mutation testing, not from coverage.**
  `stryker.config.mjs` excludes `videoProvider.ts` and its test file from mutation runs: those tests shell out to real `ffmpeg`/`ffprobe`, and Stryker re-running the suite once per mutant would mean re-spawning real subprocesses hundreds of times — too slow, and timing-dependent (spawn/timeout races) in ways real ffmpeg won't reliably reproduce on demand inside a mutation sandbox. Coverage (`vitest.config.ts`) does not exclude it — it's still held to 100% line/branch coverage, only mutation scoring is skipped.

- **Testing real subprocesses and a real socket.**
  `test/fixtures/scene-changes.mp4` (~4.2s, four hard color cuts, generated via ffmpeg's own `lavfi` `color` source) and `test/fixtures/corrupt.mp4`/`no-duration.png` back `videoProvider.test.ts`'s real `ffmpeg`/`ffprobe` runs — nothing is mocked at the OS level.
  `test/fixtures/bin/*.sh` are small fake-binary test doubles (e.g. `fake-ffprobe-hangs-on-scene-probe.sh` delegates real duration probes to actual `ffprobe` but hangs forever specifically on the lavfi scene-change probe) used to deterministically hit failure/timeout branches that real `ffmpeg` won't reliably produce on demand.
  `server.test.ts` (integration) drives a real `net.Server`/`net.Socket` pair rather than mocking the socket layer — connection-lifecycle bugs (the healthcheck race above, in particular) don't show up in a mocked socket.
  `npm run test:coverage` targets 100%.
  `../vitest.config.ts`'s `coverage.exclude` currently contains only `server.ts` (bootstrap composition root) and `presentation/uds/healthcheck.ts` (a standalone script invoked directly by Docker `HEALTHCHECK`, never imported by the app itself).
  A few genuinely unreachable defensive branches (a `split(',')` result that always has at least one element, a timer callback that can't fire after `clearTimeout` already ran, a `WeakMap` lookup that can't actually miss) are marked `/* v8 ignore next */` with a comment explaining why — see `videoProvider.ts` and `presentation/uds/server.ts` for examples before adding a new one elsewhere.
  `timestampSelection.ts`'s dedup/loop-bound checks are covered but genuinely hard to distinguish from a slightly-off variant with a naive test — see `timestampSelection.test.ts` for the exact-epsilon-boundary and maxAttempts-safety-valve tests before assuming a mutation survivor there needs a `// Stryker disable` instead of a real test.

- **Package identity.**
  `"name": "@pimbay/asset-dedup-video-frame-extract"`, `"private": true` — a deployed service (image on `ghcr.io`), not an npm library.
  Don't remove `private: true`.

## Ideas / future plans

None currently.
