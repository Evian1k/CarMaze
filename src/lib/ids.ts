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

export function sixDigitCode(): string {
  return String(100000 + Math.floor(Math.random() * 900000))
}
