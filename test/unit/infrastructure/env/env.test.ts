import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadEnv, NodeEnv } from '../../../../src/infrastructure/env/env.js';
import { EnvError } from '../../../../src/infrastructure/env/errors.js';

const validEnv = {
  SOCKET_PATH: '/sockets/video-frame-extract.sock',
  SHARED_VOLUME_DIR: '/shared',
};

describe('loadEnv', () => {
  describe('accepts a valid environment', () => {
    it.each([
      {
        name: 'minimal input fills in every default',
        overrides: {},
        expected: {
          SOCKET_PATH: '/sockets/video-frame-extract.sock',
          SHARED_VOLUME_DIR: '/shared',
          NODE_ENV: NodeEnv.PRODUCTION,
          LOG_LEVEL: 'info',
          OUTPUT_DIR: path.join('/shared', 'video-frame-extract'),
          MAX_VIDEO_DURATION_S: 3600,
          FFMPEG_BIN: 'ffmpeg',
          FFPROBE_BIN: 'ffprobe',
          FFMPEG_TIMEOUT_MS: 20_000,
          TTL_SWEEP_INTERVAL_MS: 5 * 60 * 1000,
          TTL_RETENTION_MS: 60 * 60 * 1000,
        },
      },
      {
        name: 'coerces numeric env vars from strings',
        overrides: { MAX_VIDEO_DURATION_S: '120', FFMPEG_TIMEOUT_MS: '5000' },
        expected: { MAX_VIDEO_DURATION_S: 120, FFMPEG_TIMEOUT_MS: 5000 },
      },
      {
        name: 'accepts an explicit OUTPUT_DIR override',
        overrides: { OUTPUT_DIR: '/shared/custom-output' },
        expected: { OUTPUT_DIR: '/shared/custom-output' },
      },
    ])('$name', ({ overrides, expected }) => {
      const env = loadEnv({ ...validEnv, ...overrides });

      expect(env).toMatchObject(expected);
    });
  });

  describe('rejects an invalid environment with EnvError', () => {
    it.each([
      { name: 'SOCKET_PATH is missing', overrides: { SHARED_VOLUME_DIR: '/shared' } },
      { name: 'SHARED_VOLUME_DIR is missing', overrides: { SOCKET_PATH: '/sockets/x.sock' } },
      { name: 'NODE_ENV has an invalid value', overrides: { ...validEnv, NODE_ENV: 'staging' } },
      { name: 'MAX_VIDEO_DURATION_S is non-numeric', overrides: { ...validEnv, MAX_VIDEO_DURATION_S: 'not-a-number' } },
    ])('$name', ({ overrides }) => {
      expect(() => loadEnv(overrides)).toThrow(EnvError);
    });
  });
});
