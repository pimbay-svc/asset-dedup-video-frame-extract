import { describe, it, expect } from 'vitest';
import { CorruptInputError, InternalExtractionError, VideoTooLongError } from '../../../src/domain/errors.js';

describe('CorruptInputError', () => {
  describe('durationUndetermined()', () => {
    it.each([
      {
        name: 'uses ffprobe stderr as the message when present',
        stderr: 'Invalid data found when processing input',
        expected: 'Invalid data found when processing input',
      },
      {
        name: 'falls back to a generic message when stderr is empty',
        stderr: '',
        expected: 'could not determine video duration (corrupt or unreadable video stream)',
      },
    ])('$name', ({ stderr, expected }) => {
      const err = CorruptInputError.durationUndetermined(stderr);

      expect(err).toBeInstanceOf(CorruptInputError);
      expect(err.name).toBe('CorruptInputError');
      expect(err.message).toBe(expected);
    });
  });

  describe('frameExtractionFailed()', () => {
    it.each([
      {
        name: 'uses ffmpeg stderr as the message when present',
        timestampSeconds: 2.5,
        stderr: 'ffmpeg: unsupported codec',
        expected: 'ffmpeg: unsupported codec',
      },
      {
        name: 'falls back to a generic message with the timestamp when stderr is empty',
        timestampSeconds: 2.5,
        stderr: '',
        expected: 'failed to extract frame at 2.500s (no output produced)',
      },
    ])('$name', ({ timestampSeconds, stderr, expected }) => {
      const err = CorruptInputError.frameExtractionFailed(timestampSeconds, stderr);

      expect(err.message).toBe(expected);
    });
  });
});

describe('InternalExtractionError', () => {
  it.each([
    {
      name: 'timedOut() includes the binary name and the configured timeout in milliseconds',
      err: InternalExtractionError.timedOut('ffmpeg', 20_000),
      expected: 'ffmpeg timed out after 20000ms',
    },
    {
      name: 'spawnFailed() includes the binary name and the underlying spawn error message',
      err: InternalExtractionError.spawnFailed('ffprobe', new Error('ENOENT')),
      expected: 'failed to start ffprobe: ENOENT',
    },
  ])('$name', ({ err, expected }) => {
    expect(err).toBeInstanceOf(InternalExtractionError);
    expect(err.name).toBe('InternalExtractionError');
    expect(err.message).toBe(expected);
  });
});

describe('VideoTooLongError', () => {
  it('durationExceeded() includes the actual and max durations', () => {
    const err = VideoTooLongError.durationExceeded(125.3, 60);

    expect(err).toBeInstanceOf(VideoTooLongError);
    expect(err.name).toBe('VideoTooLongError');
    expect(err.message).toBe('video duration 125.3s exceeds max_video_duration_s (60s)');
  });
});
