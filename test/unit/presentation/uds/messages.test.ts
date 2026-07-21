import { describe, it, expect } from 'vitest';
import { UdsServerMessage } from '../../../../src/presentation/uds/messages.js';

describe('UdsServerMessage', () => {
  it('exposes the static log messages used by server.ts as plain strings', () => {
    expect(UdsServerMessage.REJECTING_SECOND_CONNECTION).toBe(
      'rejecting data on a second uds connection while one is already active',
    );
    expect(UdsServerMessage.FRAME_DECODE_FAILED).toBe('failed to decode frame, closing connection');
    expect(UdsServerMessage.CONNECTION_ERROR).toBe('uds connection error');
    expect(UdsServerMessage.LISTENING).toBe('listening on unix domain socket');
    expect(UdsServerMessage.UNKNOWN_OP).toBe('received unknown op, ignoring');
    expect(UdsServerMessage.MALFORMED_EXTRACT_REQUEST).toBe('received malformed extract request, ignoring');
    expect(UdsServerMessage.HEALTHCHECK_TIMEOUT).toBe('healthcheck: connection timed out');
  });

  it('HEALTHCHECK_ENV_ERROR() prefixes the given message', () => {
    expect(UdsServerMessage.HEALTHCHECK_ENV_ERROR('SOCKET_PATH: Required')).toBe('healthcheck: SOCKET_PATH: Required');
  });

  it('HEALTHCHECK_CONNECTION_FAILED() prefixes the given message', () => {
    expect(UdsServerMessage.HEALTHCHECK_CONNECTION_FAILED('ECONNREFUSED')).toBe(
      'healthcheck: connection failed: ECONNREFUSED',
    );
  });
});
