# PART 12 — AI AND AUTOMATION

Every AI or automation feature in the codebase, with its exact mechanics. Genuine LLM integrations are kept separate from rule-based logic.

## 12.1 Genuine AI integrations (3, all server-side via `z-ai-web-dev-sdk`)

Common architecture (identical in all three routes):
- Dynamic `import('z-ai-web-dev-sdk')` → `ZAI.create()` → `zai.chat.completions.create({ messages: [assistant(system prompt), user(payload)], thinking: { type: 'disabled' } })` — the **SDK default model** (no explicit model parameter is pinned in code).
- Responses are parsed with a tolerant `extractJson()` (strips markdown fences, first-`{`-to-last-`}`).
- Every call logs to the **`AiUsage`** table (`userId?`, `feature`, `ok`, error ≤200) — usage/cost observability exists per feature.
- Failure path: `console.error` + `AiUsage(ok:false)` + **HTTP 503 `AI_UNAVAILABLE`** — the UI shows an error state; there is **no silent fake content**.
- All three are stateless one-shot forms (no conversation history), with client-side length limits and server rate limits.

| Feature | Route & UI | Input | Model output → what happens | Guards |
|---|---|---|---|---|
| **AI Car Finder** | `POST /api/ai/car-finder`; `AiCarFinder` in `#/cars` | Free-text query 5–600 chars | JSON `{summary, filters}` — filters are **coerced/whitelisted field-by-field** (enums validated, ints clamped, unknown keys dropped) then run as a **real Prisma query over PUBLISHED vehicles** (featured-first, take 8). Empty results append a widening hint. | Auth optional; 15/h authed, **5/h anonymous per IP** |
| **Listing Assistant** | `POST /api/ai/listing-assistant`; `ListingAssistant` in `#/sell` step 2 | `facts{make?, model?, year?, mileageKm?, condition?, county?, features[]≤20, notes?≤600}` | `{description}` (80–150 words target) shown as an **editable draft**; the seller must press "Use this description". Anti-hallucination prompt: only supplied facts, no invented features. | Auth required; 10/h |
| **Garage Assistant** | `POST /api/ai/garage-assistant`; `GarageAssistant` in `#/garages` | Symptoms 5–600 chars | `{guidance ≤1200 chars, categories 1–3}` — categories filtered to the real SERVICE_CATEGORIES; rendered as guidance text + clickable category chips that filter the garage directory. Safety prompt: never a definitive diagnosis. | Auth required; 10/h |

**Human approval**: always — AI outputs never mutate data directly (car-finder only reads; listing draft requires an explicit apply; garage assistant only navigates).

**Data received by the provider**: only the prompt text described above (no session secrets, no other users' data, no documents).

**If the provider is unavailable**: 503 + logged failure; the marketplace/garage/sell flows continue normally without the AI panel's results.

**Cost control**: per-user/IP rate limits + `AiUsage` rows (feature-granular). There is no budget cap or token accounting beyond this.

## 12.2 AI-adjacent but **rule-based** (not LLM)

| Feature | Where | Mechanism |
|---|---|---|
| **Dealer Copilot** | `GET /api/dealer/copilot`, Overview panel | Deterministic insight rules over the dealership's real data (e.g. stale enquiries, pending listings, subscription pressure) with severity + deep links. No model call. |
| **Fitment engine** | `GET /api/supply/fitment` | Structured-data verdicts: MATCH (recorded compatibility row) / POSSIBLE (brand-level `vehicleMakes` only) / NO_FITMENT (explicitly "never claimed to fit"). |
| **Fraud risk assistance** | Brief item — **not implemented as AI**; nearest analogues: supplier `riskScore` tool (manual admin input) and the incident queue. |
| **Support assistance** | Brief item — **not implemented**; support runs on tickets + queues. |
| **Intro video** | `scripts/gen-intro-video.ts` | One-off AI video generation (not a runtime feature). |

## 12.3 Automation (programmed rules, no scheduler)

- **Loyalty ledger** — +500 referral signup (cap 50), +100 first earned review, +250 completed service; all idempotent via ledger checks.
- **Reminder recurrence** — marking a reminder DONE with an interval rolls the next occurrence (≤100-iteration guard).
- **SLA sweep** (applications) — reminders at SLA, escalation at 2×SLA, applicant nudges; manual trigger, 12h idempotency.
- **Opportunistic sweeps on read** — campaign expiry (`GET /api/campaigns`), document lazy-expiry (verification queue), subscription/membership lazy-expiry on account reads.
- **View dedupe** — 24h per-IP `ViewEvent` unique keys with race-safe handling and 5% opportunistic pruning.
- **Overselling guard** — supply POs reserve stock across warehouses (largest-availability-first) inside transactions.

➡ Payments, subscriptions and revenue continue in [12-payments-subscriptions-revenue.md](12-payments-subscriptions-revenue.md).
