/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { VideoExtractor, ExtractedFrame, ExtractFramesOptions } from '../../domain/provider/video.provider.js';
import { CorruptInputError, InternalExtractionError, VideoTooLongError } from '../../domain/errors.js';
import { SamplingStrategy } from '../../domain/model/strategy.model.js';
import type { Env } from '../env/env.js';
import {
  evenTimestamps,
  selectSceneChangeTimestamps,
  fillRemainderWithEven,
  type SceneChangeCandidate,
} from './timestampSelection.js';

interface CommandResult {
  stdout: Buffer;
  stderr: Buffer;
  code: number | null;
}

/**
 * Reads the video directly from its path on the shared volume (never travels over the
 * socket — only the path does) and writes each extracted frame straight back to disk.
 */
export class VideoProvider implements VideoExtractor {
  constructor(private readonly env: Env) {}

  async extractFrames(videoPath: string, options: ExtractFramesOptions): Promise<ExtractedFrame[]> {
    const durationSeconds = await this.probeDuration(videoPath);

    if (durationSeconds > this.env.MAX_VIDEO_DURATION_S) {
      throw VideoTooLongError.durationExceeded(durationSeconds, this.env.MAX_VIDEO_DURATION_S);
    }

    const timestamps = await this.selectTimestamps(videoPath, options, durationSeconds);

    await mkdir(this.env.OUTPUT_DIR, { recursive: true });

    const frames: ExtractedFrame[] = [];
    for (const [index, timestampSeconds] of timestamps.entries()) {
      const outputPath = path.join(this.env.OUTPUT_DIR, `${options.uniqueId}-${String(index)}.png`);
      await this.extractFrameAt(videoPath, timestampSeconds, outputPath);
      frames.push({ index, timestampSeconds, path: outputPath });
    }

    return frames;
  }

  private async selectTimestamps(
    videoPath: string,
    options: ExtractFramesOptions,
    durationSeconds: number,
  ): Promise<number[]> {
    if (options.samplingStrategy !== SamplingStrategy.SCENE_CHANGE_DETECTION) {
      return evenTimestamps(options.frameCount, durationSeconds);
    }

    const candidates = await this.probeSceneChangeTimestamps(videoPath);

    if (candidates.length === 0) {
      // No scene changes detected (static video, or probing failed) — fall back to even sampling.
      return evenTimestamps(options.frameCount, durationSeconds);
    }

    const selected = selectSceneChangeTimestamps(candidates, options.frameCount);

    if (selected.length >= options.frameCount) {
      return selected;
    }

    return fillRemainderWithEven(selected, options.frameCount, durationSeconds);
  }

  private async probeDuration(videoPath: string): Promise<number> {
    const result = await this.runCommand(this.env.FFPROBE_BIN, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ]);

    const durationSeconds = Number.parseFloat(result.stdout.toString('utf-8').trim());

    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      const stderr = result.stderr.toString('utf-8').trim();
      throw CorruptInputError.durationUndetermined(stderr);
    }

    return durationSeconds;
  }

  /**
   * Scene-change detection via ffmpeg's `scene` score filter, not I-frame probing (a codec question, not a
   * visual-content one). Keeps every nonzero-score frame so ranking happens here, not via a pre-filter threshold.
   */
  private async probeSceneChangeTimestamps(videoPath: string): Promise<SceneChangeCandidate[]> {
    let result: CommandResult;
    try {
      result = await this.runCommand(this.env.FFPROBE_BIN, [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `movie=${escapeLavfiPath(videoPath)},select='gt(scene\\,0)'`,
        '-show_entries',
        'frame_tags=lavfi.scene_score:frame=pts_time',
        '-of',
        'csv=p=0',
      ]);
    } catch {
      // Best-effort optimization — on failure, the caller falls back to even sampling.
      return [];
    }

    const candidates: SceneChangeCandidate[] = [];
    for (const line of result.stdout.toString('utf-8').split('\n')) {
      const [timestampRaw, scoreRaw] = line.trim().split(',');
      /* v8 ignore next -- split(',') always returns ≥1 element, so timestampRaw is never
         undefined; `?? ''` exists only to satisfy noUncheckedIndexedAccess. */
      const timestampSeconds = Number.parseFloat(timestampRaw ?? '');
      const score = Number.parseFloat(scoreRaw ?? '');

      if (Number.isFinite(timestampSeconds) && Number.isFinite(score)) {
        candidates.push({ timestampSeconds, score });
      }
    }

    return candidates;
  }

  private async extractFrameAt(videoPath: string, timestampSeconds: number, outputPath: string): Promise<void> {
    const result = await this.runCommand(this.env.FFMPEG_BIN, [
      '-y',
      '-v',
      'error',
      '-ss',
      timestampSeconds.toFixed(3),
      '-i',
      videoPath,
      '-frames:v',
      '1',
      outputPath,
    ]);

    try {
      await access(outputPath);
    } catch {
      const stderr = result.stderr.toString('utf-8').trim();
      throw CorruptInputError.frameExtractionFailed(timestampSeconds, stderr);
    }
  }

  private runCommand(bin: string, args: string[]): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      const child = spawn(bin, args);

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let settled = false;

      const timer = setTimeout(() => {
        /* v8 ignore next 3 -- a setTimeout callback fires once, so `settled` can't already be
           true here; kept only for symmetry with the 'error'/'close' handlers below. */
        if (settled) {
          return;
        }
        settled = true;
        child.kill('SIGKILL');
        reject(InternalExtractionError.timedOut(bin, this.env.FFMPEG_TIMEOUT_MS));
      }, this.env.FFMPEG_TIMEOUT_MS);

      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      child.on('error', (err) => {
        /* v8 ignore next 3 -- reachable only if 'error' fires after the timeout already settled;
           not something ffmpeg/ffprobe does even when misbehaving. */
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(InternalExtractionError.spawnFailed(bin, err));
      });

      child.on('close', (code) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);

        resolve({ stdout: Buffer.concat(stdoutChunks), stderr: Buffer.concat(stderrChunks), code });
      });
    });
  }
}

/**
 * Best-effort escaping for ffmpeg's `movie` filter path (`:` and `,` are option separators). Our own
 * uniqueId-based paths won't contain these, but `core`-supplied source paths could — covers the
 * common case, not every possible path.
 */
function escapeLavfiPath(inputPath: string): string {
  return inputPath.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
}
