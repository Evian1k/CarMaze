# Task 6-e — Agent E — 3D Car Customizer

## Status: COMPLETE (pending integration-step visual WebGL check — agent cannot render WebGL headlessly)

## Files delivered (ownership respected)
| File | Purpose |
|---|---|
| `src/components/customizer/presets.ts` | `CarConfig` type (single source of truth), 10 paint swatches, 6 rim colors, finish/rim/accessory option lists, `DEFAULT_CONFIG`, `paintName()`, `rimColorName()`, `describeConfig()` (plain-language summary used for quote prefill) |
| `src/components/customizer/car-scene.tsx` | Memoized scene contents: procedural sedan from primitives, materials, wheels (3 rim styles), accessories, lights, floor, OrbitControls. Exports `CarScene` + `OrbitControlsRef` |
| `src/app/api/customizer/configs/route.ts` | `POST` — zod `strictObject` validation (rejects unknown keys & bad values, 400), optional session attach, rate-limited 60/h, creates row w/ 12-char `shareId()` → `{ shareId }` 201 |
| `src/app/api/customizer/configs/[shareId]/route.ts` | `GET` — 200 `{ modelId, config(parsed), createdAt, views }`; fire-and-forget views increment; 404 `CONFIG_NOT_FOUND`; 410 `CONFIG_INVALID` ("This shared configuration is no longer valid") on JSON parse failure OR shape-guard failure |
| `src/views/customizer/index.tsx` | Canvas + full control panel + save/share + garage-quote flow + WebGL fallback |

## Config schema (validated server-side with zod strict — no silent fixing)
```
paint /^#[0-9a-fA-F]{6}$/, finish gloss|matte|metallic, rimStyle sport|classic|mesh,
rimColor /^#[0-9a-fA-F]{6}$/, glassTint 0..0.9, accessory none|spoiler|roofrack, rideHeight -0.06..0.10
modelId: literal 'sedan-classic'; body & config objects are strictObject (unknown keys → 400)
```

## 3D scene implementation notes
- Body group (lower RoundedBox 4.4×0.72×1.95 r0.18 @y0.62, angled hood + trunk RoundedBoxes, cabin 2.3×0.66×1.7 r0.16 @y1.22) offset by `config.rideHeight`; wheels at y0.42 outside the group → stay grounded.
- Paint = one shared `MeshPhysicalMaterial` (clearcoat 1 / ccRough 0.06; metalness gloss .35 / metallic .85 / matte .05; roughness .12/.3/.6) recreated via `useMemo` per change, **disposed in effect cleanup** (R3F never auto-disposes material instances passed as props). Same pattern for rim material (metalness .9 / roughness .25) and glass (opacity = min(1, 0.15 + tint)).
- Glass: 4 thin boxes proud of cabin, near-black `MeshPhysicalMaterial`, transparent.
- Wheels: cylinder tyre (r .42, w .3, rubber) + rim disc slightly wider so faces show; **sport** 5 box spokes, **classic** 8 thin spokes + center cap, **mesh** 12 spokes + torus ring. Local frame axle=+Y, group `rotation.x=π/2` maps axle across the car (see deviations).
- Emissive headlights (white) + taillights (#B3382C) + dark front intake; spoiler (painted wing + 2 struts) and roof rack (4 posts + 2 rails) mount inside the body group so they ride with rideHeight.
- Environment preset="city" wrapped in **SilentErrorBoundary + Suspense(fallback null)** → blocked HDRI can never blank the scene; Canvas-level Suspense (view) has an `<Html>` "Preparing showroom…" loader.
- Perf: `dpr={[1,1.75]}`, shadows="soft" + one shadow-casting directional (1024 map, bounded camera), ContactShadows (blur 2.4 / opacity .55), dark pedestal disc + faint deep-green Grid, no postprocessing, scene memoized with `React.memo`.
- Camera: via Canvas prop `[4.2, 1.8, 5.2]` fov 40; OrbitControls makeDefault, pan off, polar 0.15–1.45, dist 3–9, target [0,.5,0]; view "Camera" button calls `controlsRef.current.reset()`.

## View implementation notes
- WebGL probe via `Promise.resolve().then(...)` (no setState in effect body); unsupported → fallback Card with generated `/images/hero.png` + explanation + "Browse cars" CTA (`navigate('cars')`).
- `?cfg=` restore: GET → apply config + set configId + warm the share link; failure → Alert banner "This shared configuration is no longer available — showing default setup". `appliedRef` dedupes (incl. after self-navigation post-save).
- Save & Share: auth-gated (signed-out → sign-in dialog → `navigate('signin')`); POST → success dialog with absolute link `${origin}/#/customizer?cfg=<shareId>` + Copy (clipboard + toast) + hash rewritten via `navigate(..., {replace:true})` so the URL IS the share link. `savedSnapshotRef` dedupes identical re-saves.
- Garage quote: always visible; auto-saves first (ensureSaved) → dialog with config chips (paint hex block, finish, rims, accessory, tint, ride), county `Select` (KENYA_COUNTIES), optional town/vehicleDesc, description Textarea prefilled from `describeConfig()` (regenerated until user edits) → `POST /api/service-requests {category:'MODIFICATIONS', configId, county, town?, description, vehicleDesc?}`; 401 → sign-in prompt; refCode parsed defensively (`refCode | request.refCode | serviceRequest.refCode`) since the parallel agent owns that route.
- Custom scrollbar classes on quote dialog; sliders/swatches/segmented buttons all write straight into `config` state → scene.

## Curl results (all pass)
```
POST valid            → 201 {"shareId":"JW2PTWNB9FTP"}
GET  JW2PTWNB9FTP     → 200 config matches, views 0 → 1 on second GET
POST paint "#xyz"     → 400 VALIDATION_ERROR (config.paint)
POST unknown key      → 400 Unrecognized key: "spoiler" (strict)
GET  BOGUSID12345     → 404 CONFIG_NOT_FOUND
POST rideHeight 0.5   → 400 (must be ≤ 0.10)
POST wrong modelId    → 400 (expected "sedan-classic")
GET  collection       → 405 (POST-only)
```
`bunx eslint` on owned paths: **0 problems**. `tsc --noEmit` (customizer files): **0 errors**. dev.log: no errors from customizer files (only pre-existing error is `api/community/posts` importing `getSessionUser` from `@/lib/api` — another agent's file, not mine).

## Deviations (deliberate)
1. **Wheel axle rotation**: spec said "cylinder rotated Z 90°"; with car length along X the axle must be world-Z → used group `rotation.x = π/2` (geometrically correct orientation).
2. **Mesh count**: ~43 meshes default (sport rims), ~67 with mesh rims — slightly above the "<40" guidance because spec-mandated spoke counts (5/8/12 ×4 wheels) dominate. All low-poly, one shared material per role, draw calls trivial; every other perf guard (dpr cap, no postprocessing, bounded shadow camera) is in place.
3. **Quote flow always re-saves** the current config before quoting (instead of quoting a possibly-stale configId) so the attached configuration always matches what's on screen; identical configs reuse the existing row via snapshot dedupe.
4. **GET also shape-guards** the stored JSON (beyond parse check) → 410 for corrupt/legacy rows.
5. Note for integrator: dev server had to be started manually (`nohup bun run dev`) as it was down; it is running now on :3000. `/images/hero.png` was AI-generated for the WebGL fallback.

## Blocked / handoff
- Nothing blocking. Integration step should visually verify: orbit gestures, rim-style switch, ride-height lift, accessory toggles, share-link round-trip, and quote submission once `POST /api/service-requests` lands from the parallel agent (my client handles its 401 and reads refCode defensively).
