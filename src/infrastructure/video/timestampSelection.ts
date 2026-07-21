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
 * Evenly spaced timestamps across the video's duration. For `frameCount`
 * frames, uses the midpoint of `frameCount` equal buckets — e.g. for
 * frameCount=5: 10%, 30%, 50%, 70%, 90% of duration.
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
 * Picks up to `frameCount` timestamps from scene-change candidates, ranked
 * by score (highest = most likely a real cut) rather than by position. If
 * there are fewer candidates than requested, returns all of them (the
 * caller is expected to fill the remainder via `fillRemainderWithEven`).
 * Output is re-sorted chronologically — score only decides *which*
 * timestamps are kept, not their order.
 */
export function selectSceneChangeTimestamps(candidates: SceneChangeCandidate[], frameCount: number): number[] {
  const topByScore = [...candidates].sort((a, b) => b.score - a.score).slice(0, frameCount);

  return topByScore.map((candidate) => candidate.timestampSeconds).sort((a, b) => a - b);
}

const DEDUP_EPSILON_SECONDS = 0.01;

/**
 * Fills the gap between an existing (scene-change-derived) timestamp list
 * and `targetCount` by adding evenly spaced timestamps, skipping any that
 * would land within DEDUP_EPSILON_SECONDS of an existing one. Used when a
 * video has fewer detected scene changes than `frame_count`.
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
