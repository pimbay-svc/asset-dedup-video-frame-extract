/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */

export const UdsServerMessage = {
  REJECTING_SECOND_CONNECTION: 'rejecting data on a second uds connection while one is already active',
  FRAME_DECODE_FAILED: 'failed to decode frame, closing connection',
  CONNECTION_ERROR: 'uds connection error',
  LISTENING: 'listening on unix domain socket',
  UNKNOWN_OP: 'received unknown op, ignoring',
  MALFORMED_EXTRACT_REQUEST: 'received malformed extract request, ignoring',

  HEALTHCHECK_ENV_ERROR: (message: string): string => `healthcheck: ${message}`,
  HEALTHCHECK_TIMEOUT: 'healthcheck: connection timed out',
  HEALTHCHECK_CONNECTION_FAILED: (message: string): string => `healthcheck: connection failed: ${message}`,
} as const;
