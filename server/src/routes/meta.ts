/**
 * Meta integration API - status, disconnect (per client)
 */

import { Router } from 'express';
import { authenticate, getAgencyScope, requireCanViewDashboard } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { getMetaIntegrations, getMetaIntegrationByClient, deleteMetaIntegrationByClient, saveMetaIntegration } from '../db.js';
import { getPages, getInstagramAccount, refreshLongLivedToken } from '../lib/meta-api.js';

const router = Router();

/**
 * GET /api/integrations/meta/list
 * List all Meta integrations for the agency (all clients)
 */
router.get('/list', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const all = await getMetaIntegrations();
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
router.get('/status', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res) => {
  try {
    const clientId = req.query.clientId as string;
    if (!clientId) {
      return res.status(400).json({ error: 'clientId query parameter is required' });
    }
    const { agencyId } = getAgencyScope(req);
    const integration = await getMetaIntegrationByClient(agencyId, clientId);

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

    const daysUntilExpiry = Math.floor((integration.tokenExpiresAt - Date.now()) / (1000 * 60 * 60 * 24));
    res.json({
      connected: true,
      pageName: integration.metaPageName,
      instagramUsername: integration.metaInstagramUsername,
      connectedAt: integration.connectedAt,
      expiresAt: new Date(integration.tokenExpiresAt).toISOString(),
      daysUntilExpiry,
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
    const integration = await getMetaIntegrationByClient(agencyId, clientId);
    if (!integration) return res.json({ connected: false, message: 'No integration found' });

    const tokenExpired = integration.tokenExpiresAt < Date.now();
    let userToken = (integration as any).metaUserAccessToken;
    const hasUserToken = !!userToken;
    let autoFixed = false;

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

    // Test if page token can actually post
    let canPost = false;
    let postError: string | undefined;
    try {
      const tokenInfoUrl = `https://graph.facebook.com/v21.0/${integration.metaPageId}?fields=id,name,access_token&access_token=${integration.metaAccessToken}`;
      const testRes = await fetch(tokenInfoUrl);
      const testData: any = await testRes.json();
      if (testData.error) {
        postError = testData.error.message;
      } else if (testData.access_token || testData.id) {
        canPost = true;
      }
    } catch (e: any) { postError = e.message; }

    // AUTO-RECOVERY: If page token is failing but user token is still valid, try to get a fresh page token
    if ((!pageValid || !canPost) && userToken && !permError) {
      console.log(`[Meta debug] Page token failed for client ${clientId}, attempting auto-recovery...`);
      try {
        // First try refreshing the user token
        try {
          const refreshed = await refreshLongLivedToken(userToken);
          userToken = refreshed.access_token;
          (integration as any).metaUserAccessToken = refreshed.access_token;
          integration.tokenExpiresAt = Date.now() + (refreshed.expires_in * 1000);
          console.log('[Meta debug] User token refreshed successfully');
        } catch (refreshErr: any) {
          console.log(`[Meta debug] User token refresh skipped: ${refreshErr.message}`);
        }

        // Get fresh page tokens from user token
        const freshPages = await getPages(userToken);
        const freshPage = freshPages.find(p => p.id === integration.metaPageId) || freshPages[0];
        if (freshPage) {
          integration.metaAccessToken = freshPage.access_token;
          integration.metaPageId = freshPage.id;
          integration.metaPageName = freshPage.name;
          integration.updatedAt = Date.now();

          // Also refresh Instagram account
          try {
            const igAcct = await getInstagramAccount(freshPage.id, freshPage.access_token);
            if (igAcct) {
              integration.metaInstagramAccountId = igAcct.id;
              integration.metaInstagramUsername = igAcct.username;
            }
          } catch (igErr: any) {
            console.log(`[Meta debug] IG account refresh failed: ${igErr.message}`);
          }

          await saveMetaIntegration(integration);
          autoFixed = true;

          // Re-test with new token
          pageError = undefined;
          postError = undefined;
          try {
            const pageUrl2 = `https://graph.facebook.com/v21.0/${integration.metaPageId}?fields=id,name&access_token=${integration.metaAccessToken}`;
            const pageRes2 = await fetch(pageUrl2);
            const pageData2: any = await pageRes2.json();
            if (pageData2.error) pageError = pageData2.error.message;
            else pageValid = true;
          } catch (e: any) { pageError = e.message; }

          try {
            const tokenInfoUrl2 = `https://graph.facebook.com/v21.0/${integration.metaPageId}?fields=id,name,access_token&access_token=${integration.metaAccessToken}`;
            const testRes2 = await fetch(tokenInfoUrl2);
            const testData2: any = await testRes2.json();
            if (testData2.error) postError = testData2.error.message;
            else canPost = true;
          } catch (e: any) { postError = e.message; }

          console.log(`[Meta debug] Auto-recovery ${pageValid && canPost ? 'SUCCEEDED' : 'FAILED'} for client ${clientId}`);
        }
      } catch (recoveryErr: any) {
        console.log(`[Meta debug] Auto-recovery failed: ${recoveryErr.message}`);
      }
    }

    const hasManagePosts = permissions.some((p: any) => p.permission === 'pages_manage_posts' && p.status === 'granted');

    res.json({
      connected: !tokenExpired,
      tokenExpired,
      hasUserToken,
      hasManagePosts,
      autoFixed,
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
    const revokeOnFacebook = req.body?.revokeOnFacebook === true;

    const integration = await getMetaIntegrationByClient(agencyId, clientId);

    // Only revoke on Facebook if explicitly requested (full reset)
    // By default, just delete from our DB so reconnect is smooth
    if (revokeOnFacebook && integration) {
      const tokenToRevoke = (integration as any).metaUserAccessToken || integration.metaAccessToken;
      try {
        await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${tokenToRevoke}`, { method: 'DELETE' });
        console.log(`[Meta disconnect] Revoked token on Facebook for client ${clientId}`);
      } catch (e: any) {
        console.log(`[Meta disconnect] Token revocation failed (non-critical): ${e.message}`);
      }
    }

    await deleteMetaIntegrationByClient(agencyId, clientId);
    console.log(`[Meta disconnect] Removed integration for client ${clientId}${revokeOnFacebook ? ' (with Facebook revocation)' : ''}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to disconnect' });
  }
});

export default router;
