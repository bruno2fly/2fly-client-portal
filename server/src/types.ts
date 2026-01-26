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

export type UserRole = 'OWNER' | 'ADMIN' | 'STAFF' | 'CLIENT';
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
  clientId: string;
  source: 'upload' | 'google_drive';
  originalFileId?: string; // Google Drive file ID if source is google_drive
  originalName: string;
  filename: string;
  mimeType: string;
  size: number;
  storageUrl: string; // URL to file in our storage
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

// New session structure for credentials system
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

