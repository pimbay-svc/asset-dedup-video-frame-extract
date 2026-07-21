import { describe, it, expect } from 'vitest';
import { VideoExtractService } from '../../../src/application/service/extract.service.js';
import { SamplingStrategy } from '../../../src/domain/model/strategy.model.js';
import { CorruptInputError, InternalExtractionError, VideoTooLongError } from '../../../src/domain/errors.js';
import type {
  VideoExtractor,
  ExtractedFrame,
  ExtractFramesOptions,
} from '../../../src/domain/provider/video.provider.js';
import type { IdGenerator } from '../../../src/domain/provider/id.provider.js';

class FakeUniqidGenerator implements IdGenerator {
  private counter = 0;

  generateUnique(): string {
    this.counter += 1;

    return `uid-${String(this.counter)}`;
  }
}

class FakeVideoExtractor implements VideoExtractor {
  constructor(
    private readonly behavior: (videoPath: string, options: ExtractFramesOptions) => Promise<ExtractedFrame[]>,
  ) {}

  extractFrames(videoPath: string, options: ExtractFramesOptions): Promise<ExtractedFrame[]> {
    return this.behavior(videoPath, options);
  }
}

describe('VideoExtractService', () => {
  it('returns paths for every successful item, mirroring the input keys', async () => {
    const extractor = new FakeVideoExtractor((videoPath, options) =>
      Promise.resolve([
        { index: 0, timestampSeconds: 1, path: `/shared/out/${options.uniqueId}-0.png` },
        { index: 1, timestampSeconds: 2, path: `/shared/out/${options.uniqueId}-1.png` },
      ]),
    );
    const service = new VideoExtractService(extractor, new FakeUniqidGenerator());

    const outputs = await service.extractBatch(
      { samplingStrategy: SamplingStrategy.UNIFORM, frameCount: 2 },
      { id1: { path: '/shared/a.mp4' } },
    );

    expect(outputs).toEqual({
      id1: { paths: ['/shared/out/uid-1-0.png', '/shared/out/uid-1-1.png'] },
    });
  });

  it('reports one item failing without affecting the rest of the batch', async () => {
    const extractor = new FakeVideoExtractor((videoPath) => {
      if (videoPath === '/shared/bad.mp4') {
        return Promise.reject(CorruptInputError.durationUndetermined('no valid video stream found'));
      }

      return Promise.resolve([{ index: 0, timestampSeconds: 0.5, path: '/shared/out/uid-0.png' }]);
    });
    const service = new VideoExtractService(extractor, new FakeUniqidGenerator());

    const outputs = await service.extractBatch(
      { samplingStrategy: SamplingStrategy.UNIFORM, frameCount: 1 },
      { id1: { path: '/shared/good.mp4' }, id2: { path: '/shared/bad.mp4' } },
    );

    expect(outputs.id1).toEqual({ paths: ['/shared/out/uid-0.png'] });
    expect(outputs.id2).toEqual({ error: { code: 'corrupt_input', message: 'no valid video stream found' } });
  });

  it.each([
    {
      name: 'maps VideoTooLongError to the video_too_long code',
      thrown: VideoTooLongError.durationExceeded(120, 60),
      expectedError: { code: 'video_too_long', message: 'video duration 120.0s exceeds max_video_duration_s (60s)' },
    },
    {
      name: 'maps InternalExtractionError to a generic internal_error message (no internal detail leaked)',
      thrown: InternalExtractionError.spawnFailed('ffmpeg', new Error('ENOENT: /tmp/x')),
      expectedError: { code: 'internal_error', message: 'internal error during frame extraction' },
    },
    {
      name: 'maps an unexpected non-domain error to internal_error as a safety net',
      thrown: new Error('unexpected'),
      expectedError: { code: 'internal_error', message: 'internal error during frame extraction' },
    },
  ])('$name', async ({ thrown, expectedError }) => {
    const extractor = new FakeVideoExtractor(() => Promise.reject(thrown));
    const service = new VideoExtractService(extractor, new FakeUniqidGenerator());

    const outputs = await service.extractBatch(
      { samplingStrategy: SamplingStrategy.UNIFORM, frameCount: 1 },
      { id1: { path: '/shared/a.mp4' } },
    );

    expect(outputs.id1).toEqual({ error: expectedError });
  });

  it('produces exactly one output entry per input key, no more no fewer', async () => {
    const extractor = new FakeVideoExtractor(() => Promise.resolve([]));
    const service = new VideoExtractService(extractor, new FakeUniqidGenerator());

    const outputs = await service.extractBatch(
      { samplingStrategy: SamplingStrategy.UNIFORM, frameCount: 1 },
      { id1: { path: '/shared/a.mp4' }, id2: { path: '/shared/b.mp4' } },
    );

    expect(Object.keys(outputs).sort()).toEqual(['id1', 'id2']);
  });
});
