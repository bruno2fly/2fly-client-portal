/**
 * Meta integration API - status, disconnect
 */

import { Router } from 'express';
import { authenticate, getAgencyScope, requireCanViewDashboard } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { getMetaIntegrationByAgency, deleteMetaIntegration } from '../db.js';

const router = Router();

/**
 * GET /api/integrations/meta/status
 * Check if Meta is connected for the agency
 */
router.get('/status', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const integration = getMetaIntegrationByAgency(agencyId);

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
 * Disconnect Meta for the agency
 */
router.post('/disconnect', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    deleteMetaIntegration(agencyId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to disconnect' });
  }
});

export default router;
