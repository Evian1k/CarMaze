// CARMAZE: TOTP (RFC 6238) two-factor helpers, pure node:crypto (no new deps).
//
// Includes base32 (RFC 4648) encode/decode, secret generation, verification
// with a ±1 step drift window and constant-time code comparison, plus the
// otpauth:// provisioning URI for authenticator apps.
//
// Short-lived MFA challenge JWTs are signed/verified here too (same AUTH_SECRET
// as session cookies): they live alongside the MFA lib because src/lib/auth.ts
// owns only the long-lived session contract.

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { SignJWT, jwtVerify } from 'jose'

const TOTP_STEP_SEC = 30
const TOTP_DIGITS = 6
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

// ───────────────────────────── base32 (RFC 4648) ─────────────────────────────

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** Throws on characters outside the base32 alphabet; padding/whitespace is ignored. */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=]/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) throw new Error('invalid base32 character')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

// ───────────────────────────── TOTP (RFC 6238) ─────────────────────────────

/** 160-bit secret, base32-encoded: the standard size for authenticator apps. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20))
}

function hotpAt(key: Buffer, counter: number): string {
  const msg = Buffer.alloc(8)
  msg.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', key).update(msg).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const bin =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  return String(bin % 1_000_000).padStart(TOTP_DIGITS, '0')
}

/** Verify a 6-digit TOTP code (SHA1, 30s step) allowing ±window steps of drift. */
export function verifyTotp(secret: string, code: string, window = 1): boolean {
  const normalized = (code ?? '').replace(/[\s-]/g, '')
  if (!/^\d{6}$/.test(normalized)) return false
  let key: Buffer
  try {
    key = base32Decode(secret)
  } catch {
    return false
  }
  if (key.length === 0) return false
  const counter = Math.floor(Date.now() / 1000 / TOTP_STEP_SEC)
  const candidate = Buffer.from(normalized, 'utf8')
  for (let i = -window; i <= window; i++) {
    const expected = Buffer.from(hotpAt(key, counter + i), 'utf8')
    if (expected.length === candidate.length && timingSafeEqual(expected, candidate)) return true
  }
  return false
}

/** Provisioning URI for Google Authenticator / Authy / 1Password etc. */
export function totpUri(secret: string, account: string): string {
  const label = encodeURIComponent(`CARMAZE:${account}`)
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('CARMAZE')}`
}

// ─────────────────── Short-lived MFA challenge tokens ───────────────────

// Dev fallback matches src/lib/auth.ts: production must set AUTH_SECRET.
const mfaJwtSecret = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'carmaze-dev-secret-change-in-production'
)

const MFA_CHALLENGE_TTL_SEC = 5 * 60

/** Sign a 5-minute challenge JWT after a successful password check on an
 * MFA-enabled account. scope:'mfa' keeps it exchangeable only for a session. */
export async function signMfaChallenge(userId: string): Promise<string> {
  return new SignJWT({ scope: 'mfa' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${MFA_CHALLENGE_TTL_SEC}s`)
    .sign(mfaJwtSecret)
}

/** Returns the user id for a valid, unexpired challenge token: null otherwise. */
export async function verifyMfaChallenge(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, mfaJwtSecret)
    if (payload.scope !== 'mfa' || !payload.sub) return null
    return payload.sub
  } catch {
    return null
  }
}
