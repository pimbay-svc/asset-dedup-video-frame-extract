import { describe, it, expect } from 'vitest';
import { EnvError } from '../../../../src/infrastructure/env/errors.js';

describe('EnvError', () => {
  it('invalidConfiguration() prefixes the zod error details with a fixed header', () => {
    const err = EnvError.invalidConfiguration('SOCKET_PATH: Required');

    expect(err).toBeInstanceOf(EnvError);
    expect(err.name).toBe('EnvError');
    expect(err.message).toBe('invalid environment configuration:\nSOCKET_PATH: Required');
  });
});
