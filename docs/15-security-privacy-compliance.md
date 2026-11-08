# PART 17 — SECURITY, PRIVACY AND COMPLIANCE

Actual controls found in the code, followed by an honest gap list. Nothing here claims certified compliance — the Kenya-relevant obligations (notably the Data Protection Act, 2019) are framed as engineering requirements to be confirmed with counsel, not as achievements.

## 17.1 Password security

- bcrypt hashing, cost 10 (`src/lib/auth.ts`); minimum length 8 (max 100) at registration and reset.
- **No password strength meter, no breach-list check, no rotation policy.**
- Staff invitations and org staff invites generate 12-char one-time passwords from an unambiguous alphabet via `crypto.randomBytes`, stored bcrypt-hashed, shown once.

## 17.2 Session security

- HS256 JWT (`jose`) in an **httpOnly, sameSite=lax** cookie (`carmaze_session`), `secure` when `NODE_ENV=production`, 7-day default.
- **Every request re-reads the User row**; `status !== 'ACTIVE'` → no session (suspension is instant despite stateless tokens).
- MFA: TOTP with ±1-step window, timing-safe comparison, 5-minute scoped challenge JWT between the two login steps; disabling MFA requires the current password.
- **Gaps**: no session revocation list (password reset does **not** invalidate existing sessions), no refresh-token rotation, no device/session listing, `AUTH_SECRET` has a hardcoded dev fallback in `auth.ts`/`totp.ts` (must be removed before production).

## 17.3 Authentication surface

| Flow | Controls |
|---|---|
| Register | 5/h per IP; 409 on duplicate email; no enumeration via registration (success always) |
| Login | 10/15min per IP+email; generic `INVALID_CREDENTIALS`; failed logins audited (email as target) |
| Forgot password | 5/h per IP; single live token per user; **sha256-hashed** token with 60-min expiry; generic response (no account enumeration); dev-only token display guarded by env |
| Reset | 10/h per IP; token single-use (usedAt) in a transaction; audited with IP |
| Email/phone codes | 6-digit codes; **no expiry, no attempt limit**; codes generated with `Math.random` (not crypto) — phone path has no rate limit/audit. Dev displays codes in UI (env-guarded) |
| Demo sign-in | 30/15min per IP; server-side role→user mapping; session clamped 15 min–14 days |

## 17.4 Role-based access control & tenant isolation

- Three layers (Part 5): platform roles, org membership roles (incl. the supply `roleCan` matrix), resource ownership. All enforced server-side; the frontend guard is explicitly cosmetic.
- Deny-by-default: unknown org → 403/404; missing role → 403 `FORBIDDEN`; every admin endpoint has an explicit role table (Part 5.10–5.13).
- FOUNDER protected from all admin actions (`FOUNDER_PROTECTED`); self-lockout prevented (`SELF_ACTION`, `CANNOT_MODIFY_SELF`).
- Verified by `verification/security-tests.ts` (RBAC denials, cross-org isolation, demo sandbox, revocation immediacy, forged-cookie uselessness).

## 17.5 API protection & input validation

- **zod** on every mutating endpoint; JSON parse errors → 400; field-level issues returned.
- Uniform error mapping prevents stack-trace leakage (500 = generic message + server log).
- **Rate limiting**: in-memory sliding window per route/IP/user (login, register, STK push, broadcasts, AI, uploads-by-proxy, reports, community). **Limitation**: single-instance only, resets on restart.
- **Known gaps**: no CSRF tokens (reliance on sameSite=lax + JSON-only APIs), no request-size limits beyond Next defaults, some admin/community searches scan ≤500 rows in JS (DoS-resistant enough at pilot scale, noted for growth).

## 17.6 File upload & document access

- **GET side**: `files/[name]` is owner-only or STAFF_ROLES (with demo guard), filename regex prevents traversal, `nosniff`, private cache; every staff view of a verification document writes `DocumentAccessLog`. `media/[name]` is public-by-design (marketplace imagery), regex-guarded, immutable cache.
- **POST side: missing entirely** — no upload endpoint exists; frontend calls to `POST /api/upload` fail with 404 (the platform's #1 gap). No MIME/content scanning, no size enforcement server-side, no malware scanning (all blocked behind the missing endpoint).

## 17.7 Payment security

Summarised from Part 13: signature-verified fail-closed callbacks, idempotency, amount-integrity checks, single activation path, demo lockout, ownership checks, rate limits, no card data. Refunds/marks-paid are FINANCE-gated with mandatory notes and audits.

## 17.8 Rate limiting & abuse prevention

In-memory limiter (documented above); community moderation (staff hide/remove via admin), reports, demo isolation. **No IP blocking, no CAPTCHA, no device fingerprinting.**

## 17.9 Audit logs & evidence

- `AuditLog` (actor, action, target, metadata) written by an un-failable helper across all consequential mutations; admin UI with filters/pagination.
- Workflow event tables preserve who-did-what per state change; `DocumentAccessLog` covers sensitive file views; `AiUsage` covers model calls; `ViewEvent` covers view dedupe.
- Audit log is **append-only via API**; no tamper-evident chaining (hashes) and no export.

## 17.10 Backups, recovery, retention

- Backups: **none automated**; SQLite file copy is the only mechanism; no restore runbook.
- Retention: no automated purge except rate-limit buckets, view-dedupe pruning, token expiry. Personal data persists indefinitely; **no data-export or right-to-erasure workflow exists** — a DPA-2019 gap to address before scale.
- User consent: registration collects no marketing consent; applications require an explicit `consent` boolean for document processing; privacy policy page is static copy.

## 17.11 Privacy controls

- Sensitive documents isolated on the private files route with access logs; incidents restrict subject data (`subjectDesc` flagged restricted); partner internal notes never public; staff visibility of PII requires STAFF_ROLES and is demo-blocked.
- Phone numbers in enquiries are opt-in (`phoneShare`); reviews show first names only; storefronts expose business (not personal) contact.
- **Gaps**: no PII inventory/registry, no per-user data export, no anonymisation on deletion (account deletion isn't offered at all), no encryption-at-rest (SQLite plaintext file).

## 17.12 Administrative access

- Admin surface requires staff roles; destructive/admin-only powers are concentrated in ADMIN/FOUNDER (Part 5 table); one-time passwords instead of emailed invites (no email infra); all admin mutations audited; demo sessions get read-only/blocked variants.
- The Control Center shows honest health chips (DB, M-Pesa configured, email/SMS configured).

## 17.13 Kenya data-protection considerations (engineering view — not legal advice)

| Obligation area (DPA 2019) | Current state |
|---|---|
| Lawful basis & notice | Registration/terms pages exist; no granular consent capture beyond application consent |
| Data subject rights (access, correction, erasure) | Profile edit exists; **no export/erasure workflows** |
| Data processor agreements | N/A in-repo (hosting is sandbox; M-Pesa Daraja is the only external processor of note) |
| Security safeguards | Good auth/RBAC/audit posture; missing: at-rest encryption, backups, session revocation |
| Breach notification | No process/tooling |
| Registration with the ODPC | Operational/legal step — outside the codebase |

**Bottom line**: the platform's access-control core is unusually disciplined for its scale and is backed by a live security test suite; the principal gaps are operational (backups, revocation, erasure, secrets hygiene) rather than architectural.
