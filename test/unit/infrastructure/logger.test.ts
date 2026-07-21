import { describe, it, expect } from 'vitest';
import { resolveTransport, createLoggerOptions } from '../../../src/infrastructure/logger.js';
import { NodeEnv } from '../../../src/infrastructure/env/env.js';
import { makeEnv } from '../../helpers/env.js';

describe('logger', () => {
  describe('resolveTransport', () => {
    it.each([
      { name: 'returns undefined in production', nodeEnv: NodeEnv.PRODUCTION, expected: undefined },
      {
        name: 'returns a file transport in test',
        nodeEnv: NodeEnv.TEST,
        expected: { target: 'pino/file', options: { destination: 'var/test/test.log', mkdir: true } },
      },
      {
        name: 'returns pino-pretty for development',
        nodeEnv: NodeEnv.DEVELOPMENT,
        expected: { target: 'pino-pretty' },
      },
    ])('$name', ({ nodeEnv, expected }) => {
      expect(resolveTransport(makeEnv({ NODE_ENV: nodeEnv }))).toEqual(expected);
    });
  });

  describe('createLoggerOptions', () => {
    it.each([
      {
        name: 'defaults to log level "info" when LOG_LEVEL is unset',
        envOverrides: {},
        expectedLevel: 'info',
      },
      {
        name: 'uses LOG_LEVEL when set',
        envOverrides: { LOG_LEVEL: 'debug' },
        expectedLevel: 'debug',
      },
    ])('$name', ({ envOverrides, expectedLevel }) => {
      expect(createLoggerOptions(makeEnv({ NODE_ENV: NodeEnv.PRODUCTION, ...envOverrides }))).toEqual({
        level: expectedLevel,
        transport: undefined,
      });
    });
  });
});
