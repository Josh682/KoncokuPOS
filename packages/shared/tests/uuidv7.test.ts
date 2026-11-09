import { describe, it, expect } from 'vitest';
import {
  generateUUIDv7,
  isValidUUIDv7,
  extractTimestampFromUUIDv7,
} from '../src/uuidv7';

describe('UUIDv7 Generator & Validator', () => {
  it('generates a valid RFC 9562 UUIDv7 format', () => {
    const uuid = generateUUIDv7();
    expect(uuid).toBeDefined();
    expect(uuid.length).toBe(36);
    expect(isValidUUIDv7(uuid)).toBe(true);

    // Check version digit is 7
    expect(uuid.charAt(14)).toBe('7');

    // Check variant digit is 8, 9, a, or b
    const variantChar = uuid.charAt(19).toLowerCase();
    expect(['8', '9', 'a', 'b']).toContain(variantChar);
  });

  it('generates monotonically increasing UUIDs in sequence', () => {
    const u1 = generateUUIDv7();
    const u2 = generateUUIDv7();
    const u3 = generateUUIDv7();

    expect(isValidUUIDv7(u1)).toBe(true);
    expect(isValidUUIDv7(u2)).toBe(true);
    expect(isValidUUIDv7(u3)).toBe(true);

    // Lexicographical order must hold for UUIDv7
    expect(u1 < u2 || u1 === u2).toBe(true);
    expect(u2 < u3 || u2 === u3).toBe(true);
  });

  it('extracts correct timestamp from UUIDv7', () => {
    const now = 1731110400000;
    const uuid = generateUUIDv7(now);
    const extracted = extractTimestampFromUUIDv7(uuid);

    expect(extracted).toBe(now);
  });

  it('rejects invalid or non-v7 UUIDs', () => {
    // UUIDv4 (version 4)
    expect(isValidUUIDv7('f47ac10b-58cc-4372-a567-0e02b2c3d479')).toBe(false);

    // Random strings
    expect(isValidUUIDv7('not-a-uuid')).toBe(false);
    expect(isValidUUIDv7('')).toBe(false);
    expect(isValidUUIDv7('01931000-0000-8000-8000-000000000001')).toBe(false); // version 8
  });
});
