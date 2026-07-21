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
 * Accepts a single persistent client connection from `core` (connects once, stays open, reconnects on drop —
 * no per-request accept/close). A connection only becomes "active" once it sends its first valid frame, not
 * merely on accept, so the Docker healthcheck's silent connect-and-close probe can't race a live `core`
 * connection: a second connection is only rejected once *it* tries to send data while another is already active.
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

      /* v8 ignore next 3 -- decoders.set(socket, ...) runs synchronously as the first line of
         the 'connection' handler, before any 'data' event on this socket can fire; this guard
         exists only for defensive type-safety against the WeakMap lookup, never in practice. */
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

      // Stryker disable next-line ConditionalExpression: the guard above this handler ensures
      // this line only runs when activeSocket is null or === socket; in the latter case the
      // right operand being forced `true` just reassigns activeSocket to the value it already
      // holds — a no-op, unobservable from outside.
      if (messages.length > 0 && activeSocket === null) {
        activeSocket = socket;
      }

      for (const message of messages) {
        void dispatch(message, socket, cradle);
      }
    });

    socket.on('close', () => {
      // Stryker disable next-line CallExpression: `decoders` is a WeakMap and `socket` objects
      // are never reused across connections — skipping this delete has no externally observable
      // effect, only a marginally later GC of the entry.
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
