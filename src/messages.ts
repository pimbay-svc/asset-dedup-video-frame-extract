/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */

export const ServerMessage = {
  SHUTTING_DOWN: 'shutting down',
  FORCED_EXIT: 'graceful shutdown did not finish in time, forcing exit',
  FATAL_STARTUP_ERROR: 'fatal error during startup:',
} as const;
