# CARMAZE — Remaining Blockers

**9 Nov 2026 · Everything here needs something outside the codebase: credentials, decisions, or legal review. Code-side work for each item is complete and fails honestly until the external piece exists.**

---

## 1. BLOCKED BY CREDENTIALS

| # | Item | Exact env names | Code state | What you must do |
|---|---|---|---|---|
| 1 | Live M-Pesa STK payments | `MPESA_CONSUMER_KEY` `MPESA_CONSUMER_SECRET` `MPESA_SHORTCODE` `MPESA_PASSKEY` `MPESA_ENV` `MPESA_CALLBACK_URL` `MPESA_WEBHOOK_SECRET` | STK push, callback (fail-closed), amount checks, idempotency, attempts ledger, FINANCE query — all implemented; unconfigured → honest 501 | Open a Daraja account, run sandbox proof (KES 1 invoice → callback → invoice PAID), then go-live keys + edge IP allow-list |
| 2 | Automated supplier payouts (B2C) | + `MPESA_INITIATOR_NAME` `MPESA_SECURITY_CREDENTIAL` `MPESA_B2C_RESULT_URL` | B2C request + result callback + settlement `PROCESSING→SETTLED` wiring implemented | Daraja B2C enrollment (requires business shortcode + initiator credential); then process a real payout end-to-end |
| 3 | Email delivery | `SMTP_URL` `MAIL_FROM` | nodemailer transport, retries, honest `SENT`/`FAILED` delivery rows | Pick a provider (e.g. Hostinger/SES), set env, send a real verification email |
| 4 | SMS delivery | `SMS_PROVIDER` `SMS_API_KEY` `SMS_USERNAME` `SMS_SENDER_ID` | Africa's Talking/Twilio adapter, E.164 normalisation, honest records | Choose gateway, set env, deliver one real OTP |
| 5 | Malware scanning on uploads | scanner-specific (hook: `scanForMalware` in `src/app/api/upload/route.ts`) | Strict magic-byte allowlist active; hook point documented, must fail closed once a scanner is configured | Optional for pilot; connect ClamAV/VirusTotal before high-volume public launch |

## 2. REQUIRES LEGAL OR BUSINESS APPROVAL

1. **ODPC registration** under the Kenya Data Protection Act 2019 — determination + filing; privacy notice text; consent copy updates.
2. **Retention schedule sign-off** — financial/fraud/dispute records are retained by design; the erasure workflow needs a legal owner for edge cases.
3. **Settlement/escrow posture** — CARMAZE currently records owed vs settled amounts honestly and pays via B2C or audited manual transfer. If the product will *hold* customer funds before release, that is a regulated activity — confirm the commercial arrangement (Daraja capabilities, licence or partner bank) before enabling anything beyond the current ledger. **No simulation was added.**
4. **Plan/commercial changes** — seeded prices and limits were preserved exactly; any change requires founder approval and a plan-row update, not code edits.
5. **Trial periods** — deliberately NOT invented; implement as a configurable, founder-approved feature if wanted.

## 3. NOT IMPLEMENTED (by scope decision, documented)

- Multi-instance rate limiting (shared store) — single-instance deployment documented; revisit only when scaling beyond one process.
- CI pipeline / unit-test framework — the 93-check live suite + `tsc` + lint are the quality gate; wire them into CI when a repository host exists.
- Content-Security-Policy header — recommended before public launch; add in the reverse proxy or `next.config.ts` headers after tuning.
- Consumer-order M-Pesa paybill alternatives (cards/PayPal) — not requested by the product spec.
- Dealer lead-assignment automation beyond the enquiry inbox that exists — current assignment tooling is manual; flagged as roadmap, not a defect.

## 4. KNOWN LIMITS (honest, unchanged by remediation)

- POD / branch-transfer images upload as shared public media (their call sites send no `kind`) — by design; switch those call sites to `kind:'document'` if that ever needs to be private.
- `GET /api/media/*` is a public pool (marketplace photos, storefront images, conversation attachments).
- Some forms validate client-side first (server re-validates); UX-only concern.
- In-memory rate-limit buckets reset on restart (a restart also ends attacker sessions; acceptable).
- `demo.admin` cannot view PII/finance/security views (guard verified) — this is a feature, listed so it isn't mistaken for a bug.

## 5. Owner checklist to reach PUBLIC PRODUCTION READY

1. Set `AUTH_SECRET` + `NEXT_PUBLIC_SITE_URL` on the host (boot refuses without them).
2. Complete blockers 1–4 above with real credentials and one live proof each.
3. Deploy per `CARMAZE_DEPLOYMENT_GUIDE.md`; run `bun verification/security-tests.ts` against staging (expect 93/93).
4. Legal sign-off on §2 items; publish privacy notice.
5. Schedule daily `db:backup` + pre-deploy backups; keep one drill per quarter.
