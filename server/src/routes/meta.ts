/**
 * Meta integration API - status, disconnect (per client)
 */

import { Router } from 'express';
import { authenticate, getAgencyScope, requireCanViewDashboard } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { getMetaIntegrationByClient, deleteMetaIntegrationByClient } from '../db.js';

const router = Router();

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
    // Check token permissions via Graph API
    const permUrl = `https://graph.facebook.com/v19.0/me/permissions?access_token=${integration.metaAccessToken}`;
    let permissions: any[] = [];
    let permError: string | undefined;
    try {
      const permRes = await fetch(permUrl);
      const permData: any = await permRes.json();
      if (permData.error) permError = permData.error.message;
      else permissions = permData.data || [];
    } catch (e: any) { permError = e.message; }

    // Check page access
    let pageValid = false;
    let pageError: string | undefined;
    try {
      const pageUrl = `https://graph.facebook.com/v19.0/${integration.metaPageId}?fields=id,name&access_token=${integration.metaAccessToken}`;
      const pageRes = await fetch(pageUrl);
      const pageData: any = await pageRes.json();
      if (pageData.error) pageError = pageData.error.message;
      else pageValid = true;
    } catch (e: any) { pageError = e.message; }

    res.json({
      connected: !tokenExpired,
      tokenExpired,
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
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/integrations/meta/disconnect
 * Disconnect Meta for the client. Body: { clientId: string }
 */
router.post('/disconnect', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const clientId = req.body?.clientId;
    if (!clientId) {
      return res.status(400).json({ error: 'clientId is required in request body' });
    }
    const { agencyId } = getAgencyScope(req);
    deleteMetaIntegrationByClient(agencyId, clientId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to disconnect' });
  }
});

export default router;
