import net from 'node:net';
import { FrameDecoder, encodeFrame } from '../../src/infrastructure/uds/framing.js';

const [, , socketPath, videoPath, frameCountRaw, samplingStrategy] = process.argv;

if (socketPath === undefined || videoPath === undefined) {
  console.error('usage: extract-client.ts <socket_path> <video_path> [frame_count] [sampling_strategy]');
  process.exit(1);
}

const frameCount = Number.parseInt(frameCountRaw ?? '5', 10);

const request = {
  op: 'extract',
  config: {
    sampling_strategy: samplingStrategy ?? 'uniform',
    frame_count: frameCount,
  },
  inputs: {
    id1: { path: videoPath },
  },
};

const socket = net.connect({ path: socketPath }, () => {
  socket.write(encodeFrame(request));
});

const decoder = new FrameDecoder();

socket.on('data', (chunk: Buffer) => {
  for (const message of decoder.push(chunk)) {
    console.log(JSON.stringify(message, null, 2));
  }
  socket.end();
});

socket.on('error', (err) => {
  console.error(`connection failed: ${err.message}`);
  process.exit(1);
});
