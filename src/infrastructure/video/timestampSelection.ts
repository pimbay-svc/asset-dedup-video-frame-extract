/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */

export interface SceneChangeCandidate {
  timestampSeconds: number;
  score: number;
}

/**
 * Evenly spaced timestamps: midpoint of `frameCount` equal buckets across the duration
 * (e.g. frameCount=5 → 10%, 30%, 50%, 70%, 90%).
 */
export function evenTimestamps(frameCount: number, durationSeconds: number): number[] {
  const timestamps: number[] = [];
  for (let i = 0; i < frameCount; i++) {
    const fraction = (i + 0.5) / frameCount;
    timestamps.push(fraction * durationSeconds);
  }

  return timestamps;
}

/**
 * Picks up to `frameCount` timestamps from scene-change candidates, ranked by score
 * (highest = most likely a real cut), not position — caller fills any remainder via
 * `fillRemainderWithEven`. Result is re-sorted chronologically; score only decides
 * *which* timestamps are kept.
 */
export function selectSceneChangeTimestamps(candidates: SceneChangeCandidate[], frameCount: number): number[] {
  const topByScore = [...candidates].sort((a, b) => b.score - a.score).slice(0, frameCount);

  return topByScore.map((candidate) => candidate.timestampSeconds).sort((a, b) => a - b);
}

const DEDUP_EPSILON_SECONDS = 0.01;

/**
 * Tops up `existing` to `targetCount` with evenly spaced timestamps, skipping any within
 * DEDUP_EPSILON_SECONDS of one already present. Used when scene-change detection finds
 * fewer changes than `frame_count`.
 */
export function fillRemainderWithEven(existing: number[], targetCount: number, durationSeconds: number): number[] {
  const result = [...existing];
  const maxAttempts = targetCount * 4; // safety valve against pathological collision loops

  let attempt = 0;
  while (result.length < targetCount && attempt < maxAttempts) {
    const fraction = (attempt + 0.5) / targetCount;
    const candidate = fraction * durationSeconds;

    const isDuplicate = result.some((t) => Math.abs(t - candidate) < DEDUP_EPSILON_SECONDS);

    if (!isDuplicate) {
      result.push(candidate);
    }
    attempt += 1;
  }

  return result.sort((a, b) => a - b).slice(0, targetCount);
}
