/**
 * Client portal API. Requires client JWT (Bearer token from /api/auth/client-login).
 * GET/PUT portal state so client sees agency-added approvals, requests, needs, etc.
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getPortalState, savePortalState, getClient } from '../db.js';
import type { PortalStateData } from '../types.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-use-strong-secret';

function defaultPortalState(clientId: string, name: string, whatsapp?: string): PortalStateData {
  return {
    client: { id: clientId, name: name || clientId, whatsapp: whatsapp || '' },
    kpis: { scheduled: 0, waitingApproval: 0, missingAssets: 0, frustration: 0 },
    approvals: [],
    needs: [],
    requests: [],
    assets: [],
    activity: [],
    seen: false
  };
}

function authenticateClient(req: Request, res: Response): { clientId: string; agencyId: string } | null {
  const auth = req.headers.authorization;
  const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'Authorization required' });
    return null;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { clientId?: string; agencyId?: string; purpose?: string };
    if (decoded.purpose !== 'client-portal' || !decoded.clientId || !decoded.agencyId) {
      res.status(401).json({ error: 'Invalid token' });
      return null;
    }
    return { clientId: decoded.clientId, agencyId: decoded.agencyId };
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
}

/**
 * GET /api/client/portal-state
 * Returns portal state for the authenticated client.
 */
router.get('/portal-state', (req, res) => {
  const ctx = authenticateClient(req, res);
  if (!ctx) return;
  try {
    let state = getPortalState(ctx.agencyId, ctx.clientId);
    if (!state) {
      const client = getClient(ctx.clientId);
      state = defaultPortalState(ctx.clientId, client?.name || ctx.clientId, client?.primaryContactWhatsApp);
      savePortalState(ctx.agencyId, ctx.clientId, state);
    }
    res.json({ success: true, data: state });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to load portal state' });
  }
});

/**
 * PUT /api/client/portal-state
 * Body: { data }. Updates portal state for the authenticated client.
 */
router.put('/portal-state', (req, res) => {
  const ctx = authenticateClient(req, res);
  if (!ctx) return;
  try {
    const { data } = req.body || {};
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'data required' });
    }
    const state = data as PortalStateData;
    if (!state.client || !state.kpis || !Array.isArray(state.assets)) {
      return res.status(400).json({ error: 'Invalid portal state shape' });
    }
    savePortalState(ctx.agencyId, ctx.clientId, state);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to save portal state' });
  }
});

export default router;
