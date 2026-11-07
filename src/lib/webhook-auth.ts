import { timingSafeEqual } from 'crypto'

/**
 * Optional shared-secret validation for payment provider webhooks.
 *
 * Safaricom Daraja does not sign callbacks with an HMAC; production hardening
 * is normally done with IP allow-listing at the edge or mutual TLS. As a
 * deployable middle ground, this deployment supports a shared secret: set
 * MPESA_WEBHOOK_SECRET and every webhook request must present the same value
 * in the `x-carmaze-signature` header. Comparison is timing-safe.
 *
 * When the secret is NOT configured:
 *  - in development/sandbox the webhook is accepted without source validation
 *    (documented limitation, recorded per-request in the audit log);
 *  - in production the webhook is REJECTED (fail-closed): a payment endpoint
 *    must never accept forged callbacks just because configuration is missing.
 *    Set MPESA_WEBHOOK_SECRET (and allow-list Safaricom IPs at the edge) before
 *    going live.
 */
export function verifyWebhookSignature(req: Request): { ok: boolean; mode: 'SIGNED' | 'UNSIGNED' } {
  const secret = process.env.MPESA_WEBHOOK_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') return { ok: false, mode: 'UNSIGNED' }
    return { ok: true, mode: 'UNSIGNED' }
  }
  const provided = req.headers.get('x-carmaze-signature') ?? ''
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  const ok = a.length === b.length && timingSafeEqual(a, b)
  return { ok, mode: 'SIGNED' }
}

export function webhookRejected(): { status: number; body: Record<string, unknown> } {
  // 401 without detail: never reveal why a webhook was rejected.
  return { status: 401, body: { ResultCode: 1, ResultDesc: 'Rejected' } }
}
