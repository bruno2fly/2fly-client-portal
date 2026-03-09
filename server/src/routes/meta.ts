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
