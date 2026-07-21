import type { Cradle } from '../../src/infrastructure/container.js';

/**
 * Builds a fake `Cradle` from whichever slice a test needs. Only the passed-in keys exist at
 * runtime — cast to `Cradle` so callers don't have to fill in unrelated dependencies.
 */
export function fakeCradle(overrides: Partial<Cradle> = {}): Cradle {
  return overrides as Cradle;
}
