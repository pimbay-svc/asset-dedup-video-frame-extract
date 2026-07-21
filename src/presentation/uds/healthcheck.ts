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
 * Run directly as the Docker HEALTHCHECK command. Success means the socket
 * file exists and this process accepts a connection on it — nothing more.
 * Deliberately does not send any bytes: sending a real `op` here would mean
 * inventing a protocol extension `core` doesn't know about, purely to serve
 * an operational check. See server.ts for why a silent, empty connection
 * like this one never gets treated as "the" active connection.
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
