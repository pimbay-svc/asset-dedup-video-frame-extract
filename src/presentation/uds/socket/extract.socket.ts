/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { z } from 'zod';
import type { Cradle } from '../../../infrastructure/container.js';
import { SamplingStrategy } from '../../../domain/model/strategy.model.js';
import { UdsServerMessage } from '../messages.js';

const ExtractRequestSchema = z.object({
  op: z.literal('extract'),
  config: z.object({
    sampling_strategy: z.string(),
    frame_count: z.number(),
  }),
  inputs: z.record(z.string(), z.object({ path: z.string() })),
});

export type ExtractRequestMessage = z.infer<typeof ExtractRequestSchema>;

export interface ExtractResponseMessage {
  outputs: Record<string, unknown>;
}

const VALID_SAMPLING_STRATEGIES: string[] = Object.values(SamplingStrategy);

export async function handleExtract(message: unknown, cradle: Cradle): Promise<ExtractResponseMessage | null> {
  const parsed = ExtractRequestSchema.safeParse(message);

  if (!parsed.success) {
    cradle.logger.warn({ err: parsed.error }, UdsServerMessage.MALFORMED_EXTRACT_REQUEST);

    return null;
  }

  const { config, inputs } = parsed.data;

  if (!VALID_SAMPLING_STRATEGIES.includes(config.sampling_strategy)) {
    // Config is malformed at the request level, not per-item — report every
    // input as an internal_error rather than silently defaulting, since
    // silently substituting a strategy would process the batch differently
    // than core asked for.
    const errorEntry = {
      error: {
        code: 'internal_error',
        message: `unsupported sampling_strategy "${config.sampling_strategy}"`,
      },
    };

    return { outputs: Object.fromEntries(Object.keys(inputs).map((id) => [id, errorEntry])) };
  }

  const outputs = await cradle.videoExtractService.extractBatch(
    {
      samplingStrategy: config.sampling_strategy as SamplingStrategy,
      frameCount: config.frame_count,
    },
    inputs,
  );

  return { outputs };
}
