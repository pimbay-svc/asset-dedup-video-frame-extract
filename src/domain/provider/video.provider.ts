/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import type { SamplingStrategy } from '../model/strategy.model.js';

export interface ExtractedFrame {
  index: number;
  timestampSeconds: number;
  /** Absolute path of the written PNG frame on the shared volume. */
  path: string;
}

export interface ExtractFramesOptions {
  frameCount: number;
  samplingStrategy: SamplingStrategy;
  uniqueId: string;
}

export interface VideoExtractor {
  extractFrames(videoPath: string, options: ExtractFramesOptions): Promise<ExtractedFrame[]>;
}
