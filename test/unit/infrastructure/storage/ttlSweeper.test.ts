import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, readdir, utimes, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TtlSweeper } from '../../../../src/infrastructure/storage/ttlSweeper.js';
import { makeEnv } from '../../../helpers/env.js';
import { fakeLogger } from '../../../helpers/logger.js';

// Real timers throughout: sweepOnce does real fs I/O via an un-awaited `void this.sweepOnce()`
// inside the interval callback, so fake timers would advance the JS clock without waiting for
// that I/O. A short real interval plus a short real wait is simpler here.

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('TtlSweeper', () => {
  let outputDir: string;

  beforeEach(async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), 'ttl-sweep-test-'));
  });

  afterEach(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('removes files older than retentionMs and keeps fresher ones', async () => {
    const staleFile = path.join(outputDir, 'stale.png');
    const freshFile = path.join(outputDir, 'fresh.png');

    await writeFile(staleFile, 'x');
    await writeFile(freshFile, 'x');

    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(staleFile, oldTime, oldTime);

    const logger = fakeLogger();
    const env = makeEnv({
      OUTPUT_DIR: outputDir,
      TTL_RETENTION_MS: String(60 * 60 * 1000),
      TTL_SWEEP_INTERVAL_MS: '10',
    });
    const stop = new TtlSweeper(env, logger).start();

    await wait(100);

    const remaining = await readdir(outputDir);
    expect(remaining).toEqual(['fresh.png']);
    expect(logger.info).toHaveBeenCalledWith({ path: staleFile }, 'ttl sweep: removed stale output file');

    stop();
  });

  it('logs a warning and continues if the output directory cannot be read', async () => {
    const missingDir = path.join(outputDir, 'does-not-exist');
    const logger = fakeLogger();
    const env = makeEnv({
      OUTPUT_DIR: missingDir,
      TTL_RETENTION_MS: '1000',
      TTL_SWEEP_INTERVAL_MS: '10',
    });
    const stop = new TtlSweeper(env, logger).start();

    await wait(50);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() as unknown, outputDir: missingDir }),
      'ttl sweep: failed to read output directory',
    );

    stop();
  });

  it('logs a warning and continues if a single entry fails to process (e.g. unlink on a directory)', async () => {
    // A stale sub-directory: stat() succeeds (judged old enough to remove), but unlink() on a
    // directory fails — exercising the per-entry catch without affecting other entries.
    const staleDir = path.join(outputDir, 'stale-subdir');
    await mkdir(staleDir);
    const oldTime = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(staleDir, oldTime, oldTime);

    const logger = fakeLogger();
    const env = makeEnv({
      OUTPUT_DIR: outputDir,
      TTL_RETENTION_MS: String(60 * 60 * 1000),
      TTL_SWEEP_INTERVAL_MS: '10',
    });
    const stop = new TtlSweeper(env, logger).start();

    await wait(100);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() as unknown, path: staleDir }),
      'ttl sweep: failed to process entry',
    );

    stop();
  });

  it('unrefs the interval timer so it never keeps the process alive on its own', () => {
    const realSetInterval = global.setInterval;
    const unrefSpy = vi.fn();
    const setIntervalSpy = vi
      .spyOn(global, 'setInterval')
      .mockImplementation((...args: Parameters<typeof setInterval>) => {
        const timer = realSetInterval(...args);
        timer.unref = unrefSpy as typeof timer.unref;

        return timer;
      });

    const env = makeEnv({ OUTPUT_DIR: outputDir, TTL_RETENTION_MS: '1000', TTL_SWEEP_INTERVAL_MS: '100000' });
    const stop = new TtlSweeper(env, fakeLogger()).start();

    expect(unrefSpy).toHaveBeenCalledOnce();

    stop();
    setIntervalSpy.mockRestore();
  });

  it('keeps a file exactly at the retention boundary (retention is a strict "older than" threshold)', async () => {
    const retentionMs = 1000;
    const boundaryFile = path.join(outputDir, 'boundary.png');
    await writeFile(boundaryFile, 'x');

    // Pin Date.now() for the whole sweep, independent of real wall-clock jitter (setInterval/fs
    // I/O still run normally — only "now" is controlled), so the file's age as seen by
    // sweepOnce is *exactly* retentionMs — the boundary between "kept" (>) and "removed" (>=).
    const fixedNow = Date.now() + 10_000;
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(fixedNow);
    const mtime = new Date(fixedNow - retentionMs);
    await utimes(boundaryFile, mtime, mtime);

    const logger = fakeLogger();
    const env = makeEnv({
      OUTPUT_DIR: outputDir,
      TTL_RETENTION_MS: String(retentionMs),
      TTL_SWEEP_INTERVAL_MS: '10',
    });
    const stop = new TtlSweeper(env, logger).start();

    await wait(100);

    const remaining = await readdir(outputDir);
    expect(remaining).toContain('boundary.png');

    stop();
    nowSpy.mockRestore();
  });

  it('stop() prevents further sweeps', async () => {
    const logger = fakeLogger();
    const env = makeEnv({ OUTPUT_DIR: outputDir, TTL_RETENTION_MS: '1', TTL_SWEEP_INTERVAL_MS: '10' });
    const stop = new TtlSweeper(env, logger).start();

    stop();
    await writeFile(path.join(outputDir, 'never-swept.png'), 'x');
    await wait(100);

    const remaining = await readdir(outputDir);
    expect(remaining).toEqual(['never-swept.png']);
  });
});
