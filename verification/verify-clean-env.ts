/**
 * TASK 3 verification — runs against a server booted on a FRESH staging DB
 * (created by prisma migrate deploy + founder bootstrap, zero demo rows).
 *
 * Proves:
 *   1. the app functions with NO demo accounts at all (health, register,
 *      login, vehicles list, upload — no demo data is load-bearing)
 *   2. an ordinary registered user cannot bootstrap itself into platform
 *      administration (role-escalation attempts all refused, roles unchanged)
 *   3. the demo-signin path honestly fails on a DB without demo accounts
 *
 * Usage: bun verification/verify-clean-env.ts
 */
const BASE = 'http://localhost:3000'
type Jar = Record<string, string>

let pass = 0, fail = 0
const failures: string[] = []
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`)
  if (ok) pass++; else { fail++; failures.push(name) }
}

function cookieOf(r: Response): string {
  const sc = r.headers.get('set-cookie')
  if (!sc) return ''
  const [pair] = sc.split(';')
  return pair
}

async function jreq(method: string, path: string, cookie: string, body?: unknown): Promise<{ status: number; json: any; setCookie: string }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json: any = null
  try { json = await res.json() } catch { /* ignore */ }
  return { status: res.status, json, setCookie: cookieOf(res) }
}

async function main() {
  console.log('═══ CLEAN-ENVIRONMENT VERIFICATION (fresh staging DB) ═══')
  const stamp = Date.now()

  // ── 1. app functions with zero demo accounts ──
  const health = await jreq('GET', '/api/health', '')
  check('health OK on a demo-free database', health.status === 200 && health.json?.checks?.database === 'connected', `status ${health.status} db=${health.json?.checks?.database}`)
  const reg = await jreq('POST', '/api/auth/register', '', { name: 'Clean Env User', email: `clean.env.${stamp}@test.local`, password: 'CleanEnv2025!x' })
  const cookie = reg.setCookie
  check('registration works on a demo-free database', reg.status === 200 || reg.status === 201, `status ${reg.status}`)
  const me = await jreq('GET', '/api/auth/me', cookie)
  check('session works; new user is NOT demo-marked', me.status === 200 && me.json?.user?.isDemo === false, `status ${me.status} isDemo=${me.json?.user?.isDemo}`)
  const roles: string[] = me.json?.user?.roles ?? []
  check('new user has NO platform-administration role', !roles.some((r) => ['ADMIN', 'FOUNDER', 'MODERATOR', 'REVIEWER', 'FINANCE', 'SUPPORT'].includes(r)), `roles=${roles.join(',')}`)
  const vehicles = await jreq('GET', '/api/vehicles', '')
  check('marketplace query works (empty, no crash) on demo-free DB', vehicles.status === 200 && Array.isArray(vehicles.json?.vehicles ?? vehicles.json), `status ${vehicles.status}`)
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
  const fd = new FormData()
  fd.set('file', new Blob([new Uint8Array(PNG)], { type: 'image/png' }), 'clean-env.png')
  const up = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: { Cookie: cookie }, body: fd })
  check('upload pipeline works on a demo-free database', up.status === 201, `status ${up.status}`)

  // ── 2. ordinary user cannot self-bootstrap into administration ──
  console.log('── role-escalation attempts (must all be refused) ──')
  const esc1 = await jreq('GET', '/api/admin/users', cookie)
  check('admin users console refused', esc1.status === 403, `status ${esc1.status}`)
  const esc2 = await jreq('PATCH', '/api/admin/users', cookie, { id: me.json?.user?.id ?? 'x', status: 'ACTIVE' })
  check('admin users mutation endpoint refused (roles are not even mutable via this API)', esc2.status === 403, `status ${esc2.status}`)
  const esc3 = await jreq('GET', '/api/applications?scope=queue', cookie)
  check('application review queue refused', esc3.status === 403, `status ${esc3.status}`)
  const esc4 = await jreq('PATCH', '/api/applications/nonexistent', cookie, { action: 'approve' })
  check('self-approval of an application refused', esc4.status === 403 || esc4.status === 404, `status ${esc4.status}`)
  const esc5 = await jreq('POST', '/api/admin/supply', cookie, { action: 'approve-application', applicationId: 'nonexistent' })
  check('supplier-application approval endpoint refused', esc5.status === 403, `status ${esc5.status}`)
  const esc6 = await jreq('POST', '/api/admin/settlements/nonexistent/action', cookie, { action: 'reconcile' })
  check('settlement action endpoint refused', esc6.status === 403, `status ${esc6.status}`)
  const esc7 = await jreq('PATCH', '/api/admin/listings', cookie, { id: 'nonexistent', action: 'approve' })
  check('listing moderation endpoint refused', esc7.status === 403, `status ${esc7.status}`)
  const esc8 = await jreq('GET', '/api/admin/uploads', cookie)
  check('upload review console refused', esc8.status === 403, `status ${esc8.status}`)
  const meAfter = await jreq('GET', '/api/auth/me', cookie)
  const rolesAfter: string[] = meAfter.json?.user?.roles ?? []
  check('roles unchanged after every escalation attempt', !rolesAfter.some((r) => ['ADMIN', 'FOUNDER', 'MODERATOR', 'REVIEWER', 'FINANCE', 'SUPPORT'].includes(r)), `roles=${rolesAfter.join(',')}`)

  // ── 3. demo path honestly unavailable on a demo-free DB ──
  console.log('── demo-signin path on a demo-free database ──')
  const demo = await jreq('POST', '/api/auth/demo', '', { role: 'customer' })
  check('demo sign-in honestly fails with no demo accounts seeded', demo.status >= 400 && demo.status < 500, `status ${demo.status} error=${demo.json?.error ?? demo.json?.message?.slice(0, 60)}`)

  console.log(`\nCLEAN-ENV RESULTS: ${pass} passed, ${fail} failed`)
  if (failures.length) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1) }
}

main().catch((e) => { console.error('CLEAN-ENV ERROR:', e); process.exit(2) })
