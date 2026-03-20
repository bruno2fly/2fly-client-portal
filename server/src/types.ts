/**
 * Type definitions for the 2Fly server
 */

export interface Workspace {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

export interface Staff {
  id: string;
  username: string;
  fullName: string;
  email: string;
  workspaceId: string;
  createdAt: number;
}

// ==================== NEW CREDENTIALS SYSTEM ====================

export type UserRole = 'OWNER' | 'ADMIN' | 'STAFF' | 'CLIENT' | 'DESIGNER';
export type UserStatus = 'INVITED' | 'ACTIVE' | 'DISABLED';

export interface Agency {
  id: string;
  name: string;
  createdAt: number;
}

export interface User {
  id: string;
  agencyId: string;
  email: string; // UNIQUE per agency
  username?: string; // Optional username for login (generated from email)
  name: string;
  role: UserRole;
  status: UserStatus;
  passwordHash: string | null; // null for INVITED users
  tempPassword?: string; // Temporary password storage (DEV MODE ONLY - for display purposes)
  clientId?: string | null; // Only set when role=CLIENT
  lastLoginAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Client {
  id: string;
  agencyId: string;
  name: string;
  status: 'active' | 'inactive' | 'archived';
  createdAt: number;
  updatedAt: number;
  // Legacy fields from existing client structure
  category?: string;
  primaryContactName?: string;
  primaryContactWhatsApp?: string;
  primaryContactEmail?: string;
  preferredChannel?: string;
  platformsManaged?: string[];
  postingFrequency?: string;
  postingFrequencyNote?: string;
  approvalRequired?: boolean;
  language?: string;
  assetsLink?: string;
  brandGuidelinesLink?: string;
  primaryGoal?: string;
  secondaryGoal?: string;
  internalBehaviorType?: string;
  riskLevel?: string;
  internalNotes?: string;
  logoUrl?: string;
}

export interface InviteToken {
  id: string;
  agencyId: string;
  userId: string;
  tokenHash: string; // SHA-256 hash of the token
  expiresAt: number;
  usedAt?: number | null;
  createdAt: number;
}

export interface PasswordResetToken {
  id: string;
  agencyId: string;
  userId: string;
  tokenHash: string; // SHA-256 hash of the token
  expiresAt: number;
  usedAt?: number | null;
  createdAt: number;
}

export interface AuditLog {
  id: string;
  agencyId: string;
  actorUserId: string;
  action: string; // e.g., 'user.invite', 'user.disable', 'user.delete', 'client.create'
  targetUserId?: string | null;
  targetClientId?: string | null;
  metaJson?: string; // JSON string for additional metadata
  createdAt: number;
}

export interface WorkspaceIntegrationGoogle {
  id: string;
  workspaceId: string;
  encryptedRefreshToken: string; // AES-256-GCM encrypted
  status: 'active' | 'revoked' | 'error';
  connectedAt: number;
  lastUsedAt: number;
  errorMessage?: string;
}

export interface Asset {
  id: string;
  workspaceId: string;
  /** Dashboard scope: same as workspaceId (agencyId). */
  agencyId?: string;
  clientId: string;
  source: 'upload' | 'google_drive';
  originalFileId?: string;
  originalName: string;
  filename: string;
  mimeType: string;
  size: number;
  storageUrl: string;
  thumbnailUrl?: string;
  type: 'photo' | 'video' | 'logo' | 'doc';
  status: 'pending' | 'approved' | 'changes';
  tags: string[];
  caption?: string;
  createdByUserId: string;
  createdAt: number;
  updatedAt: number;
}

export interface GoogleDriveFile {
  fileId: string;
  name: string;
  mimeType: string;
  size?: number;
}

export interface Session {
  userId: string;
  workspaceId: string;
  username: string;
  fullName: string;
  loggedInAt: number;
}

export interface AuthSession {
  userId: string;
  agencyId: string;
  email: string;
  name: string;
  role: UserRole;
  clientId?: string | null;
  loggedInAt: number;
  expiresAt: number;
}

/** Meta (Facebook/Instagram) integration per client */
export interface MetaIntegration {
  id: string;
  agencyId: string;
  clientId: string;
  metaAccessToken: string;       // Page access token (for publishing)
  metaUserAccessToken?: string;  // Long-lived user token (for permission checks & refreshing page tokens)
  metaPageId: string;
  metaPageName?: string;
  metaInstagramAccountId?: string;
  metaInstagramUsername?: string;
  tokenExpiresAt: number;
  connectedAt: number;
  updatedAt: number;
}

/** Scheduled post for Meta publishing */
export interface ScheduledPost {
  id: string;
  agencyId: string;
  clientId: string;
  contentId: string;
  caption: string;
  mediaUrl: string;
  platforms: ('instagram' | 'facebook')[];
  scheduledAt: string;
  timezone: string;
  status: 'scheduled' | 'publishing' | 'published' | 'failed';
  publishedAt?: string;
  error?: string;
  metaPostIds?: { instagram?: string; facebook?: string };
  createdAt: string;
  updatedAt: string;
}

/** Production task for designer workflow */
export type ProductionTaskStatus =
  | 'assigned'
  | 'in_progress'
  | 'review'
  | 'changes_requested'
  | 'approved'
  | 'ready_to_post';

export type ProductionTaskPriority = 'low' | 'medium' | 'high' | 'urgent';

export type ProductionTaskCommentAuthorRole = 'admin' | 'staff' | 'designer';

export interface ProductionTaskComment {
  id: string;
  authorId: string;
  authorName: string;
  authorRole: ProductionTaskCommentAuthorRole;
  message: string;
  statusChange: string | null;
  createdAt: string;
}

export interface ProductionTask {
  id: string;
  agencyId: string;
  clientId: string;
  contentId: string;
  approvalId: string;
  designerId: string;
  title: string;
  caption: string;
  copyText: string;
  referenceImages: string[];
  briefNotes: string;
  finalArt: string[];
  designerNotes: string;
  status: ProductionTaskStatus;
  priority: ProductionTaskPriority;
  deadline: string;
  reviewNotes: string;
  comments?: ProductionTaskComment[];
  createdAt: string;
  updatedAt: string;
  startedAt: string;
  submittedAt: string;
  approvedAt: string;
}

/** Agency dashboard portal state per client (tasks, requests, assets, etc.). Scoped by agencyId. */
export interface PortalStateData {
  client: { id: string; name: string; whatsapp?: string; logoUrl?: string };
  kpis: { scheduled: number; waitingApproval: number; missingAssets: number; frustration: number };
  approvals: unknown[];
  needs: unknown[];
  requests: unknown[];
  assets: unknown[];
  activity: unknown[];
  seen: boolean;
}

/** AI Brand Profile for Gemini image generation - per client */
export interface BrandProfile {
  id: string;
  agencyId: string;
  clientId: string;
  // Brand basics
  brandName: string;
  industry: string;
  brandDescription: string;
  // Visual identity
  primaryColors: string[];    // hex codes
  secondaryColors: string[];  // hex codes
  fontStyle: string;          // e.g. "Modern sans-serif", "Classic serif"
  logoDescription: string;    // describe the logo for AI context
  // Tone & style
  brandVoice: string;         // e.g. "Professional yet friendly"
  visualStyle: string;        // e.g. "Clean minimalist", "Bold and vibrant"
  targetAudience: string;     // e.g. "Women 25-45, health-conscious"
  // Content guidelines
  doList: string[];           // things to always include
  dontList: string[];         // things to avoid
  samplePostDescriptions: string[];  // describe 2-3 ideal posts
  referenceImageUrls: string[];      // uploaded brand reference images
  // Extra notes
  additionalNotes: string;
  updatedAt: number;
  createdAt: number;
}

