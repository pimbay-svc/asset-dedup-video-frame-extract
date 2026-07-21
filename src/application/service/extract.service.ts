/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { VideoExtractor } from '../../domain/provider/video.provider.js';
import type { IdGenerator } from '../../domain/provider/id.provider.js';
import type { SamplingStrategy } from '../../domain/model/strategy.model.js';
import { CorruptInputError, VideoTooLongError } from '../../domain/errors.js';

export interface ExtractFramesConfig {
  samplingStrategy: SamplingStrategy;
  frameCount: number;
}

export interface ExtractFramesInputItem {
  path: string;
}

export interface ExtractFramesSuccess {
  paths: string[];
}

export interface ExtractFramesFailure {
  error: { code: string; message: string };
}

export type ExtractFramesItemResult = ExtractFramesSuccess | ExtractFramesFailure;

export class VideoExtractService {
  constructor(
    private readonly videoExtractor: VideoExtractor,
    private readonly idGenerator: IdGenerator,
  ) {}

  /**
   * Extracts frames for every item in `inputs`. Per spec, a failure on one item never prevents the rest of the batch
   * from being attempted and reported — each item is handled independently and its result (success or error)
   * is reported under its own key, mirroring `inputs` exactly.
   */
  async extractBatch(
    config: ExtractFramesConfig,
    inputs: Record<string, ExtractFramesInputItem>,
  ): Promise<Record<string, ExtractFramesItemResult>> {
    const entries = await Promise.all(
      Object.entries(inputs).map(async ([id, item]): Promise<[string, ExtractFramesItemResult]> => {
        return [id, await this.extractOne(config, item)];
      }),
    );

    return Object.fromEntries(entries);
  }

  private async extractOne(
    config: ExtractFramesConfig,
    item: ExtractFramesInputItem,
  ): Promise<ExtractFramesItemResult> {
    try {
      const frames = await this.videoExtractor.extractFrames(item.path, {
        frameCount: config.frameCount,
        samplingStrategy: config.samplingStrategy,
        uniqueId: this.idGenerator.generateUnique(),
      });

      return { paths: frames.map((frame) => frame.path) };
    } catch (err) {
      return { error: toErrorPayload(err) };
    }
  }
}

function toErrorPayload(err: unknown): { code: string; message: string } {
  if (err instanceof VideoTooLongError) {
    return { code: 'video_too_long', message: err.message };
  }
  if (err instanceof CorruptInputError) {
    return { code: 'corrupt_input', message: err.message };
  }

  return { code: 'internal_error', message: 'internal error during frame extraction' };
}
