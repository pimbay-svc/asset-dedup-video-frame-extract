/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
export abstract class AssetDedupVideoExtensionError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Video file is unreadable/malformed (no valid stream, container rejected, frame can't render).
 * Maps to the spec's `corrupt_input` per-item error code.
 */
export class CorruptInputError extends AssetDedupVideoExtensionError {
  private constructor(message: string) {
    super(message);
  }

  /** `ffprobe`'s duration output didn't parse to a finite, positive number. */
  static durationUndetermined(stderr: string): CorruptInputError {
    return new CorruptInputError(stderr || 'could not determine video duration (corrupt or unreadable video stream)');
  }

  /** `ffmpeg` produced no output file for the requested frame timestamp. */
  static frameExtractionFailed(timestampSeconds: number, stderr: string): CorruptInputError {
    return new CorruptInputError(
      stderr || `failed to extract frame at ${timestampSeconds.toFixed(3)}s (no output produced)`,
    );
  }
}

/**
 * ffmpeg/ffprobe failed to start, timed out, or crashed for reasons unrelated to the input's own
 * validity. Maps to the spec's `internal_error` per-item error code.
 */
export class InternalExtractionError extends AssetDedupVideoExtensionError {
  private constructor(message: string) {
    super(message);
  }

  static timedOut(bin: string, timeoutMs: number): InternalExtractionError {
    return new InternalExtractionError(`${bin} timed out after ${String(timeoutMs)}ms`);
  }

  static spawnFailed(bin: string, cause: Error): InternalExtractionError {
    return new InternalExtractionError(`failed to start ${bin}: ${cause.message}`);
  }
}

/**
 * Duration exceeds MAX_VIDEO_DURATION_S. Not one of the spec's three standard codes
 * (`unsupported_input`/`corrupt_input`/`internal_error`, documented as usable "where applicable",
 * not exclusive) — this is a policy rejection on an otherwise-valid file, reported as its own
 * `video_too_long` code (an extension-specific addition).
 */
export class VideoTooLongError extends AssetDedupVideoExtensionError {
  private constructor(message: string) {
    super(message);
  }

  static durationExceeded(durationSeconds: number, maxSeconds: number): VideoTooLongError {
    return new VideoTooLongError(
      `video duration ${durationSeconds.toFixed(1)}s exceeds max_video_duration_s (${String(maxSeconds)}s)`,
    );
  }
}
