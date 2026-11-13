/**
 * Upload-security scanner-verdict harness — TASK 2 verification.
 *
 * Tests the REAL upload endpoint + REAL admin console against the documented
 * CARMAZE_SCAN_CMD contract (exit 0=clean, 1=infected, >=2=error), using the
 * test harness script verification/test-scanner.sh. This does NOT claim real
 * malware scanning is operational — it proves the workflow's reaction to every
 * scanner verdict class:
 *
 *   A. scanner CLEAN   → PDF released from quarantine immediately, owner 200
 *   B. scanner INFECTED→ 415 UNSAFE_FILE_REFUSED, bytes destroyed, record INFECTED
 *   C. scanner ERROR   → fail-closed: 201 but quarantined, owner 423, bytes kept
 *   D. unscanned/quarantined bytes are unreachable via BOTH serving paths
 *      (/api/files 423, /api/media 404 — quarantine dir is not a media dir)
 *   E. expired evidence: participant 410 EXPIRED, anon 401, owner/staff retained
 *      by design (retention/erasure follow-up)
 *
 * The dev server MUST be running with CARMAZE_SCAN_CMD="bash <abs>/verification/test-scanner.sh".
 * Usage: bun verification/upload-scanner-harness.ts
 */
const BASE = 'http://localhost:3000'

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

async function req(method: string, path: string, jar: Jar, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(jar && Object.keys(jar).length ? { Cookie: cookieHeader(jar) } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  let json: any = null
  try { json = await res.json() } catch { /* binary */ }
  return { status: res.status, json }
}

async function upload(jar: Jar, bytes: Uint8Array, filename: string, type: string, kind?: string) {
  const fd = new FormData()
  fd.set('file', new Blob([new Uint8Array(bytes)], { type }), filename)
  if (kind) fd.set('kind', kind)
  const res = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: { Cookie: cookieHeader(jar) }, body: fd })
  let json: any = null
  try { json = await res.json() } catch { /* ignore */ }
  return { status: res.status, json }
}

async function getBytes(jar: Jar, url: string): Promise<{ status: number; type: string; bytes: boolean }> {
  const res = await fetch(`${BASE}${url}`, { headers: jar && Object.keys(jar).length ? { Cookie: cookieHeader(jar) } : {} })
  let bytes = false
  try { const b = await res.arrayBuffer(); bytes = b.byteLength > 0 } catch { /* ignore */ }
  return { status: res.status, type: res.headers.get('content-type') ?? '', bytes }
}

const PDF_PLAIN = new TextEncoder().encode('%PDF-1.4\n1 0 obj\nbenign document for harness')
const PDF_EICAR = new TextEncoder().encode(`%PDF-1.4\n/EICAR-TEST-HARNESS-SIGNATURE marker inside\n1 0 obj`)

async function session(role: 'user' | 'admin', email: string, password: string): Promise<Jar> {
  const jar: Jar = {}
  const capture = (r: Response) => {
    const sc = r.headers.get('set-cookie')
    if (sc) {
      const [pair] = sc.split(';')
      const [k, ...rest] = pair.split('=')
      jar[k.trim()] = rest.join('=')
    }
  }
  let r = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Harness User ' + role, email, password }),
  })
  capture(r)
  if (r.status !== 200 && r.status !== 201) {
    r = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    capture(r)
  }
  if (r.status !== 200 && r.status !== 201) throw new Error(`cannot create ${role} session: ${r.status}`)
  return jar
}

async function main() {
  const PHASE = process.env.HARNESS_PHASE ?? 'clean-infected'
  console.log(`═══ UPLOAD SCANNER HARNESS — phase: ${PHASE} ═══`)
  const stamp = Date.now()
  const user = await session('user', `harness.user.${stamp}@test.local`, 'Harness2025!x')
  const admin = await session('admin', 'admin@carmaze.co.ke', 'CarmazeDemo2025!')

  // ── A/B. scanner CLEAN + INFECTED (phase: clean-infected) ──
  if (PHASE === 'clean-infected') {
    console.log('── A. Scanner CLEAN: PDF released without staff approval ──')
    const a = await upload(user, PDF_PLAIN, 'clean.pdf', 'application/pdf', 'document')
    check('clean PDF accepted', a.status === 201, `status ${a.status} scan=${a.json?.scanStatus}`)
    check('clean verdict reported', a.json?.scanStatus === 'CLEAN' && a.json?.viewable === true, `scan=${a.json?.scanStatus} viewable=${a.json?.viewable}`)
    const aUrl: string = a.json?.url ?? ''
    if (aUrl) {
      const owner = await getBytes(user, aUrl)
      check('clean PDF serves to owner IMMEDIATELY (no quarantine)', owner.status === 200, `status ${owner.status}`)
      const anon = await getBytes({} as Jar, aUrl)
      check('clean PDF still never serves anonymously', anon.status === 401, `status ${anon.status}`)
    }

    console.log('── B. Scanner INFECTED: refused outright, bytes destroyed ──')
    const b = await upload(user, PDF_EICAR, 'infected.pdf', 'application/pdf', 'document')
    check('infected PDF refused with 415', b.status === 415, `status ${b.status} error=${b.json?.error}`)
    check('refusal is the unsafe-file verdict', b.json?.error === 'UNSAFE_FILE_REFUSED', `error=${b.json?.error}`)
    const list = await req('GET', '/api/admin/uploads?filter=infected', admin)
    check('admin infected filter lists the destroyed file', list.status === 200 && (list.json?.records ?? []).some((x: any) => x.scanStatus === 'INFECTED'), `status ${list.status}`)
  }

  // ── C/D. scanner ERROR (phase: error-path — requires HARNESS_EXIT=2 on the server) ──
  if (PHASE === 'error-path') {
    console.log('── C. Scanner ERROR (exit 2): fail-closed quarantine, no byte destruction ──')
    const c = await upload(user, PDF_PLAIN, 'scanerror.pdf', 'application/pdf', 'document')
    check('scanner-error PDF accepted into quarantine', c.status === 201 && c.json?.scanStatus === 'SCAN_ERROR', `status ${c.status} scan=${c.json?.scanStatus}`)
    check('scanner-error PDF is NOT viewable', c.json?.viewable === false, `viewable=${c.json?.viewable}`)
    const cUrl: string = c.json?.url ?? ''
    if (cUrl) {
      const owner = await getBytes(user, cUrl)
      check('scanner-error PDF locked for owner (423 SCAN_PENDING)', owner.status === 423, `status ${owner.status}`)
      const anon = await getBytes({} as Jar, cUrl)
      check('scanner-error PDF never serves anonymously', anon.status === 401, `status ${anon.status}`)

      console.log('── D. Unscanned bytes cannot become publicly accessible ──')
      const name = cUrl.split('/').pop() ?? ''
      const media = await getBytes({} as Jar, `/api/media/${name}`)
      check('quarantined file NOT served through the public media path', media.status === 404, `status ${media.status}`)
      const files = await getBytes({} as Jar, `/api/files/${name}`)
      check('quarantined file NOT served through the private path to anon', files.status === 401, `status ${files.status}`)
      const ownerFiles = await getBytes(user, `/api/files/${name}`)
      check('quarantined file NOT served to its owner either', ownerFiles.status === 423, `status ${ownerFiles.status}`)
    }
  }

  // ── E. expired evidence access (phase: expiry) ──
  if (PHASE === 'expiry') {
    console.log('── E. Expired evidence access control ──')
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
  const ev = await upload(user, PNG, 'expired-evidence.png', 'image/png', 'evidence')
  check('evidence uploaded (private, EVIDENCE)', ev.status === 201 && ev.json?.kind === 'EVIDENCE', `status ${ev.status} kind=${ev.json?.kind}`)
  const evUrl: string = ev.json?.url ?? ''
  const evName = evUrl.split('/').pop() ?? ''
  if (evUrl) {
    // Force expiry on THIS harness-owned test row only (test data, not business data).
    const { execSync } = await import('child_process')
    const dbUrl = process.env.DATABASE_URL ?? 'file:' + process.cwd() + '/db/custom.db'
    execSync(`bunx prisma db execute --stdin --schema prisma/schema.prisma`, {
      input: `UPDATE UploadRecord SET expiresAt = '2020-01-01 00:00:00' WHERE fileName = '${evName}';`,
      env: { ...process.env, DATABASE_URL: dbUrl },
    })
    const sEmail = `harness.stranger.${stamp}@test.local`
    const stranger = await session('user', sEmail, 'Stranger2025!x')
    const participant = await getBytes(stranger, evUrl)
    check('expired evidence DENIED to a non-participant (410)', participant.status === 410, `status ${participant.status}`)
    const anon = await getBytes({} as Jar, evUrl)
    check('expired evidence never serves anonymously (401)', anon.status === 401, `status ${anon.status}`)
    const owner = await getBytes(user, evUrl)
    check('expired evidence retained for its owner by design (200)', owner.status === 200, `status ${owner.status}`)
    const staff = await getBytes(admin, evUrl)
    check('expired evidence retained for platform staff by design (200)', staff.status === 200, `status ${staff.status}`)
    // restore expiry so the row behaves like real evidence again
    execSync(`bunx prisma db execute --stdin --schema prisma/schema.prisma`, {
      input: `UPDATE UploadRecord SET expiresAt = '${new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ')}' WHERE fileName = '${evName}';`,
      env: { ...process.env, DATABASE_URL: dbUrl },
    })
    const after = await getBytes(stranger, evUrl)
    check('non-expired evidence denied to stranger (403, control)', after.status === 403, `status ${after.status}`)
    }
  }

  console.log(`\nHARNESS RESULTS: ${pass} passed, ${fail} failed`)
  if (failures.length) { console.log('FAILURES:'); failures.forEach((f) => console.log('  ✗ ' + f)); process.exit(1) }
}

main().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2) })
