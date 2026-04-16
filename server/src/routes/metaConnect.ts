/**
 * Meta Connection Management — Complete rewrite
 *
 * Handles: OAuth flow with page picker, connection status,
 * health checks, auto-recovery, reconnect, disconnect.
 *
 * Replaces: metaAuth.ts + meta.ts
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { signState, verifySignedState } from '../lib/meta-oauth-state.js';
import { authenticate, getAgencyScope, requireCanViewDashboard } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import {
  getMetaIntegrations,
  getMetaIntegrationByClient,
  saveMetaIntegration,
  deleteMetaIntegrationByClient,
  getClientsByAgency,
} from '../db.js';
import {
  exchangeForLongLivedToken,
  getPages,
  getInstagramAccount,
  refreshLongLivedToken,
} from '../lib/meta-api.js';

const router = Router();
const META_APP_ID = process.env.META_APP_ID;
const META_APP_SECRET = process.env.META_APP_SECRET;
const META_REDIRECT_URI = process.env.META_REDIRECT_URI || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8000';

// ═══════════════════════════════════════════════════════
// OAuth Scopes — everything we need
// ═══════════════════════════════════════════════════════
const SCOPES = [
  'pages_manage_posts',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_metadata',
  'pages_show_list',
  'instagram_basic',
  'instagram_content_publish',
  'business_management',
].join(',');

// ═══════════════════════════════════════════════════════
// Temp storage for OAuth sessions (page selection flow)
// Cleaned up after 15 minutes
// ═══════════════════════════════════════════════════════
interface OAuthSession {
  userToken: string;
  agencyId: string;
  clientId: string;
  userId: string;
  pages: Array<{
    id: string;
    name: string;
    picture?: string;
    accessToken: string;
    instagram?: { id: string; username: string; picture?: string } | null;
  }>;
  permissions: string[];
  createdAt: number;
}

const oauthSessions = new Map<string, OAuthSession>();

// Clean up expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of oauthSessions) {
    if (now - session.createdAt > 15 * 60 * 1000) {
      oauthSessions.delete(key);
    }
  }
}, 5 * 60 * 1000);

// ═══════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════

/** Get page profile picture URL */
async function getPagePicture(pageId: string, accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${pageId}/picture?redirect=false&type=small&access_token=${accessToken}`);
    const data: any = await res.json();
    return data?.data?.url;
  } catch {
    return undefined;
  }
}

/** Get Instagram profile picture */
async function getInstagramPicture(igId: string, accessToken: string): Promise<string | undefined> {
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${igId}?fields=profile_picture_url&access_token=${accessToken}`);
    const data: any = await res.json();
    return data?.profile_picture_url;
  } catch {
    return undefined;
  }
}

/**
 * Cross-client conflict detection.
 *
 * Detects cases like "Ardan Spa client connected to The Shape's Instagram" —
 * the same IG account or FB page linked to more than one client within the agency.
 *
 * Pass in (agencyId, targetClientId, igId, pageId) BEFORE saving a new connection
 * to see if that IG/Page is already owned by a different client.
 */
function detectConflictForNewConnection(
  agencyId: string,
  targetClientId: string,
  igId: string | undefined,
  pageId: string | undefined
): { conflictingClientId: string; conflictingClientName: string; reason: 'instagram' | 'page' } | null {
  const all = Object.values(getMetaIntegrations()).filter(
    (i: any) => i.agencyId === agencyId && i.clientId !== targetClientId && (i.status || 'connected') !== 'disconnected'
  );
  const clientList = getClientsByAgency(agencyId);
  const clientNameById: Record<string, string> = {};
  clientList.forEach((c: any) => { clientNameById[c.id] = c.name || c.id; });

  if (igId) {
    const dup = all.find((i: any) => i.metaInstagramAccountId && i.metaInstagramAccountId === igId);
    if (dup) {
      return {
        conflictingClientId: dup.clientId,
        conflictingClientName: clientNameById[dup.clientId] || dup.clientId,
        reason: 'instagram',
      };
    }
  }
  if (pageId) {
    const dup = all.find((i: any) => i.metaPageId && i.metaPageId === pageId);
    if (dup) {
      return {
        conflictingClientId: dup.clientId,
        conflictingClientName: clientNameById[dup.clientId] || dup.clientId,
        reason: 'page',
      };
    }
  }
  return null;
}

/**
 * Scan ALL existing connections in an agency and return any cross-client
 * conflicts (same IG account or FB page on two or more clients).
 * Used to surface historical conflicts that slipped in before detection was added.
 */
function findAllAgencyConflicts(agencyId: string): Array<{
  reason: 'instagram' | 'page';
  identifier: string;
  clients: Array<{ clientId: string; clientName: string; instagramUsername?: string; pageName?: string }>;
}> {
  const all = Object.values(getMetaIntegrations()).filter(
    (i: any) => i.agencyId === agencyId && (i.status || 'connected') !== 'disconnected'
  );
  const clientList = getClientsByAgency(agencyId);
  const clientNameById: Record<string, string> = {};
  clientList.forEach((c: any) => { clientNameById[c.id] = c.name || c.id; });

  const igBuckets: Record<string, any[]> = {};
  const pageBuckets: Record<string, any[]> = {};
  all.forEach((i: any) => {
    if (i.metaInstagramAccountId) {
      if (!igBuckets[i.metaInstagramAccountId]) igBuckets[i.metaInstagramAccountId] = [];
      igBuckets[i.metaInstagramAccountId].push(i);
    }
    if (i.metaPageId) {
      if (!pageBuckets[i.metaPageId]) pageBuckets[i.metaPageId] = [];
      pageBuckets[i.metaPageId].push(i);
    }
  });

  const conflicts: Array<{
    reason: 'instagram' | 'page';
    identifier: string;
    clients: Array<{ clientId: string; clientName: string; instagramUsername?: string; pageName?: string }>;
  }> = [];

  Object.keys(igBuckets).forEach((igId) => {
    const items = igBuckets[igId];
    if (items.length > 1) {
      conflicts.push({
        reason: 'instagram',
        identifier: items[0].metaInstagramUsername ? '@' + items[0].metaInstagramUsername : igId,
        clients: items.map((i: any) => ({
          clientId: i.clientId,
          clientName: clientNameById[i.clientId] || i.clientId,
          instagramUsername: i.metaInstagramUsername,
          pageName: i.metaPageName,
        })),
      });
    }
  });

  Object.keys(pageBuckets).forEach((pageId) => {
    const items = pageBuckets[pageId];
    if (items.length > 1) {
      // Skip if we already flagged the same set via Instagram
      const already = conflicts.some(
        (c) => c.reason === 'instagram' && c.clients.map((cc) => cc.clientId).sort().join(',') === items.map((i: any) => i.clientId).sort().join(',')
      );
      if (already) return;
      conflicts.push({
        reason: 'page',
        identifier: items[0].metaPageName || pageId,
        clients: items.map((i: any) => ({
          clientId: i.clientId,
          clientName: clientNameById[i.clientId] || i.clientId,
          instagramUsername: i.metaInstagramUsername,
          pageName: i.metaPageName,
        })),
      });
    }
  });

  return conflicts;
}

// ═══════════════════════════════════════════════════════
// 1. OAUTH FLOW
// ═══════════════════════════════════════════════════════

/**
 * GET /connect?clientId=xxx
 * Start OAuth — returns the Facebook authorization URL
 */
router.get('/connect', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res: Response) => {
  if (!META_APP_ID || !META_REDIRECT_URI) {
    return res.status(500).json({ error: 'Meta OAuth not configured. Set META_APP_ID and META_REDIRECT_URI.' });
  }

  const clientId = req.query.clientId as string;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });

  const { agencyId } = getAgencyScope(req);
  const state = signState({ agencyId, clientId, userId: req.userId, ts: Date.now() });

  // auth_type=rerequest forces re-asking for any previously declined permissions
  const authUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}&scope=${encodeURIComponent(SCOPES)}&state=${encodeURIComponent(state)}&response_type=code&auth_type=rerequest`;

  res.json({ authUrl });
});

/**
 * GET /callback
 * Facebook redirects here after user authorizes.
 * Fetches all available pages + IG accounts, stores in temp session,
 * then redirects to frontend with a session key for the page picker.
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, error: fbError, error_description } = req.query;
    const rawState = req.query.state;
    const state: string | undefined =
      typeof rawState === 'string'
        ? rawState
        : Array.isArray(rawState) && typeof rawState[0] === 'string'
          ? rawState[0]
          : undefined;

    if (fbError) {
      console.error(`[Meta OAuth] Facebook error: ${fbError} — ${error_description}`);
      return res.send(renderResultPage(false, `Facebook authorization failed: ${error_description || fbError}`));
    }

    if (!code || typeof code !== 'string') {
      return res.send(renderResultPage(false, 'Missing authorization code'));
    }

    // Verify signed state
    if (!state) {
      return res.send(renderResultPage(false, 'Missing state parameter'));
    }
    const stateData = verifySignedState(state) as any;
    if (!stateData || !stateData.clientId || !stateData.agencyId) {
      return res.send(renderResultPage(false, 'Invalid or tampered state parameter. Please try connecting again.'));
    }

    const { agencyId, clientId, userId } = stateData;

    if (!META_APP_ID || !META_APP_SECRET || !META_REDIRECT_URI) {
      return res.send(renderResultPage(false, 'Meta OAuth not configured on server'));
    }

    // Exchange code for short-lived token
    const tokenUrl = `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}&client_secret=${META_APP_SECRET}&code=${code}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData: any = await tokenRes.json();
    if (tokenData.error) {
      throw new Error(tokenData.error.message || 'Failed to exchange code for token');
    }

    // Exchange for long-lived user token (60 days)
    const { access_token: longToken, expires_in } = await exchangeForLongLivedToken(tokenData.access_token);

    // Check granted permissions
    const permRes = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${longToken}`);
    const permData: any = await permRes.json();
    const granted = (permData.data || []).filter((p: any) => p.status === 'granted').map((p: any) => p.permission);
    const declined = (permData.data || []).filter((p: any) => p.status === 'declined').map((p: any) => p.permission);
    console.log(`[Meta OAuth] Granted: ${granted.join(', ')}`);
    if (declined.length > 0) console.log(`[Meta OAuth] Declined: ${declined.join(', ')}`);

    // Check minimum required permissions
    const required = ['pages_manage_posts', 'pages_show_list'];
    const missing = required.filter(s => !granted.includes(s));
    if (missing.length > 0) {
      return res.send(renderResultPage(false,
        `Missing required permissions: ${missing.join(', ')}. Please try again and approve all permissions in the Facebook dialog.`
      ));
    }

    // Fetch all pages the user manages
    const pages = await getPages(longToken);
    if (pages.length === 0) {
      return res.send(renderResultPage(false,
        'No Facebook Pages found. Make sure your Facebook account manages at least one Page.'
      ));
    }

    // For each page, get picture + check for Instagram Business Account
    const pagesWithDetails = await Promise.all(pages.map(async (page) => {
      const [picture, igAccount] = await Promise.all([
        getPagePicture(page.id, page.access_token),
        getInstagramAccount(page.id, page.access_token),
      ]);

      let igPicture: string | undefined;
      if (igAccount) {
        igPicture = await getInstagramPicture(igAccount.id, page.access_token).catch(() => undefined);
      }

      return {
        id: page.id,
        name: page.name,
        picture,
        accessToken: page.access_token,
        instagram: igAccount ? { id: igAccount.id, username: igAccount.username, picture: igPicture } : null,
      };
    }));

    // If only one page, auto-select it (skip picker)
    if (pagesWithDetails.length === 1) {
      const page = pagesWithDetails[0];

      // Cross-client conflict check — is this IG/Page already linked to another client?
      const conflict = detectConflictForNewConnection(agencyId, clientId, page.instagram?.id, page.id);
      if (conflict) {
        const clients = getClientsByAgency(agencyId);
        const targetName = clients.find((c: any) => c.id === clientId)?.name || clientId;
        const identifier = conflict.reason === 'instagram'
          ? (page.instagram?.username ? '@' + page.instagram.username : 'Instagram account')
          : (page.name || 'Facebook page');
        console.warn(`[Meta OAuth] BLOCKED conflict — ${identifier} already owned by ${conflict.conflictingClientName} (attempted on ${targetName})`);
        return res.send(renderConflictPage({
          attemptedClientId: clientId,
          attemptedClientName: targetName,
          conflictingClientId: conflict.conflictingClientId,
          conflictingClientName: conflict.conflictingClientName,
          identifier,
          reason: conflict.reason,
        }));
      }

      const now = Date.now();
      const integration = {
        id: `meta_${agencyId}_${clientId}_${now}`,
        agencyId,
        clientId,
        metaAccessToken: page.accessToken,
        metaUserAccessToken: longToken,
        metaPageId: page.id,
        metaPageName: page.name,
        metaPagePicture: page.picture,
        metaInstagramAccountId: page.instagram?.id,
        metaInstagramUsername: page.instagram?.username,
        metaInstagramPicture: page.instagram?.picture,
        metaUserId: '', // We could fetch /me but not critical
        scopesGranted: granted,
        status: 'connected' as const,
        tokenExpiresAt: now + (expires_in * 1000),
        lastVerifiedAt: now,
        connectedAt: now,
        connectedBy: userId,
        updatedAt: now,
        // Clear any previous error flags from smart detection
        connectionStatus: 'ok' as const,
        connectionError: undefined,
        connectionFlaggedAt: undefined,
      };
      saveMetaIntegration(integration);
      console.log(`[Meta OAuth] Auto-connected page "${page.name}" for client ${clientId}`);
      return res.send(renderResultPage(true, undefined, page.name, page.instagram?.username, clientId));
    }

    // Multiple pages — store session for page picker
    const sessionKey = crypto.randomBytes(24).toString('hex');
    oauthSessions.set(sessionKey, {
      userToken: longToken,
      agencyId,
      clientId,
      userId,
      pages: pagesWithDetails,
      permissions: granted,
      createdAt: Date.now(),
    });

    // Send pages list to parent window for page picker
    return res.send(renderPagePickerRedirect(sessionKey, pagesWithDetails, clientId));

  } catch (error: any) {
    console.error('[Meta OAuth] Callback error:', error);
    return res.send(renderResultPage(false, error.message || 'Connection failed'));
  }
});

/**
 * POST /select-page
 * After the page picker, save the selected page as the connection
 */
router.post('/select-page', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionKey, pageId } = req.body;
    if (!sessionKey || !pageId) {
      return res.status(400).json({ error: 'sessionKey and pageId required' });
    }

    const session = oauthSessions.get(sessionKey);
    if (!session) {
      return res.status(400).json({ error: 'Session expired. Please reconnect.' });
    }

    const { agencyId } = getAgencyScope(req);
    if (session.agencyId !== agencyId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    const page = session.pages.find(p => p.id === pageId);
    if (!page) {
      return res.status(400).json({ error: 'Page not found in session' });
    }

    // Cross-client conflict check — is this IG/Page already linked to another client?
    const conflict = detectConflictForNewConnection(agencyId, session.clientId, page.instagram?.id, page.id);
    if (conflict) {
      const clients = getClientsByAgency(agencyId);
      const targetName = clients.find((c: any) => c.id === session.clientId)?.name || session.clientId;
      const identifier = conflict.reason === 'instagram'
        ? (page.instagram?.username ? '@' + page.instagram.username : 'Instagram account')
        : (page.name || 'Facebook page');
      console.warn(`[Meta OAuth] BLOCKED conflict — ${identifier} already owned by ${conflict.conflictingClientName} (attempted on ${targetName})`);
      return res.status(409).json({
        error: 'conflict',
        conflict: {
          attemptedClientId: session.clientId,
          attemptedClientName: targetName,
          conflictingClientId: conflict.conflictingClientId,
          conflictingClientName: conflict.conflictingClientName,
          identifier,
          reason: conflict.reason,
        },
      });
    }

    const now = Date.now();
    const integration = {
      id: `meta_${agencyId}_${session.clientId}_${now}`,
      agencyId,
      clientId: session.clientId,
      metaAccessToken: page.accessToken,
      metaUserAccessToken: session.userToken,
      metaPageId: page.id,
      metaPageName: page.name,
      metaPagePicture: page.picture,
      metaInstagramAccountId: page.instagram?.id,
      metaInstagramUsername: page.instagram?.username,
      metaInstagramPicture: page.instagram?.picture,
      scopesGranted: session.permissions,
      status: 'connected' as const,
      tokenExpiresAt: now + (60 * 24 * 60 * 60 * 1000), // 60 days for user token
      lastVerifiedAt: now,
      connectedAt: now,
      connectedBy: session.userId,
      updatedAt: now,
      // Clear any previous error flags
      connectionStatus: 'ok' as const,
      connectionError: undefined,
      connectionFlaggedAt: undefined,
    };

    // Remove old connection for this client first
    deleteMetaIntegrationByClient(agencyId, session.clientId);
    saveMetaIntegration(integration);

    // Clean up session
    oauthSessions.delete(sessionKey);

    console.log(`[Meta OAuth] Connected page "${page.name}" for client ${session.clientId}`);
    res.json({
      success: true,
      connection: {
        pageId: page.id,
        pageName: page.name,
        pagePicture: page.picture,
        instagramId: page.instagram?.id,
        instagramUsername: page.instagram?.username,
        instagramPicture: page.instagram?.picture,
        status: 'connected',
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to save connection' });
  }
});

// ═══════════════════════════════════════════════════════
// 2. CONNECTION MANAGEMENT
// ═══════════════════════════════════════════════════════

/**
 * GET /connections/client/:clientId
 * Get connection status for a specific client
 */
router.get('/connections/client/:clientId', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const integration = getMetaIntegrationByClient(agencyId, req.params.clientId);

    if (!integration) {
      return res.json({ connected: false, status: 'none' });
    }

    const tokenExpired = integration.tokenExpiresAt < Date.now();
    // Surface connection flags from smart error detection
    const connStatus = (integration as any).connectionStatus;
    const isFlagged = connStatus && connStatus !== 'ok';
    const status = isFlagged ? 'error' : tokenExpired ? 'expired' : ((integration as any).status || 'connected');

    res.json({
      connected: status === 'connected',
      status,
      pageId: integration.metaPageId,
      pageName: integration.metaPageName,
      pagePicture: (integration as any).metaPagePicture,
      instagramId: integration.metaInstagramAccountId,
      instagramUsername: integration.metaInstagramUsername,
      instagramPicture: (integration as any).metaInstagramPicture,
      scopesGranted: (integration as any).scopesGranted || [],
      tokenExpiresAt: new Date(integration.tokenExpiresAt).toISOString(),
      lastVerifiedAt: (integration as any).lastVerifiedAt ? new Date((integration as any).lastVerifiedAt).toISOString() : null,
      connectedAt: integration.connectedAt ? new Date(integration.connectedAt).toISOString() : null,
      errorMessage: isFlagged ? (integration as any).connectionError : (integration as any).errorMessage,
      daysUntilExpiry: Math.max(0, Math.floor((integration.tokenExpiresAt - Date.now()) / (1000 * 60 * 60 * 24))),
      // Smart error detection fields
      connectionStatus: connStatus || 'ok',
      connectionError: (integration as any).connectionError || null,
      connectionFlaggedAt: (integration as any).connectionFlaggedAt ? new Date((integration as any).connectionFlaggedAt).toISOString() : null,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /connections/all
 * Get all connections for the agency (dashboard overview).
 * Also includes `conflicts` — any IG/Page account that ended up linked
 * to more than one client within the agency, so the UI can surface a warning.
 */
router.get('/connections/all', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const all = getMetaIntegrations();
    const connections = Object.values(all)
      .filter(i => i.agencyId === agencyId)
      .map(i => {
        const tokenExpired = i.tokenExpiresAt < Date.now();
        return {
          clientId: i.clientId,
          status: tokenExpired ? 'expired' : ((i as any).status || 'connected'),
          pageId: i.metaPageId,
          pageName: i.metaPageName,
          pagePicture: (i as any).metaPagePicture,
          instagramId: i.metaInstagramAccountId,
          instagramUsername: i.metaInstagramUsername,
          instagramPicture: (i as any).metaInstagramPicture,
          daysUntilExpiry: Math.max(0, Math.floor((i.tokenExpiresAt - Date.now()) / (1000 * 60 * 60 * 24))),
          lastVerifiedAt: (i as any).lastVerifiedAt ? new Date((i as any).lastVerifiedAt).toISOString() : null,
          errorMessage: (i as any).errorMessage,
        };
      });
    const conflicts = findAllAgencyConflicts(agencyId);
    res.json({ success: true, connections, conflicts });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * GET /connections/conflicts
 * Returns only the conflicts (same IG/Page linked to 2+ clients).
 * Lightweight endpoint for fast polling from the overview/dashboard.
 */
router.get('/connections/conflicts', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const conflicts = findAllAgencyConflicts(agencyId);
    res.json({ success: true, conflicts });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /connections/:clientId/verify
 * Test the connection by calling the Graph API
 * Includes auto-recovery: if page token fails, refreshes from user token
 */
router.post('/connections/:clientId/verify', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const integration = getMetaIntegrationByClient(agencyId, req.params.clientId);
    if (!integration) return res.json({ status: 'none', message: 'No connection found' });

    let userToken = (integration as any).metaUserAccessToken;
    let autoFixed = false;
    let status = 'connected';
    let errorMessage: string | undefined;

    // Step 1: Check user token permissions
    let permissions: string[] = [];
    if (userToken) {
      try {
        const permRes = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${userToken}`);
        const permData: any = await permRes.json();
        if (permData.error) {
          errorMessage = `User token invalid: ${permData.error.message}`;
          status = 'expired';
        } else {
          permissions = (permData.data || []).filter((p: any) => p.status === 'granted').map((p: any) => p.permission);
        }
      } catch (e: any) {
        errorMessage = e.message;
        status = 'error';
      }
    }

    // Step 2: Test page token
    let pageValid = false;
    if (status === 'connected') {
      try {
        const pageRes = await fetch(`https://graph.facebook.com/v21.0/${integration.metaPageId}?fields=id,name&access_token=${integration.metaAccessToken}`);
        const pageData: any = await pageRes.json();
        if (pageData.error) {
          // Page token failed — try auto-recovery
          console.log(`[Meta verify] Page token failed for ${req.params.clientId}: ${pageData.error.message}`);

          if (userToken) {
            try {
              // Try refreshing user token first
              try {
                const refreshed = await refreshLongLivedToken(userToken);
                userToken = refreshed.access_token;
                (integration as any).metaUserAccessToken = refreshed.access_token;
                integration.tokenExpiresAt = Date.now() + (refreshed.expires_in * 1000);
              } catch { /* keep existing token */ }

              // Get fresh page token
              const freshPages = await getPages(userToken);
              const freshPage = freshPages.find(p => p.id === integration.metaPageId) || freshPages[0];
              if (freshPage) {
                integration.metaAccessToken = freshPage.access_token;
                integration.metaPageId = freshPage.id;
                integration.metaPageName = freshPage.name;

                // Verify the new token works
                const retest = await fetch(`https://graph.facebook.com/v21.0/${freshPage.id}?fields=id,name&access_token=${freshPage.access_token}`);
                const retestData: any = await retest.json();
                if (!retestData.error) {
                  pageValid = true;
                  autoFixed = true;

                  // Also refresh IG account
                  try {
                    const igAcct = await getInstagramAccount(freshPage.id, freshPage.access_token);
                    if (igAcct) {
                      integration.metaInstagramAccountId = igAcct.id;
                      integration.metaInstagramUsername = igAcct.username;
                    }
                  } catch { /* keep existing */ }

                  console.log(`[Meta verify] Auto-recovered connection for ${req.params.clientId}`);
                }
              }
            } catch (recoveryErr: any) {
              console.log(`[Meta verify] Auto-recovery failed: ${recoveryErr.message}`);
            }
          }

          if (!pageValid) {
            status = 'expired';
            errorMessage = pageData.error.message;
          }
        } else {
          pageValid = true;
        }
      } catch (e: any) {
        status = 'error';
        errorMessage = e.message;
      }
    }

    // Step 3: Update stored connection
    (integration as any).status = pageValid ? 'connected' : status;
    (integration as any).lastVerifiedAt = Date.now();
    (integration as any).errorMessage = pageValid ? undefined : errorMessage;
    if (pageValid) {
      (integration as any).scopesGranted = permissions;
      // Clear smart error flags if connection is now working
      if ((integration as any).connectionStatus && (integration as any).connectionStatus !== 'ok') {
        console.log(`[Meta verify] Clearing error flags for ${req.params.clientId} — connection restored`);
        (integration as any).connectionStatus = 'ok';
        (integration as any).connectionError = undefined;
        (integration as any).connectionFlaggedAt = undefined;
      }
    }
    integration.updatedAt = Date.now();
    saveMetaIntegration(integration);

    res.json({
      status: pageValid ? 'connected' : status,
      autoFixed,
      pageValid,
      permissions,
      errorMessage: pageValid ? undefined : errorMessage,
      pageName: integration.metaPageName,
      instagramUsername: integration.metaInstagramUsername,
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /connections/:clientId/disconnect
 * Disconnect Meta for a client
 */
router.post('/connections/:clientId/disconnect', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const clientId = req.params.clientId;

    // Don't revoke on Facebook — just remove from our DB
    // This way reconnecting is smooth (no need to go to FB settings)
    deleteMetaIntegrationByClient(agencyId, clientId);
    console.log(`[Meta] Disconnected client ${clientId}`);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /connections/:clientId/disconnect-full
 * Full disconnect — also revoke on Facebook (for when things are really broken)
 */
router.post('/connections/:clientId/disconnect-full', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const clientId = req.params.clientId;
    const integration = getMetaIntegrationByClient(agencyId, clientId);

    if (integration) {
      const token = (integration as any).metaUserAccessToken || integration.metaAccessToken;
      try {
        await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${token}`, { method: 'DELETE' });
        console.log(`[Meta] Revoked permissions on Facebook for client ${clientId}`);
      } catch (e: any) {
        console.log(`[Meta] Facebook revocation failed (non-critical): ${e.message}`);
      }
    }

    deleteMetaIntegrationByClient(agencyId, clientId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════
// 3. HEALTH CHECK (cron)
// ═══════════════════════════════════════════════════════

/**
 * POST /health-check
 * Run by a cron job — verifies all active connections
 * Protected by API key
 */
router.post('/health-check', async (req: Request, res: Response) => {
  const apiKey = req.headers['x-api-key'] || req.query.key;
  const expectedKey = process.env.CRON_API_KEY || process.env.META_APP_SECRET;
  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const all = getMetaIntegrations();

  // Filter to active integrations only
  const activeIntegrations = Object.values(all).filter(
    (i) => ((i as any).status || 'connected') !== 'disconnected'
  );

  // Helper: wrap a promise with a timeout so one slow client can't block the rest
  function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout after ${ms}ms for ${label}`)), ms);
      promise.then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });
  }

  // Check ALL integrations in parallel (5s timeout per check)
  const PER_CLIENT_TIMEOUT = 5000;

  const results = await Promise.all(activeIntegrations.map(async (integration) => {
    try {
      // Quick check: can we read the page?
      const pageRes = await withTimeout(
        fetch(`https://graph.facebook.com/v21.0/${integration.metaPageId}?fields=id,name&access_token=${integration.metaAccessToken}`),
        PER_CLIENT_TIMEOUT,
        integration.clientId,
      );
      const pageData: any = await pageRes.json();

      if (pageData.error) {
        // Try auto-recovery with user token
        const userToken = (integration as any).metaUserAccessToken;
        let recovered = false;
        if (userToken) {
          try {
            const freshPages = await withTimeout(
              getPages(userToken),
              PER_CLIENT_TIMEOUT,
              `recovery-${integration.clientId}`,
            );
            const freshPage = freshPages.find(p => p.id === integration.metaPageId) || freshPages[0];
            if (freshPage) {
              integration.metaAccessToken = freshPage.access_token;
              (integration as any).status = 'connected';
              (integration as any).lastVerifiedAt = Date.now();
              (integration as any).errorMessage = undefined;
              integration.updatedAt = Date.now();
              saveMetaIntegration(integration);
              recovered = true;
            }
          } catch { /* recovery failed */ }
        }

        if (!recovered) {
          (integration as any).status = 'expired';
          (integration as any).errorMessage = pageData.error.message;
          (integration as any).lastVerifiedAt = Date.now();
          integration.updatedAt = Date.now();
          saveMetaIntegration(integration);
        }

        return {
          clientId: integration.clientId,
          pageName: integration.metaPageName || '',
          status: recovered ? 'recovered' : 'expired',
          error: recovered ? undefined : pageData.error.message,
        };
      } else {
        // Connection is healthy
        (integration as any).status = 'connected';
        (integration as any).lastVerifiedAt = Date.now();
        (integration as any).errorMessage = undefined;
        integration.updatedAt = Date.now();
        saveMetaIntegration(integration);

        return {
          clientId: integration.clientId,
          pageName: integration.metaPageName || '',
          status: 'connected' as const,
        };
      }
    } catch (e: any) {
      return {
        clientId: integration.clientId,
        pageName: integration.metaPageName || '',
        status: 'error' as const,
        error: e.message,
      };
    }
  }));

  console.log(`[Meta health-check] Checked ${results.length} connections in parallel: ${results.filter(r => r.status === 'connected').length} healthy, ${results.filter(r => r.status === 'expired').length} expired, ${results.filter(r => r.status === 'recovered').length} recovered, ${results.filter(r => r.status === 'error').length} errors`);
  res.json({ success: true, results });
});

// ═══════════════════════════════════════════════════════
// 4. LEGACY COMPATIBILITY
// These mirror the old API paths so existing code still works
// ═══════════════════════════════════════════════════════

/** Legacy: GET /status?clientId=xxx (used by scheduled posts tab) */
router.get('/status', authenticate, requireCanViewDashboard, (req: AuthenticatedRequest, res) => {
  const clientId = req.query.clientId as string;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const { agencyId } = getAgencyScope(req);
  const integration = getMetaIntegrationByClient(agencyId, clientId);

  if (!integration) {
    return res.json({ connected: false, pageName: null, instagramUsername: null });
  }

  const tokenExpired = integration.tokenExpiresAt < Date.now();
  const status = tokenExpired ? 'expired' : ((integration as any).status || 'connected');

  if (status !== 'connected') {
    return res.json({
      connected: false,
      status,
      pageName: integration.metaPageName,
      instagramUsername: integration.metaInstagramUsername,
      error: (integration as any).errorMessage || (tokenExpired ? 'Token expired. Please reconnect.' : undefined),
    });
  }

  const daysUntilExpiry = Math.floor((integration.tokenExpiresAt - Date.now()) / (1000 * 60 * 60 * 24));
  res.json({
    connected: true,
    status: 'connected',
    pageName: integration.metaPageName,
    pagePicture: (integration as any).metaPagePicture,
    instagramUsername: integration.metaInstagramUsername,
    instagramPicture: (integration as any).metaInstagramPicture,
    connectedAt: integration.connectedAt,
    expiresAt: new Date(integration.tokenExpiresAt).toISOString(),
    daysUntilExpiry,
  });
});

/** Legacy: POST /disconnect (used by scheduled posts tab) */
router.post('/disconnect', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res) => {
  const clientId = req.body?.clientId;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const { agencyId } = getAgencyScope(req);
  deleteMetaIntegrationByClient(agencyId, clientId);
  res.json({ success: true });
});

/** Legacy: GET /debug?clientId=xxx (used by Test Connection button) */
router.get('/debug', authenticate, requireCanViewDashboard, async (req: AuthenticatedRequest, res) => {
  // Just proxy to the verify endpoint logic
  const clientId = req.query.clientId as string;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  const { agencyId } = getAgencyScope(req);
  const integration = getMetaIntegrationByClient(agencyId, clientId);
  if (!integration) return res.json({ connected: false, message: 'No integration found' });

  // Inline verify logic for backward compatibility
  let userToken = (integration as any).metaUserAccessToken;
  let pageValid = false;
  let canPost = false;
  let autoFixed = false;
  let permissions: string[] = [];
  let permError: string | undefined;
  let pageError: string | undefined;
  let postError: string | undefined;

  // Check permissions
  if (userToken) {
    try {
      const permRes = await fetch(`https://graph.facebook.com/v21.0/me/permissions?access_token=${userToken}`);
      const permData: any = await permRes.json();
      if (permData.error) permError = permData.error.message;
      else permissions = (permData.data || []).filter((p: any) => p.status === 'granted').map((p: any) => p.permission);
    } catch (e: any) { permError = e.message; }
  }

  // Test page token
  try {
    const pageRes = await fetch(`https://graph.facebook.com/v21.0/${integration.metaPageId}?fields=id,name&access_token=${integration.metaAccessToken}`);
    const pageData: any = await pageRes.json();
    if (pageData.error) pageError = pageData.error.message;
    else pageValid = true;
  } catch (e: any) { pageError = e.message; }

  try {
    const testRes = await fetch(`https://graph.facebook.com/v21.0/${integration.metaPageId}?fields=id,name,access_token&access_token=${integration.metaAccessToken}`);
    const testData: any = await testRes.json();
    if (testData.error) postError = testData.error.message;
    else canPost = true;
  } catch (e: any) { postError = e.message; }

  // Auto-recovery
  if ((!pageValid || !canPost) && userToken && !permError) {
    try {
      try {
        const refreshed = await refreshLongLivedToken(userToken);
        userToken = refreshed.access_token;
        (integration as any).metaUserAccessToken = refreshed.access_token;
        integration.tokenExpiresAt = Date.now() + (refreshed.expires_in * 1000);
      } catch { /* keep existing */ }

      const freshPages = await getPages(userToken);
      const freshPage = freshPages.find(p => p.id === integration.metaPageId) || freshPages[0];
      if (freshPage) {
        integration.metaAccessToken = freshPage.access_token;
        integration.metaPageId = freshPage.id;
        integration.metaPageName = freshPage.name;
        integration.updatedAt = Date.now();
        try {
          const igAcct = await getInstagramAccount(freshPage.id, freshPage.access_token);
          if (igAcct) {
            integration.metaInstagramAccountId = igAcct.id;
            integration.metaInstagramUsername = igAcct.username;
          }
        } catch { /* keep */ }
        saveMetaIntegration(integration);
        autoFixed = true;
        pageError = undefined;
        postError = undefined;

        const retestRes = await fetch(`https://graph.facebook.com/v21.0/${freshPage.id}?fields=id,name&access_token=${freshPage.access_token}`);
        const retestData: any = await retestRes.json();
        pageValid = !retestData.error;
        canPost = pageValid;
      }
    } catch { /* recovery failed */ }
  }

  // Update status
  (integration as any).lastVerifiedAt = Date.now();
  (integration as any).status = pageValid ? 'connected' : 'expired';
  integration.updatedAt = Date.now();
  saveMetaIntegration(integration);

  const tokenExpired = integration.tokenExpiresAt < Date.now();
  res.json({
    connected: !tokenExpired && pageValid,
    tokenExpired,
    hasUserToken: !!userToken,
    hasManagePosts: permissions.includes('pages_manage_posts'),
    autoFixed,
    expiresAt: new Date(integration.tokenExpiresAt).toISOString(),
    pageId: integration.metaPageId,
    pageName: integration.metaPageName,
    igAccountId: integration.metaInstagramAccountId,
    igUsername: integration.metaInstagramUsername,
    permissions,
    declinedPermissions: (permError ? [] : []),
    permError,
    pageValid,
    pageError,
    canPost,
    postError,
  });
});

// ═══════════════════════════════════════════════════════
// HTML Renderers
// ═══════════════════════════════════════════════════════

/**
 * Rendered in the OAuth popup when we detect a cross-client conflict and
 * refuse to save the connection. Posts a META_CONFLICT message to the opener
 * so the main app can show a modal alert.
 */
function renderConflictPage(info: {
  attemptedClientId: string;
  attemptedClientName: string;
  conflictingClientId: string;
  conflictingClientName: string;
  identifier: string;
  reason: 'instagram' | 'page';
}): string {
  const esc = (s: string) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
  const payload = JSON.stringify(info).replace(/</g, '\\u003c');
  const kind = info.reason === 'instagram' ? 'Instagram account' : 'Facebook page';
  return `<!DOCTYPE html><html><head><title>Connection Blocked</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:60px auto;padding:28px;text-align:center;background:#fef2f2;border:1px solid #fecaca;border-radius:12px;}
h1{color:#991b1b;margin:0 0 12px;font-size:22px;}
.box{background:white;border:1px solid #fecaca;border-radius:10px;padding:16px;margin:16px 0;text-align:left;font-size:14px;color:#0f172a;}
.label{font-size:11px;font-weight:700;color:#991b1b;text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px;}
.btn{display:inline-block;margin-top:12px;padding:11px 22px;background:#dc2626;color:white;text-decoration:none;border-radius:8px;font-weight:600;cursor:pointer;border:none;font-size:14px;}</style></head><body>
<h1>⚠️ Connection Blocked — Wrong Client</h1>
<p style="color:#7f1d1d;margin:0 0 8px;">The ${kind} you tried to connect is already linked to a different client.</p>
<div class="box">
  <div class="label">${kind}</div>
  <div style="margin-bottom:10px;font-weight:600;">${esc(info.identifier)}</div>
  <div class="label">Already connected to</div>
  <div style="margin-bottom:10px;font-weight:600;color:#1a56db;">${esc(info.conflictingClientName)}</div>
  <div class="label">You were trying to connect it to</div>
  <div style="font-weight:600;">${esc(info.attemptedClientName)}</div>
</div>
<p style="color:#7f1d1d;font-size:13px;margin:0 0 8px;">No changes were saved. Double-check that you picked the correct Facebook page in the popup, or disconnect it from the other client first if this was intentional.</p>
<button class="btn" onclick="if(window.opener){window.opener.postMessage({type:'META_CONFLICT',conflict:${payload}},'*');window.close();}else{window.close();}">Close</button>
</body></html>`;
}

function renderResultPage(success: boolean, error?: string, pageName?: string, igUsername?: string, clientId?: string): string {
  const redirectUrl = clientId
    ? `${FRONTEND_URL}/agency#client=${encodeURIComponent(clientId)}&tab=scheduled`
    : `${FRONTEND_URL}/agency`;
  const safeClientId = (clientId || '').replace(/'/g, "\\'");
  return `<!DOCTYPE html><html><head><title>${success ? 'Connected' : 'Error'}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:80px auto;padding:24px;text-align:center;}
.ok{color:#059669;} .err{color:#dc2626;}
.btn{display:inline-block;margin-top:16px;padding:12px 24px;background:#0052CC;color:white;text-decoration:none;border-radius:8px;font-weight:600;cursor:pointer;border:none;font-size:15px;}
.btn:hover{background:#003d99;}</style></head><body>
<h1>${success ? '✅ Connected!' : '❌ Connection Failed'}</h1>
${success ? `<p class="ok"><strong>${pageName || 'Facebook Page'}</strong>${igUsername ? ` + @${igUsername}` : ''}</p>` : ''}
${error ? `<p class="err">${error}</p>` : ''}
<p style="color:#64748b;font-size:14px;">You can close this window.</p>
<button class="btn" onclick="if(window.opener){window.opener.postMessage({type:'META_CONNECTED',success:${success},clientId:'${safeClientId}'},'*');window.close();}else{window.location='${redirectUrl}';}">Close</button>
</body></html>`;
}

function renderPagePickerRedirect(sessionKey: string, pages: OAuthSession['pages'], clientId: string): string {
  const pagesJson = JSON.stringify(pages.map(p => ({
    id: p.id,
    name: p.name,
    picture: p.picture,
    instagram: p.instagram ? { username: p.instagram.username, picture: p.instagram.picture } : null,
  })));

  return `<!DOCTYPE html><html><head><title>Select a Page</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:80px auto;padding:24px;text-align:center;}</style></head><body>
<p style="color:#64748b;">Sending page list to 2FlyFlow...</p>
<script>
try {
  if (window.opener) {
    window.opener.postMessage({
      type: 'META_PAGES',
      sessionKey: ${JSON.stringify(sessionKey)},
      clientId: ${JSON.stringify(clientId)},
      pages: ${pagesJson}
    }, '*');
    setTimeout(function(){ window.close(); }, 500);
  } else {
    document.body.innerHTML = '<p>Could not communicate with 2FlyFlow. Please close this window and try again.</p>';
  }
} catch(e) {
  document.body.innerHTML = '<p>Error: ' + e.message + '</p>';
}
</script></body></html>`;
}

export default router;
