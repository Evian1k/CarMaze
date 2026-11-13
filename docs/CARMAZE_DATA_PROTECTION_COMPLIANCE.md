# CARMAZE — Customer Data Protection & Kenya Compliance Pack

**13 Nov 2026. What the code enforces today, what documents the founder must publish, and which items require a qualified Kenyan advocate/compliance professional. This is operational preparation, not legal advice.**

---

## 1. What the application already enforces (verified)

- **Data-subject export**: `GET /api/privacy/export` — the caller receives their own records only (self-scoped queries; no hashes, no other users' data; download is audit-logged).
- **Erasure request**: `POST /api/privacy/delete-request` — records a DPO-tagged support ticket + staff notification. Marketing-only erasure is genuinely automatic (`marketingConsent` withdrawn immediately, suite-verified). Full-account erasure is deliberately NOT auto-executed: financial/fraud/dispute records have lawful retention bases — the human DPO workflow decides and records the outcome.
- **Access controls on sensitive identity & vehicle documents**: uploads are magic-byte-checked, server-named (`<userId>.<16hex>.<ext>`), and split public (`/api/media`) vs private (`/api/files`); private documents are served only to the owner or authorised platform staff, **audit-logged per staff view**, `Cache-Control: private, no-store` (no post-logout caching). Application identity documents (IDs, licences, insurance) must point at private storage — public media URLs are rejected (`PRIVATE_DOCUMENT_REQUIRED`). Demo sessions can never read real KYC documents, the audit trail, user directories, revenue, or the payment attempt ledger.
- **Audit trail**: authentication, uploads, staff document views, payment/reconciliation/refund actions, moderation and demo attempts are audit-logged.
- **Rate limiting** on anonymous and sensitive routes; brute-force caps on all verification codes and handover OTPs.

## 2. Privacy policy — requirements the founder must publish (draft before legal review)

Must state, at minimum, per the Kenya Data Protection Act, 2019:
1. Data controller identity & contact (CARMAZE Ltd, physical address, DPO contact).
2. Categories of personal data processed: identity/KYC (ID/passport, PIN certificate), contact details, vehicle documents (logbook, insurance), transaction and payment metadata (never store M-Pesa PINs — the app doesn't and must never), device/IP data, communications.
3. Purposes & lawful bases: contract performance (listings, escrow, logistics), legal obligation (KYC/AML for partners, tax records), legitimate interests (fraud prevention, moderation), consent (marketing).
4. Recipients: Safaricom Daraja (payment processing), SMS/email providers, logistics partners (delivery details only), auditors — name them once contracts exist.
5. Retention periods (see §5) and users' rights: access, rectification, erasure, objection, complaint to the ODPC.
6. Cross-border transfer statement (Daraja stays in Kenya; if any cloud host is outside Kenya, say so and the safeguards — ODPC guidance applies).
7. Cookies/session policy (single httpOnly session cookie; no ad trackers).

## 3. Terms of service — coverage checklist (draft before legal review)

Marketplace listing rules; escrow & dispute process (timelines, evidence standards, release/refund rules as implemented); supplier settlement terms (commission % from the live fees config, payout timing); garage custody terms (authorised spend cap approval, collection verification, road-test consent); logistics liability & POD; prohibited items/conduct; account suspension; limitation of liability; governing law (Kenya) & dispute forum; consumer-protection disclosures. **The dispute/escrow timelines written in the TOS must match what the code actually does — reconcile wording with the workflow doc before publishing.**

## 4. Business partner agreements (dealers, garages, suppliers, logistics)

Minimum clauses: commission & settlement schedule (matches `computeCommission` and the Settlement ledger states PENDING → SETTLED); KYC obligation & warranty that submitted documents are genuine; data-processing terms (they act on customer data they receive — name, phone, vehicle details — with confidentiality and no-reenforcement duties); dispute & indemnity; suspension/termination; liability caps; insurance requirement for logistics partners (the application flow collects insurance documents — verify expiry at onboarding and annually).

## 5. Data retention policy (proposed defaults — legal review required)

| Record | Proposed retention | Basis |
|---|---|---|
| KYC/partner verification documents | Life of partnership + 7 years | EAML/AML & audit expectations |
| Transaction/invoice/escrow/settlement rows | 7 years | Tax (VAT/income) requirements |
| Vehicle custody & incident records | 7 years | Dispute defence, product liability |
| Conversation messages | 24 months rolling | Support quality vs minimisation |
| Audit log | 5 years | Security investigations |
| Verification codes / reset tokens | Auto-purged (daily sweep) — hours | Minimisation |
| Rejected applications | 12 months | Moderation integrity |
| Backups | Rolling 30 (script) — restore drills quarterly | Ops |

Erasure procedure: DPO receives the ticket (from `/api/privacy/delete-request`) → identify lawful-retention conflicts → anonymise what can be erased (name/email/phone nulled, rows retained where law requires) → record the decision + scope in the ticket and audit log → confirm to the data subject within ODPC-reasonable time. **Write this as a one-page SOP and keep it with the support runbook.**

## 6. Incident response procedure (personal-data breach)

1. **Detect**: monitoring alerts, `/api/health`, dev/server logs, user reports to support.
2. **Contain**: rotate `AUTH_SECRET` (kills sessions), revoke compromised staff accounts (their `sessionVersion` bump logs everyone out), block at the edge, restore from backup if data integrity is suspect (procedure in the backup guide).
3. **Assess**: scope (whose data, which categories), risk to individuals; use the AuditLog and access logs to reconstruct.
4. **Notify**: ODPC within 72 hours where required by the DPA; affected individuals without undue delay if high risk. Honest, specific, no minimisation.
5. **Eradicate & recover**: fix the root cause, verify with the security suite on staging, then production.
6. **Learn**: post-incident note in the audit trail; update this procedure and the release checklist.
**The 72-hour ODPC notification duty and its precise triggers must be confirmed with Kenyan counsel.**

## 7. Matters that REQUIRE a qualified Kenyan legal/compliance professional (not optional)

- ODPC registration as a data controller/processor (thresholds, category, timelines) and the annual data-protection return.
- Final privacy policy, TOS, partner agreement drafting and their consistency with the implemented workflows.
- KYC/AML obligations for a vehicle-trading platform (EAML Act applicability to dealers; whether CARMAZE needs reporting procedures).
- Data-sharing terms with payment/logistics providers; any cross-border hosting analysis.
- Consumer-protection compliance for marketplace sales & the membership auto-renewal wording.
- Employment/data-access rules for staff viewing customer documents (confidentiality undertakings, access logs as monitoring notice).

## 8. Access controls summary for the founder (who can see sensitive documents, as built)

| Data | Who can access | Logging |
|---|---|---|
| Private KYC/vehicle documents | Document owner; platform staff (REVIEWER/MODERATOR/ADMIN/FOUNDER) via `/api/files` | Every staff view audit-logged |
| User directories, audit trail, revenue, payment ledger | ADMIN/FOUNDER/FINANCE only | Route-level guards; demo sessions hard-blocked |
| Real order financials (PO payment/commission) | Org OWNER/GM side + platform FINANCE | Suite-verified per route |
| Custody cost figures | Customer + garage OWNER/GM only | Redacted from other staff roles |
| Demo sandbox | Cannot read any of the above for real users | Guard-tested |
