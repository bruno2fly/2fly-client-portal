/**
 * Agency dashboard API. All data scoped by agencyId.
 * Dev Notes: Dashboard is agencyId-scoped; only personal preferences use userId.
 */

import { Router } from 'express';
import { authenticate, getAgencyScope, requireCanViewDashboard } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  getClientsByAgency,
  getClient,
  saveClient,
  deleteClient,
  getPortalState,
  savePortalState,
  deletePortalState,
  getClientCredentials,
  saveClientCredentials,
  deleteClientCredentials,
} from '../db.js';
import type { Client, PortalStateData } from '../types.js';

const router = Router();

router.use(authenticate, requireCanViewDashboard);

function defaultPortalState(clientId: string, name: string, whatsapp?: string): PortalStateData {
  return {
    client: { id: clientId, name, whatsapp: whatsapp || '' },
    kpis: { scheduled: 0, waitingApproval: 0, missingAssets: 0, frustration: 0 },
    approvals: [],
    needs: [],
    requests: [],
    assets: [],
    activity: [],
    seen: false,
  };
}

/**
 * GET /api/agency/clients
 * List clients for the agency (agencyId-scoped). Includes saved credentials (password) when present.
 */
router.get('/clients', (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const list = getClientsByAgency(agencyId);
    const clients = list.map((c) => {
      const password = getClientCredentials(agencyId, c.id);
      return { ...c, password: password ?? undefined };
    });
    res.json({ success: true, clients });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to list clients' });
  }
});

/**
 * POST /api/agency/clients
 * Create a client. agencyId from session.
 */
router.post('/clients', (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const body = req.body || {};
    const id = (body.id || '').toString().trim().toLowerCase();
    if (!id || !/^[a-z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: 'Valid client id (lowercase, hyphens) required' });
    }
    const existing = getClient(id);
    if (existing) {
      return res.status(400).json({ error: 'Client ID already exists' });
    }
    const now = Date.now();
    const client: Client = {
      id,
      agencyId,
      name: (body.name || '').toString().trim() || id,
      status: (body.status as 'active' | 'inactive' | 'archived') || 'active',
      createdAt: now,
      updatedAt: now,
      category: body.category,
      primaryContactName: body.primaryContactName,
      primaryContactWhatsApp: body.primaryContactWhatsApp,
      primaryContactEmail: body.primaryContactEmail,
      preferredChannel: body.preferredChannel,
      platformsManaged: Array.isArray(body.platformsManaged) ? body.platformsManaged : undefined,
      postingFrequency: body.postingFrequency,
      postingFrequencyNote: body.postingFrequencyNote,
      approvalRequired: body.approvalRequired === true || body.approvalRequired === 'true',
      language: body.language,
      assetsLink: body.assetsLink,
      brandGuidelinesLink: body.brandGuidelinesLink,
      primaryGoal: body.primaryGoal,
      secondaryGoal: body.secondaryGoal,
      internalBehaviorType: body.internalBehaviorType,
      riskLevel: body.riskLevel,
      internalNotes: body.internalNotes,
      logoUrl: body.logoUrl,
    };
    saveClient(client);
    const pwd = (body.password || '').toString();
    if (pwd.length >= 6) saveClientCredentials(agencyId, id, pwd);
    const portal = defaultPortalState(
      id,
      client.name,
      client.primaryContactWhatsApp
    );
    savePortalState(agencyId, id, portal);
    res.status(201).json({ success: true, client });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to create client' });
  }
});

/**
 * PATCH /api/agency/clients/:id
 * Update a client. Must belong to agency.
 */
router.patch('/clients/:id', (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const id = (req.params.id || '').trim().toLowerCase();
    const client = getClient(id);
    if (!client || client.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Client not found' });
    }
    const body = req.body || {};
    const updated: Client = {
      ...client,
      updatedAt: Date.now(),
      name: body.name !== undefined ? String(body.name).trim() : client.name,
      status: body.status !== undefined ? body.status : client.status,
      category: body.category !== undefined ? body.category : client.category,
      primaryContactName: body.primaryContactName !== undefined ? body.primaryContactName : client.primaryContactName,
      primaryContactWhatsApp: body.primaryContactWhatsApp !== undefined ? body.primaryContactWhatsApp : client.primaryContactWhatsApp,
      primaryContactEmail: body.primaryContactEmail !== undefined ? body.primaryContactEmail : client.primaryContactEmail,
      preferredChannel: body.preferredChannel !== undefined ? body.preferredChannel : client.preferredChannel,
      platformsManaged: body.platformsManaged !== undefined ? body.platformsManaged : client.platformsManaged,
      postingFrequency: body.postingFrequency !== undefined ? body.postingFrequency : client.postingFrequency,
      postingFrequencyNote: body.postingFrequencyNote !== undefined ? body.postingFrequencyNote : client.postingFrequencyNote,
      approvalRequired: body.approvalRequired !== undefined ? (body.approvalRequired === true || body.approvalRequired === 'true') : client.approvalRequired,
      language: body.language !== undefined ? body.language : client.language,
      assetsLink: body.assetsLink !== undefined ? body.assetsLink : client.assetsLink,
      brandGuidelinesLink: body.brandGuidelinesLink !== undefined ? body.brandGuidelinesLink : client.brandGuidelinesLink,
      primaryGoal: body.primaryGoal !== undefined ? body.primaryGoal : client.primaryGoal,
      secondaryGoal: body.secondaryGoal !== undefined ? body.secondaryGoal : client.secondaryGoal,
      internalBehaviorType: body.internalBehaviorType !== undefined ? body.internalBehaviorType : client.internalBehaviorType,
      riskLevel: body.riskLevel !== undefined ? body.riskLevel : client.riskLevel,
      internalNotes: body.internalNotes !== undefined ? body.internalNotes : client.internalNotes,
      logoUrl: body.logoUrl !== undefined ? body.logoUrl : client.logoUrl,
    };
    saveClient(updated);
    const pwd = (body.password || '').toString();
    if (pwd.length >= 6) saveClientCredentials(agencyId, id, pwd);
    res.json({ success: true, client: updated });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to update client' });
  }
});

/**
 * DELETE /api/agency/clients/:id
 * Delete a client and related portal state + credentials. Agency-scoped.
 */
router.delete('/clients/:id', (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const id = (req.params.id || '').trim().toLowerCase();
    const client = getClient(id);
    if (!client || client.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Client not found' });
    }
    deletePortalState(agencyId, id);
    deleteClientCredentials(agencyId, id);
    deleteClient(id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to delete client' });
  }
});

/**
 * GET /api/agency/portal-state?clientId=...
 * Portal state for a client (agency-scoped).
 */
router.get('/portal-state', (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const clientId = (req.query.clientId as string)?.trim();
    if (!clientId) {
      return res.status(400).json({ error: 'clientId required' });
    }
    const client = getClient(clientId);
    if (!client || client.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Client not found' });
    }
    let state = getPortalState(agencyId, clientId);
    if (!state) {
      state = defaultPortalState(clientId, client.name, client.primaryContactWhatsApp);
      savePortalState(agencyId, clientId, state);
    }
    res.json({ success: true, data: state });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to get portal state' });
  }
});

/**
 * PUT /api/agency/portal-state
 * Body: { clientId, data }. Update portal state (agency-scoped).
 */
router.put('/portal-state', (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const { clientId, data } = req.body || {};
    const cid = (clientId || '').toString().trim();
    if (!cid || !data || typeof data !== 'object') {
      return res.status(400).json({ error: 'clientId and data required' });
    }
    const client = getClient(cid);
    if (!client || client.agencyId !== agencyId) {
      return res.status(404).json({ error: 'Client not found' });
    }
    const state = data as PortalStateData;
    if (!state.client || !state.kpis || !Array.isArray(state.assets)) {
      return res.status(400).json({ error: 'Invalid portal state shape' });
    }
    savePortalState(agencyId, cid, state);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to save portal state' });
  }
});

export default router;
