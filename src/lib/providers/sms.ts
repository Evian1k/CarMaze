/**
 * SMS delivery provider.
 *
 * Configuration (environment variable names only):
 *   SMS_PROVIDER  — "africastalking" | "twilio" (unknown value ⇒ not configured)
 *   SMS_API_KEY   — Africa's Talking: api key · Twilio: "AccountSid:AuthToken"
 *   SMS_USERNAME  — Africa's Talking username
 *   SMS_SENDER_ID — optional alphanumeric sender / Twilio From number
 *
 * `sendSms` returns accepted=true only when the provider's own response
 * confirms the message was accepted for delivery. Anything else reports the
 * exact provider error so delivery rows stay honest.
 */

export function smsProviderConfigured(): boolean {
  const provider = (process.env.SMS_PROVIDER || '').toLowerCase()
  if (provider === 'africastalking') return Boolean(process.env.SMS_API_KEY && process.env.SMS_USERNAME)
  if (provider === 'twilio') return Boolean(process.env.SMS_API_KEY?.includes(':'))
  return false
}

export function smsProviderName(): string {
  return (process.env.SMS_PROVIDER || '').toLowerCase() || 'none'
}

/** Normalise a Kenyan phone number to E.164 (+254…). Returns null if invalid. */
export function normalizeSmsPhone(raw: string): string | null {
  const digits = raw.replace(/[^0-9]/g, '')
  if (/^254[17]\d{8}$/.test(digits)) return `+${digits}`
  if (/^0[17]\d{8}$/.test(digits)) return `+254${digits.slice(1)}`
  if (/^\+254[17]\d{8}$/.test(raw)) return `+${digits}`
  return null
}

export type SmsSendResult = { accepted: boolean; detail: string }

export async function sendSms(params: { to: string; message: string }): Promise<SmsSendResult> {
  const provider = (process.env.SMS_PROVIDER || '').toLowerCase()
  const to = normalizeSmsPhone(params.to)

  if (!provider) return { accepted: false, detail: 'SMS_PROVIDER is not set on this deployment' }
  if (!to) return { accepted: false, detail: 'recipient phone number is not a valid Kenyan mobile number' }

  if (provider === 'africastalking') {
    const username = process.env.SMS_USERNAME
    const apiKey = process.env.SMS_API_KEY
    if (!username || !apiKey) return { accepted: false, detail: 'africastalking requires SMS_USERNAME and SMS_API_KEY' }
    try {
      const res = await fetch('https://api.africastalking.com/version1/messaging', {
        method: 'POST',
        headers: { apiKey, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          username,
          to,
          message: params.message,
          ...(process.env.SMS_SENDER_ID ? { from: process.env.SMS_SENDER_ID } : {}),
        }).toString(),
      })
      const data = (await res.json()) as { SMSMessageData?: { Recipients?: { status?: string; messageId?: string }[] } }
      const recipients = data.SMSMessageData?.Recipients ?? []
      if (!res.ok) return { accepted: false, detail: `provider error (${res.status})` }
      const accepted = recipients.some((r) => r.status === 'Success')
      if (!accepted) {
        const statuses = recipients.map((r) => r.status ?? 'unknown').join(', ') || 'no recipients'
        return { accepted: false, detail: `provider did not accept delivery (${statuses})` }
      }
      return { accepted: true, detail: `accepted by provider for ${recipients.filter((r) => r.status === 'Success').length} recipient(s)` }
    } catch (e) {
      return { accepted: false, detail: e instanceof Error ? e.message : 'SMS request failed' }
    }
  }

  if (provider === 'twilio') {
    const [sid, authToken] = (process.env.SMS_API_KEY || '').split(':')
    const from = process.env.SMS_SENDER_ID
    if (!sid || !authToken) return { accepted: false, detail: 'twilio requires SMS_API_KEY as "AccountSid:AuthToken"' }
    if (!from) return { accepted: false, detail: 'twilio requires SMS_SENDER_ID as the From number' }
    try {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: to, From: from, Body: params.message }).toString(),
      })
      const data = (await res.json()) as { sid?: string; status?: string; message?: string }
      if (!res.ok) return { accepted: false, detail: `provider error (${res.status}): ${data.message ?? 'unknown'}` }
      // Twilio 'queued'/'accepted' = provider accepted for delivery.
      const accepted = res.ok && Boolean(data.sid) && ['queued', 'accepted', 'sent'].includes(String(data.status))
      return accepted
        ? { accepted: true, detail: `accepted by provider (${data.status})` }
        : { accepted: false, detail: `provider status ${data.status ?? 'unknown'}` }
    } catch (e) {
      return { accepted: false, detail: e instanceof Error ? e.message : 'SMS request failed' }
    }
  }

  return { accepted: false, detail: `unsupported SMS_PROVIDER "${provider}"` }
}
