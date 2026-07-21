# AGENTS.md — asset-dedup-video-frame-extract

## Project Overview

Frame-extraction extension for `asset-dedup-core`.
Given one or more video paths on a shared volume, extracts N frames per video and writes each as a PNG file on that same volume — nothing else.
Hashing, combining per-frame hashes, and calling back to core are explicitly out of scope; core sends the extracted frame paths to `image-hash` itself afterward.
Communication is a single persistent client connection from `core` (this service is the server), length-prefixed JSON frames, id-keyed batch request/response — never HTTP.
Full cross-repo protocol spec lives outside this repo.
License: Unlicense. Runtime: Node.js >= 24.

## Commands

```bash
npm install
npm run dev               # tsx watch --env-file=.env
npm run js:build          # tsc -p tsconfig.build.json
npm run js:lint           # eslint src test — check only
npm run js:lint:fix       # eslint src test --fix
npm run js:format         # prettier --check . — check only
npm run js:format:fix     # prettier --write .
npm run js:typecheck      # tsc --noEmit
npm run start             # run compiled dist/
npm run test:unit         # vitest run test/unit
npm run test:integration  # vitest run test/integration
npm run test:all          # both
npm run test:coverage     # both, --coverage
npm run test:mutation     # stryker run — MSI 100 gate
scripts/dev/extract.sh     # sends an extract op over the UDS socket, see README
```

Requires `ffmpeg`/`ffprobe` on `PATH` (or `FFMPEG_BIN`/`FFPROBE_BIN` pointing at them) for `npm run dev`, `test:unit`, `test:integration` — the video-processing path shells out to them directly against real fixture videos in `test/fixtures/`, nothing is mocked at the OS level.

`typecheck` exists because `build` may exclude `test/` and ESLint doesn't reliably catch every type error — it's the authoritative compile gate, always run alongside `lint`/`test`.

## Code Style

- **TS strict**, no unexplained `any` — prefer `unknown` + narrowing.
- **Named exports only.**
- **Interfaces for public contracts**, `type` for unions/internal shapes.
- **Explicit return types** on public functions/methods.
- **Small files**, one responsibility each.
- **No blind barrels** (`export * from`) — re-export explicitly.
- **No raw `- **No raw `enum`, ever — including `const enum`** — use `export const AnyType = {...} as const; export type AnyType = (typeof AnyType)[keyof typeof AnyType];`.
- **Named-constructor exceptions** — no inline `new SomeError(...)`.
- **Log/console message text lives in a `messages.ts` next to its module**, not inline at the call site.
- **Zod for config/env boundary validation** — never hand-rolled.
- **Socket wire format is `snake_case`** (`op`, `sampling_strategy`, `frame_count`), internal TS is `camelCase` — map at the dispatch boundary (`extract.socket.ts`), never a raw pass-through of an internal camelCase shape.
- **Config**: env-only, zod-validated before use, grouped into one `Env` value (`infrastructure/env/env.ts`) — business logic depends on `env.FFMPEG_BIN` etc., not on scattered `process.env` reads; no YAML file, no `CONFIG_PATH`.
- **Logging**: `pino`, structured, no `console.log` — except `presentation/uds/healthcheck.ts` and `server.ts`'s top-level `main().catch(...)`.
  Pretty-print only in dev — a `NODE_ENV` typo enabling it in prod has bitten us before.
- **Comments** only where non-obvious; always in English.
- **Caret-pin to the tested patch** (`^13.0.5`, not `^13.0`).
- **Markdown**: semantic linebreaks (one sentence/clause per line).
- **Docs discipline**: no "Project Layout" section in READMEs — the tree speaks for itself.

## Architecture

### Core — always applies

```
domain/
  model/*.model.ts     — domain vocabulary that isn't a plain entity (see "Domain vocabulary vs DTO" below)
  provider/*.provider.ts — non-repository port interfaces
application/
  service/*.service.ts — orchestration/business logic
infrastructure/
  container.ts          — awilix container, CLASSIC mode
  config/, env/*.ts, logger.ts, <adapter>/*.ts — mechanism-named adapters implementing domain/provider interfaces
presentation/
  uds/server.ts                    — buildUdsServer(): net.Server, connection lifecycle, single-active-connection policy
  uds/healthcheck.ts               — standalone script for Docker HEALTHCHECK, self-connects to the socket
  uds/socket/*.socket.ts
```

- **DI**: awilix, CLASSIC mode — constructor param names must match cradle keys exactly (fails silently at resolve time otherwise).
- **Singletons**: `videoExtractor`, `idGenerator`, `videoExtractService` are container singletons; `config` and `logger` are registered via `asValue`.
- **Domain vocabulary vs DTO**: would this type mean the same thing if the wire format changed?
  Yes → domain; no (shapes only a boundary) → DTO, lives where consumed.

### Subprocess delegation

`ffmpeg`/`ffprobe` run as separate OS processes (CLI args + `stdout`/`stderr`), never linked in — see `docs/THIRD-PARTY-NOTICES.md` before changing invocation.

## Testing

- **Vitest**, `test/unit/` + `test/integration/`, mirroring `src/` 1:1.
- Split is not mock-vs-real-I/O — a unit test can touch real I/O if that's a detail of the one module under test.
  - **unit/** — exercises exactly one module. `VideoProvider`'s own unit tests run real `ffmpeg`/`ffprobe` against fixture videos in `test/fixtures/` (including small fake-binary test doubles in `test/fixtures/bin/` for deterministic failure modes) — nothing is mocked at the OS level, see "Commands" above.
  - **integration/** — composes ≥2 modules, or crosses a framework boundary (DI container wiring real classes; a real UDS `net.Server`/`net.Socket` pair in `server.test.ts`).
- **Coverage: 100%** — hard gate (`npm run test:coverage`, `vitest.config.ts` `coverage.thresholds`).
  `coverage.exclude` is short and every entry justified: `server.ts` (bootstrap composition root), `presentation/uds/healthcheck.ts` (standalone Docker-invoked script, not part of the app process).
- **Mutation score: 100% (MSI)** — `stryker.config.mjs`, `npm run test:mutation`.
  `videoProvider.ts` (and its own test file) is excluded from mutation — its tests shell out to real `ffmpeg`/`ffprobe`.

- Every bug fix gets a regression test, ideally one that would have caught it before the fix — see `docs/context.md`, "ffprobe field-name bug", for a concrete example of a test that initially passed against broken behavior.
- A few genuinely unreachable defensive branches (guarded only for `noUncheckedIndexedAccess`, a timer callback that can't fire after `clearTimeout` already ran, a `WeakMap` lookup that can't actually miss) are marked `/* v8 ignore next */` with a comment explaining why, rather than covered with contrived tests.

## Guardrails

- No new deps without proposing them explicitly.
- Targeted diffs — don't rewrite a file for a small fix.
- No unrequested docs/test scaffolding.
- Don't move `docker/Dockerfile` stages/`COPY` paths without checking build context (relative to context, not the Dockerfile).
- Ask before changing a DI registration's lifetime.
- Domain vs application vs infrastructure placement unclear → ask, don't guess.
