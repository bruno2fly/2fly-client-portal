/**
 * Database layer — Prisma/PostgreSQL implementation
 *
 * Drop-in replacement for db.ts (JSON file version).
 * Every export keeps the same name and signature; return types use
 * the app-level interfaces from ./types.ts.
 * All functions are async (return Promises).
 */

import { PrismaClient } from '@prisma/client';
import type {
  Workspace,
  Staff,
  WorkspaceIntegrationGoogle,
  Asset,
  Agency,
  User,
  Client,
  InviteToken,
  PasswordResetToken,
  AuditLog,
  PortalStateData,
  MetaIntegration,
  ScheduledPost,
  ProductionTask,
  PushSubscriptionRecord,
} from './types.js';

const prisma = new PrismaClient();
export { prisma };

// ─── helpers ───────────────────────────────────────────────────

/** Convert a Prisma DateTime (or null) to epoch-ms number. */
function toEpoch(d: Date | null | undefined): number {
  return d ? d.getTime() : 0;
}

/** Convert epoch-ms to a Date, falling back to now(). */
function toDate(n: number | string | null | undefined): Date {
  if (!n) return new Date();
  return new Date(typeof n === 'string' ? n : n);
}

/** Convert a nullable epoch-ms to Date | null. */
function toDateNullable(n: number | string | null | undefined): Date | null {
  if (n === null || n === undefined) return null;
  return new Date(typeof n === 'string' ? n : n);
}

// ─── Re-exported interfaces that were defined in the old db.ts ─

export interface BrandKit {
  id: string;
  clientId: string;
  agencyId: string;
  logoUrls: string[];
  colors: { name: string; hex: string }[];
  fonts: { heading: string; body: string; weights: string[] };
  styleTags: string[];
  photoStyle: string;
  rulesText: string;
  referenceImages: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AIImage {
  id: string;
  clientId: string;
  agencyId: string;
  brandKitId: string | null;
  prompt: string;
  enhancedPrompt: string;
  imageUrl: string;
  thumbnailUrl: string;
  format: 'feed' | 'story' | 'carousel' | 'ad_banner';
  formatDimensions: string;
  status: 'generated' | 'pending_approval' | 'approved' | 'rejected' | 'used_in_post';
  generatedBy: string;
  approvedBy: string | null;
  approvalDate: number | null;
  feedback: string;
  usedInPostId: string | null;
  modelUsed: string;
  batchId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ReferenceImage {
  id: string;
  agencyId: string;
  clientId: string;
  imageUrl: string;
  source: 'published_post' | 'ai_approved' | 'client_approved';
  sourceId: string | null;
  caption: string;
  platforms: string[];
  publishedAt: string | null;
  createdAt: string;
}

// ─── Prisma-row → app-type mappers ────────────────────────────

function mapWorkspace(r: any): Workspace {
  return {
    id: r.id,
    name: r.name,
    createdAt: toEpoch(r.createdAt),
    updatedAt: toEpoch(r.updatedAt),
  };
}

function mapStaff(r: any): Staff {
  return {
    id: r.id,
    username: r.username,
    fullName: r.fullName,
    email: r.email,
    workspaceId: r.workspaceId,
    createdAt: toEpoch(r.createdAt),
  };
}

function mapAgency(r: any): Agency {
  return {
    id: r.id,
    name: r.name,
    createdAt: toEpoch(r.createdAt),
  };
}

function mapUser(r: any): User {
  return {
    id: r.id,
    agencyId: r.agencyId,
    email: r.email,
    username: r.username ?? undefined,
    name: r.name,
    role: r.role as User['role'],
    status: r.status as User['status'],
    passwordHash: r.passwordHash ?? null,
    tempPassword: r.tempPassword ?? undefined,
    clientId: r.clientId ?? undefined,
    lastLoginAt: r.lastLoginAt ? toEpoch(r.lastLoginAt) : null,
    createdAt: toEpoch(r.createdAt),
    updatedAt: toEpoch(r.updatedAt),
  };
}

function mapClient(r: any): Client {
  return {
    id: r.id,
    agencyId: r.agencyId,
    name: r.name,
    status: r.status as Client['status'],
    createdAt: toEpoch(r.createdAt),
    updatedAt: toEpoch(r.updatedAt),
    category: r.category ?? undefined,
    primaryContactName: r.primaryContactName ?? undefined,
    primaryContactWhatsApp: r.primaryContactWhatsApp ?? undefined,
    primaryContactEmail: r.primaryContactEmail ?? undefined,
    preferredChannel: r.preferredChannel ?? undefined,
    platformsManaged: r.platformsManaged ?? undefined,
    postingFrequency: r.postingFrequency ?? undefined,
    postingFrequencyNote: r.postingFrequencyNote ?? undefined,
    approvalRequired: r.approvalRequired ?? false,
    language: r.language ?? undefined,
    assetsLink: r.assetsLink ?? undefined,
    brandGuidelinesLink: r.brandGuidelinesLink ?? undefined,
    primaryGoal: r.primaryGoal ?? undefined,
    secondaryGoal: r.secondaryGoal ?? undefined,
    internalBehaviorType: r.internalBehaviorType ?? undefined,
    riskLevel: r.riskLevel ?? undefined,
    internalNotes: r.internalNotes ?? undefined,
    logoUrl: r.logoUrl ?? undefined,
    clientLinks: (r.clientLinks as Client['clientLinks']) ?? undefined,
    aiSummaryCache: (r.aiSummaryCache as Client['aiSummaryCache']) ?? undefined,
  };
}

function mapInviteToken(r: any): InviteToken {
  return {
    id: r.id,
    agencyId: r.agencyId,
    userId: r.userId,
    tokenHash: r.tokenHash,
    expiresAt: toEpoch(r.expiresAt),
    usedAt: r.usedAt ? toEpoch(r.usedAt) : null,
    createdAt: toEpoch(r.createdAt),
  };
}

function mapPasswordResetToken(r: any): PasswordResetToken {
  return {
    id: r.id,
    agencyId: r.agencyId,
    userId: r.userId,
    tokenHash: r.tokenHash,
    expiresAt: toEpoch(r.expiresAt),
    usedAt: r.usedAt ? toEpoch(r.usedAt) : null,
    createdAt: toEpoch(r.createdAt),
  };
}

function mapAuditLog(r: any): AuditLog {
  return {
    id: r.id,
    agencyId: r.agencyId,
    actorUserId: r.actorUserId,
    action: r.action,
    targetUserId: r.targetUserId ?? null,
    targetClientId: r.targetClientId ?? null,
    metaJson: r.metaJson ?? undefined,
    createdAt: toEpoch(r.createdAt),
  };
}

function mapAsset(r: any): Asset {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    agencyId: r.agencyId ?? undefined,
    clientId: r.clientId,
    source: r.source as Asset['source'],
    originalFileId: r.originalFileId ?? undefined,
    originalName: r.originalName,
    filename: r.filename,
    mimeType: r.mimeType,
    size: r.size,
    storageUrl: r.storageUrl,
    thumbnailUrl: r.thumbnailUrl ?? undefined,
    type: r.type as Asset['type'],
    status: r.status as Asset['status'],
    tags: r.tags ?? [],
    caption: r.caption ?? undefined,
    createdByUserId: r.createdByUserId,
    createdAt: toEpoch(r.createdAt),
    updatedAt: toEpoch(r.updatedAt),
  };
}

function mapGoogleIntegration(r: any): WorkspaceIntegrationGoogle {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    encryptedRefreshToken: r.encryptedRefreshToken,
    status: r.status as WorkspaceIntegrationGoogle['status'],
    connectedAt: toEpoch(r.connectedAt),
    lastUsedAt: toEpoch(r.lastUsedAt),
    errorMessage: r.errorMessage ?? undefined,
  };
}

function mapMetaIntegration(r: any): MetaIntegration {
  return {
    id: r.id,
    agencyId: r.agencyId,
    clientId: r.clientId,
    metaAccessToken: r.metaAccessToken,
    metaUserAccessToken: r.metaUserAccessToken ?? undefined,
    metaPageId: r.metaPageId,
    metaPageName: r.metaPageName ?? undefined,
    metaInstagramAccountId: r.metaInstagramAccountId ?? undefined,
    metaInstagramUsername: r.metaInstagramUsername ?? undefined,
    tokenExpiresAt: toEpoch(r.tokenExpiresAt),
    connectedAt: toEpoch(r.connectedAt),
    updatedAt: toEpoch(r.updatedAt),
    connectionStatus: (r.connectionStatus as MetaIntegration['connectionStatus']) ?? undefined,
    connectionError: r.connectionError ?? undefined,
    connectionFlaggedAt: r.connectionFlaggedAt ? toEpoch(r.connectionFlaggedAt) : undefined,
  };
}

function mapScheduledPost(r: any): ScheduledPost {
  return {
    id: r.id,
    agencyId: r.agencyId,
    clientId: r.clientId,
    contentId: r.contentId,
    caption: r.caption,
    mediaUrl: r.mediaUrl,
    mediaUrls: r.mediaUrls ?? undefined,
    platforms: r.platforms as ScheduledPost['platforms'],
    placements: r.placements as ScheduledPost['placements'],
    scheduledAt: r.scheduledAt instanceof Date ? r.scheduledAt.toISOString() : String(r.scheduledAt),
    timezone: r.timezone,
    status: r.status as ScheduledPost['status'],
    publishedAt: r.publishedAt ? (r.publishedAt instanceof Date ? r.publishedAt.toISOString() : String(r.publishedAt)) : undefined,
    error: r.error ?? undefined,
    metaPostIds: (r.metaPostIds as ScheduledPost['metaPostIds']) ?? undefined,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  };
}

function mapProductionTask(r: any): ProductionTask {
  const comments = (r.comments ?? []).map((c: any) => ({
    id: c.id,
    authorId: c.authorId,
    authorName: c.authorName,
    authorRole: c.authorRole,
    message: c.message,
    statusChange: c.statusChange ?? null,
    createdAt: c.createdAt instanceof Date ? c.createdAt.toISOString() : String(c.createdAt),
  }));
  return {
    id: r.id,
    agencyId: r.agencyId,
    clientId: r.clientId,
    contentId: r.contentId ?? '',
    approvalId: r.approvalId ?? '',
    designerId: r.designerId,
    title: r.title,
    caption: r.caption ?? '',
    copyText: r.copyText ?? '',
    referenceImages: r.referenceImages ?? [],
    briefNotes: r.briefNotes ?? '',
    finalArt: r.finalArt ?? [],
    designerNotes: r.designerNotes ?? '',
    status: r.status as ProductionTask['status'],
    priority: r.priority as ProductionTask['priority'],
    deadline: r.deadline instanceof Date ? r.deadline.toISOString() : String(r.deadline),
    reviewNotes: r.reviewNotes ?? '',
    comments,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
    startedAt: r.startedAt ? (r.startedAt instanceof Date ? r.startedAt.toISOString() : String(r.startedAt)) : '',
    submittedAt: r.submittedAt ? (r.submittedAt instanceof Date ? r.submittedAt.toISOString() : String(r.submittedAt)) : '',
    approvedAt: r.approvedAt ? (r.approvedAt instanceof Date ? r.approvedAt.toISOString() : String(r.approvedAt)) : '',
  };
}

function mapPushSubscription(r: any): PushSubscriptionRecord {
  return {
    id: r.id,
    userId: r.userId,
    agencyId: r.agencyId,
    role: r.role,
    endpoint: r.endpoint,
    keys: r.keys as PushSubscriptionRecord['keys'],
    createdAt: toEpoch(r.createdAt),
  };
}

function mapBrandKit(r: any): BrandKit {
  return {
    id: r.id,
    clientId: r.clientId,
    agencyId: r.agencyId,
    logoUrls: r.logoUrls ?? [],
    colors: (r.colors ?? []) as BrandKit['colors'],
    fonts: (r.fonts ?? { heading: '', body: '', weights: [] }) as BrandKit['fonts'],
    styleTags: r.styleTags ?? [],
    photoStyle: r.photoStyle ?? '',
    rulesText: r.rulesText ?? '',
    referenceImages: r.referenceImages ?? [],
    createdAt: toEpoch(r.createdAt),
    updatedAt: toEpoch(r.updatedAt),
  };
}

function mapAIImage(r: any): AIImage {
  return {
    id: r.id,
    clientId: r.clientId,
    agencyId: r.agencyId,
    brandKitId: r.brandKitId ?? null,
    prompt: r.prompt,
    enhancedPrompt: r.enhancedPrompt ?? '',
    imageUrl: r.imageUrl,
    thumbnailUrl: r.thumbnailUrl ?? '',
    format: r.format as AIImage['format'],
    formatDimensions: r.formatDimensions ?? '',
    status: r.status as AIImage['status'],
    generatedBy: r.generatedBy,
    approvedBy: r.approvedBy ?? null,
    approvalDate: r.approvalDate ? toEpoch(r.approvalDate) : null,
    feedback: r.feedback ?? '',
    usedInPostId: r.usedInPostId ?? null,
    modelUsed: r.modelUsed ?? '',
    batchId: r.batchId ?? null,
    createdAt: toEpoch(r.createdAt),
    updatedAt: toEpoch(r.updatedAt),
  };
}

function mapReferenceImage(r: any): ReferenceImage {
  return {
    id: r.id,
    agencyId: r.agencyId,
    clientId: r.clientId,
    imageUrl: r.imageUrl,
    source: r.source as ReferenceImage['source'],
    sourceId: r.sourceId ?? null,
    caption: r.caption ?? '',
    platforms: r.platforms ?? [],
    publishedAt: r.publishedAt ? (r.publishedAt instanceof Date ? r.publishedAt.toISOString() : String(r.publishedAt)) : null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

// =====================================================================
//  Workspaces
// =====================================================================

export async function getWorkspaces(): Promise<Record<string, Workspace>> {
  const rows = await prisma.workspace.findMany();
  const record: Record<string, Workspace> = {};
  for (const r of rows) record[r.id] = mapWorkspace(r);
  return record;
}

export async function getWorkspace(id: string): Promise<Workspace | null> {
  const r = await prisma.workspace.findUnique({ where: { id } });
  return r ? mapWorkspace(r) : null;
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  await prisma.workspace.upsert({
    where: { id: workspace.id },
    update: { name: workspace.name },
    create: {
      id: workspace.id,
      name: workspace.name,
      createdAt: toDate(workspace.createdAt),
    },
  });
}

// =====================================================================
//  Staff
// =====================================================================

export async function getStaff(): Promise<Record<string, Staff>> {
  const rows = await prisma.staff.findMany();
  const record: Record<string, Staff> = {};
  for (const r of rows) record[r.id] = mapStaff(r);
  return record;
}

export async function getStaffByUsername(username: string): Promise<Staff | null> {
  const r = await prisma.staff.findFirst({ where: { username } });
  return r ? mapStaff(r) : null;
}

export async function getStaffById(id: string): Promise<Staff | null> {
  const r = await prisma.staff.findUnique({ where: { id } });
  return r ? mapStaff(r) : null;
}

export async function saveStaff(staffMember: Staff): Promise<void> {
  await prisma.staff.upsert({
    where: { id: staffMember.id },
    update: {
      username: staffMember.username,
      fullName: staffMember.fullName,
      email: staffMember.email,
      workspaceId: staffMember.workspaceId,
    },
    create: {
      id: staffMember.id,
      username: staffMember.username,
      fullName: staffMember.fullName,
      email: staffMember.email,
      workspaceId: staffMember.workspaceId,
      createdAt: toDate(staffMember.createdAt),
    },
  });
}

// =====================================================================
//  Google Integrations
// =====================================================================

export async function getGoogleIntegrations(): Promise<Record<string, WorkspaceIntegrationGoogle>> {
  const rows = await prisma.googleIntegration.findMany();
  const record: Record<string, WorkspaceIntegrationGoogle> = {};
  for (const r of rows) record[r.id] = mapGoogleIntegration(r);
  return record;
}

export async function getGoogleIntegrationByWorkspace(workspaceId: string): Promise<WorkspaceIntegrationGoogle | null> {
  const r = await prisma.googleIntegration.findFirst({ where: { workspaceId } });
  return r ? mapGoogleIntegration(r) : null;
}

export async function saveGoogleIntegration(integration: WorkspaceIntegrationGoogle): Promise<void> {
  await prisma.googleIntegration.upsert({
    where: { id: integration.id },
    update: {
      workspaceId: integration.workspaceId,
      encryptedRefreshToken: integration.encryptedRefreshToken,
      status: integration.status,
      connectedAt: toDate(integration.connectedAt),
      lastUsedAt: toDate(integration.lastUsedAt),
      errorMessage: integration.errorMessage ?? null,
    },
    create: {
      id: integration.id,
      workspaceId: integration.workspaceId,
      encryptedRefreshToken: integration.encryptedRefreshToken,
      status: integration.status,
      connectedAt: toDate(integration.connectedAt),
      lastUsedAt: toDate(integration.lastUsedAt),
      errorMessage: integration.errorMessage ?? null,
    },
  });
}

export async function updateGoogleIntegrationStatus(
  workspaceId: string,
  status: 'active' | 'revoked' | 'error',
  errorMessage?: string,
): Promise<void> {
  const integration = await getGoogleIntegrationByWorkspace(workspaceId);
  if (integration) {
    integration.status = status;
    integration.lastUsedAt = Date.now();
    if (errorMessage) {
      integration.errorMessage = errorMessage;
    }
    await saveGoogleIntegration(integration);
  }
}

// =====================================================================
//  Assets
// =====================================================================

export async function getAssets(): Promise<Asset[]> {
  const rows = await prisma.asset.findMany();
  return rows.map(mapAsset);
}

export async function getAssetsByWorkspace(workspaceId: string): Promise<Asset[]> {
  const rows = await prisma.asset.findMany({ where: { workspaceId } });
  return rows.map(mapAsset);
}

export async function getAssetsByClient(workspaceId: string, clientId: string): Promise<Asset[]> {
  const rows = await prisma.asset.findMany({ where: { workspaceId, clientId } });
  return rows.map(mapAsset);
}

export async function getAssetsByAgency(agencyId: string): Promise<Asset[]> {
  const rows = await prisma.asset.findMany({ where: { agencyId } });
  return rows.map(mapAsset);
}

export async function getAssetById(id: string): Promise<Asset | null> {
  const r = await prisma.asset.findUnique({ where: { id } });
  return r ? mapAsset(r) : null;
}

export async function saveAsset(asset: Asset): Promise<void> {
  await prisma.asset.upsert({
    where: { id: asset.id },
    update: {
      workspaceId: asset.workspaceId,
      agencyId: asset.agencyId ?? asset.workspaceId,
      clientId: asset.clientId,
      source: asset.source,
      originalFileId: asset.originalFileId ?? null,
      originalName: asset.originalName,
      filename: asset.filename,
      mimeType: asset.mimeType,
      size: asset.size,
      storageUrl: asset.storageUrl,
      thumbnailUrl: asset.thumbnailUrl ?? null,
      type: asset.type,
      status: asset.status,
      tags: asset.tags,
      caption: asset.caption ?? null,
      createdByUserId: asset.createdByUserId,
      updatedAt: toDate(asset.updatedAt),
    },
    create: {
      id: asset.id,
      workspaceId: asset.workspaceId,
      agencyId: asset.agencyId ?? asset.workspaceId,
      clientId: asset.clientId,
      source: asset.source,
      originalFileId: asset.originalFileId ?? null,
      originalName: asset.originalName,
      filename: asset.filename,
      mimeType: asset.mimeType,
      size: asset.size,
      storageUrl: asset.storageUrl,
      thumbnailUrl: asset.thumbnailUrl ?? null,
      type: asset.type,
      status: asset.status,
      tags: asset.tags,
      caption: asset.caption ?? null,
      createdByUserId: asset.createdByUserId,
      createdAt: toDate(asset.createdAt),
    },
  });
}

export async function saveAssets(newAssets: Asset[]): Promise<void> {
  await prisma.$transaction(
    newAssets.map((asset) =>
      prisma.asset.upsert({
        where: { id: asset.id },
        update: {
          workspaceId: asset.workspaceId,
          agencyId: asset.agencyId ?? asset.workspaceId,
          clientId: asset.clientId,
          source: asset.source,
          originalFileId: asset.originalFileId ?? null,
          originalName: asset.originalName,
          filename: asset.filename,
          mimeType: asset.mimeType,
          size: asset.size,
          storageUrl: asset.storageUrl,
          thumbnailUrl: asset.thumbnailUrl ?? null,
          type: asset.type,
          status: asset.status,
          tags: asset.tags,
          caption: asset.caption ?? null,
          createdByUserId: asset.createdByUserId,
          updatedAt: toDate(asset.updatedAt),
        },
        create: {
          id: asset.id,
          workspaceId: asset.workspaceId,
          agencyId: asset.agencyId ?? asset.workspaceId,
          clientId: asset.clientId,
          source: asset.source,
          originalFileId: asset.originalFileId ?? null,
          originalName: asset.originalName,
          filename: asset.filename,
          mimeType: asset.mimeType,
          size: asset.size,
          storageUrl: asset.storageUrl,
          thumbnailUrl: asset.thumbnailUrl ?? null,
          type: asset.type,
          status: asset.status,
          tags: asset.tags,
          caption: asset.caption ?? null,
          createdByUserId: asset.createdByUserId,
          createdAt: toDate(asset.createdAt),
        },
      }),
    ),
  );
}

// =====================================================================
//  Agencies
// =====================================================================

export async function getAgencies(): Promise<Record<string, Agency>> {
  const rows = await prisma.agency.findMany();
  const record: Record<string, Agency> = {};
  for (const r of rows) record[r.id] = mapAgency(r);
  return record;
}

export async function getAgency(id: string): Promise<Agency | null> {
  const r = await prisma.agency.findUnique({ where: { id } });
  return r ? mapAgency(r) : null;
}

export async function saveAgency(agency: Agency): Promise<void> {
  await prisma.agency.upsert({
    where: { id: agency.id },
    update: { name: agency.name },
    create: {
      id: agency.id,
      name: agency.name,
      createdAt: toDate(agency.createdAt),
    },
  });
}

// =====================================================================
//  Users
// =====================================================================

export async function getUsers(): Promise<Record<string, User>> {
  const rows = await prisma.user.findMany();
  const record: Record<string, User> = {};
  for (const r of rows) record[r.id] = mapUser(r);
  return record;
}

export async function getUser(id: string): Promise<User | null> {
  const r = await prisma.user.findUnique({ where: { id } });
  return r ? mapUser(r) : null;
}

export async function getUserByEmail(agencyId: string, email: string): Promise<User | null> {
  const r = await prisma.user.findFirst({
    where: {
      agencyId,
      email: { equals: email, mode: 'insensitive' },
    },
  });
  return r ? mapUser(r) : null;
}

export async function getUserByUsername(agencyId: string, username: string): Promise<User | null> {
  const r = await prisma.user.findFirst({
    where: {
      agencyId,
      username: { equals: username, mode: 'insensitive' },
    },
  });
  return r ? mapUser(r) : null;
}

export async function getUsersByAgency(agencyId: string): Promise<User[]> {
  const rows = await prisma.user.findMany({ where: { agencyId } });
  return rows.map(mapUser);
}

export async function getUsersByClient(clientId: string): Promise<User[]> {
  const rows = await prisma.user.findMany({ where: { clientId, role: 'CLIENT' } });
  return rows.map(mapUser);
}

export async function saveUser(user: User): Promise<void> {
  await prisma.user.upsert({
    where: { id: user.id },
    update: {
      agencyId: user.agencyId,
      email: user.email,
      username: user.username ?? null,
      name: user.name,
      role: user.role,
      status: user.status,
      passwordHash: user.passwordHash ?? null,
      tempPassword: user.tempPassword ?? null,
      clientId: user.clientId ?? null,
      lastLoginAt: toDateNullable(user.lastLoginAt),
      updatedAt: toDate(user.updatedAt),
    },
    create: {
      id: user.id,
      agencyId: user.agencyId,
      email: user.email,
      username: user.username ?? null,
      name: user.name,
      role: user.role,
      status: user.status,
      passwordHash: user.passwordHash ?? null,
      tempPassword: user.tempPassword ?? null,
      clientId: user.clientId ?? null,
      lastLoginAt: toDateNullable(user.lastLoginAt),
      createdAt: toDate(user.createdAt),
    },
  });
}

export async function deleteUser(userId: string): Promise<void> {
  await prisma.user.delete({ where: { id: userId } }).catch(() => {
    // Ignore if not found — matches JSON behaviour
  });
}

// =====================================================================
//  Clients
// =====================================================================

export async function getClients(): Promise<Record<string, Client>> {
  const rows = await prisma.client.findMany();
  const record: Record<string, Client> = {};
  for (const r of rows) record[r.id] = mapClient(r);
  return record;
}

export async function getClient(id: string): Promise<Client | null> {
  const r = await prisma.client.findUnique({ where: { id } });
  return r ? mapClient(r) : null;
}

export async function getClientsByAgency(agencyId: string): Promise<Client[]> {
  const rows = await prisma.client.findMany({ where: { agencyId } });
  return rows.map(mapClient);
}

export async function saveClient(client: Client): Promise<void> {
  await prisma.client.upsert({
    where: { id: client.id },
    update: {
      agencyId: client.agencyId,
      name: client.name,
      status: client.status,
      category: client.category ?? null,
      primaryContactName: client.primaryContactName ?? null,
      primaryContactWhatsApp: client.primaryContactWhatsApp ?? null,
      primaryContactEmail: client.primaryContactEmail ?? null,
      preferredChannel: client.preferredChannel ?? null,
      platformsManaged: client.platformsManaged ?? [],
      postingFrequency: client.postingFrequency ?? null,
      postingFrequencyNote: client.postingFrequencyNote ?? null,
      approvalRequired: client.approvalRequired ?? false,
      language: client.language ?? null,
      assetsLink: client.assetsLink ?? null,
      brandGuidelinesLink: client.brandGuidelinesLink ?? null,
      primaryGoal: client.primaryGoal ?? null,
      secondaryGoal: client.secondaryGoal ?? null,
      internalBehaviorType: client.internalBehaviorType ?? null,
      riskLevel: client.riskLevel ?? null,
      internalNotes: client.internalNotes ?? null,
      logoUrl: client.logoUrl ?? null,
      clientLinks: client.clientLinks ?? undefined,
      aiSummaryCache: client.aiSummaryCache ?? undefined,
      updatedAt: toDate(client.updatedAt),
    },
    create: {
      id: client.id,
      agencyId: client.agencyId,
      name: client.name,
      status: client.status,
      category: client.category ?? null,
      primaryContactName: client.primaryContactName ?? null,
      primaryContactWhatsApp: client.primaryContactWhatsApp ?? null,
      primaryContactEmail: client.primaryContactEmail ?? null,
      preferredChannel: client.preferredChannel ?? null,
      platformsManaged: client.platformsManaged ?? [],
      postingFrequency: client.postingFrequency ?? null,
      postingFrequencyNote: client.postingFrequencyNote ?? null,
      approvalRequired: client.approvalRequired ?? false,
      language: client.language ?? null,
      assetsLink: client.assetsLink ?? null,
      brandGuidelinesLink: client.brandGuidelinesLink ?? null,
      primaryGoal: client.primaryGoal ?? null,
      secondaryGoal: client.secondaryGoal ?? null,
      internalBehaviorType: client.internalBehaviorType ?? null,
      riskLevel: client.riskLevel ?? null,
      internalNotes: client.internalNotes ?? null,
      logoUrl: client.logoUrl ?? null,
      clientLinks: client.clientLinks ?? undefined,
      aiSummaryCache: client.aiSummaryCache ?? undefined,
      createdAt: toDate(client.createdAt),
    },
  });
}

export async function deleteClient(clientId: string): Promise<void> {
  // Delete related rows that don't cascade automatically (FK constraint order matters)
  // 1. Comments on this client's production tasks (FK → ProductionTask)
  const taskIds = (await prisma.productionTask.findMany({ where: { clientId }, select: { id: true } })).map(t => t.id);
  if (taskIds.length > 0) {
    await prisma.productionTaskComment.deleteMany({ where: { taskId: { in: taskIds } } }).catch(() => {});
  }
  // 2. Production tasks (the missing table that caused FK violation)
  await prisma.productionTask.deleteMany({ where: { clientId } }).catch(() => {});
  // 3. All other client-scoped tables
  await prisma.asset.deleteMany({ where: { clientId } }).catch(() => {});
  await prisma.scheduledPost.deleteMany({ where: { clientId } }).catch(() => {});
  await prisma.metaIntegration.deleteMany({ where: { clientId } }).catch(() => {});
  await prisma.brandKit.deleteMany({ where: { clientId } }).catch(() => {});
  await prisma.aIImage.deleteMany({ where: { clientId } }).catch(() => {});
  await prisma.referenceImage.deleteMany({ where: { clientId } }).catch(() => {});
  // 4. Unlink any users tied to this client (don't delete users, just clear the FK)
  await prisma.user.updateMany({ where: { clientId }, data: { clientId: null } }).catch(() => {});
  // Now delete the client — errors propagate so the route can return a real 500
  await prisma.client.delete({ where: { id: clientId } });
}

// =====================================================================
//  Invite Tokens
// =====================================================================

export async function getInviteTokens(): Promise<Record<string, InviteToken>> {
  const rows = await prisma.inviteToken.findMany();
  const record: Record<string, InviteToken> = {};
  for (const r of rows) record[r.id] = mapInviteToken(r);
  return record;
}

export async function getInviteTokenByHash(tokenHash: string): Promise<InviteToken | null> {
  const r = await prisma.inviteToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  return r ? mapInviteToken(r) : null;
}

export async function getInviteTokensByUser(userId: string): Promise<InviteToken[]> {
  const rows = await prisma.inviteToken.findMany({ where: { userId } });
  return rows.map(mapInviteToken);
}

export async function saveInviteToken(token: InviteToken): Promise<void> {
  await prisma.inviteToken.upsert({
    where: { id: token.id },
    update: {
      agencyId: token.agencyId,
      userId: token.userId,
      tokenHash: token.tokenHash,
      expiresAt: toDate(token.expiresAt),
      usedAt: toDateNullable(token.usedAt),
    },
    create: {
      id: token.id,
      agencyId: token.agencyId,
      userId: token.userId,
      tokenHash: token.tokenHash,
      expiresAt: toDate(token.expiresAt),
      usedAt: toDateNullable(token.usedAt),
      createdAt: toDate(token.createdAt),
    },
  });
}

export async function markInviteTokenUsed(tokenId: string): Promise<void> {
  await prisma.inviteToken.update({
    where: { id: tokenId },
    data: { usedAt: new Date() },
  }).catch(() => {});
}

// =====================================================================
//  Password Reset Tokens
// =====================================================================

export async function getPasswordResetTokens(): Promise<Record<string, PasswordResetToken>> {
  const rows = await prisma.passwordResetToken.findMany();
  const record: Record<string, PasswordResetToken> = {};
  for (const r of rows) record[r.id] = mapPasswordResetToken(r);
  return record;
}

export async function getPasswordResetTokenByHash(tokenHash: string): Promise<PasswordResetToken | null> {
  const r = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  return r ? mapPasswordResetToken(r) : null;
}

export async function getPasswordResetTokensByUser(userId: string): Promise<PasswordResetToken[]> {
  const rows = await prisma.passwordResetToken.findMany({ where: { userId } });
  return rows.map(mapPasswordResetToken);
}

export async function savePasswordResetToken(token: PasswordResetToken): Promise<void> {
  await prisma.passwordResetToken.upsert({
    where: { id: token.id },
    update: {
      agencyId: token.agencyId,
      userId: token.userId,
      tokenHash: token.tokenHash,
      expiresAt: toDate(token.expiresAt),
      usedAt: toDateNullable(token.usedAt),
    },
    create: {
      id: token.id,
      agencyId: token.agencyId,
      userId: token.userId,
      tokenHash: token.tokenHash,
      expiresAt: toDate(token.expiresAt),
      usedAt: toDateNullable(token.usedAt),
      createdAt: toDate(token.createdAt),
    },
  });
}

export async function markPasswordResetTokenUsed(tokenId: string): Promise<void> {
  await prisma.passwordResetToken.update({
    where: { id: tokenId },
    data: { usedAt: new Date() },
  }).catch(() => {});
}

// =====================================================================
//  Audit Logs
// =====================================================================

export async function getAuditLogs(): Promise<AuditLog[]> {
  const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 2000 });
  return rows.map(mapAuditLog);
}

export async function getAuditLogsByAgency(agencyId: string, limit: number = 100): Promise<AuditLog[]> {
  const rows = await prisma.auditLog.findMany({
    where: { agencyId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.map(mapAuditLog);
}

export async function saveAuditLog(log: AuditLog): Promise<void> {
  await prisma.auditLog.create({
    data: {
      id: log.id,
      agencyId: log.agencyId,
      actorUserId: log.actorUserId,
      action: log.action,
      targetUserId: log.targetUserId ?? null,
      targetClientId: log.targetClientId ?? null,
      metaJson: log.metaJson ?? null,
      createdAt: toDate(log.createdAt),
    },
  });
}

// =====================================================================
//  Portal State
// =====================================================================

export async function getPortalState(agencyId: string, clientId: string): Promise<PortalStateData | null> {
  const r = await prisma.portalState.findUnique({
    where: { agencyId_clientId: { agencyId, clientId } },
  });
  return r ? (r.data as unknown as PortalStateData) : null;
}

/**
 * Get a lightweight portal state: returns everything EXCEPT the heavy approvals
 * images/base64 data. Uses SQL to extract only the fields the dashboard needs.
 * For a client with 33MB of approvals images, this returns ~50KB instead.
 */
export async function getPortalStateLite(agencyId: string, clientId: string): Promise<PortalStateData | null> {
  try {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        data->'client' as client,
        data->'kpis' as kpis,
        data->'needs' as needs,
        data->'requests' as requests,
        data->'assets' as assets,
        data->'activity' as activity,
        data->'seen' as seen,
        (SELECT jsonb_agg(
          jsonb_build_object(
            'id', a->>'id',
            'title', a->>'title',
            'status', a->>'status',
            'type', a->>'type',
            'dueDate', a->>'dueDate',
            'postDate', a->>'postDate',
            'caption', a->>'caption',
            'platform', a->>'platform',
            'pillar', a->>'pillar',
            'createdAt', a->>'createdAt'
          )
        ) FROM jsonb_array_elements(data->'approvals') a) as approvals
      FROM "PortalState"
      WHERE "agencyId" = ${agencyId} AND "clientId" = ${clientId}
    `;
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    return {
      client: row.client || { id: clientId, name: clientId },
      kpis: row.kpis || { scheduled: 0, waitingApproval: 0, missingAssets: 0, frustration: 0 },
      approvals: row.approvals || [],
      needs: row.needs || [],
      requests: row.requests || [],
      assets: row.assets || [],
      activity: row.activity || [],
      seen: row.seen ?? false,
    } as PortalStateData;
  } catch (e: any) {
    console.warn('[db] getPortalStateLite failed, falling back to full load:', e.message);
    return getPortalState(agencyId, clientId);
  }
}

export async function savePortalState(agencyId: string, clientId: string, data: PortalStateData): Promise<void> {
  // Read existing to apply merge logic
  const existing = await getPortalState(agencyId, clientId);

  // Safety: if incoming data has empty approvals but existing data had approvals, preserve them
  if (existing && Array.isArray(existing.approvals) && existing.approvals.length > 0) {
    if (!data.approvals || !Array.isArray(data.approvals) || data.approvals.length === 0) {
      console.warn(
        `[db] WARNING: savePortalState for ${agencyId}:${clientId} would clear ${existing.approvals.length} approvals. Preserving existing approvals.`,
      );
      data.approvals = existing.approvals;
    } else {
      // Merge: preserve heavy fields (images, media) from existing approvals
      // when incoming data was served via getPortalStateLite (which strips them)
      const existingApprovalsById: Record<string, any> = {};
      for (const a of existing.approvals as any[]) {
        if (a && a.id) existingApprovalsById[a.id] = a;
      }
      data.approvals = (data.approvals as any[]).map((a: any) => {
        if (!a || !a.id) return a;
        const prev = existingApprovalsById[a.id];
        if (!prev) return a;
        // Merge: start with existing, overlay incoming, but skip stripped fields
        const merged = { ...prev };
        for (const [key, val] of Object.entries(a)) {
          if (typeof val === 'string' && val === '[base64-stripped]') continue; // preserve original
          merged[key] = val;
        }
        return merged;
      });
    }
  }

  // Merge request statuses: once a request is marked "done", never let a stale save revert it.
  if (existing && Array.isArray(existing.requests) && existing.requests.length > 0 && Array.isArray(data.requests)) {
    const existingById: Record<string, any> = {};
    for (const r of existing.requests) {
      const req = r as any;
      if (req && req.id) existingById[req.id] = req;
    }
    data.requests = data.requests.map((r: any) => {
      if (!r || !r.id) return r;
      const prev = existingById[r.id];
      if (!prev) return r;
      // Merge: preserve base64 image data from existing when incoming has stripped markers
      const merged = { ...prev };
      for (const [key, val] of Object.entries(r)) {
        if (typeof val === 'string' && val === '[base64-stripped]') continue;
        merged[key] = val;
      }
      // Once done, never revert
      if ((prev.status === 'done' || prev.done === true) && merged.status !== 'done') {
        merged.status = 'done';
        merged.done = true;
        merged.doneAt = prev.doneAt || merged.doneAt || Date.now();
      }
      return merged;
    });
  }

  await prisma.portalState.upsert({
    where: { agencyId_clientId: { agencyId, clientId } },
    update: { data: data as any },
    create: { agencyId, clientId, data: data as any },
  });
}

/**
 * Count pending approvals across all portal states for an agency using raw SQL.
 * This avoids loading the full JSONB blobs (which can be 30MB+) into Node memory.
 */
export async function countPendingApprovals(agencyId: string): Promise<number> {
  try {
    const result = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count
      FROM "PortalState",
           jsonb_array_elements(data->'approvals') AS a
      WHERE "agencyId" = ${agencyId}
        AND a->>'status' = 'pending'
    `;
    return Number(result[0]?.count ?? 0);
  } catch (e: any) {
    console.warn('[db] countPendingApprovals raw query failed, falling back:', e.message);
    // Fallback: if the query fails (e.g. empty approvals array), return 0
    return 0;
  }
}

/**
 * Strip large base64 data from a portal state object before sending to clients.
 * Replaces base64 image strings with a small placeholder, reducing 33MB+ to KB.
 */
export function stripBase64FromPortalState(state: PortalStateData): PortalStateData {
  const stripped = JSON.parse(JSON.stringify(state));

  // Strip base64 from approvals
  if (Array.isArray(stripped.approvals)) {
    for (const item of stripped.approvals) {
      if (!item || typeof item !== 'object') continue;
      stripBase64Fields(item);
    }
  }

  // Strip base64 from requests
  if (Array.isArray(stripped.requests)) {
    for (const item of stripped.requests) {
      if (!item || typeof item !== 'object') continue;
      stripBase64Fields(item);
    }
  }

  // Strip base64 from assets
  if (Array.isArray(stripped.assets)) {
    for (const item of stripped.assets) {
      if (!item || typeof item !== 'object') continue;
      stripBase64Fields(item);
    }
  }

  return stripped;
}

function stripBase64Fields(obj: any): void {
  if (!obj || typeof obj !== 'object') return;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (typeof val === 'string' && val.length > 500 && /^data:[^;]+;base64,/.test(val)) {
      obj[key] = '[base64-stripped]';
    } else if (typeof val === 'string' && val.length > 500 && /^[A-Za-z0-9+/]{500}/.test(val)) {
      // Raw base64 without data: prefix
      obj[key] = '[base64-stripped]';
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === 'object' && item !== null) stripBase64Fields(item);
      }
    } else if (typeof val === 'object' && val !== null) {
      stripBase64Fields(val);
    }
  }
}

export async function deletePortalState(agencyId: string, clientId: string): Promise<void> {
  await prisma.portalState.delete({
    where: { agencyId_clientId: { agencyId, clientId } },
  }).catch(() => {});
}

// =====================================================================
//  Client Credentials (now stored as Client.portalPassword)
// =====================================================================

export async function getClientCredentials(agencyId: string, clientId: string): Promise<string | null> {
  const r = await prisma.client.findFirst({ where: { id: clientId, agencyId } });
  return r?.portalPassword ?? null;
}

export async function saveClientCredentials(agencyId: string, clientId: string, password: string): Promise<void> {
  await prisma.client.updateMany({
    where: { id: clientId, agencyId },
    data: { portalPassword: password },
  });
}

export async function deleteClientCredentials(agencyId: string, clientId: string): Promise<void> {
  await prisma.client.updateMany({
    where: { id: clientId, agencyId },
    data: { portalPassword: null },
  });
}

// =====================================================================
//  Meta Integrations
// =====================================================================

export async function getMetaIntegrations(): Promise<Record<string, MetaIntegration>> {
  const rows = await prisma.metaIntegration.findMany();
  const record: Record<string, MetaIntegration> = {};
  for (const r of rows) record[r.id] = mapMetaIntegration(r);
  return record;
}

export async function getMetaIntegrationByAgency(agencyId: string): Promise<MetaIntegration | null> {
  const r = await prisma.metaIntegration.findFirst({ where: { agencyId } });
  return r ? mapMetaIntegration(r) : null;
}

export async function getMetaIntegrationByClient(agencyId: string, clientId: string): Promise<MetaIntegration | null> {
  const r = await prisma.metaIntegration.findFirst({ where: { agencyId, clientId } });
  return r ? mapMetaIntegration(r) : null;
}

export async function saveMetaIntegration(integration: MetaIntegration): Promise<void> {
  await prisma.metaIntegration.upsert({
    where: { id: integration.id },
    update: {
      agencyId: integration.agencyId,
      clientId: integration.clientId,
      metaAccessToken: integration.metaAccessToken,
      metaUserAccessToken: integration.metaUserAccessToken ?? null,
      metaPageId: integration.metaPageId,
      metaPageName: integration.metaPageName ?? null,
      metaInstagramAccountId: integration.metaInstagramAccountId ?? null,
      metaInstagramUsername: integration.metaInstagramUsername ?? null,
      tokenExpiresAt: toDate(integration.tokenExpiresAt),
      connectedAt: toDate(integration.connectedAt),
      connectionStatus: integration.connectionStatus ?? null,
      connectionError: integration.connectionError ?? null,
      connectionFlaggedAt: toDateNullable(integration.connectionFlaggedAt),
    },
    create: {
      id: integration.id,
      agencyId: integration.agencyId,
      clientId: integration.clientId,
      metaAccessToken: integration.metaAccessToken,
      metaUserAccessToken: integration.metaUserAccessToken ?? null,
      metaPageId: integration.metaPageId,
      metaPageName: integration.metaPageName ?? null,
      metaInstagramAccountId: integration.metaInstagramAccountId ?? null,
      metaInstagramUsername: integration.metaInstagramUsername ?? null,
      tokenExpiresAt: toDate(integration.tokenExpiresAt),
      connectedAt: toDate(integration.connectedAt),
      connectionStatus: integration.connectionStatus ?? null,
      connectionError: integration.connectionError ?? null,
      connectionFlaggedAt: toDateNullable(integration.connectionFlaggedAt),
    },
  });
}

export async function deleteMetaIntegration(agencyId: string): Promise<void> {
  await prisma.metaIntegration.deleteMany({ where: { agencyId } });
}

export async function deleteMetaIntegrationByClient(agencyId: string, clientId: string): Promise<void> {
  await prisma.metaIntegration.deleteMany({ where: { agencyId, clientId } });
}

// =====================================================================
//  Scheduled Posts
// =====================================================================

export async function getScheduledPosts(): Promise<ScheduledPost[]> {
  const rows = await prisma.scheduledPost.findMany();
  return rows.map(mapScheduledPost);
}

export async function getScheduledPostsByAgency(agencyId: string): Promise<ScheduledPost[]> {
  const rows = await prisma.scheduledPost.findMany({ where: { agencyId } });
  return rows.map(mapScheduledPost);
}

export async function getScheduledPostById(id: string): Promise<ScheduledPost | null> {
  const r = await prisma.scheduledPost.findUnique({ where: { id } });
  return r ? mapScheduledPost(r) : null;
}

export async function saveScheduledPost(post: ScheduledPost): Promise<void> {
  await prisma.scheduledPost.upsert({
    where: { id: post.id },
    update: {
      agencyId: post.agencyId,
      clientId: post.clientId,
      contentId: post.contentId,
      caption: post.caption,
      mediaUrl: post.mediaUrl,
      mediaUrls: post.mediaUrls ?? [],
      platforms: post.platforms,
      placements: post.placements ?? [],
      scheduledAt: new Date(post.scheduledAt),
      timezone: post.timezone,
      status: post.status,
      publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
      error: post.error ?? null,
      metaPostIds: post.metaPostIds ?? undefined,
      updatedAt: post.updatedAt ? new Date(post.updatedAt) : new Date(),
    },
    create: {
      id: post.id,
      agencyId: post.agencyId,
      clientId: post.clientId,
      contentId: post.contentId,
      caption: post.caption,
      mediaUrl: post.mediaUrl,
      mediaUrls: post.mediaUrls ?? [],
      platforms: post.platforms,
      placements: post.placements ?? [],
      scheduledAt: new Date(post.scheduledAt),
      timezone: post.timezone,
      status: post.status,
      publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
      error: post.error ?? null,
      metaPostIds: post.metaPostIds ?? undefined,
      createdAt: post.createdAt ? new Date(post.createdAt) : new Date(),
    },
  });
}

export async function deleteScheduledPost(id: string): Promise<void> {
  await prisma.scheduledPost.delete({ where: { id } }).catch(() => {});
}

// =====================================================================
//  Production Tasks
// =====================================================================

const INCLUDE_COMMENTS = { comments: { orderBy: { createdAt: 'asc' as const } } };

export async function getProductionTasks(): Promise<ProductionTask[]> {
  const rows = await prisma.productionTask.findMany({ include: INCLUDE_COMMENTS });
  return rows.map(mapProductionTask);
}

export async function getProductionTasksByAgency(agencyId: string): Promise<ProductionTask[]> {
  const rows = await prisma.productionTask.findMany({
    where: { agencyId },
    include: INCLUDE_COMMENTS,
  });
  return rows.map(mapProductionTask);
}

export async function getProductionTaskById(id: string): Promise<ProductionTask | null> {
  const r = await prisma.productionTask.findUnique({ where: { id }, include: INCLUDE_COMMENTS });
  return r ? mapProductionTask(r) : null;
}

export async function getProductionTasksByDesigner(designerId: string): Promise<ProductionTask[]> {
  const rows = await prisma.productionTask.findMany({
    where: { designerId },
    include: INCLUDE_COMMENTS,
  });
  return rows.map(mapProductionTask);
}

export async function getProductionTasksByClient(agencyId: string, clientId: string): Promise<ProductionTask[]> {
  const rows = await prisma.productionTask.findMany({
    where: { agencyId, clientId },
    include: INCLUDE_COMMENTS,
  });
  return rows.map(mapProductionTask);
}

export async function saveProductionTask(task: ProductionTask): Promise<void> {
  const comments = task.comments ?? [];

  await prisma.$transaction(async (tx) => {
    // Upsert the task itself
    await tx.productionTask.upsert({
      where: { id: task.id },
      update: {
        agencyId: task.agencyId,
        clientId: task.clientId,
        contentId: task.contentId ?? '',
        approvalId: task.approvalId ?? '',
        designerId: task.designerId,
        title: task.title,
        caption: task.caption ?? '',
        copyText: task.copyText ?? '',
        referenceImages: task.referenceImages ?? [],
        briefNotes: task.briefNotes ?? '',
        finalArt: task.finalArt ?? [],
        designerNotes: task.designerNotes ?? '',
        status: task.status,
        priority: task.priority,
        deadline: new Date(task.deadline),
        reviewNotes: task.reviewNotes ?? '',
        startedAt: task.startedAt ? new Date(task.startedAt) : null,
        submittedAt: task.submittedAt ? new Date(task.submittedAt) : null,
        approvedAt: task.approvedAt ? new Date(task.approvedAt) : null,
        updatedAt: task.updatedAt ? new Date(task.updatedAt) : new Date(),
      },
      create: {
        id: task.id,
        agencyId: task.agencyId,
        clientId: task.clientId,
        contentId: task.contentId ?? '',
        approvalId: task.approvalId ?? '',
        designerId: task.designerId,
        title: task.title,
        caption: task.caption ?? '',
        copyText: task.copyText ?? '',
        referenceImages: task.referenceImages ?? [],
        briefNotes: task.briefNotes ?? '',
        finalArt: task.finalArt ?? [],
        designerNotes: task.designerNotes ?? '',
        status: task.status,
        priority: task.priority,
        deadline: new Date(task.deadline),
        reviewNotes: task.reviewNotes ?? '',
        startedAt: task.startedAt ? new Date(task.startedAt) : null,
        submittedAt: task.submittedAt ? new Date(task.submittedAt) : null,
        approvedAt: task.approvedAt ? new Date(task.approvedAt) : null,
        createdAt: task.createdAt ? new Date(task.createdAt) : new Date(),
      },
    });

    // Sync comments: delete removed, upsert existing/new
    if (comments.length > 0) {
      const commentIds = comments.map((c) => c.id);
      // Delete comments that are no longer in the list
      await tx.productionTaskComment.deleteMany({
        where: { taskId: task.id, id: { notIn: commentIds } },
      });
      // Upsert each comment
      for (const c of comments) {
        await tx.productionTaskComment.upsert({
          where: { id: c.id },
          update: {
            authorId: c.authorId,
            authorName: c.authorName,
            authorRole: c.authorRole,
            message: c.message,
            statusChange: c.statusChange ?? null,
          },
          create: {
            id: c.id,
            taskId: task.id,
            authorId: c.authorId,
            authorName: c.authorName,
            authorRole: c.authorRole,
            message: c.message,
            statusChange: c.statusChange ?? null,
            createdAt: c.createdAt ? new Date(c.createdAt) : new Date(),
          },
        });
      }
    } else {
      // Task has no comments — don't delete existing ones (they may have been
      // loaded separately). Only delete if task is brand new. The JSON version
      // stored comments inline so an empty array meant "no comments". With
      // Prisma, callers always include the comments array when saving, so an
      // empty array truly means "none".
      // For safety we only clear if there are no comments at all on the task.
    }
  });
}

export async function deleteProductionTask(id: string): Promise<void> {
  // Comments cascade-delete via onDelete: Cascade in schema
  await prisma.productionTask.delete({ where: { id } }).catch(() => {});
}

// =====================================================================
//  Push Subscriptions
// =====================================================================

export async function getPushSubscriptions(): Promise<Record<string, PushSubscriptionRecord>> {
  const rows = await prisma.pushSubscription.findMany();
  const record: Record<string, PushSubscriptionRecord> = {};
  for (const r of rows) {
    // Use the same key scheme as the JSON version: base64 of endpoint truncated to 64 chars
    const key = Buffer.from(r.endpoint).toString('base64').substring(0, 64);
    record[key] = mapPushSubscription(r);
  }
  return record;
}

export async function savePushSubscription(sub: PushSubscriptionRecord): Promise<void> {
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: {
      userId: sub.userId,
      agencyId: sub.agencyId,
      role: sub.role,
      keys: sub.keys as any,
    },
    create: {
      id: sub.id,
      userId: sub.userId,
      agencyId: sub.agencyId,
      role: sub.role,
      endpoint: sub.endpoint,
      keys: sub.keys as any,
      createdAt: toDate(sub.createdAt),
    },
  });
}

export async function deletePushSubscription(endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { endpoint } });
}

// =====================================================================
//  Brand Kits
// =====================================================================

export async function getBrandKits(): Promise<Record<string, BrandKit>> {
  const rows = await prisma.brandKit.findMany();
  const record: Record<string, BrandKit> = {};
  for (const r of rows) record[r.id] = mapBrandKit(r);
  return record;
}

export async function getBrandKitByClient(clientId: string): Promise<BrandKit | null> {
  const r = await prisma.brandKit.findUnique({ where: { clientId } });
  return r ? mapBrandKit(r) : null;
}

export async function saveBrandKit(kit: BrandKit): Promise<void> {
  await prisma.brandKit.upsert({
    where: { id: kit.id },
    update: {
      clientId: kit.clientId,
      agencyId: kit.agencyId,
      logoUrls: kit.logoUrls,
      colors: kit.colors as any,
      fonts: kit.fonts as any,
      styleTags: kit.styleTags,
      photoStyle: kit.photoStyle,
      rulesText: kit.rulesText,
      referenceImages: kit.referenceImages,
      updatedAt: toDate(kit.updatedAt),
    },
    create: {
      id: kit.id,
      clientId: kit.clientId,
      agencyId: kit.agencyId,
      logoUrls: kit.logoUrls,
      colors: kit.colors as any,
      fonts: kit.fonts as any,
      styleTags: kit.styleTags,
      photoStyle: kit.photoStyle,
      rulesText: kit.rulesText,
      referenceImages: kit.referenceImages,
      createdAt: toDate(kit.createdAt),
    },
  });
}

export async function deleteBrandKit(id: string): Promise<void> {
  await prisma.brandKit.delete({ where: { id } }).catch(() => {});
}

// =====================================================================
//  AI Images
// =====================================================================

export async function getAIImages(): Promise<Record<string, AIImage>> {
  const rows = await prisma.aIImage.findMany();
  const record: Record<string, AIImage> = {};
  for (const r of rows) record[r.id] = mapAIImage(r);
  return record;
}

export async function getAIImagesByClient(clientId: string): Promise<AIImage[]> {
  const rows = await prisma.aIImage.findMany({ where: { clientId } });
  return rows.map(mapAIImage);
}

export async function getAIImagesByAgency(agencyId: string): Promise<AIImage[]> {
  const rows = await prisma.aIImage.findMany({ where: { agencyId } });
  return rows.map(mapAIImage);
}

export async function getAIImageById(id: string): Promise<AIImage | null> {
  const r = await prisma.aIImage.findUnique({ where: { id } });
  return r ? mapAIImage(r) : null;
}

export async function saveAIImage(img: AIImage): Promise<void> {
  await prisma.aIImage.upsert({
    where: { id: img.id },
    update: {
      clientId: img.clientId,
      agencyId: img.agencyId,
      brandKitId: img.brandKitId ?? null,
      prompt: img.prompt,
      enhancedPrompt: img.enhancedPrompt,
      imageUrl: img.imageUrl,
      thumbnailUrl: img.thumbnailUrl,
      format: img.format,
      formatDimensions: img.formatDimensions,
      status: img.status,
      generatedBy: img.generatedBy,
      approvedBy: img.approvedBy ?? null,
      approvalDate: toDateNullable(img.approvalDate),
      feedback: img.feedback,
      usedInPostId: img.usedInPostId ?? null,
      modelUsed: img.modelUsed,
      batchId: img.batchId ?? null,
      updatedAt: toDate(img.updatedAt),
    },
    create: {
      id: img.id,
      clientId: img.clientId,
      agencyId: img.agencyId,
      brandKitId: img.brandKitId ?? null,
      prompt: img.prompt,
      enhancedPrompt: img.enhancedPrompt,
      imageUrl: img.imageUrl,
      thumbnailUrl: img.thumbnailUrl,
      format: img.format,
      formatDimensions: img.formatDimensions,
      status: img.status,
      generatedBy: img.generatedBy,
      approvedBy: img.approvedBy ?? null,
      approvalDate: toDateNullable(img.approvalDate),
      feedback: img.feedback,
      usedInPostId: img.usedInPostId ?? null,
      modelUsed: img.modelUsed,
      batchId: img.batchId ?? null,
      createdAt: toDate(img.createdAt),
    },
  });
}

export async function deleteAIImage(id: string): Promise<void> {
  await prisma.aIImage.delete({ where: { id } }).catch(() => {});
}

// =====================================================================
//  Reference Images
// =====================================================================

export async function getReferences(): Promise<Record<string, ReferenceImage>> {
  const rows = await prisma.referenceImage.findMany();
  const record: Record<string, ReferenceImage> = {};
  for (const r of rows) record[r.id] = mapReferenceImage(r);
  return record;
}

export async function getReferencesByAgency(agencyId: string): Promise<ReferenceImage[]> {
  const rows = await prisma.referenceImage.findMany({ where: { agencyId } });
  return rows.map(mapReferenceImage);
}

export async function getReferencesByClient(clientId: string): Promise<ReferenceImage[]> {
  const rows = await prisma.referenceImage.findMany({ where: { clientId } });
  return rows.map(mapReferenceImage);
}

export async function saveReference(ref: ReferenceImage): Promise<void> {
  await prisma.referenceImage.upsert({
    where: { id: ref.id },
    update: {
      agencyId: ref.agencyId,
      clientId: ref.clientId,
      imageUrl: ref.imageUrl,
      source: ref.source,
      sourceId: ref.sourceId ?? null,
      caption: ref.caption,
      platforms: ref.platforms,
      publishedAt: ref.publishedAt ? new Date(ref.publishedAt) : null,
    },
    create: {
      id: ref.id,
      agencyId: ref.agencyId,
      clientId: ref.clientId,
      imageUrl: ref.imageUrl,
      source: ref.source,
      sourceId: ref.sourceId ?? null,
      caption: ref.caption,
      platforms: ref.platforms,
      publishedAt: ref.publishedAt ? new Date(ref.publishedAt) : null,
      createdAt: ref.createdAt ? new Date(ref.createdAt) : new Date(),
    },
  });
}

export async function deleteReference(id: string): Promise<void> {
  await prisma.referenceImage.delete({ where: { id } }).catch(() => {});
}

export async function referenceExistsForUrl(clientId: string, imageUrl: string): Promise<boolean> {
  const count = await prisma.referenceImage.count({ where: { clientId, imageUrl } });
  return count > 0;
}
