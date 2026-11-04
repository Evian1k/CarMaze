# Task 8-a — Automotive Supply Network (public marketplace view)

Agent: A (Task ID 8-a). Status: COMPLETE.

## Files created (all new; zero existing files modified)
- `src/views/supply/index.tsx` — default export `SupplyView` (mode router + landing: hero/stat chips, fitment finder, tabs)
- `src/components/supply/shared.tsx` — route-faithful API types, `useDebounced`, `Stars`, `VerifiedBadge`, `VerifiedTick`, `SupplierAvatar` (initials fallback), `FitBadge`, `FitHint`, `StockStatus`, `COMMON_MAKES`, condition/price-reason label maps
- `src/components/supply/saved-store.ts` — zustand `useSavedSupply` (hydrate/reset/toggle, optimistic with revert, 401 → `navigate('signin')`)
- `src/components/supply/product-card.tsx` — `ProductCard`, `FitmentRow`, `addProductToCart()` / `cartItemFromProduct()` cart-line builders
- `src/components/supply/product-catalogue.tsx` — `ProductCatalogue` (debounced search, category tree select, condition, in-stock switch, sort, Prev/Next pagination, stale-while-revalidate keyed loading; reusable with `fixedSupplierId` for storefronts)
- `src/components/supply/fitment-finder.tsx` — `FitmentFinder` (make datalist/model/year → `/api/supply/fitment`, honest MATCH/POSSIBLE/NO_FITMENT badges + API summary note verbatim)
- `src/components/supply/supplier-directory.tsx` — `SupplierDirectory` + `SupplierDirectorySkeleton` (search, county derived from results, cards, Show more)
- `src/components/supply/become-supplier-dialog.tsx` — `BecomeSupplierDialog` (full application form, document uploads via `/api/upload`, consent, success screen with API message + refCode; signed-out users redirected to `signin?mode=register` via effect gate)
- `src/components/supply/product-detail.tsx` — `ProductDetail` (gallery+thumbs, wholesale-aware qty stepper with unlock hint/savings, per-warehouse availability, spec table, compatibility table with verified ticks or honest empty state, vehicleMakes chips, price history, reviews + authed review form, supplier card with contact only when verified, isOwner alert)
- `src/components/supply/supplier-storefront.tsx` — `SupplierStorefront` (cover hero, verified badge/rating, hours grid, branches with delivery-area chips, policies, category/brand chip filters driving a server-filtered product grid, org reviews, save button)

## Features implemented (spec coverage)
- Landing `/supply`: hero (title, one-liner, live stat chips from real API totals: suppliers/parts/counties/branch-level stock), `FitmentFinder` always visible, Tabs [Parts catalogue | Verified suppliers] (`?tab=suppliers` deep link).
- Catalogue: all specified filters + sort + pagination; product card has image w/ initials→Package fallback, brand+SKU, price, "Wholesale from X (min qty N)" note, supplier row + verified tick (only when `supplier.verified`), "Authenticity verified" BadgeCheck only when `authenticityVerified`, stock status, Add to cart (qty 1, toast), bookmark toggle, featured badge.
- Fitment finder: exact honest verdicts (green MATCH "Fits your vehicle", gold POSSIBLE "Brand-level match — confirm fitment", neutral NO_FITMENT "No fitment record — verify before purchase"), API `summary.note` shown verbatim, recorded-fitment line, show-all expansion.
- Directory: supplier cards with logo/initials, ShieldCheck verified badge rendered ONLY when `verified` is true, stars, product/branch/review counts, member since, View storefront; counties derived from loaded results; "Become a supplier" gold CTA in both hero and directory.
- Become a supplier: dialog form per spec (org name, reg no, county select, town, address, phone, email, representative, categories CSV, description, consent checkbox), file input → `POST /api/upload` FormData (`file` field) → documents chips (max 8, removable), POST `/api/suppliers`, success screen shows returned `message` + refCode verbatim ("under review — never auto-verified"), 409 APPLICATION_EXISTS toasted.
- Product detail `/supply?product=<id>`: everything in spec incl. wholesale logic ("Add N more to unlock…" / "Wholesale price unlocked at qty N — you save X"), qty capped to availableQty, tax line when `taxRatePct > 0`, provenance alert, batch/serial tracking rows, verified-vs-supplier-declared fitment ticks, price-history list, verifiedPurchase review badges, review form (409 ALREADY_REVIEWED handled) with post-review reload, back → `navigate('/supply')`.
- Storefront `/supply?supplier=<id>`: cover/logo/name+badge+rating, county/town, description, opening-hours grid (mon–sun + unknown keys), branches (name/code mono badge/kind/HQ/town/address + delivery-area chips), categories & brands chips (click-to-filter the grid via catalogue `supplier=`+`brand=`/`category=` server filters), products grid with pagination, reviews list, contact details rendered only when `verified` (API nulls them for unverified; UI re-checks), policies note, save supplier.
- Loading skeletons everywhere; errors → inline retry (+ toast where actions); empty states with CTAs; cart lines built exactly per `CartItem` shape; saved-items store hydrates for signed-in users and prompts sign-in on toggle when signed out.

## Quality
- `npx tsc --noEmit` — zero errors in my files (remaining project errors pre-exist in `examples/`, `prisma/seed-supply.ts`, `skills/`, and other agents' in-progress `procurement/*` files — untouched per instructions).
- `bunx eslint` on all 10 files — 0 errors, 0 warnings (including the strict `react-hooks/set-state-in-effect` rule: loading/error are derived from fetch keys instead of sync setState in effects; page resets happen in event handlers).
- Styles: semantic tokens only (`bg-brand-deep`, `bg-gold`, `text-gold-ink`, primary/muted/destructive…), hero uses the dark-in-both-modes brand band pattern (same as garages view), `p-4/p-6` cards, `max-h-96 overflow-y-auto scrollbar-thin` long lists, h-11 (44px) touch targets, aria labels/roles throughout, mobile-first grids.
- No test code; dev server not run (only read `dev.log` tail — compiles clean).

## API shape notes / mismatches found (verified against route handlers)
1. **`supplier.rating` vs `supplierRating`**: `/api/supply/catalogue` returns `supplier.rating`; `/api/supply/fitment` and `/api/supply/products/[id]` return `supplier.supplierRating`. Types are route-faithful; fitment/detail are normalised into the card shape before rendering.
2. **Fitment no-input response**: `GET /api/supply/fitment` without `make`/`q` returns `{ products: [], message }` — NO `summary`. UI handles both shapes.
3. **Product detail `supplier.phone/email` are NOT nulled for unverified suppliers** (unlike `/api/suppliers/[id]` which nulls them). UI gates contact rendering on `supplier.verified` to honour the platform rule.
4. **Product detail spreads raw Prisma fields** — `images/tags/vehicleMakes/provenance` are overridden with parsed JSON by the route; `compat` rows are raw Prisma (incl. `source`, `verified`, `trim`, `chassis`, `note`); `priceHistory` rows are `{id, priceMinor, reason, createdAt}`.
5. **Catalogue `inStock` filter is a stub** server-side (`stocks: { some: {} }` matches any stock row, including zero-availability rows); the card/detail stock numbers are the real `qtyOnHand − qtyReserved`. Honest stock status comes from `availableQty`, not the filter.
6. **Suppliers directory is verified-only** by design (`includePending=1` bypass exists but is not used); directory county filter is client-side over loaded pages with server-paged "Show more" (36/page) — counties derived from results per spec.
7. **Supplier apply schema**: `consent` must be literal `true`; `documents` is `{name,url}[]` max 8; success 201 returns `{ application:{refCode,status}, message, suggestedPlans }` — message shown verbatim.
8. **`/api/upload`** field name is `file`; returns `{ url: '/api/media/<name>', name }`; 8 MB cap; JPG/PNG/WebP/PDF only.
9. **`saved` DELETE** takes query params (`?targetType=&targetId=`), POST returns 201 upsert; 401 when signed out.
10. **Route registration needed (integrator)**: `#/supply` is NOT in `src/app/page.tsx` VIEWS map (do-not-modify rule honoured). Integrator should add `supply: dynamic(() => import('@/views/supply'), { ssr, loading })` and optionally a nav entry ("Supply Network") + mobile-tabbar item. Hash routes handled internally: `/supply`, `/supply?product=<id>`, `/supply?supplier=<orgId>`, `?tab=suppliers`.
