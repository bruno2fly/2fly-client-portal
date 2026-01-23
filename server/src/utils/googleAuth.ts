/**
 * Google OAuth and Drive API utilities
 */

import { google } from 'googleapis';
import type { OAuth2Client } from 'google-auth-library';
import { decryptToken } from './crypto.js';
import { 
  getGoogleIntegrationByWorkspace, 
  updateGoogleIntegrationStatus 
} from '../db.js';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3001/api/integrations/google-drive/callback';

/**
 * Create OAuth2 client
 */
export function createOAuth2Client(): OAuth2Client {
  return new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_REDIRECT_URI
  );
}

/**
 * Get OAuth authorization URL
 */
export function getAuthUrl(state?: string): string {
  // Validate that credentials are configured
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID === 'your-google-client-id.apps.googleusercontent.com') {
    throw new Error('Google OAuth Client ID not configured. Please set GOOGLE_CLIENT_ID in .env file.');
  }
  
  if (!GOOGLE_CLIENT_SECRET || GOOGLE_CLIENT_SECRET === 'your-google-client-secret') {
    throw new Error('Google OAuth Client Secret not configured. Please set GOOGLE_CLIENT_SECRET in .env file.');
  }
  
  const oauth2Client = createOAuth2Client();
  const scopes = [
    'https://www.googleapis.com/auth/drive.file',
    'openid',
    'email',
    'profile'
  ];
  
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force consent to get refresh token
    state: state || undefined
  });
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiryDate?: number;
}> {
  const oauth2Client = createOAuth2Client();
  const { tokens } = await oauth2Client.getToken(code);
  
  if (!tokens.refresh_token) {
    throw new Error('No refresh token received. User may need to re-consent.');
  }
  
  return {
    accessToken: tokens.access_token!,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date || undefined
  };
}

/**
 * Get access token for a workspace (refreshes if needed)
 */
export async function getAccessTokenForWorkspace(workspaceId: string): Promise<string> {
  const integration = getGoogleIntegrationByWorkspace(workspaceId);
  if (!integration || integration.status !== 'active') {
    throw new Error('Google Drive not connected for this workspace');
  }
  
  try {
    const refreshToken = await decryptToken(integration.encryptedRefreshToken);
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    
    // This will automatically refresh if needed
    const { credentials } = await oauth2Client.refreshAccessToken();
    
    if (!credentials.access_token) {
      throw new Error('Failed to get access token');
    }
    
    // Update last used time
    integration.lastUsedAt = Date.now();
    updateGoogleIntegrationStatus(workspaceId, 'active');
    
    return credentials.access_token;
  } catch (error: any) {
    console.error('Error refreshing access token:', error);
    updateGoogleIntegrationStatus(workspaceId, 'error', error.message);
    throw error;
  }
}

/**
 * Create Drive API client for a workspace
 */
export async function createDriveClient(workspaceId: string) {
  const accessToken = await getAccessTokenForWorkspace(workspaceId);
  const oauth2Client = createOAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  
  return google.drive({ version: 'v3', auth: oauth2Client });
}

