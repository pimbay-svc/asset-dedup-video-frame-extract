import { describe, it, expect } from 'vitest';
import { FrameDecoder, encodeFrame } from '../../../../src/infrastructure/uds/framing.js';

describe('encodeFrame', () => {
  it('prefixes the JSON payload with its length as a 4-byte big-endian uint32', () => {
    const message = { op: 'extract' };
    const frame = encodeFrame(message);
    const expectedPayload = Buffer.from(JSON.stringify(message), 'utf-8');

    expect(frame.readUInt32BE(0)).toBe(expectedPayload.length);
    expect(frame.subarray(4)).toEqual(expectedPayload);
  });
});

describe('FrameDecoder', () => {
  it('decodes a single frame delivered in one chunk', () => {
    const decoder = new FrameDecoder();
    const message = { outputs: { id1: { paths: ['/shared/a.png'] } } };

    const result = decoder.push(encodeFrame(message));

    expect(result).toEqual([message]);
  });

  it('decodes multiple frames delivered in a single chunk', () => {
    const decoder = new FrameDecoder();
    const first = { op: 'extract', n: 1 };
    const second = { op: 'extract', n: 2 };

    const combined = Buffer.concat([encodeFrame(first), encodeFrame(second)]);
    const result = decoder.push(combined);

    expect(result).toEqual([first, second]);
  });

  it('buffers a frame split across multiple chunks and only emits once complete', () => {
    const decoder = new FrameDecoder();
    const message = { op: 'extract', inputs: { id1: { path: '/shared/video.mp4' } } };
    const frame = encodeFrame(message);

    const firstHalf = frame.subarray(0, 6);
    const secondHalf = frame.subarray(6);

    expect(decoder.push(firstHalf)).toEqual([]);
    expect(decoder.push(secondHalf)).toEqual([message]);
  });

  it('buffers when even the 4-byte length header itself arrives split', () => {
    const decoder = new FrameDecoder();
    const message = { op: 'extract' };
    const frame = encodeFrame(message);

    expect(decoder.push(frame.subarray(0, 2))).toEqual([]);
    expect(decoder.push(frame.subarray(2))).toEqual([message]);
  });

  it('carries a leftover partial frame forward into the next push call', () => {
    const decoder = new FrameDecoder();
    const first = { op: 'extract', n: 1 };
    const second = { op: 'extract', n: 2 };

    const firstFrame = encodeFrame(first);
    const secondFrame = encodeFrame(second);

    // first frame complete + first 3 bytes of the second frame's header
    const chunk1 = Buffer.concat([firstFrame, secondFrame.subarray(0, 3)]);
    const chunk2 = secondFrame.subarray(3);

    expect(decoder.push(chunk1)).toEqual([first]);
    expect(decoder.push(chunk2)).toEqual([second]);
  });

  it('throws when a header exactly fills the buffer and claims a zero-length payload', () => {
    const decoder = new FrameDecoder();
    // Buffer length === LENGTH_PREFIX_BYTES exactly (4), header all-zero -> claims a payload of
    // 0 bytes. A zero-length payload can never be valid JSON, so this must surface as a thrown
    // error immediately rather than being silently treated as "still waiting for more bytes" —
    // the two only differ observably at this exact boundary (buffer.length === header size).
    const zeroLengthHeader = Buffer.alloc(4);

    expect(() => decoder.push(zeroLengthHeader)).toThrow();
  });
});
