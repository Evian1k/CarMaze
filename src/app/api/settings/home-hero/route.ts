import { db } from '@/lib/db'
import { route, ok } from '@/lib/api'

/**
 * GET /api/settings/home-hero — public.
 *
 * Returns the optional homepage hero configuration stored in SystemSetting
 * key "home_hero" (JSON: { headline, subheadline, ctaLabel?, ctaHref? }),
 * written by admins via PUT /api/admin/settings. When nothing (valid) is
 * stored, `hero` is null and the homepage falls back to its built-in copy.
 * A corrupt stored value degrades to null — it must never crash the homepage.
 */
export const GET = route(async () => {
  const row = await db.systemSetting.findUnique({ where: { key: 'home_hero' } })
  if (!row) return ok({ hero: null })

  try {
    const parsed = JSON.parse(row.value) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as { headline?: unknown }).headline === 'string' &&
      (parsed as { headline: string }).headline.trim().length > 0 &&
      typeof (parsed as { subheadline?: unknown }).subheadline === 'string' &&
      (parsed as { subheadline: string }).subheadline.trim().length > 0
    ) {
      const hero = parsed as { headline: string; subheadline: string; ctaLabel?: string; ctaHref?: string }
      return ok({
        hero: {
          headline: hero.headline.trim(),
          subheadline: hero.subheadline.trim(),
          ctaLabel: typeof hero.ctaLabel === 'string' && hero.ctaLabel.trim() ? hero.ctaLabel.trim() : undefined,
          ctaHref: typeof hero.ctaHref === 'string' && hero.ctaHref.trim() ? hero.ctaHref.trim() : undefined,
        },
      })
    }
  } catch {
    // stored value was not valid JSON — treat as unconfigured
  }

  return ok({ hero: null })
})
