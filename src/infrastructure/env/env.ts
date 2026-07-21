/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { z } from 'zod';
import path from 'node:path';
import { EnvError } from './errors.js';

export const NodeEnv = {
  PRODUCTION: 'production',
  DEVELOPMENT: 'development',
  TEST: 'test',
} as const;

export type NodeEnv = (typeof NodeEnv)[keyof typeof NodeEnv];

const EnvSchema = z
  .object({
    NODE_ENV: z.enum([NodeEnv.PRODUCTION, NodeEnv.DEVELOPMENT, NodeEnv.TEST]).default(NodeEnv.PRODUCTION),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

    SOCKET_PATH: z.string().min(1),
    SHARED_VOLUME_DIR: z.string().min(1),
    OUTPUT_DIR: z.string().min(1).optional(),
    MAX_VIDEO_DURATION_S: z.coerce.number().int().positive().default(3600),

    FFMPEG_BIN: z.string().min(1).default('ffmpeg'),
    FFPROBE_BIN: z.string().min(1).default('ffprobe'),
    FFMPEG_TIMEOUT_MS: z.coerce.number().int().positive().default(20000),

    TTL_SWEEP_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(5 * 60 * 1000),
    TTL_RETENTION_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(60 * 60 * 1000),
  })
  .transform((env) => ({
    ...env,
    OUTPUT_DIR: env.OUTPUT_DIR ?? path.join(env.SHARED_VOLUME_DIR, 'video-frame-extract'),
  }));

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);

  if (!result.success) {
    throw EnvError.invalidConfiguration(result.error.toString());
  }

  return result.data;
}
