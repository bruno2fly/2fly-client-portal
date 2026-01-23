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

