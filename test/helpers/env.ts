import { loadEnv, type Env } from '../../src/infrastructure/env/env.js';

// Picks up PATH-resolved binaries on the local dev machine when tests run outside Docker,
// same as ffmpeg/ffprobe would resolve in production.
const FFMPEG_BIN = process.env.FFMPEG_BIN ?? 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE_BIN ?? 'ffprobe';

/**
 * Builds a valid `Env` for tests, routed through the real `loadEnv`/zod validation so fixtures
 * stay honest about coercion and defaults instead of hand-rolling the shape. Pass string overrides
 * exactly as they'd appear in `process.env` (e.g. `FFMPEG_TIMEOUT_MS: '20000'`).
 */
export function makeEnv(overrides: Partial<Record<string, string>> = {}): Env {
  return loadEnv({
    SOCKET_PATH: '/sockets/x.sock',
    SHARED_VOLUME_DIR: '/shared',
    FFMPEG_BIN,
    FFPROBE_BIN,
    FFMPEG_TIMEOUT_MS: '20000',
    ...overrides,
  });
}
