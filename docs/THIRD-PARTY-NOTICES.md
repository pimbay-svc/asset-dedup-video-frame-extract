# Third-Party Notices

This project itself is released under [The Unlicense](../LICENSE).
It bundles or invokes the following third-party software, each under its own license.

## npm dependencies

Full list with versions and licenses: run `npx license-checker --summary --production --excludePrivatePackages` — don't hand-maintain a duplicate of `package.json`/`package-lock.json` here.
Every transitive dependency currently resolved is verified directly against each package's own `package.json` `license` field, not assumed; none of it is copyleft.

Direct runtime dependencies — listed even though none carry an attribution requirement, so a reader doesn't have to run the tool just to see there's nothing unusual here:

| Package  | License | Note |
| -------- | ------- | ---- |
| `awilix` | MIT     | —    |
| `pino`   | MIT     | —    |
| `zod`    | MIT     | —    |

## ffmpeg / ffprobe

| Package          | License                                | Notes               |
| ---------------- | -------------------------------------- | ------------------- |
| ffmpeg / ffprobe | LGPL-2.1-or-later or GPL-2.0-or-later¹ | https://ffmpeg.org/ |

Invoked by `VideoProvider` as separate OS processes (`ffmpeg`, `ffprobe`) — never linked into this project's own code. See `../README.md`, "License".

¹ Which license applies depends on the exact build's configuration (in particular, whether GPL-only components like `libx264` are enabled). Verify the actual license against the specific `ffmpeg`/`ffprobe` build installed in `../docker/Dockerfile` before relying on this notice.

## Notes

This is not legal advice.
`ffmpeg`/`ffprobe` are invoked by `VideoProvider` with `node:child_process.spawn`, given file paths as CLI arguments, with output read back from `stdout`/disk — no `ffmpeg`/`ffprobe` source or object code is compiled into, statically linked, or dynamically linked against this project's own code.
This is treated as the standard "mere aggregation" / separate-process boundary that keeps ffmpeg's license (LGPL/GPL depending on build configuration) from propagating to this project's own code; the Docker image ships both under their own separate licenses (this project's under [The Unlicense](../LICENSE), `ffmpeg`/`ffprobe` under whichever license their specific build carries), see `../README.md`, "License".
