/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */
import net from 'node:net';
import { unlink } from 'node:fs/promises';
import type pino from 'pino';
import type { Cradle } from '../../infrastructure/container.js';
import { FrameDecoder, encodeFrame } from '../../infrastructure/uds/framing.js';
import { handleExtract } from './socket/extract.socket.js';
import { UdsServerMessage } from './messages.js';

export interface UdsServerHandle {
  server: net.Server;
  close: () => Promise<void>;
}

async function removeStaleSocket(socketPath: string): Promise<void> {
  const isStale = await new Promise<boolean>((resolve) => {
    const probe = net.connect(socketPath);
    probe.once('connect', () => {
      probe.destroy();
      resolve(false);
    });
    probe.once('error', () => {
      resolve(true);
    });
  });

  if (!isStale) {
    return;
  }

  try {
    await unlink(socketPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err;
    }
  }
}

/**
 * Accepts a single persistent connection from `core` (connect once, stay open, reconnect on drop).
 * A connection becomes "active" only on its first valid frame, not on accept — so the healthcheck's
 * silent connect-and-close probe can never be mistaken for `core` and block a real connection.
 */
export async function buildUdsServer(cradle: Cradle): Promise<UdsServerHandle> {
  const logger: pino.Logger = cradle.logger;
  const server = net.createServer();
  const decoders = new WeakMap<net.Socket, FrameDecoder>();
  let activeSocket: net.Socket | null = null;

  server.on('connection', (socket) => {
    decoders.set(socket, new FrameDecoder());

    socket.on('data', (chunk: Buffer) => {
      if (activeSocket !== null && activeSocket !== socket) {
        logger.warn(UdsServerMessage.REJECTING_SECOND_CONNECTION);
        socket.destroy();

        return;
      }

      const decoder = decoders.get(socket);

      /* v8 ignore next 3 -- decoders.set() runs before any 'data' event can fire on this socket;
         this guard is defensive type-safety for the WeakMap lookup only, never hit in practice. */
      if (decoder === undefined) {
        return;
      }

      let messages: unknown[];
      try {
        messages = decoder.push(chunk);
      } catch (err) {
        logger.error({ err }, UdsServerMessage.FRAME_DECODE_FAILED);
        socket.destroy();

        return;
      }

      // Stryker disable next-line ConditionalExpression: activeSocket is here null or === socket,
      // so forcing the right operand true just reassigns it to its current value — unobservable.
      if (messages.length > 0 && activeSocket === null) {
        activeSocket = socket;
      }

      for (const message of messages) {
        void dispatch(message, socket, cradle);
      }
    });

    socket.on('close', () => {
      // Stryker disable next-line CallExpression: sockets are never reused, so skipping this
      // WeakMap delete has no observable effect beyond a slightly later GC of the entry.
      decoders.delete(socket);
      if (activeSocket === socket) {
        activeSocket = null;
      }
    });

    socket.on('error', (err) => {
      logger.warn({ err }, UdsServerMessage.CONNECTION_ERROR);
    });
  });

  await removeStaleSocket(cradle.env.SOCKET_PATH);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(cradle.env.SOCKET_PATH, () => {
      server.removeListener('error', reject);
      logger.info({ socketPath: cradle.env.SOCKET_PATH }, UdsServerMessage.LISTENING);
      resolve();
    });
  });

  return {
    server,
    close: (): Promise<void> =>
      new Promise<void>((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

async function dispatch(message: unknown, socket: net.Socket, cradle: Cradle): Promise<void> {
  const op = extractOp(message);

  if (op !== 'extract') {
    cradle.logger.warn({ op }, UdsServerMessage.UNKNOWN_OP);

    return;
  }

  const response = await handleExtract(message, cradle);

  if (response === null) {
    return;
  }

  socket.write(encodeFrame(response));
}

function extractOp(message: unknown): unknown {
  if (message === null) {
    return undefined;
  }

  return (message as { op?: unknown }).op;
}
