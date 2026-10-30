/**
 * CARMAZE official brand asset pipeline.
 * Source of truth: public/brand/carmaze-logo.png (founders' approved emblem — DO NOT redesign).
 * Generates optimised, correctly sized variants for header, favicon, PWA and OG use.
 * Run: bun scripts/build-brand.ts
 */
import sharp from 'sharp'
import path from 'path'
import { mkdirSync } from 'fs'

const ROOT = process.cwd()
const BRAND = path.join(ROOT, 'public', 'brand')
const SRC = path.join(BRAND, 'carmaze-logo.png')

async function sized(width: number, out: string, opts: sharp.ResizeOptions = {}) {
  await sharp(SRC).resize(width, width, { fit: 'cover', ...opts }).png({ compressionLevel: 9 }).toFile(out)
  console.log('✓', path.relative(ROOT, out), `${width}x${width}`)
}

async function main() {
  mkdirSync(BRAND, { recursive: true })

  // Header / UI variants (optimised)
  await sized(512, path.join(BRAND, 'carmaze-logo-512.png'))
  await sized(256, path.join(BRAND, 'carmaze-logo-256.png'))
  await sized(128, path.join(BRAND, 'carmaze-logo-128.png'))
  await sized(96, path.join(BRAND, 'carmaze-logo-96.png'))
  await sized(64, path.join(BRAND, 'carmaze-logo-64.png'))

  // PWA / favicon / apple touch icons — the circular emblem on its dark tile
  await sized(512, path.join(ROOT, 'public', 'icon-512.png'))
  await sized(192, path.join(ROOT, 'public', 'icon-192.png'))
  await sized(180, path.join(ROOT, 'public', 'apple-touch-icon.png'))
  await sized(32, path.join(ROOT, 'public', 'favicon-32.png'))
  await sized(16, path.join(ROOT, 'public', 'favicon-16.png'))

  // Social share card 1200x630 — emblem centred on brand charcoal
  const W = 1200, H = 630, logo = 420
  const emblem = await sharp(SRC).resize(logo, logo).png().toBuffer()
  await sharp({
    create: { width: W, height: H, channels: 4, background: { r: 20, g: 24, b: 22, alpha: 1 } },
  })
    .composite([
      { input: emblem, left: Math.round((W - logo) / 2), top: Math.round((H - logo) / 2) },
    ])
    .png({ compressionLevel: 9 })
    .toFile(path.join(BRAND, 'carmaze-og.png'))
  console.log('✓ public/brand/carmaze-og.png 1200x630')

  console.log('Brand assets generated from the official CARMAZE emblem.')
}

main().catch((e) => { console.error(e); process.exit(1) })
