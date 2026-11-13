# CARMAZE — Email & SMS Integration Setup

**13 Nov 2026. The transports are real code (`src/lib/providers/email.ts`, `src/lib/providers/sms.ts`, orchestrated by `src/lib/notify.ts`); they are inert only because no provider account exists yet. This document gives the exact setup steps and the honesty rules the code already enforces.**

---

## 1. Email — SMTP (nodemailer)

**Provider choice (any of): Africa's Talking email, Zoho, Google Workspace SMTP, Mailgun/Brevo SMTP relay, or a Kenyan host's mail service. What matters is an authenticated SMTP URL.**

| Variable | Example | Notes |
|---|---|---|
| `SMTP_URL` | `smtps://USER:APP_PASSWORD@smtp.zoho.com:465` | The password is a provider-issued app password / API key — never a reused personal password |
| `MAIL_FROM` | `CARMAZE <no-reply@carmaze.co.ke>` | Domain-aligned sender; set up SPF + DKIM + DMARC DNS records for the domain or delivery suffers |

Setup steps:
1. Create the mailbox/API key at the provider; enable SMTP access.
2. Put `SMTP_URL` + `MAIL_FROM` in `.env` on the server (never in git).
3. Add SPF/DKIM/DMARC DNS records for the sending domain (provider gives the exact values).
4. Verify: `/api/health` reports `email: connected` … actually it reports the configured state honestly — check `email` is no longer `not_configured`; then trigger a real verification email and confirm delivery.

## 2. SMS — Africa's Talking (preferred, Kenya) or Twilio

| Variable | Africa's Talking | Twilio |
|---|---|---|
| `SMS_PROVIDER` | `africastalking` | `twilio` |
| `SMS_API_KEY` | AT API key (from AT dashboard) | `AccountSID:AuthToken` (colon-separated) |
| `SMS_USERNAME` | AT username (app name) | (unused) |
| `SMS_SENDER_ID` | Approved alphanumeric sender ID (register with CA / AT; e.g. `CARMAZE`) | Approved numeric/alphanumeric sender |

Setup steps (Africa's Talking):
1. africastalking.com → create account → create an API key.
2. For OTP/transactional SMS in Kenya, register an alphanumeric Sender ID (Safaricom approval via AT takes days) — until approved, sender defaults to the AT shared number.
3. Set `SMS_PROVIDER=africastalking`, `SMS_API_KEY`, `SMS_USERNAME`, optional `SMS_SENDER_ID` in `.env`.

## 3. OTP message security (already implemented — verify, don't re-implement)

- Codes are 6 digits from `crypto.randomBytes` with rejection sampling (`src/lib/ids.ts`) — no `Math.random()`.
- Stored **bcrypt-hashed** at rest; expiry 10 minutes for email/phone verification; 5 wrong attempts invalidate the code (`TOO_MANY_ATTEMPTS`); single-use; request rate 5/h and confirm rate 10/h per account.
- Operational handover/collection/drop-off OTPs (custody, purchase orders, deliveries, consumer orders) are hashed, single-use, and brute-force-limited **5 attempts / 10 minutes per target+user** — an attacker rotating IPs still hits the per-target cap. Known, documented limitation: these operational codes have no absolute TTL (a leaked-but-unused code stays valid until used); mitigation is the attempt cap + single-use. Recommended follow-up: add a 24 h TTL at verification.
- Never log codes: the notify layer logs provider errors only, never message bodies containing codes. Keep it that way in any future edit.

## 4. Reliability, retries, and honest failure recording (already implemented)

- In-app delivery is instant; EMAIL/SMS go out through the provider with **initial attempt + 2 retries with backoff** (`EXTERNAL_RETRY_MAX` in `notify.ts`).
- A `NotificationDelivery` row records every attempt: `SENT` is written **only when the provider itself confirms acceptance**; every other outcome is `FAILED` with the provider's own error detail. An unconfigured deployment records `FAILED: provider not configured (set SMTP_URL / SMS_PROVIDER…)` immediately — the UI never shows a fake "sent".
- Verification-code sends in production return an honest 503 when the channel is unconfigured; demo sessions never send anything to real users (central block in `notify.ts`).
- Do NOT add fake delivery confirmations anywhere; if a provider reports "queued" but not delivered, that is what the row must say.

## 5. Ops checks after go-live

1. Send one email + one SMS to your own address/phone; confirm receipt and correct sender.
2. Check `NotificationDelivery` rows show SENT (not just in-app).
3. Check the provider dashboard for bounce/complaint rates weekly; keep the OTP templates short and sender-consistent.
4. If a provider has an outage, deliveries record FAILED with its error — reconcile with a retry after recovery rather than editing rows by hand.
