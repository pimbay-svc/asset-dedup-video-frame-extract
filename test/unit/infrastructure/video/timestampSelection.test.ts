import { describe, it, expect } from 'vitest';
import {
  evenTimestamps,
  selectSceneChangeTimestamps,
  fillRemainderWithEven,
  type SceneChangeCandidate,
} from '../../../../src/infrastructure/video/timestampSelection.js';

describe('evenTimestamps', () => {
  it.each([
    {
      name: 'produces midpoints of frameCount equal buckets',
      frameCount: 5,
      duration: 100,
      expected: [10, 30, 50, 70, 90],
    },
    { name: 'produces a single midpoint timestamp for frameCount=1', frameCount: 1, duration: 100, expected: [50] },
  ])('$name', ({ frameCount, duration, expected }) => {
    expect(evenTimestamps(frameCount, duration)).toEqual(expected);
  });
});

describe('selectSceneChangeTimestamps', () => {
  const candidate = (timestampSeconds: number, score: number): SceneChangeCandidate => ({
    timestampSeconds,
    score,
  });

  it.each([
    {
      name: 'returns all available candidates (sorted by time) when there are fewer than frameCount',
      candidates: [candidate(9, 0.5), candidate(1, 0.9), candidate(5, 0.3)],
      frameCount: 5,
      expected: [1, 5, 9],
    },
    {
      name: 'keeps only the top-scoring frameCount candidates, re-sorted chronologically',
      // top 2 by score: (2, 0.9) and (4, 0.8) -> chronological order [2, 4]
      candidates: [candidate(1, 0.1), candidate(2, 0.9), candidate(3, 0.2), candidate(4, 0.8), candidate(5, 0.05)],
      frameCount: 2,
      expected: [2, 4],
    },
    {
      name: 'returns an empty array when no candidates are available',
      candidates: [],
      frameCount: 5,
      expected: [],
    },
  ])('$name', ({ candidates, frameCount, expected }) => {
    expect(selectSceneChangeTimestamps(candidates, frameCount)).toEqual(expected);
  });
});

describe('fillRemainderWithEven', () => {
  it('fills up to targetCount by adding evenly spaced timestamps', () => {
    const result = fillRemainderWithEven([], 4, 100);
    expect(result).toHaveLength(4);
    // Should match evenTimestamps(4, 100): 12.5, 37.5, 62.5, 87.5
    expect(result).toEqual([12.5, 37.5, 62.5, 87.5]);
  });

  it('deduplicates a generated candidate that lands within epsilon of an existing timestamp instead of double-counting it', () => {
    // evenTimestamps(3, 100) would generate [16.67, 50, 83.33] — the middle one exactly
    // collides with the existing 50, so it must be skipped rather than appearing twice.
    const result = fillRemainderWithEven([50], 3, 100);

    expect(result).toHaveLength(3);
    expect(result.filter((t) => Math.abs(t - 50) < 0.01)).toHaveLength(1);
    expect(result[0]).toBeCloseTo(100 / 6, 2);
    expect(result[2]).toBeCloseTo(250 / 3, 2);
  });

  it('does not add a duplicate timestamp that already exists', () => {
    // existing timestamp coincides with what even-sampling for count=1 would produce (50)
    const result = fillRemainderWithEven([50], 1, 100);
    expect(result).toEqual([50]);
  });

  it('treats the dedup epsilon as a strict "closer than" threshold, not "at most as close"', () => {
    // durationSeconds=0 makes every candidate exactly 0 — chosen because |0.01 - 0| === 0.01 exactly in IEEE-754
    // double (no decimal rounding drift), landing precisely on DEDUP_EPSILON_SECONDS. At exactly the epsilon distance
    // the candidate must still count as new, not as a duplicate.
    const result = fillRemainderWithEven([0.01], 2, 0);
    expect(result).toEqual([0, 0.01]);
  });

  it('never exceeds targetCount even if existing already meets or exceeds it', () => {
    const result = fillRemainderWithEven([10, 20, 30, 40], 2, 100);
    expect(result).toHaveLength(2);
  });

  it('re-sorts ascending and trims to targetCount even when existing arrives out of order and larger than every generated candidate', () => {
    // existing=[90] sorts *after* the generated 25 both by value and by the final sort step —
    // insertion order is [90, 25], the opposite of correct ascending output, so this catches
    // both a dropped/broken final .sort() and a loop that keeps pushing past targetCount.
    const result = fillRemainderWithEven([90], 2, 100);
    expect(result).toEqual([25, 90]);
  });

  it('stops via the maxAttempts safety valve instead of looping forever when every candidate collides (e.g. durationSeconds=0)', () => {
    // durationSeconds=0 makes every candidate exactly 0, so every attempt after the first is judged a duplicate
    // — result.length can never reach targetCount, only the maxAttempts half of the while condition can stop this loop.
    const result = fillRemainderWithEven([], 3, 0);
    expect(result).toEqual([0]);
  });

  it('stops at exactly maxAttempts, not one attempt later', () => {
    // Tuned so the drift between the first accepted candidate and each later one stays under
    // DEDUP_EPSILON_SECONDS (0.01s) for every attempt up to and including the last one the real `attempt < maxAttempts`
    // allows, but *would* clear epsilon on the one extra attempt an off-by-one `<=` would additionally allow — so
    // only that variant yields a second, genuinely distinct timestamp.
    const result = fillRemainderWithEven([], 2, 0.00252);
    expect(result).toHaveLength(1);
  });
});
