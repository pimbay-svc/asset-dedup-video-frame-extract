/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import { createContainer, asClass, asValue, InjectionMode, type AwilixContainer } from 'awilix';
import pino from 'pino';
import type { Env } from './env/env.js';
import { createLoggerOptions } from './logger.js';
import { VideoProvider } from './video/videoProvider.js';
import { IdProvider } from './id/idProvider.js';
import { TtlSweeper } from './storage/ttlSweeper.js';
import { VideoExtractService } from '../application/service/extract.service.js';

export interface Cradle {
  env: Env;
  logger: pino.Logger;

  videoExtractor: VideoProvider;
  idGenerator: IdProvider;
  videoExtractService: VideoExtractService;
  ttlSweeper: TtlSweeper;
}

export interface BuiltContainer {
  container: AwilixContainer<Cradle>;
  cleanup: () => Promise<void>;
}

export function buildContainer(env: Env): BuiltContainer {
  const container = createContainer<Cradle>({ injectionMode: InjectionMode.CLASSIC });
  const logger = pino(createLoggerOptions(env));

  container.register({
    env: asValue(env),
    logger: asValue(logger),

    videoExtractor: asClass(VideoProvider).singleton(),
    idGenerator: asClass(IdProvider).singleton(),
    videoExtractService: asClass(VideoExtractService).singleton(),
    ttlSweeper: asClass(TtlSweeper).singleton(),
  });

  const stopTtlSweep = container.cradle.ttlSweeper.start();

  return {
    container,
    cleanup: (): Promise<void> => {
      stopTtlSweep();

      return Promise.resolve();
    },
  };
}
