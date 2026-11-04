# Task 3-c — Company Staff management + logistics partner admin controls

## Status: COMPLETE (with 2 documented deviations, see "Not completed / deviations")

## Files created
- `src/app/api/admin/staff/route.ts` — GET list + POST invite (one-time password)
- `src/app/api/admin/staff/[id]/route.ts` — PATCH actions (set_department / set_role / suspend / reactivate / remove_staff)
- `src/app/api/admin/logistics/route.ts` — GET partners + per-partner job stats + internal notes + status summary
- `src/app/api/admin/logistics/[id]/route.ts` — PATCH suspend / reinstate / note

## Files edited
- `src/views/admin/index.tsx`
  - `staff` tab added to TABS + TAB_LABELS; role-gated via new `TAB_ROLES` map + `tabVisibleFor()` (tabs without an entry stay visible to all staff; unknown-role access falls back to overview). Nav renders filtered tabs.
  - New "Company staff" section (StaffTab) after UsersTab: table (Member, Roles, Department badge, Status, Created, Actions dropdown), invite dialog (name/email/role/department/phone), one-time-password reveal dialog shown ONCE with copy button + honest "will not be shown again" note, row action dialogs with confirm + reason/department inputs, errors surfaced verbatim via toast, refresh after each action, loading skeleton + empty state.
  - New "Logistics partners" section (LogisticsPartnersSection) rendered at the bottom of the Applications tab for ADMIN/FOUNDER only: table (Partner+refCode+ownerEmail, Type, County, Status badge, Verified chip, Jobs stats, Created, Suspend/Reinstate/Notes actions), suspend/reinstate reason dialog (≥10 chars), notes dialog (view history + add note).
  - `disputes` deep-link alias: `?tab=disputes` → `supply` (see deviations).
  - Department badge chip next to "Control Center" title, guarded for `user.department` being undefined.
  - Bonus honesty fix: LOGISTICS/SELLER applications in the review queue were labelled "Garage" — added `applicationTypeLabel()` used in the queue cards + detail dialog.

## API contracts

### GET /api/admin/staff  (ADMIN|FOUNDER)
→ `{ staff: [{ id, name, email, roles: string[], department, status, createdAt }], departments: [7 depts] }`

### POST /api/admin/staff  (ADMIN|FOUNDER, rateLimit `staff-invite:${userId}` 20/h)
Body `{ name (2..80), email (lowercased+valid), role, department, phone? }`
- role outside SUPPORT|REVIEWER|MODERATOR|FINANCE → `400 ROLE_NOT_ALLOWED` (ADMIN/FOUNDER promotion deliberately out of scope — documented in code)
- existing email → `409 EMAIL_EXISTS`; rate limited → `429`
- 201 → `{ user: { id, name, email, role, department }, oneTimePassword, note }`
- Password: 12-char unambiguous alphabet (same generator style as orgs/staff), bcrypt cost 10, returned ONCE, never stored in plaintext, never in the audit trail (STAFF_CREATED metadata = { email, role, department } only). New user = `CUSTOMER,<role>`, ACTIVE, department set, in-app notify sent. **SMTP delivery of the password is a documented remaining integration** (comment in code).

### PATCH /api/admin/staff/[id]  (ADMIN|FOUNDER)
Body `{ action, department?, role?, note? }`. Guards: 404 NOT_FOUND; 409 NOT_STAFF (target has no staff role); 403 FOUNDER_PROTECTED; 400 CANNOT_MODIFY_SELF (suspend/remove_staff on self); set_role on ADMIN → 400 ROLE_NOT_ALLOWED.
- set_department → STAFF_DEPARTMENT_SET · set_role → swaps the one assignable role, keeps other roles (STAFF_ROLE_SET {from,to}) · suspend → SUSPENDED (comment: getSessionUser rejects non-ACTIVE on every request so access dies immediately despite stateless JWTs; STAFF_SUSPENDED; notify) · reactivate → STAFF_REACTIVATED; notify · remove_staff → strips ALL staff roles, nulls department, keeps CUSTOMER (STAFF_ACCESS_REMOVED {removedRoles}; notify)
→ `{ staff: {...updated row}, message }`

### GET /api/admin/logistics  (ADMIN|FOUNDER)
→ `{ partners: [{ id, refCode, name, partnerType, county, status, verified, ownerEmail, jobsTotal, jobsCompleted, jobsFailed, notes: [{by,at,text}], createdAt }], summary: { total, pending, approved, suspended, rejected } }`
- job counts via one `db.deliveryJob.groupBy(['partnerId','status'])`; notes via bounded findMany on NOTE events (last 150)

### PATCH /api/admin/logistics/[id]  (ADMIN|FOUNDER)
`{ action: 'suspend'|'reinstate', note ≥10 chars }` / `{ action: 'note', note ≥2 }`
- suspend: status SUSPENDED + verified=false + event SUSPENDED + audit LOGISTICS_PARTNER_SUSPENDED + owner notified (idempotent when already suspended)
- reinstate: only from SUSPENDED (409 INVALID_STATE) → APPROVED + verified=true + event REINSTATED + audit LOGISTICS_PARTNER_REINSTATED + owner notified
- note: event NOTE + audit LOGISTICS_PARTNER_NOTED (staff-only)
- Comment: approval of NEW partners stays in `/api/applications/[id]` approve (which creates the LogisticsPartner)

## Assumptions
- Admin view favours inline tab components → both new panels inlined in `admin/index.tsx` (no separate staff-panel component), matching the file's established structure.
- "Row actions dropdown": admin view had no existing DropdownMenu usage — introduced shadcn dropdown-menu for staff rows (4-5 actions don't fit inline), everything else follows existing table/dialog/badge patterns exactly.
- Staff `notify` types reused where they exist (ACCOUNT_SUSPENDED/ACCOUNT_RESTORED) and added STAFF_ACCOUNT_CREATED / STAFF_ACCESS_REMOVED / LOGISTICS_PARTNER_SUSPENDED / LOGISTICS_PARTNER_REINSTATED as new string types (Notification.type is a free string).
- LogisticsPartnerEvent + AuditLog written on note action too (spec only mandated events/audit for suspend/reinstate; consistency with admin/partners patterns).

## Not completed / deviations
1. **Overview-tab staff/logistics stat cards: skipped** — /api/admin/overview response shape must not change and neither staff count nor pending logistics-application count is derivable from the existing payload. Adding them would require changing the overview GET (out of my file ownership).
2. **`?tab=disputes` maps to the `supply` tab but does NOT preselect its Disputes sub-view** — AdminSupplyConsole (not in my ownership) uses uncontrolled `Tabs defaultValue="verification"` and takes no props. The alias lands staff one click from Disputes. A one-line change in supply-console.tsx (accept an `initialTab` prop) would complete the preselect — left to the owner of that file.
3. `admin/index.tsx` is ~3400 lines after this task; no refactor attempted (out of scope).

## Environment notes
- Did NOT run dev server / lint / build / tsc / db commands (per instructions). Prisma client already regenerated by task 3-a; `department` field verified present in schema before use. Dev log tail checked after edits — no compile errors.
