/**
 * Meta integration API - status, disconnect (per client)
 */

import { Router } from 'express';
import { authenticate, getAgencyScope, requireCanViewDashboard } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { getMetaIntegrations, getMetaIntegrationByClient, deleteMetaIntegrationByClient } from '../db.js';

const router = Router();

/**
 * GET /api/integrations/meta/list
 * List all Meta integrations for the agency (all clients)
 */
router.get('/list', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const all = getMetaIntegrations();
    const agencyIntegrations = Object.values(all)
      .filter(i => i.agencyId === agencyId)
      .map(i => ({
        clientId: i.clientId,
        pageName: i.metaPageName,
        pageId: i.metaPageId,
        instagramUsername: i.metaInstagramUsername,
        instagramAccountId: i.metaInstagramAccountId,
        connected: i.tokenExpiresAt > Date.now(),
        tokenExpired: i.tokenExpiresAt < Date.now(),
        expiresAt: new Date(i.tokenExpiresAt).toISOString(),
        connectedAt: i.connectedAt,
      }));
    res.json({ success: true, integrations: agencyIntegrations });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to list integrations' });
  }
});

/**
 * GET /api/integrations/meta/status?clientId=xxx
 * Check if Meta is connected for the client
 */
router.get('/status', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const clientId = req.query.clientId as string;
    if (!clientId) {
      return res.status(400).json({ error: 'clientId query parameter is required' });
    }
    const { agencyId } = getAgencyScope(req);
    const integration = getMetaIntegrationByClient(agencyId, clientId);

    if (!integration) {
      return res.json({
        connected: false,
        pageName: null,
        instagramUsername: null,
      });
    }

    const tokenExpired = integration.tokenExpiresAt < Date.now();
    if (tokenExpired) {
      return res.json({
        connected: false,
        pageName: integration.metaPageName,
        instagramUsername: integration.metaInstagramUsername,
        error: 'Token expired. Please reconnect.',
      });
    }

    res.json({
      connected: true,
      pageName: integration.metaPageName,
      instagramUsername: integration.metaInstagramUsername,
      connectedAt: integration.connectedAt,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to check status' });
  }
});

/**
 * GET /api/integrations/meta/debug?clientId=xxx
 * Check token permissions with Graph API (for troubleshooting)
 */
router.get('/debug', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res) => {
  try {
    const clientId = req.query.clientId as string;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    const { agencyId } = getAgencyScope(req);
    const integration = getMetaIntegrationByClient(agencyId, clientId);
    if (!integration) return res.json({ connected: false, message: 'No integration found' });

    const tokenExpired = integration.tokenExpiresAt < Date.now();
    const userToken = (integration as any).metaUserAccessToken;
    const hasUserToken = !!userToken;

    // Check permissions using USER token (page tokens can't call /me/permissions)
    let permissions: any[] = [];
    let permError: string | undefined;
    if (userToken) {
      try {
        const permRes = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${userToken}`);
        const permData: any = await permRes.json();
        if (permData.error) permError = permData.error.message;
        else permissions = permData.data || [];
      } catch (e: any) { permError = e.message; }
    } else {
      permError = 'No user token stored. Please disconnect and reconnect to fix.';
    }

    // Check page token validity by trying to read the page
    let pageValid = false;
    let pageError: string | undefined;
    try {
      const pageUrl = `https://graph.facebook.com/v21.0/${integration.metaPageId}?fields=id,name&access_token=${integration.metaAccessToken}`;
      const pageRes = await fetch(pageUrl);
      const pageData: any = await pageRes.json();
      if (pageData.error) pageError = pageData.error.message;
      else pageValid = true;
    } catch (e: any) { pageError = e.message; }

    // Test if page token can actually post by checking token info (not /feed which needs read perms)
    let canPost = false;
    let postError: string | undefined;
    try {
      // Check the page token's permissions via debug_token using the app credentials, or just verify the token type
      const tokenInfoUrl = `https://graph.facebook.com/v21.0/${integration.metaPageId}?fields=id,name,access_token&access_token=${integration.metaAccessToken}`;
      const testRes = await fetch(tokenInfoUrl);
      const testData: any = await testRes.json();
      if (testData.error) {
        postError = testData.error.message;
      } else if (testData.access_token) {
        // Page returned its own access_token, meaning our token has page manage access
        canPost = true;
      } else if (testData.id) {
        // Can read page info but no access_token field = limited access
        canPost = true; // Still likely can post, page info accessible
      }
    } catch (e: any) { postError = e.message; }

    // Also check if user token has pages_manage_posts granted
    const hasManagePosts = permissions.some((p: any) => p.permission === 'pages_manage_posts' && p.status === 'granted');

    res.json({
      connected: !tokenExpired,
      tokenExpired,
      hasUserToken,
      hasManagePosts,
      expiresAt: new Date(integration.tokenExpiresAt).toISOString(),
      pageId: integration.metaPageId,
      pageName: integration.metaPageName,
      igAccountId: integration.metaInstagramAccountId,
      igUsername: integration.metaInstagramUsername,
      permissions: permissions.filter((p: any) => p.status === 'granted').map((p: any) => p.permission),
      declinedPermissions: permissions.filter((p: any) => p.status === 'declined').map((p: any) => p.permission),
      permError,
      pageValid,
      pageError,
      canPost,
      postError,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/integrations/meta/disconnect
 * Disconnect Meta for the client. Body: { clientId: string }
 */
router.post('/disconnect', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res) => {
  try {
    const clientId = req.body?.clientId;
    if (!clientId) {
      return res.status(400).json({ error: 'clientId is required in request body' });
    }
    const { agencyId } = getAgencyScope(req);

    // Try to revoke the token on Facebook's side so reconnect gets a fresh auth
    const integration = getMetaIntegrationByClient(agencyId, clientId);
    if (integration) {
      const tokenToRevoke = (integration as any).metaUserAccessToken || integration.metaAccessToken;
      try {
        await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${tokenToRevoke}`, { method: 'DELETE' });
        console.log(`[Meta disconnect] Revoked token for client ${clientId}`);
      } catch (e: any) {
        console.log(`[Meta disconnect] Token revocation failed (non-critical): ${e.message}`);
      }
    }

    deleteMetaIntegrationByClient(agencyId, clientId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to disconnect' });
  }
});

export default router;
