// CARMAZE 3D Customizer: configuration model, curated palettes and helpers.
// This module is the single source of truth for the CarConfig shape shared by
// the view, the 3D scene and (shape-wise) the zod validation on the API side.

export type CarFinish = 'gloss' | 'matte' | 'metallic'
export type RimStyle = 'sport' | 'classic' | 'mesh'
export type Accessory = 'none' | 'spoiler' | 'roofrack'

export type CarConfig = {
  /** body paint hex (#rrggbb) */
  paint: string
  finish: CarFinish
  rimStyle: RimStyle
  /** rim hex (#rrggbb) */
  rimColor: string
  /** 0..0.9 glass darkening */
  glassTint: number
  accessory: Accessory
  /** -0.06..0.10 visual body offset; wheels stay grounded */
  rideHeight: number
}

export const CUSTOMIZER_MODEL_ID = 'sedan-classic'

export const DEFAULT_CONFIG: CarConfig = {
  paint: '#315E4B',
  finish: 'gloss',
  rimStyle: 'sport',
  rimColor: '#C8CCCE',
  glassTint: 0.15,
  accessory: 'none',
  rideHeight: 0,
}

/** 10 curated showroom paints (brand palette first). */
export const PAINTS: { hex: string; name: string }[] = [
  { hex: '#315E4B', name: 'Deep Green' },
  { hex: '#D9B878', name: 'Champagne Gold' },
  { hex: '#202421', name: 'Charcoal' },
  { hex: '#F7F7F5', name: 'Pearl White' },
  { hex: '#B3382C', name: 'Crimson' },
  { hex: '#C8CCCE', name: 'Silver' },
  { hex: '#B0703C', name: 'Copper' },
  { hex: '#4A4F4B', name: 'Slate' },
  { hex: '#D9CDB4', name: 'Sand' },
  { hex: '#1F3D2F', name: 'Forest' },
]

/** 6 rim finishes. */
export const RIM_COLORS: { hex: string; name: string }[] = [
  { hex: '#C8CCCE', name: 'Silver' },
  { hex: '#1A1C1A', name: 'Black' },
  { hex: '#D9B878', name: 'Gold' },
  { hex: '#9A6B3F', name: 'Bronze' },
  { hex: '#F2F2EE', name: 'White' },
  { hex: '#4E5350', name: 'Gunmetal' },
]

export const FINISH_OPTIONS: { value: CarFinish; label: string }[] = [
  { value: 'gloss', label: 'Gloss' },
  { value: 'metallic', label: 'Metallic' },
  { value: 'matte', label: 'Matte' },
]

export const RIM_STYLE_OPTIONS: { value: RimStyle; label: string }[] = [
  { value: 'sport', label: 'Sport' },
  { value: 'classic', label: 'Classic' },
  { value: 'mesh', label: 'Mesh' },
]

export const ACCESSORY_OPTIONS: { value: Accessory; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'spoiler', label: 'Spoiler' },
  { value: 'roofrack', label: 'Roof rack' },
]

/** Human name for a paint hex (falls back to the hex itself). */
export function paintName(hex: string): string {
  const p = PAINTS.find((x) => x.hex.toLowerCase() === hex.toLowerCase())
  return p ? p.name : hex.toUpperCase()
}

/** Human name for a rim hex (falls back to the hex itself). */
export function rimColorName(hex: string): string {
  const r = RIM_COLORS.find((x) => x.hex.toLowerCase() === hex.toLowerCase())
  return r ? r.name : hex.toUpperCase()
}

/** Plain-language summary used for garage quote descriptions and share notes. */
export function describeConfig(c: CarConfig): string {
  const parts: string[] = [
    `Paint: ${paintName(c.paint)} (${c.finish})`,
    `${cap(RIM_STYLE_OPTIONS.find((r) => r.value === c.rimStyle)?.label ?? c.rimStyle)} rims (${rimColorName(c.rimColor).toLowerCase()})`,
  ]
  if (c.accessory === 'none') parts.push('No accessory')
  else parts.push(c.accessory === 'roofrack' ? 'Roof rack' : 'Spoiler')
  if (c.glassTint > 0.16) parts.push(`Glass tint ${Math.round(c.glassTint * 100)}%`)
  if (c.rideHeight > 0.005) parts.push(`Lifted +${c.rideHeight.toFixed(2)}`)
  else if (c.rideHeight < -0.005) parts.push(`Lowered ${c.rideHeight.toFixed(2)}`)
  else parts.push('Standard ride height')
  return parts.join(', ')
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
