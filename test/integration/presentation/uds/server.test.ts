import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import net from 'node:net';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildUdsServer, type UdsServerHandle } from '../../../../src/presentation/uds/server.js';
import { FrameDecoder, encodeFrame } from '../../../../src/infrastructure/uds/framing.js';
import type { Cradle } from '../../../../src/infrastructure/container.js';
import { fakeLogger } from '../../../helpers/logger.js';
import { UdsServerMessage } from '../../../../src/presentation/uds/messages.js';

function connectFrames(socketPath: string): Promise<{ socket: net.Socket; decoder: FrameDecoder }> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ path: socketPath });
    const decoder = new FrameDecoder();
    socket.once('connect', () => {
      resolve({ socket, decoder });
    });
    socket.once('error', reject);
  });
}

function nextFrame(socket: net.Socket, decoder: FrameDecoder): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once('data', (chunk: Buffer) => {
      const [message] = decoder.push(chunk);
      resolve(message);
    });
  });
}

function waitForClose(socket: net.Socket): Promise<void> {
  return new Promise((resolve) =>
    socket.once('close', () => {
      resolve();
    }),
  );
}

describe('UDS server', () => {
  let dir: string;
  let socketPath: string;
  let handle: UdsServerHandle;
  let extractBatch: ReturnType<typeof vi.fn>;
  let cradle: Cradle;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'uds-server-test-'));
    socketPath = path.join(dir, 'video-frame-extract.sock');
    extractBatch = vi.fn().mockResolvedValue({ id1: { paths: ['/shared/out/a-0.png'] } });

    cradle = {
      env: { SOCKET_PATH: socketPath },
      logger: fakeLogger(),
      videoExtractService: { extractBatch },
    } as unknown as Cradle;

    handle = await buildUdsServer(cradle);
  });

  afterEach(async () => {
    await handle.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('logs the socket path once listening starts', () => {
    expect(cradle.logger.info).toHaveBeenCalledWith({ socketPath }, UdsServerMessage.LISTENING);
  });

  it('removes a stale socket file left by an unclean shutdown and listens successfully', async () => {
    // A plain file at the path (not a live listener) is exactly what a Unix domain socket file
    // looks like after the process that owned it was SIGKILLed rather than shutting down
    // cleanly — connecting to it fails, so it must be treated as stale and removed, not left to
    // make this listen() fail with a false EADDRINUSE.
    const stalePath = path.join(dir, 'stale.sock');
    await writeFile(stalePath, '');

    const staleCradle = {
      env: { SOCKET_PATH: stalePath },
      logger: fakeLogger(),
      videoExtractService: { extractBatch },
    } as unknown as Cradle;

    const staleHandle = await buildUdsServer(staleCradle);
    await staleHandle.close();
  });

  it('rejects if the stale-socket cleanup itself fails for a non-ENOENT reason', async () => {
    // A directory at the socket path isn't a live listener either (connecting to it still
    // fails, so it's treated as "stale" and unlink is attempted) — but unlink() on a directory
    // fails with EISDIR, not ENOENT, and that must propagate rather than being silently
    // swallowed the way a genuinely-missing file (ENOENT) is.
    const dirAtSocketPath = path.join(dir, 'blocking-dir.sock');
    await mkdir(dirAtSocketPath);

    const badCradle = {
      env: { SOCKET_PATH: dirAtSocketPath },
      logger: fakeLogger(),
      videoExtractService: { extractBatch },
    } as unknown as Cradle;

    await expect(buildUdsServer(badCradle)).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('removes its own startup error listener once listening succeeds', () => {
    // If server.ts's removeListener('error', reject) call didn't fire (or fired for the wrong
    // event name), this stray listener from startup would remain attached indefinitely.
    expect(handle.server.listenerCount('error')).toBe(0);
  });

  it('rejects if the socket path is already bound by another listener', async () => {
    // A second server on the exact same UDS path triggers a real EADDRINUSE 'error' event
    // during listen() — proving server.once('error', reject) is wired to the real event name,
    // not a mutated one that would never fire and leave this hanging forever.
    const secondCradle = {
      env: { SOCKET_PATH: socketPath },
      logger: fakeLogger(),
      videoExtractService: { extractBatch },
    } as unknown as Cradle;

    await expect(buildUdsServer(secondCradle)).rejects.toThrow();
  });

  it('completes an extract round trip over a single connection', async () => {
    const { socket, decoder } = await connectFrames(socketPath);

    const responsePromise = nextFrame(socket, decoder);
    socket.write(
      encodeFrame({
        op: 'extract',
        config: { sampling_strategy: 'uniform', frame_count: 5 },
        inputs: { id1: { path: '/shared/a.mp4' } },
      }),
    );

    expect(await responsePromise).toEqual({ outputs: { id1: { paths: ['/shared/out/a-0.png'] } } });
    socket.destroy();
  });

  it('handles a second request on the same already-active connection', async () => {
    const { socket, decoder } = await connectFrames(socketPath);

    const firstResponse = nextFrame(socket, decoder);
    socket.write(encodeFrame({ op: 'extract', config: { sampling_strategy: 'uniform', frame_count: 5 }, inputs: {} }));
    await firstResponse;

    const secondResponse = nextFrame(socket, decoder);
    socket.write(encodeFrame({ op: 'extract', config: { sampling_strategy: 'uniform', frame_count: 5 }, inputs: {} }));

    expect(await secondResponse).toEqual({ outputs: { id1: { paths: ['/shared/out/a-0.png'] } } });
    expect(extractBatch).toHaveBeenCalledTimes(2);
    socket.destroy();
  });

  it('rejects data from a second connection while one is already active', async () => {
    const first = await connectFrames(socketPath);
    const firstResponse = nextFrame(first.socket, first.decoder);
    first.socket.write(
      encodeFrame({ op: 'extract', config: { sampling_strategy: 'uniform', frame_count: 5 }, inputs: {} }),
    );
    await firstResponse; // first connection is now "active"

    const second = await connectFrames(socketPath);
    const secondClosed = waitForClose(second.socket);
    second.socket.write(
      encodeFrame({ op: 'extract', config: { sampling_strategy: 'uniform', frame_count: 5 }, inputs: {} }),
    );

    await secondClosed;
    expect(extractBatch).toHaveBeenCalledTimes(1);
    expect(cradle.logger.warn).toHaveBeenCalledOnce();

    first.socket.destroy();
  });

  it('an incomplete frame on a second connection does not claim the active slot', async () => {
    const partial = await connectFrames(socketPath);
    // Only 2 of the 4 length-prefix header bytes -> decoder.push() returns zero messages for
    // this connection. It must NOT become "active" off the back of this alone.
    partial.socket.write(Buffer.alloc(2));

    // give the (synchronous) dispatch a tick to run before the real connection attempts below
    await new Promise((resolve) => setTimeout(resolve, 20));

    const real = await connectFrames(socketPath);
    const responsePromise = nextFrame(real.socket, real.decoder);
    real.socket.write(
      encodeFrame({ op: 'extract', config: { sampling_strategy: 'uniform', frame_count: 5 }, inputs: {} }),
    );

    expect(await responsePromise).toEqual({ outputs: { id1: { paths: ['/shared/out/a-0.png'] } } });

    partial.socket.destroy();
    real.socket.destroy();
  });

  it('closing a rejected (non-active) connection does not clear the real active connection', async () => {
    const active = await connectFrames(socketPath);
    const activeResponse = nextFrame(active.socket, active.decoder);
    active.socket.write(
      encodeFrame({ op: 'extract', config: { sampling_strategy: 'uniform', frame_count: 5 }, inputs: {} }),
    );
    await activeResponse;

    const rejected = await connectFrames(socketPath);
    const rejectedClosed = waitForClose(rejected.socket);
    rejected.socket.write(
      encodeFrame({ op: 'extract', config: { sampling_strategy: 'uniform', frame_count: 5 }, inputs: {} }),
    );
    await rejectedClosed; // server destroyed it immediately — `active` still holds the slot

    // A third connection must still be rejected too — proves `rejected`'s own close handler
    // didn't wrongly clear the active slot, which would let this one slip through instead.
    const third = await connectFrames(socketPath);
    const thirdClosed = waitForClose(third.socket);
    third.socket.write(
      encodeFrame({ op: 'extract', config: { sampling_strategy: 'uniform', frame_count: 5 }, inputs: {} }),
    );

    await thirdClosed;
    expect(extractBatch).toHaveBeenCalledTimes(1); // only `active`'s original request went through

    active.socket.destroy();
  });

  it('clears the active slot once the actually-active connection closes', async () => {
    const first = await connectFrames(socketPath);
    const firstResponse = nextFrame(first.socket, first.decoder);
    first.socket.write(
      encodeFrame({ op: 'extract', config: { sampling_strategy: 'uniform', frame_count: 5 }, inputs: {} }),
    );
    await firstResponse;

    first.socket.destroy();
    await waitForClose(first.socket);

    // With the previous active connection gone, a new one must be accepted in its place — if
    // the active slot never clears, this would be rejected forever instead.
    const second = await connectFrames(socketPath);
    const secondResponse = nextFrame(second.socket, second.decoder);
    second.socket.write(
      encodeFrame({ op: 'extract', config: { sampling_strategy: 'uniform', frame_count: 5 }, inputs: {} }),
    );

    expect(await secondResponse).toEqual({ outputs: { id1: { paths: ['/shared/out/a-0.png'] } } });
    second.socket.destroy();
  });

  it('a connection that closes without sending data never becomes active (healthcheck-style probe)', async () => {
    const probe = await connectFrames(socketPath);
    probe.socket.end(); // no data sent at all, mirrors healthcheck.ts

    await waitForClose(probe.socket);

    // A real connection afterwards must still be accepted as the (only) active one.
    const real = await connectFrames(socketPath);
    const responsePromise = nextFrame(real.socket, real.decoder);
    real.socket.write(
      encodeFrame({ op: 'extract', config: { sampling_strategy: 'uniform', frame_count: 5 }, inputs: {} }),
    );

    expect(await responsePromise).toEqual({ outputs: { id1: { paths: ['/shared/out/a-0.png'] } } });
    real.socket.destroy();
  });

  it('closes the connection on undecodable bytes', async () => {
    const { socket } = await connectFrames(socketPath);
    const closed = waitForClose(socket);

    // valid 4-byte length header claiming a 3-byte payload, followed by
    // bytes that are not valid JSON.
    const header = Buffer.alloc(4);
    header.writeUInt32BE(3, 0);
    socket.write(Buffer.concat([header, Buffer.from('!@#')]));

    await closed;
    const call = vi.mocked(cradle.logger.error).mock.calls[0] as unknown[] | undefined;
    const payload = call?.[0] as { err?: unknown } | undefined;
    expect(payload?.err).toBeInstanceOf(Error);
    expect(call?.[1]).toBe(UdsServerMessage.FRAME_DECODE_FAILED);
  });

  it('survives a structurally malformed extract message instead of crashing the process', async () => {
    const { socket, decoder } = await connectFrames(socketPath);

    socket.write(encodeFrame({ op: 'extract', inputs: { id1: { path: '/shared/a.mp4' } } }));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(extractBatch).not.toHaveBeenCalled();

    // The connection is still open and the server still responds normally afterwards.
    const responsePromise = nextFrame(socket, decoder);
    socket.write(
      encodeFrame({
        op: 'extract',
        config: { sampling_strategy: 'uniform', frame_count: 5 },
        inputs: { id1: { path: '/shared/a.mp4' } },
      }),
    );

    expect(await responsePromise).toEqual({ outputs: { id1: { paths: ['/shared/out/a-0.png'] } } });
    socket.destroy();
  });

  it('survives a bare `null` JSON frame instead of crashing on an unsafe `.op` read', async () => {
    const { socket, decoder } = await connectFrames(socketPath);

    // `null` is valid JSON and decodes successfully, so this never hits the frame-decode-failure
    // path — it's a value that isn't even an object, which used to throw on `message.op`.
    socket.write(encodeFrame(null));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(extractBatch).not.toHaveBeenCalled();

    const responsePromise = nextFrame(socket, decoder);
    socket.write(
      encodeFrame({
        op: 'extract',
        config: { sampling_strategy: 'uniform', frame_count: 5 },
        inputs: { id1: { path: '/shared/a.mp4' } },
      }),
    );

    expect(await responsePromise).toEqual({ outputs: { id1: { paths: ['/shared/out/a-0.png'] } } });
    socket.destroy();
  });

  it('ignores an unrecognized op and never calls the service', async () => {
    const { socket } = await connectFrames(socketPath);

    socket.write(encodeFrame({ op: 'ping' }));
    // give the (synchronous) dispatch a tick to run before asserting silence
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(extractBatch).not.toHaveBeenCalled();
    expect(cradle.logger.warn).toHaveBeenCalledWith({ op: 'ping' }, UdsServerMessage.UNKNOWN_OP);
    socket.destroy();
  });

  it('logs but does not crash on a socket-level error event', async () => {
    const serverSocketPromise = new Promise<net.Socket>((resolve) => {
      handle.server.once('connection', resolve);
    });

    const { socket } = await connectFrames(socketPath);
    const serverSocket = await serverSocketPromise;

    const simulatedError = new Error('simulated');
    expect(() => serverSocket.emit('error', simulatedError)).not.toThrow();
    expect(cradle.logger.warn).toHaveBeenCalledWith({ err: simulatedError }, UdsServerMessage.CONNECTION_ERROR);

    socket.destroy();
  });
});
