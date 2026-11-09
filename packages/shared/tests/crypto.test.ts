import { describe, it, expect } from 'vitest';
import {
  sha256Hex,
  hashPin,
  hashOtp,
  hashToken,
  generateSecureToken,
  generateOtp6,
} from '../src/crypto';

describe('Web Crypto SHA-256 Helpers', () => {
  it('computes correct SHA-256 hex string for empty string and known inputs', async () => {
    // NIST test vector for empty string
    const emptyHash = await sha256Hex('');
    expect(emptyHash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

    // SHA-256 of '123456'
    const pinHash = await sha256Hex('123456');
    expect(pinHash).toBe('8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92');
  });

  it('hashes 6-digit PIN with salt', async () => {
    const ownerPinHash = await hashPin('123456', 'koncoku_salt_v1');
    expect(ownerPinHash).toBe('f33ff495acfe467070a911bb00cd610b058fd6b2e2a8746154b5ff7c5702f343');

    const cashierPinHash = await hashPin('111111', 'koncoku_salt_v1');
    expect(cashierPinHash).toBe('e53451a2043af8c370f2718505335eeaf8c91ab8a00876024d905dfa5b3a66dd');
  });

  it('hashes OTP and tokens deterministically', async () => {
    const otpHash = await hashOtp('654321');
    expect(otpHash).toHaveLength(64);

    const tokenHash = await hashToken('test_one_click_approval_token_12345');
    expect(tokenHash).toHaveLength(64);
  });

  it('generates secure 6-digit OTP', () => {
    for (let i = 0; i < 20; i++) {
      const otp = generateOtp6();
      expect(otp).toMatch(/^\d{6}$/);
      const num = parseInt(otp, 10);
      expect(num).toBeGreaterThanOrEqual(100000);
      expect(num).toBeLessThanOrEqual(999999);
    }
  });

  it('generates secure random hex token of specified length', () => {
    const token32 = generateSecureToken(32);
    expect(token32).toMatch(/^[0-9a-f]{64}$/);

    const token16 = generateSecureToken(16);
    expect(token16).toMatch(/^[0-9a-f]{32}$/);
  });
});
