-- CreateEnum
CREATE TYPE "AutomatedContentStatus" AS ENUM ('pending', 'publishing', 'published', 'failed', 'failed_terminal');

-- NOTE: `prisma migrate dev` also generated a drop/re-add of the unrelated
-- ProductionTask_clientId_fkey constraint. That is PRE-EXISTING drift between the
-- committed migrations and schema.prisma — not part of this feature. Both statements
-- were removed on purpose so this migration is purely additive and cannot touch the
-- legacy pipeline. Do not re-add them here.

-- CreateTable
CREATE TABLE "AutomatedContentSheet" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "tabName" TEXT NOT NULL DEFAULT 'Schedule',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomatedContentSheet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomatedContentPost" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "sheetRowId" TEXT NOT NULL,
    "sheetRowNumber" INTEGER NOT NULL,
    "platform" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "pillar" TEXT,
    "assetLink" TEXT NOT NULL,
    "mediaUrl" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "status" "AutomatedContentStatus" NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "publishedAt" TIMESTAMP(3),
    "igPostId" TEXT,
    "fbPostId" TEXT,
    "liveUrl" TEXT,
    "writtenBack" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AutomatedContentPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AutomatedContentSheet_clientId_key" ON "AutomatedContentSheet"("clientId");

-- CreateIndex
CREATE INDEX "AutomatedContentSheet_agencyId_idx" ON "AutomatedContentSheet"("agencyId");

-- CreateIndex
CREATE INDEX "AutomatedContentPost_status_scheduledAt_idx" ON "AutomatedContentPost"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "AutomatedContentPost_clientId_idx" ON "AutomatedContentPost"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "AutomatedContentPost_clientId_sheetRowId_key" ON "AutomatedContentPost"("clientId", "sheetRowId");
