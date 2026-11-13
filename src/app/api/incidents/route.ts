import { NextRequest } from 'next/server'
import { z } from 'zod'
import { isUploadUrl } from '@/lib/upload-url'
import { db } from '@/lib/db'
import { route, ok, fail, ApiError, requireUser, parseBody } from '@/lib/api'
import { hasRole, STAFF_ROLES } from '@/lib/auth'
import { rateLimit } from '@/lib/rate-limit'
import { refCode } from '@/lib/ids'
import { audit } from '@/lib/audit'
import { notifyMany } from '@/lib/notify'
import { staffUserIds } from '@/lib/orgs'
import { assertNotDemoStaffRead } from '@/lib/demo'

export const dynamic = 'force-dynamic'

const CATEGORIES = [
  'STOLEN_VEHICLE',
  'MISSING_FROM_GARAGE',
  'TEST_DRIVE_NOT_RETURNED',
  'UNAUTHORISED_USE',
  'UNAUTHORISED_RELEASE',
  'DAMAGE_IN_CUSTODY',
  'MISSING_PROPERTY',
  'OWNERSHIP_FRAUD',
  'FAKE_DOCS',
  'MISCONDUCT',
  'CUSTOMER_FRAUD',
  'OTHER',
] as const

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1, LOW: 0 }

export const SAFETY_NOTE =
  'If you believe a vehicle has been stolen, contact the police immediately. CARMAZE is not an emergency service.'

const createSchema = z.object({
  category: z.enum(CATEGORIES),
  title: z.string().trim().min(5).max(200),
  details: z.string().trim().min(20).max(8000),
  vehicleDesc: z.string().trim().max(200).optional(),
  orgId: z.string().min(1).optional(),
  custodyId: z.string().min(1).optional(),
  testDriveId: z.string().min(1).optional(),
  evidence: z.array(z.string().trim().min(1).max(500).refine(isUploadUrl, { message: 'Evidence must reference an uploaded file' })).max(6).optional(),
})

/**
 * POST: report a security incident (any authenticated user).
 * Staff and the involved org owner are notified; the response always carries
 * a safety note because some categories (stolen vehicle) are police matters.
 */
export const POST = route(async (req: NextRequest) => {
  const user = await requireUser()
  const rl = rateLimit(`incident-create:${user.id}`, 5, 60 * 60 * 1000)
  if (!rl.allowed) return fail(429, 'RATE_LIMITED', 'Too many incident reports. Try again later.')

  const body = await parseBody(req, createSchema)

  if (body.orgId) {
    const org = await db.org.findUnique({ where: { id: body.orgId }, select: { id: true } })
    if (!org) throw new ApiError(404, 'NOT_FOUND', 'Organisation not found.')
  }
  if (body.custodyId) {
    const custody = await db.vehicleCustody.findUnique({ where: { id: body.custodyId }, select: { id: true } })
    if (!custody) throw new ApiError(404, 'NOT_FOUND', 'Custody record not found.')
  }
  if (body.testDriveId) {
    const testDrive = await db.testDrive.findUnique({ where: { id: body.testDriveId }, select: { id: true } })
    if (!testDrive) throw new ApiError(404, 'NOT_FOUND', 'Test drive not found.')
  }

  // Reporting on behalf of an org the user belongs to counts as an ORG report.
  const reporterSide = body.orgId
    ? (await db.orgMember.findFirst({ where: { orgId: body.orgId, userId: user.id } }))
      ? 'ORG'
      : 'CUSTOMER'
    : 'CUSTOMER'

  const incident = await db.securityIncident.create({
    data: {
      refCode: refCode('INC-'),
      category: body.category,
      reporterId: user.id,
      reporterSide,
      orgId: body.orgId ?? null,
      custodyId: body.custodyId ?? null,
      testDriveId: body.testDriveId ?? null,
      vehicleDesc: body.vehicleDesc ?? null,
      title: body.title,
      details: body.details,
      evidence: body.evidence ? JSON.stringify(body.evidence) : null,
      status: 'OPEN',
      severity: 'MEDIUM',
    },
  })

  await db.incidentEvent.create({
    data: {
      incidentId: incident.id,
      type: 'CREATED',
      actorId: user.id,
      actorName: user.name,
      note: `Incident reported (${body.category}).`,
    },
  })

  const staff = await staffUserIds('ADMIN', 'FOUNDER', 'SUPPORT')
  await notifyMany(staff, {
    type: 'INCIDENT_CREATED',
    title: `New security incident: ${incident.refCode}`,
    body: `${body.category.replace(/_/g, ' ').toLowerCase()} reported by ${user.name}: ${body.title}`,
    link: '/admin?tab=incidents',
  })

  if (body.orgId) {
    const owners = await db.orgMember.findMany({ where: { orgId: body.orgId, role: 'OWNER' }, select: { userId: true } })
    await notifyMany(owners.map((o) => o.userId), {
      type: 'INCIDENT_CREATED',
      title: `Security incident involving your business: ${incident.refCode}`,
      body: `${user.name} reported: ${body.title}`,
      link: '/garage-dashboard?tab=incidents',
    })
  }

  await audit({
    actorId: user.id,
    actorName: user.name,
    action: 'INCIDENT_REPORTED',
    targetType: 'SECURITY_INCIDENT',
    targetId: incident.id,
    metadata: { refCode: incident.refCode, category: body.category, reporterSide },
  })

  return ok({
    incident: { id: incident.id, refCode: incident.refCode, category: incident.category, status: incident.status, severity: incident.severity, createdAt: incident.createdAt.toISOString() },
    safetyNote: SAFETY_NOTE,
  })
})

function listShape(i: {
  id: string
  refCode: string
  category: string
  title: string
  status: string
  severity: string
  createdAt: Date
  reporter: { name: string }
  vehicleDesc: string | null
}, orgName: string | null) {
  return {
    id: i.id,
    refCode: i.refCode,
    category: i.category,
    title: i.title,
    status: i.status,
    severity: i.severity,
    createdAt: i.createdAt.toISOString(),
    reporterName: i.reporter.name,
    orgName,
    vehicleDesc: i.vehicleDesc,
  }
}

/**
 * GET ?mine=1 (own reports) | ?org=1 (incidents involving the user's orgs) |
 * ?queue=1 (security staff queue: OPEN first, severity desc, newest first).
 */
export const GET = route(async (req: NextRequest) => {
  const user = await requireUser()
  const url = new URL(req.url)

  const withOrgNames = async (incidents: (Parameters<typeof listShape>[0] & { orgId: string | null })[]) => {
    const orgIds = [...new Set(incidents.map((i) => i.orgId).filter((v): v is string => Boolean(v)))]
    const orgs = orgIds.length ? await db.org.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }) : []
    const nameById = new Map(orgs.map((o) => [o.id, o.name]))
    return incidents.map((i) => listShape(i, i.orgId ? nameById.get(i.orgId) ?? null : null))
  }

  if (url.searchParams.get('mine') === '1') {
    const incidents = await db.securityIncident.findMany({
      where: { reporterId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { reporter: { select: { name: true } } },
    })
    return ok({ incidents: await withOrgNames(incidents) })
  }

  if (url.searchParams.get('org') === '1') {
    const memberships = await db.orgMember.findMany({ where: { userId: user.id }, select: { orgId: true } })
    const incidents = await db.securityIncident.findMany({
      where: { orgId: { in: memberships.map((m) => m.orgId) } },
      orderBy: { createdAt: 'desc' },
      include: { reporter: { select: { name: true } } },
    })
    return ok({ incidents: await withOrgNames(incidents) })
  }

  if (url.searchParams.get('queue') === '1') {
    if (!hasRole(user, ...STAFF_ROLES)) {
      throw new ApiError(403, 'FORBIDDEN', 'Only CARMAZE staff can view the incident queue.')
    }
    // The queue surfaces real reporters' names and real business incidents —
    // closed to demo sessions like every other real-PII staff view.
    assertNotDemoStaffRead(user, 'the security incident queue')
    const incidents = await db.securityIncident.findMany({
      orderBy: [{ createdAt: 'desc' }],
      include: { reporter: { select: { name: true } } },
    })
    incidents.sort(
      (a, b) =>
        Number(a.status === 'OPEN') - Number(b.status === 'OPEN') ||
        (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0) ||
        b.createdAt.getTime() - a.createdAt.getTime()
    )
    return ok({ incidents: await withOrgNames(incidents) })
  }

  return fail(400, 'VALIDATION_ERROR', 'Provide ?mine=1, ?org=1 or ?queue=1.')
})
