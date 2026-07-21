import { describe, it, expect } from 'vitest';
import { ServerMessage } from '../../src/messages.js';

describe('ServerMessage', () => {
  it('exposes the static messages used by server.ts as plain strings', () => {
    expect(ServerMessage.SHUTTING_DOWN).toBe('shutting down');
    expect(ServerMessage.FORCED_EXIT).toBe('graceful shutdown did not finish in time, forcing exit');
    expect(ServerMessage.FATAL_STARTUP_ERROR).toBe('fatal error during startup:');
  });
});
