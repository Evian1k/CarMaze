// CARMAZE — Automotive Supply Network seed section.
// Called from prisma/seed.ts with the seeded base users/orgs so the demo
// ecosystem is connected end-to-end (real rows in the real database).
import { PrismaClient } from '@prisma/client'

type Db = PrismaClient

export function daysFromNow(d: number): Date {
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000)
}

export async function seedSupply(
  db: Db,
  ctx: {
    PASSWORD: string
    bcrypt: { hashSync(p: string, r: number): string }
    adminId: string
    customerId: string
    garageOrgId: string
    dealerOrgId: string
  }
) {
  console.log('Seeding Automotive Supply Network…')

  // ───────────── Product categories (full catalogue taxonomy) ─────────────
  const categoryDefs: { slug: string; name: string; parent?: string }[] = [
    { slug: 'tyres-wheels', name: 'Tyres & Wheels' },
    { slug: 'rims-accessories', name: 'Rims & Accessories' },
    { slug: 'engines-components', name: 'Engines & Components' },
    { slug: 'gearboxes-transmissions', name: 'Gearboxes & Transmissions' },
    { slug: 'brake-systems', name: 'Brake Systems' },
    { slug: 'suspension', name: 'Suspension Systems' },
    { slug: 'steering', name: 'Steering Systems' },
    { slug: 'batteries', name: 'Batteries' },
    { slug: 'electrical', name: 'Electrical Systems' },
    { slug: 'alternators-starters', name: 'Alternators & Starters' },
    { slug: 'ecu-sensors', name: 'ECUs & Sensors' },
    { slug: 'filters', name: 'Filters' },
    { slug: 'oils-lubricants', name: 'Oils & Lubricants' },
    { slug: 'coolants-fluids', name: 'Coolants & Fluids' },
    { slug: 'fuel-system', name: 'Fuel-System Components' },
    { slug: 'exhaust', name: 'Exhaust Systems' },
    { slug: 'clutches', name: 'Clutches' },
    { slug: 'radiators', name: 'Radiators & Cooling' },
    { slug: 'air-conditioning', name: 'Air-Conditioning Components' },
    { slug: 'body-parts', name: 'Body Parts' },
    { slug: 'lighting', name: 'Lighting' },
    { slug: 'paint-bodyshop', name: 'Paint & Bodywork Materials' },
    { slug: 'diagnostics', name: 'Diagnostic Scanners' },
    { slug: 'workshop-equipment', name: 'Workshop Equipment & Machinery' },
    { slug: 'tools', name: 'Hand & Power Tools' },
    { slug: 'safety', name: 'Safety Equipment' },
    { slug: 'cleaning-detailing', name: 'Cleaning & Detailing Supplies' },
    { slug: 'garage-furniture', name: 'Garage Furniture' },
    { slug: 'accessories', name: 'Automotive Accessories' },
    { slug: 'used-refurbished', name: 'Used & Refurbished Components' },
  ]
  for (const [i, c] of categoryDefs.entries()) {
    await db.productCategory.upsert({
      where: { slug: c.slug },
      create: { slug: c.slug, name: c.name, sortOrder: i },
      update: { name: c.name, sortOrder: i },
    })
  }
  const catId = (slug: string) => db.productCategory.findUnique({ where: { slug } }).then((c) => c!.id)

  // ───────────── Supplier businesses ─────────────
  const supplierUsers: Record<string, string> = {}

  async function ensureUser(email: string, name: string, role: string, phone: string) {
    const existing = await db.user.findUnique({ where: { email } })
    if (existing) return existing
    return db.user.create({
      data: {
        email, name, phone,
        passwordHash: ctx.bcrypt.hashSync(ctx.PASSWORD, 10),
        isDemo: true,
        roles: role,
        referralCode: email.split('@')[0].toUpperCase().slice(0, 8),
      },
    })
  }

  const supplierOwner1 = await ensureUser('supplier@carmaze.co.ke', 'Peter Mwangi', 'CUSTOMER,SUPPLIER_OWNER', '+254711000301')
  const supplierOwner2 = await ensureUser('tyres@carmaze.co.ke', 'Grace Achieng', 'CUSTOMER,SUPPLIER_OWNER', '+254711000302')
  const supplierOwner3 = await ensureUser('equipment@carmaze.co.ke', 'David Omondi', 'CUSTOMER,SUPPLIER_OWNER', '+254711000303')
  supplierUsers.supplier = supplierOwner1.id
  supplierUsers.tyres = supplierOwner2.id
  supplierUsers.equipment = supplierOwner3.id

  async function ensureSupplierOrg(opts: {
    name: string; regNo: string; county: string; town: string; description: string
    verified: boolean; rating: number | null; ownerId: string; ownerName: string
    specialities: string[]; risk?: number
  }) {
    let org = await db.org.findFirst({ where: { name: opts.name, type: 'SUPPLIER' } })
    if (!org) {
      org = await db.org.create({
        data: {
          type: 'SUPPLIER', name: opts.name, isDemo: true, regNo: opts.regNo, county: opts.county, town: opts.town,
          description: opts.description, verified: opts.verified, supplierRating: opts.rating,
          supplierRiskScore: opts.risk ?? 0,
          phone: '+254711000300', email: `sales@${opts.name.toLowerCase().replace(/[^a-z]+/g, '')}.co.ke`,
          specialities: JSON.stringify(opts.specialities),
          serviceAreas: JSON.stringify(['Nairobi', 'Kiambu', 'Machakos', 'Nakuru', 'Mombasa']),
          openingHours: JSON.stringify({ mon: ['08:00', '18:00'], tue: ['08:00', '18:00'], wed: ['08:00', '18:00'], thu: ['08:00', '18:00'], fri: ['08:00', '18:00'], sat: ['09:00', '14:00'], sun: null }),
          responseMinutes: 45,
        },
      })
    }
    await db.orgMember.upsert({
      where: { orgId_userId: { orgId: org.id, userId: opts.ownerId } },
      create: { orgId: org.id, userId: opts.ownerId, role: 'OWNER' },
      update: {},
    })
    return org
  }

  const partsSupplier = await ensureSupplierOrg({
    name: 'Sifa Auto Spares Ltd', regNo: 'C.123456', county: 'Nairobi', town: 'Industrial Area',
    description: 'Genuine and OEM-equivalent spare parts for Japanese and European vehicles. Authorised distributor for major filtration and brake brands with batch-traced stock.',
    verified: true, rating: 4.7, ownerId: supplierOwner1.id, ownerName: 'Peter Mwangi',
    specialities: ['Spare parts', 'Filtration', 'Brakes', 'Electrical'],
  })
  const tyreSupplier = await ensureSupplierOrg({
    name: 'Highway Tyre Distributors', regNo: 'C.234567', county: 'Nairobi', town: 'Ngong Road',
    description: 'Wholesale tyres, rims and wheel accessories. Official distribution for premium and mid-tier tyre brands with fitment support.',
    verified: true, rating: 4.5, ownerId: supplierOwner2.id, ownerName: 'Grace Achieng',
    specialities: ['Tyres', 'Rims', 'Wheel alignment'],
  })
  const equipmentSupplier = await ensureSupplierOrg({
    name: 'GaragePro Equipment Kenya', regNo: 'C.345678', county: 'Nairobi', town: 'Mombasa Road',
    description: 'Workshop machinery, diagnostic scanners, hydraulic lifts, air compressors and garage furniture for professional workshops.',
    verified: true, rating: 4.3, ownerId: supplierOwner3.id, ownerName: 'David Omondi',
    specialities: ['Workshop equipment', 'Diagnostics', 'Lifts', 'Tools'],
  })
  // A pending (unverified) supplier — demonstrates that unverified businesses never show as verified
  await ensureSupplierOrg({
    name: 'Rapid Parts East Africa', regNo: 'C.456789', county: 'Machakos', town: 'Athi River',
    description: 'Application under review — body parts and lighting importer.',
    verified: false, rating: null, ownerId: supplierOwner1.id, ownerName: 'Peter Mwangi',
    specialities: ['Body parts', 'Lighting'],
  })

  // ───────────── Warehouses ─────────────
  async function ensureBranch(orgId: string, name: string, code: string, kind: 'BRANCH' | 'WAREHOUSE', county: string, town: string, lat: number, lng: number, isPrimary = false) {
    const existing = await db.orgBranch.findUnique({ where: { orgId_code: { orgId, code } } })
    if (existing) return existing
    return db.orgBranch.create({
      data: { orgId, name, code, kind, isPrimary, county, town, lat, lng, address: `${town}, ${county}`, phone: '+254711000300', managerName: 'Store Manager', deliveryAreas: JSON.stringify(['Nairobi', 'Kiambu', 'Machakos', 'Nakuru', 'Mombasa']) },
    })
  }
  const sifaWh1 = await ensureBranch(partsSupplier.id, 'Sifa HQ Warehouse', 'SIFA-WH1', 'WAREHOUSE', 'Nairobi', 'Industrial Area', -1.2977, 36.8328, true)
  const sifaWh2 = await ensureBranch(partsSupplier.id, 'Sifa Nakuru Depot', 'SIFA-WH2', 'WAREHOUSE', 'Nakuru', 'Nakuru Town', -0.3031, 36.08)
  const hwyWh1 = await ensureBranch(tyreSupplier.id, 'Highway Central Warehouse', 'HWY-WH1', 'WAREHOUSE', 'Nairobi', 'Ngong Road', -1.3002, 36.7819, true)
  const gpWh1 = await ensureBranch(equipmentSupplier.id, 'GaragePro Main Store', 'GP-WH1', 'WAREHOUSE', 'Nairobi', 'Mombasa Road', -1.3197, 36.8247, true)

  // Garage branch (destination for demo orders)
  // Approved businesses from the base seed are marked verified — verification
  // was granted through their onboarding applications.
  await db.org.updateMany({ where: { id: ctx.garageOrgId }, data: { verified: true } })
  await db.org.updateMany({ where: { id: ctx.dealerOrgId }, data: { verified: true } })
  const garageBranch = await db.orgBranch.findFirst({ where: { orgId: ctx.garageOrgId } })
  const garageBranchId = garageBranch?.id ?? (await db.orgBranch.create({
    data: { orgId: ctx.garageOrgId, name: 'Main Workshop', code: 'PM-01', kind: 'BRANCH', isPrimary: true, county: 'Nairobi', town: 'Westlands', address: 'Rhapta Road, Westlands, Nairobi', lat: -1.2649, lng: 36.804 },
  })).id
  const dealerBranch = await db.orgBranch.findFirst({ where: { orgId: ctx.dealerOrgId } })
  if (!dealerBranch) {
    await db.orgBranch.create({ data: { orgId: ctx.dealerOrgId, name: 'Showroom HQ', code: 'NAH-01', kind: 'BRANCH', isPrimary: true, county: 'Nairobi', town: 'Mombasa Road', address: 'Mombasa Road, Nairobi', lat: -1.318, lng: 36.826 } })
  }
  await db.orgBranch.create({ data: { orgId: ctx.dealerOrgId, name: 'Karen Branch', code: 'NAH-02', kind: 'BRANCH', county: 'Nairobi', town: 'Karen', address: 'Karen Road, Nairobi', lat: -1.3197, lng: 36.7078 } }).catch(() => {})

  // ───────────── Products ─────────────
  type ProductSeed = {
    sku: string; name: string; brand: string; cat: string; price: number; wholesale?: number; wsMin?: number
    mpn?: string; oem?: string; condition?: 'NEW' | 'REFURBISHED' | 'USED'; warranty?: number; returnable?: boolean
    makes?: string[]; compat?: { make: string; model?: string; yf?: number; yt?: number; engine?: string }[]
    stock: { branch: string; qty: number; reorder?: number }[]
    batch?: boolean; serial?: boolean; authentic?: boolean; featured?: boolean
    desc: string
  }
  const productDefs: { supplier: typeof partsSupplier; wh: Record<string, string>; items: ProductSeed[] }[] = [
    {
      supplier: partsSupplier,
      wh: { 'SIFA-WH1': sifaWh1.id, 'SIFA-WH2': sifaWh2.id },
      items: [
        {
          sku: 'SIF-FLT-OIL-TY', name: 'Toyota Oil Filter (OEM-spec)', brand: 'Denso', cat: 'filters', price: 65000, wholesale: 52000, wsMin: 12,
          mpn: '90915-YZZE1', oem: '90915-YZZE1', makes: ['Toyota', 'Lexus'],
          compat: [{ make: 'Toyota', model: 'Prado', yf: 2009, yt: 2021, engine: '2.7L 2TR-FE' }, { make: 'Toyota', model: 'Harrier', yf: 2014, yt: 2020, engine: '2.0L 3ZR-FE' }, { make: 'Toyota', model: 'Vitz', yf: 2011, yt: 2019, engine: '1.0L 1KR-FE' }],
          stock: [{ branch: 'SIFA-WH1', qty: 240, reorder: 60 }, { branch: 'SIFA-WH2', qty: 80 }], batch: true, authentic: true, featured: true,
          desc: 'Genuine-spec oil filter covering popular Toyota engines. Batch-traced stock with manufacturer authorisation evidence on file.',
        },
        {
          sku: 'SIF-BRK-PAD-FR', name: 'Front Brake Pad Set — Ceramic', brand: 'Brembo', cat: 'brake-systems', price: 480000, wholesale: 410000, wsMin: 6,
          mpn: 'P85020', makes: ['Toyota', 'Nissan', 'Subaru'],
          compat: [{ make: 'Toyota', model: 'Prado', yf: 2010, yt: 2021 }, { make: 'Nissan', model: 'X-Trail', yf: 2015, yt: 2022 }, { make: 'Subaru', model: 'Forester', yf: 2013, yt: 2019 }],
          stock: [{ branch: 'SIFA-WH1', qty: 60, reorder: 15 }, { branch: 'SIFA-WH2', qty: 22 }], authentic: true,
          desc: 'Low-dust ceramic front pads for SUVs and crossovers. Fitted by leading Nairobi garages; warranty-backed.',
        },
        {
          sku: 'SIF-BAT-70AH', name: 'Heavy-Duty Battery 70Ah 12V', brand: 'Chloride Exide', cat: 'batteries', price: 1350000, wholesale: 1180000, wsMin: 4,
          mpn: 'NS70-70AH', warranty: 24, makes: ['Toyota', 'Nissan', 'Isuzu', 'Mitsubishi'],
          compat: [{ make: 'Toyota', model: 'Hilux / D-Max class', yf: 2006, yt: 2024 }, { make: 'Isuzu', model: 'D-Max', yf: 2012, yt: 2024 }],
          stock: [{ branch: 'SIFA-WH1', qty: 35, reorder: 10 }], serial: true, authentic: true,
          desc: 'Maintenance-free 70Ah battery with 24-month warranty. Serial-traced against grey imports.',
        },
        {
          sku: 'SIF-ALT-TR', name: 'Alternator 12V 90A (Rebuilt)', brand: 'Denso', cat: 'alternators-starters', price: 1450000, condition: 'REFURBISHED', warranty: 6,
          mpn: '27060-0C070', makes: ['Toyota'],
          compat: [{ make: 'Toyota', model: 'Hilux', yf: 2005, yt: 2015, engine: '2.5L/3.0L D-4D' }],
          stock: [{ branch: 'SIFA-WH1', qty: 8 }], serial: true,
          desc: 'Professionally rebuilt alternator, bench-tested at 90A. Six-month supply warranty; cores accepted.',
        },
        {
          sku: 'SIF-SNS-O2', name: 'Oxygen Sensor (Upstream)', brand: 'NTK', cat: 'ecu-sensors', price: 720000, wholesale: 640000, wsMin: 5,
          mpn: '89467-48020', warranty: 12, makes: ['Toyota', 'Lexus'],
          compat: [{ make: 'Toyota', model: 'Harrier', yf: 2014, yt: 2019, engine: '2.0L' }, { make: 'Toyota', model: 'Noah', yf: 2014, yt: 2021 }],
          stock: [{ branch: 'SIFA-WH1', qty: 26, reorder: 8 }],
          desc: 'Genuine NTK upstream O2 sensor. Plugs match OEM harness; no splicing required.',
        },
        {
          sku: 'SIF-COOL-LONG', name: 'Long-Life Coolant 4L (Pink)', brand: 'Toyota Genuine', cat: 'coolants-fluids', price: 185000, wholesale: 150000, wsMin: 12,
          mpn: '08889-80072', makes: ['Toyota', 'Lexus', 'Hino'],
          stock: [{ branch: 'SIFA-WH1', qty: 150, reorder: 40 }, { branch: 'SIFA-WH2', qty: 55 }],
          desc: 'Toyota Genuine Long Life Coolant (SLLC), pre-mixed. Protects aluminium radiators to 160,000 km.',
        },
        {
          sku: 'SIF-SUS-KIT-PR', name: 'Front Suspension Bush Kit', brand: '555', cat: 'suspension', price: 640000, wholesale: 560000, wsMin: 4,
          mpn: 'SBA-48815', makes: ['Toyota'],
          compat: [{ make: 'Toyota', model: 'Prado 120/150', yf: 2003, yt: 2021 }],
          stock: [{ branch: 'SIFA-WH1', qty: 18, reorder: 5 }],
          desc: 'Complete 555 (Sankei) front bush kit for Prado platforms — the三家 fitment reference for East African conditions.'.replace('三家', 'trusted'),
        },
        {
          sku: 'SIF-RAD-ALU-HR', name: 'Aluminium Radiator — Harrier 2.0', brand: 'Koyorad', cat: 'radiators', price: 2250000, wholesale: 1980000, wsMin: 2,
          mpn: '16400-20120', warranty: 12, makes: ['Toyota'],
          compat: [{ make: 'Toyota', model: 'Harrier', yf: 2014, yt: 2020, engine: '2.0L' }],
          stock: [{ branch: 'SIFA-WH1', qty: 6, reorder: 2 }],
          desc: 'Koyorad all-aluminium radiator, pressure-tested. Includes drain plug and mounting set.',
        },
      ],
    },
    {
      supplier: tyreSupplier,
      wh: { 'HWY-WH1': hwyWh1.id },
      items: [
        {
          sku: 'HWY-TYR-2656517', name: '265/65R17 Highway Terrain Tyre', brand: 'Bridgestone', cat: 'tyres-wheels', price: 1850000, wholesale: 1680000, wsMin: 4,
          mpn: 'DUELER-HT684II', warranty: 12, makes: ['Toyota', 'Ford', 'Mitsubishi'],
          compat: [{ make: 'Toyota', model: 'Prado', yf: 2010, yt: 2024 }, { make: 'Ford', model: 'Ranger', yf: 2012, yt: 2024 }, { make: 'Mitsubishi', model: 'L200', yf: 2015, yt: 2024 }],
          stock: [{ branch: 'HWY-WH1', qty: 64, reorder: 16 }], batch: true, authentic: true, featured: true,
          desc: 'Bridgestone Dueler H/T 684II — the fleet-standard highway terrain tyre. DOT-dated stock, batch traced.',
        },
        {
          sku: 'HWY-TYR-1956515', name: '195/65R15 Comfort Tyre', brand: 'Yokohama', cat: 'tyres-wheels', price: 820000, wholesale: 730000, wsMin: 8,
          mpn: 'BLUEARTH-ES32', makes: ['Toyota', 'Nissan', 'Mazda', 'Honda'],
          compat: [{ make: 'Toyota', model: 'Vitz', yf: 2011, yt: 2024 }, { make: 'Toyota', model: 'Axio', yf: 2012, yt: 2024 }, { make: 'Nissan', model: 'Note', yf: 2013, yt: 2024 }],
          stock: [{ branch: 'HWY-WH1', qty: 120, reorder: 30 }],
          desc: 'Yokohama BluEarth ES32 — fuel-efficient comfort tyre for saloons and hatchbacks.',
        },
        {
          sku: 'HWY-RIM-AL-17', name: '17" Alloy Wheel — 6x139.7', brand: 'Enkei', cat: 'rims-accessories', price: 2600000, wholesale: 2350000, wsMin: 4,
          mpn: 'ENK-GX17', makes: ['Toyota'],
          compat: [{ make: 'Toyota', model: 'Hilux', yf: 2016, yt: 2024 }, { make: 'Toyota', model: 'Prado', yf: 2010, yt: 2024 }],
          stock: [{ branch: 'HWY-WH1', qty: 16, reorder: 4 }], serial: true,
          desc: 'Enkei GX-series 17-inch alloy, load-rated for African roads. Sold per wheel; hub-centric rings included.',
        },
        {
          sku: 'HWY-WAL-NUTS', name: 'Wheel Nut Set (Locking)', brand: 'McGard', cat: 'rims-accessories', price: 320000,
          mpn: 'MG-24137SU', makes: ['Toyota', 'Nissan', 'Subaru'],
          stock: [{ branch: 'HWY-WH1', qty: 40, reorder: 10 }],
          desc: 'McGard locking wheel nut set with dual-hex security key. Anti-theft for alloys.',
        },
      ],
    },
    {
      supplier: equipmentSupplier,
      wh: { 'GP-WH1': gpWh1.id },
      items: [
        {
          sku: 'GPR-SCN-LAUNCH', name: 'Professional Diagnostic Scanner', brand: 'Launch', cat: 'diagnostics', price: 8900000, wholesale: 8200000, wsMin: 1,
          mpn: 'X431-PRO5', warranty: 12, serial: true, authentic: true, featured: true,
          stock: [{ branch: 'GP-WH1', qty: 7, reorder: 2 }],
          desc: 'Launch X-431 PRO5 bi-directional scanner with wide OBD coverage, actuation tests and 2-year free updates.',
        },
        {
          sku: 'GPR-LFT-4T', name: '4-Ton Two-Post Hydraulic Lift', brand: 'Torin', cat: 'workshop-equipment', price: 46500000, wholesale: 43000000, wsMin: 1,
          mpn: 'TRN-4T2P', warranty: 24, serial: true,
          stock: [{ branch: 'GP-WH1', qty: 3, reorder: 1 }],
          desc: 'Certified 4-ton two-post lift with mechanical safety locks. Installation and commissioning included within Nairobi.',
        },
        {
          sku: 'GPR-CMP-500L', name: '500L Belt-Drive Air Compressor', brand: 'ABAC', cat: 'workshop-equipment', price: 18500000, wholesale: 17000000, wsMin: 1,
          mpn: 'ABAC-500L', warranty: 12,
          stock: [{ branch: 'GP-WH1', qty: 4, reorder: 1 }],
          desc: 'ABAC 500-litre belt-drive compressor, 10 bar — runs impact guns, tyre machines and spray booths.',
        },
        {
          sku: 'GPR-TCH-MOBILE', name: 'Mobile Tyre Changer', brand: 'Corghi', cat: 'workshop-equipment', price: 24800000, wholesale: 22900000, wsMin: 1,
          mpn: 'COR-EM955', warranty: 12, serial: true,
          stock: [{ branch: 'GP-WH1', qty: 2, reorder: 1 }],
          desc: 'Corghi EM955 mobile tyre changer for 12"–26" rims. Ideal for roadside fleets and multi-bay workshops.',
        },
        {
          sku: 'GPR-TLS-DECK', name: 'Mechanic Tool Set (150 pc)', brand: 'Stanley', cat: 'tools', price: 3200000, wholesale: 2850000, wsMin: 3,
          mpn: 'STMT-82927', warranty: 12,
          stock: [{ branch: 'GP-WH1', qty: 14, reorder: 4 }],
          desc: 'Stanley 150-piece CRV mechanic set in blow-mould case — sockets, spanners, torx and hex.',
        },
        {
          sku: 'GPR-SAF-KIT', name: 'Workshop Safety Kit (PPE bundle)', brand: '3M', cat: 'safety', price: 640000, wholesale: 540000, wsMin: 10,
          mpn: '3M-PPE-K2',
          stock: [{ branch: 'GP-WH1', qty: 55, reorder: 15 }],
          desc: 'PPE bundle: respirators, cut-resistant gloves, goggles and ear defenders. KEBS-compliant markings.',
        },
      ],
    },
  ]

  const productIds: { id: string; sku: string; supplierOrgId: string; unitPriceMinor: number; name: string }[] = []
  for (const group of productDefs) {
    for (const def of group.items) {
      const exists = await db.product.findUnique({ where: { supplierOrgId_sku: { supplierOrgId: group.supplier.id, sku: def.sku } } })
      if (exists) {
        productIds.push({ id: exists.id, sku: def.sku, supplierOrgId: group.supplier.id, unitPriceMinor: exists.unitPriceMinor, name: exists.name })
        continue
      }
      const product = await db.product.create({
        data: {
          refCode: `PRD-${def.sku.replace(/[^A-Z0-9]/g, '').slice(-6)}`,
          supplierOrgId: group.supplier.id,
          categoryId: await catId(def.cat),
          name: def.name,
          sku: def.sku,
          mpn: def.mpn ?? null,
          oemRef: def.oem ?? null,
          brand: def.brand,
          description: def.desc,
          condition: def.condition ?? 'NEW',
          unitPriceMinor: def.price,
          wholesalePriceMinor: def.wholesale ?? null,
          wholesaleMinQty: def.wsMin ?? 0,
          taxRatePct: 16,
          warrantyMonths: def.warranty ?? 0,
          returnable: def.returnable ?? true,
          tags: JSON.stringify([def.brand, ...((def.makes ?? []).slice(0, 2))]),
          vehicleMakes: JSON.stringify(def.makes ?? []),
          batchTracked: def.batch ?? false,
          serialTracked: def.serial ?? false,
          provenance: JSON.stringify({ provenanceNote: 'Supplier declaration + invoice documentation on file', authenticator: def.authentic ? 'ADMIN' : null }),
          authenticityVerified: Boolean(def.authentic),
          status: 'PUBLISHED',
          featured: Boolean(def.featured),
          ratingAvg: 4 + Math.random(),
          ratingCount: Math.floor(Math.random() * 20) + 3,
          priceHistory: { create: { priceMinor: def.price, reason: 'LIST' } },
          compat: {
            create: (def.compat ?? []).map((c) => ({
              make: c.make, model: c.model ?? null, yearFrom: c.yf ?? null, yearTo: c.yt ?? null,
              engine: c.engine ?? null, source: 'SUPPLIER', verified: true,
            })),
          },
          stocks: {
            create: def.stock.map((s) => ({ branchId: group.wh[s.branch], qtyOnHand: s.qty, reorderLevel: s.reorder ?? 0 })),
          },
        },
      })
      productIds.push({ id: product.id, sku: def.sku, supplierOrgId: group.supplier.id, unitPriceMinor: def.price, name: def.name })
    }
  }

  // ───────────── Supplier subscription plans ─────────────
  for (const plan of [
    { code: 'supplier-starter', name: 'Supplier Starter', priceMinor: 149900, features: ['Up to 50 products', '1 warehouse', 'Order inbox', 'Quote requests'], staffLimit: 3 },
    { code: 'supplier-pro', name: 'Supplier Professional', priceMinor: 399900, features: ['Up to 500 products', '5 warehouses', 'Featured placement slots', 'Procurement analytics', 'Priority support'], staffLimit: 12 },
    { code: 'supplier-enterprise', name: 'Supplier Enterprise', priceMinor: 899900, features: ['Unlimited products', 'Unlimited warehouses', 'Dedicated account manager', 'API integrations', 'Bulk-order partnerships'], staffLimit: 50 },
  ]) {
    await db.plan.upsert({
      where: { code: plan.code },
      create: { code: plan.code, name: plan.name, audience: 'SUPPLIER', priceMinor: plan.priceMinor, listingLimit: 500, featuredLimit: 3, staffLimit: plan.staffLimit, features: JSON.stringify(plan.features) },
      update: {},
    })
  }

  // The flagship demo supplier runs on supplier-pro so the seeded catalogue
  // (≈18 products, 1 warehouse) sits comfortably inside the plan's real
  // entitlements ("Up to 500 products", "5 warehouses") — mirrors how the
  // demo dealer/garage orgs carry active subscriptions.
  await db.subscription.upsert({
    where: { orgId: partsSupplier.id },
    create: { orgId: partsSupplier.id, planCode: 'supplier-pro', status: 'ACTIVE', startedAt: daysFromNow(-45), currentPeriodEnd: daysFromNow(15) },
    update: {},
  })

  // ───────────── Business memberships (garage + showroom programmes) ─────────────
  const garageTierBasic = await db.membershipTier.upsert({
    where: { id: 'tier-garage-basic' },
    create: {
      id: 'tier-garage-basic',
      orgId: ctx.garageOrgId,
      name: 'Basic Care',
      description: 'Core maintenance membership for regular customers of Premium Motors Garage.',
      priceMonthlyMinor: 150000,
      priceYearlyMinor: 1500000,
      benefits: JSON.stringify(['5% monthly service discount', 'Maintenance reminders', 'Priority booking window']),
      memberLimit: 200,
      discountCapPct: 5,
      branchScope: 'ALL',
      terms: 'Membership applies at Premium Motors Garage branches. Benefits are personal and non-transferable. Cancel anytime; fees for the current period are not refunded.',
    },
    update: {},
  })
  const garageTierPlus = await db.membershipTier.upsert({
    where: { id: 'tier-garage-plus' },
    create: {
      id: 'tier-garage-plus',
      orgId: ctx.garageOrgId,
      name: 'Plus Care',
      description: 'For drivers who want priority service and bigger savings.',
      priceMonthlyMinor: 350000,
      priceYearlyMinor: 3500000,
      benefits: JSON.stringify(['12% labour discount', 'Preferred appointment access', 'Free seasonal inspection', 'Member-only promotions']),
      memberLimit: 120,
      discountCapPct: 12,
      branchScope: 'ALL',
      terms: 'Labour discount applies to qualifying services; parts excluded. Free inspection once per membership year.',
    },
    update: {},
  })
  await db.membershipTier.upsert({
    where: { id: 'tier-dealer-basic' },
    create: {
      id: 'tier-dealer-basic',
      orgId: ctx.dealerOrgId,
      name: 'Insider Alerts',
      description: 'Nairobi Auto Hub insiders get first look at incoming units.',
      priceMonthlyMinor: 99000,
      priceYearlyMinor: 990000,
      benefits: JSON.stringify(['New vehicle alerts before listing', 'Priority test-drive bookings', 'Exclusive offers']),
      memberLimit: 500,
      discountCapPct: 0,
      branchScope: 'ALL',
      terms: 'Alerts are informational. Test-drive priority is subject to vehicle availability at participating branches.',
    },
    update: {},
  })

  // An active demo membership (invoice paid) for the customer
  const existingMembership = await db.businessMembership.findFirst({ where: { customerId: ctx.customerId, orgId: ctx.garageOrgId } })
  if (!existingMembership) {
    const memInvoice = await db.invoice.create({
      data: {
        refCode: 'INV-MEM01', orgId: ctx.garageOrgId, userId: ctx.customerId, type: 'MEMBERSHIP',
        description: `Plus Care membership (monthly) — Premium Motors Garage [membership:seed-mem]`,
        amountMinor: garageTierPlus.priceMonthlyMinor, status: 'PAID', paidAt: daysFromNow(-10), paidVia: 'MPESA',
        periodStart: daysFromNow(-10), periodEnd: daysFromNow(20), dueDate: daysFromNow(-10),
      },
    })
    // create real membership row then point invoice marker at it
    const mem = await db.businessMembership.create({
      data: {
        refCode: 'MEM-DEMO01', tierId: garageTierPlus.id, orgId: ctx.garageOrgId, customerId: ctx.customerId,
        billingPeriod: 'MONTHLY', status: 'ACTIVE', startedAt: daysFromNow(-10), currentPeriodEnd: daysFromNow(20), invoiceId: memInvoice.id,
      },
    })
    await db.invoice.update({ where: { id: memInvoice.id }, data: { description: memInvoice.description.replace('[membership:seed-mem]', `[membership:${mem.id}]`) } })
    await db.membershipRedemption.create({
      data: { membershipId: mem.id, benefit: 'Preferred appointment access', periodKey: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`, refType: 'BOOKING' },
    }).catch(() => {})
  }

  // ───────────── Trust programme (garage, private) ─────────────
  const existingTrust = await db.trustProgramme.findUnique({ where: { orgId: ctx.garageOrgId } })
  if (!existingTrust) {
    const programme = await db.trustProgramme.create({
      data: {
        orgId: ctx.garageOrgId,
        name: 'Premium Motors Trusted Customers',
        description: 'Invitation-only programme for our long-standing customers.',
        terms: 'Trusted status is an internal relationship label managed by Premium Motors Garage. It is not a credit rating and is not shared with other businesses. Benefits are set by the garage and may change with notice.',
      },
    })
    await db.trustMember.create({
      data: { programmeId: programme.id, customerId: ctx.customerId, label: 'PREFERRED', invitedById: ctx.adminId, approvedAt: daysFromNow(-30), termsAcceptedAt: daysFromNow(-29), note: 'Regular customer since 2023; always collects on time.' },
    })
  }

  // ───────────── Demo credit facility (garage-issued, active) ─────────────
  const existingFacility = await db.creditFacility.findUnique({ where: { orgId_customerId: { orgId: ctx.garageOrgId, customerId: ctx.customerId } } })
  if (!existingFacility) {
    const facility = await db.creditFacility.create({
      data: {
        refCode: 'CRD-DEMO01', orgId: ctx.garageOrgId, customerId: ctx.customerId,
        limitMinor: 1500000, depositMinor: 0, status: 'ACTIVE',
        terms: 'Service credit up to KES 15,000. Repay within 30 days of each charge. The facility is issued and managed by Premium Motors Garage; CARMAZE provides the record-keeping technology only and is not a lender.',
        approvedAt: daysFromNow(-21), termsAcceptedAt: daysFromNow(-20),
      },
    })
    await db.creditEntry.create({ data: { facilityId: facility.id, kind: 'CHARGE', amountMinor: 850000, balanceAfterMinor: 850000, refType: 'SERVICE', dueDate: daysFromNow(9), note: 'Full service — Toyota Harrier', actorName: 'Premium Motors Garage' } })
    await db.creditEntry.create({ data: { facilityId: facility.id, kind: 'REPAYMENT', amountMinor: -400000, balanceAfterMinor: 450000, paidAt: daysFromNow(-5), note: 'Part payment via M-Pesa', actorName: 'Customer' } })
  }

  // ───────────── Demo purchase order (SUBMITTED — awaiting supplier) ─────────────
  const existingPO = await db.purchaseOrder.findUnique({ where: { refCode: 'PO-DEMO01' } })
  if (!existingPO) {
    const oilFilter = productIds.find((p) => p.sku === 'SIF-FLT-OIL-TY')!
    const brakePads = productIds.find((p) => p.sku === 'SIF-BRK-PAD-FR')!
    const garageUser = await db.orgMember.findFirst({ where: { orgId: ctx.garageOrgId, role: 'OWNER' } })
    const subtotal = 65000 * 24 + 480000 * 2
    await db.purchaseOrder.create({
      data: {
        refCode: 'PO-DEMO01',
        garageOrgId: ctx.garageOrgId,
        supplierOrgId: partsSupplier.id,
        destinationBranchId: garageBranchId,
        createdById: garageUser!.userId,
        status: 'SUBMITTED',
        subtotalMinor: subtotal,
        taxMinor: Math.round(subtotal * 0.16),
        totalMinor: subtotal + Math.round(subtotal * 0.16),
        items: {
          create: [
            { productId: oilFilter.id, qty: 24, unitPriceMinor: 52000, lineTotalMinor: 52000 * 24, fulfilBranchId: sifaWh1.id },
            { productId: brakePads.id, qty: 2, unitPriceMinor: 480000, lineTotalMinor: 960000 },
          ],
        },
        events: { create: { type: 'CREATED', actorId: garageUser!.userId, actorName: 'Premium Motors Garage', actorSide: 'GARAGE', note: 'Wholesale replenishment order — filters and pads.' } },
      },
    })
  }

  // Platform fee configuration (admin-editable)
  await db.systemSetting.upsert({
    where: { key: 'platform_fees' },
    create: { key: 'platform_fees', value: JSON.stringify({ supplyCommissionPct: 3, deliveryCommissionPct: 5, minCommissionMinor: 5000, vehicleSaleCommissionPct: 1.5, bookingCommissionPct: 2, membershipPlatformFeePct: 5 }) },
    update: {},
  })

  console.log('Supply network seeded:', productIds.length, 'products, 4 supplier orgs, memberships + credit demo data.')
  return { productIds, partsSupplierId: partsSupplier.id }
}
