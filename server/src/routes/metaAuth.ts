/**
 * Meta (Facebook/Instagram) OAuth routes
 */

import { Router, Request, Response } from 'express';
import { authenticate, getAgencyScope, requireCanViewDashboard } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { getMetaIntegrationByAgency, saveMetaIntegration, deleteMetaIntegration } from '../db.js';
import { exchangeForLongLivedToken, getPages, getInstagramAccount } from '../lib/meta-api.js';

const router = Router();
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const META_REDIRECT_URI = process.env.META_REDIRECT_URI || '';

const SCOPES = [
  'pages_manage_posts',
  'instagram_basic',
  'instagram_content_publish',
  'pages_read_engagement',
  'pages_show_list',
  'business_management',
].join(',');

/**
 * GET /api/auth/meta?clientId=xxx
 * Redirects to Meta OAuth consent screen. clientId required for per-client connection.
 */
router.get('/', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res: Response) => {
  if (!META_APP_ID || !META_REDIRECT_URI) {
    return res.status(500).json({
      error: 'Meta OAuth not configured',
      message: 'META_APP_ID and META_REDIRECT_URI must be set',
    });
  }
  const clientId = req.query.clientId as string;
  if (!clientId) {
    return res.status(400).json({ error: 'clientId query parameter is required' });
  }
  const { agencyId } = getAgencyScope(req);
  const state = Buffer.from(JSON.stringify({ agencyId, clientId, userId: req.userId })).toString('base64');
  const authUrl = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&state=${state}&response_type=code`;
  res.json({ authUrl });
});

/**
 * GET /api/auth/meta/callback
 * Handles OAuth callback, exchanges code for long-lived token, fetches pages/IG
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;
    if (!code || typeof code !== 'string') {
      return res.status(400).send(renderCallbackPage(false, 'Missing authorization code'));
    }

    let agencyId: string;
    let clientId: string;
    if (state && typeof state === 'string') {
      try {
        const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
        agencyId = decoded.agencyId;
        clientId = decoded.clientId;
        if (!clientId) {
          return res.status(400).send(renderCallbackPage(false, 'Missing clientId in state'));
        }
      } catch {
        return res.status(400).send(renderCallbackPage(false, 'Invalid state parameter'));
      }
    } else {
      return res.status(400).send(renderCallbackPage(false, 'Missing state parameter'));
    }

    if (!META_APP_ID || !META_APP_SECRET || !META_REDIRECT_URI) {
      return res.status(500).send(renderCallbackPage(false, 'Meta OAuth not configured'));
    }

    // Exchange code for short-lived token
    const tokenUrl = `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}&client_secret=${META_APP_SECRET}&code=${code}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData: any = await tokenRes.json();
    if (tokenData.error) {
      throw new Error(tokenData.error.message || 'Failed to exchange code');
    }

    const shortToken = tokenData.access_token;
    const { access_token: longToken, expires_in } = await exchangeForLongLivedToken(shortToken);

    const pages = await getPages(longToken);
    if (pages.length === 0) {
      return res.send(renderCallbackPage(false, 'No Facebook Pages found. Please ensure your account has at least one Page with manage permission.'));
    }

    const page = pages[0];
    const igAccount = await getInstagramAccount(page.id, page.access_token);

    const tokenExpiresAt = Date.now() + (expires_in * 1000);
    const now = Date.now();
    const integration = {
      id: `meta_${agencyId}_${clientId}_${now}`,
      agencyId,
      clientId,
      metaAccessToken: page.access_token,
      metaPageId: page.id,
      metaPageName: page.name,
      metaInstagramAccountId: igAccount?.id,
      metaInstagramUsername: igAccount?.username,
      tokenExpiresAt,
      connectedAt: now,
      updatedAt: now,
    };

    saveMetaIntegration(integration);

    res.send(renderCallbackPage(true, undefined, page.name, igAccount?.username, clientId));
  } catch (error: any) {
    console.error('Meta OAuth callback error:', error);
    res.status(500).send(renderCallbackPage(false, error.message || 'Connection failed'));
  }
});

function renderCallbackPage(success: boolean, error?: string, pageName?: string, igUsername?: string, clientId?: string): string {
  const baseUrl = process.env.FRONTEND_URL || 'http://localhost:8000';
  const redirectUrl = clientId
    ? `${baseUrl}/agency#client=${encodeURIComponent(clientId)}&tab=scheduled`
    : `${baseUrl}/agency`;
  const safeClientId = (clientId || '').replace(/'/g, "\\'");
  return `
<!DOCTYPE html>
<html>
<head><title>${success ? 'Connected' : 'Error'} - Meta</title>
<style>body{font-family:system-ui;max-width:480px;margin:80px auto;padding:24px;text-align:center;}
.success{color:#059669;} .error{color:#dc2626;}
.btn{display:inline-block;margin-top:16px;padding:12px 24px;background:#0052CC;color:white;text-decoration:none;border-radius:8px;font-weight:600;}
.btn:hover{background:#003d99;}</style>
</head>
<body>
  <h1>${success ? '✅ Facebook & Instagram Connected' : '❌ Connection Failed'}</h1>
  ${success ? `<p class="success">Page: ${pageName || 'N/A'}${igUsername ? ` • Instagram: @${igUsername}` : ''}</p>` : ''}
  ${error ? `<p class="error">${error}</p>` : ''}
  <p>You can close this window.</p>
  <a href="${redirectUrl}" class="btn" onclick="if(window.opener){window.opener.postMessage({type:'META_CONNECTED',success:${success},clientId:'${safeClientId}'},'*');window.close();}return true;">Close</a>
</body>
</html>`;
}

export default router;
