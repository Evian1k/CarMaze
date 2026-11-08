# PART 21 — COMPLETE SYSTEM DIAGRAMS

All diagrams reflect the **actual implementation** (verified against code). The full database ERD lives in [14-database-documentation.md](14-database-documentation.md).

## 21.1 Overall CARMAZE architecture

```mermaid
flowchart TB
    subgraph Browser
        SPA["React 19 SPA<br/>page.tsx + 27 views (hash routes)"]
        STORES["zustand: auth · cart"]
        LIBC["lib/client.ts<br/>apiGet / apiSend / apiUpload"]
        SPA --> STORES
        SPA --> LIBC
    end
    subgraph "Next.js server (single process, port 3000)"
        CADDY["Caddy :81 → :3000<br/>(+ XTransformPort → aux ports)"]
        API["API Route Handlers<br/>src/app/api/** (100+)"]
        CTX["route() wrapper: request context,<br/>error mapping, zod validation"]
        GUARDS["Guards: requireUser · requireRole ·<br/>getMembership / roleCan · demo sandbox"]
        BIZ["Domain libs: notify · audit · supply ·<br/>mpesa · ids · rate-limit · storefront · totp"]
        DB[("Prisma → SQLite<br/>db/custom.db · 99 models")]
        UPLOADS[("data/uploads/<br/>served by /api/files + /api/media<br/>(no write endpoint yet)")]
    end
    EXT1["Safaricom Daraja<br/>(STK push + callbacks)"]
    EXT2["z-ai-web-dev-sdk<br/>(3 AI endpoints)"]
    LIBC -->|"fetch /api/* (cookies)"| CADDY --> API --> CTX --> GUARDS --> BIZ --> DB
    API --> UPLOADS
    BIZ --> EXT1
    BIZ --> EXT2
    EXT1 -.->|"signed callbacks"| API
```

## 21.2 Frontend-to-backend request flow

```mermaid
sequenceDiagram
    participant V as View (src/views/*)
    participant C as lib/client.ts
    participant R as Route Handler
    participant G as Guards
    participant P as Prisma/SQLite
    V->>C: apiSend('/api/enquiries', 'POST', body)
    C->>R: fetch (credentials: include)
    R->>R: runWithRequestContext()
    R->>G: getSessionUser() — JWT → User row (ACTIVE?)
    G->>G: requireUser/requireRole/getMembership + demo guard
    R->>R: parseBody(zod)
    R->>P: query/mutation
    R->>P: side effects: Notification, AuditLog, *Event
    R-->>C: ok(json) | fail(status, CODE)
    C-->>V: data or ClientApiError
    V->>V: update state + toast; pollers refresh (15–20s)
```

## 21.3 Authentication and role assignment

```mermaid
flowchart TB
    REG["POST /api/auth/register"] --> U["User created<br/>roles = CUSTOMER,SELLER<br/>(no verification required)"]
    DEMO["POST /api/auth/demo {role}"] --> DU["Seeded demo user<br/>JWT gains demo claim<br/>session clamped ≤14d"]
    LOGIN["POST /api/auth/login"] --> MFA{"mfaEnabled?"}
    MFA -- yes --> CH["5-min challenge JWT<br/>POST /api/auth/mfa/verify<br/>TOTP ±1 step, timing-safe"] --> S
    MFA -- no --> S["createSession()<br/>httpOnly cookie 7d"]
    U --> S
    ROLEGRANTS["Role grants (only these paths)"] --> A1["Staff approve SELLER KYC → SELLER_VERIFIED"]
    ROLEGRANTS --> A2["Staff approve DEALER/GARAGE app → Org + OWNER membership + *_OWNER role"]
    ROLEGRANTS --> A3["Admin supply console approves supplier → SUPPLIER_* "]
    ROLEGRANTS --> A4["Staff approve LOGISTICS app → LOGISTICS_OWNER"]
    ROLEGRANTS --> A5["Org owner invites staff → DEALER_STAFF/GARAGE_STAFF + OrgMember role"]
    ROLEGRANTS --> A6["Admin staff mgmt → SUPPORT/REVIEWER/MODERATOR/FINANCE"]
    S --> EVERY["Every request:<br/>getSessionUser() re-reads User row<br/>status ACTIVE required → instant revocation"]
```

## 21.4 Customer vehicle purchase enquiry

```mermaid
sequenceDiagram
    actor C as Customer
    participant VD as vehicle-detail view
    participant API as /api/enquiries
    participant DB as SQLite
    participant S as Seller side
    C->>VD: Enquire (message, phoneShare?)
    VD->>API: POST {vehicleId, message, phoneShare}
    API->>API: auth · vehicle PUBLISHED · org ACTIVE · not own listing · demo guard
    API->>DB: Enquiry (ENQ-, OPEN) + EnquiryMessage (CUSTOMER)
    API->>DB: audit(enquiry.created)
    alt org listing
        API->>S: notify OWNER/MANAGER/SALES (link /dealer)
    else private
        API->>S: notify owner (link /my-listings)
    end
    S->>API: POST /api/enquiries/:id {body}
    API-->>C: reply (enquiry → ANSWERED) + notification
    C->>API: PATCH {status CLOSED} (optional)
```

## 21.5 Private seller listing approval

```mermaid
flowchart LR
    A["Seller: #/sell wizard<br/>(+ optional AI description)"] --> B["POST /api/vehicles<br/>DRAFT or PENDING_REVIEW<br/>photos · zod · org auto-attach"]
    B --> C{"Save as draft?"}
    C -- yes --> D["DRAFT"]
    D -- submit --> E["PENDING_REVIEW"]
    C -- no --> E
    E --> F["Reviewers notified<br/>Admin → Listings queue"]
    F --> G{"Moderator decision<br/>(REVIEWER/MODERATOR/ADMIN/FOUNDER)"}
    G -- approve --> H["PUBLISHED<br/>+ event + notification"]
    G -- reject(n≥10) --> I["REJECTED + reviewNote<br/>→ edit → resubmit"]
    G -- suspend(n≥10) --> J["SUSPENDED"]
    H --> K["Marketplace · home feed<br/>· storefront · AI matches<br/>views deduped per IP"]
    H --> L["Enquiries · offers<br/>· test drives"]
```

## 21.6 Showroom lead management

```mermaid
flowchart TB
    LEAD["Lead in: Enquiry / Conversation /<br/>Test drive / Offer"] --> FAN["notifyOrgMembers(OWNER/MANAGER/SALES)"]
    FAN --> INBOX["DealerOS: Enquiries tab · Inbox (20s poll)"]
    INBOX --> REPLY["Reply in thread (any member)"]
    REPLY --> TD["Book/confirm/start/complete test drive<br/>(odometer + fuel logged)"]
    TD --> OFFER["Offer on matched private car<br/>(accept ⇒ RESERVED)"]
    OFFER --> SOLD["Mark sold"]
    INBOX --> GAP["Gap: no per-lead assignment<br/>or follow-up scheduler (roadmap)"]
```

## 21.7 Garage booking and repair lifecycle

```mermaid
flowchart LR
    REQ["ServiceRequest (OPEN)<br/>customer + category + county"] --> FAN["Fan-out to garages<br/>offering that category"]
    FAN --> Q["Garage quote (upsert,<br/>request → QUOTING)"]
    Q --> ACC{"Customer decides<br/>(Account → Requests)"}
    ACC -- accept --> B["Booking CONFIRMED<br/>others EXPIRED"]
    ACC -- decline --> OPEN["back to OPEN (if none left)"]
    B --> SCH["Schedule"] --> ST["Start (request IN_PROGRESS)"] --> COM["Complete<br/>+250 loyalty pts"]
    COM --> REV["Customer reviews (earned)"]
    B -- cancel --> CAN["CANCELLED both sides"]
```

## 21.8 Vehicle custody and collection

```mermaid
stateDiagram-v2
    [*] --> HANDOVER_REQUESTED: customer handover dialog<br/>(photos, odometer, fuel, valuables, spend cap, roadTest?)
    HANDOVER_REQUESTED --> RECEIVED: org receive (staffName)
    RECEIVED --> INSPECTION: org status
    INSPECTION --> AWAITING_APPROVAL: org status
    AWAITING_APPROVAL --> WORK_IN_PROGRESS: org status
    INSPECTION --> WORK_IN_PROGRESS
    WORK_IN_PROGRESS --> ROAD_TEST_REQUESTED: org requests road test
    ROAD_TEST_REQUESTED --> WORK_IN_PROGRESS: customer authorises / declines
    WORK_IN_PROGRESS --> READY_FOR_COLLECTION: completedWork + cost + photos
    READY_FOR_COLLECTION --> RETURNED: customer collect-self
    READY_FOR_COLLECTION --> RETURNED: authorised collector + single-use 6-digit code<br/>(bcrypt, 48h, audited failures)
    HANDOVER_REQUESTED --> DISPUTED: customer dispute
    DISPUTED --> SECURITY_INCIDENT: DAMAGE_IN_CUSTODY (staff queue)
```

## 21.9 Subscription and payment lifecycle

```mermaid
sequenceDiagram
    participant B as Business (owner)
    participant API as /api/billing/*
    participant DB as SQLite
    participant D as Safaricom Daraja
    participant F as FINANCE (fallback)
    B->>API: POST /subscribe {planCode} (role+org checked)
    API->>DB: Invoice PENDING (desc [plan:code]) — no subscription yet
    B->>API: POST /mpesa/stkpush {invoiceId, phone} (demo blocked)
    alt no credentials
        API-->>B: 501 MPESA_NOT_CONFIGURED (attempt FAILED, audited)
    else configured
        API->>D: STK push (amount = minor/100)
        API->>DB: PaymentAttempt PENDING
        D->>API: POST /mpesa/callback (x-carmaze-signature; fail-closed prod)
        API->>API: match attempt · idempotency · amount check
        API->>DB: attempt SUCCESS → activatePaidInvoice('MPESA')
        API->>DB: Invoice PAID · Subscription ACTIVE · audit + notifications
    end
    opt manual reconciliation
        F->>API: POST /invoices/:id/mark-paid (note mandatory, audited)
        API->>DB: activatePaidInvoice('MANUAL')
    end
```

## 21.10 Notification flow

```mermaid
flowchart LR
    EVT["Business event in any route"] --> N["notify({userId,type,title,link})"]
    N --> DEMO{"actor demo &<br/>target real?"}
    DEMO -- yes --> SKIP["skip silently (sandbox)"]
    DEMO -- no --> ROWS["Notification + IN_APP SENT<br/>+ EMAIL/SMS rows FAILED<br/>('not implemented')"]
    ROWS --> BELL["Header bell (fetch 10, mark all read)"]
    ROWS --> ACC["Account → Notifications"]
    BELL --> NAV["tap → n.link deep route"]
    BCAST["Admin broadcast (AF, cap 1000)"] --> ROWS2["per-recipient rows<br/>EMAIL/SMS 'QUEUED' if env set<br/>(no queue consumer — roadmap)"]
```

## 21.11 Database entity relationships

See the two `erDiagram` blocks in [14-database-documentation.md](14-database-documentation.md) (core platform + supply network).

## 21.12 Deployment architecture

```mermaid
flowchart TB
    subgraph "Sandbox / dev"
        BR["Browser"] --> CAD["Caddy :81"]
        CAD -->|"default"| NEXT["Next.js :3000<br/>(bun run dev | standalone server)"]
        CAD -->|"?XTransformPort=3003"| WS["Socket.IO demo :3003"]
        NEXT --> DB[("db/custom.db")]
        NEXT --> UP[("data/uploads/")]
        NEXT --> LOG["dev.log / server.log"]
    end
    subgraph "Production (to be provisioned)"
        DNS["Domain + DNS"] --> TLS["TLS proxy"]
        TLS --> PNEXT["Next standalone :3000"]
        TLS -->|"MPESA_CALLBACK_URL"| CB["/api/billing/mpesa/callback<br/>/api/supply/payments/webhook"]
        PNEXT --> PDB[("SQLite file +<br/>backup routine (todo)")]
        PNEXT -.-> AI["Managed AI SDK"]
    end
```
