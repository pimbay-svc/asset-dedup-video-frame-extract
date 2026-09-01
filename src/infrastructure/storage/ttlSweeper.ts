/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import type pino from 'pino';
import type { Env } from '../env/env.js';

/**
 * Recurring sweep of `env.OUTPUT_DIR`, deleting anything older than `env.TTL_RETENTION_MS` — a
 * backstop against leaked disk if `core` crashes before cleaning up its own output. `start()`
 * returns a stop function; the interval is `unref()`'d so it can't keep the process alive alone.
 */
export class TtlSweeper {
  constructor(
    private readonly env: Env,
    private readonly logger: pino.Logger,
  ) {}

  start(): () => void {
    const timer = setInterval(() => {
      void this.sweepOnce();
    }, this.env.TTL_SWEEP_INTERVAL_MS);
    timer.unref();

    return (): void => {
      clearInterval(timer);
    };
  }

  private async sweepOnce(): Promise<void> {
    const outputDir = this.env.OUTPUT_DIR;
    let entries: string[];

    try {
      entries = await readdir(outputDir);
    } catch (err) {
      this.logger.warn({ err, outputDir }, 'ttl sweep: failed to read output directory');

      return;
    }

    const now = Date.now();

    await Promise.all(
      entries.map(async (entry) => {
        const entryPath = path.join(outputDir, entry);

        try {
          const stats = await stat(entryPath);

          if (now - stats.mtimeMs > this.env.TTL_RETENTION_MS) {
            await unlink(entryPath);
            this.logger.info({ path: entryPath }, 'ttl sweep: removed stale output file');
          }
        } catch (err) {
          this.logger.warn({ err, path: entryPath }, 'ttl sweep: failed to process entry');
        }
      }),
    );
  }
}
