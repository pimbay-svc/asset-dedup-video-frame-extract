import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VideoProvider } from '../../../../src/infrastructure/video/videoProvider.js';
import { SamplingStrategy } from '../../../../src/domain/model/strategy.model.js';
import { CorruptInputError, InternalExtractionError, VideoTooLongError } from '../../../../src/domain/errors.js';
import { makeEnv } from '../../../helpers/env.js';

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
const SCENE_CHANGES_VIDEO = path.join(FIXTURES_DIR, 'scene-changes.mp4'); // ~4.2s, 4 hard color cuts
const CORRUPT_VIDEO = path.join(FIXTURES_DIR, 'corrupt.mp4'); // not a real video
const NO_DURATION_FILE = path.join(FIXTURES_DIR, 'no-duration.png'); // ffprobe reads it, but finds no duration

const FAKE_FFMPEG_NO_OUTPUT = path.join(FIXTURES_DIR, 'bin/fake-ffmpeg-no-output.sh');
const FAKE_FFPROBE_HANGS_ON_SCENE_PROBE = path.join(FIXTURES_DIR, 'bin/fake-ffprobe-hangs-on-scene-probe.sh');

describe('VideoProvider', () => {
  let outputDir: string;

  beforeAll(async () => {
    outputDir = await mkdtemp(path.join(tmpdir(), 'video-provider-test-'));
  });

  afterAll(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it('extracts frameCount evenly-spaced frames to outputDir, named {uniqid}-{index}.png', async () => {
    const provider = new VideoProvider(makeEnv({ OUTPUT_DIR: outputDir }));

    const frames = await provider.extractFrames(SCENE_CHANGES_VIDEO, {
      frameCount: 4,
      samplingStrategy: SamplingStrategy.UNIFORM,
      uniqueId: 'even-test',
    });

    expect(frames).toHaveLength(4);
    frames.forEach((frame, index) => {
      expect(frame.index).toBe(index);
      expect(frame.path).toBe(path.join(outputDir, `even-test-${String(index)}.png`));
    });

    const files = await readdir(outputDir);
    expect(files).toEqual(expect.arrayContaining(frames.map((f) => path.basename(f.path))));
  });

  it('creates OUTPUT_DIR on demand when it does not exist yet (ffmpeg never creates it itself)', async () => {
    const freshOutputDir = path.join(outputDir, 'not-created-yet', 'nested');
    const provider = new VideoProvider(makeEnv({ OUTPUT_DIR: freshOutputDir }));

    const frames = await provider.extractFrames(SCENE_CHANGES_VIDEO, {
      frameCount: 2,
      samplingStrategy: SamplingStrategy.UNIFORM,
      uniqueId: 'fresh-dir-test',
    });

    expect(frames).toHaveLength(2);
    const files = await readdir(freshOutputDir);
    expect(files).toEqual(expect.arrayContaining(frames.map((f) => path.basename(f.path))));
  });

  it('extracts frames in chronological order (array order is the frame sequence)', async () => {
    const provider = new VideoProvider(makeEnv({ OUTPUT_DIR: outputDir }));

    const frames = await provider.extractFrames(SCENE_CHANGES_VIDEO, {
      frameCount: 3,
      samplingStrategy: SamplingStrategy.UNIFORM,
      uniqueId: 'order-test',
    });

    const timestamps = frames.map((f) => f.timestampSeconds);
    expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b));
  });

  it('detects real scene changes rather than falling back to even sampling', async () => {
    const provider = new VideoProvider(makeEnv({ OUTPUT_DIR: outputDir }));

    const frames = await provider.extractFrames(SCENE_CHANGES_VIDEO, {
      frameCount: 2,
      samplingStrategy: SamplingStrategy.SCENE_CHANGE_DETECTION,
      uniqueId: 'scene-test',
    });

    // Even sampling for frameCount=2 over ~4.2s lands at ~1.05s/~3.15s, not the fixture's real
    // cuts (~2.2s/~3.2s) — a length-only assertion wouldn't catch the pkt_pts_time/pts_time
    // field-name bug, which silently fell back to even sampling without erroring.
    expect(frames).toHaveLength(2);
    expect(frames[0]?.timestampSeconds).toBeCloseTo(2.2, 1);
    expect(frames[1]?.timestampSeconds).toBeCloseTo(3.2, 1);
  });

  it('falls back to even sampling by requesting more frames than detected scene changes exist', async () => {
    const provider = new VideoProvider(makeEnv({ OUTPUT_DIR: outputDir }));

    // The fixture has ~3 detectable cuts; asking for 10 forces the fillRemainderWithEven top-up path.
    const frames = await provider.extractFrames(SCENE_CHANGES_VIDEO, {
      frameCount: 10,
      samplingStrategy: SamplingStrategy.SCENE_CHANGE_DETECTION,
      uniqueId: 'scene-remainder-test',
    });

    expect(frames).toHaveLength(10);
  });

  it('falls back to even sampling when the scene-change probe itself fails (e.g. times out)', async () => {
    // Delegates the duration probe to real ffprobe but hangs only the lavfi scene-change probe,
    // forcing the timeout path and exercising probeSceneChangeTimestamps's fallback without
    // also breaking the shared duration probe (which an always-failing fake binary would).
    const provider = new VideoProvider(
      makeEnv({ OUTPUT_DIR: outputDir, FFPROBE_BIN: FAKE_FFPROBE_HANGS_ON_SCENE_PROBE, FFMPEG_TIMEOUT_MS: '300' }),
    );

    const frames = await provider.extractFrames(SCENE_CHANGES_VIDEO, {
      frameCount: 3,
      samplingStrategy: SamplingStrategy.SCENE_CHANGE_DETECTION,
      uniqueId: 'scene-probe-failure-test',
    });

    expect(frames).toHaveLength(3);
  });

  it('rejects a video longer than maxDurationSeconds with VideoTooLongError', async () => {
    const provider = new VideoProvider(makeEnv({ OUTPUT_DIR: outputDir, MAX_VIDEO_DURATION_S: '1' }));

    await expect(
      provider.extractFrames(SCENE_CHANGES_VIDEO, {
        frameCount: 2,
        samplingStrategy: SamplingStrategy.UNIFORM,
        uniqueId: 'too-long-test',
      }),
    ).rejects.toThrow(VideoTooLongError);
  });

  it('rejects an unreadable/corrupt file with CorruptInputError', async () => {
    const provider = new VideoProvider(makeEnv({ OUTPUT_DIR: outputDir }));

    await expect(
      provider.extractFrames(CORRUPT_VIDEO, {
        frameCount: 2,
        samplingStrategy: SamplingStrategy.UNIFORM,
        uniqueId: 'corrupt-test',
      }),
    ).rejects.toThrow(CorruptInputError);
  });

  it('uses a generic message when duration is unparseable but ffprobe wrote nothing to stderr', async () => {
    const provider = new VideoProvider(makeEnv({ OUTPUT_DIR: outputDir }));

    await expect(
      provider.extractFrames(NO_DURATION_FILE, {
        frameCount: 2,
        samplingStrategy: SamplingStrategy.UNIFORM,
        uniqueId: 'no-duration-test',
      }),
    ).rejects.toThrow('could not determine video duration (corrupt or unreadable video stream)');
  });

  it('rejects with CorruptInputError when ffmpeg exits cleanly but produces no output file', async () => {
    const provider = new VideoProvider(makeEnv({ OUTPUT_DIR: outputDir, FFMPEG_BIN: FAKE_FFMPEG_NO_OUTPUT }));

    await expect(
      provider.extractFrames(SCENE_CHANGES_VIDEO, {
        frameCount: 1,
        samplingStrategy: SamplingStrategy.UNIFORM,
        uniqueId: 'no-output-test',
      }),
    ).rejects.toThrow(CorruptInputError);
  });

  it.each([
    {
      name: 'the ffprobe binary cannot be found',
      envOverrides: { FFPROBE_BIN: 'this-binary-does-not-exist' },
    },
    {
      name: 'a command exceeds its timeout',
      // 1ms timeout guarantees the very first ffprobe duration-probe call times out.
      envOverrides: { FFMPEG_TIMEOUT_MS: '1' },
    },
  ])('throws InternalExtractionError when $name', async ({ envOverrides }) => {
    const provider = new VideoProvider(makeEnv({ OUTPUT_DIR: outputDir, ...envOverrides }));

    await expect(
      provider.extractFrames(SCENE_CHANGES_VIDEO, {
        frameCount: 2,
        samplingStrategy: SamplingStrategy.UNIFORM,
        uniqueId: 'internal-error-test',
      }),
    ).rejects.toThrow(InternalExtractionError);
  });
});
