# Task 3-d — Seller verification workflow wired into seller-facing frontend

## Files created
- `src/components/seller/verification-panel.tsx` (NEW, 'use client')
  - `VerificationPanel` — self-contained card, four states:
    - **VERIFIED** (role `SELLER_VERIFIED`): green card (`border-emerald-500/40 bg-emerald-500/5`, matches codebase emerald/dark-token pattern) with ShieldCheck + approved copy + note that verification shows on listings. Skips the applications fetch entirely when verified.
    - **IN PROGRESS** (`SUBMITTED`/`UNDER_REVIEW`/`RESUBMITTED`): status badge (dealer-style classes), ref code (SVA-XXXXXX), submitted date, compact event timeline (type + note + actor + date, newest last — API returns events asc), escalated alert when `escalated`, docs-on-file count, honest copy: "Our review team checks identity and ownership documents manually. Uploading documents never self-verifies an account…".
    - **ACTION REQUIRED** (`MORE_INFO_REQUIRED`): prominent amber panel with the reviewer's latest `INFO_REQUESTED` event note + `correctionsDueAt`, document uploader (exact dealer `DocUploader` pattern: hidden multi-file input → `apiUpload('/api/upload', fd)` with `kind=document`, list of {name,url} with remove, privacy note) + optional note → `PATCH /api/applications/[id] {action:'resubmit', documents?, notes?}` → back to IN PROGRESS. Hint honestly states new uploads REPLACE the docs on file (matches API behaviour).
    - **NOT STARTED / DRAFT / REJECTED/SUSPENDED/REVOKED**: expandable "Get verified as a seller" form — full legal name (prefill `user.name`), ID/passport no., county (KENYA_COUNTIES Select), town, phone (prefill `user.phone`), representative (prefill `user.name`), documents uploader with helper text (government ID; logbook/ownership doc or authority-to-sell letter), consent checkbox (verbatim copy), optional notes; honest copy near submit: "Verification is completed by our review team after document checks — it is never automatic." REJECTED shows the decision note + "Correct and resubmit" button that opens the form. Edge state: `APPROVED` but role not in session → "Refresh status" button calling `useAuth().refresh()`.
  - Exported `useSellerApplication(enabled)` hook — GET `/api/applications`, filters `type==='SELLER'`, picks most recent by createdAt; used by the panel and the dashboard.
  - Exported `SELLER_ACTIVE_STATUSES` + types `SellerApplication` / `SellerAppDoc`.
  - After submit/resubmit: hook `reload()` + `useAuth().refresh()`. Errors surfaced via ClientApiError message (Alerts in-form + toast). Loading skeleton + retry Alert. Max 10 docs guard (API schema limit).

## Files edited
- `src/views/sell/index.tsx` — imported `VerificationPanel`; rendered inside `<Reveal className="mb-6">` directly after the page header, above the wizard/edit alerts. Wizard logic untouched.
- `src/views/seller-dashboard/index.tsx` — imported `useSellerApplication`, `SELLER_ACTIVE_STATUSES`, `hasAnyRole`, `ShieldCheck`. Banner under the header:
  - not verified + no active SELLER app → amber info banner (verbatim task copy) + "Get verified" → `navigate('sell')`
  - in review (SUBMITTED/UNDER_REVIEW/RESUBMITTED) → neutral banner "Seller verification in review — ref <code>"
  - MORE_INFO_REQUIRED → amber "needs your attention — ref <code>" + "Open verification" button (small honest extension beyond spec, so the action isn't hidden behind "in review" wording)
  - verified → nothing extra (dashboard header shows no seller identity, so no badge)

## API interactions used (frontend only, no API files touched)
- `GET /api/applications` → `{ applications: [...] }` filtered `type==='SELLER'` (documents arrive as a JSON **string** — parsed defensively).
- `POST /api/applications` `{type:'SELLER', status:'SUBMITTED', orgName, regNo, county, town?, phone, email, representative, documents[], consent:true, notes?}` (documents ≥1 enforced client-side to match the API's `DOCUMENTS_REQUIRED` rule).
- `PATCH /api/applications/[id]` `{action:'resubmit', documents?, notes?}`.
- `POST /api/upload` multipart (`file`, `kind=document`) → `{url,name}`.

## Not completed / skipped
- **vehicle-detail "Verified seller" badge SKIPPED**: `GET /api/vehicles/[id]` payload exposes `owner: { name }` only (select is `{id, name}`) — no roles and no verified marker; `sellerType` is DEALER/PRIVATE channel, not verification. Showing a badge would require an API change, which the task forbids. Flagging for whoever owns that API (add e.g. `ownerVerifiedSeller` to the select/payload, then a badge next to `vehicle.owner.name` in the seller card).
- No lint/build/tsc/db commands run (per task constraints); dev server log after edits shows clean compiles (✓ Compiled).
