/**
 * Evidence access control.
 *
 * EVIDENCE files (chat attachments, protection-incident evidence,
 * proof-of-delivery photos, custody handover/completion photos, supply-chain
 * dispute evidence) are stored PRIVATELY and served only to the case's
 * participants. The link between a file and its case is the entity row that
 * references the file URL/name, so authorization is derived from the data at
 * serving time — no separate grants table to fall out of sync.
 */
import { db } from '@/lib/db'

export type EvidenceVerdict = { allowed: boolean; reason?: string }

function mentions(raw: string | null | undefined, name: string): boolean {
  return Boolean(raw && raw.includes(name))
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : typeof x === 'object' && x !== null && 'url' in x ? String((x as { url: unknown }).url) : '')).filter(Boolean) : []
  } catch {
    return []
  }
}

async function isOrgMember(orgId: string, userId: string): Promise<boolean> {
  return Boolean(await db.orgMember.findFirst({ where: { orgId, userId }, select: { id: true } }))
}

/**
 * Can this user open this evidence file as a case participant?
 * (Owner and platform-staff checks are handled by the caller.)
 */
export async function isEvidenceParticipant(fileName: string, userId: string): Promise<EvidenceVerdict> {
  const needle = fileName // names are globally unique (userId.16hex.ext)

  // ── Chat attachments: message referencing the file inside a conversation
  // whose customer or org members the viewer is. ──
  const message = await db.conversationMessage.findFirst({
    where: {
      OR: [{ attachments: { contains: needle } }, { body: { contains: needle } }],
    },
    select: { conversation: { select: { orgId: true, customerId: true } } },
    orderBy: { createdAt: 'desc' },
  })
  if (message) {
    const { orgId, customerId } = message.conversation
    if (customerId === userId) return { allowed: true, reason: 'EVIDENCE_PARTICIPANT' }
    if (await isOrgMember(orgId, userId)) return { allowed: true, reason: 'EVIDENCE_PARTICIPANT' }
    // Found in a conversation, but this user is not a participant: deny
    // (do not fall through to other entity types).
    return { allowed: false, reason: 'NOT_AUTHORISED' }
  }

  // ── Protection-incident evidence ──
  const incident = await db.securityIncident.findFirst({
    where: { evidence: { contains: needle } },
    select: { reporterId: true, orgId: true },
  })
  if (incident) {
    if (incident.reporterId === userId) return { allowed: true, reason: 'EVIDENCE_PARTICIPANT' }
    if (incident.orgId && (await isOrgMember(incident.orgId, userId))) return { allowed: true, reason: 'EVIDENCE_PARTICIPANT' }
    return { allowed: false, reason: 'NOT_AUTHORISED' }
  }

  // ── Proof-of-delivery photos (logistics) ──
  const job = await db.deliveryJob.findFirst({
    where: { podPhotos: { contains: needle } },
    select: { requestedByUserId: true, requesterOrgId: true, partnerId: true, partner: { select: { ownerUserId: true } } },
  })
  if (job) {
    if (job.requestedByUserId === userId) return { allowed: true, reason: 'EVIDENCE_PARTICIPANT' }
    if (job.partner?.ownerUserId === userId) return { allowed: true, reason: 'EVIDENCE_PARTICIPANT' }
    if (job.requesterOrgId && (await isOrgMember(job.requesterOrgId, userId))) return { allowed: true, reason: 'EVIDENCE_PARTICIPANT' }
    return { allowed: false, reason: 'NOT_AUTHORISED' }
  }

  // ── Custody handover / completion photos ──
  const custody = await db.vehicleCustody.findFirst({
    where: { OR: [{ photos: { contains: needle } }, { completionPhotos: { contains: needle } }] },
    select: { customerId: true, orgId: true },
  })
  if (custody) {
    if (custody.customerId === userId) return { allowed: true, reason: 'EVIDENCE_PARTICIPANT' }
    if (await isOrgMember(custody.orgId, userId)) return { allowed: true, reason: 'EVIDENCE_PARTICIPANT' }
    return { allowed: false, reason: 'NOT_AUTHORISED' }
  }

  // ── Supply-chain dispute evidence (B2B purchase orders + B2C orders) ──
  const dispute = await db.dispute.findFirst({
    where: { evidence: { contains: needle } },
    select: { openedById: true, order: { select: { garageOrgId: true, supplierOrgId: true } }, customerOrder: { select: { buyerUserId: true, supplierOrgId: true } } },
  })
  if (dispute) {
    if (dispute.openedById === userId) return { allowed: true, reason: 'EVIDENCE_PARTICIPANT' }
    if (dispute.order) {
      if (await isOrgMember(dispute.order.garageOrgId, userId)) return { allowed: true, reason: 'EVIDENCE_PARTICIPANT' }
      if (await isOrgMember(dispute.order.supplierOrgId, userId)) return { allowed: true, reason: 'EVIDENCE_PARTICIPANT' }
    }
    if (dispute.customerOrder) {
      if (dispute.customerOrder.buyerUserId === userId) return { allowed: true, reason: 'EVIDENCE_PARTICIPANT' }
      if (await isOrgMember(dispute.customerOrder.supplierOrgId, userId)) return { allowed: true, reason: 'EVIDENCE_PARTICIPANT' }
    }
    return { allowed: false, reason: 'NOT_AUTHORISED' }
  }

  // Referenced by no known evidence entity.
  return { allowed: false, reason: 'NOT_AUTHORISED' }
}

export { mentions, parseJsonArray }
