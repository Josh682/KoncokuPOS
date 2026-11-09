/**
 * Web Crypto SHA-256 helpers
 * Fully compatible with Browser, Cloudflare Workers, and Node.js (via globalThis.crypto)
 */

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const hashBuffer = await crypto.subtle.digest('SHA-256', data as unknown as BufferSource);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Hash 6-digit PIN for Cashier/Owner authentication
 */
export async function hashPin(pin: string, salt = 'koncoku_salt_v1'): Promise<string> {
  return sha256Hex(`${salt}:${pin}`);
}

/**
 * Hash 6-digit OTP for Void requests
 */
export async function hashOtp(otpCode: string): Promise<string> {
  return sha256Hex(otpCode.trim());
}

/**
 * Hash One-Click approval token
 */
export async function hashToken(token: string): Promise<string> {
  return sha256Hex(token.trim());
}

/**
 * Generate secure random hex token (default 32 bytes = 64 hex characters)
 */
export function generateSecureToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Generate 6-digit numeric OTP
 */
export function generateOtp6(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const otpNumber = (bytes[0]! % 900000) + 100000;
  return otpNumber.toString();
}
