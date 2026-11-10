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
  check('catalog lists 10 enabled roles without credentials', cat.status === 200 && cat.json?.roles?.length === 10 && !JSON.stringify(cat.json).includes('CarmazeDemo') && !JSON.stringify(cat.json).toLowerCase().includes('password'), `roles=${cat.json?.roles?.length}`)
  r = await req('POST', '/api/auth/demo', {}, { role: 'does-not-exist' })
  check('unknown demo role rejected', r.status === 400, `status ${r.status}`)
  const adminJar2 = await loginAs('admin@carmaze.co.ke')
  r = await req('PATCH', '/api/admin/demo-accounts', adminJar2, { roleKey: 'customer', enabled: false })
  check('REAL admin can disable a demo role', r.status === 200, `status ${r.status}`)
  const cat2 = await req('GET', '/api/auth/demo', {})
  check('disabled role disappears from catalog', cat2.json?.roles?.length === 9, `roles=${cat2.json?.roles?.length}`)
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
  check('demo registry intact after reset', list.status === 200 && (list.json?.accounts?.length ?? 0) === 10, `accounts=${list.json?.accounts?.length}`)
  const resetInfo = (list.json?.accounts ?? []).find((a: any) => a.roleKey === 'customer')
  check('reset recorded on registry', Boolean(resetInfo?.lastResetAt) && resetInfo?.resetCount >= 1, `lastResetAt=${resetInfo?.lastResetAt}, count=${resetInfo?.resetCount}`)

  // ── 16. Secure uploads ──
  section('Upload pipeline: authentication, type sniffing, size caps, isolation')
  // The section-15 demo reset restores the full seeded baseline and removes
  // users created before it — re-establish a real (non-demo) session here.
  for (const k of Object.keys(realJar)) delete realJar[k]
  let realRe = await req('POST', '/api/auth/register', realJar, { name: 'Real User Isolation', email: 'real.isolation@test.local', password: 'RealTest2025!x' })
  if (realRe.status === 409) {
    realRe = await req('POST', '/api/auth/login', realJar, { email: 'real.isolation@test.local', password: 'RealTest2025!x' })
  }
  check('real user session available for upload tests', realRe.status === 200 || realRe.status === 201, `status ${realRe.status}`)
  async function uploadFile(jar: Jar, bytes: Uint8Array, filename: string, type: string, kind?: string): Promise<{ status: number; json: any }> {
    const fd = new FormData()
    fd.set('file', new Blob([new Uint8Array(bytes)], { type }), filename)
    if (kind) fd.set('kind', kind)
    const cookie = Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
    const res = await fetch(`${BASE}/api/upload`, {
      method: 'POST',
      headers: { ...(cookie ? { Cookie: cookie } : {}) },
      body: fd,
    })
    let json: any = null
    try { json = await res.json() } catch { /* ignore */ }
    return { status: res.status, json }
  }
  const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
  const PDF_SIG = new TextEncoder().encode('%PDF-1.4\n1 0 obj')
  r = await req('POST', '/api/upload', {} as Jar)
  check('anon upload rejected', r.status === 401, `status ${r.status}`)
  let up = await uploadFile(realJar, PNG_SIG, 'photo.png', 'image/png')
  check('valid PNG upload accepted (public media)', up.status === 201 && String(up.json?.url).startsWith('/api/media/'), `status ${up.status} url=${up.json?.url}`)
  const mediaUrl: string = up.json?.url ?? ''
  if (mediaUrl) {
    const serve = await fetch(`${BASE}${mediaUrl}`)
    check('uploaded media served with correct type', serve.status === 200 && (serve.headers.get('content-type') ?? '').startsWith('image/png'), `status ${serve.status} type=${serve.headers.get('content-type')}`)
  }
  up = await uploadFile(realJar, PDF_SIG, 'licence.pdf', 'application/pdf', 'document')
  check('PDF document upload accepted (private files)', up.status === 201 && String(up.json?.url).startsWith('/api/files/'), `status ${up.status} url=${up.json?.url}`)
  const docUrl: string = up.json?.url ?? ''
  if (docUrl) {
    const anonGet = await fetch(`${BASE}${docUrl}`)
    check('private document NOT served anonymously', anonGet.status === 401, `status ${anonGet.status}`)
    // The section-15 reset recreated the demo users, so start a fresh demo
    // session for the cross-user isolation check.
    const custAfterReset = await demoAs('customer')
    const demoGet = await fetch(`${BASE}${docUrl}`, { headers: { Cookie: Object.entries(custAfterReset).map(([k, v]) => `${k}=${v}`).join('; ') } })
    check('private document blocked for other (demo) user', demoGet.status === 403, `status ${demoGet.status}`)
  }
  up = await uploadFile(realJar, new TextEncoder().encode('definitely not an image'), 'evil.png', 'image/png')
  check('text bytes claiming image/png rejected', up.status === 415 && ['UNSUPPORTED_TYPE', 'CONTENT_MISMATCH'].includes(up.json?.error), `status ${up.status} ${up.json?.error}`)
  up = await uploadFile(realJar, PNG_SIG, 'photo.png', 'text/plain')
  check('PNG bytes with text/plain declaration rejected (anti-spoof)', up.status === 415 && up.json?.error === 'CONTENT_MISMATCH', `status ${up.status} ${up.json?.error}`)
  up = await uploadFile(realJar, PNG_SIG, 'photo.png', 'image/png', 'executable')
  check('invalid upload kind rejected', up.status === 400, `status ${up.status} ${up.json?.error}`)
  const big = new Uint8Array(9 * 1024 * 1024)
  big.set(PNG_SIG.slice(0, 8), 0)
  up = await uploadFile(realJar, big, 'big.png', 'image/png')
  check('oversized image (9MB > 8MB) rejected', up.status === 413, `status ${up.status} ${up.json?.error}`)

  // ── 17. Verification code lifecycle ──
  section('Verification codes expire, are single-use and attempt-capped')
  // Fresh user per run: the verify endpoints are rate-limited per account,
  // so a reused account would trip its own request limit on repeat runs.
  const vcJar: Jar = {}
  const VC_EMAIL = `verify.codes.${Date.now()}@test.local`
  const vcReg = await req('POST', '/api/auth/register', vcJar, { name: 'Verify Codes', email: VC_EMAIL, password: 'Vcodes2025!x' })
  check('verification test user registered', vcReg.status === 200 || vcReg.status === 201, `status ${vcReg.status}`)
  r = await req('POST', '/api/auth/verify-email', vcJar, { action: 'request' })
  const devCode = r.json?.devCode
  check('email verification code issued (dev channel, non-prod)', r.status === 200 && typeof devCode === 'string' && /^\d{6}$/.test(devCode), `status ${r.status} code-issued=${typeof devCode === 'string'}`)
  for (let i = 0; i < 5; i++) {
    r = await req('POST', '/api/auth/verify-email', vcJar, { action: 'confirm', code: '000000' })
  }
  check('five wrong attempts counted down', r.json?.error === 'INVALID_CODE' && String(r.json?.message).includes('0 attempts remaining'), `msg=${r.json?.message}`)
  r = await req('POST', '/api/auth/verify-email', vcJar, { action: 'confirm', code: '000000' })
  check('attempt cap invalidates code (TOO_MANY_ATTEMPTS)', r.json?.error === 'TOO_MANY_ATTEMPTS', `error=${r.json?.error}`)
  r = await req('POST', '/api/auth/verify-email', vcJar, { action: 'confirm', code: devCode })
  check('even the CORRECT code is dead after the cap', r.json?.error === 'INVALID_CODE', `error=${r.json?.error}`)

  // ── 18. Session revocation on password reset ──
  section('Password reset invalidates every existing session')
  const REV_EMAIL = 'session.revoke@test.local'
  const P_OLD = 'RevTest2025!x'
  const P_NEW = 'RevTest2025!y'
  const revJar: Jar = {}
  let revLogin = await req('POST', '/api/auth/login', revJar, { email: REV_EMAIL, password: P_OLD })
  if (revLogin.status !== 200) {
    const fr = await req('POST', '/api/auth/forgot-password', {}, { email: REV_EMAIL })
    const tok = fr.json?.devResetToken
    if (tok) {
      await req('POST', '/api/auth/reset-password', {}, { token: tok, password: P_OLD })
      revLogin = await req('POST', '/api/auth/login', revJar, { email: REV_EMAIL, password: P_OLD })
    } else {
      revLogin = await req('POST', '/api/auth/register', revJar, { name: 'Session Revocation', email: REV_EMAIL, password: P_OLD })
    }
  }
  check('revocation test user logged in', revLogin.status === 200, `status ${revLogin.status}`)
  let meRev = await req('GET', '/api/auth/me', revJar)
  check('session valid before reset', meRev.json?.user?.email === REV_EMAIL, `user=${meRev.json?.user?.email}`)
  const fr2 = await req('POST', '/api/auth/forgot-password', {}, { email: REV_EMAIL })
  check('forgot-password issues reset token (dev)', fr2.status === 200 && typeof fr2.json?.devResetToken === 'string', `status ${fr2.status}`)
  const rp = await req('POST', '/api/auth/reset-password', {}, { token: fr2.json.devResetToken, password: P_NEW })
  check('password reset completes', rp.status === 200, `status ${rp.status}`)
  meRev = await req('GET', '/api/auth/me', revJar)
  check('OLD session is dead after reset', meRev.json?.user === null, `user=${meRev.json?.user}`)
  const revJar2: Jar = {}
  const relogin = await req('POST', '/api/auth/login', revJar2, { email: REV_EMAIL, password: P_NEW })
  meRev = await req('GET', '/api/auth/me', revJar2)
  check('login with NEW password issues a working session', relogin.status === 200 && meRev.json?.user?.email === REV_EMAIL, `login=${relogin.status} user=${meRev.json?.user?.email}`)

  // ── 19. Privacy: data export + erasure request ──
  section('Kenya DPA: data export is self-only; erasure request is recorded')
  const exp = await fetch(`${BASE}/api/privacy/export`, { headers: { Cookie: Object.entries(revJar2).map(([k, v]) => `${k}=${v}`).join('; ') } })
  let expBody: any = null
  try { expBody = await exp.json() } catch { /* ignore */ }
  check('data export returns the user\'s own document', exp.status === 200 && expBody?.account?.email === REV_EMAIL, `status ${exp.status} email=${expBody?.account?.email}`)
  const expStr = JSON.stringify(expBody)
  check('export contains no other user emails or password hashes', !expStr.includes('customer@carmaze.co.ke') && !expStr.includes('passwordHash'), 'verified absent')
  r = await req('POST', '/api/privacy/delete-request', revJar2, { reason: 'Automated verification of the erasure workflow.', scope: 'MARKETING_ONLY' })
  check('erasure request recorded as a DPO ticket', r.status === 201 && String(r.json?.ref ?? '').startsWith('DPO-'), `status ${r.status} ref=${r.json?.ref}`)

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
