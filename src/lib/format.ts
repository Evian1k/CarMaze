// Client-safe formatting helpers (no server-only imports).

export function money(amountMinor: number, currency = 'KES'): string {
  const value = amountMinor / 100
  try {
    return new Intl.NumberFormat('en-KE', {
      style: 'currency',
      currency,
      maximumFractionDigits: value % 1 === 0 ? 0 : 2,
    }).format(value)
  } catch {
    return `${currency} ${value.toLocaleString()}`
  }
}

export function compactMoney(amountMinor: number, currency = 'KES'): string {
  const value = amountMinor / 100
  if (value >= 1_000_000) return `${currency} ${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
  if (value >= 1_000) return `${currency} ${Math.round(value / 1_000)}K`
  return money(amountMinor, currency)
}

export function km(miles: number): string {
  return `${miles.toLocaleString()} km`
}

export function timeAgo(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const diff = Date.now() - d.getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function dateLabel(date: string | Date | null | undefined): string {
  if (!date) return '—'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function durationLabel(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`
  if (hours < 48) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}

export const KENYA_COUNTIES = [
  'Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Uasin Gishu', 'Kiambu', 'Machakos', 'Kajiado',
  'Nyeri', 'Meru', 'Kakamega', 'Kilifi', 'Bungoma', 'Kisii', 'Kericho', 'Trans Nzoia',
  'Laikipia', 'Nandi', 'Syokimau', 'Ngong', 'Thika', 'Eldoret', 'Naivasha', 'Other',
]

export const VEHICLE_MAKES = [
  'Toyota', 'Nissan', 'Mazda', 'Honda', 'Subaru', 'Mitsubishi', 'Mercedes-Benz', 'BMW',
  'Audi', 'Volkswagen', 'Isuzu', 'Ford', 'Suzuki', 'Land Rover', 'Hyundai', 'Kia', 'Tesla', 'Other',
]

export const BODY_TYPES = ['SUV', 'SEDAN', 'HATCHBACK', 'PICKUP', 'MINIVAN', 'COUPE', 'WAGON', 'TRUCK', 'MOTORBIKE']
export const FUEL_TYPES = ['PETROL', 'DIESEL', 'HYBRID', 'ELECTRIC']
export const TRANSMISSIONS = ['AUTOMATIC', 'MANUAL']
export const CONDITIONS = ['BRAND_NEW', 'FOREIGN_USED', 'LOCAL_USED']

export const SERVICE_CATEGORIES = [
  'GENERAL_SERVICE', 'MECHANICAL', 'ELECTRICAL', 'TYRES', 'BODYWORK', 'DETAILING',
  'MODIFICATIONS', 'AUDIO', 'INSPECTION', 'TOWING', 'ROADSIDE', 'OTHER',
] as const

export const SERVICE_CATEGORY_LABELS: Record<string, string> = {
  GENERAL_SERVICE: 'General servicing',
  MECHANICAL: 'Mechanical repairs',
  ELECTRICAL: 'Electrical diagnostics',
  TYRES: 'Tyres & wheels',
  BODYWORK: 'Bodywork & accident repair',
  DETAILING: 'Vehicle detailing',
  MODIFICATIONS: 'Modifications & upgrades',
  AUDIO: 'Audio & accessories',
  INSPECTION: 'Inspection services',
  TOWING: 'Towing',
  ROADSIDE: 'Roadside assistance',
  OTHER: 'Other services',
}

export const CONDITION_LABELS: Record<string, string> = {
  BRAND_NEW: 'Brand new',
  FOREIGN_USED: 'Foreign used',
  LOCAL_USED: 'Locally used',
}

export const VEHICLE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending review',
  PUBLISHED: 'Published',
  RESERVED: 'Reserved',
  SOLD: 'Sold',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
  EXPIRED: 'Expired',
}

export const APPLICATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under review',
  MORE_INFO_REQUIRED: 'More information required',
  RESUBMITTED: 'Resubmitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  SUSPENDED: 'Suspended',
  REVOKED: 'Revoked',
}

export function vehicleTitle(v: { make: string; model: string; year: number }): string {
  return `${v.make} ${v.model} ${v.year}`
}
