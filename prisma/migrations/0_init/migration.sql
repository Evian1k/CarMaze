-- CreateTable
CREATE TABLE "DemoAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roleKey" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dashboard" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "sessionMinutes" INTEGER NOT NULL DEFAULT 20160,
    "restrictedNote" TEXT,
    "lastResetAt" DATETIME,
    "resetCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "phoneCode" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailCode" TEXT,
    "roles" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "department" TEXT,
    "totpSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "referralCode" TEXT,
    "referredById" TEXT,
    "referredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "requestIp" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LogisticsPartner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partnerType" TEXT NOT NULL DEFAULT 'COMPANY',
    "regNo" TEXT,
    "county" TEXT NOT NULL,
    "town" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "representative" TEXT NOT NULL,
    "serviceAreas" TEXT,
    "capabilities" TEXT,
    "documents" TEXT,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "decisionNote" TEXT,
    "appliedAt" DATETIME,
    "reviewedAt" DATETIME,
    "reviewedByName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LogisticsPartner_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LogisticsPartnerEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partnerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LogisticsPartnerEvent_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "LogisticsPartner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partnerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "licenseNo" TEXT,
    "vehicleReg" TEXT,
    "vehicleType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Driver_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "LogisticsPartner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeliveryJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "requesterOrgId" TEXT,
    "requesterOrgName" TEXT,
    "partnerId" TEXT,
    "driverId" TEXT,
    "cargoDesc" TEXT NOT NULL,
    "sizeClass" TEXT NOT NULL DEFAULT 'SMALL',
    "pickupCounty" TEXT NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "pickupContactName" TEXT NOT NULL,
    "pickupContactPhone" TEXT NOT NULL,
    "dropCounty" TEXT NOT NULL,
    "dropAddress" TEXT NOT NULL,
    "dropContactName" TEXT NOT NULL,
    "dropContactPhone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "feeMinor" INTEGER NOT NULL DEFAULT 0,
    "otpHash" TEXT,
    "otpHint" TEXT,
    "qrToken" TEXT,
    "podPhotos" TEXT,
    "failReason" TEXT,
    "pickupAt" DATETIME,
    "deliveredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeliveryJob_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "DeliveryJob_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "LogisticsPartner" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "DeliveryJob_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeliveryJobEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorSide" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryJobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "DeliveryJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "subject" TEXT,
    "vehicleId" TEXT,
    "serviceId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'GENERAL',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessagePreview" TEXT,
    "unreadForOrg" BOOLEAN NOT NULL DEFAULT false,
    "unreadForCustomer" BOOLEAN NOT NULL DEFAULT false,
    "orgArchived" BOOLEAN NOT NULL DEFAULT false,
    "customerArchived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Conversation_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Conversation_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT,
    "senderName" TEXT NOT NULL,
    "senderSide" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "attachments" TEXT,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VehicleCustody" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "myVehicleId" TEXT,
    "vehicleDesc" TEXT NOT NULL,
    "plate" TEXT,
    "odometerKm" INTEGER,
    "fuelLevel" TEXT,
    "conditionNotes" TEXT,
    "photos" TEXT,
    "valuables" TEXT,
    "requestedWork" TEXT NOT NULL,
    "authorisedSpendMinor" INTEGER,
    "roadTestAllowed" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'HANDOVER_REQUESTED',
    "receivedAt" DATETIME,
    "receivedByStaffName" TEXT,
    "readyAt" DATETIME,
    "completedWork" TEXT,
    "finalOdometerKm" INTEGER,
    "finalNotes" TEXT,
    "completionPhotos" TEXT,
    "costMinor" INTEGER,
    "collectedAt" DATETIME,
    "collectedByName" TEXT,
    "returnedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VehicleCustody_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VehicleCustody_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustodyEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "custodyId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorSide" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustodyEvent_custodyId_fkey" FOREIGN KEY ("custodyId") REFERENCES "VehicleCustody" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoadTest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "custodyId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "driverName" TEXT NOT NULL,
    "startOdometerKm" INTEGER,
    "endOdometerKm" INTEGER,
    "requestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorisedAt" DATETIME,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "notes" TEXT,
    "incident" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "RoadTest_custodyId_fkey" FOREIGN KEY ("custodyId") REFERENCES "VehicleCustody" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CollectionAuthorisation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "custodyId" TEXT NOT NULL,
    "collectorName" TEXT NOT NULL,
    "collectorPhone" TEXT NOT NULL,
    "authCodeHash" TEXT NOT NULL,
    "codeHint" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "revokedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CollectionAuthorisation_custodyId_fkey" FOREIGN KEY ("custodyId") REFERENCES "VehicleCustody" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TestDrive" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "scheduledAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "licenceConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "odometerOut" INTEGER,
    "odometerIn" INTEGER,
    "fuelOut" TEXT,
    "fuelIn" TEXT,
    "conditionOut" TEXT,
    "conditionIn" TEXT,
    "releasedBy" TEXT,
    "returnedBy" TEXT,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TestDrive_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TestDrive_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TestDrive_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SecurityIncident" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reporterSide" TEXT NOT NULL,
    "orgId" TEXT,
    "custodyId" TEXT,
    "testDriveId" TEXT,
    "vehicleDesc" TEXT,
    "subjectDesc" TEXT,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "evidence" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assignedTo" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SecurityIncident_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "IncidentEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "incidentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IncidentEvent_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "SecurityIncident" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Org" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "poApprovalThresholdMinor" INTEGER,
    "supplierRating" REAL,
    "supplierRiskScore" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "regNo" TEXT,
    "county" TEXT NOT NULL,
    "town" TEXT,
    "location" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "logoUrl" TEXT,
    "coverUrl" TEXT,
    "gallery" TEXT,
    "openingHours" TEXT,
    "specialities" TEXT,
    "faqs" TEXT,
    "serviceAreas" TEXT,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "callEnabled" BOOLEAN NOT NULL DEFAULT true,
    "responseMinutes" INTEGER
);

-- CreateTable
CREATE TABLE "OrgMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgMember_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrgMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgName" TEXT NOT NULL,
    "regNo" TEXT,
    "county" TEXT NOT NULL,
    "town" TEXT,
    "physicalAddress" TEXT,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "representative" TEXT NOT NULL,
    "accountType" TEXT,
    "categories" TEXT,
    "documents" TEXT,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewSlaHours" INTEGER NOT NULL DEFAULT 24,
    "submittedAt" DATETIME,
    "reviewOwnerId" TEXT,
    "reviewOwnerName" TEXT,
    "decisionNote" TEXT,
    "infoRequestedAt" DATETIME,
    "correctionsDueAt" DATETIME,
    "lastReminderAt" DATETIME,
    "reminderCount" INTEGER NOT NULL DEFAULT 0,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "escalatedAt" DATETIME,
    "orgId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Application_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApplicationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applicationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApplicationEvent_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "orgId" TEXT,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "mileageKm" INTEGER NOT NULL,
    "fuel" TEXT NOT NULL,
    "transmission" TEXT NOT NULL,
    "bodyType" TEXT NOT NULL,
    "engineCc" INTEGER,
    "condition" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "town" TEXT,
    "color" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "branchId" TEXT,
    "sellerType" TEXT NOT NULL DEFAULT 'PRIVATE',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "reviewNote" TEXT,
    "matchWithDealers" BOOLEAN NOT NULL DEFAULT false,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Vehicle_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Vehicle_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Vehicle_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "OrgBranch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VehiclePhoto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "VehiclePhoto_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ListingEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "from" TEXT,
    "to" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ListingEvent_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SavedVehicle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedVehicle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SavedVehicle_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "alertsOn" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Enquiry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "phoneShare" BOOLEAN NOT NULL DEFAULT true,
    "phone" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Enquiry_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Enquiry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EnquiryMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "enquiryId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderSide" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EnquiryMessage_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "Enquiry" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vehicleId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Offer_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Offer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BuyingRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT,
    "yearFrom" INTEGER,
    "yearTo" INTEGER,
    "budgetMinor" INTEGER,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BuyingRequest_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GarageService" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "priceFromMinor" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GarageService_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "vehicleDesc" TEXT,
    "description" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "town" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "configId" TEXT,
    "myVehicleId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServiceRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Quote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "leadDays" INTEGER,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Quote_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Quote_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Booking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scheduledAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'CONFIRMED',
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Booking_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ServiceRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Booking_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrgReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrgReview_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrgReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoadsideRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "issue" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "providerOrgId" TEXT,
    "providerNote" TEXT,
    "acceptedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoadsideRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MyVehicle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "plate" TEXT,
    "color" TEXT,
    "mileageKm" INTEGER,
    "purchaseDate" DATETIME,
    "purchasePriceMinor" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MyVehicle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServiceRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "myVehicleId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "costMinor" INTEGER,
    "mileageKm" INTEGER,
    "garageOrgId" TEXT,
    "receiptUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceRecord_myVehicleId_fkey" FOREIGN KEY ("myVehicleId") REFERENCES "MyVehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "myVehicleId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" DATETIME NOT NULL,
    "intervalDays" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Reminder_myVehicleId_fkey" FOREIGN KEY ("myVehicleId") REFERENCES "MyVehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomizerConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shareId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "userId" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "CommunityPost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "linkRef" TEXT,
    "pollOptions" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "isSponsored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CommunityPost_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PostComment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PUBLISHED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PostComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PostComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PostReaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "postId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'LIKE',
    CONSTRAINT "PostReaction_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PostReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reporterId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "NotificationDelivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "notificationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "NotificationDelivery_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Plan" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "intervalMonths" INTEGER NOT NULL DEFAULT 1,
    "listingLimit" INTEGER NOT NULL,
    "featuredLimit" INTEGER NOT NULL,
    "staffLimit" INTEGER NOT NULL,
    "features" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentPeriodEnd" DATETIME NOT NULL,
    CONSTRAINT "Subscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "orgId" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "periodStart" DATETIME,
    "periodEnd" DATETIME,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATETIME,
    "paidAt" DATETIME,
    "paidVia" TEXT,
    CONSTRAINT "Invoice_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MPESA_DARAJA',
    "phone" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "merchantRequestId" TEXT,
    "checkoutRequestId" TEXT,
    "resultCode" INTEGER,
    "resultDesc" TEXT,
    "callbackRaw" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentAttempt_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CampaignPackage" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "packageCode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "startsAt" DATETIME,
    "endsAt" DATETIME,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "invoiceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Campaign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Campaign_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "response" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "actorName" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "feature" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ViewEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "county" TEXT NOT NULL,
    "serviceAreas" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "coverUrl" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "whatsapp" BOOLEAN NOT NULL DEFAULT false,
    "website" TEXT,
    "contactName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "rating" REAL,
    "referrals" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "rejectionReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PartnerRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "county" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerRequest_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoyaltyLedger" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoyaltyLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrgBranch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BRANCH',
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT,
    "county" TEXT NOT NULL,
    "town" TEXT,
    "lat" REAL,
    "lng" REAL,
    "phone" TEXT,
    "managerName" TEXT,
    "operatingHours" TEXT,
    "deliveryAreas" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT "OrgBranch_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentSlug" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "supplierOrgId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "mpn" TEXT,
    "oemRef" TEXT,
    "brand" TEXT,
    "description" TEXT NOT NULL,
    "condition" TEXT NOT NULL DEFAULT 'NEW',
    "unitPriceMinor" INTEGER NOT NULL,
    "wholesalePriceMinor" INTEGER,
    "wholesaleMinQty" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "taxRatePct" REAL NOT NULL DEFAULT 0,
    "warrantyMonths" INTEGER NOT NULL DEFAULT 0,
    "returnable" BOOLEAN NOT NULL DEFAULT false,
    "images" TEXT,
    "tags" TEXT,
    "vehicleMakes" TEXT,
    "batchTracked" BOOLEAN NOT NULL DEFAULT false,
    "serialTracked" BOOLEAN NOT NULL DEFAULT false,
    "provenance" TEXT,
    "authenticityVerified" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "ratingAvg" REAL,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_supplierOrgId_fkey" FOREIGN KEY ("supplierOrgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ProductCategory" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductCompatibility" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT,
    "yearFrom" INTEGER,
    "yearTo" INTEGER,
    "engine" TEXT,
    "trim" TEXT,
    "chassis" TEXT,
    "source" TEXT NOT NULL DEFAULT 'SUPPLIER',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    CONSTRAINT "ProductCompatibility_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductStock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "qtyOnHand" INTEGER NOT NULL DEFAULT 0,
    "qtyReserved" INTEGER NOT NULL DEFAULT 0,
    "reorderLevel" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ProductStock_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductStock_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "OrgBranch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "branchId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "delta" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "note" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StockMovement_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "OrgBranch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductPriceHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductPriceHistory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductReview" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "verifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
    "refOrderId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductReview_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductReview_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "garageOrgId" TEXT NOT NULL,
    "supplierOrgId" TEXT NOT NULL,
    "destinationBranchId" TEXT,
    "createdById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "inspectionStatus" TEXT,
    "subtotalMinor" INTEGER NOT NULL DEFAULT 0,
    "deliveryFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "taxMinor" INTEGER NOT NULL DEFAULT 0,
    "platformFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "acceptedTotalMinor" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "supplierNote" TEXT,
    "revisedBySupplier" BOOLEAN NOT NULL DEFAULT false,
    "garageApprovedRevision" BOOLEAN NOT NULL DEFAULT false,
    "deliveryMethod" TEXT,
    "invoiceId" TEXT,
    "deliveryOtpHash" TEXT,
    "commissionRatePct" REAL,
    "cancelledReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrder_garageOrgId_fkey" FOREIGN KEY ("garageOrgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_supplierOrgId_fkey" FOREIGN KEY ("supplierOrgId") REFERENCES "Org" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_destinationBranchId_fkey" FOREIGN KEY ("destinationBranchId") REFERENCES "OrgBranch" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "POItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "lineTotalMinor" INTEGER NOT NULL,
    "fulfilBranchId" TEXT,
    "qtyAccepted" INTEGER,
    "qtyDelivered" INTEGER,
    "note" TEXT,
    "batchNo" TEXT,
    "serialNo" TEXT,
    CONSTRAINT "POItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "POItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PORevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "changesJson" TEXT NOT NULL,
    "newTotalMinor" INTEGER NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PORevision_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "POEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorSide" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "POEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ARRANGING',
    "supplierBranchId" TEXT,
    "meetupJson" TEXT,
    "meetupAgreedByGarage" BOOLEAN NOT NULL DEFAULT false,
    "meetupAgreedBySupplier" BOOLEAN NOT NULL DEFAULT false,
    "scheduledFor" DATETIME,
    "windowLabel" TEXT,
    "courierName" TEXT,
    "driverName" TEXT,
    "driverPhone" TEXT,
    "vehicleReg" TEXT,
    "deliveryRef" TEXT,
    "dispatchEvidence" TEXT,
    "dispatchedAt" DATETIME,
    "expectedAt" DATETIME,
    "otpHash" TEXT,
    "otpHint" TEXT,
    "qrToken" TEXT,
    "deliveredAt" DATETIME,
    "handoverJson" TEXT,
    "garageConfirmAt" DATETIME,
    "supplierConfirmAt" DATETIME,
    "failedReason" TEXT,
    "feeMinor" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Delivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Delivery_supplierBranchId_fkey" FOREIGN KEY ("supplierBranchId") REFERENCES "OrgBranch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DeliveryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deliveryId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorSide" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DeliveryEvent_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentAuthorization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'MPESA_DARAJA',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amountMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "checkoutRef" TEXT,
    "phone" TEXT,
    "resultDesc" TEXT,
    "webhookEvents" TEXT,
    "protectedAt" DATETIME,
    "releasedAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "refundedAmountMinor" INTEGER NOT NULL DEFAULT 0,
    "releasedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentAuthorization_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "paymentAuthId" TEXT,
    "amountMinor" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "requestedById" TEXT,
    "processedBy" TEXT,
    "processedAt" DATETIME,
    "providerRef" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "orderId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'PO_RELEASE',
    "amountMinor" INTEGER NOT NULL,
    "commissionMinor" INTEGER NOT NULL DEFAULT 0,
    "netMinor" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerRef" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "holdReason" TEXT,
    "reconciledById" TEXT,
    "reconciledByName" TEXT,
    "reconciledNote" TEXT,
    "settledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Settlement_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Settlement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SettlementEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "actorSide" TEXT NOT NULL DEFAULT 'SYSTEM',
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SettlementEvent_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "orderId" TEXT,
    "customerOrderId" TEXT,
    "openedById" TEXT NOT NULL,
    "openedBySide" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "evidence" TEXT,
    "amountFrozenMinor" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolutionNote" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Dispute_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Dispute_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DisputeEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "disputeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DisputeEvent_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WarrantyClaim" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "orderId" TEXT,
    "productId" TEXT NOT NULL,
    "garageOrgId" TEXT NOT NULL,
    "supplierOrgId" TEXT NOT NULL,
    "issue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PartReturn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "itemsJson" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "QuoteRequest" (
    "refCode" TEXT NOT NULL,
    "id" TEXT NOT NULL PRIMARY KEY,
    "garageOrgId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "partNumber" TEXT,
    "photoUrl" TEXT,
    "vehicleJson" TEXT,
    "budgetMinor" INTEGER,
    "deliveryCounty" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuoteRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuoteOffer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestId" TEXT NOT NULL,
    "supplierOrgId" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "leadDays" INTEGER,
    "note" TEXT,
    "itemsJson" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuoteOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "QuoteRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuoteOffer_supplierOrgId_fkey" FOREIGN KEY ("supplierOrgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipTier" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceMonthlyMinor" INTEGER NOT NULL,
    "priceYearlyMinor" INTEGER,
    "benefits" TEXT NOT NULL,
    "memberLimit" INTEGER,
    "discountCapPct" INTEGER,
    "branchScope" TEXT NOT NULL DEFAULT 'ALL',
    "branchesJson" TEXT,
    "terms" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MembershipTier_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BusinessMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "tierId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "billingPeriod" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
    "startedAt" DATETIME,
    "currentPeriodEnd" DATETIME,
    "cancelledAt" DATETIME,
    "invoiceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BusinessMembership_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "MembershipTier" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BusinessMembership_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BusinessMembership_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BusinessMembership_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MembershipRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "membershipId" TEXT NOT NULL,
    "benefit" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MembershipRedemption_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "BusinessMembership" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrustProgramme" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "terms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrustProgramme_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrustMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "programmeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT 'NEW',
    "invitedById" TEXT,
    "approvedAt" DATETIME,
    "termsAcceptedAt" DATETIME,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrustMember_programmeId_fkey" FOREIGN KEY ("programmeId") REFERENCES "TrustProgramme" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrustMember_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreditFacility" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "limitMinor" INTEGER NOT NULL,
    "depositMinor" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "terms" TEXT,
    "approvedAt" DATETIME,
    "termsAcceptedAt" DATETIME,
    "closedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreditFacility_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CreditFacility_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreditEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "facilityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountMinor" INTEGER NOT NULL,
    "balanceAfterMinor" INTEGER NOT NULL,
    "refType" TEXT,
    "refId" TEXT,
    "dueDate" DATETIME,
    "paidAt" DATETIME,
    "note" TEXT,
    "actorId" TEXT,
    "actorName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreditEntry_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "CreditFacility" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VehicleTransfer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "fromBranchId" TEXT NOT NULL,
    "toBranchId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "conditionOutJson" TEXT,
    "conditionInJson" TEXT,
    "dispatchRef" TEXT,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "receivedByName" TEXT,
    "dispatchedAt" DATETIME,
    "receivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VehicleTransfer_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VehicleTransfer_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VehicleTransfer_fromBranchId_fkey" FOREIGN KEY ("fromBranchId") REFERENCES "OrgBranch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VehicleTransfer_toBranchId_fkey" FOREIGN KEY ("toBranchId") REFERENCES "OrgBranch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VehicleTransferEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "transferId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VehicleTransferEvent_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "VehicleTransfer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GarageStockAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "garageOrgId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "minQty" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GarageStockAlert_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SavedSupplyItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SavedSupplyItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "VerificationDocument" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "orgId" TEXT,
    "applicationId" TEXT,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedByName" TEXT,
    "reviewedAt" DATETIME,
    "infoRequestedAt" DATETIME,
    "correctionsDueAt" DATETIME,
    "expiresAt" DATETIME,
    "supersededById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VerificationDocument_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VerificationDocument_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Org" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "VerificationDocument_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "Application" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocumentAccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "documentId" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "viewerName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentAccessLog_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "VerificationDocument" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "refCode" TEXT NOT NULL,
    "buyerUserId" TEXT NOT NULL,
    "supplierOrgId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "county" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "notes" TEXT,
    "deliveryMethod" TEXT NOT NULL DEFAULT 'DIRECT',
    "deliveryFeeMinor" INTEGER NOT NULL DEFAULT 0,
    "totalMinor" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
    "invoiceId" TEXT,
    "otpHash" TEXT,
    "otpHint" TEXT,
    "courierName" TEXT,
    "fulfillmentBranchId" TEXT,
    "rejectedReason" TEXT,
    "deliveredAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerOrder_buyerUserId_fkey" FOREIGN KEY ("buyerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerOrder_supplierOrgId_fkey" FOREIGN KEY ("supplierOrgId") REFERENCES "Org" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerOrder_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerOrderItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "lineTotalMinor" INTEGER NOT NULL,
    CONSTRAINT "CustomerOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerOrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerOrderEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorSide" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerOrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "CustomerOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DemoAccount_roleKey_key" ON "DemoAccount"("roleKey");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsPartner_refCode_key" ON "LogisticsPartner"("refCode");

-- CreateIndex
CREATE UNIQUE INDEX "LogisticsPartner_ownerUserId_key" ON "LogisticsPartner"("ownerUserId");

-- CreateIndex
CREATE INDEX "LogisticsPartner_status_idx" ON "LogisticsPartner"("status");

-- CreateIndex
CREATE INDEX "LogisticsPartnerEvent_partnerId_createdAt_idx" ON "LogisticsPartnerEvent"("partnerId", "createdAt");

-- CreateIndex
CREATE INDEX "Driver_partnerId_idx" ON "Driver"("partnerId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryJob_refCode_key" ON "DeliveryJob"("refCode");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryJob_qrToken_key" ON "DeliveryJob"("qrToken");

-- CreateIndex
CREATE INDEX "DeliveryJob_status_createdAt_idx" ON "DeliveryJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DeliveryJob_requestedByUserId_idx" ON "DeliveryJob"("requestedByUserId");

-- CreateIndex
CREATE INDEX "DeliveryJob_partnerId_idx" ON "DeliveryJob"("partnerId");

-- CreateIndex
CREATE INDEX "DeliveryJobEvent_jobId_createdAt_idx" ON "DeliveryJobEvent"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_orgId_lastMessageAt_idx" ON "Conversation"("orgId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_customerId_lastMessageAt_idx" ON "Conversation"("customerId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleCustody_refCode_key" ON "VehicleCustody"("refCode");

-- CreateIndex
CREATE INDEX "VehicleCustody_orgId_status_idx" ON "VehicleCustody"("orgId", "status");

-- CreateIndex
CREATE INDEX "VehicleCustody_customerId_status_idx" ON "VehicleCustody"("customerId", "status");

-- CreateIndex
CREATE INDEX "CustodyEvent_custodyId_createdAt_idx" ON "CustodyEvent"("custodyId", "createdAt");

-- CreateIndex
CREATE INDEX "RoadTest_custodyId_idx" ON "RoadTest"("custodyId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectionAuthorisation_custodyId_key" ON "CollectionAuthorisation"("custodyId");

-- CreateIndex
CREATE UNIQUE INDEX "TestDrive_refCode_key" ON "TestDrive"("refCode");

-- CreateIndex
CREATE INDEX "TestDrive_orgId_status_idx" ON "TestDrive"("orgId", "status");

-- CreateIndex
CREATE INDEX "TestDrive_customerId_idx" ON "TestDrive"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SecurityIncident_refCode_key" ON "SecurityIncident"("refCode");

-- CreateIndex
CREATE INDEX "SecurityIncident_status_severity_idx" ON "SecurityIncident"("status", "severity");

-- CreateIndex
CREATE INDEX "OrgMember_userId_idx" ON "OrgMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgMember_orgId_userId_key" ON "OrgMember"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Application_refCode_key" ON "Application"("refCode");

-- CreateIndex
CREATE INDEX "Application_status_submittedAt_idx" ON "Application"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_refCode_key" ON "Vehicle"("refCode");

-- CreateIndex
CREATE INDEX "Vehicle_status_make_idx" ON "Vehicle"("status", "make");

-- CreateIndex
CREATE INDEX "Vehicle_status_bodyType_idx" ON "Vehicle"("status", "bodyType");

-- CreateIndex
CREATE INDEX "Vehicle_status_priceMinor_idx" ON "Vehicle"("status", "priceMinor");

-- CreateIndex
CREATE INDEX "Vehicle_status_county_idx" ON "Vehicle"("status", "county");

-- CreateIndex
CREATE INDEX "Vehicle_status_createdAt_idx" ON "Vehicle"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SavedVehicle_userId_vehicleId_key" ON "SavedVehicle"("userId", "vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSearch_userId_name_key" ON "SavedSearch"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Enquiry_refCode_key" ON "Enquiry"("refCode");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceRequest_refCode_key" ON "ServiceRequest"("refCode");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_requestId_orgId_key" ON "Quote"("requestId", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_requestId_key" ON "Booking"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "OrgReview_orgId_authorId_key" ON "OrgReview"("orgId", "authorId");

-- CreateIndex
CREATE UNIQUE INDEX "RoadsideRequest_refCode_key" ON "RoadsideRequest"("refCode");

-- CreateIndex
CREATE INDEX "Reminder_status_dueDate_idx" ON "Reminder"("status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "CustomizerConfig_shareId_key" ON "CustomizerConfig"("shareId");

-- CreateIndex
CREATE UNIQUE INDEX "PostReaction_postId_userId_key" ON "PostReaction"("postId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_orgId_key" ON "Subscription"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_refCode_key" ON "Invoice"("refCode");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_checkoutRequestId_key" ON "PaymentAttempt"("checkoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_refCode_key" ON "Campaign"("refCode");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_refCode_key" ON "SupportTicket"("refCode");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE UNIQUE INDEX "ViewEvent_key_key" ON "ViewEvent"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_refCode_key" ON "Partner"("refCode");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerRequest_refCode_key" ON "PartnerRequest"("refCode");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_userId_createdAt_idx" ON "LoyaltyLedger"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoyaltyLedger_reason_idx" ON "LoyaltyLedger"("reason");

-- CreateIndex
CREATE INDEX "OrgBranch_orgId_status_idx" ON "OrgBranch"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "OrgBranch_orgId_code_key" ON "OrgBranch"("orgId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ProductCategory_slug_key" ON "ProductCategory"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_refCode_key" ON "Product"("refCode");

-- CreateIndex
CREATE INDEX "Product_status_categoryId_idx" ON "Product"("status", "categoryId");

-- CreateIndex
CREATE INDEX "Product_supplierOrgId_status_idx" ON "Product"("supplierOrgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Product_supplierOrgId_sku_key" ON "Product"("supplierOrgId", "sku");

-- CreateIndex
CREATE INDEX "ProductCompatibility_productId_idx" ON "ProductCompatibility"("productId");

-- CreateIndex
CREATE INDEX "ProductCompatibility_make_model_idx" ON "ProductCompatibility"("make", "model");

-- CreateIndex
CREATE INDEX "ProductStock_branchId_idx" ON "ProductStock"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductStock_productId_branchId_key" ON "ProductStock"("productId", "branchId");

-- CreateIndex
CREATE INDEX "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "StockMovement_branchId_createdAt_idx" ON "StockMovement"("branchId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductPriceHistory_productId_createdAt_idx" ON "ProductPriceHistory"("productId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProductReview_productId_authorId_key" ON "ProductReview"("productId", "authorId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_refCode_key" ON "PurchaseOrder"("refCode");

-- CreateIndex
CREATE INDEX "PurchaseOrder_garageOrgId_status_idx" ON "PurchaseOrder"("garageOrgId", "status");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierOrgId_status_idx" ON "PurchaseOrder"("supplierOrgId", "status");

-- CreateIndex
CREATE INDEX "POItem_orderId_idx" ON "POItem"("orderId");

-- CreateIndex
CREATE INDEX "POItem_productId_idx" ON "POItem"("productId");

-- CreateIndex
CREATE INDEX "PORevision_orderId_status_idx" ON "PORevision"("orderId", "status");

-- CreateIndex
CREATE INDEX "POEvent_orderId_createdAt_idx" ON "POEvent"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_refCode_key" ON "Delivery"("refCode");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_orderId_key" ON "Delivery"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_qrToken_key" ON "Delivery"("qrToken");

-- CreateIndex
CREATE INDEX "Delivery_status_idx" ON "Delivery"("status");

-- CreateIndex
CREATE INDEX "DeliveryEvent_deliveryId_createdAt_idx" ON "DeliveryEvent"("deliveryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAuthorization_refCode_key" ON "PaymentAuthorization"("refCode");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAuthorization_orderId_key" ON "PaymentAuthorization"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAuthorization_checkoutRef_key" ON "PaymentAuthorization"("checkoutRef");

-- CreateIndex
CREATE INDEX "PaymentAuthorization_status_idx" ON "PaymentAuthorization"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_refCode_key" ON "Refund"("refCode");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_refCode_key" ON "Settlement"("refCode");

-- CreateIndex
CREATE INDEX "Settlement_orgId_status_idx" ON "Settlement"("orgId", "status");

-- CreateIndex
CREATE INDEX "Settlement_status_createdAt_idx" ON "Settlement"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Settlement_orderId_idx" ON "Settlement"("orderId");

-- CreateIndex
CREATE INDEX "SettlementEvent_settlementId_createdAt_idx" ON "SettlementEvent"("settlementId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Dispute_refCode_key" ON "Dispute"("refCode");

-- CreateIndex
CREATE INDEX "Dispute_status_idx" ON "Dispute"("status");

-- CreateIndex
CREATE INDEX "DisputeEvent_disputeId_createdAt_idx" ON "DisputeEvent"("disputeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WarrantyClaim_refCode_key" ON "WarrantyClaim"("refCode");

-- CreateIndex
CREATE INDEX "WarrantyClaim_supplierOrgId_status_idx" ON "WarrantyClaim"("supplierOrgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PartReturn_refCode_key" ON "PartReturn"("refCode");

-- CreateIndex
CREATE INDEX "PartReturn_orderId_idx" ON "PartReturn"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteRequest_refCode_key" ON "QuoteRequest"("refCode");

-- CreateIndex
CREATE INDEX "QuoteRequest_garageOrgId_status_idx" ON "QuoteRequest"("garageOrgId", "status");

-- CreateIndex
CREATE INDEX "QuoteOffer_supplierOrgId_status_idx" ON "QuoteOffer"("supplierOrgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "QuoteOffer_requestId_supplierOrgId_key" ON "QuoteOffer"("requestId", "supplierOrgId");

-- CreateIndex
CREATE INDEX "MembershipTier_orgId_active_idx" ON "MembershipTier"("orgId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMembership_refCode_key" ON "BusinessMembership"("refCode");

-- CreateIndex
CREATE INDEX "BusinessMembership_customerId_status_idx" ON "BusinessMembership"("customerId", "status");

-- CreateIndex
CREATE INDEX "BusinessMembership_orgId_status_idx" ON "BusinessMembership"("orgId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipRedemption_membershipId_benefit_periodKey_key" ON "MembershipRedemption"("membershipId", "benefit", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "TrustProgramme_orgId_key" ON "TrustProgramme"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "TrustMember_programmeId_customerId_key" ON "TrustMember"("programmeId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditFacility_refCode_key" ON "CreditFacility"("refCode");

-- CreateIndex
CREATE UNIQUE INDEX "CreditFacility_orgId_customerId_key" ON "CreditFacility"("orgId", "customerId");

-- CreateIndex
CREATE INDEX "CreditEntry_facilityId_createdAt_idx" ON "CreditEntry"("facilityId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VehicleTransfer_refCode_key" ON "VehicleTransfer"("refCode");

-- CreateIndex
CREATE INDEX "VehicleTransfer_orgId_status_idx" ON "VehicleTransfer"("orgId", "status");

-- CreateIndex
CREATE INDEX "VehicleTransferEvent_transferId_createdAt_idx" ON "VehicleTransferEvent"("transferId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GarageStockAlert_garageOrgId_productId_key" ON "GarageStockAlert"("garageOrgId", "productId");

-- CreateIndex
CREATE INDEX "SavedSupplyItem_userId_idx" ON "SavedSupplyItem"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSupplyItem_userId_targetType_targetId_key" ON "SavedSupplyItem"("userId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationDocument_refCode_key" ON "VerificationDocument"("refCode");

-- CreateIndex
CREATE INDEX "VerificationDocument_ownerUserId_status_idx" ON "VerificationDocument"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "VerificationDocument_orgId_status_idx" ON "VerificationDocument"("orgId", "status");

-- CreateIndex
CREATE INDEX "VerificationDocument_applicationId_idx" ON "VerificationDocument"("applicationId");

-- CreateIndex
CREATE INDEX "VerificationDocument_status_createdAt_idx" ON "VerificationDocument"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DocumentAccessLog_documentId_createdAt_idx" ON "DocumentAccessLog"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOrder_refCode_key" ON "CustomerOrder"("refCode");

-- CreateIndex
CREATE INDEX "CustomerOrder_buyerUserId_status_idx" ON "CustomerOrder"("buyerUserId", "status");

-- CreateIndex
CREATE INDEX "CustomerOrder_supplierOrgId_status_idx" ON "CustomerOrder"("supplierOrgId", "status");

-- CreateIndex
CREATE INDEX "CustomerOrderItem_orderId_idx" ON "CustomerOrderItem"("orderId");

-- CreateIndex
CREATE INDEX "CustomerOrderEvent_orderId_createdAt_idx" ON "CustomerOrderEvent"("orderId", "createdAt");

