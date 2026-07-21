# Contributing

## Setup

See the README's "Quick Start (Local)" section for environment setup (Node, `ffmpeg`/`ffprobe`, `.env`).
This document only covers what's specific to contributing, not initial setup.

## Before opening a PR

All of the following must pass:

```bash
npm run js:build
npm run js:lint
npm run js:format
npm run js:typecheck
npm run test:coverage
npm run test:mutation
```

Coverage target is 100% (statements, branches, functions, lines) — `vitest.config.ts`'s `coverage.exclude` list is intentionally short and each entry is justified there and in `AGENTS.md`.
A change that drops coverage should come with new tests, not a new exclusion.

Test placement matters: `test/unit/` if the test exercises exactly one module (even if that module itself shells out to real `ffmpeg`/`ffprobe`), `test/integration/` if it composes ≥2 real production classes or crosses a framework boundary (DI container, a real UDS socket pair).
See `docs/context.md` for the reasoning and other project-specific conventions (manual container wiring, domain-provider naming split, the UDS single-active-connection policy) — read it before making structural changes, not just before asking an AI agent to.

## Scope of changes

This repo is `asset-dedup-video-frame-extract` specifically — the frame-extraction delegate extension in the `asset-dedup` ecosystem.
Changes to `asset-dedup-core` itself, to other extensions (`asset-dedup-pdf-page-extract`, `image-hash`), or to the shared protocol spec belong in their own repos, not here.

## Public Domain Dedication

By submitting a pull request, you dedicate your contribution to the public domain under the same [Unlicense](LICENSE) terms as this project.
You assert that you have the right to make this dedication.
