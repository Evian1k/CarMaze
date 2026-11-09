-- CreateTable
CREATE TABLE "UploadRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerUserId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "visibility" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "purpose" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UploadRecord_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "UploadRecord_fileName_key" ON "UploadRecord"("fileName");

-- CreateIndex
CREATE INDEX "UploadRecord_ownerUserId_createdAt_idx" ON "UploadRecord"("ownerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "UploadRecord_visibility_createdAt_idx" ON "UploadRecord"("visibility", "createdAt");
