/**
 * CARMAZE — FOUNDER account bootstrap (one-off, first-admin only).
 *
 * Purpose: mint the FIRST real admin (roles=FOUNDER) on a CLEAN production
 * database. It imports nothing: no demo accounts, no demo transactions, no
 * seed data. Run it after `prisma migrate deploy` on a fresh database.
 *
 * Usage (never commit credentials):
 *   FOUNDER_EMAIL=you@yourdomain.com \
 *   FOUNDER_NAME="Founder Full Name" \
 *   FOUNDER_PASSWORD='…≥12 chars…' \
 *   bun scripts/create-founder.ts
 *
 * Safety rails (all fail-closed):
 *  - refuses if any FOUNDER-role account already exists (one founder, ever)
 *  - refuses if the email is already registered
 *  - refuses if the database contains demo accounts or demo users — a
 *    production database must be clean; importing demo data into production
 *    is a deliberate, manual decision (override with FOUNDER_ALLOW_DEMO_DB=YES
 *    only if you fully understand the consequences)
 *  - password policy enforced locally; the raw password is never logged,
 *    never echoed back, and never stored (bcrypt hash only)
 *  - confirms what it is about to do and requires FOUNDER_CONFIRM=YES
 *  - writes an AuditLog row (FOUNDER_BOOTSTRAPPED) for the trail
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

function die(msg: string): never {
  console.error(`REFUSED: ${msg}`)
  process.exit(1)
}

function failFastEnv(name: string): string {
  const v = process.env[name]
  if (!v || !v.trim()) die(`${name} is required (and only ${name}, ${'FOUNDER_NAME'}, ${'FOUNDER_CONFIRM'} — no other secrets).`)
  return v.trim()
}

async function main() {
  const email = failFastEnv('FOUNDER_EMAIL').toLowerCase()
  const name = failFastEnv('FOUNDER_NAME')
  const password = failFastEnv('FOUNDER_PASSWORD')

  if (process.env.FOUNDER_CONFIRM !== 'YES') {
    die('set FOUNDER_CONFIRM=YES to confirm you are bootstrapping the first FOUNDER account.')
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) die(`${email} is not a valid email address.`)
  if (name.length < 2 || name.length > 80) die('FOUNDER_NAME must be 2-80 characters.')
  if (password.length < 12) die('FOUNDER_PASSWORD must be at least 12 characters.')
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    die('FOUNDER_PASSWORD must contain lower-case, upper-case, digit and symbol characters.')
  }

  const existingFounder = await db.user.findFirst({ where: { roles: { contains: 'FOUNDER' } } })
  if (existingFounder) die(`a FOUNDER account already exists (${existingFounder.email}). This script mints the FIRST founder only.`)

  const existingUser = await db.user.findUnique({ where: { email } })
  if (existingUser) die(`${email} is already registered. Choose a different founder email.`)

  const demoAccounts = await db.demoAccount.count()
  const demoUsers = await db.user.count({ where: { isDemo: true } })
  const users = await db.user.count()
  if ((demoAccounts > 0 || demoUsers > 0) && process.env.FOUNDER_ALLOW_DEMO_DB !== 'YES') {
    die(
      `this database already contains demo data (${demoAccounts} demo accounts, ${demoUsers} demo users, ${users} users total). ` +
      'A production FOUNDER must be bootstrapped on a CLEAN database created by `prisma migrate deploy`. ' +
      'If you deliberately want a founder on a demo-seeded database, set FOUNDER_ALLOW_DEMO_DB=YES.',
    )
  }

  const passwordHash = await bcrypt.hash(password, 10)

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email,
        name,
        passwordHash,
        roles: 'FOUNDER',
        department: null,
        isDemo: false,
        status: 'ACTIVE',
        emailVerified: true, // the founder email is controlled by the operator
      },
      select: { id: true, email: true, roles: true },
    })
    await tx.auditLog.create({
      data: {
        action: 'FOUNDER_BOOTSTRAP',
        actorId: created.id,
        actorName: created.name,
        targetType: 'USER',
        targetId: created.id,
        metadata: JSON.stringify({ email: created.email, source: 'scripts/create-founder.ts', cleanDb: demoAccounts === 0 && demoUsers === 0 }),
      },
    })
    return created
  })

  console.log('FOUNDER account created.')
  console.log(`  id:    ${user.id}`)
  console.log(`  email: ${user.email}`)
  console.log(`  roles: ${user.roles}`)
  console.log('Next: sign in via / → Sign In → email + password. Enable MFA immediately (Profile → Security).')
  console.log('The password is not stored in plaintext anywhere and was not printed. Keep the shell history clean if it was passed inline.')
}

main()
  .catch((e) => {
    console.error('FOUNDER bootstrap failed:', e instanceof Error ? e.message : e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
