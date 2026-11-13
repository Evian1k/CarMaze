/**
 * Secret-box — server-side helpers for single-use handover credentials.
 *
 * QR tokens (logistics drop-off, procurement handover) are high-value
 * single-use credentials. Before this module they were stored as plaintext
 * and compared with `===`, so a database leak exposed every live handover
 * token. Now:
 *   - verification consults ONLY the SHA-256 hash (`qrTokenHash`)
 *   - the raw token is stored AES-256-GCM sealed (`qrTokenEnc`), keyed from
 *     AUTH_SECRET, so ONLY the intended requester-side UI can render the QR
 *     again; a database leak alone yields neither the hash preimage nor a
 *     usable token without the server key
 *   - legacy rows that still carry a plaintext token are upgraded lazily at
 *     verification time (hash computed, plaintext cleared) — no data loss
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { authSecret } from '@/lib/auth'

/** sha256 hex of a token — the only value stored for verification. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function boxKey(): Buffer {
  // 32-byte key derived from the mandatory AUTH_SECRET; production refuses to
  // sign sessions without AUTH_SECRET (≥32 chars), so the key is always
  // strong there. Resolved lazily: throws at first use in production when
  // AUTH_SECRET is missing.
  return createHash('sha256').update(`${authSecret()}:qr-token-box:v1`, 'utf8').digest()
}

/** AES-256-GCM seal. Returns iv.tag.ciphertext (all base64url). */
export function seal(plaintext: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', boxKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('base64url')}.${tag.toString('base64url')}.${ct.toString('base64url')}`
}

/** Open a seal() payload. Returns null on any tamper/format failure. */
export function unseal(payload: string | null | undefined): string | null {
  if (!payload) return null
  const parts = payload.split('.')
  if (parts.length !== 3) return null
  try {
    const [ivB64, tagB64, ctB64] = parts
    const decipher = createDecipheriv('aes-256-gcm', boxKey(), Buffer.from(ivB64, 'base64url'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
    return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64url')), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
