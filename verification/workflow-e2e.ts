/**
 * TASK 4 — REAL-USER WORKFLOW E2E (no demo accounts).
 *
 * Registers 5 fresh accounts + uses the seeded real ADMIN (not a demo session)
 * and walks every major production workflow end-to-end:
 *   1. showroom (DEALER) application → document verification → approval → org
 *   2. garage (GARAGE) application → approval → org
 *   3. supplier application → admin approval → verify-supplier
 *   4. logistics application → approval → LogisticsPartner + fleet driver
 *   5. vehicle submission → moderation → publication (searchable)
 *   6. customer enquiry → business response → close
 *   7. garage service request → quote → accept → booking lifecycle
 *   8. vehicle custody → receive → work → ready → collection-auth → collect
 *   9. consumer parts order → accept → dispatch (OTP) → delivered → complete
 *  10. B2B purchase order → accept → arrange → pay (honest 503) → admin
 *      reconcile → dispatch → handover (OTP) → inspect → release → settlement
 *  11. logistics delivery job → accept → pickup → transit → deliver (QR/OTP)
 *  12. role-based restrictions (woven negatives at each step)
 *
 * Runs against the DEV server + dev DB (seeded categories/admin). All business
 * entities are created by freshly registered accounts — no demo actor anywhere.
 * Usage: bun verification/workflow-e2e.ts
 */
const BASE = 'http://localhost:3000'
const ADMIN = { email: 'admin@carmaze.co.ke', password: 'CarmazeDemo2025!' }

type Jar = Record<string, string>
let pass = 0, fail = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (ok) pass++; else { fail++; failures.push(name) }
}
function cookieHeader(jar: Jar): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
}
function capture(jar: Jar, r: Response) {
  const sc = r.headers.get('set-cookie')
  if (sc) {
    const [pair] = sc.split(';')
    const [k, ...rest] = pair.split('=')
    jar[k.trim()] = rest.join('=')
  }
}
async function req(method: string, path: string, jar: Jar, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(Object.keys(jar).length ? { Cookie: cookieHeader(jar) } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json: any = null
  try { json = await res.json() } catch { /* ignore */ }
  return { status: res.status, json }
}
async function upload(jar: Jar, bytes: Uint8Array, filename: string, type: string, kind: string): Promise<{ status: number; json: any }> {
  const fd = new FormData()
  fd.set('file', new Blob([new Uint8Array(bytes)], { type }), filename)
  fd.set('kind', kind)
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: { Cookie: cookieHeader(jar) }, body: fd })
  let json: any = null
  try { json = await res.json() } catch { /* ignore */ }
  return { status: res.status, json }
}
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj\nworkflow e2e test document')

const stamp = Date.now()
async function newSession(name: string): Promise<Jar> {
  const jar: Jar = {}
  const email = `wf.${name}.${stamp}@test.local`
  const password = `Wf${name}2025!x`
  let r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `WF ${name}`, email, password }),
  })
  capture(jar, r)
  if (r.status !== 200 && r.status !== 201) {
    r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    capture(jar, r)
  }
  if (r.status !== 200 && r.status !== 201) throw new Error(`register ${name} failed: ${r.status}`)
  return jar
}
const arr = (v: any): any[] => {
  if (Array.isArray(v)) return v
  for (const key of ['items', 'documents', 'notifications', 'memberships', 'vehicles', 'orders', 'bookings', 'branches']) {
    if (Array.isArray(v?.[key])) return v[key]
  }
  return []
}
const orgsOf = (v: any) => arr(v).map((m: any) => m?.org ?? m).filter((o: any) => o?.id)

async function applyOrg(jar: Jar, type: string, orgName: string, extra: Record<string, unknown>, withDocs: boolean): Promise<{ id: string | null; status: number; json: any; urls: string[] }> {
  const documents: Array<{ name: string; url: string }> = []
  if (withDocs) {
    for (const f of ['lic', 'pin']) {
      const up = await upload(jar, PDF, `${type.toLowerCase()}-${f}.pdf`, 'application/pdf', 'document')
      if (up.status === 201 && up.json?.url) documents.push({ name: `${f}.pdf`, url: up.json.url })
    }
  }
  const payload = {
    type, orgName, county: 'Nairobi', town: 'Westlands', physicalAddress: 'Test Address Lane',
    phone: '0712345678', representative: 'WF Representative', categories: 'GENERAL_SERVICE,TYRES',
    accountType: 'COMPANY', consent: true, notes: 'workflow e2e', ...extra,
    ...(documents.length ? { documents } : {}),
  }
  const r = await req('POST', '/api/applications', jar, payload)
  const echoed: string[] = ((r.json?.documents ?? []) as any[]).map((d) => (typeof d === 'string' ? d : d?.url)).filter((u: any) => typeof u === 'string')
  return { id: r.json?.id ?? r.json?.application?.id ?? null, status: r.status, json: r.json, urls: echoed.length ? echoed : documents.map((d) => d.url) }
}

async function verifyAppDocs(admin: Jar, fileUrls: string[]): Promise<boolean> {
  // Staff review queue — the default scope=mine would return the admin's OWN docs.
  const list = await req('GET', '/api/documents?scope=queue', admin)
  const basenames = fileUrls.map((u) => u.split('/').pop() ?? '@')
  const docs = arr(list.json).filter((d: any) => {
    const fn = String(d.fileName ?? '')
    const fu = String(d.fileUrl ?? d.url ?? '')
    return basenames.some((b) => fn.includes(b) || fu.includes(b))
  })
  let ok = docs.length > 0
  for (const d of docs) {
    let r = await req('PATCH', `/api/documents/${d.id}`, admin, { action: 'start_review' })
    if (r.status >= 400) {
      // some states allow direct verify
      r = await req('PATCH', `/api/documents/${d.id}`, admin, { action: 'verify' })
    } else {
      r = await req('PATCH', `/api/documents/${d.id}`, admin, { action: 'verify' })
    }
    if (r.status >= 400) { ok = false; console.log(`      doc ${d.id} verify → ${r.status} ${r.json?.error ?? ''}`) }
  }
  if (!ok) console.log(`      matched ${docs.length} docs of ${basenames.length} uploads (queue size ${arr(list.json).length})`)
  return ok
}

async function main() {
  console.log('═══ REAL-USER WORKFLOW E2E ═══')

  // 0. sessions
  const customer = await newSession('customer')
  const dealerOwner = await newSession('dealer')
  const garageOwner = await newSession('garage')
  const supplierOwner = await newSession('supplier')
  const logisticsOwner = await newSession('logistics')
  const admin: Jar = {}
  {
    const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ADMIN) })
    capture(admin, r)
    if (r.status !== 200) throw new Error('admin login failed')
  }
  check('6 sessions established (5 fresh + admin)', true)

  // ── 1. SHOWROOM (DEALER) application ──
  console.log('── 1. Showroom application → verification → approval ──')
  const dApp = await applyOrg(dealerOwner, 'DEALER', 'WF Showroom Ltd', {}, true)
  check('dealer application submitted', dApp.status === 200 || dApp.status === 201, `status ${dApp.status} ${dApp.json?.error ?? ''}`)
  const dDocsOk = dApp.urls.length ? await verifyAppDocs(admin, dApp.urls) : false
  check('staff verified the dealer documents', dDocsOk, `docs=${dApp.urls.length}`)
  let r = await req('PATCH', `/api/applications/${dApp.id}`, admin, { action: 'approve', decisionNote: 'workflow e2e approval' })
  check('dealer application approved', r.status === 200, `status ${r.status} ${r.json?.error ?? ''}`)
  const meDealer = await req('GET', '/api/auth/me', dealerOwner)
  check('applicant now holds DEALER_OWNER', (meDealer.json?.user?.roles ?? []).includes('DEALER_OWNER'), `roles=${(meDealer.json?.user?.roles ?? []).join(',')}`)

  // negative: a plain customer cannot approve applications
  const negApply = await req('PATCH', `/api/applications/${dApp.id}`, customer, { action: 'approve', decisionNote: 'sneaky approve' })
  check('ordinary customer cannot approve applications', negApply.status === 403 || negApply.status === 404, `status ${negApply.status}`)

  // ── 2. GARAGE application ──
  console.log('── 2. Garage application → approval ──')
  const gApp = await applyOrg(garageOwner, 'GARAGE', 'WF Garage Works', {}, true)
  check('garage application submitted', gApp.status === 200 || gApp.status === 201, `status ${gApp.status} ${gApp.json?.error ?? ''}`)
  await verifyAppDocs(admin, gApp.urls)
  r = await req('PATCH', `/api/applications/${gApp.id}`, admin, { action: 'approve', decisionNote: 'workflow e2e approval' })
  check('garage application approved', r.status === 200, `status ${r.status} ${r.json?.error ?? ''}`)
  const meGarage = await req('GET', '/api/auth/me', garageOwner)
  check('applicant now holds GARAGE_OWNER', (meGarage.json?.user?.roles ?? []).includes('GARAGE_OWNER'), `roles=${(meGarage.json?.user?.roles ?? []).join(',')}`)
  const gOrgs = await req('GET', '/api/orgs/me', garageOwner)
  const garageOrgId: string | undefined = orgsOf(gOrgs.json).find((o: any) => o.type === 'GARAGE')?.id ?? orgsOf(gOrgs.json)[0]?.id
  check('garage org created and active', Boolean(garageOrgId), `orgId=${garageOrgId ?? 'none'}`)

  // ── 3. SUPPLIER application ──
  console.log('── 3. Supplier application → admin approval → verified ──')
  const sUp = await upload(supplierOwner, PDF, 'supplier-reg.pdf', 'application/pdf', 'document')
  const sApp = await req('POST', '/api/suppliers', supplierOwner, {
    orgName: 'WF Auto Spares', regNo: 'C.987654', county: 'Nairobi', town: 'Industrial Area',
    physicalAddress: 'Parts Road 12', phone: '0723456789', email: '', representative: 'WF Representative',
    categories: 'BRAKES,FILTERS', description: 'workflow e2e supplier', documents: sUp.status === 201 && sUp.json?.url ? [{ name: 'reg.pdf', url: sUp.json.url }] : [], consent: true,
  })
  const sAppId = sApp.json?.id ?? sApp.json?.application?.id ?? null
  check('supplier application submitted', sApp.status === 200 || sApp.status === 201, `status ${sApp.status} ${sApp.json?.error ?? ''}`)
  r = await req('POST', '/api/admin/supply', admin, { action: 'approve-application', applicationId: sAppId, note: 'workflow e2e' })
  check('supplier application approved by admin', r.status === 200, `status ${r.status} ${r.json?.error ?? ''}`)
  const sOrgs = await req('GET', '/api/orgs/me', supplierOwner)
  const supplierOrgId: string | undefined = orgsOf(sOrgs.json).find((o: any) => o.type === 'SUPPLIER')?.id ?? orgsOf(sOrgs.json)[0]?.id
  check('supplier org created', Boolean(supplierOrgId), `orgId=${supplierOrgId ?? 'none'}`)
  if (supplierOrgId) {
    r = await req('POST', '/api/admin/supply', admin, { action: 'verify-supplier', orgId: supplierOrgId, note: 'workflow e2e' })
    check('supplier verified (publicly sellable)', r.status === 200 || r.json?.error === 'ALREADY_VERIFIED', `status ${r.status} ${r.json?.error ?? ''}`)
  }
  const meSupplier = await req('GET', '/api/auth/me', supplierOwner)
  check('applicant now holds SUPPLIER_OWNER', (meSupplier.json?.user?.roles ?? []).includes('SUPPLIER_OWNER'), `roles=${(meSupplier.json?.user?.roles ?? []).join(',')}`)

  // ── 4. LOGISTICS application ──
  console.log('── 4. Logistics application → approval → fleet driver ──')
  const lApp = await applyOrg(logisticsOwner, 'LOGISTICS', 'WF Movers Ltd', {}, true)
  check('logistics application submitted', lApp.status === 200 || lApp.status === 201, `status ${lApp.status} ${lApp.json?.error ?? ''}`)
  await verifyAppDocs(admin, lApp.urls)
  r = await req('PATCH', `/api/applications/${lApp.id}`, admin, { action: 'approve', decisionNote: 'workflow e2e approval' })
  check('logistics application approved', r.status === 200, `status ${r.status} ${r.json?.error ?? ''}`)
  const meLog = await req('GET', '/api/auth/me', logisticsOwner)
  check('applicant now holds LOGISTICS_OWNER', (meLog.json?.user?.roles ?? []).includes('LOGISTICS_OWNER'), `roles=${(meLog.json?.user?.roles ?? []).join(',')}`)
  const drv = await req('POST', '/api/logistics/fleet', logisticsOwner, { name: 'WF Driver', phone: '0734567890', vehicleReg: 'KDA 001W', vehicleType: '' })
  check('partner added a fleet driver', drv.status === 200 || drv.status === 201, `status ${drv.status} ${drv.json?.error ?? ''}`)
  const driverId: string | undefined = drv.json?.driver?.id ?? drv.json?.id ?? arr(drv.json)[0]?.id

  // ── 5. VEHICLE submission → moderation → publication ──
  console.log('── 5. Vehicle listing: submit → moderate → publish ──')
  const dealerOrgs = await req('GET', '/api/orgs/me', dealerOwner)
  const dealerOrgId: string | undefined = orgsOf(dealerOrgs.json).find((o: any) => o.type === 'DEALER')?.id ?? orgsOf(dealerOrgs.json)[0]?.id
  const imgUp = await upload(dealerOwner, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), 'car.png', 'image/png', 'image')
  const vCreate = await req('POST', '/api/vehicles', dealerOwner, {
    make: 'Toyota', model: 'Harrier', year: 2018, priceMinor: 425000000, mileageKm: 88000,
    fuel: 'PETROL', transmission: 'AUTOMATIC', bodyType: 'SUV', condition: 'FOREIGN_USED',
    county: 'Nairobi', town: 'Westlands', color: 'Pearl White', engineCc: 2500,
    description: 'Workflow E2E vehicle: well maintained Toyota Harrier with full service history.',
    photos: imgUp.status === 201 && imgUp.json?.url ? [imgUp.json.url] : [],
    status: 'PENDING_REVIEW', ...(dealerOrgId ? { orgId: dealerOrgId } : {}),
  })
  const vehicleId: string | undefined = vCreate.json?.id ?? vCreate.json?.vehicle?.id
  check('dealer submitted vehicle for review', vCreate.status === 200 || vCreate.status === 201, `status ${vCreate.status} ${vCreate.json?.error ?? ''}`)
  const negMod = await req('PATCH', '/api/admin/listings', customer, { id: vehicleId, action: 'approve' })
  check('customer cannot moderate listings', negMod.status === 403, `status ${negMod.status}`)
  r = await req('PATCH', '/api/admin/listings', admin, { id: vehicleId, action: 'approve', note: '' })
  check('moderator approved the listing', r.status === 200, `status ${r.status} ${r.json?.error ?? ''}`)
  const pub = await req('GET', `/api/vehicles?q=Harrier`, customer)
  const published = arr(pub.json).find((v: any) => v.id === vehicleId)
  check('approved vehicle is publicly searchable', Boolean(published), `status ${pub.status} found=${Boolean(published)}`)

  // ── 6. ENQUIRY ──
  console.log('── 6. Enquiry → business response → close ──')
  const enq = await req('POST', '/api/enquiries', customer, { vehicleId, message: 'Is this Harrier still available, and can I view it this weekend?', phoneShare: false })
  const enquiryId: string | undefined = enq.json?.id ?? enq.json?.enquiry?.id
  check('customer enquiry created (OPEN)', enq.status === 200 || enq.status === 201, `status ${enq.status} ${enq.json?.error ?? ''}`)
  const enqReply = await req('POST', `/api/enquiries/${enquiryId}`, dealerOwner, { body: 'Yes — the car is available. Weekend viewings welcome.' })
  check('dealership replied on the enquiry thread', enqReply.status === 200 || enqReply.status === 201, `status ${enqReply.status} ${enqReply.json?.error ?? ''}`)
  const enqRead = await req('GET', `/api/enquiries/${enquiryId}`, customer)
  check('enquiry status ANSWERED after seller reply', enqRead.json?.enquiry?.status === 'ANSWERED' || enqRead.json?.status === 'ANSWERED', `status=${enqRead.json?.enquiry?.status ?? enqRead.json?.status}`)
  const negThread = await req('GET', `/api/enquiries/${enquiryId}`, garageOwner)
  check('unrelated user cannot read the enquiry thread', negThread.status === 403 || negThread.status === 404, `status ${negThread.status}`)
  await req('PATCH', `/api/enquiries/${enquiryId}`, customer, { status: 'CLOSED' })

  // ── 7. GARAGE SERVICE → QUOTE → BOOKING ──
  console.log('── 7. Garage quotation and customer approval ──')
  const svc = await req('POST', '/api/garage-services', garageOwner, { orgId: garageOrgId, category: 'TYRES', title: 'Tyre replacement and alignment', description: 'Full tyre service including computerised alignment.', priceFromMinor: 1200000 })
  check('garage published a service offer', svc.status === 200 || svc.status === 201, `status ${svc.status} ${svc.json?.error ?? ''}`)
  const myVeh = await req('POST', '/api/mygarage/vehicles', customer, { make: 'Toyota', model: 'Vitz', year: 2019, mileageKm: 45000, plate: 'KCA 700X', nickname: 'Daily' })
  const myVehicleId: string | undefined = myVeh.json?.id ?? myVeh.json?.vehicle?.id ?? arr(myVeh.json?.vehicles)[0]?.id
  const sreq = await req('POST', '/api/service-requests', customer, { category: 'TYRES', vehicleDesc: 'Toyota Vitz 2019', description: 'Front tyres worn out; need replacement and alignment.', county: 'Nairobi', ...(myVehicleId ? { myVehicleId } : {}) })
  const sreqId: string | undefined = sreq.json?.id ?? sreq.json?.request?.id
  check('customer created a service request (OPEN)', sreq.status === 200 || sreq.status === 201, `status ${sreq.status} ${sreq.json?.error ?? ''}`)
  const negOwnQuote = await req('POST', '/api/quotes', garageOwner, { requestId: sreqId, orgId: garageOrgId, amountMinor: 1200000, leadDays: 2, message: 'self quote attempt' })
  // garage quoting the request of a non-member customer is ALLOWED (that's the point); the negative is quoting your OWN request — use dealer as non-garage instead:
  const negGarageRole = await req('POST', '/api/quotes', dealerOwner, { requestId: sreqId, orgId: dealerOrgId, amountMinor: 100, leadDays: 1, message: 'dealer cannot quote' })
  check('non-garage org cannot quote', negGarageRole.status === 403 || negGarageRole.status === 400 || negGarageRole.status === 409, `status ${negGarageRole.status}`)
  const quote = await req('POST', '/api/quotes', garageOwner, { requestId: sreqId, orgId: garageOrgId, amountMinor: 1200000, leadDays: 2, message: 'Includes alignment and balancing.' })
  const quoteId: string | undefined = quote.json?.id ?? quote.json?.quote?.id
  check('garage quoted on the request', quote.status === 200 || quote.status === 201, `status ${quote.status} ${quote.json?.error ?? ''}`)
  const acc = await req('PATCH', `/api/quotes/${quoteId}`, customer, { action: 'accept' })
  check('customer accepted the quote → booking created', acc.status === 200, `status ${acc.status} ${acc.json?.error ?? ''}`)
  const bookings = await req('GET', '/api/bookings?mine=1', customer)
  const booking = arr(bookings.json)[0]
  const bookingId = booking?.id
  check('booking exists and is CONFIRMED', Boolean(bookingId) && (booking?.status === 'CONFIRMED' || booking?.status === 'IN_PROGRESS'), `status=${booking?.status ?? 'none'}`)
  if (bookingId) {
    await req('PATCH', `/api/bookings?id=${bookingId}`, garageOwner, { action: 'schedule', scheduledAt: new Date(Date.now() + 86400000).toISOString() })
    await req('PATCH', `/api/bookings?id=${bookingId}`, garageOwner, { action: 'start' })
    const done = await req('PATCH', `/api/bookings?id=${bookingId}`, garageOwner, { action: 'complete' })
    check('booking lifecycle completed (schedule→start→complete)', done.status === 200, `status ${done.status} ${done.json?.error ?? ''}`)
  }

  // ── 8. CUSTODY ──
  console.log('── 8. Vehicle custody → collection ──')
  const cust = await req('POST', '/api/custody', customer, {
    orgId: garageOrgId, vehicleDesc: 'Toyota Vitz, silver', plate: 'KCA 700X', odometerKm: 45000,
    fuelLevel: 'HALF', requestedWork: 'Replace front tyres and perform wheel alignment.', authorisedSpendMinor: 5000000, roadTestAllowed: false,
  })
  const custId: string | undefined = cust.json?.id ?? cust.json?.custody?.id
  check('custody created (HANDOVER_REQUESTED)', cust.status === 200 || cust.status === 201, `status ${cust.status} ${cust.json?.error ?? ''}`)
  await req('PATCH', `/api/custody/${custId}`, garageOwner, { action: 'receive', staffName: 'WF Technician' })
  const wip = await req('PATCH', `/api/custody/${custId}`, garageOwner, { action: 'status', status: 'WORK_IN_PROGRESS', note: 'tyres ordered' })
  check('garage moved custody to WORK_IN_PROGRESS', wip.status === 200, `status ${wip.status} ${wip.json?.error ?? ''}`)
  const negCust = await req('PATCH', `/api/custody/${custId}`, dealerOwner, { action: 'approve-work' })
  check('non-owner customer cannot approve work', negCust.status === 403 || negCust.status === 404, `status ${negCust.status}`)
  const ready = await req('PATCH', `/api/custody/${custId}`, garageOwner, { action: 'status', status: 'READY_FOR_COLLECTION', completedWork: 'Both front tyres replaced and aligned.' })
  check('custody moved to READY_FOR_COLLECTION', ready.status === 200, `status ${ready.status} ${ready.json?.error ?? ''}`)
  const auth = await req('POST', `/api/custody/${custId}/collection-auth`, customer, { collectorName: 'WF Customer', collectorPhone: '0712345678' })
  const code: string | undefined = auth.json?.code
  check('collection code issued to the customer', auth.status === 200 || auth.status === 201, `status ${auth.status} code=${code ? 'issued' : 'missing'}`)
  const negCode = await req('POST', `/api/custody/${custId}/collect`, garageOwner, { collectorName: 'WF Customer', authCode: '000000' })
  check('wrong collection code refused', negCode.status === 400, `status ${negCode.status}`)
  const collect = await req('POST', `/api/custody/${custId}/collect`, garageOwner, { collectorName: 'WF Customer', authCode: code ?? '' })
  check('correct code returns the vehicle (RETURNED)', collect.status === 200, `status ${collect.status} ${collect.json?.error ?? ''}`)

  // ── 9. CONSUMER PARTS ORDER ──
  console.log('── 9. Procurement (consumer order): order → dispatch → delivered ──')
  // Supplier approval auto-provisions a default warehouse (plan limit 1) — reuse it.
  let sBranchId: string | undefined
  const sBranchList = await req('GET', `/api/supply/branches?orgId=${supplierOrgId}`, supplierOwner)
  sBranchId = arr(sBranchList.json)[0]?.id
  if (!sBranchId) {
    const sBranch = await req('POST', '/api/supply/branches', supplierOwner, { orgId: supplierOrgId, name: 'Main Store', code: `M${String(stamp).slice(-8)}`, kind: 'WAREHOUSE', county: 'Nairobi', town: 'Industrial Area', address: 'Parts Road 12' })
    sBranchId = sBranch.json?.id ?? sBranch.json?.branch?.id ?? arr(sBranch.json)[0]?.id
    check('supplier warehouse branch created', Boolean(sBranchId), `status ${sBranch.status} ${sBranch.json?.error ?? ''}`)
  } else {
    check('supplier warehouse branch created', true, `reused auto-provisioned branch ${sBranchId}`)
  }
  const cats = await req('GET', '/api/supply/categories', customer)
  // The public endpoint exposes slugs; product creation needs the DB id.
  let categoryId: string | undefined
  try {
    const { PrismaClient } = await import('@prisma/client')
    const pdb = new PrismaClient()
    const cat = await pdb.productCategory.findFirst({ select: { id: true } })
    await pdb.$disconnect()
    categoryId = cat?.id
  } catch { /* fall through */ }
  if (!categoryId) categoryId = arr(cats.json)[0]?.id ?? arr(cats.json?.categories)[0]?.id
  const prod = await req('POST', '/api/supply/products', supplierOwner, {
    name: 'WF Brake Pad Set', sku: `WF-BP-${stamp}`, categoryId, description: 'E2E test brake pad set for common Japanese models.',
    condition: 'NEW', unitPriceMinor: 350000, publish: true,
  })
  const productId: string | undefined = prod.json?.id ?? prod.json?.product?.id
  check('supplier published a product', prod.status === 200 || prod.status === 201, `status ${prod.status} ${prod.json?.error ?? ''}`)
  if (productId && sBranchId && supplierOrgId) {
    const inv = await req('POST', '/api/supply/inventory', supplierOwner, { orgId: supplierOrgId, productId, branchId: sBranchId, setQtyOnHand: 20 })
    check('stock added at branch', inv.status === 200 || inv.status === 201, `status ${inv.status} ${inv.json?.error ?? ''}`)
  }
  const order = await req('POST', '/api/orders', customer, { items: [{ productId, qty: 2 }], county: 'Nairobi', address: 'Test Estate House 4', phone: '0712345678', deliveryMethod: 'DIRECT' })
  const orderId: string | undefined = order.json?.id ?? order.json?.order?.id ?? arr(order.json)[0]?.id
  check('consumer parts order created (SUBMITTED, no payment needed)', order.status === 200 || order.status === 201, `status ${order.status} ${order.json?.error ?? ''}`)
  const negCancel = await req('POST', `/api/orders/${orderId}`, customer, { action: 'dispatch', courierName: 'WF Courier' })
  check('buyer cannot dispatch the order', negCancel.status === 403, `status ${negCancel.status}`)
  await req('POST', `/api/orders/${orderId}`, supplierOwner, { action: 'accept', ...(sBranchId ? { fulfillmentBranchId: sBranchId } : {}) })
  const disp = await req('POST', `/api/orders/${orderId}`, supplierOwner, { action: 'dispatch', courierName: 'WF Courier' })
  check('supplier dispatched the order (OTP generated)', disp.status === 200, `status ${disp.status} ${disp.json?.error ?? ''}`)
  const notifs = await req('GET', '/api/notifications', customer)
  const otpMatch = JSON.stringify(notifs.json).match(/\b(\d{6})\b/)
  const orderOtp = otpMatch?.[1]
  check('buyer received the delivery code via notification', Boolean(orderOtp), `otp=${orderOtp ? orderOtp.slice(0, 2) + '****' : 'missing'}`)
  const negWrong = await req('POST', `/api/orders/${orderId}`, customer, { action: 'delivered', code: '000000' })
  check('wrong delivery OTP refused (buyer is never the verifying side)', negWrong.status === 400 || negWrong.status === 403, `status ${negWrong.status}`)
  const del = await req('POST', `/api/orders/${orderId}`, supplierOwner, { action: 'delivered', code: orderOtp ?? '' })
  check('delivery OTP verified → DELIVERED', del.status === 200, `status ${del.status} ${del.json?.error ?? ''}`)
  const conf = await req('POST', `/api/orders/${orderId}`, customer, { action: 'confirm' })
  check('buyer confirmed → order COMPLETED', conf.status === 200, `status ${conf.status} ${conf.json?.error ?? ''}`)

  // ── 10. B2B PURCHASE ORDER (escrow) ──
  console.log('── 10. B2B purchase order: escrow-protected pipeline ──')
  // Reuse an existing garage branch when one was auto-provisioned.
  let gBranchId: string | undefined
  const gBranchList = await req('GET', `/api/supply/branches?orgId=${garageOrgId}`, garageOwner)
  gBranchId = arr(gBranchList.json)[0]?.id
  if (!gBranchId) {
    const gBranch = await req('POST', '/api/supply/branches', garageOwner, { orgId: garageOrgId, name: 'Garage Store', code: `G${String(stamp).slice(-8)}`, kind: 'BRANCH', county: 'Nairobi', town: 'Westlands', address: 'Garage Lane 8' })
    gBranchId = gBranch.json?.id ?? gBranch.json?.branch?.id ?? arr(gBranch.json)[0]?.id
    check('garage destination branch created', Boolean(gBranchId), `status ${gBranch.status} ${gBranch.json?.error ?? ''}`)
  } else {
    check('garage destination branch created', true, `reused branch ${gBranchId}`)
  }
  const po = await req('POST', '/api/supply/orders', garageOwner, { orgId: garageOrgId, destinationBranchId: gBranchId, items: [{ productId, qty: 5 }], note: 'workflow e2e PO' })
  const poId: string | undefined = po.json?.id ?? po.json?.order?.id ?? arr(po.json)[0]?.id
  const poObj = po.json?.id ? po.json : (po.json?.order ?? arr(po.json)[0])
  check('B2B purchase order created (stock reserved)', po.status === 200 || po.status === 201, `status ${po.status} ${po.json?.error ?? ''} status=${poObj?.status}`)
  if (poObj?.status === 'AWAITING_APPROVAL') {
    await req('POST', `/api/supply/orders/${poId}/action`, garageOwner, { action: 'approve' })
  }
  const negPay = await req('POST', `/api/supply/orders/${poId}/pay`, customer, { phone: '0712345678' })
  check('non-garage user cannot initiate PO payment', negPay.status === 403 || negPay.status === 400 || negPay.status === 409, `status ${negPay.status}`)
  const respond = await req('POST', `/api/supply/orders/${poId}/action`, supplierOwner, { action: 'respond', decision: 'ACCEPT', note: '' })
  check('supplier accepted the PO', respond.status === 200, `status ${respond.status} ${respond.json?.error ?? ''}`)
  const arrange = await req('POST', `/api/supply/orders/${poId}/action`, supplierOwner, { action: 'arrange', method: 'DIRECT' })
  check('delivery arranged → order CONFIRMED', arrange.status === 200, `status ${arrange.status} ${arrange.json?.error ?? ''}`)
  const pay = await req('POST', `/api/supply/orders/${poId}/pay`, garageOwner, { phone: '0712345678' })
  check('payment honestly refused while M-Pesa is unconfigured (503 MPESA_NOT_CONFIGURED)', pay.status === 503 && pay.json?.error === 'MPESA_NOT_CONFIGURED', `status ${pay.status} error=${pay.json?.error}`)
  const negDisp = await req('POST', `/api/supply/orders/${poId}/action`, supplierOwner, { action: 'dispatch' })
  check('dispatch blocked without protected payment (PAYMENT_REQUIRED)', negDisp.status === 409, `status ${negDisp.status} ${negDisp.json?.error ?? ''}`)
  const recon = await req('POST', '/api/admin/supply', admin, { action: 'reconcile-payment', orderId: poId, providerRef: `WF-MANUAL-${stamp}`, note: 'workflow e2e manual reconciliation' })
  check('platform finance reconciled the payment (MANUAL_RECONCILED)', recon.status === 200, `status ${recon.status} ${recon.json?.error ?? ''}`)
  const disp2 = await req('POST', `/api/supply/orders/${poId}/action`, supplierOwner, { action: 'dispatch', courierName: 'WF Courier' })
  check('supplier dispatched the protected PO', disp2.status === 200, `status ${disp2.status} ${disp2.json?.error ?? ''}`)
  const poNotifs = await req('GET', '/api/notifications', garageOwner)
  const poOtpMatch = JSON.stringify(poNotifs.json).match(/\b(\d{6})\b/)
  const poOtp = poOtpMatch?.[1]
  check('garage received the handover OTP', Boolean(poOtp), `otp=${poOtp ? 'issued' : 'missing'}`)
  const hand = await req('POST', `/api/supply/orders/${poId}/action`, garageOwner, poOtp ? { action: 'handover', otp: poOtp } : { action: 'handover', otp: '000000' })
  check('garage confirmed handover', hand.status === 200, `status ${hand.status} ${hand.json?.error ?? ''}`)
  const hConfirm = await req('POST', `/api/supply/orders/${poId}/action`, supplierOwner, { action: 'handover-confirm' })
  check('supplier counter-confirms handover → DELIVERED', hConfirm.status === 200, `status ${hConfirm.status} ${hConfirm.json?.error ?? ''}`)
  const insp = await req('POST', `/api/supply/orders/${poId}/action`, garageOwner, { action: 'inspect', result: 'ACCEPT', items: (poObj?.items ?? []).map((it: any) => ({ itemId: it.id, qtyAccepted: it.qty })) })
  check('garage inspected and accepted the delivery', insp.status === 200, `status ${insp.status} ${insp.json?.error ?? ''}`)
  const rel = await req('POST', `/api/supply/orders/${poId}/action`, garageOwner, { action: 'release' })
  check('escrow released → order COMPLETED', rel.status === 200, `status ${rel.status} ${rel.json?.error ?? ''}`)
  const settle = await req('GET', '/api/settlements', supplierOwner)
  check('settlement record exists for the released escrow (supplier-side, commission deducted)', settle.status === 200 && JSON.stringify(settle.json).includes(poId ?? '@'), `status ${settle.status}`)

  // ── 11. LOGISTICS DELIVERY JOB ──
  console.log('── 11. Logistics delivery: job → accept → pickup → deliver ──')
  const job = await req('POST', '/api/logistics/jobs', customer, {
    cargoDesc: 'Vehicle parts crate for WF Garage', sizeClass: 'SMALL',
    pickupCounty: 'Nairobi', pickupAddress: 'Parts Road 12', pickupContactName: 'WF Supplier', pickupContactPhone: '0723456789',
    dropCounty: 'Mombasa', dropAddress: 'Port Reitz 5', dropContactName: 'WF Garage', dropContactPhone: '0734567890',
  })
  const jobId: string | undefined = job.json?.id ?? job.json?.job?.id
  check('delivery job created (OPEN)', job.status === 200 || job.status === 201, `status ${job.status} ${job.json?.error ?? ''}`)
  const negAccept = await req('POST', `/api/logistics/jobs/${jobId}`, customer, { action: 'accept', driverId: 'x', feeMinor: 100000 })
  check('non-partner cannot accept jobs', negAccept.status === 403, `status ${negAccept.status}`)
  const acc2 = await req('POST', `/api/logistics/jobs/${jobId}`, logisticsOwner, driverId ? { action: 'accept', driverId, feeMinor: 350000 } : { action: 'accept', driverId: 'missing', feeMinor: 350000 })
  check('logistics partner accepted the job', acc2.status === 200, `status ${acc2.status} ${acc2.json?.error ?? ''}`)
  await req('POST', `/api/logistics/jobs/${jobId}`, logisticsOwner, { action: 'pickup' })
  await req('POST', `/api/logistics/jobs/${jobId}`, logisticsOwner, { action: 'transit' })
  const podUp = await upload(logisticsOwner, new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), 'pod.png', 'image/png', 'evidence')
  const podUrl: string = podUp.json?.url ?? ''
  const jobDetail = await req('GET', `/api/logistics/jobs/${jobId}`, customer)
  const qrToken: string | undefined = jobDetail.json?.job?.qrToken ?? jobDetail.json?.qrToken
  const deliver = await req('POST', `/api/logistics/jobs/${jobId}`, logisticsOwner, qrToken ? { action: 'deliver', otp: qrToken, photos: podUrl ? [podUrl] : undefined } : { action: 'deliver', otp: '000000', photos: podUrl ? [podUrl] : undefined })
  check('partner delivered with requester QR token (POD)', deliver.status === 200, `status ${deliver.status} ${deliver.json?.error ?? ''}`)
  const jobAfter = await req('GET', `/api/logistics/jobs/${jobId}`, customer)
  check('job is DELIVERED', (jobAfter.json?.job?.status ?? jobAfter.json?.status) === 'DELIVERED', `status=${jobAfter.json?.job?.status ?? jobAfter.json?.status}`)

  // ── 12. demo/production isolation spot-checks with real records ──
  console.log('── 12. Demo separation spot-checks (real records) ──')
  const demoAdmin: Jar = {}
  {
    const r2 = await fetch(`${BASE}/api/auth/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'platform-admin' }) })
    capture(demoAdmin, r2)
  }
  const demoSeesQueue = await req('GET', '/api/admin/uploads', demoAdmin)
  check('DEMO admin session cannot open the real upload review queue', demoSeesQueue.status === 403, `status ${demoSeesQueue.status} ${demoSeesQueue.json?.error ?? ''}`)
  const demoUsers = await req('GET', '/api/admin/users', demoAdmin)
  check('DEMO admin session cannot read real user records', demoUsers.status === 403, `status ${demoUsers.status} ${demoUsers.json?.error ?? ''}`)
  const demoListings = await req('GET', '/api/admin/listings', demoAdmin)
  const demoListingEmails = JSON.stringify(demoListings.json)
  check('DEMO admin sees no real owner emails in the moderation queue', demoListings.status !== 200 || !demoListingEmails.includes('@test.local'), `status ${demoListings.status}`)
  const demoMarkPaid = await req('POST', `/api/billing/invoices/nonexistent/mark-paid`, demoAdmin, {})
  check('DEMO session cannot touch payments (mark-paid)', demoMarkPaid.status === 403, `status ${demoMarkPaid.status} ${demoMarkPaid.json?.error ?? ''}`)
  const realListings = await req('GET', '/api/vehicles?mine=1', dealerOwner)
  const ownVehicles = arr(realListings.json).filter((v: any) => v.id === vehicleId)
  check('real dealer sees own vehicle (functionality intact alongside demo data)', ownVehicles.length === 1, `count=${ownVehicles.length}`)

  console.log(`\nWORKFLOW E2E RESULTS: ${pass} passed, ${fail} failed`)
  if (failures.length) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1) }
}

main().catch((e) => { console.error('WORKFLOW E2E ERROR:', e); process.exit(2) })
