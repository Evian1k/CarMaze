// CARMAZE — Automotive Supply Network core domain library.
// Tenancy guards, role permissions, fee configuration, stock reservations
// and event writers shared by every supply API route.
//
// PERMISSION MODEL (enforced server-side, never only in the UI):
//   Supplier: OWNER/OPERATIONS manage catalogue+orders; WAREHOUSE manages
//   stock & dispatch; SALES quotes; ACCOUNTANT read-only finance.
//   Garage:   OWNER/GM manage everything; PROCUREMENT orders within limits;
//   MECHANIC/INVENTORY read catalogue; ACCOUNTANT read-only finance.
//   Approval gates: POs above org.poApprovalThresholdMinor require OWNER/GM.

import { db } from '@/lib/db'
import { ApiError } from '@/lib/api'
import type { SessionUser } from '@/lib/auth'

// ───────────────────────── Business role permissions ─────────────────────────

export const SUPPLIER_ROLES = ['OWNER', 'OPERATIONS', 'WAREHOUSE', 'SALES', 'PROCUREMENT', 'ACCOUNTANT'] as const
export const GARAGE_BIZ_ROLES = ['OWNER', 'GM', 'BRANCH_MANAGER', 'PROCUREMENT', 'MECHANIC', 'ACCOUNTANT', 'INVENTORY'] as const

export type SupplyAction =
  | 'catalogue.write'      // create/update products, branches
  | 'catalogue.read'
  | 'stock.write'          // inventory adjustments, restock
  | 'stock.read'
  | 'order.respond'        // supplier: accept/reject/revise/dispatch
  | 'order.create'         // garage: create & submit POs
  | 'order.approve'        // garage owner-level PO approval
  | 'order.read'
  | 'delivery.arrange'
  | 'payment.initiate'
  | 'dispute.open'
  | 'finance.read'

const MATRIX: Record<SupplyAction, string[][]> = {
  // [supplierRoles, garageRoles] — an empty list means that side can't act
  'catalogue.write': [['OWNER', 'OPERATIONS'], []],
  'catalogue.read': [['OWNER', 'OPERATIONS', 'WAREHOUSE', 'SALES', 'PROCUREMENT', 'ACCOUNTANT'], ['OWNER', 'GM', 'BRANCH_MANAGER', 'PROCUREMENT', 'MECHANIC', 'ACCOUNTANT', 'INVENTORY']],
  'stock.write': [['OWNER', 'OPERATIONS', 'WAREHOUSE'], ['OWNER', 'GM', 'INVENTORY']],
  'stock.read': [['OWNER', 'OPERATIONS', 'WAREHOUSE', 'SALES', 'PROCUREMENT', 'ACCOUNTANT'], ['OWNER', 'GM', 'BRANCH_MANAGER', 'PROCUREMENT', 'MECHANIC', 'ACCOUNTANT', 'INVENTORY']],
  'order.respond': [['OWNER', 'OPERATIONS', 'WAREHOUSE'], []],
  'order.create': [[], ['OWNER', 'GM', 'PROCUREMENT']],
  'order.approve': [[], ['OWNER', 'GM']],
  'order.read': [['OWNER', 'OPERATIONS', 'WAREHOUSE', 'SALES', 'PROCUREMENT', 'ACCOUNTANT'], ['OWNER', 'GM', 'BRANCH_MANAGER', 'PROCUREMENT', 'MECHANIC', 'ACCOUNTANT', 'INVENTORY']],
  'delivery.arrange': [['OWNER', 'OPERATIONS', 'WAREHOUSE'], ['OWNER', 'GM', 'PROCUREMENT']],
  'payment.initiate': [[], ['OWNER', 'GM', 'PROCUREMENT', 'ACCOUNTANT']],
  'dispute.open': [['OWNER', 'OPERATIONS'], ['OWNER', 'GM', 'PROCUREMENT']],
  'finance.read': [['OWNER', 'OPERATIONS', 'ACCOUNTANT'], ['OWNER', 'GM', 'ACCOUNTANT']],
}

export function roleCan(side: 'SUPPLIER' | 'GARAGE', role: string, action: SupplyAction): boolean {
  const idx = side === 'SUPPLIER' ? 0 : 1
  const allowed = MATRIX[action]?.[idx] ?? []
  return allowed.includes(role)
}

export type OrgContext = {
  orgId: string
  orgType: string
  orgName: string
  memberRole: string
  org: { id: string; type: string; name: string; verified: boolean; status: string; poApprovalThresholdMinor: number | null }
}

/**
 * Resolve the acting user's org membership for the given org id, enforcing
 * type and status. This is the single tenancy gate — every supply endpoint
 * resolves access through it. Users only ever see data for orgs they belong to.
 */
export async function requireOrgMember(
  user: SessionUser,
  orgId: string,
  action?: SupplyAction
): Promise<OrgContext> {
  const membership = await db.orgMember.findFirst({
    where: { orgId, userId: user.id },
    include: { org: { select: { id: true, type: true, name: true, verified: true, status: true, poApprovalThresholdMinor: true } } },
  })
  if (!membership || membership.org.status !== 'ACTIVE') {
    throw new ApiError(403, 'NOT_A_MEMBER', 'You are not an authorised member of this business.')
  }
  const side = membership.org.type === 'SUPPLIER' ? 'SUPPLIER' : 'GARAGE'
  if (action && !roleCan(side as 'SUPPLIER' | 'GARAGE', membership.role, action)) {
    throw new ApiError(403, 'PERMISSION_DENIED', `Your role (${membership.role}) is not permitted to perform this action.`)
  }
  return {
    orgId: membership.orgId,
    orgType: membership.org.type,
    orgName: membership.org.name,
    memberRole: membership.role,
    org: membership.org,
  }
}

/** Find the user's active org of a given type (their "own" business). */
export async function getOwnOrg(user: SessionUser, type: 'SUPPLIER' | 'GARAGE' | 'DEALER'): Promise<OrgContext | null> {
  const membership = await db.orgMember.findFirst({
    where: { userId: user.id, org: { type, status: 'ACTIVE' } },
    include: { org: { select: { id: true, type: true, name: true, verified: true, status: true, poApprovalThresholdMinor: true } } },
    orderBy: { createdAt: 'asc' },
  })
  if (!membership) return null
  return {
    orgId: membership.orgId,
    orgType: membership.org.type,
    orgName: membership.org.name,
    memberRole: membership.role,
    org: membership.org,
  }
}

/** Same as getOwnOrg but throws when absent. */
export async function requireOwnOrg(user: SessionUser, type: 'SUPPLIER' | 'GARAGE' | 'DEALER', action?: SupplyAction): Promise<OrgContext> {
  const ctx = await getOwnOrg(user, type)
  if (!ctx) throw new ApiError(403, 'NO_BUSINESS', `You need an active ${type.toLowerCase()} business to do this.`)
  if (action && !roleCan(type === 'SUPPLIER' ? 'SUPPLIER' : 'GARAGE', ctx.memberRole, action)) {
    throw new ApiError(403, 'PERMISSION_DENIED', `Your role (${ctx.memberRole}) is not permitted to perform this action.`)
  }
  return ctx
}

// ───────────────────────── Platform fee configuration ─────────────────────────
// Stored in SystemSetting as JSON so the super admin can change it without a
// deployment. Defaults are proposals, not permanent prices.

export type SupplyFees = {
  supplyCommissionPct: number    // % of order subtotal taken as platform commission
  deliveryCommissionPct: number  // % of delivery fee
  minCommissionMinor: number     // floor per order
  vehicleSaleCommissionPct: number
  bookingCommissionPct: number
  membershipPlatformFeePct: number
}

const DEFAULT_FEES: SupplyFees = {
  supplyCommissionPct: 3,
  deliveryCommissionPct: 5,
  minCommissionMinor: 5000,
  vehicleSaleCommissionPct: 1.5,
  bookingCommissionPct: 2,
  membershipPlatformFeePct: 5,
}

export async function getFees(): Promise<SupplyFees> {
  const row = await db.systemSetting.findUnique({ where: { key: 'platform_fees' } })
  if (!row) return { ...DEFAULT_FEES }
  try {
    return { ...DEFAULT_FEES, ...JSON.parse(row.value) } as SupplyFees
  } catch {
    return { ...DEFAULT_FEES }
  }
}

export async function setFees(fees: SupplyFees): Promise<void> {
  const value = JSON.stringify(fees)
  await db.systemSetting.upsert({
    where: { key: 'platform_fees' },
    create: { key: 'platform_fees', value },
    update: { value },
  })
}

export function computeCommission(subtotalMinor: number, ratePct: number, minMinor: number): number {
  const raw = Math.round((subtotalMinor * ratePct) / 100)
  if (subtotalMinor <= 0) return 0
  return Math.max(Math.min(raw, subtotalMinor), minMinor)
}

// ───────────────────────── Money helpers ─────────────────────────

export function money(minor: number, currency = 'KES'): string {
  return `${currency} ${(minor / 100).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`
}

// ───────────────────────── Order lifecycle constants ─────────────────────────

export const PO_ACTIVE_STATUSES = ['SUBMITTED', 'AWAITING_APPROVAL', 'ACCEPTED', 'REVISED', 'CONFIRMED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'INSPECTED', 'DISPUTED'] as const

export const PO_STATUS_LABELS: Record<string, string> = {
  SUBMITTED: 'Submitted — awaiting supplier',
  AWAITING_APPROVAL: 'Awaiting management approval',
  ACCEPTED: 'Accepted by supplier',
  REVISED: 'Revised — awaiting your approval',
  REJECTED: 'Rejected by supplier',
  CONFIRMED: 'Confirmed — arrange payment',
  DISPATCHED: 'Dispatched',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered — inspect to release',
  INSPECTED: 'Inspected',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  DISPUTED: 'Under dispute',
}

// ───────────────────────── Event writers ─────────────────────────

export async function poEvent(orderId: string, params: {
  type: string
  actorId?: string | null
  actorName: string
  actorSide: 'GARAGE' | 'SUPPLIER' | 'SYSTEM' | 'ADMIN'
  note?: string
}): Promise<void> {
  await db.pOEvent.create({
    data: {
      orderId,
      type: params.type,
      actorId: params.actorId ?? null,
      actorName: params.actorName,
      actorSide: params.actorSide,
      note: params.note ?? null,
    },
  })
}

export async function deliveryEvent(deliveryId: string, params: {
  type: string
  actorId?: string | null
  actorName: string
  actorSide: 'GARAGE' | 'SUPPLIER' | 'SYSTEM' | 'ADMIN'
  note?: string
}): Promise<void> {
  await db.deliveryEvent.create({
    data: {
      deliveryId,
      type: params.type,
      actorId: params.actorId ?? null,
      actorName: params.actorName,
      actorSide: params.actorSide,
      note: params.note ?? null,
    },
  })
}

// ───────────────────────── Stock operations ─────────────────────────
// Reservations prevent overselling: qtyOnHand is physical stock, qtyReserved
// is held for open orders. Available = qtyOnHand - qtyReserved.

export async function reserveStock(productId: string, branchId: string, qty: number, ref: { type: string; id: string; actorId?: string; actorName?: string }): Promise<void> {
  await db.$transaction(async (tx) => {
    const stock = await tx.productStock.findUnique({ where: { productId_branchId: { productId, branchId } } })
    if (!stock) throw new ApiError(409, 'STOCK_NOT_TRACKED', 'This product is not stocked at the selected warehouse.')
    const available = stock.qtyOnHand - stock.qtyReserved
    if (qty > available) {
      throw new ApiError(409, 'INSUFFICIENT_STOCK', `Only ${available} unit(s) available at this warehouse.`)
    }
    await tx.productStock.update({
      where: { productId_branchId: { productId, branchId } },
      data: { qtyReserved: { increment: qty } },
    })
    await tx.stockMovement.create({
      data: { branchId, productId, delta: 0, reason: 'RESERVE', refType: ref.type, refId: ref.id, note: `Reserved ${qty} unit(s)`, actorId: ref.actorId, actorName: ref.actorName },
    })
  })
}

export async function releaseReservation(productId: string, branchId: string, qty: number, ref: { type: string; id: string; actorName?: string }): Promise<void> {
  await db.$transaction(async (tx) => {
    const stock = await tx.productStock.findUnique({ where: { productId_branchId: { productId, branchId } } })
    if (!stock) return
    await tx.productStock.update({
      where: { productId_branchId: { productId, branchId } },
      data: { qtyReserved: { decrement: Math.min(qty, stock.qtyReserved) } },
    })
    await tx.stockMovement.create({
      data: { branchId, productId, delta: 0, reason: 'RELEASE', refType: ref.type, refId: ref.id, note: `Released reservation of ${qty} unit(s)`, actorName: ref.actorName },
    })
  })
}

/** Deduct delivered goods from physical stock (on hand + reservation). */
export async function fulfillStock(productId: string, branchId: string, qty: number, ref: { type: string; id: string; actorName?: string }): Promise<void> {
  await db.$transaction(async (tx) => {
    const stock = await tx.productStock.findUnique({ where: { productId_branchId: { productId, branchId } } })
    if (!stock) return
    await tx.productStock.update({
      where: { productId_branchId: { productId, branchId } },
      data: {
        qtyOnHand: { decrement: Math.min(qty, stock.qtyOnHand) },
        qtyReserved: { decrement: Math.min(qty, stock.qtyReserved) },
      },
    })
    await tx.stockMovement.create({
      data: { branchId, productId, delta: -qty, reason: 'SALE', refType: ref.type, refId: ref.id, note: `Fulfilled ${qty} unit(s)`, actorName: ref.actorName },
    })
  })
}

/** Total published availability for a product across all warehouses. */
export async function availableQty(productId: string): Promise<number> {
  const stocks = await db.productStock.findMany({
    where: { productId, branch: { status: 'ACTIVE' } },
    select: { qtyOnHand: true, qtyReserved: true },
  })
  return stocks.reduce((sum, s) => sum + (s.qtyOnHand - s.qtyReserved), 0)
}

// ───────────────────────── Auth helpers ─────────────────────────

export function jsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
