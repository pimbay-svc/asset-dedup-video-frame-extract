import { describe, it, expect } from 'vitest';
import { IdProvider } from '../../../../src/infrastructure/id/idProvider.js';

describe('CryptoUniqidGenerator', () => {
  it('generates a non-empty string id', () => {
    const generator = new IdProvider();

    expect(generator.generateUnique().length).toBeGreaterThan(0);
  });

  it('generates a different id on each call', () => {
    const generator = new IdProvider();

    expect(generator.generateUnique()).not.toBe(generator.generateUnique());
  });

  it('never produces an id containing a colon (filename separator convention)', () => {
    const generator = new IdProvider();

    for (let i = 0; i < 20; i++) {
      expect(generator.generateUnique()).not.toContain(':');
    }
  });
});
