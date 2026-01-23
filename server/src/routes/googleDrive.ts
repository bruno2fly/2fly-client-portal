/**
 * Google Drive integration routes
 */

import { Router } from 'express';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { getAuthUrl, exchangeCodeForTokens } from '../utils/googleAuth.js';
import { encryptToken } from '../utils/crypto.js';
import { 
  getGoogleIntegrationByWorkspace, 
  saveGoogleIntegration,
  updateGoogleIntegrationStatus 
} from '../db.js';
import { importDriveFiles } from '../utils/driveImport.js';
import type { GoogleDriveFile } from '../types.js';

const router = Router();

/**
 * GET /api/integrations/google-drive/connect
 * Returns OAuth URL for connecting Google Drive
 */
router.get('/connect', authenticate, (req: AuthenticatedRequest, res) => {
  try {
    const workspaceId = req.workspaceId!;
    const state = Buffer.from(JSON.stringify({ workspaceId, userId: req.userId })).toString('base64');
    const authUrl = getAuthUrl(state);
    
    res.json({ authUrl });
  } catch (error: any) {
    console.error('Error generating auth URL:', error);
    const errorMessage = error.message || 'Failed to generate auth URL';
    
    // Return specific error message to help with debugging
    if (errorMessage.includes('not configured')) {
      res.status(500).json({ 
        error: 'Google OAuth not configured',
        message: errorMessage,
        hint: 'Please configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in server/.env file'
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to generate auth URL',
        message: errorMessage
      });
    }
  }
});

/**
 * GET /api/integrations/google-drive/callback
 * Handles OAuth callback and stores refresh token
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Missing authorization code' });
    }
    
    // Decode state to get workspace info
    let workspaceId: string;
    let userId: string;
    
    if (state && typeof state === 'string') {
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
        workspaceId = decoded.workspaceId;
        userId = decoded.userId;
      } catch {
        return res.status(400).json({ error: 'Invalid state parameter' });
      }
    } else {
      return res.status(400).json({ error: 'Missing state parameter' });
    }
    
    // Exchange code for tokens
    const { refreshToken } = await exchangeCodeForTokens(code);
    
    // Encrypt and store refresh token
    const encryptedToken = await encryptToken(refreshToken);
    
    // Check if integration already exists
    let integration = getGoogleIntegrationByWorkspace(workspaceId);
    
    if (integration) {
      // Update existing integration
      integration.encryptedRefreshToken = encryptedToken;
      integration.status = 'active';
      integration.connectedAt = Date.now();
      integration.lastUsedAt = Date.now();
      delete integration.errorMessage;
    } else {
      // Create new integration
      integration = {
        id: `int_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        workspaceId,
        encryptedRefreshToken: encryptedToken,
        status: 'active',
        connectedAt: Date.now(),
        lastUsedAt: Date.now()
      };
    }
    
    saveGoogleIntegration(integration);
    
    // Redirect to success page (or close popup in production)
    res.send(`
      <html>
        <head><title>Google Drive Connected</title></head>
        <body>
          <h1>Google Drive successfully connected!</h1>
          <p>You can close this window.</p>
          <script>
            // Notify parent window if opened in popup
            if (window.opener) {
              window.opener.postMessage({ type: 'GOOGLE_DRIVE_CONNECTED' }, '*');
              window.close();
            }
          </script>
        </body>
      </html>
    `);
  } catch (error: any) {
    console.error('Error in OAuth callback:', error);
    res.status(500).send(`
      <html>
        <head><title>Connection Error</title></head>
        <body>
          <h1>Error connecting Google Drive</h1>
          <p>${error.message}</p>
        </body>
      </html>
    `);
  }
});

/**
 * GET /api/integrations/google-drive/status
 * Check if Google Drive is connected for the workspace
 */
router.get('/status', authenticate, (req: AuthenticatedRequest, res) => {
  try {
    const workspaceId = req.workspaceId!;
    const integration = getGoogleIntegrationByWorkspace(workspaceId);
    
    res.json({
      connected: integration?.status === 'active' || false,
      status: integration?.status || 'not_connected',
      connectedAt: integration?.connectedAt,
      lastUsedAt: integration?.lastUsedAt,
      errorMessage: integration?.errorMessage
    });
  } catch (error: any) {
    console.error('Error checking status:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

/**
 * POST /api/integrations/google-drive/import
 * Import files from Google Drive
 */
router.post('/import', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const workspaceId = req.workspaceId!;
    const userId = req.userId!;
    const { clientId, files } = req.body;
    
    if (!clientId || !files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'Missing clientId or files' });
    }
    
    // Validate file structure
    const driveFiles: GoogleDriveFile[] = files.map((f: any) => {
      if (!f.fileId || !f.name || !f.mimeType) {
        throw new Error('Invalid file structure. Required: fileId, name, mimeType');
      }
      return {
        fileId: f.fileId,
        name: f.name,
        mimeType: f.mimeType,
        size: f.size
      };
    });
    
    // Import files
    const importedAssets = await importDriveFiles(workspaceId, clientId, userId, driveFiles);
    
    res.json({
      success: true,
      imported: importedAssets.length,
      assets: importedAssets
    });
  } catch (error: any) {
    console.error('Error importing files:', error);
    res.status(500).json({ 
      error: 'Failed to import files',
      message: error.message 
    });
  }
});

/**
 * GET /api/integrations/google-drive/access-token
 * Get access token for Google Drive Picker (short-lived)
 */
router.get('/access-token', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const workspaceId = req.workspaceId!;
    const { getAccessTokenForWorkspace } = await import('../utils/googleAuth.js');
    const accessToken = await getAccessTokenForWorkspace(workspaceId);
    
    res.json({ accessToken });
  } catch (error: any) {
    console.error('Error getting access token:', error);
    res.status(500).json({ 
      error: 'Failed to get access token',
      message: error.message 
    });
  }
});

/**
 * POST /api/integrations/google-drive/disconnect
 * Disconnect Google Drive for the workspace
 */
router.post('/disconnect', authenticate, async (req: AuthenticatedRequest, res) => {
  try {
    const workspaceId = req.workspaceId!;
    updateGoogleIntegrationStatus(workspaceId, 'revoked');
    
    res.json({ success: true });
  } catch (error: any) {
    console.error('Error disconnecting:', error);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

export default router;

