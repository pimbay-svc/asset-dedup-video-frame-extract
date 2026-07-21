/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
export const SamplingStrategy = {
  UNIFORM: 'uniform',
  SCENE_CHANGE_DETECTION: 'scene-change-detection',
} as const;

export type SamplingStrategy = (typeof SamplingStrategy)[keyof typeof SamplingStrategy];
