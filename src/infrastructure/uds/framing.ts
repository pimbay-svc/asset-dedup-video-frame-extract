/**
 * This file is part of the PimBay Asset Dedup service.
 *
 * @author Jan Sarmir <sarmir@pimbay.dev>
 * @link   https://pimbay.dev
 *
 * For the full license information, see the LICENSE file.
 */

/**
 * Shared wire framing for the Unix domain socket protocol: every message
 * (both directions) is `[4 bytes: length, big-endian uint32][N bytes: UTF-8
 * JSON payload]`. There is no message boundary other than this length
 * prefix — partial reads must be buffered until a full frame is available.
 *
 * Pure logic, no `net`/socket dependency, so it can be unit-tested by
 * feeding it raw chunks directly — mirrors how `timestampSelection.ts` keeps
 * pure logic out of the ffmpeg-spawning provider for the same reason.
 */

const LENGTH_PREFIX_BYTES = 4;

export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  /**
   * Feeds newly received bytes in and returns any fully-decoded messages found so far
   * (zero, one, or more — a single chunk can contain multiple frames, or only part of one).
   */
  push(chunk: Buffer): unknown[] {
    // Stryker disable next-line ConditionalExpression: equivalent mutant — Buffer.concat([Buffer.alloc(0), chunk])
    // is byte-identical to `chunk`; this ternary is purely an allocation-avoidance optimization, not correctness.
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    const messages: unknown[] = [];

    for (;;) {
      if (this.buffer.length < LENGTH_PREFIX_BYTES) {
        break;
      }

      const payloadLength = this.buffer.readUInt32BE(0);
      const frameLength = LENGTH_PREFIX_BYTES + payloadLength;

      if (this.buffer.length < frameLength) {
        break; // rest of the frame hasn't arrived yet
      }

      const payload = this.buffer.subarray(LENGTH_PREFIX_BYTES, frameLength);
      messages.push(JSON.parse(payload.toString('utf-8')));
      this.buffer = this.buffer.subarray(frameLength);
    }

    return messages;
  }
}

export function encodeFrame(message: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(message), 'utf-8');
  const header = Buffer.alloc(LENGTH_PREFIX_BYTES);
  header.writeUInt32BE(payload.length, 0);

  return Buffer.concat([header, payload]);
}
