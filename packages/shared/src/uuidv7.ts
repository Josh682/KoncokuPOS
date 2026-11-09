/**
 * RFC 9562 UUIDv7 generator and validator
 * Compatible with Browser, Cloudflare Workers, and Node.js
 */

let lastTimestamp = -1;
let sequence = 0;

export function generateUUIDv7(timestampMs: number = Date.now()): string {
  if (timestampMs <= lastTimestamp) {
    sequence = (sequence + 1) & 0x0fff;
    if (sequence === 0) {
      timestampMs = lastTimestamp + 1;
    }
  } else {
    sequence = Math.floor(Math.random() * 0x0fff);
    lastTimestamp = timestampMs;
  }

  const randomBytes = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(randomBytes);
  } else {
    for (let i = 0; i < randomBytes.length; i++) {
      randomBytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // 48-bit timestamp in ms
  const timeHex = timestampMs.toString(16).padStart(12, '0');

  // 4-bit version (7) + 12-bit sequence
  const verAndSeq = ((7 << 12) | (sequence & 0x0fff)).toString(16).padStart(4, '0');

  // 2-bit variant (10xx xxxx)
  const varByte = (0x80 | (randomBytes[0]! & 0x3f)).toString(16).padStart(2, '0');
  const restRandA = randomBytes[1]!.toString(16).padStart(2, '0');
  const clockSeqAndVariant = `${varByte}${restRandA}`;

  // 48-bit node/rand_b (6 bytes = 12 hex chars)
  const nodeBytes = Array.from(randomBytes.subarray(2))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-${verAndSeq}-${clockSeqAndVariant}-${nodeBytes}`;
}

export const UUID_V7_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUUIDv7(uuid: string): boolean {
  return UUID_V7_REGEX.test(uuid);
}

export function extractTimestampFromUUIDv7(uuid: string): number | null {
  if (!isValidUUIDv7(uuid)) return null;
  const hexTime = uuid.replace(/-/g, '').slice(0, 12);
  return parseInt(hexTime, 16);
}
