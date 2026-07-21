import { describe, it, expect, vi } from 'vitest';
import { handleExtract } from '../../../../../src/presentation/uds/socket/extract.socket.js';
import type { Cradle } from '../../../../../src/infrastructure/container.js';
import { UdsServerMessage } from '../../../../../src/presentation/uds/messages.js';
import { fakeCradle } from '../../../../helpers/cradle.js';
import { fakeLogger } from '../../../../helpers/logger.js';

describe('handleExtract', () => {
  it('delegates a valid request to videoExtractService.extractBatch', async () => {
    const extractBatch = vi.fn().mockResolvedValue({ id1: { paths: ['/shared/out/a-0.png'] } });
    const cradle = fakeCradle({ videoExtractService: { extractBatch } as unknown as Cradle['videoExtractService'] });

    const response = await handleExtract(
      {
        op: 'extract',
        config: { sampling_strategy: 'uniform', frame_count: 5 },
        inputs: { id1: { path: '/shared/a.mp4' } },
      },
      cradle,
    );

    expect(extractBatch).toHaveBeenCalledWith(
      { samplingStrategy: 'uniform', frameCount: 5 },
      { id1: { path: '/shared/a.mp4' } },
    );
    expect(response).toEqual({ outputs: { id1: { paths: ['/shared/out/a-0.png'] } } });
  });

  describe('fails every input with internal_error for a bad request-level config, without calling the service', () => {
    it.each([
      {
        name: 'an unrecognized sampling_strategy',
        config: { sampling_strategy: 'bogus-strategy', frame_count: 5 },
        expected: 'unsupported sampling_strategy "bogus-strategy"',
      },
    ])('$name', async ({ config, expected }) => {
      const extractBatch = vi.fn();
      const cradle = fakeCradle({ videoExtractService: { extractBatch } as unknown as Cradle['videoExtractService'] });

      const response = await handleExtract(
        {
          op: 'extract',
          config,
          inputs: { id1: { path: '/shared/a.mp4' }, id2: { path: '/shared/b.mp4' } },
        },
        cradle,
      );

      expect(extractBatch).not.toHaveBeenCalled();
      expect(response?.outputs.id1).toEqual({ error: { code: 'internal_error', message: expected } });
      expect(response?.outputs.id2).toEqual({ error: { code: 'internal_error', message: expected } });
    });
  });

  describe('returns null and logs a warning for a structurally malformed message, without calling the service', () => {
    it.each([
      { name: 'message is null', message: null },
      { name: 'message is a bare string', message: 'not an object' },
      { name: 'message is an array', message: [] },
      {
        name: 'op is missing',
        message: { config: { sampling_strategy: 'uniform', frame_count: 5 }, inputs: {} },
      },
      {
        name: 'op is not "extract"',
        message: { op: 'ping', config: { sampling_strategy: 'uniform', frame_count: 5 }, inputs: {} },
      },
      { name: 'config is missing entirely', message: { op: 'extract', inputs: {} } },
      {
        name: 'config.sampling_strategy is missing',
        message: { op: 'extract', config: { frame_count: 5 }, inputs: {} },
      },
      {
        name: 'config.frame_count is a string instead of a number',
        message: { op: 'extract', config: { sampling_strategy: 'uniform', frame_count: '5' }, inputs: {} },
      },
      {
        name: 'inputs is missing entirely',
        message: { op: 'extract', config: { sampling_strategy: 'uniform', frame_count: 5 } },
      },
      {
        name: 'an inputs entry has no path',
        message: { op: 'extract', config: { sampling_strategy: 'uniform', frame_count: 5 }, inputs: { id1: {} } },
      },
    ])('$name', async ({ message }) => {
      const extractBatch = vi.fn();
      const logger = fakeLogger();
      const cradle = fakeCradle({
        videoExtractService: { extractBatch } as unknown as Cradle['videoExtractService'],
        logger,
      });

      const response = await handleExtract(message, cradle);

      expect(response).toBeNull();
      expect(extractBatch).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.anything() as unknown }),
        UdsServerMessage.MALFORMED_EXTRACT_REQUEST,
      );
    });
  });
});
