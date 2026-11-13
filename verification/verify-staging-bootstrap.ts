/**
 * Staging bootstrap verification — reads a candidate fresh DB and prints
 * every contract check. Read-only; never mutates the database.
 * Usage: DATABASE_URL=file:/tmp/carmaze-staging.db bun verification/verify-staging-bootstrap.ts
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()
const pw = process.env.STAGING_TEST_PASSWORD ?? ''

async function main() {
  const out: Array<[string, boolean, string]> = []
  const chk = (name: string, ok: boolean, detail = '') => out.push([name, ok, detail])

  const users = await db.user.findMany({ select: { id: true, email: true, roles: true, isDemo: true, passwordHash: true, status: true, emailVerified: true } })
  chk('exactly one user', users.length === 1, `count=${users.length}`)
  const f = users[0]
  if (f) {
    chk('role is FOUNDER', f.roles === 'FOUNDER', `roles=${f.roles}`)
    chk('not demo-marked', f.isDemo === false, `isDemo=${f.isDemo}`)
    chk('bcrypt hash format', /^\$2[aby]\$10\$/.test(f.passwordHash), f.passwordHash.slice(0, 7) + '…')
    if (pw) chk('password hash verifies', await bcrypt.compare(pw, f.passwordHash))
    chk('plaintext password not stored', !f.passwordHash.includes(pw))
    chk('status ACTIVE', f.status === 'ACTIVE', `status=${f.status}`)
    chk('email verified', f.emailVerified === true)
  }
  chk('zero demo accounts', (await db.demoAccount.count()) === 0)
  chk('zero vehicles', (await db.vehicle.count()) === 0)
  chk('zero invoices', (await db.invoice.count()) === 0)
  chk('zero upload records', (await db.uploadRecord.count()) === 0)
  chk('zero settlements', (await db.settlement.count()) === 0)
  chk('zero purchase orders', (await db.purchaseOrder.count()) === 0)
  chk('zero customer orders', (await db.customerOrder.count()) === 0)
  const audits = await db.auditLog.findMany({ where: { action: 'FOUNDER_BOOTSTRAP' } })
  chk('exactly one FOUNDER_BOOTSTRAP audit row', audits.length === 1, `count=${audits.length}`)
  if (audits[0] && f) {
    chk('audit row links to founder', audits[0].actorId === f.id && audits[0].targetId === f.id)
  }

  console.log('\nSTAGING BOOTSTRAP VERIFICATION:')
  let bad = 0
  for (const [name, ok, detail] of out) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
    if (!ok) bad++
  }
  console.log(bad === 0 ? 'ALL CHECKS PASS' : `${bad} CHECK(S) FAILED`)
  if (bad) process.exit(1)
}
main().finally(() => db.$disconnect())
