-- AlterTable
ALTER TABLE "Enquiry" ADD COLUMN "assignedToId" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "phoneCode" TEXT,
    "phoneCodeExpiresAt" DATETIME,
    "phoneCodeAttempts" INTEGER NOT NULL DEFAULT 0,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailCode" TEXT,
    "emailCodeExpiresAt" DATETIME,
    "emailCodeAttempts" INTEGER NOT NULL DEFAULT 0,
    "roles" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "department" TEXT,
    "totpSecret" TEXT,
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "marketingConsent" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "referralCode" TEXT,
    "referredById" TEXT,
    "referredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "department", "email", "emailCode", "emailCodeAttempts", "emailCodeExpiresAt", "emailVerified", "id", "isDemo", "mfaEnabled", "name", "passwordHash", "phone", "phoneCode", "phoneCodeAttempts", "phoneCodeExpiresAt", "phoneVerified", "referralCode", "referredAt", "referredById", "roles", "sessionVersion", "status", "totpSecret", "updatedAt") SELECT "createdAt", "department", "email", "emailCode", "emailCodeAttempts", "emailCodeExpiresAt", "emailVerified", "id", "isDemo", "mfaEnabled", "name", "passwordHash", "phone", "phoneCode", "phoneCodeAttempts", "phoneCodeExpiresAt", "phoneVerified", "referralCode", "referredAt", "referredById", "roles", "sessionVersion", "status", "totpSecret", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Enquiry_vehicleId_idx" ON "Enquiry"("vehicleId");

-- CreateIndex
CREATE INDEX "Enquiry_userId_idx" ON "Enquiry"("userId");

-- CreateIndex
CREATE INDEX "Enquiry_status_createdAt_idx" ON "Enquiry"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Invoice_orgId_status_idx" ON "Invoice"("orgId", "status");

-- CreateIndex
CREATE INDEX "Invoice_userId_status_idx" ON "Invoice"("userId", "status");

-- CreateIndex
CREATE INDEX "Invoice_dueDate_idx" ON "Invoice"("dueDate");

-- CreateIndex
CREATE INDEX "PaymentAttempt_invoiceId_idx" ON "PaymentAttempt"("invoiceId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_status_createdAt_idx" ON "PaymentAttempt"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupportTicket_userId_idx" ON "SupportTicket"("userId");

-- CreateIndex
CREATE INDEX "Vehicle_ownerId_idx" ON "Vehicle"("ownerId");

-- CreateIndex
CREATE INDEX "Vehicle_orgId_idx" ON "Vehicle"("orgId");


-- ReconcileMigration — captures schema deltas that were historically applied
-- to the development database via `prisma db push` instead of versioned
-- migrations. From this point on, `prisma migrate deploy` alone reproduces
-- the full production schema on a fresh database; `db:push` is dev-only.
