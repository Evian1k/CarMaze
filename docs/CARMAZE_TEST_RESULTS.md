# CARMAZE — Test Results

**9 Nov 2026 · All results below are from commands actually executed in this session. Nothing was skipped or fabricated.**

> **10 Nov 2026 re-run (after the upload endpoint + `.env.example` rebuild and the private-document `no-store` cache fix):** `bun verification/security-tests.ts` → **93 passed, 0 failed** (fresh server process; includes the full §16 upload matrix against the rebuilt route). `bunx tsc --noEmit` → exit 0; `bun run lint` → clean. Live browser verification (agent-browser): sign-in → `#/sell` verification dialog renders the document input with the correct accept list; in-session upload of a real PNG → 201 `/api/media/…` → served 200 `image/png`; PDF `kind=document` → 201 `/api/files/…`; owner fetch 200 → **same-URL cookie-less fetch 401 after the `no-store` fix** (it returned 200 from the browser cache before the fix — this was the new defect, now closed); private-doc cache-busted anonymous fetch 401. Homepage/mobile render, footer push-down and tab bar verified; zero page errors in the browser console.
>
> **10 Nov 2026 demo-catalog expansion (8 → 10 roles):** added `supplier-owner` (SupplierOS for Sifa Auto Spares) and `logistics-owner` (LogisticsOS for Swift Movers) — both demo users, orgs and full workflow data were already seeded; the registry, catalog UI (Package/Truck icons), banner labels and the security suite's counts (10/9/10) were extended. Root cause of the repeated upload-endpoint losses identified: the sandbox's sync wipes **untracked** files while tracked modifications survive — the upload route, `.env.example` (now un-ignored) and the backup copy at `agent-ctx/upload-route-backup.ts` are **committed to git**, ending the loss cycle. Post-expansion suite re-run: **93 passed, 0 failed**; `tsc` exit 0; lint clean. Browser: supplier demo → lands in SupplierOS (Sifa Auto Spares · OWNER, 8 products, open POs, warehouses, billing); logistics demo → LogisticsOS (Swift Movers · LGP-DEMO01, open request JOB-DEMO04, active delivery JOB-DEMO03 with driver); cross-role isolation re-proven (supplier session denied on `#/logistics`).

---

## 1. Automated verification suite — `bun verification/security-tests.ts`

**RESULTS: 93 passed, 0 failed** (68 prior checks preserved + 25 new).

New coverage added this session:

- **§16 Uploads (9 checks)**: anon 401 · valid PNG 201 → `/api/media/…` served 200 `image/png` · PDF `kind=document` 201 → `/api/files/…` · private doc anon 401 · private doc cross-demo-user 403 · text-claiming-PNG 415 · PNG-declared-text/plain 415 `CONTENT_MISMATCH` · invalid kind 400 · 9 MB image 413.
- **§17 Verification codes (5)**: dev code issued · five wrong attempts counted down · 6th → `TOO_MANY_ATTEMPTS` · correct code dead after cap.
- **§18 Session revocation (5)**: user login · pre-reset session valid · forgot-password token · reset completes · **old session dead (`user:null`)** · new-password login works.
- **§19 Privacy (3)**: export returns own document only (no other users' emails, no `passwordHash`) · erasure request → `DPO-…` ticket 201.

Preserved sections (all passing): 8 demo role sessions + demo-scope claims · customer/staff/admin boundaries · cross-tenant denials · demo sandbox (payments blocked, PII views closed, staff mutation guards) · real-application isolation · forged-cookie rejection · immediate permission revocation (live role swap) · anonymous probes · demo catalog enable/disable · demo reset integrity.

## 2. Manual endpoint probes (this session, curl)

| Probe | Result |
|---|---|
| Upload traversal `GET /api/media/..%2F..%2Fdb/custom.db` | blocked (framework 404 / strict filename regex) |
| Upload `GET /api/files/..%2F..%2F.env` | 401 (auth precedes path handling; regex would also reject) |
| Verification expiry: backdated `emailCodeExpiresAt` + correct code | `CODE_EXPIRED` |
| Session JWT inspection after reset | stale token `sv:0` vs DB `sessionVersion:1` → rejected (after cache-clear restart) |
| Privacy export content | all sections present (`account…loyaltyLedger`), self-only |
| Erasure request | 201, ticket `DPO-3JX39R`, staff notified |

## 3. Build quality

| Check | Result |
|---|---|
| `bunx tsc --noEmit` | **exit 0** (whole project; `ignoreBuildErrors:false` enforced at build time) |
| `bun run lint` | clean |
| `prisma migrate status` | "Database schema is up to date" (3 migrations) |
| `prisma migrate dev` (2 additive migrations) | applied, client regenerated, zero data loss |

## 4. Database drill

| Check | Result |
|---|---|
| `bun run db:backup` | `backups/carmaze-20261109-053823.db.gz` (129 KB) |
| Restore into isolated copy + `PRAGMA integrity_check` | `ok` |
| Row counts live vs restored (9 tables incl. financial + audit) | 9/9 MATCH — **RESTORE DRILL PASS** |

## 5. Browser verification (agent-browser, desktop + mobile viewport)

| Journey | Result |
|---|---|
| Homepage render, nav, search UI | PASS — zero page errors |
| Demo sign-in (Showroom Owner) → DealerOS | PASS — demo banner + org/plan header ("Dealer Pro renews 10 Nov 2026") |
| Supplier owner sign-in → SupplierOS → Billing tab | PASS — honest "PENDING invoice only… never simulates a payment" copy; plans; invoices; **Settlements card present** |
| Sell page (upload consumer) | PASS — renders clean |
| Supplier owner → `#/admin` | PASS — "Access denied" guard |
| Footer sticky behavior (mobile viewport) | PASS — footer at viewport bottom on short content, natural flow on long page |
| Console noise | only pre-existing benign scroll-offset warning + dev HMR logs |

## 6. Explicitly NOT executed (honesty list)

- Live Daraja STK push / B2C payout / provider-confirmed callback (no credentials in sandbox).
- Real SMTP / SMS delivery acceptance (no provider configured).
- Malware-scanner verdict path (no scanner configured).
- Production `next build`+`start` cycle (sandbox forbids building; type-safety is enforced via enforced-at-build `tsc` + clean lint; deployment guide §2 carries the build steps).

These are code-complete with honest failure modes; each needs its external credential to be *executed* — see `CARMAZE_REMAINING_BLOCKERS.md`.
