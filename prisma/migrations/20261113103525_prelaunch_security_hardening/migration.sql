-- AlterTable
ALTER TABLE "CustomerOrder" ADD COLUMN "otpExpiresAt" DATETIME;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN "otpExpiresAt" DATETIME;
ALTER TABLE "Delivery" ADD COLUMN "qrTokenEnc" TEXT;
ALTER TABLE "Delivery" ADD COLUMN "qrTokenHash" TEXT;

-- AlterTable
ALTER TABLE "DeliveryJob" ADD COLUMN "otpExpiresAt" DATETIME;
ALTER TABLE "DeliveryJob" ADD COLUMN "qrTokenEnc" TEXT;
ALTER TABLE "DeliveryJob" ADD COLUMN "qrTokenHash" TEXT;

-- CreateTable
CREATE TABLE "FileAccessLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "uploadRecordId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "viewerId" TEXT NOT NULL,
    "viewerName" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FileAccessLog_uploadRecordId_fkey" FOREIGN KEY ("uploadRecordId") REFERENCES "UploadRecord" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FileAccessLog_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UploadRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "accessKind" TEXT NOT NULL DEFAULT 'PUBLIC',
    "scanStatus" TEXT NOT NULL DEFAULT 'UNSCANNED',
    "scannedAt" DATETIME,
    "quarantined" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" DATETIME,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "purpose" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadRecord_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UploadRecord" ("createdAt", "fileName", "id", "kind", "mimeType", "ownerUserId", "purpose", "sizeBytes", "url", "visibility") SELECT "createdAt", "fileName", "id", "kind", "mimeType", "ownerUserId", "purpose", "sizeBytes", "url", "visibility" FROM "UploadRecord";
DROP TABLE "UploadRecord";
ALTER TABLE "new_UploadRecord" RENAME TO "UploadRecord";
CREATE UNIQUE INDEX "UploadRecord_fileName_key" ON "UploadRecord"("fileName");
CREATE INDEX "UploadRecord_ownerUserId_createdAt_idx" ON "UploadRecord"("ownerUserId", "createdAt");
CREATE INDEX "UploadRecord_visibility_createdAt_idx" ON "UploadRecord"("visibility", "createdAt");
CREATE INDEX "UploadRecord_accessKind_expiresAt_idx" ON "UploadRecord"("accessKind", "expiresAt");
CREATE INDEX "UploadRecord_scanStatus_quarantined_idx" ON "UploadRecord"("scanStatus", "quarantined");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "FileAccessLog_uploadRecordId_createdAt_idx" ON "FileAccessLog"("uploadRecordId", "createdAt");

-- CreateIndex
CREATE INDEX "FileAccessLog_viewerId_createdAt_idx" ON "FileAccessLog"("viewerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessMembership_orgId_customerId_key" ON "BusinessMembership"("orgId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Delivery_qrTokenHash_key" ON "Delivery"("qrTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryJob_qrTokenHash_key" ON "DeliveryJob"("qrTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_orderId_kind_key" ON "Settlement"("orderId", "kind");

-- BackfillData — legacy rows keep their pre-existing semantics:
-- documents uploaded before the evidence/quarantine model stay PRIVATE_DOC.
UPDATE "UploadRecord" SET "accessKind" = 'PRIVATE_DOC' WHERE "visibility" = 'PRIVATE';

