import { createTransport, type Transporter } from 'nodemailer'

/**
 * Email delivery provider (SMTP).
 *
 * Configuration (environment variable names only):
 *   SMTP_URL   — transport URL, e.g. smtp://user:pass@host:port or smtps://…
 *   MAIL_FROM  — optional From header, defaults to CARMAZE <no-reply@carmaze.co.ke>
 *
 * `sendEmail` returns accepted=false when the provider did not accept the
 * message for at least one recipient. Callers must record SENT only when
 * accepted=true — the provider's acknowledgement is the only delivery proof.
 */

let cachedUrl: string | null = null
let cachedTransport: Transporter | null = null

export function emailProviderConfigured(): boolean {
  return Boolean(process.env.SMTP_URL)
}

export const DEFAULT_FROM = 'CARMAZE <no-reply@carmaze.co.ke>'

function getTransport(): Transporter {
  const url = process.env.SMTP_URL as string
  if (!cachedTransport || cachedUrl !== url) {
    cachedTransport = createTransport(url)
    cachedUrl = url
  }
  return cachedTransport
}

export type EmailSendResult = { accepted: boolean; detail: string }

export async function sendEmail(params: { to: string; subject: string; text: string }): Promise<EmailSendResult> {
  if (!emailProviderConfigured()) {
    return { accepted: false, detail: 'SMTP_URL is not configured on this deployment' }
  }
  try {
    const info = await getTransport().sendMail({
      from: process.env.MAIL_FROM || DEFAULT_FROM,
      to: params.to,
      subject: params.subject,
      text: params.text,
    })
    const acceptedCount = Array.isArray(info.accepted) ? info.accepted.length : 0
    const rejectedCount = Array.isArray(info.rejected) ? info.rejected.length : 0
    if (acceptedCount === 0) {
      return { accepted: false, detail: rejectedCount > 0 ? `provider rejected all recipients (${rejectedCount})` : 'provider accepted no recipients' }
    }
    return { accepted: true, detail: `accepted by provider for ${acceptedCount} recipient(s)` }
  } catch (e) {
    return { accepted: false, detail: e instanceof Error ? e.message : 'SMTP send failed' }
  }
}
