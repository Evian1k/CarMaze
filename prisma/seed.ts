/**
 * CARMAZE seed: realistic Kenyan pilot data.
 * Run: bun prisma/seed.ts
 *
 * Demo accounts: one for EVERY platform (documented for the pilot, change
 * before launch). Password for all: CarmazeDemo2025!
 * ALL seeded users/orgs are marked isDemo=true: demo sessions are sandboxed
 * away from real users via src/lib/demo.ts (no real notifications, no real
 * M-Pesa, no mutations outside the demo ecosystem).
 *
 *   Platform staff (Control Center, #/admin, invited staff only):
 *     admin@carmaze.co.ke           FOUNDER/ADMIN, full Operations OS
 *     demo.admin@carmaze.co.ke      RESTRICTED DEMO ADMIN (read-only tour)
 *     ops@carmaze.co.ke             REVIEWER/SUPPORT/MODERATOR
 *     reviewer@carmaze.co.ke        REVIEWER, business-verification department
 *     finance@carmaze.co.ke         FINANCE department
 *     disputes@carmaze.co.ke        MODERATOR, disputes department
 *     fraud@carmaze.co.ke           REVIEWER+MODERATOR, fraud department
 *     support@carmaze.co.ke         SUPPORT department
 *
 *   Businesses:
 *     dealer@carmaze.co.ke          DealerOS (Nairobi Auto Hub + Westlands Motors)
 *     staff@carmaze.co.ke           Dealer sales staff (Nairobi Auto Hub)
 *     garage@carmaze.co.ke          GarageOS (Premium Motors Garage + Mombasa Road Tyres)
 *     garage.staff@carmaze.co.ke    Garage staff (Premium Motors Garage)
 *     supplier@carmaze.co.ke        SupplierOS (Sifa Auto Spares + unverified Rapid Parts)
 *     tyres@carmaze.co.ke           SupplierOS (Highway Tyre Distributors)
 *     equipment@carmaze.co.ke       SupplierOS (GaragePro Equipment Kenya)
 *     logistics@carmaze.co.ke       LogisticsOS (Swift Movers Logistics, approved)
 *
 *   Individuals:
 *     customer@carmaze.co.ke        Customer (orders, dispute, loyalty, custody)
 *     seller@carmaze.co.ke          Private seller (unverified)
 *     verified.seller@carmaze.co.ke SELLER_VERIFIED (KYC approved)
 *
 *   Applications in review (see the staff queue):
 *     apply.dealer@carmaze.co.ke    SUBMITTED dealer application
 *     apply.garage@carmaze.co.ke    MORE_INFO_REQUIRED garage application
 *     apply.logistics@carmaze.co.ke SUBMITTED logistics application
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { seedSupply } from './seed-supply'

const db = new PrismaClient()

const PASSWORD = 'CarmazeDemo2025!'

function daysFromNow(d: number): Date {
  return new Date(Date.now() + d * 24 * 60 * 60 * 1000)
}
function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3600 * 1000)
}

async function main() {
  console.log('Seeding CARMAZE…')
  await db.auditLog.deleteMany()
  await db.demoAccount.deleteMany()
  await db.aiUsage.deleteMany()
  await db.notificationDelivery.deleteMany()
  await db.notification.deleteMany()
  await db.supportTicket.deleteMany()
  // Consumer (B2C) parts orders first, they reference invoices/users/orgs below
  await db.customerOrderEvent.deleteMany()
  await db.customerOrderItem.deleteMany()
  await db.customerOrder.deleteMany()
  // LogisticsOS demo data: DeliveryJob/DeliveryJobEvent reference users
  await db.deliveryJobEvent.deleteMany()
  await db.deliveryJob.deleteMany()
  await db.paymentAttempt.deleteMany()
  await db.campaign.deleteMany()
  await db.invoice.deleteMany()
  await db.subscription.deleteMany()
  await db.plan.deleteMany()
  await db.campaignPackage.deleteMany()
  await db.orgReview.deleteMany()
  await db.booking.deleteMany()
  await db.quote.deleteMany()
  await db.serviceRequest.deleteMany()
  await db.garageService.deleteMany()
  await db.roadsideRequest.deleteMany()
  await db.reminder.deleteMany()
  await db.serviceRecord.deleteMany()
  await db.myVehicle.deleteMany()
  await db.postReaction.deleteMany()
  await db.postComment.deleteMany()
  await db.communityPost.deleteMany()
  await db.follow.deleteMany()
  await db.report.deleteMany()
  await db.enquiryMessage.deleteMany()
  await db.enquiry.deleteMany()
  await db.savedVehicle.deleteMany()
  await db.savedSearch.deleteMany()
  await db.offer.deleteMany()
  await db.buyingRequest.deleteMany()
  // New models (conversations, custody, test drives, incidents), children
  // first, and all before org/user/vehicle deletes (restrict FKs).
  await db.incidentEvent.deleteMany()
  await db.securityIncident.deleteMany()
  await db.custodyEvent.deleteMany()
  await db.roadTest.deleteMany()
  await db.collectionAuthorisation.deleteMany()
  await db.vehicleCustody.deleteMany()
  await db.conversationMessage.deleteMany()
  await db.conversation.deleteMany()
  await db.testDrive.deleteMany()
  await db.listingEvent.deleteMany()
  await db.vehiclePhoto.deleteMany()
  // Vehicle transfers reference vehicles: clear them first (FK, no cascade)
  await db.vehicleTransferEvent.deleteMany()
  await db.vehicleTransfer.deleteMany()
  await db.vehicle.deleteMany()
  await db.applicationEvent.deleteMany()
  await db.documentAccessLog.deleteMany()
  await db.verificationDocument.deleteMany()
  await db.application.deleteMany()
  await db.orgMember.deleteMany()
  // Supply network + business programmes (children before parents)
  await db.membershipRedemption.deleteMany()
  await db.businessMembership.deleteMany()
  await db.membershipTier.deleteMany()
  await db.trustMember.deleteMany()
  await db.trustProgramme.deleteMany()
  await db.creditEntry.deleteMany()
  await db.creditFacility.deleteMany()
  await db.vehicleTransferEvent.deleteMany()
  await db.vehicleTransfer.deleteMany()
  await db.disputeEvent.deleteMany()
  await db.dispute.deleteMany()
  await db.deliveryEvent.deleteMany()
  await db.delivery.deleteMany()
  await db.pOEvent.deleteMany()
  await db.pORevision.deleteMany()
  await db.pOItem.deleteMany()
  await db.paymentAuthorization.deleteMany()
  await db.refund.deleteMany()
  await db.warrantyClaim.deleteMany()
  await db.partReturn.deleteMany()
  await db.quoteOffer.deleteMany()
  await db.quoteRequest.deleteMany()
  await db.garageStockAlert.deleteMany()
  await db.savedSupplyItem.deleteMany()
  await db.productReview.deleteMany()
  await db.productPriceHistory.deleteMany()
  await db.stockMovement.deleteMany()
  await db.productStock.deleteMany()
  await db.productCompatibility.deleteMany()
  await db.product.deleteMany()
  await db.productCategory.deleteMany()
  await db.orgBranch.deleteMany()
  await db.org.deleteMany()
  await db.partnerRequest.deleteMany()
  await db.partner.deleteMany()
  await db.loyaltyLedger.deleteMany()
  await db.customizerConfig.deleteMany()
  // LogisticsOS partners, before user deletes (owner FK)
  await db.logisticsPartnerEvent.deleteMany()
  await db.driver.deleteMany()
  await db.logisticsPartner.deleteMany()
  await db.user.deleteMany()
  await db.systemSetting.deleteMany()

  const hash = await bcrypt.hash(PASSWORD, 10)

  // ── Users ──
  const admin = await db.user.create({
    data: { email: 'admin@carmaze.co.ke', name: 'Grace Njeri', passwordHash: hash, phone: '+254700111222', phoneVerified: true, roles: 'FOUNDER,ADMIN,REVIEWER,MODERATOR,FINANCE,SUPPORT' },
  })
  const ops = await db.user.create({
    data: { email: 'ops@carmaze.co.ke', name: 'Peter Otieno', passwordHash: hash, phone: '+254700333444', phoneVerified: true, roles: 'REVIEWER,SUPPORT,MODERATOR' },
  })
  const dealerOwner = await db.user.create({
    data: { email: 'dealer@carmaze.co.ke', name: 'David Kimani', passwordHash: hash, isDemo: true, phone: '+254711555666', phoneVerified: true, roles: 'CUSTOMER,SELLER,DEALER_OWNER' },
  })
  const dealerStaff = await db.user.create({
    data: { email: 'staff@carmaze.co.ke', name: 'Brian Ochieng', passwordHash: hash, isDemo: true, phone: '+254711777888', phoneVerified: true, roles: 'CUSTOMER,DEALER_STAFF' },
  })
  const garageOwner = await db.user.create({
    data: { email: 'garage@carmaze.co.ke', name: 'Mary Achieng', passwordHash: hash, isDemo: true, phone: '+254722999000', phoneVerified: true, roles: 'CUSTOMER,GARAGE_OWNER' },
  })
  const garageStaffUser = await db.user.create({
    data: { email: 'garage.staff@carmaze.co.ke', name: 'Kevin Otieno', passwordHash: hash, isDemo: true, phone: '+254722999100', phoneVerified: true, roles: 'CUSTOMER,GARAGE_STAFF' },
  })
  const seller = await db.user.create({
    data: { email: 'seller@carmaze.co.ke', name: 'James Mwangi', passwordHash: hash, isDemo: true, phone: '+254733123456', phoneVerified: true, roles: 'CUSTOMER,SELLER' },
  })
  const customer = await db.user.create({
    data: { email: 'customer@carmaze.co.ke', name: 'Amina Hassan', passwordHash: hash, isDemo: true, phone: '+254745654321', roles: 'CUSTOMER' },
  })
  const pendingDealerUser = await db.user.create({
    data: { email: 'apply.dealer@carmaze.co.ke', name: 'Salim Yusuf', passwordHash: hash, isDemo: true, phone: '+254799111000', roles: 'CUSTOMER,SELLER' },
  })
  const pendingGarageUser = await db.user.create({
    data: { email: 'apply.garage@carmaze.co.ke', name: 'Caroline Wanjiru', passwordHash: hash, isDemo: true, phone: '+254799222000', roles: 'CUSTOMER' },
  })
  // Restricted DEMO platform admin: explores the Operations OS read-only;
  // financial, staff-management and platform-configuration actions are blocked
  // server-side for demo accounts (never the real founder/admin account).
  const demoAdmin = await db.user.create({
    data: { email: 'demo.admin@carmaze.co.ke', name: 'Demo Admin', passwordHash: hash, isDemo: true, phone: '+254700000100', phoneVerified: true, roles: 'ADMIN,SUPPORT,REVIEWER,MODERATOR', department: 'OPERATIONS' },
  })

  // ── Referral codes (Loyalty & Referrals) ──
  await db.user.update({ where: { id: admin.id }, data: { referralCode: 'GRZ8F4KQ' } })
  await db.user.update({ where: { id: ops.id }, data: { referralCode: 'OPS5M2XN' } })
  await db.user.update({ where: { id: dealerOwner.id }, data: { referralCode: 'DLR7K9WQ' } })
  await db.user.update({ where: { id: dealerStaff.id }, data: { referralCode: 'STF3P8RM' } })
  await db.user.update({ where: { id: garageOwner.id }, data: { referralCode: 'GRG6T4ZC' } })
  await db.user.update({ where: { id: seller.id }, data: { referralCode: 'SLR2N7VD', referredById: customer.id, referredAt: daysFromNow(-26) } })
  await db.user.update({ where: { id: customer.id }, data: { referralCode: 'AMN9H5XS' } })

  // ── Orgs ──
  const dealerOrg = await db.org.create({
    data: {
      type: 'DEALER', name: 'Nairobi Auto Hub', isDemo: true, regNo: 'BN-2019-4482', county: 'Nairobi', town: 'Syokimau',
      location: 'Mombasa Road, Next to Gateway Mall', phone: '+254711555666', email: 'sales@nairobiautohub.co.ke',
      description: 'Verified dealership specialising in premium SUVs and executive sedans. All units fully inspected.',
    },
  })
  const dealerOrg2 = await db.org.create({
    data: {
      type: 'DEALER', name: 'Westlands Motors', isDemo: true, regNo: 'BN-2016-1187', county: 'Nairobi', town: 'Westlands',
      location: 'Ring Road Parklands', phone: '+254733444555', email: 'hello@westlandsmotors.co.ke',
      description: 'Quality family cars and compact hatchbacks with trade-in options.',
    },
  })
  const garageOrg = await db.org.create({
    data: {
      type: 'GARAGE', name: 'Premium Motors Garage', isDemo: true, regNo: 'BN-2014-7731', county: 'Nairobi', town: 'Westlands',
      location: 'Karuna Rd, Westlands', phone: '+254722999000', email: 'service@premiummotors.co.ke',
      description: 'Full-service garage: mechanical, electrical, bodywork and performance upgrades.',
    },
  })
  const garageOrg2 = await db.org.create({
    data: {
      type: 'GARAGE', name: 'Mombasa Road Tyres & Service', isDemo: true, county: 'Nairobi', town: 'South C',
      location: 'Mombasa Road opposite Panari', phone: '+254720888777',
      description: 'Tyres, alignment, batteries, quick servicing and 24/7 roadside assistance & towing around Nairobi.',
    },
  })

  await db.orgMember.createMany({
    data: [
      { orgId: dealerOrg.id, userId: dealerOwner.id, role: 'OWNER' },
      { orgId: dealerOrg.id, userId: dealerStaff.id, role: 'SALES' },
      { orgId: dealerOrg2.id, userId: dealerOwner.id, role: 'OWNER' },
      { orgId: garageOrg.id, userId: garageOwner.id, role: 'OWNER' },
      { orgId: garageOrg.id, userId: garageStaffUser.id, role: 'STAFF' },
      { orgId: garageOrg2.id, userId: garageOwner.id, role: 'OWNER' },
    ],
  })

  // ── Demo account registry (powers the Sign In demo section + admin console) ──
  // Credentials are NEVER shipped to the frontend: the demo sign-in endpoint
  // maps roleKey → account server-side. enabled=false hides a role instantly.
  await db.demoAccount.createMany({
    data: [
      { roleKey: 'customer', email: 'customer@carmaze.co.ke', label: 'Customer Demo', description: 'Browse the marketplace, save vehicles, compare, enquire, book garage services and track everything from your dashboard.', dashboard: 'cars', sessionMinutes: 20160 },
      { roleKey: 'private-seller', email: 'seller@carmaze.co.ke', label: 'Private Seller Demo', description: 'Manage your own vehicle listings, see listing approval status, handle enquiries and follow your own seller analytics.', dashboard: 'my-listings', sessionMinutes: 20160 },
      { roleKey: 'showroom-owner', email: 'dealer@carmaze.co.ke', label: 'Showroom Owner Demo', description: 'Run DealerOS for Nairobi Auto Hub: inventory, enquiries, test drives, staff, billing and business analytics.', dashboard: 'dealer', sessionMinutes: 20160 },
      { roleKey: 'showroom-staff', email: 'staff@carmaze.co.ke', label: 'Showroom Staff Demo', description: 'Work the assigned sales tools in DealerOS (enquiries, conversations and test drives) without owner-level access to billing or settings.', dashboard: 'dealer', sessionMinutes: 20160 },
      { roleKey: 'garage-owner', email: 'garage@carmaze.co.ke', label: 'Garage Owner Demo', description: 'Run GarageOS for Premium Motors Garage: quotes, bookings, technicians, procurement, subscriptions and garage analytics.', dashboard: 'garage-dashboard', sessionMinutes: 20160 },
      { roleKey: 'garage-staff', email: 'garage.staff@carmaze.co.ke', label: 'Garage Staff Demo', description: 'Assigned garage operations only: bookings, job progress and customer conversations. No billing, staff management or financials.', dashboard: 'garage-dashboard', sessionMinutes: 20160 },
      { roleKey: 'supplier-owner', email: 'supplier@carmaze.co.ke', label: 'Supplier Owner Demo', description: 'Run SupplierOS for Sifa Auto Spares: catalogue & fitment, branches and stock, quote requests, purchase orders, settlements and business billing.', dashboard: 'supplier', sessionMinutes: 20160 },
      { roleKey: 'logistics-owner', email: 'logistics@carmaze.co.ke', label: 'Logistics Partner Demo', description: 'Run LogisticsOS for Swift Movers: delivery jobs, drivers & fleet, OTP-verified handovers, proof-of-delivery and earnings.', dashboard: 'logistics', sessionMinutes: 20160 },
      { roleKey: 'platform-support', email: 'support@carmaze.co.ke', label: 'Platform Support Demo', description: 'Support portal: customer tickets, complaint resolution and escalation workflows for the Support department.', dashboard: 'admin?tab=support', sessionMinutes: 20160 },
      { roleKey: 'platform-admin', email: 'demo.admin@carmaze.co.ke', label: 'Platform Admin Demo', description: 'Restricted admin tour of the Operations OS: verification queues, moderation and analytics. Financial and security actions are disabled in demo mode.', dashboard: 'admin', sessionMinutes: 20160, restrictedNote: 'Restricted to authorised internal testing. Financial actions, staff management and platform-wide configuration are disabled for this demo account.' },
    ],
  })

  // ── Approved applications (audit trail) ──
  const app1 = await db.application.create({
    data: {
      refCode: 'DLA-7HQ2KJ', type: 'DEALER', userId: dealerOwner.id, orgName: 'Nairobi Auto Hub', regNo: 'BN-2019-4482',
      county: 'Nairobi', town: 'Syokimau', physicalAddress: 'Mombasa Road, Next to Gateway Mall', phone: '+254711555666',
      email: 'sales@nairobiautohub.co.ke', representative: 'David Kimani', accountType: 'dealer-pro', consent: true,
      status: 'APPROVED', reviewSlaHours: 24, reviewOwnerId: admin.id, reviewOwnerName: admin.name,
      decisionNote: 'Business registration and premises verified. Approved.', orgId: dealerOrg.id,
      submittedAt: daysFromNow(-40), createdAt: daysFromNow(-41),
    },
  })
  await db.applicationEvent.createMany({
    data: [
      { applicationId: app1.id, type: 'SUBMITTED', actorId: dealerOwner.id, actorName: dealerOwner.name, note: 'Application submitted for review.', createdAt: daysFromNow(-40) },
      { applicationId: app1.id, type: 'REVIEW_ASSIGNED', actorId: admin.id, actorName: admin.name, note: 'Review assigned to Grace Njeri.', createdAt: daysFromNow(-40) },
      { applicationId: app1.id, type: 'APPROVED', actorId: admin.id, actorName: admin.name, note: 'Business registration and premises verified. Approved.', createdAt: daysFromNow(-38) },
    ],
  })

  // Pending dealer application (submitted 6h ago, inside SLA)
  const appPending = await db.application.create({
    data: {
      refCode: 'DLA-3XW9QP', type: 'DEALER', userId: pendingDealerUser.id, orgName: 'Coast Elite Motors', regNo: 'BN-2023-9921',
      county: 'Mombasa', town: 'Nyali', physicalAddress: 'Links Road, Nyali', phone: '+254799111000',
      email: 'info@coastelite.co.ke', representative: 'Salim Yusuf', accountType: 'dealer-starter', consent: true,
      status: 'SUBMITTED', submittedAt: hoursAgo(6),
      documents: JSON.stringify([{ name: 'business-registration.pdf', url: '/api/files/demo-doc.pdf' }]),
    },
  })
  await db.applicationEvent.create({ data: { applicationId: appPending.id, type: 'SUBMITTED', actorId: pendingDealerUser.id, actorName: pendingDealerUser.name, note: 'Application submitted for review.' } })

  // Garage application awaiting corrections (due in 2 days)
  const appInfo = await db.application.create({
    data: {
      refCode: 'GRA-8NB4RT', type: 'GARAGE', userId: pendingGarageUser.id, orgName: 'Wanjiru Auto Care', county: 'Kiambu',
      town: 'Thika', physicalAddress: 'General Kago Rd', phone: '+254799222000', representative: 'Caroline Wanjiru',
      categories: 'GENERAL_SERVICE,MECHANICAL', consent: true, status: 'MORE_INFO_REQUIRED',
      submittedAt: daysFromNow(-3), infoRequestedAt: daysFromNow(-2), correctionsDueAt: daysFromNow(2),
    },
  })
  await db.applicationEvent.createMany({
    data: [
      { applicationId: appInfo.id, type: 'SUBMITTED', actorId: pendingGarageUser.id, actorName: pendingGarageUser.name, note: 'Application submitted for review.', createdAt: daysFromNow(-3) },
      { applicationId: appInfo.id, type: 'INFO_REQUESTED', actorId: ops.id, actorName: ops.name, note: 'Please upload a clear photo of the workshop premises and the business permit.', createdAt: daysFromNow(-2) },
    ],
  })

  // ── Plans & packages ──
  await db.plan.createMany({
    data: [
      { code: 'dealer-starter', name: 'Dealer Starter', audience: 'DEALER', priceMinor: 490000, listingLimit: 10, featuredLimit: 1, staffLimit: 2, features: JSON.stringify(['10 active listings', '1 featured slot', '2 staff accounts', 'Enquiry inbox & follow-ups']) },
      { code: 'dealer-pro', name: 'Dealer Pro', audience: 'DEALER', priceMinor: 990000, listingLimit: 40, featuredLimit: 5, staffLimit: 8, features: JSON.stringify(['40 active listings', '5 featured slots', '8 staff accounts', 'Dealer Copilot insights', 'Priority review queue']) },
      { code: 'garage-basic', name: 'Garage Basic', audience: 'GARAGE', priceMinor: 290000, listingLimit: 20, featuredLimit: 0, staffLimit: 3, features: JSON.stringify(['Up to 20 open requests', '3 staff accounts', 'Quote management', 'Reviews & ratings']) },
      { code: 'garage-pro', name: 'Garage Pro', audience: 'GARAGE', priceMinor: 590000, listingLimit: 100, featuredLimit: 0, staffLimit: 10, features: JSON.stringify(['Up to 100 open requests', '10 staff accounts', 'Featured garage placement', 'Performance analytics']) },
    ],
  })
  await db.campaignPackage.createMany({
    data: [
      { code: 'spotlight-7', name: 'Listing Spotlight (7 days)', days: 7, priceMinor: 150000, description: 'Your listing highlighted in search results for 7 days.' },
      { code: 'feature-home-3', name: 'Homepage Feature (3 days)', days: 3, priceMinor: 300000, description: 'Your listing appears in the homepage featured strip for 3 days.' },
    ],
  })

  // ── Subscriptions + paid invoices (real revenue records) ──
  await db.subscription.createMany({
    data: [
      { orgId: dealerOrg.id, planCode: 'dealer-pro', status: 'ACTIVE', startedAt: daysFromNow(-30), currentPeriodEnd: daysFromNow(1) },
      { orgId: dealerOrg2.id, planCode: 'dealer-starter', status: 'ACTIVE', startedAt: daysFromNow(-20), currentPeriodEnd: daysFromNow(10) },
      { orgId: garageOrg.id, planCode: 'garage-basic', status: 'ACTIVE', startedAt: daysFromNow(-25), currentPeriodEnd: daysFromNow(5) },
    ],
  })
  await db.invoice.createMany({
    data: [
      { refCode: 'INV-QK2M4P', orgId: dealerOrg.id, type: 'SUBSCRIPTION', description: 'Dealer Pro subscription (monthly)', amountMinor: 990000, status: 'PAID', periodStart: daysFromNow(-30), periodEnd: daysFromNow(1), issuedAt: daysFromNow(-30), dueDate: daysFromNow(-30), paidAt: daysFromNow(-29), paidVia: 'MPESA' },
      { refCode: 'INV-MN7X2W', orgId: dealerOrg2.id, type: 'SUBSCRIPTION', description: 'Dealer Starter subscription (monthly)', amountMinor: 490000, status: 'PAID', periodStart: daysFromNow(-20), periodEnd: daysFromNow(10), issuedAt: daysFromNow(-20), dueDate: daysFromNow(-20), paidAt: daysFromNow(-20), paidVia: 'MPESA' },
      { refCode: 'INV-PW9Q3L', orgId: garageOrg.id, type: 'SUBSCRIPTION', description: 'Garage Basic subscription (monthly)', amountMinor: 290000, status: 'PAID', periodStart: daysFromNow(-25), periodEnd: daysFromNow(5), issuedAt: daysFromNow(-25), dueDate: daysFromNow(-25), paidAt: daysFromNow(-24), paidVia: 'MANUAL' },
      { refCode: 'INV-TD4K8Z', orgId: dealerOrg.id, type: 'CAMPAIGN', description: 'Listing Spotlight (7 days), Prado TX-L', amountMinor: 150000, status: 'PENDING', issuedAt: hoursAgo(20), dueDate: daysFromNow(7) },
    ],
  })

  // ── Vehicles ──
  type Seed = {
    make: string; model: string; year: number; priceMinor: number; mileageKm: number; fuel: string; transmission: string;
    bodyType: string; condition: string; county: string; town?: string; color: string; engineCc?: number; sellerType?: string;
    status?: string; featured?: boolean; match?: boolean; orgId?: string; ownerId: string; images: string[];
    description: string; views?: number;
  }
  const seeds: Seed[] = [
    { make: 'Toyota', model: 'Land Cruiser Prado TX-L', year: 2018, priceMinor: 750000000, mileageKm: 89000, fuel: 'DIESEL', transmission: 'AUTOMATIC', bodyType: 'SUV', condition: 'FOREIGN_USED', county: 'Nairobi', town: 'Syokimau', color: 'Pearl White', engineCc: 2800, orgId: dealerOrg.id, ownerId: dealerOwner.id, featured: true, views: 214, images: ['/images/prado.png'], description: 'Fully loaded TX-L with sunroof, leather interior and rear entertainment. New tyres, full service history, accident-free with verified import documents. Trade-ins accepted.' },
    { make: 'Toyota', model: 'Harrier Premium', year: 2017, priceMinor: 420000000, mileageKm: 76000, fuel: 'PETROL', transmission: 'AUTOMATIC', bodyType: 'SUV', condition: 'FOREIGN_USED', county: 'Nairobi', color: 'Dark Grey', engineCc: 2000, orgId: dealerOrg.id, ownerId: dealerOwner.id, views: 156, images: ['/images/harrier.png'], description: 'Elegant Harrier with half-leather interior, power boot and 360 camera. Well maintained, immediate delivery.' },
    { make: 'Mazda', model: 'Demio 1.3 Skyactiv', year: 2019, priceMinor: 135000000, mileageKm: 45000, fuel: 'PETROL', transmission: 'AUTOMATIC', bodyType: 'HATCHBACK', condition: 'FOREIGN_USED', county: 'Nairobi', color: 'Soul Red', engineCc: 1300, orgId: dealerOrg2.id, ownerId: dealerOwner.id, views: 98, images: ['/images/demio.png'], description: 'Fuel-efficient city hatchback in pristine condition. Ideal first car. Financing available through our partner banks.' },
    { make: 'Honda', model: 'Fit Hybrid', year: 2018, priceMinor: 125000000, mileageKm: 58000, fuel: 'HYBRID', transmission: 'AUTOMATIC', bodyType: 'HATCHBACK', condition: 'FOREIGN_USED', county: 'Mombasa', color: 'Silver', engineCc: 1500, orgId: dealerOrg2.id, ownerId: dealerOwner.id, views: 77, images: ['/images/fit.png'], description: 'Smooth hybrid with excellent economy. Fresh import, grade 4.5 auction sheet available on request.' },
    { make: 'Nissan', model: 'X-Trail 2000 XTT', year: 2016, priceMinor: 295000000, mileageKm: 96000, fuel: 'PETROL', transmission: 'AUTOMATIC', bodyType: 'SUV', condition: 'FOREIGN_USED', county: 'Nairobi', color: 'Bronze', engineCc: 2000, orgId: dealerOrg.id, ownerId: dealerOwner.id, views: 143, images: ['/images/xtrail.png'], description: 'Spacious 7-seater family SUV with 4WD. Fully inspected with a 6-month engine and gearbox warranty.' },
    { make: 'Subaru', model: 'Forester XT Turbo', year: 2017, priceMinor: 310000000, mileageKm: 84000, fuel: 'PETROL', transmission: 'AUTOMATIC', bodyType: 'SUV', condition: 'FOREIGN_USED', county: 'Nakuru', color: 'Dark Green', engineCc: 2000, orgId: dealerOrg.id, ownerId: dealerOwner.id, views: 89, images: ['/images/forester.png'], description: 'Symmetrical AWD turbo Forester. New timing belt service done. Perfect for upcountry roads.' },
    { make: 'Mercedes-Benz', model: 'C200 Avantgarde', year: 2016, priceMinor: 380000000, mileageKm: 102000, fuel: 'PETROL', transmission: 'AUTOMATIC', bodyType: 'SEDAN', condition: 'FOREIGN_USED', county: 'Nairobi', color: 'Obsidian Black', engineCc: 2000, orgId: dealerOrg.id, ownerId: dealerOwner.id, status: 'RESERVED', views: 187, images: ['/images/c200.png'], description: 'Executive sedan with AMG line wheels, panoramic roof and full service records. Reserved pending buyer completion.' },
    { make: 'Isuzu', model: 'D-Max Double Cab', year: 2019, priceMinor: 465000000, mileageKm: 120000, fuel: 'DIESEL', transmission: 'MANUAL', bodyType: 'PICKUP', condition: 'LOCAL_USED', county: 'Nairobi', color: 'White', engineCc: 2500, orgId: dealerOrg2.id, ownerId: dealerOwner.id, featured: true, views: 231, images: ['/images/dmax.png'], description: 'Locally used workhorse with canopy, tow bar and new suspension. Ex-NGO fleet, full maintenance records.' },
    { make: 'Toyota', model: 'Vitz 1.0', year: 2020, priceMinor: 115000000, mileageKm: 33000, fuel: 'PETROL', transmission: 'AUTOMATIC', bodyType: 'HATCHBACK', condition: 'FOREIGN_USED', county: 'Kiambu', town: 'Kikuyu', color: 'Pearl White', engineCc: 1000, ownerId: seller.id, sellerType: 'PRIVATE', match: true, views: 64, images: ['/images/vitz.png'], description: 'One owner, non-accident, garage kept. Selling to upgrade. Serious buyers only. Inspection welcome.' },
    { make: 'Toyota', model: 'Noah X', year: 2017, priceMinor: 240000000, mileageKm: 88000, fuel: 'PETROL', transmission: 'AUTOMATIC', bodyType: 'MINIVAN', condition: 'FOREIGN_USED', county: 'Nairobi', color: 'Silver', engineCc: 2000, ownerId: seller.id, sellerType: 'PRIVATE', status: 'PENDING_REVIEW', images: ['/images/noah.png'], description: '8-seater family van in excellent condition. Ideal for family and business use.' },
    { make: 'Toyota', model: 'Land Cruiser V8 ZX', year: 2015, priceMinor: 890000000, mileageKm: 140000, fuel: 'DIESEL', transmission: 'AUTOMATIC', bodyType: 'SUV', condition: 'LOCAL_USED', county: 'Nairobi', color: 'White', engineCc: 4500, orgId: dealerOrg.id, ownerId: dealerOwner.id, status: 'SOLD', views: 402, images: ['/images/prado.png'], description: 'Sold within 3 weeks of listing. Full service history, locally used by a diplomat.' },
    { make: 'BMW', model: 'X3 xDrive20d', year: 2017, priceMinor: 420000000, mileageKm: 91000, fuel: 'DIESEL', transmission: 'AUTOMATIC', bodyType: 'SUV', condition: 'FOREIGN_USED', county: 'Nairobi', color: 'Mineral Grey', engineCc: 2000, orgId: dealerOrg.id, ownerId: dealerOwner.id, status: 'DRAFT', images: [], description: 'Draft listing: photos being prepared.' },
  ]

  type CreatedVehicle = Awaited<ReturnType<typeof db.vehicle.create>>
  const vehicles: CreatedVehicle[] = []
  let seq = 100
  for (const s of seeds) {
    const v = await db.vehicle.create({
      data: {
        refCode: `CM-${seq++}${String(Math.floor(Math.random() * 900) + 100)}`,
        ownerId: s.ownerId,
        orgId: s.orgId ?? null,
        make: s.make, model: s.model, year: s.year,
        priceMinor: s.priceMinor, mileageKm: s.mileageKm,
        fuel: s.fuel, transmission: s.transmission, bodyType: s.bodyType,
        engineCc: s.engineCc ?? null, condition: s.condition,
        county: s.county, town: s.town ?? null, color: s.color,
        description: s.description, sellerType: s.sellerType ?? 'DEALER',
        status: s.status ?? 'PUBLISHED', featured: s.featured ?? false,
        matchWithDealers: s.match ?? false, views: s.views ?? 0,
        createdAt: daysFromNow(-Math.floor(Math.random() * 25) - 2),
        photos: { create: s.images.map((url, i) => ({ url, order: i })) },
      },
    })
    await db.listingEvent.create({
      data: { vehicleId: v.id, to: v.status, note: 'Seeded listing state', createdAt: v.createdAt },
    })
    vehicles.push(v)
  }
  const [prado, , , , , , , dmax, vitz, noah] = vehicles

  // ── Saved vehicles & searches ──
  await db.savedVehicle.createMany({
    data: [
      { userId: customer.id, vehicleId: prado.id },
      { userId: customer.id, vehicleId: dmax.id },
    ],
  })
  await db.savedSearch.create({
    data: { userId: customer.id, name: 'SUVs under 4M in Nairobi', query: 'bodyType=SUV&maxPrice=400000000&county=Nairobi' },
  })

  // ── Enquiry with messages ──
  const enquiry1 = await db.enquiry.create({
    data: {
      refCode: 'ENQ-4RT8WN', vehicleId: prado.id, userId: customer.id,
      message: 'Is the Prado still available? Can I book an inspection this Saturday morning?',
      phone: '+254745654321', status: 'OPEN',
    },
  })
  await db.enquiryMessage.createMany({
    data: [
      { enquiryId: enquiry1.id, senderId: customer.id, senderName: customer.name, senderSide: 'CUSTOMER', body: 'Is the Prado still available? Can I book an inspection this Saturday morning?' },
      { enquiryId: enquiry1.id, senderId: dealerStaff.id, senderName: dealerStaff.name, senderSide: 'SELLER', body: 'Hello Amina, yes it is available. Saturday 10am works, we are at Mombasa Road next to Gateway Mall. Ask for Brian at reception.' },
      { enquiryId: enquiry1.id, senderId: customer.id, senderName: customer.name, senderSide: 'CUSTOMER', body: 'Great, see you then. Will the trade-in valuation be done the same day?' },
    ],
  })
  const enquiry2 = await db.enquiry.create({
    data: {
      refCode: 'ENQ-9KP3MV', vehicleId: vitz.id, userId: customer.id,
      message: 'Would you accept 1,050,000 for the Vitz? I can pay immediately.', phone: '+254745654321', status: 'ANSWERED',
    },
  })
  await db.enquiryMessage.createMany({
    data: [
      { enquiryId: enquiry2.id, senderId: customer.id, senderName: customer.name, senderSide: 'CUSTOMER', body: 'Would you accept 1,050,000 for the Vitz? I can pay immediately.' },
      { enquiryId: enquiry2.id, senderId: seller.id, senderName: seller.name, senderSide: 'SELLER', body: 'Hi Amina, the lowest I can go is 1,100,000. You are welcome to view it in Kikuyu this weekend.' },
    ],
  })

  // ── Dealer offers on the matched private Vitz + buying request ──
  await db.offer.createMany({
    data: [
      { vehicleId: vitz.id, orgId: dealerOrg.id, amountMinor: 110000000, message: 'We can do KES 1.1M and handle all transfer paperwork.', status: 'PENDING', expiresAt: daysFromNow(5) },
      { vehicleId: vitz.id, orgId: dealerOrg2.id, amountMinor: 105000000, message: 'Instant cash offer, collection from your gate in Kikuyu.', status: 'PENDING', expiresAt: daysFromNow(3) },
    ],
  })
  await db.buyingRequest.create({
    data: { orgId: dealerOrg.id, make: 'Toyota', model: 'Land Cruiser Prado', yearFrom: 2015, yearTo: 2019, budgetMinor: 700000000, notes: 'Buying clean units, any colour, mileage under 120k.' },
  })

  // ── Garage services ──
  await db.garageService.createMany({
    data: [
      { orgId: garageOrg.id, category: 'GENERAL_SERVICE', title: 'Full engine service', description: 'Oil, filters, diagnostics and 40-point inspection.', priceFromMinor: 650000 },
      { orgId: garageOrg.id, category: 'MODIFICATIONS', title: 'Suspension lift kits & wheels', description: 'Lift kits, alloy wheels and tyre packages with alignment.', priceFromMinor: 8500000 },
      { orgId: garageOrg.id, category: 'BODYWORK', title: 'Accident repair & spray', description: 'Insurance-approved bodywork and oven-baked spray.', priceFromMinor: 1200000 },
      { orgId: garageOrg.id, category: 'ELECTRICAL', title: 'Auto-electrical diagnostics', description: 'ECU scanning, wiring repairs and battery systems.', priceFromMinor: 250000 },
      { orgId: garageOrg2.id, category: 'TYRES', title: 'Tyre fitting & balancing', description: 'All major brands, wheel alignment included.', priceFromMinor: 180000 },
      { orgId: garageOrg2.id, category: 'ELECTRICAL', title: 'Battery replacement & charging system', description: 'Free fitting with 12-month warranty batteries.', priceFromMinor: 950000 },
      { orgId: garageOrg2.id, category: 'ROADSIDE', title: '24/7 roadside assistance & towing', description: 'Flat tyre, battery boost, fuel rescue and towing across Nairobi. Call-out from KES 3,500.', priceFromMinor: 350000 },
    ],
  })

  // ── Service request → quotes → booking → review ──
  const sr1 = await db.serviceRequest.create({
    data: {
      refCode: 'SRQ-2LM8VX', customerId: customer.id, category: 'MODIFICATIONS',
      vehicleDesc: 'Toyota Prado TX-L 2018', description: 'Looking to install a 2-inch lift kit and 18-inch alloy wheels. Would like a quote including alignment.',
      county: 'Nairobi', town: 'South B', status: 'QUOTING',
    },
  })
  await db.quote.create({
    data: { requestId: sr1.id, orgId: garageOrg.id, amountMinor: 9800000, leadDays: 3, message: 'Includes Ironman lift kit, 4 alloy wheels, all-terrain tyres, alignment and labour. 12-month workmanship warranty.' },
  })
  const sr2 = await db.serviceRequest.create({
    data: {
      refCode: 'SRQ-7RD4KQ', customerId: customer.id, category: 'GENERAL_SERVICE',
      vehicleDesc: 'Toyota Vitz 2016', description: 'Regular service: engine oil, air filter and general check-up.', county: 'Nairobi', status: 'COMPLETED',
    },
  })
  await db.quote.create({ data: { requestId: sr2.id, orgId: garageOrg2.id, amountMinor: 480000, leadDays: 1, message: 'Genuine filters and 5W-30 oil included.', status: 'ACCEPTED' } })
  await db.booking.create({ data: { requestId: sr2.id, orgId: garageOrg2.id, scheduledAt: daysFromNow(-5), status: 'COMPLETED', notes: 'Completed on time. Customer advised brake pads at ~40% next visit.' } })
  // A confirmed (upcoming) job for the PRIMARY garage as well: Premium Motors
  // is the first org the GarageOS demo lands on, so its bookings tab needs a
  // live job on first load instead of an empty state.
  const sr3 = await db.serviceRequest.create({
    data: {
      refCode: 'SRQ-4TK9WP', customerId: customer.id, category: 'ELECTRICAL',
      vehicleDesc: 'Toyota Prado TX-L 2018', description: 'Battery drains overnight. Suspect a parasitic draw; need diagnostics and a replacement unit if needed.',
      county: 'Nairobi', town: 'South B', status: 'BOOKED',
    },
  })
  await db.quote.create({ data: { requestId: sr3.id, orgId: garageOrg.id, amountMinor: 750000, leadDays: 1, message: 'Parasitic-draw diagnostics plus a 12-month-warranty battery if the test confirms. Drop-off before 9 AM for same-day collection.' , status: 'ACCEPTED' } })
  await db.booking.create({ data: { requestId: sr3.id, orgId: garageOrg.id, scheduledAt: daysFromNow(2), status: 'CONFIRMED', notes: 'Customer will drop the car at 08:30. Diagnostics first; call before fitting a new battery.' } })
  await db.orgReview.create({ data: { orgId: garageOrg2.id, authorId: customer.id, rating: 5, comment: 'Quick, honest and clean work. Fair pricing.' } })
  // Reviews for the PRIMARY garage (Premium Motors Garage) too: the GarageOS
  // reviews tab must show real content on first load, not an empty state.
  await db.orgReview.createMany({
    data: [
      { orgId: garageOrg.id, authorId: customer.id, rating: 5, comment: 'They fitted the lift kit exactly as quoted and the alignment was spot on. Booked again for the next service.', createdAt: daysFromNow(-14) },
      { orgId: garageOrg.id, authorId: dealerOwner.id, rating: 4, comment: 'Solid diagnostics work on two of our stock units. Communication could be faster, but the repairs hold up.', createdAt: daysFromNow(-31) },
    ],
  })

  // ── Roadside (completed demo) ──
  await db.roadsideRequest.create({
    data: {
      refCode: 'RSA-5GH7YU', userId: customer.id, name: customer.name, phone: '+254745654321',
      county: 'Nairobi', location: 'Uhuru Highway near Haile Selassie Ave', issue: 'FLAT_TYRE',
      details: 'Rear-left tyre punctured by a nail.', status: 'COMPLETED',
      providerOrgId: garageOrg2.id, providerNote: 'Technician dispatched from South C branch, tyre repaired on site.',
      acceptedAt: hoursAgo(48), completedAt: hoursAgo(46), createdAt: hoursAgo(49),
    },
  })

  // ── My Garage (ownership records) ──
  const myVitz = await db.myVehicle.create({
    data: {
      userId: customer.id, make: 'Toyota', model: 'Vitz 1.0', year: 2016, plate: 'KCX 118R', color: 'White',
      mileageKm: 62000, purchaseDate: daysFromNow(-400), purchasePriceMinor: 95000000, notes: 'Bought from a colleague, full history available.',
    },
  })
  await db.serviceRecord.createMany({
    data: [
      { myVehicleId: myVitz.id, date: daysFromNow(-30), type: 'SERVICE', description: 'Engine oil and filter change, coolant top-up.', costMinor: 320000, mileageKm: 59500, garageOrgId: garageOrg2.id },
      { myVehicleId: myVitz.id, date: daysFromNow(-5), type: 'SERVICE', description: 'Regular service: engine oil, air filter and general check-up.', costMinor: 480000, mileageKm: 62000, garageOrgId: garageOrg2.id },
    ],
  })
  await db.reminder.createMany({
    data: [
      { myVehicleId: myVitz.id, type: 'INSURANCE', title: 'Comprehensive insurance renewal', dueDate: daysFromNow(18), intervalDays: 365 },
      { myVehicleId: myVitz.id, type: 'SERVICE', title: 'Next engine service (~65,000 km)', dueDate: daysFromNow(40), intervalDays: 90 },
      { myVehicleId: myVitz.id, type: 'INSPECTION', title: 'NTSA inspection due', dueDate: daysFromNow(75) },
    ],
  })

  // ── Community ──
  const post1 = await db.communityPost.create({
    data: {
      userId: dealerOwner.id, title: 'Weekend cruise: Nairobi → Naivasha, who is in?',
      body: 'Planning a Sunday morning drive to Naivasha via Mai Mahiu. Meeting point Capitol Centre 7:30am, breakfast stop in Naivasha. All cars welcome, moderate pace. Drop a comment if you are joining.',
      category: 'EVENT',
    },
  })
  const post2 = await db.communityPost.create({
    data: {
      userId: customer.id, title: 'Vitz hybrid vs Demio: real fuel economy in Nairobi traffic?',
      body: 'I do mostly Urban commutes with occasional upcountry trips. Comparing a 2018 Fit Hybrid and a 2019 Demio. Owners, what real consumption are you getting in the city?',
      category: 'QUESTION',
    },
  })
  const post3 = await db.communityPost.create({
    data: {
      userId: seller.id, title: 'Selling my 2020 Vitz, sharing my experience with the platform',
      body: 'Listed my Vitz last week and got two dealer offers through the matching board already. Will update once I close the deal. Tip: good photos genuinely make a difference.',
      category: 'SHOWCASE',
    },
  })
  await db.postComment.createMany({
    data: [
      { postId: post1.id, userId: seller.id, body: 'Count me in, bringing the Demio.' },
      { postId: post1.id, userId: customer.id, body: 'Is the route family friendly? I might tag along with my sister.' },
      { postId: post2.id, userId: garageOwner.id, body: 'From what we see at the garage: hybrids shine in stop-and-go traffic; on the highway the difference almost disappears.' },
    ],
  })
  await db.postReaction.createMany({
    data: [
      { postId: post1.id, userId: customer.id, type: 'LIKE' },
      { postId: post1.id, userId: garageOwner.id, type: 'LIKE' },
      { postId: post2.id, userId: dealerOwner.id, type: 'LIKE' },
      { postId: post3.id, userId: customer.id, type: 'LIKE' },
    ],
  })

  // ── Reviews for the dealer org ──
  await db.orgReview.create({ data: { orgId: dealerOrg.id, authorId: customer.id, rating: 4, comment: 'Smooth viewing process, honest about the vehicle condition.' } })

  // ── Campaign pending payment on Prado ──
  await db.campaign.create({
    data: {
      refCode: 'CMP-9ZT3KD', orgId: dealerOrg.id, vehicleId: prado.id, packageCode: 'spotlight-7',
      status: 'PENDING_PAYMENT', invoiceId: (await db.invoice.findFirst({ where: { refCode: 'INV-TD4K8Z' } }))!.id,
    },
  })

  // ── Active paid campaign (D-Max homepage feature, real revenue record) ──
  const campInv = await db.invoice.create({
    data: {
      refCode: 'INV-BX6N2T', orgId: dealerOrg.id, type: 'CAMPAIGN', description: 'Homepage Feature (3 days), D-Max Double Cab',
      amountMinor: 300000, status: 'PAID', issuedAt: daysFromNow(-2), dueDate: daysFromNow(1), paidAt: daysFromNow(-2), paidVia: 'MPESA',
    },
  })
  await db.campaign.create({
    data: {
      refCode: 'CMP-K4W8QN', orgId: dealerOrg.id, vehicleId: dmax.id, packageCode: 'feature-home-3',
      status: 'ACTIVE', startsAt: daysFromNow(-2), endsAt: daysFromNow(1), impressions: 347, clicks: 41, invoiceId: campInv.id,
    },
  })

  // ── Partner Network (only verified partners are publicly listed) ──
  await db.partner.createMany({
    data: [
      { refCode: 'PRT-A2M8KQ', name: 'AutoCheck Inspection Services', category: 'INSPECTION', county: 'Nairobi', serviceAreas: JSON.stringify(['Nairobi', 'Kiambu', 'Machakos', 'Nakuru']), description: 'Pre-purchase vehicle inspections: 220-point mechanical, electrical and body checks with a same-day digital report. Bookings any day of the week.', phone: '+254712345678', email: 'book@autocheck.co.ke', whatsapp: true, website: 'https://autocheck.co.ke', contactName: 'Peter Maina', status: 'APPROVED', verified: true, rating: 4.8, referrals: 63, createdAt: daysFromNow(-120) },
      { refCode: 'PRT-B7X4RD', name: 'BimaLink Insurance Agency', category: 'INSURANCE', county: 'Nairobi', serviceAreas: JSON.stringify(['Nairobi', 'Mombasa', 'Kisumu', 'Nakuru', 'Eldoret']), description: 'Licensed motor insurance agency offering comprehensive cover from leading underwriters, with end-to-end claims support.', phone: '+254719888777', email: 'hello@bimalink.co.ke', whatsapp: true, website: 'https://bimalink.co.ke', contactName: 'Faith Wambui', status: 'APPROVED', verified: true, rating: 4.5, referrals: 128, createdAt: daysFromNow(-95) },
      { refCode: 'PRT-C9Q3WN', name: 'QuickTow Recovery', category: 'TOWING', county: 'Nairobi', serviceAreas: JSON.stringify(['Nairobi', 'Kiambu', 'Machakos', 'Kajiado']), description: '24/7 flatbed and towing recovery across the Nairobi metro. Average arrival under 45 minutes within the city.', phone: '+254700111999', whatsapp: true, contactName: 'Dennis Ouma', status: 'APPROVED', verified: true, rating: 4.2, referrals: 89, createdAt: daysFromNow(-70) },
      { refCode: 'PRT-D5F7HB', name: 'PartsHub Kenya', category: 'PARTS', county: 'Mombasa', serviceAreas: JSON.stringify(['Mombasa', 'Nairobi']), description: 'Genuine and aftermarket spare parts supplier for Japanese models with next-day delivery countrywide.', phone: '+254733222111', email: 'sales@partshub.co.ke', contactName: 'Ali Hassan', status: 'PENDING', createdAt: daysFromNow(-2) },
    ],
  })
  const autocheck = await db.partner.findUnique({ where: { refCode: 'PRT-A2M8KQ' } })
  if (autocheck) {
    await db.partnerRequest.create({
      data: {
        refCode: 'PRQ-8T3WLM', partnerId: autocheck.id, userId: customer.id, name: customer.name, phone: '+254745654321',
        county: 'Nairobi', message: 'Would like a pre-purchase inspection on a Toyota Prado in Syokimau this Saturday morning.',
        status: 'CLOSED', createdAt: daysFromNow(-12),
      },
    })
  }
  await db.auditLog.createMany({
    data: [
      { actorId: admin.id, actorName: admin.name, action: 'PARTNER_APPROVED', targetType: 'PARTNER', targetId: 'PRT-A2M8KQ', metadata: JSON.stringify({ partner: 'AutoCheck Inspection Services' }), createdAt: daysFromNow(-115) },
      { actorId: admin.id, actorName: admin.name, action: 'PARTNER_APPROVED', targetType: 'PARTNER', targetId: 'PRT-B7X4RD', metadata: JSON.stringify({ partner: 'BimaLink Insurance Agency' }), createdAt: daysFromNow(-90) },
      { actorId: admin.id, actorName: admin.name, action: 'PARTNER_APPROVED', targetType: 'PARTNER', targetId: 'PRT-C9Q3WN', metadata: JSON.stringify({ partner: 'QuickTow Recovery' }), createdAt: daysFromNow(-65) },
    ],
  })

  // ── Loyalty ledger (transparent points history for the demo customer) ──
  await db.loyaltyLedger.createMany({
    data: [
      { userId: customer.id, points: 500, reason: 'REFERRAL_SIGNUP', refType: 'USER', refId: seller.id, note: 'James Mwangi joined with your referral link.', createdAt: daysFromNow(-26) },
      { userId: customer.id, points: 250, reason: 'SERVICE_COMPLETED', refType: 'BOOKING', note: 'Vitz regular service completed by Mombasa Road Tyres & Service.', createdAt: daysFromNow(-5) },
      { userId: customer.id, points: 100, reason: 'REVIEW_EARNED', refType: 'ORG_REVIEW', note: 'Verified review published: Mombasa Road Tyres & Service.', createdAt: daysFromNow(-4) },
    ],
  })

  // ── Notifications demo ──
  await db.notification.createMany({
    data: [
      { userId: dealerOwner.id, type: 'ENQUIRY_RECEIVED', title: 'New enquiry on Prado TX-L', body: 'Amina Hassan asked about inspection availability.', link: '/dealer?tab=enquiries', createdAt: hoursAgo(3) },
      { userId: dealerOwner.id, type: 'INVOICE_DUE', title: 'Campaign invoice pending', body: 'INV-TD4K8Z for the Prado spotlight is awaiting payment.', link: '/dealer?tab=billing', createdAt: hoursAgo(20) },
      { userId: seller.id, type: 'OFFER_RECEIVED', title: '2 dealer offers on your Vitz', body: 'Compare offers from Nairobi Auto Hub and Westlands Motors.', link: '/my-listings', createdAt: hoursAgo(8) },
      { userId: customer.id, type: 'QUOTE_RECEIVED', title: 'New quote on your modification request', body: 'Premium Motors Garage quoted KES 98,000 for the lift kit.', link: '/account?tab=requests', createdAt: hoursAgo(26) },
    ],
  }).catch(() => {})
  const dealerNotifs = await db.notification.findMany({ where: { userId: dealerOwner.id } })
  for (const n of dealerNotifs) {
    await db.notificationDelivery.create({ data: { notificationId: n.id, channel: 'IN_APP', status: 'SENT', attempts: 1 } })
    await db.notificationDelivery.create({ data: { notificationId: n.id, channel: 'EMAIL', status: 'FAILED', attempts: 1, lastError: 'email provider not configured on this deployment' } })
  }

  // ── System settings (configurable business values) ──
  await db.systemSetting.createMany({
    data: [
      { key: 'contact', value: JSON.stringify({ email: 'support@carmaze.co.ke', phone: '+254 700 000 000', location: 'Nairobi, Kenya', hours: 'Mon–Sat, 8am–6pm EAT' }) },
      { key: 'review_sla', value: JSON.stringify({ initialReviewHours: 24, correctionDays: 7, escalationMultiplier: 2 }) },
      { key: 'policies', value: JSON.stringify({ transactionFeeNote: 'CARMAZE does not charge any fee on vehicle sales in the pilot. Any future lead or transaction fee will follow a signed agreement.', escrowNote: 'CARMAZE does not hold buyer funds or provide escrow. Vehicle payments are arranged directly between buyer and seller.' }) },
      { key: 'faqs', value: JSON.stringify([
        { q: 'Is CARMAZE free for private sellers?', a: 'Yes, creating and publishing a private listing is free during the pilot. Optional promotions are paid.' },
        { q: 'How are dealerships verified?', a: 'Every dealer submits business registration, premises and representative details. Our review team verifies documents before the "Verified" badge is granted, it is never bought.' },
        { q: 'How do dealer offers work?', a: 'When you list a car and opt into dealer matching, verified dealers can send offers through the platform. Your contact details stay private until you choose to engage.' },
        { q: 'Does CARMAZE handle vehicle payments?', a: 'No. During the pilot, vehicle payments are arranged directly between buyer and seller. We never hold buyer funds or offer escrow.' },
        { q: 'How do garage quotes work?', a: 'Describe the work (or share a 3D customizer configuration) and approved garages respond with quotes. You compare and choose, no obligation.' },
        { q: 'Is roadside assistance an emergency service?', a: 'No. CARMAZE connects you with independent providers. For emergencies always call 999 / 112 first.' },
        { q: 'What payment methods are supported for subscriptions?', a: 'M-Pesa (Safaricom Daraja) is integrated for dealer and garage subscriptions and promotions. Payment status is verified server-side via Daraja callbacks.' },
      ]) },
      { key: 'home_hero', value: JSON.stringify({ title: 'Find your next car with confidence', subtitle: 'Verified dealers, honest listings, trusted garages: one connected ecosystem built for Kenya.' }) },
    ],
  })

  await db.auditLog.createMany({
    data: [
      { actorId: admin.id, actorName: admin.name, action: 'APPLICATION_APPROVED', targetType: 'APPLICATION', targetId: app1.id, metadata: JSON.stringify({ org: dealerOrg.name }), createdAt: daysFromNow(-38) },
      { actorId: ops.id, actorName: ops.name, action: 'APPLICATION_INFO_REQUESTED', targetType: 'APPLICATION', targetId: appInfo.id, createdAt: daysFromNow(-2) },
    ],
  })

  // ───────────── Storefront data (dealer + garage business pages) ─────────────
  const standardHours = {
    mon: ['08:00', '18:00'], tue: ['08:00', '18:00'], wed: ['08:00', '18:00'],
    thu: ['08:00', '18:00'], fri: ['08:00', '18:00'], sat: ['09:00', '16:00'], sun: null,
  }
  const extendedHours = {
    mon: ['07:30', '18:30'], tue: ['07:30', '18:30'], wed: ['07:30', '18:30'],
    thu: ['07:30', '18:30'], fri: ['07:30', '18:30'], sat: ['08:00', '17:00'], sun: null,
  }

  await db.org.update({
    where: { id: dealerOrg.id },
    data: {
      coverUrl: '/images/hero.png',
      gallery: JSON.stringify(['/images/prado.png', '/images/harrier.png', '/images/xtrail.png', '/images/forester.png']),
      openingHours: JSON.stringify(standardHours),
      specialities: JSON.stringify(['Premium SUVs', 'Executive sedans', 'Trade-ins accepted', 'Financing assistance']),
      faqs: JSON.stringify([
        { q: 'Can I book an inspection before buying?', a: 'Yes, we encourage independent inspections and can arrange a Saturday viewing slot. Just message us through the platform.' },
        { q: 'Do you accept trade-ins?', a: 'We accept trade-ins of any make. Bring the logbook and a valid ID for a same-day valuation.' },
        { q: 'Is financing available?', a: 'We work with partner banks and saccos; approvals typically take 2–3 working days with a 20% deposit.' },
      ]),
      serviceAreas: JSON.stringify(['Nairobi', 'Kiambu', 'Machakos', 'Kajiado']),
      whatsappEnabled: true,
      callEnabled: true,
      responseMinutes: 45,
    },
  })
  await db.org.update({
    where: { id: dealerOrg2.id },
    data: {
      coverUrl: '/images/prado.png',
      gallery: JSON.stringify(['/images/demio.png', '/images/fit.png', '/images/dmax.png', '/images/c200.png']),
      openingHours: JSON.stringify(standardHours),
      specialities: JSON.stringify(['Family cars', 'Compact hatchbacks', 'Trade-in valuations']),
      faqs: JSON.stringify([
        { q: 'Are your prices negotiable?', a: 'Listed prices are close to final, but we consider serious offers and trade-in combos.' },
        { q: 'Do you deliver upcountry?', a: 'Yes, delivery within Nairobi is free; upcountry delivery is arranged per county.' },
      ]),
      serviceAreas: JSON.stringify(['Nairobi', 'Kiambu']),
      whatsappEnabled: false,
      callEnabled: true,
      responseMinutes: 90,
    },
  })
  await db.org.update({
    where: { id: garageOrg.id },
    data: {
      coverUrl: '/images/garage.png',
      gallery: JSON.stringify(['/images/prado.png', '/images/forester.png', '/images/xtrail.png']),
      openingHours: JSON.stringify(extendedHours),
      specialities: JSON.stringify(['Mechanical repairs', 'Auto-electrical diagnostics', 'Bodywork & spray', 'Performance upgrades']),
      faqs: JSON.stringify([
        { q: 'Do you use genuine parts?', a: 'We quote with genuine or OEM-equivalent parts. You approve the option before we order.' },
        { q: 'How does vehicle custody work?', a: 'Every handover is logged with photos, odometer and fuel level. You approve any road test and authorise collection with a secure code.' },
        { q: 'Can I get a quote before committing?', a: 'Yes, send your request through CARMAZE and we respond with an itemised quote, usually within a day.' },
      ]),
      serviceAreas: JSON.stringify(['Nairobi', 'Kiambu', 'Nakuru']),
      whatsappEnabled: true,
      callEnabled: true,
      responseMinutes: 60,
    },
  })
  await db.org.update({
    where: { id: garageOrg2.id },
    data: {
      coverUrl: '/images/intro-road.png',
      gallery: JSON.stringify(['/images/dmax.png', '/images/demio.png', '/images/vitz.png']),
      openingHours: JSON.stringify(extendedHours),
      specialities: JSON.stringify(['Tyres & alignment', 'Batteries', '24/7 roadside assistance']),
      faqs: JSON.stringify([
        { q: 'Do you offer roadside assistance at night?', a: 'Yes, call-outs run 24/7 within Nairobi. Night call-out rate applies from 8pm.' },
        { q: 'How long does a tyre fitting take?', a: 'Around 30–45 minutes for a set, including balancing and alignment check.' },
      ]),
      serviceAreas: JSON.stringify(['Nairobi', 'Machakos', 'Kajiado']),
      whatsappEnabled: false,
      callEnabled: true,
      responseMinutes: 120,
    },
  })

  // ───────────── Conversations (unified messaging) ─────────────
  await db.conversation.create({
    data: {
      orgId: dealerOrg.id,
      customerId: customer.id,
      vehicleId: prado.id,
      subject: 'Toyota Land Cruiser Prado TX-L: inspection & trade-in',
      kind: 'VEHICLE_ENQUIRY',
      lastMessageAt: hoursAgo(4),
      lastMessagePreview: 'Great, Saturday 10am works. Should I bring my Demio for the trade-in valuation too?',
      unreadForOrg: true,
      messages: {
        create: [
          { senderId: customer.id, senderName: customer.name, senderSide: 'CUSTOMER', body: 'Hi, is the Prado TX-L still available? I would like to view it this Saturday morning.', createdAt: hoursAgo(26) },
          { senderId: dealerStaff.id, senderName: dealerStaff.name, senderSide: 'ORG', body: 'Hello Amina, yes it is available. Saturday 10am works well. Ask for Brian at reception, Mombasa Road next to Gateway Mall.', createdAt: hoursAgo(24) },
          { senderId: customer.id, senderName: customer.name, senderSide: 'CUSTOMER', body: 'Great, Saturday 10am works. Should I bring my Demio for the trade-in valuation too?', createdAt: hoursAgo(4) },
        ],
      },
    },
  })
  await db.conversation.create({
    data: {
      orgId: garageOrg.id,
      customerId: customer.id,
      subject: 'Quote request: 2" lift kit for Prado',
      kind: 'QUOTE',
      lastMessageAt: hoursAgo(28),
      lastMessagePreview: 'Hi Amina, the itemised quote is KES 98,000 fitted, including alignment and a 12-month workmanship warranty.',
      unreadForCustomer: true,
      messages: {
        create: [
          { senderId: customer.id, senderName: customer.name, senderSide: 'CUSTOMER', body: 'Hi, I got your quote for the 2-inch lift kit and 18-inch wheels on my Prado. What is the final fitted price?', createdAt: hoursAgo(30) },
          { senderId: garageOwner.id, senderName: garageOwner.name, senderSide: 'ORG', body: 'Hi Amina, the itemised quote is KES 98,000 fitted, including alignment and a 12-month workmanship warranty.', createdAt: hoursAgo(28) },
        ],
      },
    },
  })

  // ───────────── Custody lifecycle (Garage Vehicle Protection) ─────────────
  const custody = await db.vehicleCustody.create({
    data: {
      refCode: 'HC-K7Q2MD',
      orgId: garageOrg.id,
      customerId: customer.id,
      myVehicleId: myVitz.id,
      vehicleDesc: 'Toyota Vitz 1.0 2016, KCX 118R',
      plate: 'KCX 118R',
      odometerKm: 62500,
      fuelLevel: 'QUARTER',
      conditionNotes: 'Minor scratch on rear bumper (pre-existing). No other known damage.',
      photos: JSON.stringify([]),
      valuables: 'Phone charger and umbrella in the boot.',
      requestedWork: 'Full engine service, replace front brake pads, and investigate the intermittent engine warning light.',
      authorisedSpendMinor: 1500000,
      roadTestAllowed: true,
      status: 'READY_FOR_COLLECTION',
      receivedAt: hoursAgo(47),
      receivedByStaffName: 'Mary Achieng',
      readyAt: hoursAgo(2),
      completedWork: 'Full service done, front brake pads replaced, engine warning light traced to a faulty VVT sensor and replaced. Road test clean.',
      finalOdometerKm: 62596,
      finalNotes: 'Vehicle in good condition. Rear bumper scratch as declared at drop-off, no new damage.',
      completionPhotos: JSON.stringify([]),
      costMinor: 1240000,
      createdAt: hoursAgo(48),
      events: {
        create: [
          { type: 'HANDOVER', actorId: customer.id, actorName: customer.name, actorSide: 'CUSTOMER', note: 'Handover requested: vehicle dropped off with declared condition and valuables.', createdAt: hoursAgo(48) },
          { type: 'STATUS_CHANGE', fromStatus: 'HANDOVER_REQUESTED', toStatus: 'RECEIVED', actorName: 'Mary Achieng', actorSide: 'ORG', note: 'Vehicle received by Mary Achieng. Drop-off photos taken.', createdAt: hoursAgo(47) },
          { type: 'STATUS_CHANGE', fromStatus: 'RECEIVED', toStatus: 'INSPECTION', actorName: 'Mary Achieng', actorSide: 'ORG', note: 'Inspection started: fluids, brakes and full diagnostics.', createdAt: hoursAgo(45) },
          { type: 'STATUS_CHANGE', fromStatus: 'INSPECTION', toStatus: 'WORK_IN_PROGRESS', actorName: 'Mary Achieng', actorSide: 'ORG', note: 'Estimate approved by customer; work started.', createdAt: hoursAgo(40) },
          { type: 'STATUS_CHANGE', fromStatus: 'WORK_IN_PROGRESS', toStatus: 'READY_FOR_COLLECTION', actorName: 'Mary Achieng', actorSide: 'ORG', note: 'Work completed: vehicle ready for collection.', createdAt: hoursAgo(2) },
        ],
      },
    },
  })
  await db.roadTest.create({
    data: {
      custodyId: custody.id,
      purpose: 'Verify repair: intermittent engine warning light',
      driverName: 'Samuel Otieno',
      status: 'COMPLETED',
      incident: false,
      requestedAt: hoursAgo(44),
      authorisedAt: hoursAgo(43),
      startedAt: hoursAgo(42),
      endedAt: hoursAgo(41),
      startOdometerKm: 62510,
      endOdometerKm: 62596,
      notes: 'Warning light stayed off across 86 km including highway section. No faults logged.',
    },
  })

  // ───────────── Test drives ─────────────
  const harrier = vehicles[1]
  await db.testDrive.create({
    data: {
      refCode: 'TD-K4M8XQ',
      orgId: dealerOrg.id,
      vehicleId: prado.id,
      customerId: customer.id,
      scheduledAt: daysFromNow(1),
      status: 'REQUESTED',
      licenceConfirmed: true,
      createdAt: hoursAgo(6),
    },
  })
  await db.testDrive.create({
    data: {
      refCode: 'TD-9XP2VN',
      orgId: dealerOrg.id,
      vehicleId: harrier.id,
      customerId: customer.id,
      scheduledAt: daysFromNow(-3),
      status: 'COMPLETED',
      licenceConfirmed: true,
      odometerOut: 76005,
      odometerIn: 76048,
      fuelOut: 'FULL',
      fuelIn: 'THREE_QUARTER',
      conditionOut: 'Clean, no visible damage',
      conditionIn: 'No new damage noted',
      releasedBy: 'Brian Ochieng',
      returnedBy: 'Brian Ochieng',
      startedAt: daysFromNow(-3),
      endedAt: daysFromNow(-3),
      notes: 'Customer happy with the drive; following up on financing options.',
      createdAt: daysFromNow(-4),
    },
  })

  // ───────────── Security incidents ─────────────
  const incOpen = await db.securityIncident.create({
    data: {
      refCode: 'INC-K8Q4XT',
      category: 'MISSING_FROM_GARAGE',
      reporterId: customer.id,
      reporterSide: 'CUSTOMER',
      title: 'Vehicle missing from partner garage yard',
      details: 'My vehicle was left at a partner garage for a scheduled service and could not be located at the agreed collection time. The garage could not account for it for several hours. Requesting a CARMAZE review of the custody records and CCTV.',
      status: 'OPEN',
      severity: 'HIGH',
      createdAt: hoursAgo(30),
    },
  })
  await db.incidentEvent.createMany({
    data: [
      { incidentId: incOpen.id, type: 'CREATED', actorId: customer.id, actorName: customer.name, note: 'Incident reported (MISSING_FROM_GARAGE).', createdAt: hoursAgo(30) },
      { incidentId: incOpen.id, type: 'NOTE', actorId: ops.id, actorName: ops.name, note: 'Premises CCTV footage requested; garage owner contacted for a statement.', createdAt: hoursAgo(26) },
    ],
  })
  const incResolved = await db.securityIncident.create({
    data: {
      refCode: 'INC-3RT9WB',
      category: 'DAMAGE_IN_CUSTODY',
      reporterId: customer.id,
      reporterSide: 'CUSTOMER',
      orgId: garageOrg2.id,
      vehicleDesc: 'Toyota Vitz 2016 (KCX 118R)',
      title: 'Alloy wheel scuffed during service visit',
      details: 'After collecting my Vitz from a routine service, I noticed a fresh scuff on the front-left alloy wheel that was not there at drop-off. I raised it with the garage the same day and they acknowledged the damage occurred on their lift.',
      status: 'RESOLVED',
      severity: 'LOW',
      resolutionNote: 'Garage accepted liability and refurbished the wheel at no cost. Customer confirmed satisfied and closed the case.',
      resolvedAt: daysFromNow(-6),
      createdAt: daysFromNow(-9),
    },
  })
  await db.incidentEvent.createMany({
    data: [
      { incidentId: incResolved.id, type: 'CREATED', actorId: customer.id, actorName: customer.name, note: 'Incident reported (DAMAGE_IN_CUSTODY).', createdAt: daysFromNow(-9) },
      { incidentId: incResolved.id, type: 'RESOLUTION', actorId: ops.id, actorName: ops.name, note: 'Garage accepted liability and refurbished the wheel at no cost. Customer confirmed satisfied and closed the case.', createdAt: daysFromNow(-6) },
    ],
  })

  // ───────────── Automotive Supply Network + business programmes ─────────────
  const supply = await seedSupply(db, {
    PASSWORD,
    bcrypt,
    adminId: admin.id,
    customerId: customer.id,
    garageOrgId: garageOrg.id,
    dealerOrgId: dealerOrg.id,
  })

  // ════════════════════════════════════════════════════════════════════════
  // Demo accounts for EVERY platform + real workflow data for every flow that
  // was previously unseeded: LogisticsOS, staff departments, the document
  // verification engine, B2C consumer orders, disputes, RFQs, branch
  // transfers, warranty/returns and moderation queues.
  // ════════════════════════════════════════════════════════════════════════

  // ── Company Staff Platform: one account per department ──
  const staffFinance = await db.user.create({ data: { email: 'finance@carmaze.co.ke', name: 'Njoroge Kamau', passwordHash: hash, phone: '+254701234001', phoneVerified: true, roles: 'FINANCE', department: 'FINANCE' } })
  const staffDisputes = await db.user.create({ data: { email: 'disputes@carmaze.co.ke', name: 'Zawadi Naliaka', passwordHash: hash, phone: '+254701234002', phoneVerified: true, roles: 'MODERATOR', department: 'DISPUTES' } })
  const staffFraud = await db.user.create({ data: { email: 'fraud@carmaze.co.ke', name: 'Kipchumba Rotich', passwordHash: hash, phone: '+254701234003', phoneVerified: true, roles: 'REVIEWER,MODERATOR', department: 'FRAUD' } })
  const staffSupport = await db.user.create({ data: { email: 'support@carmaze.co.ke', name: 'Halima Yusuf', passwordHash: hash, isDemo: true, phone: '+254701234004', phoneVerified: true, roles: 'SUPPORT', department: 'SUPPORT' } })
  const staffReviewer = await db.user.create({ data: { email: 'reviewer@carmaze.co.ke', name: 'Achieng Odhiambo', passwordHash: hash, phone: '+254701234005', phoneVerified: true, roles: 'REVIEWER', department: 'BUSINESS_VERIFICATION' } })
  const referralCodes: [string, string][] = [
    [staffFinance.id, 'FIN4M8TQ'], [staffDisputes.id, 'DSP7K2WN'], [staffFraud.id, 'FRD9X4PL'],
    [staffSupport.id, 'SUP2R6VH'], [staffReviewer.id, 'RVW5C8JD'],
  ]
  for (const [id, code] of referralCodes) await db.user.update({ where: { id }, data: { referralCode: code } })

  // ── LogisticsOS: approved delivery partner + fleet + live job board ──
  const logisticsOwner = await db.user.create({ data: { email: 'logistics@carmaze.co.ke', name: 'Oscar Mutua', passwordHash: hash, isDemo: true, phone: '+254734555777', phoneVerified: true, roles: 'CUSTOMER,LOGISTICS_OWNER' } })
  await db.user.update({ where: { id: logisticsOwner.id }, data: { referralCode: 'LGS3N9KW' } })

  const logisticsApp = await db.application.create({
    data: {
      refCode: 'LGA-4TD8M2', type: 'LOGISTICS', userId: logisticsOwner.id, orgName: 'Swift Movers Logistics',
      regNo: 'BN-2021-6634', county: 'Nairobi', town: 'Industrial Area', physicalAddress: 'Bunyala Road, Industrial Area',
      phone: '+254734555777', email: 'dispatch@swiftmovers.co.ke', representative: 'Oscar Mutua',
      accountType: 'COMPANY', categories: 'PARCELS,VEHICLES,PARTS', consent: true,
      status: 'APPROVED', reviewSlaHours: 48, reviewOwnerId: admin.id, reviewOwnerName: admin.name,
      decisionNote: 'Licences, insurance and vehicle records verified. Approved as a delivery partner.',
      submittedAt: daysFromNow(-32), createdAt: daysFromNow(-33),
    },
  })
  const logisticsPartner = await db.logisticsPartner.create({
    data: {
      refCode: 'LGP-DEMO01', ownerUserId: logisticsOwner.id, name: 'Swift Movers Logistics', partnerType: 'COMPANY',
      regNo: 'BN-2021-6634', county: 'Nairobi', town: 'Industrial Area', phone: '+254734555777',
      email: 'dispatch@swiftmovers.co.ke', representative: 'Oscar Mutua',
      serviceAreas: JSON.stringify(['Nairobi', 'Kiambu', 'Machakos', 'Kajiado']),
      capabilities: JSON.stringify(['PARCELS', 'VEHICLES', 'PARTS']),
      consent: true, status: 'APPROVED', verified: true,
      decisionNote: 'Licences, insurance and vehicle records verified.',
      appliedAt: daysFromNow(-32), reviewedAt: daysFromNow(-30), reviewedByName: admin.name,
      events: {
        create: [
          { type: 'SUBMITTED', actorId: logisticsOwner.id, actorName: logisticsOwner.name, note: 'Delivery partner application submitted.', createdAt: daysFromNow(-32) },
          { type: 'APPROVED', actorId: admin.id, actorName: admin.name, note: 'Documents verified after review. Welcome to the network.', createdAt: daysFromNow(-30) },
        ],
      },
    },
  })
  await db.application.update({ where: { id: logisticsApp.id }, data: { orgId: logisticsPartner.id } })
  await db.driver.createMany({
    data: [
      { partnerId: logisticsPartner.id, name: 'Kevin Otieno', phone: '+254738111001', licenseNo: 'DL-KE-448120', vehicleReg: 'KMDA 441J', vehicleType: 'MOTORBIKE' },
      { partnerId: logisticsPartner.id, name: 'Peter Kariuki', phone: '+254738111002', licenseNo: 'DL-KE-521907', vehicleReg: 'KCX 219R', vehicleType: 'PICKUP' },
      { partnerId: logisticsPartner.id, name: 'Dennis Barasa', phone: '+254738111003', licenseNo: 'DL-KE-390884', vehicleReg: 'KDG 908T', vehicleType: 'VAN' },
      { partnerId: logisticsPartner.id, name: 'Samuel Kirui', phone: '+254738111004', licenseNo: 'DL-KE-562231', vehicleReg: 'KCF 223M', vehicleType: 'TOW_TRUCK', status: 'INACTIVE' },
    ],
  })
  const swiftDriverRows = await db.driver.findMany({ where: { partnerId: logisticsPartner.id }, orderBy: { createdAt: 'asc' } })

  // Verification documents for the logistics application: all VERIFIED (it was approved)
  await db.verificationDocument.createMany({
    data: [
      { refCode: 'DOC-LG-0192', ownerUserId: logisticsOwner.id, applicationId: logisticsApp.id, kind: 'DRIVER_LICENSE', label: 'Company driver licence (Oscar Mutua)', fileUrl: '/api/files/demo-doc.pdf', fileName: 'driver-license.pdf', status: 'VERIFIED', reviewedById: admin.id, reviewedByName: admin.name, reviewedAt: daysFromNow(-31), reviewNote: 'Valid licence class checked against NTSA records.', expiresAt: daysFromNow(700) },
      { refCode: 'DOC-LG-0193', ownerUserId: logisticsOwner.id, applicationId: logisticsApp.id, kind: 'INSURANCE', label: 'Goods-in-transit insurance certificate', fileUrl: '/api/files/demo-doc.pdf', fileName: 'insurance.pdf', status: 'VERIFIED', reviewedById: admin.id, reviewedByName: admin.name, reviewedAt: daysFromNow(-31), reviewNote: 'Cover confirmed active for the declared vehicle fleet.', expiresAt: daysFromNow(240) },
      { refCode: 'DOC-LG-0194', ownerUserId: logisticsOwner.id, applicationId: logisticsApp.id, kind: 'BUSINESS_LICENSE', label: 'Swift Movers business permit', fileUrl: '/api/files/demo-doc.pdf', fileName: 'business-license.pdf', status: 'VERIFIED', reviewedById: admin.id, reviewedByName: admin.name, reviewedAt: daysFromNow(-31), reviewNote: 'County business permit genuine and current.', expiresAt: daysFromNow(330) },
    ],
  })
  await db.documentAccessLog.createMany({
    data: [
      { documentId: (await db.verificationDocument.findFirst({ where: { refCode: 'DOC-LG-0192' } }))!.id, viewerId: admin.id, viewerName: admin.name, action: 'VIEWED' },
      { documentId: (await db.verificationDocument.findFirst({ where: { refCode: 'DOC-LG-0193' } }))!.id, viewerId: admin.id, viewerName: admin.name, action: 'DOWNLOADED' },
    ],
  })

  // Delivery jobs across the real lifecycle (OTP-verified handover demo)
  const jobOtp = (code: string) => ({ otpHash: bcrypt.hashSync(code, 10), otpHint: code.slice(-2) })
  await db.deliveryJob.create({
    data: {
      refCode: 'JOB-DEMO01', requestedByUserId: customer.id, partnerId: logisticsPartner.id, driverId: swiftDriverRows[0].id,
      cargoDesc: 'Rear shock absorbers (2) collected from Sifa Auto Spares', sizeClass: 'SMALL',
      pickupCounty: 'Nairobi', pickupAddress: 'Sifa Auto Spares, Industrial Area', pickupContactName: 'Sifa Front Desk', pickupContactPhone: '+254720111222',
      dropCounty: 'Nairobi', dropAddress: 'Kilimani, Elgeyo Marakwet Rd', dropContactName: 'Amina Hassan', dropContactPhone: '+254745654321',
      status: 'DELIVERED', feeMinor: 90000, ...jobOtp('418273'), qrToken: 'QR-JOB-DEMO01',
      podPhotos: JSON.stringify(['/images/harrier.png']),
      pickupAt: daysFromNow(-3), deliveredAt: new Date(Date.now() - 3 * 24 * 3600 * 1000 + 2.5 * 3600 * 1000),
      events: {
        create: [
          { type: 'CREATED', actorId: customer.id, actorName: customer.name, actorSide: 'CUSTOMER', note: 'Delivery requested: parts from Industrial Area to Kilimani.', createdAt: daysFromNow(-3) },
          { type: 'ACCEPTED', actorId: logisticsOwner.id, actorName: 'Swift Movers Logistics', actorSide: 'PARTNER', note: 'Accepted and assigned to Kevin Otieno (KMDA 441J). Fee KES 900.', createdAt: daysFromNow(-3) },
          { type: 'PICKED_UP', actorId: logisticsOwner.id, actorName: 'Kevin Otieno', actorSide: 'PARTNER', note: 'Collected from supplier: quantity and seals confirmed.', createdAt: daysFromNow(-3) },
          { type: 'DELIVERED', actorId: logisticsOwner.id, actorName: 'Kevin Otieno', actorSide: 'PARTNER', note: 'Delivered. Handover OTP verified; proof-of-delivery photo attached.', createdAt: new Date(Date.now() - 3 * 24 * 3600 * 1000 + 2.5 * 3600 * 1000) },
        ],
      },
    },
  })
  await db.deliveryJob.create({
    data: {
      refCode: 'JOB-DEMO02', requestedByUserId: garageOwner.id, requesterOrgId: garageOrg.id, requesterOrgName: garageOrg.name,
      partnerId: logisticsPartner.id, driverId: swiftDriverRows[1].id,
      cargoDesc: 'Pallet of mixed filters, warehouse to workshop transfer', sizeClass: 'MEDIUM',
      pickupCounty: 'Nairobi', pickupAddress: 'Sifa HQ Warehouse, Industrial Area', pickupContactName: 'Sifa Dispatch', pickupContactPhone: '+254720111222',
      dropCounty: 'Nairobi', dropAddress: 'Premium Motors Garage, Westlands', dropContactName: 'Mary Achieng', dropContactPhone: '+254722999000',
      status: 'IN_TRANSIT', feeMinor: 185000, ...jobOtp('552901'),
      pickupAt: hoursAgo(2),
      events: {
        create: [
          { type: 'CREATED', actorId: garageOwner.id, actorName: garageOwner.name, actorSide: 'CUSTOMER', note: 'Warehouse transfer run requested for this afternoon.', createdAt: hoursAgo(4) },
          { type: 'ACCEPTED', actorId: logisticsOwner.id, actorName: 'Swift Movers Logistics', actorSide: 'PARTNER', note: 'Assigned to Peter Kariuki (KCX 219R). Fee KES 1,850.', createdAt: hoursAgo(3) },
          { type: 'PICKED_UP', actorId: logisticsOwner.id, actorName: 'Peter Kariuki', actorSide: 'PARTNER', note: 'Pallet collected and strapped.', createdAt: hoursAgo(2) },
          { type: 'IN_TRANSIT', actorId: logisticsOwner.id, actorName: 'Peter Kariuki', actorSide: 'PARTNER', note: 'En route via Uhuru Highway.', createdAt: hoursAgo(1) },
        ],
      },
    },
  })
  await db.deliveryJob.create({
    data: {
      refCode: 'JOB-DEMO03', requestedByUserId: dealerOwner.id, requesterOrgId: dealerOrg.id, requesterOrgName: dealerOrg.name,
      partnerId: logisticsPartner.id, driverId: swiftDriverRows[2].id,
      cargoDesc: 'Toyota Prado TX, showroom transfer to Kilimani client', sizeClass: 'LARGE',
      pickupCounty: 'Nairobi', pickupAddress: 'Nairobi Auto Hub, Mombasa Road', pickupContactName: 'Showroom Desk', pickupContactPhone: '+254711555666',
      dropCounty: 'Nairobi', dropAddress: 'Kilimani Business Centre', dropContactName: 'Client handover', dropContactPhone: '+254701000200',
      status: 'ASSIGNED', feeMinor: 650000,
      events: {
        create: [
          { type: 'CREATED', actorId: dealerOwner.id, actorName: dealerOwner.name, actorSide: 'CUSTOMER', note: 'Vehicle delivery booked for Saturday morning.', createdAt: hoursAgo(20) },
          { type: 'ACCEPTED', actorId: logisticsOwner.id, actorName: 'Swift Movers Logistics', actorSide: 'PARTNER', note: 'Assigned to Dennis Barasa (KDG 908T). Fee KES 6,500.', createdAt: hoursAgo(18) },
        ],
      },
    },
  })
  await db.deliveryJob.create({
    data: {
      refCode: 'JOB-DEMO04', requestedByUserId: customer.id,
      cargoDesc: 'Espresso machine + 2 boxes of shop fittings', sizeClass: 'MEDIUM',
      pickupCounty: 'Nairobi', pickupAddress: 'Lavington, James Gichuru Rd', pickupContactName: 'Amina Hassan', pickupContactPhone: '+254745654321',
      dropCounty: 'Kiambu', dropAddress: 'Kiambu Town, Gatundu Rd', dropContactName: 'Grace Wanjiku', dropContactPhone: '+254799000111',
      status: 'OPEN',
      events: { create: [{ type: 'CREATED', actorId: customer.id, actorName: customer.name, actorSide: 'CUSTOMER', note: 'Open on the partner board, awaiting a delivery partner.', createdAt: hoursAgo(3) }] },
    },
  })
  await db.deliveryJob.create({
    data: {
      refCode: 'JOB-DEMO05', requestedByUserId: customer.id, partnerId: logisticsPartner.id, driverId: swiftDriverRows[0].id,
      cargoDesc: 'Tyre change kit, return to sender after failed drop-off', sizeClass: 'SMALL',
      pickupCounty: 'Nairobi', pickupAddress: 'Highway Tyre Distributors, South C', pickupContactName: 'Highway Tyres', pickupContactPhone: '+254733222333',
      dropCounty: 'Machakos', dropAddress: 'Mlolongo, Mombasa Rd', dropContactName: 'Customer pickup point', dropContactPhone: '+254700444555',
      status: 'FAILED', feeMinor: 75000, failReason: 'Recipient unreachable at drop-off after 3 attempts; parcel returned to sender.',
      pickupAt: daysFromNow(-6),
      events: {
        create: [
          { type: 'CREATED', actorId: customer.id, actorName: customer.name, actorSide: 'CUSTOMER', note: 'Delivery requested to Mlolongo.', createdAt: daysFromNow(-6) },
          { type: 'ACCEPTED', actorId: logisticsOwner.id, actorName: 'Swift Movers Logistics', actorSide: 'PARTNER', note: 'Assigned to Kevin Otieno.', createdAt: daysFromNow(-6) },
          { type: 'FAILED', actorId: logisticsOwner.id, actorName: 'Kevin Otieno', actorSide: 'PARTNER', note: 'Recipient unreachable at drop-off after 3 attempts; parcel returned to sender.', createdAt: daysFromNow(-6) },
        ],
      },
    },
  })

  // Pending logistics application (review queue demo, uploaded ≠ verified)
  const applyLogisticsUser = await db.user.create({ data: { email: 'apply.logistics@carmaze.co.ke', name: 'Faith Chebet', passwordHash: hash, isDemo: true, phone: '+254799333000', roles: 'CUSTOMER' } })
  await db.user.update({ where: { id: applyLogisticsUser.id }, data: { referralCode: 'LGA8Q4ZX' } })
  const pendingLogisticsApp = await db.application.create({
    data: {
      refCode: 'LGA-9KP3RQ', type: 'LOGISTICS', userId: applyLogisticsUser.id, orgName: 'Chebet Rapid Deliveries',
      county: 'Nakuru', town: 'Nakuru Town', physicalAddress: 'Kenyatta Avenue, Nakuru', phone: '+254799333000',
      email: 'faith@chebetrapid.co.ke', representative: 'Faith Chebet', accountType: 'INDEPENDENT',
      categories: 'PARCELS', consent: true, status: 'SUBMITTED', submittedAt: hoursAgo(9),
      documents: JSON.stringify([{ name: 'drivers-licence.jpg', url: '/api/files/demo-doc.pdf' }, { name: 'insurance-cover.pdf', url: '/api/files/demo-doc.pdf' }]),
    },
  })
  await db.applicationEvent.create({ data: { applicationId: pendingLogisticsApp.id, type: 'SUBMITTED', actorId: applyLogisticsUser.id, actorName: applyLogisticsUser.name, note: 'Application submitted for review.', createdAt: hoursAgo(9) } })
  await db.verificationDocument.createMany({
    data: [
      { refCode: 'DOC-LG-0301', ownerUserId: applyLogisticsUser.id, applicationId: pendingLogisticsApp.id, kind: 'DRIVER_LICENSE', label: 'drivers-licence.jpg', fileUrl: '/api/files/demo-doc.pdf', fileName: 'drivers-licence.jpg', status: 'SUBMITTED' },
      { refCode: 'DOC-LG-0302', ownerUserId: applyLogisticsUser.id, applicationId: pendingLogisticsApp.id, kind: 'INSURANCE', label: 'insurance-cover.pdf', fileUrl: '/api/files/demo-doc.pdf', fileName: 'insurance-cover.pdf', status: 'SUBMITTED' },
    ],
  })

  // ── Private-seller platform: verified seller with a full KYC trail ──
  const verifiedSeller = await db.user.create({ data: { email: 'verified.seller@carmaze.co.ke', name: 'Wanjiku Kariuki', passwordHash: hash, isDemo: true, phone: '+254737888999', phoneVerified: true, roles: 'CUSTOMER,SELLER,SELLER_VERIFIED' } })
  await db.user.update({ where: { id: verifiedSeller.id }, data: { referralCode: 'VSL6H3YT' } })
  const sellerApp = await db.application.create({
    data: {
      refCode: 'SLA-2VF7KD', type: 'SELLER', userId: verifiedSeller.id, orgName: 'Wanjiku Kariuki (Private seller)',
      county: 'Nairobi', town: 'Kasarani', physicalAddress: 'Kasarani Mwiki Road', phone: '+254737888999',
      email: 'wanjiku.k@example.co.ke', representative: 'Wanjiku Kariuki', consent: true,
      status: 'APPROVED', reviewSlaHours: 24, reviewOwnerId: ops.id, reviewOwnerName: ops.name,
      decisionNote: 'National ID and logbook ownership verified. Seller verification granted.',
      submittedAt: daysFromNow(-15), createdAt: daysFromNow(-16),
    },
  })
  await db.applicationEvent.createMany({
    data: [
      { applicationId: sellerApp.id, type: 'SUBMITTED', actorId: verifiedSeller.id, actorName: verifiedSeller.name, note: 'Application submitted for review.', createdAt: daysFromNow(-15) },
      { applicationId: sellerApp.id, type: 'APPROVED', actorId: ops.id, actorName: ops.name, note: 'National ID and logbook ownership verified. Seller verification granted.', createdAt: daysFromNow(-13) },
    ],
  })
  await db.verificationDocument.createMany({
    data: [
      { refCode: 'DOC-SL-0110', ownerUserId: verifiedSeller.id, applicationId: sellerApp.id, kind: 'ID_FRONT', label: 'National ID (front)', fileUrl: '/api/files/demo-doc.pdf', fileName: 'id-front.jpg', status: 'VERIFIED', reviewedById: ops.id, reviewedByName: ops.name, reviewedAt: daysFromNow(-14), reviewNote: 'ID serial and photo match the holder selfie.' },
      { refCode: 'DOC-SL-0111', ownerUserId: verifiedSeller.id, applicationId: sellerApp.id, kind: 'OWNERSHIP_AUTH', label: 'Logbook (authority to sell)', fileUrl: '/api/files/demo-doc.pdf', fileName: 'logbook.jpg', status: 'VERIFIED', reviewedById: ops.id, reviewedByName: ops.name, reviewedAt: daysFromNow(-14), reviewNote: 'Logbook number and owner name consistent with NTSA search.' },
    ],
  })
  await db.documentAccessLog.createMany({
    data: [
      { documentId: (await db.verificationDocument.findFirst({ where: { refCode: 'DOC-SL-0110' } }))!.id, viewerId: ops.id, viewerName: ops.name, action: 'VIEWED' },
      { documentId: (await db.verificationDocument.findFirst({ where: { refCode: 'DOC-SL-0111' } }))!.id, viewerId: ops.id, viewerName: ops.name, action: 'VIEWED' },
    ],
  })

  // Verification documents for the existing demo applications, giving the
  // Verification Center a real queue across every state of the machine.
  await db.verificationDocument.createMany({
    data: [
      // Approved dealer application: fully verified history
      { refCode: 'DOC-DL-0001', ownerUserId: dealerOwner.id, orgId: dealerOrg.id, applicationId: app1.id, kind: 'BUSINESS_LICENSE', label: 'Business registration certificate', fileUrl: '/api/files/demo-doc.pdf', fileName: 'business-registration.pdf', status: 'VERIFIED', reviewedById: admin.id, reviewedByName: admin.name, reviewedAt: daysFromNow(-39), reviewNote: 'Registrar search matched. Premises visit done.', expiresAt: daysFromNow(320) },
      { refCode: 'DOC-DL-0002', ownerUserId: dealerOwner.id, orgId: dealerOrg.id, applicationId: app1.id, kind: 'PIN_CERTIFICATE', label: 'KRA PIN certificate', fileUrl: '/api/files/demo-doc.pdf', fileName: 'kra-pin.pdf', status: 'VERIFIED', reviewedById: admin.id, reviewedByName: admin.name, reviewedAt: daysFromNow(-39), reviewNote: 'PIN active on iTax.' },
      // Pending dealer application: awaiting first review
      { refCode: 'DOC-DL-0101', ownerUserId: pendingDealerUser.id, applicationId: appPending.id, kind: 'BUSINESS_LICENSE', label: 'business-registration.pdf', fileUrl: '/api/files/demo-doc.pdf', fileName: 'business-registration.pdf', status: 'SUBMITTED' },
      { refCode: 'DOC-DL-0102', ownerUserId: pendingDealerUser.id, applicationId: appPending.id, kind: 'PIN_CERTIFICATE', label: 'kra-pin.pdf', fileUrl: '/api/files/demo-doc.pdf', fileName: 'kra-pin.pdf', status: 'SUBMITTED' },
      // Garage application awaiting corrections
      { refCode: 'DOC-GR-0201', ownerUserId: pendingGarageUser.id, applicationId: appInfo.id, kind: 'REGISTRATION_CERT', label: 'Workshop permit scan', fileUrl: '/api/files/demo-doc.pdf', fileName: 'workshop-permit.jpg', status: 'MORE_INFO_REQUIRED', reviewedById: ops.id, reviewedByName: ops.name, reviewedAt: daysFromNow(-2), reviewNote: 'Scan is blurred and the permit number is unreadable. Upload a clear colour scan.', infoRequestedAt: daysFromNow(-2), correctionsDueAt: daysFromNow(2) },
    ],
  })
  await db.documentAccessLog.createMany({
    data: [
      { documentId: (await db.verificationDocument.findFirst({ where: { refCode: 'DOC-DL-0001' } }))!.id, viewerId: admin.id, viewerName: admin.name, action: 'VIEWED' },
      { documentId: (await db.verificationDocument.findFirst({ where: { refCode: 'DOC-DL-0001' } }))!.id, viewerId: ops.id, viewerName: ops.name, action: 'VIEWED' },
      { documentId: (await db.verificationDocument.findFirst({ where: { refCode: 'DOC-GR-0201' } }))!.id, viewerId: ops.id, viewerName: ops.name, action: 'VIEWED' },
    ],
  })

  // ── B2C consumer orders (parts ordered by the demo customer from Sifa) ──
  const sifaProducts = await db.product.findMany({ where: { supplierOrgId: supply.partsSupplierId }, orderBy: { createdAt: 'asc' } })
  const oilFilter = sifaProducts.find((p) => p.sku === 'SIF-FLT-OIL-TY') ?? sifaProducts[0]
  const brakePads = sifaProducts.find((p) => p.sku === 'SIF-BRK-PAD-FR') ?? sifaProducts[1] ?? oilFilter
  const sifaWh1 = await db.orgBranch.findFirst({ where: { code: 'SIFA-WH1' } })
  const sifaOwnerMember = await db.orgMember.findFirst({ where: { orgId: supply.partsSupplierId, role: 'OWNER' } })

  const coA = await db.customerOrder.create({
    data: {
      refCode: 'CO-DEMO01', buyerUserId: customer.id, supplierOrgId: supply.partsSupplierId,
      county: 'Nairobi', address: 'Kilimani, Elgeyo Marakwet Rd, Apt 4B', phone: '+254745654321',
      notes: 'Please call before delivery.', deliveryMethod: 'DIRECT', deliveryFeeMinor: 20000,
      totalMinor: 604000, paymentStatus: 'PAID', status: 'DISPUTED',
      courierName: 'Swift Movers Logistics', fulfillmentBranchId: sifaWh1?.id,
      otpHash: bcrypt.hashSync('918273', 10), otpHint: '9273',
      deliveredAt: daysFromNow(-6), completedAt: new Date(Date.now() - 6 * 24 * 3600 * 1000 + 3 * 3600 * 1000),
      items: {
        create: [
          { productId: oilFilter.id, qty: 2, unitPriceMinor: oilFilter.unitPriceMinor ?? 52000, lineTotalMinor: (oilFilter.unitPriceMinor ?? 52000) * 2 },
          { productId: brakePads.id, qty: 1, unitPriceMinor: brakePads.unitPriceMinor ?? 480000, lineTotalMinor: brakePads.unitPriceMinor ?? 480000 },
        ],
      },
      events: {
        create: [
          { type: 'SUBMITTED', actorSide: 'CUSTOMER', actorId: customer.id, actorName: customer.name, note: 'Order placed.', createdAt: daysFromNow(-9) },
          { type: 'ACCEPTED', actorSide: 'SUPPLIER', actorId: sifaOwnerMember?.userId, actorName: 'Sifa Auto Spares', note: 'Accepted: fulfilment from Sifa HQ Warehouse. Invoice issued.', createdAt: daysFromNow(-9) },
          { type: 'DISPATCHED', actorSide: 'SUPPLIER', actorId: sifaOwnerMember?.userId, actorName: 'Sifa Auto Spares', note: 'Dispatched via Swift Movers Logistics. Collection code sent to the customer.', createdAt: daysFromNow(-7) },
          { type: 'DELIVERED', actorSide: 'SUPPLIER', actorId: sifaOwnerMember?.userId, actorName: 'Sifa Auto Spares', note: 'Delivered: collection code verified.', createdAt: daysFromNow(-6) },
          { type: 'COMPLETED', actorSide: 'CUSTOMER', actorId: customer.id, actorName: customer.name, note: 'Customer confirmed receipt.', createdAt: new Date(Date.now() - 6 * 24 * 3600 * 1000 + 3 * 3600 * 1000) },
          { type: 'DISPUTED', actorSide: 'CUSTOMER', actorId: customer.id, actorName: customer.name, note: 'Dispute DSP-DEMO01 opened (WRONG_ITEM).', createdAt: hoursAgo(30) },
        ],
      },
    },
  })
  const coAInvoice = await db.invoice.create({
    data: {
      refCode: 'INV-CO0001', orgId: supply.partsSupplierId, userId: customer.id, type: 'PARTS_ORDER',
      description: `Parts order CO-DEMO01, Sifa Auto Spares`, amountMinor: 604000, currency: 'KES',
      status: 'PAID', paidVia: 'MPESA', paidAt: daysFromNow(-8), dueDate: daysFromNow(-2),
    },
  })
  await db.customerOrder.update({ where: { id: coA.id }, data: { invoiceId: coAInvoice.id } })

  // Open consumer dispute, visible in Account → Orders, SupplierOS consumer
  // orders, and the staff supply console (full resolution path is live).
  await db.dispute.create({
    data: {
      refCode: 'DSP-DEMO01', customerOrderId: coA.id, openedById: customer.id, openedBySide: 'CUSTOMER',
      reason: 'WRONG_ITEM', amountFrozenMinor: 604000, status: 'OPEN',
      details: 'I ordered front brake pads for a Toyota Harrier (part number matching the listing) but the box delivered contains rear pads for a different model. The oil filters are correct. Photos available on request. The courier sealed the handover with my OTP so this was packed wrongly at the warehouse.',
      events: {
        create: [
          { type: 'CREATED', actorId: customer.id, actorName: customer.name, note: 'Dispute opened by the customer: WRONG_ITEM. Front pads ordered, rear pads delivered.', createdAt: hoursAgo(30) },
          { type: 'NOTE', actorId: staffDisputes.id, actorName: staffDisputes.name, note: 'Case assigned to disputes desk. Supplier response requested within 48h; order records and dispatch evidence pulled.', createdAt: hoursAgo(24) },
        ],
      },
    },
  })

  await db.customerOrder.create({
    data: {
      refCode: 'CO-DEMO02', buyerUserId: customer.id, supplierOrgId: supply.partsSupplierId,
      county: 'Nairobi', address: 'Kilimani, Elgeyo Marakwet Rd, Apt 4B', phone: '+254745654321',
      deliveryMethod: 'DIRECT', deliveryFeeMinor: 20000, totalMinor: 240000, paymentStatus: 'UNPAID', status: 'SUBMITTED',
      items: { create: [{ productId: oilFilter.id, qty: 4, unitPriceMinor: oilFilter.unitPriceMinor ?? 52000, lineTotalMinor: (oilFilter.unitPriceMinor ?? 52000) * 4 }] },
      events: { create: [{ type: 'SUBMITTED', actorSide: 'CUSTOMER', actorId: customer.id, actorName: customer.name, note: 'Order placed.', createdAt: hoursAgo(5) }] },
    },
  })

  // ── Garage ↔ Supplier RFQ flow (QuoteRequest → QuoteOffer) ──
  const qr1 = await db.quoteRequest.create({
    data: {
      refCode: 'RFQ-DEMO01', garageOrgId: garageOrg.id, createdById: garageOwner.id,
      title: 'All-terrain tyres for Land Cruiser Prado', description: 'Need 4 AT tyres 265/65 R17, load index 112+, for a 2018 Prado. Genuine stock with warranty preferred. Fitting not required.',
      vehicleJson: JSON.stringify({ make: 'Toyota', model: 'Land Cruiser Prado', year: 2018, engine: '2.8D' }),
      budgetMinor: 800000, deliveryCounty: 'Nairobi', status: 'QUOTING', expiresAt: daysFromNow(6),
      createdAt: daysFromNow(-2),
    },
  })
  const allSupplierOrgIds = Array.from(new Set((await db.product.findMany({ select: { supplierOrgId: true } })).map((p) => p.supplierOrgId))).filter((id) => id !== supply.partsSupplierId)
  await db.quoteOffer.createMany({
    data: [
      { requestId: qr1.id, supplierOrgId: allSupplierOrgIds[0] ?? supply.partsSupplierId, amountMinor: 748000, leadDays: 2, note: 'Dunlop AT20 set of 4, 2-year manufacturer warranty. From HWY-WH1, free delivery within Nairobi.', status: 'PENDING', itemsJson: JSON.stringify([{ name: '265/65 R17 AT tyre', qty: 4, unitPriceMinor: 187000 }]), createdAt: daysFromNow(-1) },
      { requestId: qr1.id, supplierOrgId: allSupplierOrgIds[1] ?? supply.partsSupplierId, amountMinor: 796000, leadDays: 1, note: 'Bridgestone Dueler set of 4, genuine import, fitting kit included.', status: 'PENDING', itemsJson: JSON.stringify([{ name: '265/65 R17 Dueler AT', qty: 4, unitPriceMinor: 199000 }]), createdAt: hoursAgo(20) },
    ],
  })
  const qr2 = await db.quoteRequest.create({
    data: {
      refCode: 'RFQ-DEMO02', garageOrgId: garageOrg.id, createdById: garageOwner.id,
      title: 'Oil filters wholesale, 20 units mixed', description: 'Standing replenishment for common Japanese makes. Mixed genuine/OEM acceptable, quote both.',
      budgetMinor: 900000, deliveryCounty: 'Nairobi', status: 'CLOSED', createdAt: daysFromNow(-18), expiresAt: daysFromNow(-4),
    },
  })
  await db.quoteOffer.create({
    data: { requestId: qr2.id, supplierOrgId: supply.partsSupplierId, amountMinor: 860000, leadDays: 3, note: 'Genuine Toyota/Denso/Nitto mix as per attached list.', status: 'ACCEPTED', itemsJson: JSON.stringify([{ name: 'Oil filter assorted x20', unitPriceMinor: 43000 }]), createdAt: daysFromNow(-17) },
  })

  // ── Purchase orders beyond the SUBMITTED demo: completed + disputed ──
  const garageBranch = await db.orgBranch.findFirst({ where: { code: 'PM-01', orgId: garageOrg.id } })
  const poSubtotal2 = (brakePads.unitPriceMinor ?? 480000) * 2 + (oilFilter.unitPriceMinor ?? 52000) * 6
  const po2 = await db.purchaseOrder.create({
    data: {
      refCode: 'PO-DEMO02', garageOrgId: garageOrg.id, supplierOrgId: supply.partsSupplierId,
      destinationBranchId: garageBranch?.id, createdById: garageOwner.id,
      status: 'COMPLETED', paymentStatus: 'RELEASED', inspectionStatus: 'ACCEPTED',
      subtotalMinor: poSubtotal2, taxMinor: Math.round(poSubtotal2 * 0.16), totalMinor: poSubtotal2 + Math.round(poSubtotal2 * 0.16),
      items: {
        create: [
          { productId: brakePads.id, qty: 2, unitPriceMinor: brakePads.unitPriceMinor ?? 480000, lineTotalMinor: (brakePads.unitPriceMinor ?? 480000) * 2, qtyDelivered: 2, qtyAccepted: 2 },
          { productId: oilFilter.id, qty: 6, unitPriceMinor: oilFilter.unitPriceMinor ?? 52000, lineTotalMinor: (oilFilter.unitPriceMinor ?? 52000) * 6, qtyDelivered: 6, qtyAccepted: 6, batchNo: 'LOT-2291' },
        ],
      },
      events: {
        create: [
          { type: 'CREATED', actorId: garageOwner.id, actorName: garageOwner.name, actorSide: 'GARAGE', note: 'Replenishment order: pads and filters.', createdAt: daysFromNow(-15) },
          { type: 'PAYMENT', actorName: 'M-Pesa callback', actorSide: 'SYSTEM', note: 'Provider confirmed payment. Funds protected pending inspection.', createdAt: daysFromNow(-14) },
          { type: 'DISPATCH', actorId: sifaOwnerMember?.userId, actorName: 'Sifa Auto Spares', actorSide: 'SUPPLIER', note: 'Dispatched: handover OTP issued to the courier.', createdAt: daysFromNow(-13) },
          { type: 'DELIVERY', actorId: garageOwner.id, actorName: garageOwner.name, actorSide: 'GARAGE', note: 'Delivered and OTP handover completed.', createdAt: daysFromNow(-12) },
          { type: 'INSPECTION', actorId: garageOwner.id, actorName: garageOwner.name, actorSide: 'GARAGE', note: 'Inspection accepted: all lines verified.', createdAt: daysFromNow(-11) },
          { type: 'RELEASE', actorName: 'Inspection auto-release', actorSide: 'SYSTEM', note: 'Funds released to supplier after accepted inspection.', createdAt: daysFromNow(-11) },
          { type: 'COMPLETION', actorId: garageOwner.id, actorName: garageOwner.name, actorSide: 'GARAGE', note: 'Order completed.', createdAt: daysFromNow(-10) },
        ],
      },
    },
  })
  await db.paymentAuthorization.create({
    data: {
      refCode: 'PAY-DEMO02', orderId: po2.id, provider: 'MPESA_DARAJA', status: 'RELEASED',
      amountMinor: poSubtotal2 + Math.round(poSubtotal2 * 0.16), checkoutRef: 'DEMO-CHQ-0002', phone: '+254722999000',
      resultDesc: 'Provider confirmed payment (receipt QGH31LM9P)', webhookEvents: JSON.stringify(['DEMO-CHQ-0002:0']),
      protectedAt: daysFromNow(-14), releasedAmountMinor: poSubtotal2 + Math.round(poSubtotal2 * 0.16), releasedAt: daysFromNow(-11),
    },
  })
  // Resolved partial-refund dispute on the completed PO (full audit trail).
  const po2Dispute = await db.dispute.create({
    data: {
      refCode: 'DSP-DEMO02', orderId: po2.id, openedById: garageOwner.id, openedBySide: 'GARAGE',
      reason: 'DAMAGED', amountFrozenMinor: 0, status: 'RESOLVED',
      resolution: 'REFUND_PARTIAL', resolutionNote: 'One oil filter arrived with a cracked housing (photo evidence). Partial refund of KES 2,000 approved; remaining stock accepted.',
      resolvedBy: ops.name, resolvedAt: daysFromNow(-9),
      details: 'Carton was crushed on one corner on arrival. One oil filter housing cracked. Other five units and both pad sets are fine.',
      evidence: JSON.stringify([{ url: '/api/files/demo-doc.pdf', name: 'damaged-filter.jpg', uploadedAt: daysFromNow(-10) }]),
      events: {
        create: [
          { type: 'CREATED', actorId: garageOwner.id, actorName: garageOwner.name, note: 'Dispute opened by the garage: DAMAGED. One cracked housing.', createdAt: daysFromNow(-10) },
          { type: 'NOTE', actorId: ops.id, actorName: ops.name, note: 'Dispatch evidence and OTP records reviewed; supplier packing list checked.', createdAt: daysFromNow(-10) },
          { type: 'RESOLUTION', actorId: ops.id, actorName: ops.name, note: 'REFUND_PARTIAL: KES 2,000 refund approved for the cracked unit.', createdAt: daysFromNow(-9) },
        ],
      },
    },
  })
  await db.refund.create({
    data: {
      refCode: 'RFD-DEMO02', orderId: po2.id, paymentAuthId: (await db.paymentAuthorization.findUnique({ where: { orderId: po2.id } }))?.id,
      amountMinor: 200000, kind: 'PARTIAL', reason: `Dispute ${po2Dispute.refCode}: cracked oil filter housing`,
      status: 'PROCESSED', requestedById: ops.id, processedBy: staffFinance.name, processedAt: daysFromNow(-8), providerRef: 'QGH-REF-88412',
    },
  })
  // Warranty + returns on the completed PO
  await db.warrantyClaim.create({
    data: {
      refCode: 'WRT-DEMO01', orderId: po2.id, productId: brakePads.id, garageOrgId: garageOrg.id, supplierOrgId: supply.partsSupplierId,
      issue: 'Rear axle squeal at 300 km, pads glazed. Claim under 12-month warranty.', status: 'APPROVED',
      resolution: 'Replacement set supplied at no cost; returned batch inspected by supplier.',
      createdAt: daysFromNow(-7),
    },
  })
  await db.partReturn.create({
    data: {
      refCode: 'RTN-DEMO01', orderId: po2.id, reason: 'One oil filter arrived with a cracked housing (dispute DSP-DEMO02)',
      itemsJson: JSON.stringify([{ productId: oilFilter.id, qty: 1 }]), status: 'COMPLETED', createdAt: daysFromNow(-9),
    },
  })
  // Open disputed PO: live queue item for the staff supply console
  const thirdProduct = sifaProducts.find((p) => p.id !== oilFilter.id && p.id !== brakePads.id) ?? oilFilter
  const poSubtotal3 = (thirdProduct.unitPriceMinor ?? 850000) * 2
  const po3 = await db.purchaseOrder.create({
    data: {
      refCode: 'PO-DEMO03', garageOrgId: garageOrg.id, supplierOrgId: supply.partsSupplierId,
      destinationBranchId: garageBranch?.id, createdById: garageOwner.id,
      status: 'DISPUTED', paymentStatus: 'PROTECTED', inspectionStatus: 'ISSUES',
      subtotalMinor: poSubtotal3, taxMinor: Math.round(poSubtotal3 * 0.16), totalMinor: poSubtotal3 + Math.round(poSubtotal3 * 0.16),
      items: {
        create: [{ productId: thirdProduct.id, qty: 2, unitPriceMinor: thirdProduct.unitPriceMinor ?? 850000, lineTotalMinor: (thirdProduct.unitPriceMinor ?? 850000) * 2, qtyDelivered: 2, qtyAccepted: 1 }],
      },
      events: {
        create: [
          { type: 'CREATED', actorId: garageOwner.id, actorName: garageOwner.name, actorSide: 'GARAGE', note: 'Urgent stock order.', createdAt: daysFromNow(-5) },
          { type: 'PAYMENT', actorName: 'M-Pesa callback', actorSide: 'SYSTEM', note: 'Provider confirmed payment. Funds protected pending inspection.', createdAt: daysFromNow(-4) },
          { type: 'DISPATCH', actorId: sifaOwnerMember?.userId, actorName: 'Sifa Auto Spares', actorSide: 'SUPPLIER', note: 'Dispatched same day.', createdAt: daysFromNow(-3) },
          { type: 'DELIVERY', actorId: garageOwner.id, actorName: garageOwner.name, actorSide: 'GARAGE', note: 'Delivered. One unit damaged in transit, photos taken.', createdAt: daysFromNow(-2) },
          { type: 'INSPECTION', actorId: garageOwner.id, actorName: garageOwner.name, actorSide: 'GARAGE', note: 'Partial inspection: 1 of 2 accepted, damage reported.', createdAt: daysFromNow(-2) },
          { type: 'DISPUTE', actorId: garageOwner.id, actorName: garageOwner.name, actorSide: 'GARAGE', note: 'Dispute opened pending resolution.', createdAt: daysFromNow(-1) },
        ],
      },
    },
  })
  await db.paymentAuthorization.create({
    data: {
      refCode: 'PAY-DEMO03', orderId: po3.id, provider: 'MPESA_DARAJA', status: 'PROTECTED',
      amountMinor: poSubtotal3 + Math.round(poSubtotal3 * 0.16), checkoutRef: 'DEMO-CHQ-0003', phone: '+254722999000',
      resultDesc: 'Provider confirmed payment (receipt QGH44KP2Q)', webhookEvents: JSON.stringify(['DEMO-CHQ-0003:0']),
      protectedAt: daysFromNow(-4),
    },
  })
  await db.dispute.create({
    data: {
      refCode: 'DSP-DEMO03', orderId: po3.id, openedById: garageOwner.id, openedBySide: 'GARAGE',
      reason: 'DAMAGED', amountFrozenMinor: poSubtotal3 + Math.round(poSubtotal3 * 0.16), status: 'UNDER_REVIEW',
      details: 'Second unit of the two delivered has a cracked mounting bracket. Photos and the delivery OTP record confirm it arrived damaged. Requesting replacement or refund of the damaged unit.',
      evidence: JSON.stringify([{ url: '/api/files/demo-doc.pdf', name: 'damaged-bracket.jpg', uploadedAt: daysFromNow(-2) }]),
      events: {
        create: [
          { type: 'CREATED', actorId: garageOwner.id, actorName: garageOwner.name, note: 'Dispute opened by the garage: DAMAGED.', createdAt: daysFromNow(-1) },
          { type: 'STATUS_CHANGE', actorId: staffDisputes.id, actorName: staffDisputes.name, note: 'Status set to UNDER_REVIEW: disputes desk investigating.', createdAt: hoursAgo(20) },
          { type: 'NOTE', actorId: staffDisputes.id, actorName: staffDisputes.name, note: 'Requested courier handover photos from both parties. Deadline set at 48h.', createdAt: hoursAgo(18) },
        ],
      },
    },
  })

  // ── Inter-branch vehicle transfer (multi-branch custody demo) ──
  const nah01 = await db.orgBranch.findFirst({ where: { code: 'NAH-01' } })
  const nah02 = await db.orgBranch.findFirst({ where: { code: 'NAH-02' } })
  const transferVehicle = await db.vehicle.findFirst({ where: { orgId: dealerOrg.id, status: 'PUBLISHED' }, orderBy: { createdAt: 'asc' } })
  if (nah01 && nah02 && transferVehicle) {
    await db.vehicleTransfer.create({
      data: {
        refCode: 'VTR-DEMO01', orgId: dealerOrg.id, vehicleId: transferVehicle.id, fromBranchId: nah01.id, toBranchId: nah02.id,
        status: 'APPROVED', conditionOutJson: JSON.stringify({ odometer: 12450, notes: 'Clean; minor kerb rash rear left rim.', photos: [] }),
        dispatchRef: 'DRV-8841', requestedById: dealerOwner.id, approvedById: dealerOwner.id, dispatchedAt: hoursAgo(8),
        events: {
          create: [
            { type: 'REQUESTED', actorId: dealerOwner.id, actorName: dealerOwner.name, note: 'Transfer requested to balance showroom stock after weekend sales.', createdAt: hoursAgo(24) },
            { type: 'APPROVED', actorId: dealerOwner.id, actorName: dealerOwner.name, note: 'Approved. Condition report attached; driver assigned (DRV-8841).', createdAt: hoursAgo(12) },
            { type: 'DISPATCHED', actorId: dealerOwner.id, actorName: dealerOwner.name, note: 'Vehicle dispatched from Syokimau.', createdAt: hoursAgo(8) },
          ],
        },
      },
    })
  }

  // ── Warehouse ledger rows, reorder alert, saved items, verified review ──
  if (sifaWh1) {
    await db.stockMovement.createMany({
      data: [
        { branchId: sifaWh1.id, productId: oilFilter.id, delta: 40, reason: 'RESTOCK', refType: 'MANUAL', note: 'Supplier delivery from Denso regional warehouse', actorId: sifaOwnerMember?.userId, actorName: 'Sifa Auto Spares', createdAt: daysFromNow(-20) },
        { branchId: sifaWh1.id, productId: oilFilter.id, delta: -8, reason: 'SALE', refType: 'MANUAL', note: 'Wholesale counter sales', actorId: sifaOwnerMember?.userId, actorName: 'Sifa Auto Spares', createdAt: daysFromNow(-7) },
        { branchId: sifaWh1.id, productId: brakePads.id, delta: 20, reason: 'RESTOCK', refType: 'MANUAL', note: 'Restock ahead of month-end demand', actorId: sifaOwnerMember?.userId, actorName: 'Sifa Auto Spares', createdAt: daysFromNow(-16) },
        { branchId: sifaWh1.id, productId: brakePads.id, delta: -2, reason: 'RESERVE', refType: 'PURCHASE_ORDER', refId: po3.id, note: `Reserved for ${po3.refCode}`, actorId: sifaOwnerMember?.userId, actorName: 'Sifa Auto Spares', createdAt: daysFromNow(-5) },
      ],
    })
  }
  await db.garageStockAlert.create({ data: { garageOrgId: garageOrg.id, productId: brakePads.id, minQty: 4, active: true } })
  await db.savedSupplyItem.createMany({
    data: [
      { userId: garageOwner.id, targetType: 'SUPPLIER', targetId: supply.partsSupplierId },
      { userId: garageOwner.id, targetType: 'PRODUCT', targetId: oilFilter.id },
    ],
  })
  await db.productReview.create({
    data: { productId: oilFilter.id, authorId: garageOwner.id, rating: 5, comment: 'Genuine Denso stock, batch numbers on every box. Our go-to supplier for filters.', verifiedPurchase: true, refOrderId: po2.id },
  })

  // ── Support tickets + moderation queue ──
  await db.supportTicket.createMany({
    data: [
      { refCode: 'TKT-DEMO01', userId: customer.id, name: customer.name, email: customer.email, subject: 'Delivery ETA for order CO-DEMO02', message: 'Hi, when should I expect order CO-DEMO02? The supplier accepted it but I have not seen a dispatch update yet.', status: 'OPEN', createdAt: hoursAgo(4) },
      { refCode: 'TKT-DEMO02', userId: verifiedSeller.id, name: verifiedSeller.name, email: verifiedSeller.email, subject: 'Verified badge not showing on my listing', message: 'My seller verification was approved yesterday but my listing still shows as unverified.', status: 'RESOLVED', response: 'The trust marker refreshes with the next listing sync. It is live now. Thanks for flagging!', createdAt: daysFromNow(-12) },
    ],
  })
  const reportedPost = await db.communityPost.findFirst({ where: { status: 'PUBLISHED' }, orderBy: { createdAt: 'desc' } })
  if (reportedPost) {
    await db.report.create({
      data: { reporterId: dealerStaff.id, targetType: 'POST', targetId: reportedPost.id, reason: 'Spam or commercial solicitation', details: 'Reply section contains a WhatsApp number selling extended warranties outside the platform.', status: 'OPEN', createdAt: hoursAgo(10) },
    })
  }

  console.log('Seed complete.')
  console.log('Demo accounts (password: %s)', PASSWORD)
  console.log('  Platform staff (Control Center #/admin):')
  console.log('    admin@carmaze.co.ke      - FOUNDER/ADMIN (full Operations OS)')
  console.log('    ops@carmaze.co.ke        - REVIEWER/SUPPORT/MODERATOR')
  console.log('    reviewer@carmaze.co.ke   - REVIEWER (business verification dept)')
  console.log('    finance@carmaze.co.ke    - FINANCE dept')
  console.log('    disputes@carmaze.co.ke   - DISPUTES dept (MODERATOR)')
  console.log('    fraud@carmaze.co.ke      - FRAUD dept (REVIEWER+MODERATOR)')
  console.log('    support@carmaze.co.ke    - SUPPORT dept')
  console.log('  Businesses:')
  console.log('    dealer@carmaze.co.ke     - DealerOS (Nairobi Auto Hub + Westlands Motors)')
  console.log('    staff@carmaze.co.ke      - Dealer sales staff')
  console.log('    garage@carmaze.co.ke     - GarageOS (Premium Motors Garage + Mombasa Road Tyres)')
  console.log('    garage.staff@carmaze.co.ke - Garage staff (Premium Motors Garage)')
  console.log('    demo.admin@carmaze.co.ke - RESTRICTED demo platform admin (read-only tour)')
  console.log('    supplier@carmaze.co.ke   - SupplierOS (Sifa Auto Spares + unverified Rapid Parts)')
  console.log('    tyres@carmaze.co.ke      - SupplierOS (Highway Tyre Distributors)')
  console.log('    equipment@carmaze.co.ke  - SupplierOS (GaragePro Equipment Kenya)')
  console.log('    logistics@carmaze.co.ke  - LogisticsOS (Swift Movers Logistics, approved)')
  console.log('  Individuals:')
  console.log('    customer@carmaze.co.ke   - Customer (orders, disputes, custody, loyalty)')
  console.log('    seller@carmaze.co.ke     - Private seller (unverified)')
  console.log('    verified.seller@carmaze.co.ke - SELLER_VERIFIED (KYC approved)')
  console.log('    apply.dealer@carmaze.co.ke / apply.garage@carmaze.co.ke / apply.logistics@carmaze.co.ke - applications in review')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
