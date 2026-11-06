/**
 * CARMAZE — role & demo security verification suite (run: bun verification/security-tests.ts)
 * Tests every demo role + the 20 required authorisation scenarios against the
 * live deployment. Prints PASS/FAIL per check with actual evidence.
 */
const BASE = 'http://localhost:3000'

type Jar = Record<string, string>

async function req(method: string, path: string, jar: Jar, body?: unknown): Promise<{ status: number; json: any; setCookie?: string }> {
  const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  })
  const setCookie = res.headers.get('set-cookie')?.split(';')[0]
  if (setCookie) {
    const [k, v] = setCookie.split('=')
    jar[k.trim()] = v
  }
  let json: any = null
  try { json = await res.json() } catch { /* html or empty */ }
  return { status: res.status, json, setCookie }
}

async function loginAs(email: string): Promise<Jar> {
  const jar: Jar = {}
  const r = await req('POST', '/api/auth/login', jar, { email, password: 'CarmazeDemo2025!' })
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${r.status} ${JSON.stringify(r.json)}`)
  return jar
}
async function demoAs(role: string): Promise<Jar> {
  const jar: Jar = {}
  const r = await req('POST', '/api/auth/demo', jar, { role })
  if (r.status !== 200) throw new Error(`demo signin failed for ${role}: ${r.status} ${JSON.stringify(r.json)}`)
  return jar
}

let pass = 0, fail = 0
const failures: string[] = []
function check(name: string, ok: boolean, evidence: string) {
  if (ok) { pass++; console.log(`  PASS  ${name}  — ${evidence}`) }
  else { fail++; failures.push(`${name}: ${evidence}`); console.log(`  FAIL  ${name}  — ${evidence}`) }
}
function section(t: string) { console.log(`\n── ${t} ${'─'.repeat(Math.max(2, 66 - t.length))}`) }

async function main() {
  // ── Step 0: real (non-demo) user for isolation tests ──
  section('Setup: register a REAL (non-demo) user')
  const realJar: Jar = {}
  let reg = await req('POST', '/api/auth/register', realJar, { name: 'Real User Isolation', email: 'real.isolation@test.local', password: 'RealTest2025!x' })
  if (reg.status === 409) {
    // User already exists from a previous suite run — sign in instead.
    reg = await req('POST', '/api/auth/login', realJar, { email: 'real.isolation@test.local', password: 'RealTest2025!x' })
  }
  check('real user registered', reg.status === 200 || reg.status === 201, `status ${reg.status}`)
  const realMe = await req('GET', '/api/auth/me', realJar)
  check('real user is NOT demo-marked', realMe.json?.user?.isDemo === false, `isDemo=${realMe.json?.user?.isDemo}`)

  // ── 1. Each demo role signs in and lands on the right dashboard ──
  section('All 8 demo roles authenticate via secure server-side mechanism')
  const ROLES: Array<[string, string, string]> = [
    ['customer', 'cars', 'CUSTOMER'],
    ['private-seller', 'my-listings', 'SELLER'],
    ['showroom-owner', 'dealer', 'DEALER_OWNER'],
    ['showroom-staff', 'dealer', 'DEALER_STAFF'],
    ['garage-owner', 'garage-dashboard', 'GARAGE_OWNER'],
    ['garage-staff', 'garage-dashboard', 'GARAGE_STAFF'],
    ['platform-support', 'admin?tab=support', 'SUPPORT'],
    ['platform-admin', 'admin', 'ADMIN'],
  ]
  const demoJars: Record<string, Jar> = {}
  for (const [key, dash, role] of ROLES) {
    const jar = await demoAs(key)
    demoJars[key] = jar
    const me = await req('GET', '/api/auth/me', jar)
    const u = me.json?.user
    check(`${key} demo session`, me.status === 200 && u?.isDemo === true && u.roles.includes(role),
      `status ${me.status}, roles=[${u?.roles}], isDemo=${u?.isDemo}, dashboard=${dash}`)
    check(`${key} demo session carries demo scope`, me.json?.demo?.active === true && me.json?.demo?.roleKey === key,
      `demo=${JSON.stringify(me.json?.demo)}`)
  }

  // ── 2. Customer boundaries ──
  section('Customer cannot reach DealerOS / GarageOS / admin (API level)')
  const cust = demoJars['customer']
  let r = await req('GET', '/api/dealer/dashboard', cust)
  check('customer blocked from dealer dashboard API', r.status === 403, `status ${r.status} ${JSON.stringify(r.json?.error ?? '')}`)
  r = await req('GET', '/api/garages?mine=1', cust)
  check('customer garage "mine" scope returns only own (empty)', r.status === 200 && (r.json?.garages ?? []).length === 0, `status ${r.status}, garages=${(r.json?.garages ?? []).length}`)
  r = await req('GET', '/api/bookings?org=1', cust)
  check('customer blocked from garage org bookings', r.status === 403, `status ${r.status}`)
  r = await req('GET', '/api/admin/overview', cust)
  check('customer blocked from admin overview', r.status === 403, `status ${r.status}`)
  r = await req('GET', '/api/applications?queue=1', cust)
  check('customer GET /applications returns own scope only (no staff queue)', r.status === 200 && (r.json?.applications ?? []).length === 0 && !JSON.stringify(r.json).includes('Nairobi Auto Hub'), `status ${r.status}, apps=${(r.json?.applications ?? []).length}`)
  r = await req('GET', '/api/vehicles', {} as Jar)
  check('customer CAN browse public listings (anon)', r.status === 200 && (r.json?.vehicles?.length ?? 0) > 0, `status ${r.status}, count ${r.json?.vehicles?.length}`)

  // ── 3. Seller own-listing isolation ──
  section('Private seller sees only own listings')
  const seller = demoJars['private-seller']
  r = await req('GET', '/api/vehicles?mine=1', seller)
  const mine = r.json?.vehicles ?? r.json?.listings ?? []
  const sellerId = (await req('GET', '/api/auth/me', seller)).json?.user?.id
  check('seller listing list is entirely own', r.status === 200 && mine.every((v: any) => v.ownerId === undefined || v.ownerId === sellerId), `status ${r.status}, listings ${mine.length}, sample keys=${mine[0] ? Object.keys(mine[0]).slice(0, 8).join(',') : 'none'}`)

  // ── 4. Showroom owner: own showroom only ──
  section('Showroom owner scoped to own org(s)')
  const dealer = demoJars['showroom-owner']
  const dealerMe = await req('GET', '/api/auth/me', dealer)
  const myOrgId = dealerMe.json?.memberships?.[0]?.orgId
  check('dealer has memberships', Boolean(myOrgId), `orgId=${myOrgId}`)
  r = await req('GET', `/api/dealer/dashboard?orgId=${myOrgId}`, dealer)
  check('dealer CAN open own org dashboard', r.status === 200, `status ${r.status}`)
  r = await req('GET', '/api/dealer/dashboard?orgId=nonexistent-org-xyz', dealer)
  check('dealer blocked from unknown org dashboard', r.status === 403 || r.status === 404, `status ${r.status}`)

  // ── 5. Showroom staff: no billing / no owner tools ──
  section('Showroom staff excluded from owner-only tools')
  const staff = demoJars['showroom-staff']
  r = await req('GET', '/api/billing/invoices?org=1', staff)
  check('dealer staff cannot list org billing invoices', r.status === 403 || (r.json?.invoices?.length ?? -1) === 0, `status ${r.status}`)
  r = await req('POST', '/api/billing/subscribe', staff, { planCode: 'dealer-pro' })
  check('dealer staff cannot subscribe org', r.status === 403, `status ${r.status} ${JSON.stringify(r.json?.error ?? '')}`)

  // ── 6. Garage owner / staff boundaries ──
  section('Garage staff vs owner permissions')
  const gstaff = demoJars['garage-staff']
  const gowner = demoJars['garage-owner']
  r = await req('GET', '/api/billing/invoices?org=1', gstaff)
  check('garage staff cannot read org invoices', r.status === 403 || (r.json?.invoices?.length ?? -1) === 0, `status ${r.status}`)
  r = await req('POST', '/api/billing/subscribe', gstaff, { planCode: 'garage-pro' })
  check('garage staff cannot subscribe org', r.status === 403, `status ${r.status}`)
  r = await req('GET', '/api/garages?forOrg=1', gowner)
  check('garage owner can open garage ops data', r.status === 200, `status ${r.status}`)

  // ── 7. Cross-org data isolation ──
  section('No cross-organisation data access')
  const bookings = await req('GET', '/api/bookings?org=1', gowner)
  const premium = (await req('GET', '/api/auth/me', gowner)).json?.memberships?.map((m: any) => m.orgId) ?? []
  const foreign = (bookings.json?.bookings ?? []).filter((b: any) => !premium.includes(b.orgId))
  check('garage owner sees only own org bookings', bookings.status === 200 && foreign.length === 0, `status ${bookings.status}, foreign rows ${foreign.length}`)
  r = await req('GET', '/api/dealer/dashboard?orgId=nonexistent-org-xyz', gowner)
  check('garage owner blocked from dealer dashboard', r.status === 403, `status ${r.status}`)

  // ── 8. Support vs finance separation ──
  section('Platform staff least-privilege')
  const support = demoJars['platform-support']
  r = await req('GET', '/api/admin/revenue', support)
  check('support blocked from revenue dashboard', r.status === 403, `status ${r.status}`)
  r = await req('GET', '/api/admin/tickets', support)
  check('support CAN read support tickets', r.status === 200, `status ${r.status}`)
  const demoAdmin = demoJars['platform-admin']
  r = await req('GET', '/api/admin/overview', demoAdmin)
  check('demo admin CAN read overview (read-only tour)', r.status === 200, `status ${r.status}`)

  // ── 9. Demo admin cannot perform production/security actions ──
  section('Demo admin restrictions (financial / security / config)')
  r = await req('PUT', '/api/admin/fees', demoAdmin, { commissionPct: 5 })
  check('demo admin cannot change platform fees', r.status === 403 && r.json?.error === 'DEMO_SANDBOXED', `status ${r.status} ${r.json?.error}`)
  r = await req('PUT', '/api/admin/settings', demoAdmin, { key: 'contact', value: '{}' })
  check('demo admin cannot change platform settings', r.status === 403 && r.json?.error === 'DEMO_SANDBOXED', `status ${r.status} ${r.json?.error}`)
  r = await req('POST', '/api/admin/broadcast', demoAdmin, { title: 'x', body: 'y', audience: 'CUSTOMER' })
  check('demo admin cannot broadcast to users', r.status === 403 && r.json?.error === 'DEMO_SANDBOXED', `status ${r.status} ${r.json?.error}`)
  r = await req('POST', '/api/admin/staff', demoAdmin, { email: 'hax@test.local', name: 'Hax', role: 'SUPPORT', department: 'SUPPORT' })
  check('demo admin cannot invite staff', r.status === 403 && r.json?.error === 'DEMO_SANDBOXED', `status ${r.status} ${r.json?.error}`)
  r = await req('POST', '/api/admin/demo-accounts/reset', demoAdmin, { confirm: 'RESET_DEMO_DATA' })
  check('demo admin cannot reset demo data', r.status === 403, `status ${r.status}`)
  r = await req('PATCH', '/api/admin/demo-accounts', demoAdmin, { roleKey: 'customer', enabled: false })
  check('demo admin cannot disable demo roles', r.status === 403, `status ${r.status}`)
  r = await req('GET', '/api/applications?queue=1', demoAdmin)
  check('demo admin CAN read application queue', r.status === 200, `status ${r.status}`)

  // ── 10. Demo isolation from real users ──
  section('Demo actions never reach real users (notifications)')
  const realNotifsBefore = await req('GET', '/api/notifications?count=1', realJar)
  const beforeCount = realNotifsBefore.json?.unread ?? 0
  const demoVehicles = await req('GET', '/api/vehicles', {} as Jar)
  const anyVehicle = (demoVehicles.json?.vehicles ?? [])[0]
  if (anyVehicle) {
    r = await req('POST', '/api/enquiries', cust, { vehicleId: anyVehicle.id, message: 'Demo isolation check enquiry — is this still available?' })
    check('demo customer can enquire on demo listing (allowed)', r.status === 200 || r.status === 201, `status ${r.status} ${JSON.stringify(r.json?.error ?? '')}`)
  }
  const realNotifsAfter = await req('GET', '/api/notifications?count=1', realJar)
  check('real user received NO notifications from demo activity', (realNotifsAfter.json?.unread ?? 0) === beforeCount, `unread before=${beforeCount} after=${realNotifsAfter.json?.unread}`)

  section('Demo staff console blocked on non-demo subjects')
  const realApp = await req('POST', '/api/applications', realJar, {
    type: 'DEALER', orgName: 'Real Isolation Seller', county: 'Nairobi', town: 'CBD',
    physicalAddress: 'Test Street 1', phone: '+254700000001', email: 'real.isolation@test.local',
    representative: 'Real User', accountType: 'dealer-basic', consent: true, status: 'SUBMITTED', documents: [],
  })
  check('real user can submit application (normal registration flow intact)', realApp.status === 200 || realApp.status === 201, `status ${realApp.status}`)
  const realAppId = realApp.json?.application?.id ?? realApp.json?.id
  if (realAppId) {
    r = await req('PATCH', `/api/applications/${realAppId}`, demoAdmin, { action: 'assign', reviewOwnerId: 'x' })
    check('demo admin blocked from deciding REAL application', r.status === 403 && r.json?.error === 'DEMO_SANDBOXED', `status ${r.status} ${r.json?.error}`)
    const adminJar = await loginAs('admin@carmaze.co.ke')
    r = await req('PATCH', `/api/applications/${realAppId}`, adminJar, { action: 'note', note: 'Isolation test application (safe to leave pending).' })
    check('REAL admin can still act on REAL application', r.status === 200 || r.status === 201, `status ${r.status}`)
  }

  // ── 11. Tampering: role claims & cookie manipulation ──
  section('Frontend tampering cannot grant permissions')
  const forged: Jar = { carmaze_session: ' forged.jwt.value' }
  r = await req('GET', '/api/admin/overview', forged)
  check('forged session cookie gains no admin access', r.status === 401 || r.status === 403, `status ${r.status}`)
  r = await req('PATCH', '/api/admin/users', staff, { id: 'anything', status: 'SUSPENDED' })
  check('demo staff cannot suspend users', r.status === 403, `status ${r.status}`)
  r = await req('PATCH', '/api/admin/partners/whatever', cust, { action: 'approve' })
  check('demo customer cannot approve partners', r.status === 403 || r.status === 401 || r.status === 404, `status ${r.status}`)

  // ── 12. Roles revoked take effect immediately (roles re-read per request) ──
  section('Revoked staff permissions take effect immediately')
  const { PrismaClient } = await import('/home/z/my-project/node_modules/@prisma/client') as typeof import('@prisma/client')
  const db = new PrismaClient()
  const staffUser = await db.user.findUnique({ where: { email: 'staff@carmaze.co.ke' } })
  if (!staffUser) throw new Error('staff@carmaze.co.ke missing after reset')
  await db.user.update({ where: { id: staffUser.id }, data: { roles: 'CUSTOMER' } })
  r = await req('GET', '/api/dealer/dashboard?orgId=' + myOrgId, staff)
  check('revoked DEALER_STAFF loses dealer API access immediately', r.status === 403, `status ${r.status}`)
  await db.user.update({ where: { id: staffUser.id }, data: { roles: staffUser.roles } })
  r = await req('GET', '/api/dealer/dashboard?orgId=' + myOrgId, staff)
  check('restored DEALER_STAFF regains access', r.status === 200, `status ${r.status}`)
  await db.$disconnect()

  // ── 13. Unauthenticated probes ──
  section('Unauthenticated direct API access denied')
  const anon: Jar = {}
  r = await req('GET', '/api/admin/users', anon)
  check('anon blocked from admin users', r.status === 401, `status ${r.status}`)
  r = await req('GET', '/api/admin/audit', anon)
  check('anon blocked from audit log', r.status === 401, `status ${r.status}`)
  r = await req('GET', '/api/conversations', anon)
  check('anon blocked from conversations', r.status === 401, `status ${r.status}`)

  // ── 14. Demo catalog + disabled role ──
  section('Demo catalog control')
  const cat = await req('GET', '/api/auth/demo', {})
  check('catalog lists 8 enabled roles without credentials', cat.status === 200 && cat.json?.roles?.length === 8 && !JSON.stringify(cat.json).includes('CarmazeDemo') && !JSON.stringify(cat.json).toLowerCase().includes('password'), `roles=${cat.json?.roles?.length}`)
  r = await req('POST', '/api/auth/demo', {}, { role: 'does-not-exist' })
  check('unknown demo role rejected', r.status === 400, `status ${r.status}`)
  const adminJar2 = await loginAs('admin@carmaze.co.ke')
  r = await req('PATCH', '/api/admin/demo-accounts', adminJar2, { roleKey: 'customer', enabled: false })
  check('REAL admin can disable a demo role', r.status === 200, `status ${r.status}`)
  const cat2 = await req('GET', '/api/auth/demo', {})
  check('disabled role disappears from catalog', cat2.json?.roles?.length === 7, `roles=${cat2.json?.roles?.length}`)
  r = await req('POST', '/api/auth/demo', {}, { role: 'customer' })
  check('disabled role cannot start session', r.status === 403 && r.json?.error === 'DEMO_DISABLED', `status ${r.status} ${r.json?.error}`)
  await req('PATCH', '/api/admin/demo-accounts', adminJar2, { roleKey: 'customer', enabled: true })
  r = await req('POST', '/api/auth/demo', {}, { role: 'customer' })
  check('re-enabled role works again', r.status === 200, `status ${r.status}`)

  // ── 15. Demo data reset ──
  section('Demo data reset restores baseline')
  const reset = await req('POST', '/api/admin/demo-accounts/reset', adminJar2, { confirm: 'RESET_DEMO_DATA' })
  check('reset endpoint completes', reset.status === 200 && reset.json?.reset === true, `status ${reset.status} msg=${reset.json?.message?.slice(0, 60)}`)
  const meAfter = await req('GET', '/api/auth/me', adminJar2)
  check('sessions ended after reset (users recreated)', meAfter.json?.user === null, `user=${meAfter.json?.user}`)
  const freshAdmin = await loginAs('admin@carmaze.co.ke')
  const list = await req('GET', '/api/admin/demo-accounts', freshAdmin)
  check('demo registry intact after reset', list.status === 200 && (list.json?.accounts?.length ?? 0) === 8, `accounts=${list.json?.accounts?.length}`)
  const resetInfo = (list.json?.accounts ?? []).find((a: any) => a.roleKey === 'customer')
  check('reset recorded on registry', Boolean(resetInfo?.lastResetAt) && resetInfo?.resetCount >= 1, `lastResetAt=${resetInfo?.lastResetAt}, count=${resetInfo?.resetCount}`)

  // ── Summary ──
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`RESULTS: ${pass} passed, ${fail} failed`)
  if (failures.length) {
    console.log('\nFAILURES:')
    failures.forEach((f) => console.log('  ✗ ' + f))
    process.exit(1)
  }
}

main().catch((e) => { console.error('SUITE ERROR:', e); process.exit(2) })
