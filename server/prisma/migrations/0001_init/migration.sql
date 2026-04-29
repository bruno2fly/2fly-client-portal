-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF', 'CLIENT', 'DESIGNER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('active', 'inactive', 'archived');

-- CreateEnum
CREATE TYPE "AssetSource" AS ENUM ('upload', 'google_drive');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('photo', 'video', 'logo', 'doc');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('pending', 'approved', 'changes');

-- CreateEnum
CREATE TYPE "ScheduledPostStatus" AS ENUM ('scheduled', 'publishing', 'published', 'failed');

-- CreateEnum
CREATE TYPE "ProductionTaskStatus" AS ENUM ('assigned', 'in_progress', 'review', 'changes_requested', 'approved', 'ready_to_post');

-- CreateEnum
CREATE TYPE "ProductionTaskPriority" AS ENUM ('low', 'medium', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "AIImageFormat" AS ENUM ('feed', 'story', 'carousel', 'ad_banner');

-- CreateEnum
CREATE TYPE "AIImageStatus" AS ENUM ('generated', 'pending_approval', 'approved', 'rejected', 'used_in_post');

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "passwordHash" TEXT,
    "tempPassword" TEXT,
    "clientId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "ClientStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "category" TEXT,
    "primaryContactName" TEXT,
    "primaryContactWhatsApp" TEXT,
    "primaryContactEmail" TEXT,
    "preferredChannel" TEXT,
    "platformsManaged" TEXT[],
    "postingFrequency" TEXT,
    "postingFrequencyNote" TEXT,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT,
    "assetsLink" TEXT,
    "brandGuidelinesLink" TEXT,
    "primaryGoal" TEXT,
    "secondaryGoal" TEXT,
    "internalBehaviorType" TEXT,
    "riskLevel" TEXT,
    "internalNotes" TEXT,
    "logoUrl" TEXT,
    "clientLinks" JSONB,
    "aiSummaryCache" JSONB,
    "portalPassword" TEXT,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InviteToken" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InviteToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetUserId" TEXT,
    "targetClientId" TEXT,
    "metaJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalState" (
    "agencyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalState_pkey" PRIMARY KEY ("agencyId", "clientId")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "source" "AssetSource" NOT NULL,
    "originalFileId" TEXT,
    "originalName" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "type" "AssetType" NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'pending',
    "tags" TEXT[],
    "caption" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GoogleIntegration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "connectedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3) NOT NULL,
    "errorMessage" TEXT,

    CONSTRAINT "GoogleIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaIntegration" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "metaAccessToken" TEXT NOT NULL,
    "metaUserAccessToken" TEXT,
    "metaPageId" TEXT NOT NULL,
    "metaPageName" TEXT,
    "metaInstagramAccountId" TEXT,
    "metaInstagramUsername" TEXT,
    "tokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "connectionStatus" TEXT,
    "connectionError" TEXT,
    "connectionFlaggedAt" TIMESTAMP(3),

    CONSTRAINT "MetaIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduledPost" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "caption" TEXT NOT NULL,
    "mediaUrl" TEXT NOT NULL,
    "mediaUrls" TEXT[],
    "platforms" TEXT[],
    "placements" TEXT[],
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "ScheduledPostStatus" NOT NULL DEFAULT 'scheduled',
    "publishedAt" TIMESTAMP(3),
    "error" TEXT,
    "metaPostIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduledPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionTask" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL DEFAULT '',
    "approvalId" TEXT NOT NULL DEFAULT '',
    "designerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "copyText" TEXT NOT NULL DEFAULT '',
    "referenceImages" TEXT[],
    "briefNotes" TEXT NOT NULL DEFAULT '',
    "finalArt" TEXT[],
    "designerNotes" TEXT NOT NULL DEFAULT '',
    "status" "ProductionTaskStatus" NOT NULL DEFAULT 'assigned',
    "priority" "ProductionTaskPriority" NOT NULL DEFAULT 'medium',
    "deadline" TIMESTAMP(3) NOT NULL,
    "reviewNotes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "ProductionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionTaskComment" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "statusChange" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductionTaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandKit" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "logoUrls" TEXT[],
    "colors" JSONB NOT NULL,
    "fonts" JSONB NOT NULL,
    "styleTags" TEXT[],
    "photoStyle" TEXT NOT NULL DEFAULT '',
    "rulesText" TEXT NOT NULL DEFAULT '',
    "referenceImages" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandKit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIImage" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "brandKitId" TEXT,
    "prompt" TEXT NOT NULL,
    "enhancedPrompt" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT NOT NULL DEFAULT '',
    "format" "AIImageFormat" NOT NULL DEFAULT 'feed',
    "formatDimensions" TEXT NOT NULL DEFAULT '',
    "status" "AIImageStatus" NOT NULL DEFAULT 'generated',
    "generatedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvalDate" TIMESTAMP(3),
    "feedback" TEXT NOT NULL DEFAULT '',
    "usedInPostId" TEXT,
    "modelUsed" TEXT NOT NULL DEFAULT '',
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AIImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceImage" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "caption" TEXT NOT NULL DEFAULT '',
    "platforms" TEXT[],
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_agencyId_email_key" ON "User"("agencyId", "email");

-- CreateIndex
CREATE INDEX "User_agencyId_idx" ON "User"("agencyId");

-- CreateIndex
CREATE INDEX "Client_agencyId_idx" ON "Client"("agencyId");

-- CreateIndex
CREATE INDEX "InviteToken_tokenHash_idx" ON "InviteToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PasswordResetToken_tokenHash_idx" ON "PasswordResetToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuditLog_agencyId_createdAt_idx" ON "AuditLog"("agencyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PortalState_clientId_key" ON "PortalState"("clientId");

-- CreateIndex
CREATE INDEX "Asset_agencyId_idx" ON "Asset"("agencyId");

-- CreateIndex
CREATE INDEX "Asset_clientId_idx" ON "Asset"("clientId");

-- CreateIndex
CREATE INDEX "MetaIntegration_agencyId_idx" ON "MetaIntegration"("agencyId");

-- CreateIndex
CREATE INDEX "MetaIntegration_clientId_idx" ON "MetaIntegration"("clientId");

-- CreateIndex
CREATE INDEX "ScheduledPost_agencyId_idx" ON "ScheduledPost"("agencyId");

-- CreateIndex
CREATE INDEX "ScheduledPost_status_scheduledAt_idx" ON "ScheduledPost"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "ProductionTask_agencyId_idx" ON "ProductionTask"("agencyId");

-- CreateIndex
CREATE INDEX "ProductionTask_designerId_idx" ON "ProductionTask"("designerId");

-- CreateIndex
CREATE INDEX "ProductionTask_clientId_idx" ON "ProductionTask"("clientId");

-- CreateIndex
CREATE INDEX "ProductionTask_approvalId_idx" ON "ProductionTask"("approvalId");

-- CreateIndex
CREATE INDEX "ProductionTaskComment_taskId_idx" ON "ProductionTaskComment"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- CreateIndex
CREATE INDEX "PushSubscription_agencyId_role_idx" ON "PushSubscription"("agencyId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "BrandKit_clientId_key" ON "BrandKit"("clientId");

-- CreateIndex
CREATE INDEX "AIImage_agencyId_idx" ON "AIImage"("agencyId");

-- CreateIndex
CREATE INDEX "AIImage_clientId_idx" ON "AIImage"("clientId");

-- CreateIndex
CREATE INDEX "ReferenceImage_clientId_idx" ON "ReferenceImage"("clientId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InviteToken" ADD CONSTRAINT "InviteToken_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordResetToken" ADD CONSTRAINT "PasswordResetToken_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalState" ADD CONSTRAINT "PortalState_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaIntegration" ADD CONSTRAINT "MetaIntegration_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetaIntegration" ADD CONSTRAINT "MetaIntegration_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduledPost" ADD CONSTRAINT "ScheduledPost_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTask" ADD CONSTRAINT "ProductionTask_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionTaskComment" ADD CONSTRAINT "ProductionTaskComment_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProductionTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandKit" ADD CONSTRAINT "BrandKit_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandKit" ADD CONSTRAINT "BrandKit_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIImage" ADD CONSTRAINT "AIImage_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIImage" ADD CONSTRAINT "AIImage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceImage" ADD CONSTRAINT "ReferenceImage_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceImage" ADD CONSTRAINT "ReferenceImage_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
