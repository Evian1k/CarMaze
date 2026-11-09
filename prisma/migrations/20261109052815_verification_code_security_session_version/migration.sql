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
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "referralCode" TEXT,
    "referredById" TEXT,
    "referredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "department", "email", "emailCode", "emailVerified", "id", "isDemo", "mfaEnabled", "name", "passwordHash", "phone", "phoneCode", "phoneVerified", "referralCode", "referredAt", "referredById", "roles", "status", "totpSecret", "updatedAt") SELECT "createdAt", "department", "email", "emailCode", "emailVerified", "id", "isDemo", "mfaEnabled", "name", "passwordHash", "phone", "phoneCode", "phoneVerified", "referralCode", "referredAt", "referredById", "roles", "status", "totpSecret", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "User_referralCode_key" ON "User"("referralCode");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
