# PART 15 — MESSAGING AND NOTIFICATIONS

## 15.1 Two messaging systems, on purpose

| | Enquiries | Conversations |
|---|---|---|
| Scope | Per vehicle listing (Q&A about one car) | General customer ⇄ business channel |
| Models | `Enquiry` + `EnquiryMessage` | `Conversation` + `ConversationMessage` |
| Creation | `POST /api/enquiries` (vehicle must be PUBLISHED) | `POST /api/conversations` (org must be ACTIVE; optional vehicle/service reference) |
| Sides | CUSTOMER / SELLER | CUSTOMER / ORG (+ SYSTEM) |
| Status | OPEN / ANSWERED / CLOSED | OPEN / CLOSED (+ per-side archive flags) |
| Attachments | none | ≤5 per message, must be `/api/media/…` URLs |
| Read state | none | `unreadForCustomer` / `unreadForOrg` flags cleared on thread open |
| Linkage | — | `refType`/`refId` columns exist but are never written (dead) |

The two are **not linked** at the database level (an enquiry never becomes a conversation); a conversation may *reference* a vehicle (`kind: VEHICLE_ENQUIRY`).

## 15.2 Conversation creation & thread reuse

`POST /api/conversations {orgId, subject?, vehicleId?, serviceId?, kind GENERAL|QUOTE|BOOKING|VEHICLE_ENQUIRY|SUPPORT, message 2–4000}`:
- vehicle/service references are validated to belong to that org (`VEHICLE_MISMATCH`/`SERVICE_MISMATCH`);
- **thread reuse**: an existing OPEN conversation for the same (customer, org, vehicle) receives the message instead of a new thread (bumping `unreadForOrg`);
- notification fan-out to org members in `INBOX_NOTIFY_ROLES` (OWNER/MANAGER/SALES/STAFF) with the org inbox deep link;
- rate limit 10/h.

## 15.3 Messaging features (in `src/components/messaging/conversation-panel.tsx`)

- Two-pane inbox (`MessagesTab`) for `scope="mine"` (customer) and `scope="org"` (business); search filter; unread pulse dots and 9+ badges (`useUnreadConversations`, 20s polling; open thread refreshes every 8s).
- Day separators, sender-name labels, SYSTEM messages as centered pills, image thumbnails or file chips for attachments, vehicle context chip (photo/title/price → detail page) and service-title chip.
- Enter-to-send (IME-safe), closed-thread composer lock + reopen banner, archive/unarchive both sides, close/reopen.
- WhatsApp deep link (`wa.me`) and `tel:` buttons on the customer side when the org enables them — explicitly labelled as leaving CARMAZE.

**Honest limits**: no typing indicators, no per-message read receipts (only per-conversation unread), no user blocking (reporting exists via `/api/reports` for content), attachments depend on the missing upload endpoint.

## 15.4 Message persistence & retention

Messages are permanent rows (no TTL, no deletion endpoint); conversations can be closed/archived by either side but not deleted. Retention is therefore indefinite by default.

## 15.5 Access permissions

Thread access = participant only: the customer (`customerId`) or any member of the org (`orgId` membership). Anyone else → 403. Staff have **no general right to read private conversations** — no admin endpoint exposes conversation contents (privacy by omission by design).

## 15.6 What happens when a customer contacts a garage or showroom

1. Customer clicks Message/Ask on a storefront, listing, or from a garage dialog.
2. `POST /api/conversations` (or enquiry) → row created → org members notified (in-app).
3. Staff open DealerOS/GarageOS → Inbox (badge) → reply; the customer's bell shows unread; either side closes/archives.
4. If the conversation concerns a booking/quote, the statusful systems (Booking/Quote/Custody) carry the truth; the conversation carries the discussion.

## 15.7 Notifications (in-app)

- **Creation**: `src/lib/notify.ts` — `notify({userId, type, title, body?, link?})` → 1 `Notification` + IN_APP `NotificationDelivery` (SENT) + EMAIL/SMS delivery rows always recorded **FAILED** with "not implemented on this deployment; in-app notification only" (`EXTERNAL_CHANNELS_IMPLEMENTED = false`).
- **Demo isolation**: notifications from demo actors to real users are silently skipped (central `isActorDemo()` check + demo-user cache).
- **Delivery to users**: header bell (fetch latest 10, mark-all-read) and Account → Notifications (list, per-item deep links via `n.link`, mark all read). Unread count polls with the auth store refresh.
- **Types** (non-exhaustive): LISTING_PUBLISHED/LISTING decision notes, enquiry/conversation/quote/booking/test-drive events, CUSTODY_UPDATE + collection/road-test steps, PAYMENT_CONFIRMED/INVOICE_ISSUED, DOCUMENT_VERIFY/REJECT/REQUEST_INFO/EXPIRE, ACCOUNT_SUSPENDED/RESTORED, STAFF_*, TRUST_INVITE, CREDIT_*, MEMBERSHIP_*, LOYALTY_POINTS, SUPPLIER_*, CUSTOMER_ORDER_*, LOGISTICS_PARTNER_*, SUPPORT_TICKET_UPDATED, BROADCAST, PARTNER_APPROVED/REJECTED/SUSPENDED.

## 15.8 Email & SMS providers

**None implemented.** `SMTP_URL` and `SMS_API_KEY` are only *presence-checked* for health reporting and dev-code display decisions; no transport code exists. The admin **broadcast** endpoint marks EMAIL/SMS rows `QUEUED` when those vars are present — but **no queue consumer exists**, so such rows would never send (a small honesty inconsistency vs `notify()`, documented in Part 20).

## 15.9 Retry handling & delivery status

`NotificationDelivery` records `attempts` and `lastError` per channel; failed deliveries are visible in Admin → Ops (last 30 with errors). There is **no retry mechanism** — attempts are the single write per notification.

## 15.10 Spam & abuse controls

Rate limits on message/conversation creation (10/h conversations, 30/5min thread messages, 20/h enquiries); community posting limits (5/10min posts, 20/10min comments); report endpoints for abuse; demo isolation; no keyword filtering, no user blocking, no shadow-banning.

## 15.11 External contact controls

Call/WhatsApp buttons render only when the org enables them and are always labelled as leaving CARMAZE (`ExternalChip`). The founder brief's "important commercial rule" — keep initial contact on-platform — is enforced by making in-app messaging the prominent action and labelling external channels, but **cannot be technically enforced** once contact details are visible.
