# CARMAZE — Environment Variables

**Names only. Values live in `.env` on the host — never in chat, never in git, never in logs.**

Copy `.env.example` → `.env` and fill. The application validates the critical ones at boot and reports missing ones honestly in health checks and error responses.

## Required in production

| Variable | Purpose | Notes |
|---|---|---|
| `DATABASE_URL` | SQLite connection | Already configured in this deployment; do not print its value |
| `AUTH_SECRET` | Session signing (HS256) | **≥32 chars; boot refuses to start in production without it.** Generate: `openssl rand -base64 48`. Rotate by setting a new value — all sessions re-issue on next login |
| `NEXT_PUBLIC_SITE_URL` | Public origin for absolute links/callbacks | Must match the HTTPS domain Daraja calls back to |

## M-Pesa Daraja — STK (payments)

| Variable | Purpose |
|---|---|
| `MPESA_CONSUMER_KEY` | Daraja app key |
| `MPESA_CONSUMER_SECRET` | Daraja app secret |
| `MPESA_SHORTCODE` | Paybill/shortcode (until now `MPESA_BUSINESS_SHORTCODE` was also accepted) |
| `MPESA_PASSKEY` | Lipa na M-Pesa online passkey |
| `MPESA_ENV` | `sandbox` or `production` |
| `MPESA_CALLBACK_URL` | `https://<domain>/api/billing/mpesa/callback` |
| `MPESA_WEBHOOK_SECRET` | Shared secret in `x-carmaze-signature`; **fail-closed in production without it** |

## M-Pesa Daraja — B2C (supplier settlement payouts)

| Variable | Purpose |
|---|---|
| `MPESA_INITIATOR_NAME` | API initiator username |
| `MPESA_SECURITY_CREDENTIAL` | Initiator password encrypted with the Daraja public certificate |
| `MPESA_B2C_RESULT_URL` | `https://<domain>/api/admin/settlements/payout/result` |

## Email (SMTP)

| Variable | Purpose |
|---|---|
| `SMTP_URL` | e.g. `smtps://USER:KEY@smtp.host:465` |
| `MAIL_FROM` | From address, e.g. `CARMAZE <no-reply@domain>` |

## SMS

| Variable | Purpose |
|---|---|
| `SMS_PROVIDER` | `africastalking` or `twilio` |
| `SMS_API_KEY` | Provider key |
| `SMS_USERNAME` | AT username / Twilio Account SID |
| `SMS_SENDER_ID` | Approved sender ID |

## Operations

| Variable | Purpose | Default |
|---|---|---|
| `ENABLE_JOBS` | `false` disables scheduled sweeps on secondary workers | `true` |
| `LOG_LEVEL` | Structured log verbosity | `info` |

## Not required / optional

- `MPESA_BASE_URL` — override only for testing gateways.
- Nothing else: the app has no other secret dependencies; unused packages in `package.json` (next-auth, etc.) require no configuration and are inert.

## Handling rules

1. Never commit `.env`; `.env.example` carries names only.
2. Never paste secrets into chat, tickets, or logs; audit metadata stores refs and codes, never credentials.
3. Rotating `AUTH_SECRET` logs everyone out (sessions re-issue on next login) — safe by design.
4. Production check: `/api/health` reports each provider as configured/unconfigured — a missing variable is always named, its value never shown.
