import { randomBytes } from 'crypto'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function refCode(prefix: string, len = 6): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return `${prefix}-${out}`
}

export function shareId(len = 12): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

/**
 * Cryptographically secure six-digit code.
 * Uses rejection sampling over randomBytes so every code is equally likely
 * (no modulo bias). Used for email/phone verification, dispatch handover OTP
 * and custody collection codes — security-sensitive, never Math.random.
 */
export function sixDigitCode(): string {
  const max = 900000 // 100000..999999
  const limit = Math.floor(0x100000000 / max) * max // largest multiple of max below 2^32
  const buf = Buffer.alloc(4)
  for (;;) {
    randomBytes(4).copy(buf)
    const value = buf.readUInt32BE(0)
    if (value < limit) return String(100000 + (value % max))
  }
}
