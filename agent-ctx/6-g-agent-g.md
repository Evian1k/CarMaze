# Task 6-g — AI Features (car-finder, listing-assistant, garage-assistant)

Agent: G (Task ID 6-g). Status: COMPLETE.

## Files (all within ownership)
- `src/app/api/ai/car-finder/route.ts`
- `src/app/api/ai/listing-assistant/route.ts`
- `src/app/api/ai/garage-assistant/route.ts`
- `src/components/ai/shared.tsx` — `AiDisclaimer` (muted Info line) + `AiPanel` (Card w/ gold Sparkles header used by all three assistants)
- `src/components/ai/car-finder.tsx` — `AiCarFinder({ onResults: (vehicles: VehicleCardData[], message: string) => void })`
- `src/components/ai/listing-assistant.tsx` — `ListingAssistant({ facts, onApply: (description: string) => void })`, draft disabled until make+model present, editable preview + "Use this description"
- `src/components/ai/garage-assistant.tsx` — `GarageAssistant({ onSelect: (category: string) => void })`, guidance + category chip buttons

## Endpoints & contracts
- `POST /api/ai/car-finder` — anonymous allowed (rate 5/hr by IP) or authed (15/hr by userId); rate limited FIRST; body `{query: 5..600}`; LLM → JSON `{summary, filters}` → zod-free manual coercion (enums validated, unknown dropped, ints sane-ranged); queries `db.vehicle` status='PUBLISHED' only, featured desc → createdAt desc, take 8; returns `{message, filters, vehicles}`; zero results appends honest note.
- `POST /api/ai/listing-assistant` — requireUser, 10/hr; body `{facts}`; returns `{description}`; prompt hardened to forbid any equipment/condition claims not in facts (LLM initially said "air conditioning" — fixed by tightening prompt, re-verified).
- `POST /api/ai/garage-assistant` — requireUser, 10/hr; body `{symptoms: 5..600}`; returns `{guidance, categories, categoryLabels}`; categories validated against SERVICE_CATEGORIES (drop unknown, cap 3, fallback OTHER).
- All routes: try/catch → 503 `{error:'AI_UNAVAILABLE', message:'The AI assistant is temporarily unavailable. Please try again shortly.'}`; every attempt logged to `AiUsage {userId?, feature, ok, error?}` (features: car-finder / listing-assistant / garage-assistant). SDK imported dynamically, backend only. No full user content logged.

## Verification (curl, dev server)
- car-finder "family SUV under 4 million…automatic" → 200; message "Looking for a family SUV under 4 million KES with automatic transmission for weekend trips."; filters `{bodyType:SUV, transmission:AUTOMATIC, maxPriceMinor:400000000}`; vehicles: Nissan X-Trail 2016 KES 2.95M + Subaru Forester 2017 KES 3.1M (Harrier 4.2M & Prado 7.5M correctly excluded).
- car-finder "electric pickup truck under 500000" → 200, `vehicles: []`, message ends "No current listings match — try widening the budget or body type."
- listing-assistant (customer session) → description: "2020 Toyota Vitz, foreign used with 33,000 km…reverse camera…Details on request…" — only supplied facts.
- garage-assistant "steering vibrates above 80km/h, pulls right" → categories TYRES, MECHANICAL, INSPECTION; guidance: "…Have the vehicle inspected by a professional as soon as possible…".
- Errors: anon listing/garage → 401 UNAUTHENTICATED; 2-char query → 400 VALIDATION_ERROR.
- AiUsage rows confirmed (4 rows, correct features/userIds). ESLint clean on `src/app/api/ai` + `src/components/ai`. dev.log: no errors.

## Rate limits
`ai-finder:{userId|ip}` 15/15 per hr authed, 5/hr anon; `ai-listing:{userId}` 10/hr; `ai-garage:{userId}` 10/hr.

## Deviations
- LLM system-prompt role sent as `'assistant'` per project SDK convention (not `'system'`).
- Listing-assistant prompt has 2 extra anti-hallucination sentences beyond spec (verified necessary).
- Garage-assistant falls back to `['OTHER']` if LLM returns zero valid categories (prevents empty chip UI).

## Blocked / notes for integrators
- Views wiring (marketplace → `<AiCarFinder onResults=…>`, sell → `<ListingAssistant>`, garage request → `<GarageAssistant>`) belongs to view owners; components are drop-in per the props contracts above.
- zod import in routes uses v4 syntax already used elsewhere in the codebase.
