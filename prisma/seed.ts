/**
 * CARMAZE seed — realistic Kenyan pilot data.
 * Run: bun prisma/seed.ts
 *
 * Demo accounts (documented for the pilot, change before launch):
 *   admin@carmaze.co.ke    — founder/admin (Control Center)
 *   ops@carmaze.co.ke      — verification reviewer
 *   dealer@carmaze.co.ke   — dealer owner, "Nairobi Auto Hub" (DealerOS)
 *   staff@carmaze.co.ke    — dealer sales staff
 *   garage@carmaze.co.ke   — garage owner, "Premium Motors Garage"
 *   seller@carmaze.co.ke   — private seller
 *   customer@carmaze.co.ke — customer
 * Password for all: CarmazeDemo2025!
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

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
  await db.aiUsage.deleteMany()
  await db.notificationDelivery.deleteMany()
  await db.notification.deleteMany()
  await db.supportTicket.deleteMany()
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
  // New models (conversations, custody, test drives, incidents) — children
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
  await db.vehicle.deleteMany()
  await db.applicationEvent.deleteMany()
  await db.application.deleteMany()
  await db.orgMember.deleteMany()
  await db.org.deleteMany()
  await db.partnerRequest.deleteMany()
  await db.partner.deleteMany()
  await db.loyaltyLedger.deleteMany()
  await db.customizerConfig.deleteMany()
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
    data: { email: 'dealer@carmaze.co.ke', name: 'David Kimani', passwordHash: hash, phone: '+254711555666', phoneVerified: true, roles: 'CUSTOMER,SELLER,DEALER_OWNER' },
  })
  const dealerStaff = await db.user.create({
    data: { email: 'staff@carmaze.co.ke', name: 'Brian Ochieng', passwordHash: hash, phone: '+254711777888', phoneVerified: true, roles: 'CUSTOMER,DEALER_STAFF' },
  })
  const garageOwner = await db.user.create({
    data: { email: 'garage@carmaze.co.ke', name: 'Mary Achieng', passwordHash: hash, phone: '+254722999000', phoneVerified: true, roles: 'CUSTOMER,GARAGE_OWNER' },
  })
  const seller = await db.user.create({
    data: { email: 'seller@carmaze.co.ke', name: 'James Mwangi', passwordHash: hash, phone: '+254733123456', phoneVerified: true, roles: 'CUSTOMER,SELLER' },
  })
  const customer = await db.user.create({
    data: { email: 'customer@carmaze.co.ke', name: 'Amina Hassan', passwordHash: hash, phone: '+254745654321', roles: 'CUSTOMER' },
  })
  const pendingDealerUser = await db.user.create({
    data: { email: 'apply.dealer@carmaze.co.ke', name: 'Salim Yusuf', passwordHash: hash, phone: '+254799111000', roles: 'CUSTOMER,SELLER' },
  })
  const pendingGarageUser = await db.user.create({
    data: { email: 'apply.garage@carmaze.co.ke', name: 'Caroline Wanjiru', passwordHash: hash, phone: '+254799222000', roles: 'CUSTOMER' },
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
      type: 'DEALER', name: 'Nairobi Auto Hub', regNo: 'BN-2019-4482', county: 'Nairobi', town: 'Syokimau',
      location: 'Mombasa Road, Next to Gateway Mall', phone: '+254711555666', email: 'sales@nairobiautohub.co.ke',
      description: 'Verified dealership specialising in premium SUVs and executive sedans. All units fully inspected.',
    },
  })
  const dealerOrg2 = await db.org.create({
    data: {
      type: 'DEALER', name: 'Westlands Motors', regNo: 'BN-2016-1187', county: 'Nairobi', town: 'Westlands',
      location: 'Ring Road Parklands', phone: '+254733444555', email: 'hello@westlandsmotors.co.ke',
      description: 'Quality family cars and compact hatchbacks with trade-in options.',
    },
  })
  const garageOrg = await db.org.create({
    data: {
      type: 'GARAGE', name: 'Premium Motors Garage', regNo: 'BN-2014-7731', county: 'Nairobi', town: 'Westlands',
      location: 'Karuna Rd, Westlands', phone: '+254722999000', email: 'service@premiummotors.co.ke',
      description: 'Full-service garage: mechanical, electrical, bodywork and performance upgrades.',
    },
  })
  const garageOrg2 = await db.org.create({
    data: {
      type: 'GARAGE', name: 'Mombasa Road Tyres & Service', county: 'Nairobi', town: 'South C',
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
      { orgId: garageOrg2.id, userId: garageOwner.id, role: 'OWNER' },
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

  // Pending dealer application (submitted 6h ago — inside SLA)
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
      { refCode: 'INV-QK2M4P', orgId: dealerOrg.id, type: 'SUBSCRIPTION', description: 'Dealer Pro subscription — monthly', amountMinor: 990000, status: 'PAID', periodStart: daysFromNow(-30), periodEnd: daysFromNow(1), issuedAt: daysFromNow(-30), dueDate: daysFromNow(-30), paidAt: daysFromNow(-29), paidVia: 'MPESA' },
      { refCode: 'INV-MN7X2W', orgId: dealerOrg2.id, type: 'SUBSCRIPTION', description: 'Dealer Starter subscription — monthly', amountMinor: 490000, status: 'PAID', periodStart: daysFromNow(-20), periodEnd: daysFromNow(10), issuedAt: daysFromNow(-20), dueDate: daysFromNow(-20), paidAt: daysFromNow(-20), paidVia: 'MPESA' },
      { refCode: 'INV-PW9Q3L', orgId: garageOrg.id, type: 'SUBSCRIPTION', description: 'Garage Basic subscription — monthly', amountMinor: 290000, status: 'PAID', periodStart: daysFromNow(-25), periodEnd: daysFromNow(5), issuedAt: daysFromNow(-25), dueDate: daysFromNow(-25), paidAt: daysFromNow(-24), paidVia: 'MANUAL' },
      { refCode: 'INV-TD4K8Z', orgId: dealerOrg.id, type: 'CAMPAIGN', description: 'Listing Spotlight (7 days) — Prado TX-L', amountMinor: 150000, status: 'PENDING', issuedAt: hoursAgo(20), dueDate: daysFromNow(7) },
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
    { make: 'BMW', model: 'X3 xDrive20d', year: 2017, priceMinor: 420000000, mileageKm: 91000, fuel: 'DIESEL', transmission: 'AUTOMATIC', bodyType: 'SUV', condition: 'FOREIGN_USED', county: 'Nairobi', color: 'Mineral Grey', engineCc: 2000, orgId: dealerOrg.id, ownerId: dealerOwner.id, status: 'DRAFT', images: [], description: 'Draft listing — photos being prepared.' },
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
      { enquiryId: enquiry1.id, senderId: dealerStaff.id, senderName: dealerStaff.name, senderSide: 'SELLER', body: 'Hello Amina, yes it is available. Saturday 10am works — we are at Mombasa Road next to Gateway Mall. Ask for Brian at reception.' },
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
      vehicleDesc: 'Toyota Vitz 2016', description: 'Regular service — engine oil, air filter and general check-up.', county: 'Nairobi', status: 'COMPLETED',
    },
  })
  await db.quote.create({ data: { requestId: sr2.id, orgId: garageOrg2.id, amountMinor: 480000, leadDays: 1, message: 'Genuine filters and 5W-30 oil included.', status: 'ACCEPTED' } })
  await db.booking.create({ data: { requestId: sr2.id, orgId: garageOrg2.id, scheduledAt: daysFromNow(-5), status: 'COMPLETED', notes: 'Completed on time. Customer advised brake pads at ~40% next visit.' } })
  await db.orgReview.create({ data: { orgId: garageOrg2.id, authorId: customer.id, rating: 5, comment: 'Quick, honest and clean work. Fair pricing.' } })

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
      { myVehicleId: myVitz.id, date: daysFromNow(-5), type: 'SERVICE', description: 'Regular service — engine oil, air filter and general check-up.', costMinor: 480000, mileageKm: 62000, garageOrgId: garageOrg2.id },
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
      userId: dealerOwner.id, title: 'Weekend cruise: Nairobi → Naivasha — who is in?',
      body: 'Planning a Sunday morning drive to Naivasha via Mai Mahiu. Meeting point Capitol Centre 7:30am, breakfast stop in Naivasha. All cars welcome, moderate pace. Drop a comment if you are joining.',
      category: 'EVENT',
    },
  })
  const post2 = await db.communityPost.create({
    data: {
      userId: customer.id, title: 'Vitz hybrid vs Demio — real fuel economy in Nairobi traffic?',
      body: 'I do mostly Urban commutes with occasional upcountry trips. Comparing a 2018 Fit Hybrid and a 2019 Demio. Owners, what real consumption are you getting in the city?',
      category: 'QUESTION',
    },
  })
  const post3 = await db.communityPost.create({
    data: {
      userId: seller.id, title: 'Selling my 2020 Vitz — sharing my experience with the platform',
      body: 'Listed my Vitz last week and got two dealer offers through the matching board already. Will update once I close the deal. Tip: good photos genuinely make a difference.',
      category: 'SHOWCASE',
    },
  })
  await db.postComment.createMany({
    data: [
      { postId: post1.id, userId: seller.id, body: 'Count me in — bringing the Demio.' },
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

  // ── Active paid campaign (D-Max homepage feature — real revenue record) ──
  const campInv = await db.invoice.create({
    data: {
      refCode: 'INV-BX6N2T', orgId: dealerOrg.id, type: 'CAMPAIGN', description: 'Homepage Feature (3 days) — D-Max Double Cab',
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
      { userId: customer.id, points: 100, reason: 'REVIEW_EARNED', refType: 'ORG_REVIEW', note: 'Verified review published — Mombasa Road Tyres & Service.', createdAt: daysFromNow(-4) },
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
        { q: 'Is CARMAZE free for private sellers?', a: 'Yes — creating and publishing a private listing is free during the pilot. Optional promotions are paid.' },
        { q: 'How are dealerships verified?', a: 'Every dealer submits business registration, premises and representative details. Our review team verifies documents before the "Verified" badge is granted — it is never bought.' },
        { q: 'How do dealer offers work?', a: 'When you list a car and opt into dealer matching, verified dealers can send offers through the platform. Your contact details stay private until you choose to engage.' },
        { q: 'Does CARMAZE handle vehicle payments?', a: 'No. During the pilot, vehicle payments are arranged directly between buyer and seller. We never hold buyer funds or offer escrow.' },
        { q: 'How do garage quotes work?', a: 'Describe the work (or share a 3D customizer configuration) and approved garages respond with quotes. You compare and choose — no obligation.' },
        { q: 'Is roadside assistance an emergency service?', a: 'No. CARMAZE connects you with independent providers. For emergencies always call 999 / 112 first.' },
        { q: 'What payment methods are supported for subscriptions?', a: 'M-Pesa (Safaricom Daraja) is integrated for dealer and garage subscriptions and promotions. Payment status is verified server-side via Daraja callbacks.' },
      ]) },
      { key: 'home_hero', value: JSON.stringify({ title: 'Find your next car with confidence', subtitle: 'Verified dealers, honest listings, trusted garages — one connected ecosystem built for Kenya.' }) },
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
        { q: 'Can I book an inspection before buying?', a: 'Yes — we encourage independent inspections and can arrange a Saturday viewing slot. Just message us through the platform.' },
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
        { q: 'Do you deliver upcountry?', a: 'Yes — delivery within Nairobi is free; upcountry delivery is arranged per county.' },
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
        { q: 'Do you use genuine parts?', a: 'We quote with genuine or OEM-equivalent parts — you approve the option before we order.' },
        { q: 'How does vehicle custody work?', a: 'Every handover is logged with photos, odometer and fuel level. You approve any road test and authorise collection with a secure code.' },
        { q: 'Can I get a quote before committing?', a: 'Yes — send your request through CARMAZE and we respond with an itemised quote, usually within a day.' },
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
        { q: 'Do you offer roadside assistance at night?', a: 'Yes — call-outs run 24/7 within Nairobi. Night call-out rate applies from 8pm.' },
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
      subject: 'Toyota Land Cruiser Prado TX-L — inspection & trade-in',
      kind: 'VEHICLE_ENQUIRY',
      lastMessageAt: hoursAgo(4),
      lastMessagePreview: 'Great — Saturday 10am works. Should I bring my Demio for the trade-in valuation too?',
      unreadForOrg: true,
      messages: {
        create: [
          { senderId: customer.id, senderName: customer.name, senderSide: 'CUSTOMER', body: 'Hi, is the Prado TX-L still available? I would like to view it this Saturday morning.', createdAt: hoursAgo(26) },
          { senderId: dealerStaff.id, senderName: dealerStaff.name, senderSide: 'ORG', body: 'Hello Amina, yes it is available. Saturday 10am works well — ask for Brian at reception, Mombasa Road next to Gateway Mall.', createdAt: hoursAgo(24) },
          { senderId: customer.id, senderName: customer.name, senderSide: 'CUSTOMER', body: 'Great — Saturday 10am works. Should I bring my Demio for the trade-in valuation too?', createdAt: hoursAgo(4) },
        ],
      },
    },
  })
  await db.conversation.create({
    data: {
      orgId: garageOrg.id,
      customerId: customer.id,
      subject: 'Quote request — 2" lift kit for Prado',
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
          { type: 'HANDOVER', actorId: customer.id, actorName: customer.name, actorSide: 'CUSTOMER', note: 'Handover requested — vehicle dropped off with declared condition and valuables.', createdAt: hoursAgo(48) },
          { type: 'STATUS_CHANGE', fromStatus: 'HANDOVER_REQUESTED', toStatus: 'RECEIVED', actorName: 'Mary Achieng', actorSide: 'ORG', note: 'Vehicle received by Mary Achieng. Drop-off photos taken.', createdAt: hoursAgo(47) },
          { type: 'STATUS_CHANGE', fromStatus: 'RECEIVED', toStatus: 'INSPECTION', actorName: 'Mary Achieng', actorSide: 'ORG', note: 'Inspection started — fluids, brakes and full diagnostics.', createdAt: hoursAgo(45) },
          { type: 'STATUS_CHANGE', fromStatus: 'INSPECTION', toStatus: 'WORK_IN_PROGRESS', actorName: 'Mary Achieng', actorSide: 'ORG', note: 'Estimate approved by customer; work started.', createdAt: hoursAgo(40) },
          { type: 'STATUS_CHANGE', fromStatus: 'WORK_IN_PROGRESS', toStatus: 'READY_FOR_COLLECTION', actorName: 'Mary Achieng', actorSide: 'ORG', note: 'Work completed — vehicle ready for collection.', createdAt: hoursAgo(2) },
        ],
      },
    },
  })
  await db.roadTest.create({
    data: {
      custodyId: custody.id,
      purpose: 'Verify repair — intermittent engine warning light',
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

  console.log('Seed complete.')
  console.log('Demo accounts (password: %s)', PASSWORD)
  console.log('  admin@carmaze.co.ke / ops@carmaze.co.ke / dealer@carmaze.co.ke / staff@carmaze.co.ke')
  console.log('  garage@carmaze.co.ke / seller@carmaze.co.ke / customer@carmaze.co.ke')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
