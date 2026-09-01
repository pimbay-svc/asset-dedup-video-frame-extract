/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import net from 'node:net';
import { loadEnv } from '../../infrastructure/env/env.js';
import { EnvError } from '../../infrastructure/env/errors.js';
import { UdsServerMessage } from './messages.js';

const TIMEOUT_MS = 3000;

/**
 * Run as the Docker HEALTHCHECK command. Success means only that the socket exists and accepts a
 * connection — no bytes are sent, since any `op` here would be a protocol extension `core` doesn't
 * know. See server.ts for why this silent connection never becomes "the" active one.
 */
function main(): void {
  let socketPath: string;

  try {
    socketPath = loadEnv().SOCKET_PATH;
  } catch (err) {
    const message = err instanceof EnvError ? err.message : String(err);
    console.error(UdsServerMessage.HEALTHCHECK_ENV_ERROR(message));
    process.exit(1);

    return;
  }

  const socket = net.connect({ path: socketPath });

  const timer = setTimeout(() => {
    socket.destroy();
    console.error(UdsServerMessage.HEALTHCHECK_TIMEOUT);
    process.exit(1);
  }, TIMEOUT_MS);

  socket.on('connect', () => {
    clearTimeout(timer);
    socket.end();
    process.exit(0);
  });

  socket.on('error', (err) => {
    clearTimeout(timer);
    console.error(UdsServerMessage.HEALTHCHECK_CONNECTION_FAILED(err.message));
    process.exit(1);
  });
}

main();
