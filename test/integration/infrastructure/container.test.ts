import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildContainer, type BuiltContainer } from '../../../src/infrastructure/container.js';
import { VideoExtractService } from '../../../src/application/service/extract.service.js';
import { VideoProvider } from '../../../src/infrastructure/video/videoProvider.js';
import { TtlSweeper } from '../../../src/infrastructure/storage/ttlSweeper.js';
import { makeEnv } from '../../helpers/env.js';

describe('buildContainer', () => {
  let dir: string;
  let built: BuiltContainer | undefined;

  afterEach(async () => {
    await built?.cleanup();
    built = undefined;
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves videoExtractService as a VideoExtractService wired to a real VideoProvider', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'container-test-'));

    const env = makeEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SOCKET_PATH: path.join(dir, 'video-frame-extract.sock'),
      SHARED_VOLUME_DIR: dir,
      TTL_SWEEP_INTERVAL_MS: '300000',
      TTL_RETENTION_MS: '3600000',
    });
    built = buildContainer(env);

    const { cradle } = built.container;

    expect(cradle.videoExtractService).toBeInstanceOf(VideoExtractService);
    expect(cradle.videoExtractor).toBeInstanceOf(VideoProvider);
    expect(cradle.env.OUTPUT_DIR).toBe(path.join(dir, 'video-frame-extract'));
  });

  it('derives outputDir from SHARED_VOLUME_DIR when OUTPUT_DIR is unset, or uses OUTPUT_DIR when set', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'container-test-'));

    const env = makeEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SOCKET_PATH: path.join(dir, 'x.sock'),
      SHARED_VOLUME_DIR: dir,
      OUTPUT_DIR: path.join(dir, 'custom-out'),
      TTL_SWEEP_INTERVAL_MS: '300000',
      TTL_RETENTION_MS: '3600000',
    });
    built = buildContainer(env);

    expect(built.container.cradle.env.OUTPUT_DIR).toBe(path.join(dir, 'custom-out'));
  });

  it('cleanup() resolves without throwing', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'container-test-'));

    const env = makeEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SOCKET_PATH: path.join(dir, 'x.sock'),
      SHARED_VOLUME_DIR: dir,
      TTL_SWEEP_INTERVAL_MS: '300000',
      TTL_RETENTION_MS: '3600000',
    });
    built = buildContainer(env);

    await expect(built.cleanup()).resolves.toBeUndefined();
  });

  it('cleanup() stops the ttlSweeper interval, not just resolves', async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'container-test-'));

    const env = makeEnv({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      SOCKET_PATH: path.join(dir, 'x.sock'),
      SHARED_VOLUME_DIR: dir,
      TTL_SWEEP_INTERVAL_MS: '300000',
      TTL_RETENTION_MS: '3600000',
    });

    const stopTtlSweep = vi.fn();
    const startSpy = vi.spyOn(TtlSweeper.prototype, 'start').mockReturnValue(stopTtlSweep);

    built = buildContainer(env);
    await built.cleanup();

    expect(stopTtlSweep).toHaveBeenCalledOnce();

    startSpy.mockRestore();
  });
});
