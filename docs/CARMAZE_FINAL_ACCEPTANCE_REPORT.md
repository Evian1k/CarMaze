# CARMAZE — Final Production Build & Clean-Environment Verification Report

**Date: 13 Nov 2026. Scope:** independent production build, clean-environment initialization, real-user workflow E2E, upload-security verification, demo/production separation. No redesigns, no price changes, no mock integrations introduced.

## 1. Latest commit hashes

| Commit | Content |
|---|---|
| `66d9b60` (HEAD) | Final verification pass: scanner exit-code + `{file}` contract fix, seed FK fixes, demo-reset timeout raise, three new verification suites |
| `c5b…`/`4402bfc` | Hardened upload endpoint rebuild + staging bootstrap checker (prior pass) |
| Working tree | clean (only `db/custom.db` dev-data churn, committed) |

## 2. Production build — **VERIFIED**

- `bun install --frozen-lockfile` → exit 0 (928 installs, 996 packages, no changes)
- `bun run build` (next build → standalone + static/public copy) → **exit 0**, 1m10s
- 10 pre-existing Edge-Runtime **warnings** (child_process/fs/path import traces via `instrumentation.ts`/`sweeps.ts`) — informational only; the app runs on the Node.js runtime; the build completes and `.next/standalone/server.js` + static assets exist.

## 3. TypeScript and ESLint — **VERIFIED**

- `bunx tsc --noEmit` → **exit 0** (after fixing one type error the scanner fix initially introduced — caught by the gate, as designed)
- `bun run lint` → **exit 0**

## 4. Security test result — **VERIFIED**

- `bun verification/security-tests.ts` on a fresh dev server: **139 passed, 0 failed** (final run, after all fixes).
- The suite refuses non-local targets (isolation guard) and runs on demo/ephemeral data only.

## 5. Fresh database initialization — **VERIFIED**

Isolated staging DB (`/tmp/carmaze-prod-verify.db`, deleted after the test; never the real production path):

- `prisma migrate deploy` → all 5 migrations applied, exit 0
- `prisma migrate status` → "Database schema is up to date!"
- `prisma migrate diff --from-migrations --to-schema-datamodel` → **"No difference detected."**

## 6. Founder bootstrap — **VERIFIED**

- `bun run founder:create` on the fresh DB → FOUNDER minted; `verification/verify-staging-bootstrap.ts` → **17/17 PASS** (exactly one user, roles=FOUNDER, isDemo=false, bcrypt hash verifies, plaintext never stored, zero demo/vehicle/invoice/upload/settlement/order rows, transactional audit row linked to the founder)
- Duplicate founder creation → **REFUSED** (exit 1)
- **Ordinary users cannot self-bootstrap into administration — VERIFIED** (`verification/verify-clean-env.ts` on a server booted on the fresh DB): admin console/mutations, application approval, supplier approval, settlement actions, listing moderation, upload review console → all **403** for a freshly registered user; `User.roles` unchanged after every attempt; the admin API exposes **no role-changing endpoint at all** (roles change only via audited application approvals)
- No demo accounts, transactions, or businesses imported — VERIFIED (17/17 zero-row checks)

## 7. Real-user workflow results — **VERIFIED** (76/76)

`verification/workflow-e2e.ts` — five freshly registered accounts + the seeded real ADMIN; zero demo actors. Actually executed and passed:

| Workflow | Result |
|---|---|
| Customer registration + login | PASS |
| Showroom (DEALER) application → staff document verification → approval → DEALER_OWNER + ACTIVE org | PASS |
| Garage application → approval → GARAGE_OWNER + org | PASS |
| Supplier application → admin approval → SUPPLIER_OWNER + verified org | PASS |
| Logistics application → approval → LOGISTICS_OWNER + LogisticsPartner + fleet driver | PASS |
| Vehicle submission (PENDING_REVIEW) → moderator approval → **publicly searchable** | PASS |
| Customer enquiry → dealership reply (ANSWERED) → close | PASS |
| Garage service offer → quote → customer acceptance → booking schedule→start→complete | PASS |
| Custody: create → receive → WORK_IN_PROGRESS → READY_FOR_COLLECTION → collection code issued → wrong code refused → collect → RETURNED | PASS |
| Consumer parts order (no payment needed) → supplier accept → dispatch (OTP to buyer via notification) → OTP verified → DELIVERED → buyer confirm → COMPLETED | PASS |
| B2B purchase order → supplier ACCEPT → delivery arrange (CONFIRMED) → pay attempt → **honest 503 MPESA_NOT_CONFIGURED** → dispatch blocked (409 PAYMENT_REQUIRED) → platform finance `reconcile-payment` (MANUAL_RECONCILED) → dispatch → handover OTP → handover-confirm → inspect ACCEPT → **escrow release → settlement created (KES 17,500 gross / 3% commission / net KES 16,975)** | PASS |
| Logistics delivery job → partner accept (driver) → pickup → transit → deliver with requester QR token + POD photo → DELIVERED | PASS |
| Role-based restrictions (woven negatives): customer cannot approve applications/moderate listings/dispatch orders/open review consoles; non-partner cannot accept jobs; non-garage user cannot pay POs; unrelated user cannot read enquiry threads; non-owner cannot approve custody work | PASS |

**Blocked integrations identified honestly inside the flows:** real M-Pesa STK push (503 MPESA_NOT_CONFIGURED — the manual finance-reconciliation path was exercised instead, which is the documented real-money fallback), email/SMS providers (not_configured; in-app notifications carry OTPs in dev), malware scanner (see §8).

## 8. Upload security — **VERIFIED** (scanner verdict handling; scanning itself remains **BLOCKED**)

`verification/security-tests.ts` + `verification/upload-scanner-harness.ts` (3 phases, 20 checks):

- Public image upload → /api/media, correct type: PASS
- Private document upload → /api/files, owner/staff only: PASS
- Private evidence upload → EVIDENCE kind, participant-gated, 1-year expiry, FileAccessLog: PASS
- PDF quarantine: 423 SCAN_PENDING for **everyone including the owner** while unscanned: PASS
- Scanner-unavailable behavior: honest `SCANNER_UNAVAILABLE` + `viewable:false`, never silently approved: PASS
- Scanner-clean release: with a scanner reporting exit 0, PDF released **immediately** without staff approval: PASS
- Scanner-rejected files: exit 1 (INFECTED) → **415 UNSAFE_FILE_REFUSED, bytes destroyed, record INFECTED, admin infected-filter lists it**: PASS; exit ≥2 (scanner ERROR) → **fail-closed quarantine, bytes kept, 423** — PASS (this path required a real fix: scanner errors/timeouts were previously misclassified as INFECTED and destroyed bytes; exit codes are now mapped per the ClamAV convention and the documented `{file}` placeholder for `CARMAZE_SCAN_CMD` is implemented)
- Unauthorized document/evidence access: stranger 403, anon 401: PASS
- Expired evidence: non-participant **410 EXPIRED**, anon 401; owner/staff retention is by documented design (retention/erasure follow-up): PASS
- Active PDF content (`/JavaScript`, `/JS`, `/Launch`, `/EmbeddedFile`, `/OpenAction`, `/AA`): **415 ACTIVE_CONTENT_REFUSED before any bytes are kept**: PASS
- **Unscanned files cannot become publicly accessible**: quarantined name unreachable via `/api/media` (404 — quarantine dir is not the media dir) and `/api/files` (423/401): PASS
- **Malware scanning itself is NOT operational** — no ClamAV exists on this machine and none is claimed. The harness used the documented `CARMAZE_SCAN_CMD` contract with a test scanner script to prove the workflow's reaction to every verdict class. Production must install ClamAV (`apt install clamav clamav-daemon`) or set `CARMAZE_SCAN_CMD`.

## 9. Demo/production separation — **VERIFIED**

- Demo sessions cannot read real customer information: `assertNotDemoStaffRead` on 45+ surfaces; live checks — demo admin 403 on real upload queue and real user records: PASS
- Demo sessions cannot perform real payments/settlements: `assertNotDemoActor` on STK push, mark-paid, refund, PO pay; settlement admin actions `platformWide`-blocked: PASS
- Demo records cannot appear as real marketplace listings: demo vehicles are demo-marked (`orgIsDemo`/badge) and demo actors are sandboxed to demo orgs; the public marketplace intentionally lists demo-marked vehicles with visible DEMO badges for the demo experience — real records (created in §7) carried no demo marks: PASS
- Demo workflows cannot modify production business records: `DEMO_SANDBOXED` guards (demo actors only touch demo-owned entities): PASS
- **Removing demo accounts does not remove application functionality — VERIFIED**: the app was booted on a database with ZERO demo rows; health, registration, session, marketplace query, and the upload pipeline all worked; demo sign-in honestly fails (`403 DEMO_DISABLED`) — nothing is load-bearing on demo data
- Observed (low-risk, unchanged) gaps, reported for completeness: `GET /api/settlements` has no demo guard (org-scoped read-only ledger) and `POST /api/billing/subscribe` has none (creates a PENDING invoice on the caller's own org; activation requires a real callback or FINANCE mark-paid, both demo-blocked). Neither lets a demo session move money or read real data.

## Bugs found by this verification pass (fixed and committed in `66d9b60`)

1. **Scanner verdict conflation** — scanner errors (ClamAV exit ≥2) and 30s timeouts collapsed to INFECTED, destroying files on misconfiguration. Fixed: numeric exit mapping + timeout→SCAN_ERROR + `{file}` placeholder implemented per docs.
2. **Demo-reset could half-wipe the database** — `POST /api/admin/demo-accounts/reset` spawns the seed with a 120s SIGKILL; under SQLite lock contention the seed was killed mid-flight (after deletes, before creates). Additionally the seed's delete list missed `Settlement`/`SettlementEvent`/`PurchaseOrder` (Restrict FKs to Org) — any real business record broke `org.deleteMany()` with a FK violation. Fixed: seed FK order corrected, reset timeout raised to 420s, and the reset endpoint re-verified live (HTTP 200, baseline restored, then 139/139 suite on the restored baseline).

## 10. Remaining external integrations — **BLOCKED** (require credentials/infrastructure)

| Item | Status | Needed |
|---|---|---|
| M-Pesa Daraja STK + B2C | BLOCKED | real Daraja credentials + callback URL; until then payments honestly 503 and finance uses audited manual reconciliation |
| Email (SMTP) / SMS (Africa's Talking) | BLOCKED | provider accounts + keys; in-app notification carries OTPs in this environment |
| Malware scanning (ClamAV) | BLOCKED | install on the production host or configure `CARMAZE_SCAN_CMD`; workflow verified fail-closed meanwhile |
| Server provisioning, TLS (Caddy), cron, off-site backups | BLOCKED | real host per runbook (commands exact; `[NOT RUN HERE]` honestly marked) |
| AUTH_SECRET, domain, backup target, error monitoring | BLOCKED | founder provisioning per `.env.example` / handover §4 |

## Remaining risks and founder actions

1. Run `bun run build` on the deployment host at go-live (sandbox build verified exit 0; the host build is authoritative).
2. Install ClamAV before opening uploads beyond the pilot group.
3. Execute `docs/CARMAZE_DEPLOYMENT_RUNBOOK.md` on the real host; re-run the security suite against a staging server before go-live.
4. Live Daraja payment proof remains outstanding — describe the pilot as payment-ready, not live-verified, until a real STK + B2C round-trip passes.
5. In-memory rate limiter is single-instance by design (documented).
6. Legal pack / ODPC registration — unchanged founder TODOs (handover §3/§7).

## Verdict

- Every gate that can be executed in this environment was **actually executed and passed**: build (exit 0), tsc (0), lint (0), security suite (139/139), scanner harness (20/20), clean-env (16/16), workflow E2E (76/76), fresh-DB init + founder bootstrap (17/17 + 4 refusals), demo-separation live checks.
- **FAILED items: none outstanding.** (Two real bugs were found by this verification and fixed: scanner verdict conflation; demo-reset FK/timeout corruption.)
- **BLOCKED items are exclusively external** (credentials, host, providers) — enumerated above with exactly what is needed.
- **CARMAZE is genuinely ready for the controlled production pilot on the application side**: the go-live path is the runbook executed on real infrastructure with real credentials, followed by the post-deploy gate it specifies.
