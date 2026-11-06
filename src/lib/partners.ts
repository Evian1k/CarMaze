// CARMAZE Partner Network: shared, client-safe constants and parsers.
// Single source of truth used by the public directory, the application form
// and staff tooling so labels and parsing never drift apart.

export const PARTNER_CATEGORY_VALUES = [
  'INSPECTION',
  'INSURANCE',
  'FINANCE',
  'TOWING',
  'PARTS',
  'TRANSPORT',
  'OTHER',
] as const

export type PartnerCategory = (typeof PARTNER_CATEGORY_VALUES)[number]

export const PARTNER_CATEGORIES: { value: PartnerCategory; label: string }[] = [
  { value: 'INSPECTION', label: 'Vehicle Inspection' },
  { value: 'INSURANCE', label: 'Insurance' },
  { value: 'FINANCE', label: 'Vehicle Finance' },
  { value: 'TOWING', label: 'Towing' },
  { value: 'PARTS', label: 'Parts Suppliers' },
  { value: 'TRANSPORT', label: 'Vehicle Transport' },
  { value: 'OTHER', label: 'Other' },
]

export function partnerCategoryLabel(value: string): string {
  return PARTNER_CATEGORIES.find((c) => c.value === value)?.label ?? value
}

export const PARTNER_STATUSES = ['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED'] as const

export type PartnerStatus = (typeof PARTNER_STATUSES)[number]

/** Parse the JSON string[] stored in Partner.serviceAreas: never throws. */
export function parseServiceAreas(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  } catch {
    return []
  }
}

/** Staff notes are stored as a JSON array [{by, at, text}]: parse defensively. */
export function parsePartnerNotes(
  raw: string | null | undefined,
): { by: string; at: string; text: string }[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (n): n is { by: string; at: string; text: string } =>
        typeof n === 'object' && n !== null && typeof (n as { text?: unknown }).text === 'string',
    )
  } catch {
    return []
  }
}

/** Append a staff note (actor name + ISO timestamp) to the JSON notes array. */
export function appendPartnerNote(
  raw: string | null | undefined,
  by: string,
  text: string,
  at = new Date().toISOString(),
): string {
  const list = parsePartnerNotes(raw)
  list.push({ by, at, text })
  return JSON.stringify(list)
}

/** Kenya-focused WhatsApp deep link from a stored business phone number.
 * Local 07xx… numbers are normalised to the 254 international format. */
export function whatsappLink(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  const intl = digits.startsWith('0') ? `254${digits.slice(1)}` : digits
  return `https://wa.me/${intl}`
}
