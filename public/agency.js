/* ================== Agency Dashboard Script ================== */

/* ================== Authentication ================== */
const LS_STAFF_SESSION_KEY = "2fly_staff_session";

function isLocal() {
  return window.location.protocol === 'file:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
}

function staffLoginUrl() {
  if (window.location.protocol === 'file:') {
    const p = window.location.pathname;
    const base = p.substring(0, p.lastIndexOf('/'));
    return base + '/staff-login.html';
  }
  return isLocal() ? '/staff-login.html' : '/staff-login';
}

function checkStaffAuth() {
  const session = localStorage.getItem(LS_STAFF_SESSION_KEY);
  if (!session) {
    window.location.href = staffLoginUrl();
    return null;
  }
  try {
    const sessionData = JSON.parse(session);
    if (Date.now() - sessionData.loggedInAt > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(LS_STAFF_SESSION_KEY);
      window.location.href = staffLoginUrl();
      return null;
    }
    return sessionData;
  } catch {
    localStorage.removeItem(LS_STAFF_SESSION_KEY);
    window.location.href = staffLoginUrl();
    return null;
  }
}

function logout() {
  localStorage.removeItem(LS_STAFF_SESSION_KEY);
  window.location.href = staffLoginUrl();
}

// Check authentication on page load
let currentStaff = checkStaffAuth();

/* ================== State Management ================== */
const LS_CLIENTS_KEY = "2fly_agency_clients_v1";
const LS_REPORTS_KEY = "client_portal_reports_v1";
const LS_LAST_CLIENT_KEY = "2fly_agency_last_client";
const LS_ONBOARDING = "2fly_onboarding_v1";
const HAS_SEEN_ONBOARDING = "hasSeenOnboarding";
const LS_PIPELINE_SEEN = "2fly_pipeline_modal_seen";
const ONBOARDING_SIDEBAR_DAYS = 7;
const TEAM_PIN = "2468";
const DEFAULT_AGENCY_ID = "agency_1737676800000_abc123";

// Current selected client
let currentClientId = null;

// Production View (designer workflow)
let currentViewMode = 'dashboard'; // 'dashboard' | 'production'
let currentProductionSection = 'demands'; // 'demands' | 'ai-library' | 'references'
let isDesigner = currentStaff && (currentStaff.role === 'DESIGNER');
let productionTasksCache = [];
let designersCache = [];
let productionNavBound = false;
let demandFilterStatus = '';
let demandFilterClient = '';
let demandFilterDueToday = false;
let demandFilterOverdue = false;
let currentProductionTaskId = null;
let demandViewMode = 'table';
let productionSortCol = null; // null | 'task' | 'timeline' | 'assignee' | 'status'
let productionSortDir = null; // null | 'asc' | 'desc'
let productionCollapsedClients = {};
let productionFiltersOpen = false;
let demandFilterAssignee = '';
let designerViewMode = 'focus'; // focus | list | clients
let designerSearchQuery = '';
let designerCollapsedStatuses = {};
let designerStatFilter = ''; // '' | 'remaining' | 'overdue' | 'revisions' | 'due_today' | 'done'

// Agency-scoped data from API (dashboard is agencyId-scoped; only prefs use userId).
let clientsRegistryCache = {};
let portalStateCache = {};
// Track which clients have been successfully fetched from the API.
// save() is blocked until the client's state has been loaded at least once,
// preventing empty/default state from overwriting real server data.
const portalStateFetched = new Set();

const metaStatusCache = {};

async function getMetaStatusForClient(clientId) {
  if (metaStatusCache[clientId] !== undefined) return metaStatusCache[clientId];
  try {
    const r = await fetch(`${getApiBaseUrl()}/api/integrations/meta/status?clientId=${encodeURIComponent(clientId)}`, { credentials: 'include' });
    const data = await r.json();
    metaStatusCache[clientId] = !!(data && data.connected);
    return metaStatusCache[clientId];
  } catch {
    metaStatusCache[clientId] = false;
    return false;
  }
}

function getApiBaseUrl() {
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return 'https://api.2flyflow.com';
  }
  return window.__2FLY_API_BASE__ || 'http://localhost:3004';
}

function getAgencyIdFromSession() {
  try {
    const s = localStorage.getItem(LS_STAFF_SESSION_KEY);
    if (!s) return DEFAULT_AGENCY_ID;
    const d = JSON.parse(s);
    return d.agencyId || DEFAULT_AGENCY_ID;
  } catch {
    return DEFAULT_AGENCY_ID;
  }
}

/* ================== Onboarding state ================== */
function getOnboardingState() {
  try {
    const raw = localStorage.getItem(LS_ONBOARDING);
    if (!raw) return { step: 1, completed: false, dismissedAt: null, checklist: { clients: 0, assets: 0, posts: 0, approvals: 0, invited: false }, firstVisitAt: Date.now() };
    const d = JSON.parse(raw);
    d.firstVisitAt = d.firstVisitAt || Date.now();
    d.checklist = d.checklist || { clients: 0, assets: 0, posts: 0, approvals: 0, invited: false };
    return d;
  } catch {
    return { step: 1, completed: false, dismissedAt: null, checklist: { clients: 0, assets: 0, posts: 0, approvals: 0, invited: false }, firstVisitAt: Date.now() };
  }
}

function saveOnboardingState(state) {
  try {
    localStorage.setItem(LS_ONBOARDING, JSON.stringify(state));
  } catch (e) { console.warn('saveOnboardingState', e); }
}

/**
 * Whether to auto-show the onboarding modal on this page load.
 * First-visit logic (localStorage key "hasSeenOnboarding"):
 * - If localStorage.getItem("hasSeenOnboarding") is null → may show (and we will set it).
 * - If set (e.g. "true") → do NOT show.
 * Optional: if agency has > 0 clients, must NOT show. So we only show when flag is null AND clientCount === 0.
 */
function shouldAutoShowOnboarding(clientsMap) {
  try {
    if (localStorage.getItem(HAS_SEEN_ONBOARDING) !== null) return false;
    const clientCount = (clientsMap != null && typeof clientsMap === 'object') ? Object.keys(clientsMap).length : 0;
    if (clientCount > 0) return false;
    return true;
  } catch (e) {
    console.warn('shouldAutoShowOnboarding', e);
    return false;
  }
}

function setHasSeenOnboarding() {
  try {
    localStorage.setItem(HAS_SEEN_ONBOARDING, "true");
  } catch (e) { console.warn('setHasSeenOnboarding', e); }
}

/** Legacy helper for checklist/sidebar; keep for compatibility. */
function isFirstVisitOrNoClients(clientsMap) {
  return shouldAutoShowOnboarding(clientsMap);
}

function showOnboardingOverlay(step) {
  const overlay = document.getElementById('onboardingOverlay');
  if (!overlay) {
    console.warn('Onboarding overlay element #onboardingOverlay not found');
    return;
  }
  overlay.style.setProperty('display', 'flex');
  overlay.classList.add('onboarding-overlay--show');
  const stepNum = Math.max(1, Math.min(6, parseInt(step, 10) || 1));
  [1, 2, 3, 4, 5, 6].forEach(s => {
    const stepEl = document.getElementById('onboardingStep' + s);
    if (stepEl) stepEl.style.display = s === stepNum ? 'block' : 'none';
  });
}

function hideOnboardingOverlay() {
  const overlay = document.getElementById('onboardingOverlay');
  if (overlay) {
    overlay.style.setProperty('display', 'none');
    overlay.classList.remove('onboarding-overlay--show');
  }
}

function showPipelineModal() {
  const seen = localStorage.getItem(LS_PIPELINE_SEEN);
  if (seen) return false;
  const modal = $('#pipelineModal');
  if (modal) modal.classList.add('show');
  return true;
}

function setPipelineModalSeen() {
  localStorage.setItem(LS_PIPELINE_SEEN, '1');
}

async function parseJsonOrThrow(r, url) {
  const ct = r.headers.get('content-type') || '';
  const text = await r.text();
  if (!ct.includes('application/json') || text.trim().startsWith('<')) {
    const hint = isLocal() ? ' Make sure the backend is running: cd server && npm start' : '';
    const msg = 'API returned HTML instead of JSON. Is the server running on ' + getApiBaseUrl() + '?' + hint;
    console.error('[parseJsonOrThrow]', msg, { url: url || 'unknown', status: r.status, contentType: ct, bodyPreview: text.slice(0, 200) });
    throw new Error(msg);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('[parseJsonOrThrow] Invalid JSON', { url: url || 'unknown', status: r.status, parseError: e.message, bodyPreview: text.slice(0, 200) });
    throw new Error('Invalid API response: ' + (e.message || 'parse error'));
  }
}

async function fetchClientsFromAPI() {
  const url = `${getApiBaseUrl()}/api/agency/clients`;
  let r;
  try {
    r = await fetch(url, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (fetchErr) {
    console.error('[fetchClientsFromAPI] Network error', { url, error: fetchErr.message, name: fetchErr.name });
    throw fetchErr;
  }
  if (!r.ok) {
    console.error('[fetchClientsFromAPI] Non-OK response', { url, status: r.status, statusText: r.statusText });
  }
  const j = await parseJsonOrThrow(r, url);
  if (!r.ok) throw new Error(j.error || 'Failed to fetch clients');
  const list = j.clients || [];
  const map = {};
  list.forEach(c => { map[c.id] = c; });
  clientsRegistryCache = map;
  return map;
}

async function fetchPortalStateFromAPI(clientId) {
  const prev = portalStateCache[clientId] || null;
  const url = `${getApiBaseUrl()}/api/agency/portal-state?clientId=${encodeURIComponent(clientId)}&_=${Date.now()}`;
  const r = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
  });
  const j = await parseJsonOrThrow(r);
  if (!r.ok) throw new Error(j.error || 'Failed to fetch portal state');
  const data = j.data;
  if (data) {
    const prevApprovals = Array.isArray(prev && prev.approvals) ? prev.approvals : [];
    const dataApprovals = Array.isArray(data.approvals) ? data.approvals : [];
    // Detect client-side actions: status changes from pending → approved/changes, or item deleted
    if (prev && prevApprovals.length >= 0 && dataApprovals.length >= 0) {
      const prevById = {};
      prevApprovals.forEach(function(a) { prevById[a.id] = a; });
      const dataIds = {};
      dataApprovals.forEach(function(a) { dataIds[a.id] = true; });
      dataApprovals.forEach(function(a) {
        const old = prevById[a.id];
        const oldStatus = old ? (old.status || 'pending') : null;
        const newStatus = a.status || 'pending';
        if (oldStatus !== newStatus) {
          if (newStatus === 'approved' || newStatus === 'copy_approved') {
            if (oldStatus === 'pending' || oldStatus === 'copy_pending' || !oldStatus) {
              createNotification({ type: 'PROGRESS', title: 'Client approved', message: (a.title || 'Post') + ' was approved by client.', clientId: clientId, action: { label: 'View approvals', href: '#approvals' } });
            }
          } else if (newStatus === 'changes' || newStatus === 'copy_changes') {
            if (oldStatus === 'pending' || oldStatus === 'copy_pending' || oldStatus === 'copy_approved' || !oldStatus) {
              createNotification({ type: 'ACTION', title: 'Client requested changes', message: (a.title || 'Post') + ' – client requested changes.', clientId: clientId, action: { label: 'View approvals', href: '#approvals' } });
            }
          }
        }
      });
      prevApprovals.forEach(function(a) {
        if (!dataIds[a.id]) {
          createNotification({ type: 'ACTION', title: 'Client deleted post', message: (a.title || 'Post') + ' was removed by client.', clientId: clientId, action: { label: 'View approvals', href: '#approvals' } });
        }
      });
    }
    const prevRequests = Array.isArray(prev && prev.requests) ? prev.requests : [];
    const dataRequests = Array.isArray(data.requests) ? data.requests : [];
    if (prev && prevRequests.length >= 0 && dataRequests.length >= 0) {
      var prevReqIds = {};
      prevRequests.forEach(function(r) { prevReqIds[r.id] = true; });
      dataRequests.forEach(function(r) {
        if (!prevReqIds[r.id] && r.status === 'open') {
          var msg = (r.type || 'Request') + (r.details && r.details !== '(no details)' ? ': ' + r.details.slice(0, 50) + (r.details.length > 50 ? '…' : '') : '');
          createNotification({ type: 'ACTION', title: 'Client submitted a request', message: msg, clientId: clientId, action: { label: 'View requests', href: '#requests' } });
        }
      });
    }
    portalStateCache[clientId] = data;
    portalStateFetched.add(clientId);
  }
  return data;
}

async function savePortalStateToAPI(clientId, data) {
  const r = await fetch(`${getApiBaseUrl()}/api/agency/portal-state`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, data })
  });
  const j = await parseJsonOrThrow(r);
  if (!r.ok) throw new Error(j.error || 'Failed to save portal state');
}

function loadClientsRegistry() {
  return clientsRegistryCache;
}

function saveClientsRegistry(clients) {
  clientsRegistryCache = typeof clients === 'object' ? clients : {};
}

function getCurrentClient() {
  return clientsRegistryCache[currentClientId] || null;
}

function getClientPortalKey(clientId) {
  return `client_portal_${clientId}_v1`;
}

/** localStorage key for assets per client: assets_${clientId} */
const ASSETS_STORAGE_PREFIX = 'assets_';

function getAssetsStorageKey(clientId) {
  return clientId ? ASSETS_STORAGE_PREFIX + clientId : null;
}

/** Detect cloud provider from URL. Returns GOOGLE_DRIVE | DROPBOX | FIGMA | CANVA | URL. */
function parseProviderFromUrl(url) {
  if (!url || typeof url !== 'string') return 'URL';
  const u = url.trim().toLowerCase();
  if (u.includes('drive.google.com')) return 'GOOGLE_DRIVE';
  if (u.includes('dropbox.com')) return 'DROPBOX';
  if (u.includes('figma.com')) return 'FIGMA';
  if (u.includes('canva.com')) return 'CANVA';
  return 'URL';
}

/** Extract Google Drive file ID from URL. Supports /file/d/<ID>/, open?id=, uc?id=, thumbnail?id=. */
function extractGoogleDriveFileId(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim();
  if (!u.includes('drive.google.com')) return null;
  const m1 = u.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) return m1[1];
  const m2 = u.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m2 ? m2[1] : null;
}

/** Preview URL for asset: Drive thumbnail (w800) for GOOGLE_DRIVE PHOTO/GRAPHIC, or direct image URL. */
function getPreviewUrl(asset) {
  if (!asset || !asset.url) return null;
  const mt = (asset.mediaType || '').toUpperCase();
  const isPhotoOrGraphic = mt === 'PHOTO' || mt === 'GRAPHIC';
  if (!isPhotoOrGraphic) return null;
  if (asset.sourceProvider === 'GOOGLE_DRIVE') {
    const id = extractGoogleDriveFileId(asset.url);
    if (id) return 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(id);
  }
  const u = (asset.url || '').trim().toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/.test(u)) return asset.url;
  return null;
}

/** Convert any image URL to a displayable src — Google Drive share links become embeddable URLs. */
function toDisplayableImageUrl(url) {
  if (!url || typeof url !== 'string') return url;
  var fileId = extractGoogleDriveFileId(url);
  if (fileId) return 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(fileId);
  return url;
}

/** Ordered fallback URLs for a Google Drive file. Returns array or null. */
function getDriveFallbackUrls(url) {
  if (!url || typeof url !== 'string') return null;
  var fileId = extractGoogleDriveFileId(url);
  if (!fileId) return null;
  var eid = encodeURIComponent(fileId);
  return [
    'https://lh3.googleusercontent.com/d/' + eid,
    'https://drive.google.com/thumbnail?id=' + eid + '&sz=w800',
    'https://drive.google.com/uc?export=view&id=' + eid
  ];
}

/** Parse comma-separated pillars into trimmed unique array. */
function normalizePillars(input) {
  if (!input || typeof input !== 'string') return [];
  return [...new Set(input.split(',').map(p => p.trim()).filter(Boolean))];
}

/** Migrate old asset shape to new Asset model. Backfill thumbnailUrl when missing. */
function migrateAsset(old) {
  const status = (old.status || old.approvalStatus || 'PENDING').toUpperCase().replace(/\s+/g, '_');
  const approvalStatus = ['PENDING', 'APPROVED', 'NEEDS_CHANGES', 'REJECTED'].includes(status) ? status : 'PENDING';
  const out = {
    id: old.id || 'asset' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    title: old.title || 'Untitled',
    sourceType: old.sourceType || 'LINK',
    sourceProvider: old.sourceProvider || parseProviderFromUrl(old.url || ''),
    url: old.url || '',
    mediaType: (old.mediaType || (old.type && old.type.toUpperCase()) || 'PHOTO').replace(/\s+/g, '_'),
    formatUse: (old.formatUse || 'ANY').toUpperCase().replace(/\s+/g, '_'),
    pillars: Array.isArray(old.pillars) ? old.pillars : (old.tags ? (old.tags.map && old.tags.map(t => String(t).trim()) || []) : []),
    approvalStatus,
    clientNotes: old.clientNotes || '',
    internalNotes: old.internalNotes || '',
    createdAt: old.createdAt || new Date().toISOString(),
    updatedAt: old.updatedAt || new Date().toISOString(),
    approvedAt: approvalStatus === 'APPROVED' ? (old.approvedAt || new Date().toISOString()) : null,
    thumbnailUrl: old.thumbnailUrl || null
  };
  if (!out.thumbnailUrl) out.thumbnailUrl = getPreviewUrl(out);
  return out;
}

/** Load assets for a client from localStorage. Migrates old state.assets and seeds demo for Sudbury Point Grill if empty. */
function loadAssets(clientId) {
  const key = getAssetsStorageKey(clientId);
  if (!key) return [];
  let raw = localStorage.getItem(key);
  let list = [];
  if (raw) {
    try {
      list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    } catch (_) { list = []; }
  }
  // Migrate from old portal state if new list empty and old state had assets
  const state = portalStateCache[clientId];
  const oldAssets = state && Array.isArray(state.assets) ? state.assets : [];
  const oldForClient = oldAssets.filter(a => a.clientId === clientId || !a.clientId);
  if (list.length === 0 && oldForClient.length > 0) {
    list = oldForClient.map(migrateAsset);
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (_) {}
    if (state && state.assets) state.assets = state.assets.filter(a => a.clientId !== clientId);
  }
  list = list.map(a => (a.approvalStatus !== undefined ? a : migrateAsset(a)));
  // Backfill thumbnailUrl for old assets
  let backfilled = false;
  list.forEach(a => {
    if (!a.thumbnailUrl) {
      a.thumbnailUrl = getPreviewUrl(a);
      if (a.thumbnailUrl) backfilled = true;
    }
  });
  if (backfilled) try { localStorage.setItem(key, JSON.stringify(list)); } catch (_) {}
  // Seed demo data for Sudbury Point Grill when empty
  const clients = loadClientsRegistry();
  const client = clients[clientId];
  const name = (client && client.name) || '';
  if (list.length === 0 && name.toLowerCase().includes('sudbury point grill')) {
    list = seedDemoAssetsForSudbury();
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (_) {}
  }
  return list;
}

/** Seed 6 demo assets for Sudbury Point Grill. */
function seedDemoAssetsForSudbury() {
  const now = new Date().toISOString();
  return [
    { id: 'asset_demo_1', title: 'Menu hero image', sourceType: 'LINK', sourceProvider: 'GOOGLE_DRIVE', url: 'https://drive.google.com/file/d/abc123/view', mediaType: 'PHOTO', formatUse: 'POST', pillars: ['Menu'], approvalStatus: 'APPROVED', clientNotes: '', internalNotes: '', createdAt: now, updatedAt: now, approvedAt: now, thumbnailUrl: null },
    { id: 'asset_demo_2', title: 'Summer event banner', sourceType: 'LINK', sourceProvider: 'GOOGLE_DRIVE', url: 'https://drive.google.com/file/d/def456/view', mediaType: 'PHOTO', formatUse: 'POST', pillars: ['Event'], approvalStatus: 'APPROVED', clientNotes: '', internalNotes: '', createdAt: now, updatedAt: now, approvedAt: now, thumbnailUrl: null },
    { id: 'asset_demo_3', title: 'BTS kitchen shot', sourceType: 'LINK', sourceProvider: 'GOOGLE_DRIVE', url: 'https://drive.google.com/file/d/ghi789/view', mediaType: 'PHOTO', formatUse: 'REEL', pillars: ['BTS'], approvalStatus: 'APPROVED', clientNotes: '', internalNotes: '', createdAt: now, updatedAt: now, approvedAt: now, thumbnailUrl: null },
    { id: 'asset_demo_4', title: 'Promo video 30s', sourceType: 'LINK', sourceProvider: 'DROPBOX', url: 'https://www.dropbox.com/s/xyz/promo.mp4', mediaType: 'VIDEO', formatUse: 'AD', pillars: ['Promo'], approvalStatus: 'PENDING', clientNotes: '', internalNotes: '', createdAt: now, updatedAt: now, approvedAt: null, thumbnailUrl: null },
    { id: 'asset_demo_5', title: 'Brand logo lockup', sourceType: 'LINK', sourceProvider: 'CANVA', url: 'https://www.canva.com/design/abc/brand', mediaType: 'GRAPHIC', formatUse: 'ANY', pillars: ['Branding'], approvalStatus: 'NEEDS_CHANGES', clientNotes: 'Adjust spacing', internalNotes: '', createdAt: now, updatedAt: now, approvedAt: null, thumbnailUrl: null },
    { id: 'asset_demo_6', title: 'Menu PDF v2', sourceType: 'LINK', sourceProvider: 'URL', url: 'https://example.com/menu.pdf', mediaType: 'DOC', formatUse: 'ANY', pillars: [], approvalStatus: 'REJECTED', clientNotes: '', internalNotes: 'Outdated', createdAt: now, updatedAt: now, approvedAt: null, thumbnailUrl: null }
  ];
}

/** Persist a single asset (create or update) for client. */
function saveAsset(clientId, asset) {
  const key = getAssetsStorageKey(clientId);
  if (!key) return;
  let list = loadAssets(clientId);
  const now = new Date().toISOString();
  const approvedAt = (asset.approvalStatus === 'APPROVED') ? now : (asset.approvedAt || null);
  const full = {
    id: asset.id || 'asset' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    title: asset.title || 'Untitled',
    sourceType: asset.sourceType || 'LINK',
    sourceProvider: asset.sourceProvider || 'URL',
    url: asset.url || '',
    mediaType: (asset.mediaType || 'PHOTO').toUpperCase().replace(/\s+/g, '_'),
    formatUse: (asset.formatUse || 'ANY').toUpperCase().replace(/\s+/g, '_'),
    pillars: Array.isArray(asset.pillars) ? asset.pillars : normalizePillars(asset.pillars || ''),
    approvalStatus: (asset.approvalStatus || 'PENDING').toUpperCase().replace(/\s+/g, '_'),
    clientNotes: asset.clientNotes || '',
    internalNotes: asset.internalNotes || '',
    createdAt: asset.createdAt || now,
    updatedAt: now,
    approvedAt,
    thumbnailUrl: asset.thumbnailUrl || null
  };
  if (!full.thumbnailUrl) full.thumbnailUrl = getPreviewUrl(full);
  const idx = list.findIndex(a => a.id === full.id);
  if (idx >= 0) list[idx] = full; else list.push(full);
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { console.warn('saveAsset', e); }
}

/** Update only approval status and timestamps. */
function updateAssetStatus(clientId, assetId, newStatus) {
  const key = getAssetsStorageKey(clientId);
  if (!key) return;
  const list = loadAssets(clientId);
  const asset = list.find(a => a.id === assetId);
  if (!asset) return;
  const now = new Date().toISOString();
  asset.approvalStatus = newStatus;
  asset.updatedAt = now;
  asset.approvedAt = (newStatus === 'APPROVED') ? now : (newStatus === 'APPROVED' ? asset.approvedAt : null);
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { console.warn('updateAssetStatus', e); }
  const clients = loadClientsRegistry();
  const clientName = (clients && clients[clientId] && clients[clientId].name) || 'Client';
  if (newStatus === 'APPROVED') createNotification({ type: 'PROGRESS', title: 'Asset approved', message: (asset.title || 'Asset') + ' is ready to use.', clientId, action: { label: 'View assets', href: '#contentlibrary' } });
  else if (newStatus === 'NEEDS_CHANGES') createNotification({ type: 'ACTION', title: 'Asset needs changes', message: 'Client requested changes: ' + (asset.title || 'asset'), clientId, action: { label: 'Open assets', href: '#contentlibrary' } });
}

/** Filter assets by formatUse, pillar, mediaType, and approvedOnly. */
function filterAssets(assets, filters) {
  if (!assets || !assets.length) return [];
  let out = assets.slice();
  if (filters.formatUse && filters.formatUse !== 'ANY' && filters.formatUse !== '') {
    out = out.filter(a => (a.formatUse || 'ANY') === filters.formatUse);
  }
  if (filters.pillar && filters.pillar !== '') {
    out = out.filter(a => (a.pillars || []).includes(filters.pillar));
  }
  if (filters.mediaType && filters.mediaType !== '') {
    out = out.filter(a => (a.mediaType || '') === filters.mediaType);
  }
  if (filters.approvedOnly) {
    out = out.filter(a => (a.approvalStatus || '') === 'APPROVED');
  }
  return out;
}

/** Short label for sourceProvider. */
function getProviderLabel(provider) {
  const map = { GOOGLE_DRIVE: 'Drive', DROPBOX: 'Dropbox', FIGMA: 'Figma', CANVA: 'Canva', URL: 'Link', LOCAL_UPLOAD: 'Upload' };
  return map[provider] || provider || 'Link';
}

/* ================== Notifications ================== */
const NOTIFICATIONS_KEY = 'notifications_agency';

function loadNotifications() {
  try {
    const raw = localStorage.getItem(NOTIFICATIONS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (_) { return []; }
}

function saveNotifications(list) {
  try {
    localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(list));
  } catch (e) { console.warn('saveNotifications', e); }
}

function deleteNotification(id) {
  const list = loadNotifications().filter(function(n) { return n.id !== id; });
  saveNotifications(list);
  renderNotificationBell();
}

/** Create and store one notification. ACTION defaults to unread; PROGRESS/REWARD default read. */
function createNotification(opts) {
  const type = opts.type || 'PROGRESS';
  const n = {
    id: 'n' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
    type,
    title: opts.title || '',
    message: opts.message || '',
    clientId: opts.clientId ?? null,
    action: opts.action || null,
    read: type !== 'ACTION',
    createdAt: opts.createdAt || new Date().toISOString()
  };
  const list = loadNotifications();
  list.unshift(n);
  saveNotifications(list);
  renderNotificationBell();
  return n;
}

function timeAgo(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'Just now';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  if (sec < 604800) return Math.floor(sec / 86400) + 'd ago';
  return d.toLocaleDateString();
}

function renderNotificationBell() {
  const list = loadNotifications();
  const unread = list.filter(n => !n.read);
  const actionUnread = list.filter(n => n.type === 'ACTION' && !n.read);
  const badge = $('#notifBadge');
  const badgeNum = actionUnread.length > 0 ? actionUnread.length : (unread.length > 0 ? unread.length : 0);
  if (badge) {
    badge.textContent = String(badgeNum);
    badge.style.display = badgeNum > 0 ? 'block' : 'none';
    badge.classList.toggle('notif-badge--action', actionUnread.length > 0);
  }
  const dropdown = $('#notifDropdown');
  const listEl = $('#notifList');
  const emptyEl = $('#notifEmpty');
  if (!listEl) return;
  listEl.innerHTML = '';
  if (list.length === 0) {
    if (emptyEl) { emptyEl.style.display = 'block'; emptyEl.textContent = "You're clear today"; }
    return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  const clients = loadClientsRegistry();
  const byClient = {};
  list.forEach(n => {
    const key = n.clientId || '_none';
    if (!byClient[key]) byClient[key] = [];
    byClient[key].push(n);
  });
  const order = ['_none'].concat(Object.keys(byClient).filter(k => k !== '_none'));
  order.forEach(key => {
    const group = byClient[key];
    if (!group || !group.length) return;
    const groupDiv = document.createElement('div');
    groupDiv.className = 'notif-group';
    const title = document.createElement('div');
    title.className = 'notif-group__title';
    title.textContent = key === '_none' ? 'General' : (clients[key] && clients[key].name) || key;
    groupDiv.appendChild(title);
    group.forEach(n => {
      const icon = n.type === 'ACTION' ? '⚠️' : n.type === 'REWARD' ? '⭐' : '✅';
      const item = document.createElement('div');
      item.className = 'notif-item' + (n.read ? '' : ' unread notif-item--' + n.type.toLowerCase());
      item.dataset.id = n.id;
      item.innerHTML = '<span class="notif-item__icon">' + icon + '</span><div class="notif-item__body"><div class="notif-item__title">' + (n.title || '').replace(/</g, '&lt;') + '</div><div class="notif-item__message">' + (n.message || '').replace(/</g, '&lt;') + '</div><div class="notif-item__time">' + timeAgo(n.createdAt) + '</div></div><button type="button" class="notif-item__dismiss" aria-label="Dismiss">×</button>';
      const dismissBtn = item.querySelector('.notif-item__dismiss');
      if (dismissBtn) {
        dismissBtn.addEventListener('click', function(e) {
          e.stopPropagation();
          deleteNotification(n.id);
        });
      }
      item.addEventListener('click', () => {
        const list2 = loadNotifications();
        const nn = list2.find(x => x.id === n.id);
        if (nn) { nn.read = true; saveNotifications(list2); }
        if (n.action && n.action.href) {
          if (typeof applyNotificationAction === 'function') applyNotificationAction(n.action.href);
          else if (typeof switchTab === 'function') switchTab((n.action.href || '').replace(/^#/, '') || 'overview');
        }
        renderNotificationBell();
        if (dropdown) dropdown.style.display = 'none';
      });
      groupDiv.appendChild(item);
    });
    listEl.appendChild(groupDiv);
  });
  updateNotificationHeaderMessage();
}

function updateNotificationHeaderMessage() {
  const list = loadNotifications();
  const actionUnread = list.filter(n => n.type === 'ACTION' && !n.read);
  const unread = list.filter(n => !n.read);
  const clearEl = $('#headerClearToday');
  const statusText = $('.header-status__text');
  if (!clearEl) return;
  if (unread.length === 0) {
    clearEl.style.display = 'inline';
    clearEl.textContent = "You're clear today";
    if (statusText) statusText.textContent = "You're clear today";
  } else if (actionUnread.length === 0) {
    clearEl.style.display = 'inline';
    clearEl.textContent = 'All clear today ✅';
    if (statusText) statusText.textContent = 'All clear today ✅';
  } else {
    clearEl.style.display = 'none';
    if (statusText) statusText.textContent = actionUnread.length + ' action' + (actionUnread.length > 1 ? 's' : '') + ' needed';
  }
}

function setupNotificationBell() {
  const btn = $('#notifBellBtn');
  const dropdown = $('#notifDropdown');
  if (btn && dropdown) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = dropdown.style.display === 'flex';
      dropdown.style.display = open ? 'none' : 'flex';
    });
    document.addEventListener('click', (e) => {
      if (dropdown.style.display === 'flex' && !dropdown.contains(e.target) && !btn.contains(e.target)) dropdown.style.display = 'none';
    });
  }
  const markAll = $('#notifMarkAllRead');
  if (markAll) markAll.addEventListener('click', () => {
    saveNotifications([]);
    renderNotificationBell();
  });
  renderNotificationBell();
}

/** Trigger checks for REWARD/ACTION (all clear, no scheduled 7d). Call after state changes. */
function runNotificationTriggers() {
  const clients = loadClientsRegistry();
  const clientIds = Object.keys(clients || {});
  if (clientIds.length === 0) return;
  const now = new Date();
  const in7 = new Date(now);
  in7.setDate(now.getDate() + 7);
  let anyScheduled = false;
  let anyPending = false;
  clientIds.forEach(cid => {
    const state = portalStateCache[cid] || {};
    const approvals = state.approvals || [];
    anyPending = anyPending || approvals.some(a => !a.status || a.status === 'pending' || a.status === 'copy_pending');
    approvals.forEach(a => {
      if (a.postDate) {
        const d = new Date(a.postDate);
        if (d >= now && d <= in7) anyScheduled = true;
      }
    });
  });
  if (!anyScheduled && clientIds.length > 0) {
    const list = loadNotifications();
    const already = list.some(n => n.title && n.title.indexOf('No posts scheduled') !== -1 && new Date(n.createdAt).toDateString() === now.toDateString());
    if (!already) createNotification({ type: 'ACTION', title: 'No posts scheduled', message: 'No posts scheduled for the next 7 days.', action: { label: 'Plan', href: '#approvals' } });
  }
  if (!anyPending && clientIds.length > 0) {
    const list = loadNotifications();
    const already = list.some(n => n.title && n.title.indexOf('All clients clear') !== -1 && new Date(n.createdAt).toDateString() === now.toDateString());
    if (!already) createNotification({ type: 'REWARD', title: 'All clients clear', message: "You're ahead this week.", action: { label: 'Overview', href: '#overview' } });
  }
}

/* ================== Monthly Progress Summary (auto notification per client) ================== */
const PROGRESS_SUMMARY_LEDGER_KEY = 'progressSummaryLedger';

function getMonthKey(date) {
  const d = date || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return y + '-' + m;
}

function getProgressSummaryLedger() {
  try {
    const raw = localStorage.getItem(PROGRESS_SUMMARY_LEDGER_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return typeof o === 'object' && o !== null ? o : {};
  } catch (e) { return {}; }
}

function setProgressSummarySent(clientId, monthKey) {
  const ledger = getProgressSummaryLedger();
  if (!ledger[clientId]) ledger[clientId] = {};
  ledger[clientId][monthKey] = true;
  try { localStorage.setItem(PROGRESS_SUMMARY_LEDGER_KEY, JSON.stringify(ledger)); } catch (e) {}
}

function wasProgressSummarySentForMonth(clientId, monthKey) {
  const ledger = getProgressSummaryLedger();
  return !!(ledger[clientId] && ledger[clientId][monthKey]);
}

function buildProgressSummary(clientId) {
  const clients = loadClientsRegistry();
  const client = (clients && clients[clientId]) || null;
  const clientName = (client && client.name) || clientId || 'Client';
  const state = portalStateCache[clientId] || {};
  const approvals = state.approvals || [];
  const requests = state.requests || [];
  const approvedCount = approvals.filter(a => a.status === 'approved').length;
  const scheduledCount = approvals.filter(a => a.status === 'approved' && a.postDate).length;
  const postsCount = approvedCount || scheduledCount || approvals.length;
  const requestsResolved = requests.filter(r => r.status === 'done').length;
  let report = null;
  try { report = loadReports(); } catch (e) {}
  const adsRunning = (report && report.ads && typeof report.ads.running === 'number') ? report.ads.running : 0;
  const prev = (report && report.prev) || null;
  const curVis = report && report.visibility ? ((report.visibility.gmbViews || 0) + (report.visibility.profileSearches || 0) + (report.visibility.websiteClicks || 0)) : 0;
  const prevVis = prev && prev.visibility ? ((prev.visibility.gmbViews || 0) + (prev.visibility.profileSearches || 0) + (prev.visibility.websiteClicks || 0)) : 0;
  const growthPct = (prevVis > 0 && curVis >= 0) ? Math.max(0, Math.round((curVis - prevVis) / prevVis * 100)) : null;
  const work = (report && report.work) || {};
  const posts = (work.posts != null) ? work.posts : postsCount;
  const reels = (work.reels != null) ? work.reels : 0;
  const campaigns = (work.campaigns != null) ? work.campaigns : 0;
  const requestsWork = (work.requestsResolved != null) ? work.requestsResolved : requestsResolved;

  const stats = { posts, reels, campaigns, requests: requestsWork, adsRunning, growthPct };

  const hasWork = posts > 0 || reels > 0 || campaigns > 0 || requestsWork > 0;
  const hasAds = adsRunning > 0;
  const hasGrowth = growthPct != null && growthPct > 0;

  let title = 'Monthly progress ready — ' + clientName;
  if (Math.random() < 0.5) title = 'Your monthly wins — ' + clientName;

  let message;
  if (hasWork && (posts > 0 || reels > 0)) {
    const parts = [];
    if (posts > 0) parts.push(posts + ' posts published');
    if (reels > 0) parts.push(reels + ' reels edited');
    if (campaigns > 0) parts.push(campaigns + ' campaign(s) launched');
    if (requestsWork > 0) parts.push(requestsWork + ' client requests resolved');
    message = parts.join(' • ') + '.';
  } else if (hasAds || hasGrowth) {
    const parts = [];
    if (hasAds) parts.push('Ads active (' + adsRunning + ')');
    if (hasGrowth) parts.push('Visibility up ' + growthPct + '%');
    parts.push('Content engine on track.');
    message = parts.join(' • ');
  } else {
    message = "We kept your content moving consistently this month. Tap to view the highlights.";
  }

  return { title, message, highlights: [], stats };
}

function applyNotificationAction(href) {
  if (!href || typeof href !== 'string') return;
  const hash = href.replace(/^#/, '').trim();
  const params = new URLSearchParams(hash);
  const clientId = params.get('client');
  const tab = params.get('tab');
  if (clientId && tab) {
    if (typeof selectClient === 'function') selectClient(clientId);
    if (typeof switchTab === 'function') switchTab(tab);
    return;
  }
  const tabOnly = hash.split('&')[0];
  if (typeof switchTab === 'function') switchTab(tabOnly || 'overview');
}

function maybeGenerateMonthlyProgressSummaryNotifications() {
  const monthKey = getMonthKey();
  const clients = loadClientsRegistry();
  const clientIds = (clients && typeof clients === 'object') ? Object.keys(clients) : [];
  let created = 0;
  const logReasons = [];

  clientIds.forEach(cid => {
    if (wasProgressSummarySentForMonth(cid, monthKey)) {
      logReasons.push({ clientId: cid, reason: 'skipped (already sent this month)' });
      return;
    }
    const client = clients[cid];
    if (client && client.createdAt) {
      const createdMs = typeof client.createdAt === 'number' ? client.createdAt : new Date(client.createdAt).getTime();
      if (Date.now() - createdMs < 3 * 24 * 60 * 60 * 1000) {
        logReasons.push({ clientId: cid, reason: 'skipped (client created within last 3 days)' });
        return;
      }
    }
    const summary = buildProgressSummary(cid);
    createNotification({
      type: 'PROGRESS',
      title: summary.title,
      message: summary.message,
      clientId: cid,
      action: { label: 'View Progress', href: '#client=' + encodeURIComponent(cid) + '&tab=reports' }
    });
    setProgressSummarySent(cid, monthKey);
    created++;
    logReasons.push({ clientId: cid, reason: 'sent' });
  });


  if (created > 0 && typeof window !== 'undefined') {
    window._progressSummaryToastShown = window._progressSummaryToastShown || false;
    if (!window._progressSummaryToastShown && typeof showToast === 'function') {
      showToast('Monthly progress summaries generated ✅');
      window._progressSummaryToastShown = true;
    }
  }
}

if (typeof window !== 'undefined') {
  window.runMonthlyProgressSummary = function () {
    if (typeof maybeGenerateMonthlyProgressSummaryNotifications === 'function') maybeGenerateMonthlyProgressSummaryNotifications();
  };
}

function load() {
  if (!currentClientId) return _emptyState();
  const cached = portalStateCache[currentClientId];
  if (cached) {
    if (!Array.isArray(cached.assets)) cached.assets = [];
    return cached;
  }
  const client = getCurrentClient();
  return _emptyState(client?.name, client?.primaryContactWhatsApp);
}

function _emptyState(name, whatsapp) {
  return {
    client: { id: currentClientId, name: name || 'Client', whatsapp: whatsapp || '' },
    kpis: { scheduled: 0, waitingApproval: 0, missingAssets: 0, frustration: 0 },
    approvals: [],
    needs: [],
    requests: [],
    assets: [],
    activity: [],
    seen: false
  };
}

function save(x) {
  if (!currentClientId) return;
  if (!portalStateFetched.has(currentClientId)) {
    console.warn('save() blocked — portal state for', currentClientId, 'was never fetched from API');
    return;
  }
  portalStateCache[currentClientId] = x;
  savePortalStateToAPI(currentClientId, x).catch(err => {
    console.error('Save portal state failed:', err);
    showToast('Failed to save. ' + (err.message || ''), 'error');
  });
}

function loadReports() {
  const raw = localStorage.getItem(LS_REPORTS_KEY);
  if (!raw) {
    const reportSeed = {
      period: "Nov 2025",
      ads: { running: 4, impressions: 48000, clicks: 1200, leads: 35 },
      visibility: { gmbViews: 3800, profileSearches: 1200, websiteClicks: 220, igFollowersDelta: 75 },
      work: { posts: 16, reels: 8, campaigns: 2, requestsResolved: 3 },
      prev: {
        period: "Oct 2025",
        ads: { running: 3, impressions: 42000, clicks: 1100, leads: 31 },
        visibility: { gmbViews: 3220, profileSearches: 1090, websiteClicks: 208, igFollowersDelta: 54 },
        work: { posts: 15, reels: 6, campaigns: 1, requestsResolved: 2 }
      }
    };
    localStorage.setItem(LS_REPORTS_KEY, JSON.stringify(reportSeed));
    return reportSeed;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {
      period: "Nov 2025",
      ads: { running: 0, impressions: 0, clicks: 0, leads: 0 },
      visibility: { gmbViews: 0, profileSearches: 0, websiteClicks: 0, igFollowersDelta: 0 },
      work: { posts: 0, reels: 0, campaigns: 0, requestsResolved: 0 },
      prev: null
    };
  }
}

function saveReports(r) {
  localStorage.setItem(LS_REPORTS_KEY, JSON.stringify(r));
}

/* ================== Helpers ================== */
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  });
  kids.forEach(k => node.append(k));
  return node;
};

const fmtDate = ts => new Date(ts).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

// Calculate scheduled posts (approvals with postDate within next 15 days)
function calculateScheduledPosts(approvals) {
  if (!approvals || !Array.isArray(approvals)) return 0;
  const now = new Date();
  const fifteenDaysFromNow = new Date(now);
  fifteenDaysFromNow.setDate(now.getDate() + 15);
  return approvals.filter(a => {
    if (!a.postDate) return false;
    const postDate = new Date(a.postDate);
    return postDate >= now && postDate <= fifteenDaysFromNow;
  }).length;
}

/** Relative time for overview request rows */
function overviewRelativeTime(ts) {
  if (ts == null || ts === '') return '';
  var diff = Date.now() - (typeof ts === 'number' ? ts : new Date(ts).getTime());
  if (isNaN(diff) || diff < 0) return '';
  var mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  var wks = Math.floor(days / 7);
  return wks + 'w ago';
}

/** Open client requests (status open or legacy without done) */
function isClientRequestOpen(r) {
  if (!r) return false;
  if (r.status === 'done' || r.status === 'closed' || r.done === true) return false;
  return r.status === 'open' || r.status == null || r.status === '';
}

/** Red count badges on Approvals / Requests / Agency Needs tabs */
function updateTabCountBadges() {
  var badgeStyle = 'display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;margin-left:4px;vertical-align:middle;';
  function setBadge(tabName, count) {
    var tab = document.querySelector('.tab[data-tab="' + tabName + '"]');
    if (!tab) return;
    var existing = tab.querySelector('.tab-count-badge');
    if (count > 0) {
      if (!existing) {
        existing = document.createElement('span');
        existing.className = 'tab-count-badge';
        existing.setAttribute('aria-label', count + ' items');
        existing.style.cssText = badgeStyle;
        tab.appendChild(existing);
      }
      existing.textContent = String(count);
    } else if (existing) {
      existing.remove();
    }
  }
  if (!currentClientId) {
    document.querySelectorAll('.tab-count-badge').forEach(function(b) { b.remove(); });
    return;
  }
  var state = load();
  var approvals = state.approvals || [];
  var pendingApprovals = approvals.filter(function(a) {
    return !a.status || a.status === 'pending' || a.status === 'changes';
  });
  var openReqs = (state.requests || []).filter(isClientRequestOpen);
  var openNeeds = (state.needs || []).filter(function(n) { return !n.status || n.status === 'open'; });
  setBadge('approvals', pendingApprovals.length);
  setBadge('requests', openReqs.length);
  setBadge('needs', openNeeds.length);
}

// Pipeline stage counts for Approvals page
function getApprovalPipelineCounts(approvals) {
  const list = approvals || [];
  const now = new Date();
  const fifteenDaysFromNow = new Date(now);
  fifteenDaysFromNow.setDate(now.getDate() + 15);
  const copyPending = list.filter(a => a.status === 'copy_pending').length;
  const copyApproved = list.filter(a => a.status === 'copy_approved').length;
  const copyChanges = list.filter(a => a.status === 'copy_changes').length;
  const awaiting = list.filter(a => ['copy_pending', 'copy_approved', 'pending'].includes(a.status)).length;
  const changes = list.filter(a => a.status === 'changes').length;
  const scheduled = list.filter(a => {
    if (a.status !== 'approved' || !a.postDate) return false;
    const postDate = new Date(a.postDate);
    return postDate >= now && postDate <= fifteenDaysFromNow;
  }).length;
  const approvedTotal = list.filter(a => a.status === 'approved').length;
  const approved = approvedTotal - scheduled;
  return { copyPending, copyApproved, copyChanges, awaiting, changes, approved, scheduled };
}

/* ================== Health & Next Action (action-driving layer) ================== */
const APPROVALS_STALE_DAYS_THRESHOLD = 3;

/** Days since a date string (ISO or timestamp). Returns 0 if invalid. */
function daysSince(dateString) {
  if (!dateString) return 0;
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return 0;
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  return Math.floor(diff / (24 * 60 * 60 * 1000));
}

/** Enrich client with computed metrics for health and next action. */
function getClientHealthData(clientId) {
  const clients = loadClientsRegistry();
  const client = clients[clientId];
  const state = portalStateCache[clientId] || _emptyState(client?.name, client?.primaryContactWhatsApp);
  const approvals = state.approvals || [];
  const awaitingList = approvals.filter(a => !a.status || a.status === 'pending' || a.status === 'copy_pending' || a.status === 'copy_approved');
  const awaitingCount = awaitingList.length;
  const scheduledCount = calculateScheduledPosts(approvals);
  const missingNeedsCount = state.kpis?.missingAssets ?? (state.needs || []).filter(n => !n.status || n.status === 'open').length;
  const requestsOpenCount = (state.requests || []).filter(r => r.status === 'open').length;
  const approvalTimes = awaitingList.map(a => new Date(a.updatedAt || a.createdAt || a.date).getTime()).filter(t => !isNaN(t));
  const lastApprovalRequestAt = approvalTimes.length ? Math.max(...approvalTimes) : null;
  const lastActivity = (state.activity || [])[state.activity?.length - 1];
  const lastClientActivityAt = lastActivity?.when || null;
  const assets = loadAssets(clientId);
  const lastAssetsUploadAt = assets.length ? Math.max(...assets.map(a => new Date(a.updatedAt || a.createdAt || 0).getTime()).filter(Boolean)) : null;
  const brandAssetsUploaded = assets.length > 0;
  const agencyNeedsProvided = missingNeedsCount === 0;
  const invitedToPortal = !!(state.invitedToPortal ?? client?.invitedToPortal);

  return {
    id: clientId,
    name: client?.name,
    logoUrl: client?.logoUrl,
    initials: (client?.name || 'CN').split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase(),
    scheduledPostsCountNext15Days: scheduledCount,
    awaitingApprovalCount: awaitingCount,
    missingAgencyNeedsCount: missingNeedsCount,
    lastClientActivityAt: lastClientActivityAt ? new Date(lastClientActivityAt).toISOString() : null,
    lastApprovalRequestAt: lastApprovalRequestAt ? new Date(lastApprovalRequestAt).toISOString() : null,
    lastAssetsUploadAt: lastAssetsUploadAt ? new Date(lastAssetsUploadAt).toISOString() : null,
    invitedToPortal,
    brandAssetsUploaded,
    agencyNeedsProvided,
    requestsOpenCount,
    approvalsStaleDays: lastApprovalRequestAt ? daysSince(new Date(lastApprovalRequestAt).toISOString()) : 0
  };
}

/** Compute health state: CRITICAL | WARNING | OK */
function computeHealth(data) {
  if (!data) return 'OK';
  const missingSetup = (data.missingAgencyNeedsCount > 0 || !data.brandAssetsUploaded || !data.invitedToPortal);
  if (missingSetup) return 'CRITICAL';
  const approvalStale = data.awaitingApprovalCount > 0 && data.approvalsStaleDays >= APPROVALS_STALE_DAYS_THRESHOLD;
  if (approvalStale) return 'WARNING';
  if (data.scheduledPostsCountNext15Days === 0) return 'WARNING';
  return 'OK';
}

/** Next action priority. Returns { label, sectionId } for CTA and scroll. */
function computeNextAction(data) {
  if (!data) return { label: 'Plan Next Week', sectionId: 'overview' };
  if (!data.brandAssetsUploaded) return { label: 'Upload Brand Assets', sectionId: 'contentlibrary' };
  if (!data.agencyNeedsProvided) return { label: 'Add Agency Needs', sectionId: 'needs' };
  if (!data.invitedToPortal) return { label: 'Invite Client', sectionId: 'invite' };
  const approvalStale = data.awaitingApprovalCount > 0 && data.approvalsStaleDays >= APPROVALS_STALE_DAYS_THRESHOLD;
  if (approvalStale) return { label: 'Nudge Approval', sectionId: 'approvals' };
  if (data.scheduledPostsCountNext15Days === 0) return { label: 'Create Posts', sectionId: 'contentlibrary' };
  if (data.requestsOpenCount > 0) return { label: 'Review Requests', sectionId: 'requests' };
  return { label: 'Plan Next Week', sectionId: 'overview' };
}

/** Global summary for top bar: { text, state }. */
function getGlobalStatusSummary() {
  const clients = loadClientsRegistry();
  const ids = Object.keys(clients);
  let critical = 0, warning = 0;
  ids.forEach(id => {
    const data = getClientHealthData(id);
    const h = computeHealth(data);
    if (h === 'CRITICAL') critical++;
    else if (h === 'WARNING') warning++;
  });
  if (critical > 0) return { text: `⚠️ ${critical} client(s) blocked — fix setup`, state: 'CRITICAL' };
  if (warning > 0) return { text: `⏳ ${warning} client(s) need attention today`, state: 'WARNING' };
  return { text: '✅ You\'re clear today', state: 'OK' };
}

/* ================== Client Selection ================== */
function renderClientsSidebar() {
  const clients = loadClientsRegistry();
  const container = $('#clientsList');
  if (!container) return;

  container.innerHTML = '';

  if (Object.keys(clients).length === 0) {
    container.appendChild(el('div', { style: 'color: rgba(255,255,255,0.7); font-size: 13px; padding: 16px; text-align: center;' }, 'No clients yet. Click "+ New Client" to add one.'));
    return;
  }

  Object.values(clients).forEach(client => {
    const healthData = getClientHealthData(client.id);
    const health = computeHealth(healthData);
    const healthLabel = health === 'CRITICAL' ? 'Setup blocked' : health === 'WARNING' ? 'Needs attention' : 'On track';

    const clientTile = el('div', {
      class: `client-tile ${currentClientId === client.id ? 'active' : ''}`,
      'data-client-id': client.id
    });

    const nameRow = el('div', { class: 'client-tile__name-row' });
    const dot = el('span', { class: `client-tile__health-dot client-tile__health-dot--${health.toLowerCase()}`, title: healthLabel });
    const name = el('div', { class: 'client-tile__name' });
    name.textContent = client.name;
    nameRow.appendChild(dot);
    nameRow.appendChild(name);

    const badges = el('div', { class: 'client-tile__badges' });
    const state = portalStateCache[client.id];
    if (state) {
      const pendingCount = (state.approvals || []).filter(a => !a.status || a.status === 'pending').length;
      const openRequests = (state.requests || []).filter(r => r.status === 'open').length;
      if (state.kpis && state.kpis.scheduled) {
        badges.appendChild(el('div', { class: 'badge' }, `${state.kpis.scheduled} scheduled`));
      }
      badges.appendChild(el('div', { class: 'badge' }, `${pendingCount} pending`));
      badges.appendChild(el('div', { class: 'badge' }, `${openRequests} requests`));
    }

    const microLabel = el('div', { class: 'client-tile__health-label' });
    microLabel.textContent = healthLabel;
    var actionUnreadForClient = (loadNotifications()).filter(function(n) { return n.type === 'ACTION' && !n.read && n.clientId === client.id; });
    if (actionUnreadForClient.length > 0) {
      var cue = el('span', { class: 'inline-cue inline-cue--action' }, 'Needs action today');
      microLabel.appendChild(document.createTextNode(' '));
      microLabel.appendChild(cue);
    }

    clientTile.appendChild(nameRow);
    clientTile.appendChild(badges);
    clientTile.appendChild(microLabel);

    clientTile.addEventListener('click', () => {
      selectClient(client.id);
    });

    container.appendChild(clientTile);
  });
}

async function selectClient(clientId) {
  const clients = loadClientsRegistry();
  const client = clients[clientId];
  if (!client) return;
  currentClientId = clientId;
  for (const k of Object.keys(metaStatusCache)) delete metaStatusCache[k];
  try {
    localStorage.setItem(LS_LAST_CLIENT_KEY, clientId);
  } catch (_) {}
  try {
    await fetchPortalStateFromAPI(clientId);
  } catch (e) {
    console.error('Fetch portal state (attempt 1):', e);
    // Retry once after a short delay instead of caching empty state
    try {
      await new Promise(r => setTimeout(r, 1000));
      await fetchPortalStateFromAPI(clientId);
    } catch (e2) {
      console.error('Fetch portal state (attempt 2):', e2);
      showToast('Could not load client data. Please refresh the page.', 'error');
      // Do NOT cache _emptyState — leave cache empty so save() is blocked
    }
  }
  renderClientsSidebar();
  renderClientHeader();
  renderAll();
}

/* ================== Client Header with Logo ================== */
function renderClientHeader() {
  if (!currentClientId) {
    const header = $('#clientHeader');
    if (header) header.style.display = 'none';
    return;
  }
  
  const clients = loadClientsRegistry();
  const client = clients[currentClientId];
  
  if (!client) {
    const header = $('#clientHeader');
    if (header) header.style.display = 'none';
    return;
  }
  
  const header = $('#clientHeader');
  const logoImg = $('#clientLogoImg');
  const logoInitials = $('#clientLogoInitials');
  const headerName = $('#clientHeaderName');
  
  if (!header) return;
  
  header.style.display = 'block';
  
  // Set client name
  if (headerName) {
    headerName.textContent = client.name || 'Client';
  }
  
  // Set logo or initials (Add Logo is now in kebab menu)
  if (client.logoUrl) {
    if (logoImg) {
      logoImg.src = client.logoUrl;
      logoImg.style.display = 'block';
    }
    if (logoInitials) {
      logoInitials.style.display = 'none';
    }
  } else {
    if (logoImg) {
      logoImg.style.display = 'none';
    }
    if (logoInitials) {
      logoInitials.style.display = 'block';
      const initials = (client.name || 'CN')
        .split(' ')
        .map(word => word.charAt(0))
        .join('')
        .substring(0, 2)
        .toUpperCase();
      logoInitials.textContent = initials || 'CN';
    }
  }
  
  setupLogoUpload();
  updateFlowCatState();
}

function updateFlowCatState() {
  var wrap = document.getElementById('flowCatWrap');
  if (!wrap) return;

  // Calculate workload
  var state = load();
  var total = 0;
  if (state) {
    total += (state.approvals || []).filter(function(a) { return !a.status || a.status === 'pending' || a.status === 'changes' || a.status === 'copy_pending'; }).length;
    total += (state.requests || []).filter(function(r) { return !r.done; }).length;
    total += (state.needs || []).filter(function(n) { return !n.done; }).length;
  }
  if (typeof productionTasksCache !== 'undefined') {
    total += productionTasksCache.filter(function(t) {
      return t.clientId === currentClientId && ['in_progress', 'assigned', 'review', 'changes_requested'].indexOf(t.status) !== -1;
    }).length;
  }

  // Reset
  wrap.className = '';
  var eyesNormal = document.getElementById('flowEyes');
  var eyesSleepy = document.getElementById('flowEyesSleepy');
  if (eyesNormal) eyesNormal.style.display = '';
  if (eyesSleepy) eyesSleepy.style.display = 'none';

  // Quiet mood — Flow is always cozy, just slightly different
  if (total === 0) {
    wrap.classList.add('flow-state-sleep');
    wrap.title = 'Flow is napping... all done 💤';
  } else if (total <= 3) {
    wrap.classList.add('flow-state-relax');
    wrap.title = 'Flow is cozy. ' + total + ' thing' + (total > 1 ? 's' : '') + ' to do.';
  } else if (total <= 8) {
    wrap.classList.add('flow-state-alert');
    wrap.title = 'Flow is keeping an eye on ' + total + ' items.';
  } else {
    wrap.classList.add('flow-state-busy');
    wrap.title = 'Flow is purring hard. ' + total + ' things in motion!';
  }

  wrap.style.display = currentClientId ? 'block' : 'none';
}

function setupLogoUpload() {
  const logoInput = $('#clientLogoInput');
  if (!logoInput) return;
  if (logoInput._logoChangeHandler) {
    logoInput.removeEventListener('change', logoInput._logoChangeHandler);
  }
  logoInput._logoChangeHandler = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Image size must be less than 5MB');
      return;
    }
    try {
      const compressed = await compressImage(file, 400, 400, 0.85);
      saveClientLogo(compressed.dataUrl);
    } catch (err) {
      console.error('Logo compress error:', err);
      const reader = new FileReader();
      reader.onload = (event) => saveClientLogo(event.target.result);
      reader.onerror = () => alert('Error reading file. Please try again.');
      reader.readAsDataURL(file);
    }
  };
  logoInput.addEventListener('change', logoInput._logoChangeHandler);
}

async function saveClientLogo(logoUrl) {
  if (!currentClientId) return;
  const client = getCurrentClient();
  if (!client) return;
  try {
    const r = await fetch(`${getApiBaseUrl()}/api/agency/clients/${currentClientId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logoUrl })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Update failed');
    await fetchClientsFromAPI();
    renderClientHeader();
    showToast('Logo uploaded successfully!');
  } catch (e) {
    showToast('Failed to save logo. ' + (e.message || ''), 'error');
  }
}

/* ================== Tab Management ================== */
// Load saved tab from localStorage or default to 'overview'
let currentTab = localStorage.getItem('2fly_agency_current_tab') || 'overview';

let currentCalendarMonth = new Date();

function getCalendarDays(year, month) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - ((firstDay.getDay() + 6) % 7));
  const endDate = new Date(lastDay);
  endDate.setDate(endDate.getDate() + ((7 - lastDay.getDay()) % 7));
  const days = [];
  const d = new Date(startDate);
  while (d <= endDate) {
    days.push(new Date(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

function buildCalendarSummary(posts) {
  return {
    total: posts.length,
    scheduled: posts.filter(p => p.status === 'scheduled').length,
    published: posts.filter(p => p.status === 'published').length,
    failed: posts.filter(p => p.status === 'failed').length,
    instagram: posts.filter(p => (p.platforms || []).includes('instagram')).length,
    facebook: posts.filter(p => (p.platforms || []).includes('facebook')).length
  };
}

function navigateCalendarMonth(offset) {
  currentCalendarMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() + offset, 1);
  renderScheduledPostsTab();
}

function switchTab(tabName) {
  currentTab = tabName;
  
  // Save current tab to localStorage
  localStorage.setItem('2fly_agency_current_tab', tabName);
  
  // Update tab buttons
  $$('.tab').forEach(tab => {
    if (tab.dataset.tab === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  
  // Update tab content
  $$('.tab-content').forEach(content => {
    if (content.id === `tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
  
  // Render appropriate tab
  switch(tabName) {
    case 'overview':
      renderOverviewTab();
      break;
    case 'approvals':
      renderApprovalsTab();
      renderApprovedVisualsSection();
      // Set auto due date when switching to approvals tab (if form is empty)
      setTimeout(() => {
        const approvalId = $('#approvalId');
        if (!approvalId || !approvalId.value) {
          setAutoDueDate();
        }
      }, 100);
      break;
    case 'requests':
      renderRequestsTab();
      break;
    case 'needs':
      renderNeedsTab();
      break;
    case 'contentlibrary':
      renderContentLibraryTab();
      break;
    case 'scheduled':
      renderScheduledPostsTab();
      break;
    case 'reports':
      renderReportsTab();
      break;
    default:
      break;
  }
}

/** Ensure Scheduled Posts tab exists and is visible. Injects if missing (e.g. cached HTML). */
function ensureScheduledTabExists() {
  const tabsContainer = document.querySelector('.tabs');
  const reportsTab = document.querySelector('.tab[data-tab="reports"]');
  let scheduledTab = document.querySelector('.tab[data-tab="scheduled"]');
  let tabContent = document.getElementById('tabScheduled');
  if (!scheduledTab && tabsContainer) {
    const btn = document.createElement('button');
    btn.className = 'tab';
    btn.dataset.tab = 'scheduled';
    btn.textContent = 'Scheduled Posts';
    btn.addEventListener('click', () => { if (typeof switchTab === 'function') switchTab('scheduled'); });
    if (reportsTab) tabsContainer.insertBefore(btn, reportsTab);
    else tabsContainer.appendChild(btn);
    scheduledTab = btn;
  }
  if (scheduledTab) {
    scheduledTab.style.display = '';
    scheduledTab.style.visibility = '';
  }
  tabContent = document.getElementById('tabScheduled');
  if (!tabContent && document.getElementById('tabContentlibrary')) {
    const contentLibraryContent = document.getElementById('tabContentlibrary');
    const div = document.createElement('div');
    div.id = 'tabScheduled';
    div.className = 'tab-content';
    div.innerHTML = '<div id="scheduledPostsConnectionSection" class="card" style="margin-bottom: 24px; padding: 20px;"><div id="scheduledPostsConnectionContent"></div></div><div id="scheduledPostsListTitle" style="font-size: 14px; font-weight: 600; color: #0f172a; margin-bottom: 12px;">Scheduled Posts:</div><div id="scheduledPostsFilters" style="margin-bottom: 20px; display: flex; gap: 12px; flex-wrap: wrap;"><select id="scheduledFilterClient" class="form-select form-select--sm"><option value="">All clients</option></select><select id="scheduledFilterPlatform" class="form-select form-select--sm"><option value="">All platforms</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option></select><select id="scheduledFilterStatus" class="form-select form-select--sm"><option value="">All statuses</option><option value="scheduled">Scheduled</option><option value="published">Published</option><option value="failed">Failed</option></select></div><div id="scheduledPostsList" class="scheduled-posts-list"><div style="text-align: center; padding: 40px; color: #64748b;">Loading scheduled posts...</div></div>';
    contentLibraryContent.parentNode.insertBefore(div, contentLibraryContent);
  }
}

// Setup tab click handlers - will be called after DOM loads
function setupTabHandlers() {
  ensureScheduledTabExists();
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });
}

/* ================== Scheduled Posts Tab ================== */
async function renderScheduledPostsConnectionSection() {
  const wrap = $('#scheduledPostsConnectionSection');
  const content = $('#scheduledPostsConnectionContent');
  if (!wrap || !content) return;

  const clients = loadClientsRegistry();
  const client = currentClientId && clients ? clients[currentClientId] : null;

  if (!currentClientId || !client) {
    content.innerHTML = '<p style="margin: 0; font-size: 14px; color: #64748b;">Select a client to manage their social accounts.</p>';
    return;
  }

  content.innerHTML = '<div style="text-align: center; padding: 12px; color: #64748b;">Checking connection...</div>';
  wrap.style.display = 'block';

  try {
    const r = await fetch(`${getApiBaseUrl()}/api/integrations/meta/status?clientId=${encodeURIComponent(currentClientId)}`, { credentials: 'include' });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to check status');

    let html = '<div style="font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 16px;">' + (client.name || currentClientId) + ' — Social Accounts</div>';
    if (j.connected) {
      html += '<div style="display: flex; flex-direction: column; gap: 12px;">';
      html += '<div style="display: flex; align-items: center; gap: 12px;flex-wrap:wrap;"><span style="color: #059669;">●</span> Instagram: Connected' + (j.instagramUsername ? ' (@' + j.instagramUsername + ')' : '') + '</div>';
      html += '<div style="display: flex; align-items: center; gap: 12px;"><span style="color: #059669;">●</span> Facebook: Connected' + (j.pageName ? ' (' + j.pageName + ')' : '') + '</div>';
      html += '</div>';
      // Token expiry warning
      if (j.daysUntilExpiry != null && j.daysUntilExpiry <= 14) {
        var warnColor = j.daysUntilExpiry <= 3 ? '#dc2626' : '#b45309';
        var warnBg = j.daysUntilExpiry <= 3 ? '#fee2e2' : '#fef3c7';
        html += '<div style="margin-top:12px;padding:10px 14px;border-radius:8px;font-size:13px;background:' + warnBg + ';color:' + warnColor + ';">';
        html += '<strong>⚠ Token expires in ' + j.daysUntilExpiry + ' day' + (j.daysUntilExpiry !== 1 ? 's' : '') + '</strong> — Click Reconnect to refresh it before it stops working.';
        html += '</div>';
      }
      html += '<div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">';
      html += '<button type="button" class="btn btn-secondary" id="scheduledMetaTestBtn" style="padding:8px 18px;font-size:13px;">Test Connection</button>';
      html += '<button type="button" class="btn btn-secondary" id="scheduledMetaReconnectBtn" style="padding:8px 18px;font-size:13px;">Reconnect</button>';
      html += '<button type="button" class="btn btn-secondary" id="scheduledMetaDisconnectBtn" style="padding:8px 18px;font-size:13px;color:#dc2626;border-color:#fecaca;">Disconnect</button>';
      html += '</div>';
      html += '<div id="scheduledMetaTestResult" style="display:none;margin-top:12px;padding:12px;border-radius:8px;font-size:13px;"></div>';
    } else {
      html += '<div style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;">';
      html += '<div><span style="color: #94a3b8;">○</span> Instagram: Not connected</div>';
      html += '<div><span style="color: #94a3b8;">○</span> Facebook: Not connected</div>';
      html += '</div>';
      if (j.error) html += '<p style="font-size: 13px; color: #dc2626; margin: 0 0 12px 0;">' + j.error + '</p>';
      html += '<button type="button" class="btn btn-primary" id="scheduledMetaConnectBtn" style="padding: 12px 24px;">Connect Facebook &amp; Instagram</button>';
    }
    content.innerHTML = html;

    // Connect button
    var connectBtn = $('#scheduledMetaConnectBtn');
    var reconnectBtn = $('#scheduledMetaReconnectBtn');
    var disconnectBtn = $('#scheduledMetaDisconnectBtn');
    var testBtn = $('#scheduledMetaTestBtn');

    function openMetaOAuth() {
      fetch(getApiBaseUrl() + '/api/auth/meta?clientId=' + encodeURIComponent(currentClientId), { credentials: 'include' })
        .then(function(r) { return r.json(); })
        .then(function(d) { if (d.authUrl) window.open(d.authUrl, 'meta_oauth', 'width=600,height=700'); })
        .catch(function(e) { console.error('Meta connect:', e); });
    }

    if (connectBtn) connectBtn.addEventListener('click', openMetaOAuth);
    if (reconnectBtn) reconnectBtn.addEventListener('click', openMetaOAuth);

    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', async function() {
        if (!confirm('Disconnect Meta for this client?')) return;
        try {
          var r = await fetch(getApiBaseUrl() + '/api/integrations/meta/disconnect', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
            body: JSON.stringify({ clientId: currentClientId })
          });
          var d = await r.json();
          if (d.success) { renderScheduledPostsConnectionSection(); renderScheduledPostsTab(); }
        } catch (e) { console.error('Meta disconnect:', e); }
      });
    }

    if (testBtn) {
      testBtn.addEventListener('click', async function() {
        var resultEl = $('#scheduledMetaTestResult');
        if (!resultEl) return;
        resultEl.style.display = 'block';
        resultEl.style.background = '#f8fafc';
        resultEl.style.color = '#475569';
        resultEl.textContent = 'Testing connection...';
        try {
          var r = await fetch(getApiBaseUrl() + '/api/integrations/meta/debug?clientId=' + encodeURIComponent(currentClientId), { credentials: 'include' });
          var d = await r.json();
          var perms = d.permissions || [];
          var declined = d.declinedPermissions || [];
          var hasManage = d.hasManagePosts || perms.indexOf('pages_manage_posts') !== -1;
          var hasIg = perms.indexOf('instagram_content_publish') !== -1;

          if (d.pageValid && hasManage) {
            resultEl.style.background = '#d1fae5';
            resultEl.style.color = '#059669';
            var msg = '<strong>Ready to post!</strong> Page token valid, pages_manage_posts granted.';
            if (hasIg) msg += ' Instagram publishing enabled.';
            else msg += '<br><span style="color:#b45309;">Instagram publishing not enabled — only Facebook posting will work.</span>';
            if (perms.length > 0) msg += '<br>Permissions: ' + perms.join(', ');
            if (declined.length > 0) msg += '<br><span style="color:#dc2626;">Declined: ' + declined.join(', ') + '</span>';
            resultEl.innerHTML = msg;
          } else if (d.pageValid && !hasManage && !d.hasUserToken) {
            // Old connection without user token — can't verify permissions but page is accessible
            resultEl.style.background = '#fef3c7';
            resultEl.style.color = '#b45309';
            resultEl.innerHTML = '<strong>Page accessible</strong> but cannot verify posting permissions (old connection).<br>Try posting — if it fails, do a full reconnect:<br>1. Click Disconnect below<br>2. Go to <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" style="color:#1e40af;">Facebook Settings → Business Integrations</a><br>3. Remove "2Fly Marketing API"<br>4. Come back here and click Connect';
          } else {
            resultEl.style.background = '#fee2e2';
            resultEl.style.color = '#dc2626';
            var errMsg = '<strong>Connection issue:</strong><br>';
            if (d.postError) errMsg += 'Page test: ' + d.postError + '<br>';
            if (d.pageError) errMsg += 'Page access: ' + d.pageError + '<br>';
            if (d.permError) errMsg += 'Permissions: ' + d.permError + '<br>';
            if (d.tokenExpired) errMsg += 'Token expired.<br>';
            if (declined.length > 0) errMsg += 'Declined permissions: ' + declined.join(', ') + '<br>';
            errMsg += '<br><strong>To fix:</strong><br>';
            errMsg += '1. Click Disconnect below<br>';
            errMsg += '2. Go to <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" style="color:#1e40af;">Facebook Settings → Business Integrations</a><br>';
            errMsg += '3. Remove "2Fly Marketing API" from the list<br>';
            errMsg += '4. Come back and click Connect Facebook & Instagram<br>';
            errMsg += '5. Approve ALL permissions in the dialog';
            resultEl.innerHTML = errMsg;
          }
        } catch (e) {
          resultEl.style.background = '#fee2e2';
          resultEl.style.color = '#dc2626';
          resultEl.textContent = 'Test failed: ' + (e.message || 'Unknown error');
        }
      });
    }
  } catch (e) {
    content.innerHTML = '<p style="margin: 0; font-size: 14px; color: #dc2626;">Error checking status: ' + (e.message || 'Unknown error') + '</p>';
  }
}

function injectCalendarStyles() {
  if (document.getElementById('scheduled-cal-css')) return;
  const style = document.createElement('style');
  style.id = 'scheduled-cal-css';
  style.textContent = '.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:white;}.cal-header-cell{padding:10px;text-align:center;font-weight:600;font-size:12px;color:#64748b;background:#f8fafc;border-bottom:1px solid #e2e8f0;}.cal-day{min-height:100px;padding:6px;border-right:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9;vertical-align:top;background:white;}.cal-day:nth-child(7n){border-right:none;}.cal-day.other-month{background:#f9fafb;opacity:0.6;}.cal-day.today{background:#eff6ff;}.cal-day-number{font-size:13px;font-weight:600;color:#374151;margin-bottom:6px;}.cal-day.today .cal-day-number{background:#1a56db;color:white;width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;}.cal-posts{min-height:60px;}.cal-post-dismiss{position:absolute;top:4px;right:4px;width:18px;height:18px;padding:0;border:none;background:transparent;color:#94a3b8;font-size:16px;line-height:1;cursor:pointer;border-radius:4px;display:flex;align-items:center;justify-content:center;}.cal-post-dismiss:hover{color:#64748b;background:rgba(0,0,0,0.08);}';
  document.head.appendChild(style);
}

async function renderScheduledPostsTab() {
  await renderScheduledPostsConnectionSection();

  if (window.__scheduledFilterDate) {
    var fd = window.__scheduledFilterDate;
    var fp = typeof fd === 'string' ? fd.split('-') : [];
    if (fp.length === 3) {
      var y = parseInt(fp[0], 10);
      var mo = parseInt(fp[1], 10) - 1;
      if (!isNaN(y) && !isNaN(mo)) {
        currentCalendarMonth = new Date(y, mo, 1);
      }
    }
    window.__scheduledFilterDate = null;
  }

  const container = $('#scheduledPostsList');
  const filterClient = $('#scheduledFilterClient');
  const filterPlatform = $('#scheduledFilterPlatform');
  const filterStatus = $('#scheduledFilterStatus');
  if (!container) return;

  injectCalendarStyles();

  const clients = loadClientsRegistry();
  if (filterClient) {
    const cur = filterClient.value;
    filterClient.innerHTML = '<option value="">All clients</option>' + Object.values(clients || {}).map(c => '<option value="' + c.id + '">' + (c.name || c.id) + '</option>').join('');
    if (cur) filterClient.value = cur;
  }

  const params = new URLSearchParams();
  if (filterClient && filterClient.value) params.set('clientId', filterClient.value);
  else if (currentClientId) params.set('clientId', currentClientId);
  if (filterPlatform && filterPlatform.value) params.set('platform', filterPlatform.value);
  if (filterStatus && filterStatus.value) params.set('status', filterStatus.value);

  const listTitle = $('#scheduledPostsListTitle');
  if (listTitle) {
    const filteredClientId = filterClient && filterClient.value;
    const clientName = filteredClientId && clients ? (clients[filteredClientId]?.name || filteredClientId) : (currentClientId && clients ? (clients[currentClientId]?.name || currentClientId) : null);
    listTitle.textContent = clientName ? 'Scheduled Posts for ' + clientName + ':' : 'Scheduled Posts:';
  }

  try {
    const r = await fetch(`${getApiBaseUrl()}/api/posts/scheduled?${params}`, { credentials: 'include' });
    const contentType = r.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      await r.text();
      throw new Error('API returned non-JSON (status ' + r.status + '). Check that the API server is running and reachable.');
    }
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to load scheduled posts');
    const allPosts = j.posts || [];

    const y = currentCalendarMonth.getFullYear();
    const m = currentCalendarMonth.getMonth();
    const monthStart = new Date(y, m, 1).getTime();
    const monthEnd = new Date(y, m + 1, 0, 23, 59, 59).getTime();
    const postsInMonth = allPosts.filter(p => {
      const t = new Date(p.scheduledAt).getTime();
      return t >= monthStart && t <= monthEnd;
    });

    const postsByDay = {};
    postsInMonth.forEach(p => {
      const key = new Date(p.scheduledAt).toDateString();
      if (!postsByDay[key]) postsByDay[key] = [];
      postsByDay[key].push(p);
    });

    const days = getCalendarDays(y, m);
    const todayStr = new Date().toDateString();
    const monthName = currentCalendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

    let html = '<div class="schedule-calendar-wrap">';
    html += '<div class="cal-nav" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px;">';
    html += '<div style="display:flex;align-items:center;gap:12px;">';
    html += '<button type="button" class="cal-nav-btn" data-offset="-1" style="padding:8px 14px;border:1px solid #e2e8f0;background:white;border-radius:8px;cursor:pointer;font-size:18px;line-height:1;">&lsaquo;</button>';
    html += '<h3 style="margin:0;font-size:20px;font-weight:700;color:#0f172a;min-width:180px;text-align:center;">' + monthName + '</h3>';
    html += '<button type="button" class="cal-nav-btn" data-offset="1" style="padding:8px 14px;border:1px solid #e2e8f0;background:white;border-radius:8px;cursor:pointer;font-size:18px;line-height:1;">&rsaquo;</button>';
    html += '</div></div>';

    html += '<div class="cal-grid">';
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function(day) {
      html += '<div class="cal-header-cell">' + day + '</div>';
    });
    days.forEach(function(day) {
      const isOtherMonth = day.getMonth() !== m;
      const isToday = day.toDateString() === todayStr;
      const dayNum = day.getDate();
      const key = day.toDateString();
      const dayPosts = postsByDay[key] || [];
      let cls = 'cal-day';
      if (isOtherMonth) cls += ' other-month';
      if (isToday) cls += ' today';
      html += '<div class="' + cls + '">';
      html += '<div class="cal-day-number">' + dayNum + '</div>';
      html += '<div class="cal-posts">';
      dayPosts.forEach(function(p) {
        const timeStr = new Date(p.scheduledAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        const platformIcons = (p.platforms || []).map(function(plat) { return plat === 'instagram' ? '📷' : plat === 'facebook' ? '📘' : ''; }).filter(Boolean).join(' ') || '—';
        const titleStr = (p.caption ? p.caption.slice(0, 40) + (p.caption.length > 40 ? '…' : '') : 'No caption').replace(/</g, '&lt;');
        const status = p.status || 'scheduled';
        const borderColor = status === 'published' ? '#10b981' : status === 'failed' ? '#ef4444' : status === 'publishing' ? '#f59e0b' : '#3b82f6';
        const bgColor = status === 'published' ? '#ecfdf5' : status === 'failed' ? '#fef2f2' : status === 'publishing' ? '#fffbeb' : '#eff6ff';
        const statusLabel = status === 'published' ? '✓ Published' : status === 'failed' ? '✗ Failed' : status === 'publishing' ? 'Publishing…' : '● Scheduled';
        html += '<div class="cal-post" data-post-id="' + (p.id || '').replace(/"/g, '&quot;') + '" style="position:relative;padding:6px 24px 6px 8px;margin:2px 0;border-radius:6px;font-size:11px;border-left:3px solid ' + borderColor + ';background:' + bgColor + ';cursor:default;">';
        html += '<button type="button" class="cal-post-dismiss" data-post-id="' + (p.id || '').replace(/"/g, '&quot;') + '" aria-label="Remove">×</button>';
        html += '<div style="display:flex;align-items:center;gap:4px;"><span class="cal-time" style="font-weight:600;">' + timeStr + '</span><span class="cal-platforms">' + platformIcons + '</span></div>';
        html += '<div class="cal-caption" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500;color:#1e293b;">' + titleStr + '</div>';
        html += '<div class="cal-status" style="font-size:10px;font-weight:600;">' + statusLabel + '</div></div>';
      });
      html += '</div></div>';
    });
    html += '</div>';

    const summary = buildCalendarSummary(postsInMonth);
    html += '<div class="schedule-summary" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;margin-top:24px;padding:20px;background:white;border-radius:12px;border:1px solid #e2e8f0;">';
    html += '<div style="text-align:center;"><div style="font-size:28px;font-weight:700;color:#1a56db;">' + summary.total + '</div><div style="font-size:12px;color:#64748b;font-weight:500;">Total Posts</div></div>';
    html += '<div style="text-align:center;"><div style="font-size:28px;font-weight:700;color:#3b82f6;">' + summary.scheduled + '</div><div style="font-size:12px;color:#64748b;font-weight:500;">Scheduled</div></div>';
    html += '<div style="text-align:center;"><div style="font-size:28px;font-weight:700;color:#10b981;">' + summary.published + '</div><div style="font-size:12px;color:#64748b;font-weight:500;">Published</div></div>';
    html += '<div style="text-align:center;"><div style="font-size:28px;font-weight:700;color:#ef4444;">' + summary.failed + '</div><div style="font-size:12px;color:#64748b;font-weight:500;">Failed</div></div>';
    html += '<div style="text-align:center;"><div style="font-size:28px;font-weight:700;color:#e4405f;">' + summary.instagram + '</div><div style="font-size:12px;color:#64748b;font-weight:500;">📷 Instagram</div></div>';
    html += '<div style="text-align:center;"><div style="font-size:28px;font-weight:700;color:#1877f2;">' + summary.facebook + '</div><div style="font-size:12px;color:#64748b;font-weight:500;">📘 Facebook</div></div>';
    html += '</div></div>';

    container.innerHTML = html;

    container.querySelectorAll('.cal-nav-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        const offset = parseInt(btn.getAttribute('data-offset'), 10);
        navigateCalendarMonth(offset);
      });
    });

    if (!container._calDismissBound) {
      container._calDismissBound = true;
      container.addEventListener('click', async function(e) {
        const dismiss = e.target && e.target.closest && e.target.closest('.cal-post-dismiss');
        if (!dismiss) return;
        e.preventDefault();
        e.stopPropagation();
        const postId = dismiss.getAttribute('data-post-id');
        if (!postId) return;
        try {
          const r = await fetch(getApiBaseUrl() + '/api/posts/' + encodeURIComponent(postId) + '/cancel', { method: 'DELETE', credentials: 'include' });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || 'Failed to remove');
          renderScheduledPostsTab();
        } catch (err) {
          showToast(err.message || 'Failed to remove post', 'error');
        }
      });
    }
  } catch (e) {
    container.innerHTML = '<div style="text-align: center; padding: 40px; color: #dc2626;">Failed to load: ' + (e.message || 'Unknown error') + '</div>';
  }
}

function setupScheduledPostsFilters() {
  const filterClient = $('#scheduledFilterClient');
  const filterPlatform = $('#scheduledFilterPlatform');
  const filterStatus = $('#scheduledFilterStatus');
  if (filterClient && !filterClient._scheduledBound) { filterClient._scheduledBound = true; filterClient.addEventListener('change', () => renderScheduledPostsTab()); }
  if (filterPlatform && !filterPlatform._scheduledBound) { filterPlatform._scheduledBound = true; filterPlatform.addEventListener('change', () => renderScheduledPostsTab()); }
  if (filterStatus && !filterStatus._scheduledBound) { filterStatus._scheduledBound = true; filterStatus.addEventListener('change', () => renderScheduledPostsTab()); }
}

/* ================== Overview Tab ================== */
// ── Links editor modal ──
function openLinksEditorModal(clientId) {
  var existing = document.getElementById('linksEditorModal');
  if (existing) existing.remove();
  var clients = loadClientsRegistry();
  var client = clients[clientId] || {};
  var links = client.clientLinks || {};

  var overlay = document.createElement('div');
  overlay.id = 'linksEditorModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease-out;';

  var modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:16px;max-width:480px;width:95%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.3);padding:24px;animation:slideUp 0.2s ease-out;';

  var fields = [
    { key: 'instagram', label: 'Instagram', ph: 'https://instagram.com/...', icon: '📷' },
    { key: 'facebook', label: 'Facebook', ph: 'https://facebook.com/...', icon: '📘' },
    { key: 'website', label: 'Website', ph: 'https://...', icon: '🌐' },
    { key: 'googleBusiness', label: 'Google Business', ph: 'https://business.google.com/...', icon: '📍' },
    { key: 'drive', label: 'Drive / Assets', ph: 'https://drive.google.com/...', icon: '📁' },
    { key: 'adsManager', label: 'Ads Manager', ph: 'https://...', icon: '📊' },
  ];

  var html = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">';
  html += '<h3 style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">Client Links</h3>';
  html += '<button type="button" id="linksEditorClose" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:22px;">&times;</button></div>';
  fields.forEach(function(f) {
    html += '<div style="margin-bottom:12px;">';
    html += '<label style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#475569;margin-bottom:4px;">' + f.icon + ' ' + f.label + '</label>';
    html += '<input type="url" id="link_' + f.key + '" value="' + ((links[f.key] || '').replace(/"/g, '&quot;')) + '" placeholder="' + f.ph + '" style="width:100%;padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;box-sizing:border-box;">';
    html += '</div>';
  });
  html += '<div style="display:flex;gap:10px;margin-top:16px;">';
  html += '<button type="button" id="linksEditorSave" style="flex:1;padding:11px;border-radius:10px;border:none;background:#1e40af;color:#fff;font-size:14px;font-weight:700;cursor:pointer;">Save Links</button>';
  html += '<button type="button" id="linksEditorCancel" style="padding:11px 20px;border-radius:10px;border:1px solid #e2e8f0;background:#fff;color:#475569;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>';
  html += '</div>';

  modal.innerHTML = html;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  document.getElementById('linksEditorClose').addEventListener('click', function() { overlay.remove(); });
  document.getElementById('linksEditorCancel').addEventListener('click', function() { overlay.remove(); });
  document.getElementById('linksEditorSave').addEventListener('click', async function() {
    var btn = document.getElementById('linksEditorSave');
    btn.textContent = 'Saving...'; btn.disabled = true;
    var newLinks = {};
    fields.forEach(function(f) { var v = document.getElementById('link_' + f.key).value.trim(); if (v) newLinks[f.key] = v; });
    try {
      var r = await fetch(getApiBaseUrl() + '/api/agency/clients/' + encodeURIComponent(clientId), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ clientLinks: newLinks })
      });
      if (!r.ok) throw new Error('Failed to save');
      // Update local cache
      if (clients[clientId]) clients[clientId].clientLinks = newLinks;
      overlay.remove();
      showToast('Links saved!', 'success');
      renderOverviewTab();
    } catch (e) { showToast(e.message || 'Failed', 'error'); btn.textContent = 'Save Links'; btn.disabled = false; }
  });
}

function renderOverviewTab() {
  var state = load();
  var clients = loadClientsRegistry();
  var hasClients = Object.keys(clients).length > 0;
  var overviewEmpty = $('#overviewEmptyNoClient');
  var overviewContent = $('#overviewContent');
  if (overviewEmpty) overviewEmpty.style.display = !hasClients ? 'block' : 'none';
  if (overviewContent) overviewContent.style.display = hasClients ? 'block' : 'none';
  if (!hasClients || !overviewContent || !currentClientId) return;

  var client = clients[currentClientId] || {};
  var approvals = state.approvals || [];
  var needs = state.needs || [];
  var requests = state.requests || [];
  var activity = state.activity || [];

  // ── Calculate metrics ──
  var scheduledCount = calculateScheduledPosts(approvals);
  var pendingApprovals = approvals.filter(function(a) { return !a.status || a.status === 'pending'; });
  var changesRequested = approvals.filter(function(a) { return a.status === 'changes'; });
  var copyPending = approvals.filter(function(a) { return a.status === 'copy_pending'; });
  var copyApproved = approvals.filter(function(a) { return a.status === 'copy_approved'; });
  var approvedPosts = approvals.filter(function(a) { return a.status === 'approved'; });
  var missingCount = state.kpis ? state.kpis.missingAssets || 0 : 0;
  var openRequests = requests.filter(isClientRequestOpen);
  var openNeeds = needs.filter(function(n) { return !n.status || n.status === 'open'; });

  // Production tasks for this client
  var prodTasks = (typeof productionTasksCache !== 'undefined' ? productionTasksCache : []).filter(function(t) { return t.clientId === currentClientId; });
  var inProduction = prodTasks.filter(function(t) { return t.status === 'in_progress' || t.status === 'assigned'; });
  var inReview = prodTasks.filter(function(t) { return t.status === 'review'; });
  var prodChanges = prodTasks.filter(function(t) { return t.status === 'changes_requested'; });

  // Health calculation
  var attentionItems = [];
  if (changesRequested.length > 0) attentionItems.push(changesRequested.length + ' change request' + (changesRequested.length > 1 ? 's' : ''));
  if (prodChanges.length > 0) attentionItems.push(prodChanges.length + ' design revision' + (prodChanges.length > 1 ? 's' : ''));
  if (missingCount > 0) attentionItems.push(missingCount + ' missing asset' + (missingCount > 1 ? 's' : ''));
  if (openRequests.length > 0) attentionItems.push(openRequests.length + ' client request' + (openRequests.length > 1 ? 's' : ''));

  var waitingItems = [];
  pendingApprovals.forEach(function(a) { waitingItems.push((a.title || a.caption || 'Post').substring(0, 40)); });

  var healthStatus = 'healthy';
  var healthLabel = 'Healthy';
  var healthColor = '#059669';
  var healthBg = '#dcfce7';
  if (attentionItems.length > 2 || missingCount > 3) { healthStatus = 'at-risk'; healthLabel = 'At Risk'; healthColor = '#dc2626'; healthBg = '#fee2e2'; }
  else if (attentionItems.length > 0) { healthStatus = 'attention'; healthLabel = 'Needs Attention'; healthColor = '#d97706'; healthBg = '#fef3c7'; }

  // Upcoming deadlines
  var todayStr = new Date().toISOString().slice(0, 10);
  var upcoming = prodTasks.filter(function(t) {
    return t.deadline && t.deadline >= todayStr && ['approved', 'ready_to_post'].indexOf(t.status) === -1;
  }).sort(function(a, b) { return (a.deadline || '').localeCompare(b.deadline || ''); }).slice(0, 5);

  // ── Build HTML ──
  var h = '';
  var prodCount = inProduction.length + inReview.length + prodChanges.length;

  function kpiColorScheduled(v) {
    if (v >= 7) return '#059669';
    if (v >= 3) return '#d97706';
    return '#dc2626';
  }
  function kpiColorInProd(v) {
    return v > 0 ? '#2563eb' : '#94a3b8';
  }
  function kpiColorAwaiting(v) {
    if (v === 0) return '#059669';
    if (v <= 3) return '#d97706';
    return '#dc2626';
  }
  function kpiColorRequests(v) {
    if (v === 0) return '#059669';
    if (v <= 3) return '#d97706';
    return '#dc2626';
  }
  function kpiColorMissing(v) {
    return v === 0 ? '#059669' : '#dc2626';
  }

  // ─── KPI STRIP (clickable, severity colors) ───
  h += '<div style="display:flex;background:#fff;border-radius:14px;border:1px solid #e2e8f0;margin-bottom:12px;overflow-x:auto;box-shadow:0 1px 3px rgba(0,0,0,0.04);">';
  var kpiDefs = [
    { label: 'Scheduled', val: scheduledCount, color: kpiColorScheduled(scheduledCount), action: 'scheduled' },
    { label: 'In Production', val: prodCount, color: kpiColorInProd(prodCount), action: 'production' },
    { label: 'Awaiting Approval', val: pendingApprovals.length, color: kpiColorAwaiting(pendingApprovals.length), action: 'approvals' },
    { label: 'Requests', val: openRequests.length, color: kpiColorRequests(openRequests.length), action: 'requests' },
    { label: 'Missing Assets', val: missingCount, color: kpiColorMissing(missingCount), action: 'needs' },
  ];
  kpiDefs.forEach(function(k, i) {
    h += '<div class="ov-kpi" data-kpi-action="' + k.action + '" style="flex:1;min-width:95px;padding:12px 10px;text-align:center;cursor:pointer;transition:background 0.12s;border-radius:10px;' + (i < kpiDefs.length - 1 ? 'border-right:1px solid #f1f5f9;' : '') + '">';
    h += '<div style="font-size:26px;font-weight:900;color:' + k.color + ';line-height:1;">' + k.val + '</div>';
    h += '<div style="font-size:9px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.7px;margin-top:4px;">' + k.label + '</div>';
    h += '</div>';
  });
  h += '</div>';

  // ─── ROW 2: AI SUMMARY + IMPORTANT LINKS (compact) ───
  h += '<div style="display:grid;grid-template-columns:1fr 300px;gap:10px;margin-bottom:12px;" class="ov-row2">';

  // AI Summary Card
  h += '<div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;padding:12px 14px;display:flex;flex-direction:column;min-height:140px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
  h += '<div style="display:flex;align-items:center;gap:8px;">';
  h += '<div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#dbeafe,#c7d2fe);display:flex;align-items:center;justify-content:center;font-size:14px;">🧠</div>';
  h += '<span style="font-size:13px;font-weight:800;color:#0f172a;">AI Summary</span></div>';
  h += '<button type="button" class="ov-ai-refresh" data-type="summary" style="padding:4px 10px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;color:#64748b;font-size:10px;font-weight:700;cursor:pointer;">Refresh</button>';
  h += '</div>';
  h += '<div id="ovAiSummary" style="flex:1;font-size:12px;color:#475569;line-height:1.55;">';
  h += '<div style="color:#94a3b8;font-style:italic;">Loading summary...</div></div></div>';

  // Important Links Card
  var cLinks = client.clientLinks || {};
  var linkItems = [];
  if (cLinks.instagram) linkItems.push({ icon: '📷', label: 'Instagram', url: cLinks.instagram });
  if (cLinks.facebook) linkItems.push({ icon: '📘', label: 'Facebook', url: cLinks.facebook });
  if (cLinks.website) linkItems.push({ icon: '🌐', label: 'Website', url: cLinks.website });
  if (cLinks.googleBusiness) linkItems.push({ icon: '📍', label: 'Google Business', url: cLinks.googleBusiness });
  if (cLinks.drive) linkItems.push({ icon: '📁', label: 'Drive', url: cLinks.drive });
  if (cLinks.adsManager) linkItems.push({ icon: '📊', label: 'Ads Manager', url: cLinks.adsManager });
  if (client.assetsLink && !cLinks.drive) linkItems.push({ icon: '📁', label: 'Assets', url: client.assetsLink });

  h += '<div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;padding:12px 14px;display:flex;flex-direction:column;min-height:140px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
  h += '<span style="font-size:13px;font-weight:800;color:#0f172a;">Important Links</span>';
  h += '<button type="button" class="ov-edit-links" style="padding:4px 10px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;color:#64748b;font-size:10px;font-weight:700;cursor:pointer;">Edit</button>';
  h += '</div>';
  if (linkItems.length === 0) {
    h += '<button type="button" class="ov-edit-links" style="width:100%;text-align:left;padding:8px 0;background:none;border:none;color:#1e40af;font-size:12px;font-weight:700;cursor:pointer;">Add links →</button>';
  } else {
    h += '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">';
    linkItems.forEach(function(lnk) {
      var domain = '';
      try { domain = new URL(lnk.url).hostname.replace('www.', ''); } catch(e) { domain = lnk.label; }
      var fav = 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=32';
      h += '<a href="' + (lnk.url || '').replace(/"/g, '&quot;') + '" target="_blank" rel="noopener" title="' + domain.replace(/"/g, '&quot;') + '" style="display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:10px;border:1px solid #e2e8f0;background:#f8fafc;overflow:hidden;text-decoration:none;">';
      h += '<img src="' + fav + '" alt="" width="20" height="20" style="display:block;object-fit:contain;"/>';
      h += '</a>';
    });
    h += '</div>';
  }
  h += '</div></div>';

  // ─── ROW 3: REQUESTS + CALENDAR + DESIGNER (3 columns) ───
  h += '<div style="display:grid;grid-template-columns:minmax(260px,300px) 1fr minmax(200px,240px);gap:10px;margin-bottom:12px;" class="ov-row3">';

  // Requests Card
  h += '<div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;padding:12px 14px;display:flex;flex-direction:column;min-height:280px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">';
  h += '<span style="font-size:13px;font-weight:800;color:#0f172a;">Requests</span>';
  if (openRequests.length > 0) h += '<span style="padding:2px 8px;border-radius:10px;background:#f5f3ff;color:#7c3aed;font-size:10px;font-weight:800;">' + openRequests.length + '</span>';
  h += '</div>';
  if (openRequests.length === 0) {
    h += '<div style="flex:1;display:flex;align-items:center;justify-content:center;font-size:12px;color:#94a3b8;">No open requests</div>';
  } else {
    h += '<div style="flex:1;overflow-y:auto;max-height:320px;">';
    openRequests.slice(0, 6).forEach(function(r, ri) {
      var blob = ((r.type || '') + ' ' + (r.details || '') + ' ' + (r.title || '')).toLowerCase();
      var isUrgent = /urgent|asap|important|rush|emergency/.test(blob);
      h += '<div style="padding:8px 0;border-bottom:1px solid #f8fafc;display:flex;gap:8px;align-items:flex-start;">';
      h += '<div style="flex:1;min-width:0;">';
      h += '<div style="font-size:12px;font-weight:700;color:#0f172a;display:flex;align-items:center;gap:4px;">';
      if (isUrgent) h += '<span style="padding:1px 6px;border-radius:4px;background:#fecaca;color:#dc2626;font-size:9px;font-weight:800;flex-shrink:0;">URGENT</span>';
      h += '<span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (r.type || r.title || 'Request').replace(/</g, '&lt;') + '</span></div>';
      if (r.details) h += '<div style="font-size:11px;color:#64748b;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.35;">' + (r.details || '').replace(/</g, '&lt;') + '</div>';
      h += '<div style="font-size:10px;color:#94a3b8;margin-top:3px;">' + (r.createdAt ? overviewRelativeTime(r.createdAt) : '') + '</div></div>';
      h += '<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">';
      if (r.id) {
        h += '<button type="button" class="ov-req-assign" data-req-id="' + String(r.id).replace(/"/g, '&quot;') + '" style="padding:2px 8px;border-radius:4px;border:1px solid #e2e8f0;background:#fff;color:#475569;font-size:10px;font-weight:600;cursor:pointer;">Assign</button>';
        h += '<button type="button" class="ov-req-done" data-req-id="' + String(r.id).replace(/"/g, '&quot;') + '" style="padding:2px 8px;border-radius:4px;border:1px solid #e2e8f0;background:#fff;color:#059669;font-size:10px;font-weight:600;cursor:pointer;">Done</button>';
      }
      h += '</div></div>';
    });
    h += '</div>';
    if (openRequests.length > 6) h += '<div style="font-size:11px;color:#1e40af;padding-top:8px;cursor:pointer;font-weight:700;text-align:center;" class="ov-show-all-requests">View all ' + openRequests.length + ' requests</div>';
  }
  h += '</div>';

  // Calendar Card (mini month)
  h += '<div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;padding:12px 14px;min-height:280px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">';
  h += '<span style="font-size:13px;font-weight:800;color:#0f172a;">Content Calendar</span>';
  h += '<div style="display:flex;gap:4px;">';
  h += '<button type="button" class="ov-cal-prev" style="width:24px;height:24px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;font-size:12px;color:#475569;">‹</button>';
  h += '<span id="ovCalMonth" style="font-size:12px;font-weight:700;color:#475569;padding:0 6px;line-height:24px;"></span>';
  h += '<button type="button" class="ov-cal-next" style="width:24px;height:24px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;font-size:12px;color:#475569;">›</button>';
  h += '</div></div>';
  h += '<div id="ovCalGrid"></div>';
  h += '</div>';

  // Designer Completion Ring + recent tasks
  function designerInitials(designerId) {
    var d = (typeof designersCache !== 'undefined' ? designersCache : []).find(function(x) { return x.id === designerId; });
    var name = (d && (d.name || d.email)) || '';
    if (!name) return '?';
    var parts = name.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    return (parts[0].charAt(0) + (parts[1] ? parts[1].charAt(0) : '')).toUpperCase();
  }
  var totalTasks = prodTasks.length;
  var completedTasks = prodTasks.filter(function(t) { return t.status === 'approved' || t.status === 'ready_to_post'; }).length;
  var pct = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  var circumference = 2 * Math.PI * 54;
  var dashOffset = circumference - (circumference * pct / 100);
  var overdueCount = prodTasks.filter(function(t) {
    if (!t.deadline) return false;
    if (t.status === 'approved' || t.status === 'ready_to_post') return false;
    return String(t.deadline).slice(0, 10) < todayStr;
  }).length;
  var recentTasks = prodTasks.filter(function(t) {
    return t.status !== 'approved' && t.status !== 'ready_to_post';
  }).sort(function(a, b) {
    return new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime();
  }).slice(0, 3);
  var statusColors = {
    assigned: { bg: '#f1f5f9', color: '#475569', label: 'Assigned' },
    in_progress: { bg: '#dbeafe', color: '#1d4ed8', label: 'Working' },
    review: { bg: '#fef3c7', color: '#d97706', label: 'Review' },
    changes_requested: { bg: '#fee2e2', color: '#dc2626', label: 'Changes' },
  };

  h += '<div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;padding:12px 14px;display:flex;flex-direction:column;align-items:stretch;min-height:280px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">';
  h += '<span style="font-size:12px;font-weight:800;color:#0f172a;margin-bottom:8px;text-align:center;">Designer Tasks<br>Completion</span>';
  h += '<div style="display:flex;justify-content:center;">';
  h += '<div style="position:relative;width:120px;height:120px;">';
  h += '<svg width="120" height="120" viewBox="0 0 120 120">';
  h += '<circle cx="60" cy="60" r="54" fill="none" stroke="#f1f5f9" stroke-width="8"/>';
  h += '<circle cx="60" cy="60" r="54" fill="none" stroke="' + (pct >= 80 ? '#059669' : pct >= 40 ? '#2563eb' : '#d97706') + '" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + circumference + '" stroke-dashoffset="' + dashOffset + '" transform="rotate(-90 60 60)" style="transition:stroke-dashoffset 0.8s ease;"/>';
  h += '</svg>';
  h += '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center;">';
  h += '<div style="font-size:28px;font-weight:900;color:' + (pct >= 80 ? '#059669' : pct >= 40 ? '#2563eb' : '#d97706') + ';">' + pct + '%</div>';
  h += '</div></div></div>';
  h += '<div style="font-size:11px;color:#64748b;margin-top:6px;text-align:center;">' + completedTasks + ' of ' + totalTasks + ' tasks done</div>';
  if (overdueCount > 0) {
    h += '<div style="font-size:10px;font-weight:800;color:#dc2626;text-align:center;margin-top:4px;">' + overdueCount + ' overdue</div>';
  }
  if (recentTasks.length > 0) {
    h += '<div style="margin-top:10px;border-top:1px solid #f1f5f9;padding-top:8px;">';
    recentTasks.forEach(function(t) {
      var sc = statusColors[t.status] || statusColors.assigned;
      var title = (t.title || 'Task').replace(/</g, '&lt;');
      if (title.length > 28) title = title.substring(0, 28) + '…';
      h += '<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid #f8fafc;">';
      h += '<span style="padding:2px 6px;border-radius:4px;background:' + sc.bg + ';color:' + sc.color + ';font-size:9px;font-weight:700;flex-shrink:0;">' + sc.label + '</span>';
      h += '<span style="font-size:10px;color:#0f172a;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + title + '</span>';
      h += '<span style="font-size:9px;font-weight:800;color:#64748b;flex-shrink:0;">' + designerInitials(t.designerId) + '</span>';
      h += '</div>';
    });
    h += '</div>';
  }
  h += '<button type="button" class="ov-view-production" style="margin-top:auto;padding:8px 10px;border-radius:8px;border:1px solid #e2e8f0;background:#f8fafc;color:#1e40af;font-size:11px;font-weight:700;cursor:pointer;">View Production →</button>';
  h += '</div></div>';

  // ─── ROW 4: AI Ideas (collapsed by default) ───
  h += '<div style="margin-bottom:12px;" class="ov-row4">';
  h += '<div style="background:#fff;border-radius:14px;border:1px solid #e2e8f0;padding:12px 14px;box-shadow:0 1px 3px rgba(0,0,0,0.04);">';
  h += '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">';
  h += '<button type="button" class="ov-ideas-toggle" aria-expanded="false" style="display:flex;align-items:center;gap:8px;background:none;border:none;cursor:pointer;padding:0;text-align:left;">';
  h += '<span style="font-size:11px;color:#64748b;font-weight:800;">▶</span>';
  h += '<div style="display:flex;align-items:center;gap:8px;">';
  h += '<div style="width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,#fef3c7,#fde68a);display:flex;align-items:center;justify-content:center;font-size:14px;">💡</div>';
  h += '<span style="font-size:13px;font-weight:800;color:#0f172a;">AI Ideas</span></div></button>';
  h += '<button type="button" class="ov-ai-refresh" data-type="ideas" style="padding:4px 10px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;color:#64748b;font-size:10px;font-weight:700;cursor:pointer;flex-shrink:0;">Refresh</button>';
  h += '</div>';
  h += '<div id="ovAiIdeas" class="ov-ideas-body" style="display:none;margin-top:10px;font-size:12px;color:#475569;line-height:1.55;">';
  h += '<div style="color:#94a3b8;font-style:italic;">Loading ideas...</div></div>';
  h += '</div></div>';

  // Blockers (only if exists)
  if (openNeeds.length > 0) {
    h += '<div style="background:linear-gradient(135deg,#fef2f2,#fff1f2);border-radius:14px;border:1.5px solid #fecaca;padding:12px 14px;margin-top:10px;">';
    h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">';
    h += '<span style="font-size:13px;font-weight:800;color:#dc2626;">Blockers & Missing</span></div>';
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;">';
    openNeeds.slice(0, 5).forEach(function(n) {
      h += '<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:8px;background:rgba(220,38,38,0.08);font-size:12px;color:#991b1b;font-weight:600;">✖ ' + (n.label || n.text || 'Missing').replace(/</g, '&lt;') + '</span>';
    });
    h += '</div></div>';
  }

  // Responsive
  h += '<style>';
  h += '.ov-kpi:hover{background:#f8fafc!important;}';
  h += '@media(max-width:1100px){.ov-row2{grid-template-columns:1fr !important;}.ov-row3{grid-template-columns:1fr 1fr !important;}}';
  h += '@media(max-width:768px){.ov-row2{grid-template-columns:1fr !important;}.ov-row3{grid-template-columns:1fr !important;}}';
  h += '</style>';

  overviewContent.innerHTML = h;

  // ── Bind events ──
  overviewContent.querySelectorAll('.ov-kpi').forEach(function(kpi) {
    kpi.addEventListener('click', function() {
      var act = kpi.getAttribute('data-kpi-action');
      if (act === 'scheduled') switchTab('scheduled');
      else if (act === 'production') switchToProductionView();
      else if (act === 'approvals') switchTab('approvals');
      else if (act === 'requests') switchTab('requests');
      else if (act === 'needs') switchTab('needs');
    });
  });

  var showAllReqs = overviewContent.querySelector('.ov-show-all-requests');
  if (showAllReqs) showAllReqs.addEventListener('click', function() { switchTab('requests'); });

  overviewContent.querySelectorAll('.ov-edit-links').forEach(function(btn) {
    btn.addEventListener('click', function() { openLinksEditorModal(currentClientId); });
  });

  var ideasToggle = overviewContent.querySelector('.ov-ideas-toggle');
  var ideasBody = document.getElementById('ovAiIdeas');
  if (ideasToggle && ideasBody) {
    ideasToggle.addEventListener('click', function() {
      var open = ideasBody.style.display !== 'none';
      ideasBody.style.display = open ? 'none' : 'block';
      ideasToggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      var caret = ideasToggle.querySelector('span');
      if (caret) caret.textContent = open ? '▶' : '▼';
    });
  }

  overviewContent.querySelectorAll('.ov-ai-refresh').forEach(function(btn) {
    btn.addEventListener('click', function() { loadOverviewAI(true); });
  });

  var viewProdBtn = overviewContent.querySelector('.ov-view-production');
  if (viewProdBtn) viewProdBtn.addEventListener('click', function() { switchToProductionView(); });

  // ── Mini Calendar ──
  var calMonth = new Date().getMonth();
  var calYear = new Date().getFullYear();
  var calApiByDay = null;

  function mergeApprovalDayStats() {
    var postDates = {};
    var reviewSt = { pending: 1, changes: 1, copy_pending: 1, copy_approved: 1, copy_changes: 1 };
    approvals.forEach(function(a) {
      var d = a.postDate || a.date;
      if (!d || typeof d !== 'string') return;
      var key = d.substring(0, 10);
      if (!postDates[key]) postDates[key] = { count: 0, review: false, planned: false };
      postDates[key].count++;
      var st = a.status || 'pending';
      if (reviewSt[st]) postDates[key].review = true;
      if (st === 'approved') postDates[key].planned = true;
    });
    return postDates;
  }

  function renderMiniCal() {
    var grid = document.getElementById('ovCalGrid');
    var monthLabel = document.getElementById('ovCalMonth');
    if (!grid || !monthLabel) return;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    monthLabel.textContent = months[calMonth] + ' ' + calYear;

    var postDates = mergeApprovalDayStats();
    if (calApiByDay) {
      Object.keys(calApiByDay).forEach(function(key) {
        var api = calApiByDay[key];
        if (!postDates[key]) postDates[key] = { count: 0, review: false, planned: false, pub: 0, sch: 0 };
        postDates[key].count = Math.max(postDates[key].count, api.n || 0);
        postDates[key].pub = api.pub || 0;
        postDates[key].sch = api.sch || 0;
        if (api.pub > 0) postDates[key].hasPublished = true;
      });
    }

    var firstDay = new Date(calYear, calMonth, 1).getDay();
    var daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    var todayKey = new Date().toISOString().slice(0, 10);

    var ch = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;text-align:center;">';
    ['S','M','T','W','T','F','S'].forEach(function(d) {
      ch += '<div style="font-size:9px;font-weight:700;color:#94a3b8;padding:4px 0;">' + d + '</div>';
    });
    for (var e = 0; e < firstDay; e++) ch += '<div></div>';
    for (var d = 1; d <= daysInMonth; d++) {
      var dateKey = calYear + '-' + String(calMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var dayInfo = postDates[dateKey];
      var isToday = dateKey === todayKey;
      var bg = 'transparent';
      var textColor = '#475569';
      var dotHtml = '';
      var count = dayInfo ? dayInfo.count : 0;
      if (dayInfo && count > 0) {
        var tone = 'blue';
        if (dayInfo.hasPublished || (dayInfo.pub && dayInfo.pub > 0)) tone = 'green';
        else if (dayInfo.review) tone = 'orange';
        if (tone === 'green') { bg = '#dcfce7'; textColor = '#166534'; }
        else if (tone === 'orange') { bg = '#ffedd5'; textColor = '#c2410c'; }
        else { bg = '#dbeafe'; textColor = '#1e40af'; }
        var dotColor = tone === 'green' ? '#059669' : tone === 'orange' ? '#d97706' : '#2563eb';
        if (count === 1) dotHtml = '<div style="width:4px;height:4px;border-radius:50%;background:' + dotColor + ';margin:1px auto 0;"></div>';
        else dotHtml = '<div style="font-size:7px;color:' + dotColor + ';font-weight:900;line-height:1;">' + count + '</div>';
      }
      if (isToday) {
        bg = '#1e40af';
        textColor = '#fff';
        if (dayInfo && count > 0) dotHtml = dotHtml.replace(/#059669|#d97706|#2563eb/g, '#e0e7ff');
      }
      ch += '<div class="ov-cal-day" data-date="' + dateKey + '" style="padding:3px 0;border-radius:6px;background:' + bg + ';cursor:pointer;">';
      ch += '<div style="font-size:11px;font-weight:' + (isToday || count > 0 ? '700' : '500') + ';color:' + textColor + ';line-height:1.3;">' + d + '</div>';
      ch += dotHtml + '</div>';
    }
    ch += '</div>';

    ch += '<div style="display:flex;gap:10px;margin-top:8px;justify-content:center;flex-wrap:wrap;">';
    ch += '<div style="display:flex;align-items:center;gap:4px;font-size:9px;color:#64748b;font-weight:600;"><div style="width:8px;height:8px;border-radius:3px;background:#dbeafe;"></div> Planned</div>';
    ch += '<div style="display:flex;align-items:center;gap:4px;font-size:9px;color:#64748b;font-weight:600;"><div style="width:8px;height:8px;border-radius:3px;background:#ffedd5;"></div> In review</div>';
    ch += '<div style="display:flex;align-items:center;gap:4px;font-size:9px;color:#64748b;font-weight:600;"><div style="width:8px;height:8px;border-radius:3px;background:#dcfce7;"></div> Published</div>';
    ch += '<div style="display:flex;align-items:center;gap:4px;font-size:9px;color:#64748b;font-weight:600;"><div style="width:8px;height:8px;border-radius:50%;background:#1e40af;"></div> Today</div>';
    ch += '</div>';

    grid.innerHTML = ch;

    grid.querySelectorAll('.ov-cal-day').forEach(function(day) {
      day.addEventListener('click', function() {
        var dk = day.getAttribute('data-date');
        if (!dk) return;
        window.__scheduledFilterDate = dk;
        switchTab('scheduled');
      });
    });
  }

  renderMiniCal();

  if (currentClientId) {
    fetch(getApiBaseUrl() + '/api/posts/scheduled?clientId=' + encodeURIComponent(currentClientId), { credentials: 'include' })
      .then(function(r) { return r.json(); })
      .then(function(j) {
        var posts = (j && j.posts) || [];
        var byDay = {};
        posts.forEach(function(p) {
          if (!p.scheduledAt) return;
          var key = new Date(p.scheduledAt).toISOString().slice(0, 10);
          if (!byDay[key]) byDay[key] = { n: 0, pub: 0, sch: 0 };
          byDay[key].n++;
          if (p.status === 'published') byDay[key].pub++;
          else byDay[key].sch++;
        });
        calApiByDay = byDay;
        renderMiniCal();
      })
      .catch(function() {});
  }

  var calPrev = overviewContent.querySelector('.ov-cal-prev');
  var calNext = overviewContent.querySelector('.ov-cal-next');
  if (calPrev) calPrev.addEventListener('click', function() { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderMiniCal(); });
  if (calNext) calNext.addEventListener('click', function() { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderMiniCal(); });

  function bindSummaryRows(container) {
    if (!container) return;
    container.querySelectorAll('.ov-sum-row').forEach(function(row) {
      row.addEventListener('click', function() {
        var t = (row.textContent || '').toLowerCase();
        if (t.indexOf('request') !== -1) switchTab('requests');
        else if (t.indexOf('approv') !== -1 || t.indexOf('client') !== -1) switchTab('approvals');
        else if (t.indexOf('schedul') !== -1 || t.indexOf('post') !== -1 || t.indexOf('calendar') !== -1) switchTab('scheduled');
        else if (t.indexOf('production') !== -1 || t.indexOf('design') !== -1) switchToProductionView();
        else if (t.indexOf('asset') !== -1 || t.indexOf('missing') !== -1 || t.indexOf('need') !== -1) switchTab('needs');
        else switchTab('overview');
      });
    });
  }

  function applyOverviewSummaryHtml(summaryText, summaryEl) {
    if (!summaryEl) return;
    var raw = (summaryText || '').trim();
    if (!raw) {
      summaryEl.innerHTML = '<div style="color:#94a3b8;font-size:12px;">No summary yet.</div>';
      return;
    }
    var lines = raw.split(/\n/).map(function(l) { return l.trim(); }).filter(Boolean);
    if (lines.length === 1 && lines[0].indexOf('•') === -1 && lines[0].indexOf('🔴') !== 0 && lines[0].indexOf('🟡') !== 0 && lines[0].indexOf('🟢') !== 0) {
      summaryEl.innerHTML = '<div style="line-height:1.55;">' + lines[0].replace(/</g, '&lt;') + '</div>';
      return;
    }
    var esc = function(s) { return s.replace(/</g, '&lt;'); };
    var visible = lines.slice(0, 2);
    var rest = lines.slice(2);
    var mkRow = function(line) {
      var border = '#e2e8f0';
      if (line.indexOf('🔴') === 0) border = '#dc2626';
      else if (line.indexOf('🟡') === 0) border = '#d97706';
      else if (line.indexOf('🟢') === 0) border = '#059669';
      return '<div class="ov-sum-row" style="border-left:3px solid ' + border + ';padding:6px 8px;margin-bottom:6px;border-radius:0 8px 8px 0;background:#fafafa;cursor:pointer;">' + esc(line) + '</div>';
    };
    var html = '<div id="ovSumVisible">' + visible.map(mkRow).join('') + '</div>';
    if (rest.length > 0) {
      html += '<div id="ovSumMore" style="display:none;">' + rest.map(mkRow).join('') + '</div>';
      html += '<button type="button" id="ovSumToggle" style="margin-top:6px;padding:4px 10px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;color:#1e40af;font-size:10px;font-weight:700;cursor:pointer;">Show more</button>';
    }
    summaryEl.innerHTML = html;
    bindSummaryRows(summaryEl);
    var toggle = document.getElementById('ovSumToggle');
    var more = document.getElementById('ovSumMore');
    if (toggle && more) {
      toggle.addEventListener('click', function() {
        var open = more.style.display !== 'none';
        more.style.display = open ? 'none' : 'block';
        toggle.textContent = open ? 'Show more' : 'Show less';
      });
    }
  }

  function applyOverviewIdeasHtml(ideasText, ideasEl) {
    if (!ideasEl) return;
    window.__overviewIdeaLines = [];
    var raw = (ideasText || '').trim();
    if (!raw) {
      ideasEl.innerHTML = '<div style="color:#94a3b8;font-size:12px;">No ideas yet.</div>';
      return;
    }
    var lines = raw.split(/\n/).map(function(l) { return l.trim(); }).filter(Boolean);
    var esc = function(s) { return s.replace(/</g, '&lt;'); };
    var htm = '';
    lines.forEach(function(line, idx) {
      var ideaText = line.replace(/^[•\-\*]\s*/, '').trim();
      window.__overviewIdeaLines.push(ideaText);
      htm += '<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 0;border-bottom:1px solid #f1f5f9;">';
      htm += '<span style="color:#d97706;font-weight:800;flex-shrink:0;">•</span>';
      htm += '<span style="flex:1;font-size:12px;line-height:1.45;">' + esc(line.replace(/^[•\-\*]\s*/, '')) + '</span>';
      htm += '<button type="button" class="ov-create-from-idea" data-idea-index="' + idx + '" style="padding:3px 8px;border-radius:4px;border:1px solid #e2e8f0;background:#fff;color:#1e40af;font-size:10px;font-weight:600;cursor:pointer;flex-shrink:0;">Create Post</button>';
      htm += '</div>';
    });
    ideasEl.innerHTML = htm || '<div style="color:#94a3b8;font-size:12px;">No ideas yet.</div>';
    ideasEl.querySelectorAll('.ov-create-from-idea').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var ix = parseInt(btn.getAttribute('data-idea-index'), 10);
        var text = (window.__overviewIdeaLines && window.__overviewIdeaLines[ix]) || '';
        switchTab('approvals');
        setTimeout(function() {
          var captionField = document.getElementById('approvalCaption') || document.getElementById('approvalCopyText');
          if (captionField) captionField.value = text;
        }, 200);
      });
    });
  }

  // ── Load AI Summary + Ideas ──
  function loadOverviewAI(force) {
    var summaryEl = document.getElementById('ovAiSummary');
    var ideasEl = document.getElementById('ovAiIdeas');
    if (!summaryEl || !ideasEl) return;
    if (force) {
      summaryEl.innerHTML = '<div style="color:#94a3b8;font-style:italic;">Generating...</div>';
      ideasEl.innerHTML = '<div style="color:#94a3b8;font-style:italic;">Generating...</div>';
    }
    fetch(getApiBaseUrl() + '/api/ai-copilot/overview-summary', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ clientId: currentClientId, forceRefresh: !!force })
    }).then(function(r) { return r.json(); }).then(function(d) {
      if (d.error) {
        summaryEl.innerHTML = '<div style="color:#94a3b8;font-size:12px;">AI not available</div>';
        ideasEl.innerHTML = '<div style="color:#94a3b8;font-size:12px;">AI not available</div>';
        return;
      }
      if (d.summary) applyOverviewSummaryHtml(d.summary, summaryEl);
      if (d.ideas) applyOverviewIdeasHtml(d.ideas, ideasEl);
    }).catch(function() {
      summaryEl.innerHTML = '<div style="color:#94a3b8;font-size:12px;">Could not load AI summary</div>';
      ideasEl.innerHTML = '<div style="color:#94a3b8;font-size:12px;">Could not load AI ideas</div>';
    });
  }

  overviewContent.querySelectorAll('.ov-req-done').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var id = btn.getAttribute('data-req-id');
      if (id) markRequestDone(id);
    });
  });
  overviewContent.querySelectorAll('.ov-req-assign').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var id = btn.getAttribute('data-req-id');
      var state = load();
      var req = (state.requests || []).find(function(x) { return String(x.id) === String(id); });
      if (req && typeof openRequestDetail === 'function') openRequestDetail(req);
      else switchTab('requests');
    });
  });

  loadOverviewAI(false);
  updateTabCountBadges();
  setupClientManagementButtons();
}

function renderActivityLog(activity) {
  const container = $('#activityLogList');
  if (!container) return;
  if (!activity || activity.length === 0) {
    container.innerHTML = 'No activity yet.';
    return;
  }
  const recent = activity.slice(-15).reverse();
  container.innerHTML = '';
  recent.forEach(entry => {
    const item = el('div', { class: 'activity-log-item' });
    item.textContent = `${entry.text || 'Activity'} — ${fmtDate(entry.when)}`;
    container.appendChild(item);
  });
}

function renderClientWorkspaceChecklist() {
  const wrap = $('#clientWorkspaceChecklist');
  const list = $('#clientWorkspaceChecklistList');
  const header = $('#clientWorkspaceChecklistHeader');
  const badge = $('#clientWorkspaceChecklistBadge');
  const caret = $('#clientWorkspaceChecklistCaret');
  if (!wrap || !list) return;
  if (!currentClientId) {
    wrap.style.display = 'none';
    return;
  }
  const data = getClientHealthData(currentClientId);
  const brandDone = data.brandAssetsUploaded;
  const needsDone = data.agencyNeedsProvided;
  const inviteDone = data.invitedToPortal;
  const allComplete = brandDone && needsDone && inviteDone;

  list.innerHTML = '';
  const items = [
    { label: 'Brand assets', done: brandDone, focus: 'contentlibrary' },
    { label: 'Agency needs', done: needsDone, focus: 'needs' },
    { label: 'Client invite', done: inviteDone, focus: 'invite' }
  ];
  items.forEach(({ label, done, focus }) => {
    const li = el('li');
    const check = el('span', { class: 'check' });
    check.textContent = done ? '✅' : '❌';
    const btn = el('button', { type: 'button', class: (done ? 'done ' : '') + 'client-workspace-checklist__item', 'data-focus': focus }, label);
    btn.addEventListener('click', (e) => { e.stopPropagation(); focusOnSection(focus); });
    li.appendChild(check);
    li.appendChild(btn);
    list.appendChild(li);
  });

  if (badge) badge.style.display = allComplete ? 'inline-block' : 'none';
  if (wrap) {
    wrap.classList.toggle('collapsed', allComplete);
    wrap.style.display = 'block';
  }
  if (header && !header._bound) {
    header._bound = true;
    header.addEventListener('click', () => {
      wrap.classList.toggle('collapsed');
      if (caret) caret.style.transform = wrap.classList.contains('collapsed') ? 'rotate(-90deg)' : '';
    });
  }
  if (caret && wrap.classList.contains('collapsed')) caret.style.transform = 'rotate(-90deg)';
}

function focusOnSection(sectionId) {
  if (sectionId === 'contentlibrary' || sectionId === 'tabContentlibrary') { switchTab('contentlibrary'); return; }
  if (sectionId === 'scheduled' || sectionId === 'tabScheduled') { switchTab('scheduled'); return; }
  if (sectionId === 'needs' || sectionId === 'tabNeeds') { switchTab('needs'); return; }
  if (sectionId === 'approvals') { switchTab('approvals'); return; }
  if (sectionId === 'requests') { switchTab('requests'); return; }
  if (sectionId === 'overview') { switchTab('overview'); return; }
  if (sectionId === 'invite') {
    const settingsBtn = $('#settingsBtn');
    if (settingsBtn) settingsBtn.click();
    return;
  }
}

// Single document listener for "click outside to close" kebab menu (avoid adding one per render)
function _setupKebabCloseOutsideOnce() {
  if (window._kebabCloseOutsideBound) return;
  window._kebabCloseOutsideBound = true;
  document.addEventListener('click', (e) => {
    const menu = document.getElementById('clientKebabMenu');
    const btn = document.getElementById('clientKebabBtn');
    if (!menu || !btn) return;
    if (menu.contains(e.target) || btn.contains(e.target)) return;
    menu.style.display = 'none';
  });
}

// Kebab menu: attach once so we don't stack handlers when setupClientManagementButtons runs every render
function _setupKebabMenuOnce() {
  if (window._kebabMenuBound) return;
  window._kebabMenuBound = true;
  const kebabBtn = document.getElementById('clientKebabBtn');
  const kebabMenu = document.getElementById('clientKebabMenu');
  const kebabAddLogo = document.getElementById('kebabAddLogo');
  const kebabEdit = document.getElementById('kebabEditClient');
  const kebabDelete = document.getElementById('kebabDeleteClient');
  if (!kebabBtn || !kebabMenu) return;
  _setupKebabCloseOutsideOnce();
  kebabBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const menu = document.getElementById('clientKebabMenu');
    if (!menu) return;
    const isHidden = menu.style.display === 'none' || !menu.style.display;
    menu.style.display = isHidden ? 'block' : 'none';
  });
  kebabMenu.addEventListener('click', (e) => e.stopPropagation());
  if (kebabAddLogo) {
    kebabAddLogo.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const input = document.getElementById('clientLogoInput');
      if (input) {
        input.value = '';
        input.click();
      }
      setTimeout(() => {
        const m = document.getElementById('clientKebabMenu');
        if (m) m.style.display = 'none';
      }, 0);
    });
  }
  if (kebabEdit) {
    kebabEdit.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      editCurrentClient();
      const m = document.getElementById('clientKebabMenu');
      if (m) m.style.display = 'none';
    });
  }
  if (kebabDelete) {
    kebabDelete.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      deleteCurrentClient();
      const m = document.getElementById('clientKebabMenu');
      if (m) m.style.display = 'none';
    });
  }
  const kebabActivity = document.getElementById('kebabRecentActivity');
  if (kebabActivity) {
    kebabActivity.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRecentActivityModal();
      const m = document.getElementById('clientKebabMenu');
      if (m) m.style.display = 'none';
    });
  }
  const kebabTestNotif = document.getElementById('kebabTestNotification');
  if (kebabTestNotif) {
    kebabTestNotif.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const m = document.getElementById('clientKebabMenu');
      if (m) m.style.display = 'none';
      if (!currentClientId) { showToast('Select a client first', 'error'); return; }
      var clients = loadClientsRegistry();
      var clientName = (clients[currentClientId] && clients[currentClientId].name) || 'Client';
      // Send test notification to the client's portal users
      fetch(getApiBaseUrl() + '/api/notifications/send-to-client', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ clientId: currentClientId, title: 'Fresh content ready! ✨', body: 'Your team just prepared new content for ' + clientName + '. Take a quick look and approve!' })
      }).then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success) showToast('Test notification sent to ' + clientName + ' portal users!', 'success');
          else showToast(d.error || 'Failed to send', 'error');
        })
        .catch(function() { showToast('Failed to send notification', 'error'); });
    });
  }
}

function openRecentActivityModal() {
  var existing = document.getElementById('recentActivityModal');
  if (existing) existing.remove();
  var state = load();
  var activity = (state && state.activity) || [];

  var overlay = document.createElement('div');
  overlay.id = 'recentActivityModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease-out;';

  var modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:16px;max-width:560px;width:95%;max-height:80vh;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3);display:flex;flex-direction:column;animation:slideUp 0.2s ease-out;';

  var headerHtml = '<div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;">';
  headerHtml += '<h3 style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">Recent Activity</h3>';
  headerHtml += '<button type="button" id="activityModalClose" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:22px;line-height:1;">&times;</button>';
  headerHtml += '</div>';

  var bodyHtml = '<div style="padding:16px 24px;overflow-y:auto;flex:1;">';
  if (activity.length === 0) {
    bodyHtml += '<div style="text-align:center;padding:32px 0;color:#94a3b8;font-size:14px;">No activity recorded yet.</div>';
  } else {
    activity.slice().reverse().forEach(function(a) {
      bodyHtml += '<div style="padding:10px 0;border-bottom:1px solid #f1f5f9;display:flex;align-items:flex-start;gap:10px;">';
      bodyHtml += '<div style="width:8px;height:8px;border-radius:50%;background:#cbd5e1;margin-top:6px;flex-shrink:0;"></div>';
      bodyHtml += '<div style="flex:1;">';
      bodyHtml += '<div style="font-size:13px;color:#0f172a;">' + (a.text || 'Activity').replace(/</g, '&lt;') + '</div>';
      if (a.when) bodyHtml += '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + fmtDate(a.when) + '</div>';
      bodyHtml += '</div></div>';
    });
  }
  bodyHtml += '</div>';

  modal.innerHTML = headerHtml + bodyHtml;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  document.getElementById('activityModalClose').addEventListener('click', function() { overlay.remove(); });
  function onEsc(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } }
  document.addEventListener('keydown', onEsc);
}

// Setup edit and delete client buttons (and kebab menu)
function setupClientManagementButtons() {
  const editBtn = $('#editClientBtn');
  const deleteBtn = $('#deleteClientBtn');
  if (editBtn) {
    editBtn.removeEventListener('click', editCurrentClient);
    editBtn.addEventListener('click', editCurrentClient);
  }
  if (deleteBtn) {
    deleteBtn.removeEventListener('click', deleteCurrentClient);
    deleteBtn.addEventListener('click', deleteCurrentClient);
  }
  _setupKebabMenuOnce();
}

// Edit current client - opens form with existing data
function editCurrentClient() {
  if (!currentClientId) {
    showToast('Please select a client first');
    return;
  }
  
  const clients = loadClientsRegistry();
  const client = clients[currentClientId];
  
  if (!client) {
    showToast('Client not found');
    return;
  }
  
  // Set edit mode flag
  window.editingClientId = currentClientId;
  
  // Populate form with client data
  $('#clientName').value = client.name || '';
  $('#clientIdInput').value = client.id || '';
  $('#clientIdInput').disabled = true; // Don't allow ID changes
  $('#clientCategory').value = client.category || '';
  $('#primaryContactName').value = client.primaryContactName || '';
  $('#primaryContactWhatsApp').value = client.primaryContactWhatsApp || '';
  $('#primaryContactEmail').value = client.primaryContactEmail || '';
  $('#preferredChannel').value = client.preferredChannel || '';
  
  // Populate logo in form
  updateFormLogo(client.logoUrl, client.name);
  
  // Set platforms
  $$('input[name="platformsManaged"]').forEach(cb => {
    cb.checked = (client.platformsManaged || []).includes(cb.value);
  });
  
  $('#postingFrequency').value = client.postingFrequency || '';
  if (client.postingFrequency === 'custom' && client.postingFrequencyNote) {
    $('#postingFrequencyNote').value = client.postingFrequencyNote;
    $('#postingFrequencyNote').style.display = 'block';
  }
  
  $('#approvalRequired').value = client.approvalRequired ? 'true' : 'false';
  $('#language').value = client.language || '';
  $('#assetsLink').value = client.assetsLink || '';
  $('#brandGuidelinesLink').value = client.brandGuidelinesLink || '';
  $('#primaryGoal').value = client.primaryGoal || '';
  $('#secondaryGoal').value = client.secondaryGoal || '';
  $('#internalBehaviorType').value = client.internalBehaviorType || '';
  $('#riskLevel').value = client.riskLevel || '';
  $('#internalNotes').value = client.internalNotes || '';
  
  // Update form title and submit button (target the form's h2, not the approvals panel)
  const formTitle = document.querySelector('#newClientForm h2');
  if (formTitle) formTitle.textContent = 'Edit Client';
  
  const submitBtn = $('#newClientForm button[type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Update Client';
  
  // Clear password field (don't show existing password)
  $('#clientPassword').value = '';
  $('#clientPassword').required = false;
  
  // Show modal without resetting (showNewClientModal skips reset when editingClientId is set)
  showNewClientModal();
}

async function deleteCurrentClient() {
  if (!currentClientId) {
    showToast('Please select a client first');
    return;
  }
  const client = getCurrentClient();
  if (!client) {
    showToast('Client not found');
    return;
  }
  if (!confirm(`Are you sure you want to delete "${client.name}"? This will permanently delete client info, approvals, requests, and portal data. This cannot be undone!`)) {
    return;
  }
  try {
    const r = await fetch(`${getApiBaseUrl()}/api/agency/clients/${currentClientId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' }
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Delete failed');
  } catch (e) {
    showToast('Failed to delete client. ' + (e.message || ''), 'error');
    return;
  }
  const name = client.name;
  const cid = currentClientId;
  currentClientId = null;
  try { localStorage.removeItem(LS_LAST_CLIENT_KEY); } catch (_) {}
  delete portalStateCache[cid];
  portalStateFetched.delete(cid);
  await fetchClientsFromAPI();
  renderClientsSidebar();
  const remaining = Object.keys(loadClientsRegistry());
  if (remaining.length > 0) {
    await selectClient(remaining[0]);
  } else {
    switchTab('overview');
  }
  showToast(`Client "${name}" has been deleted`);
}

/* ================== Approvals Tab ================== */
let selectedApprovalId = null;

function renderApprovalsTab() {
  const state = load();
  const container = $('#approvalsList');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Add click handler to container to deselect when clicking outside items
  // Remove previous handler if exists
  if (container._deselectHandler) {
    container.removeEventListener('click', container._deselectHandler);
  }
  
  container._deselectHandler = function(e) {
    // If clicking directly on the container or section title (but not on approval items)
    const clickedItem = e.target.closest('.approval-item');
    
    // Only deselect if clicking on container background or section titles (not on items)
    if (!clickedItem) {
        selectedApprovalId = null;
        $$('.approval-item').forEach(i => i.classList.remove('selected'));
        const approvalForm = $('#approvalForm');
        if (approvalForm) {
          approvalForm.reset();
        $('#approvalId').value = '';
        $('#editPanelTitle').textContent = 'Create Approval';
        $('#approvalDelete').style.display = 'none';
        postSelectedAssetIds = [];
        renderApprovalImageUrlRows(['']);
        renderApprovedVisualsSection();
        updatePostFormFromAssets();
        if ($('#postUploadApprovalWarning')) $('#postUploadApprovalWarning').style.display = 'none';
        var ipw = $('#imageUrlPreviewWrap'); if (ipw) ipw.style.display = 'none';
      }
    }
  };
  
  container.addEventListener('click', container._deselectHandler);
  
  const approvalsList = state.approvals || [];
  const pipelineCounts = getApprovalPipelineCounts(approvalsList);
  const now = new Date();
  const fifteenDaysFromNow = new Date(now);
  fifteenDaysFromNow.setDate(now.getDate() + 15);

  const copyPending = approvalsList.filter(a => a.status === 'copy_pending');
  const copyApproved = approvalsList.filter(a => a.status === 'copy_approved');
  const copyChanges = approvalsList.filter(a => a.status === 'copy_changes');
  const pending = approvalsList.filter(a => (!a.status || a.status === 'pending') && !['copy_pending', 'copy_approved', 'copy_changes'].includes(a.status));
  const changes = approvalsList.filter(a => a.status === 'changes');
  const approved = approvalsList.filter(a => a.status === 'approved' && (!a.postDate || new Date(a.postDate) < now || new Date(a.postDate) > fifteenDaysFromNow));
  const scheduled = approvalsList.filter(a => {
    if (a.status !== 'approved' || !a.postDate) return false;
    const postDate = new Date(a.postDate);
    return postDate >= now && postDate <= fifteenDaysFromNow;
  });

  const setPipelineCount = (id, n) => { const e = document.getElementById(id); if (e) e.textContent = n; };
  setPipelineCount('pipelineCountCopyPending', pipelineCounts.copyPending);
  setPipelineCount('pipelineCountCopyApproved', pipelineCounts.copyApproved);
  setPipelineCount('pipelineCountCopyChanges', pipelineCounts.copyChanges);
  setPipelineCount('pipelineCountAwaiting', pipelineCounts.awaiting);
  setPipelineCount('pipelineCountChanges', pipelineCounts.changes);
  setPipelineCount('pipelineCountApproved', pipelineCounts.approved);
  setPipelineCount('pipelineCountScheduled', pipelineCounts.scheduled);

  if (!window.approvalsSectionState) {
    window.approvalsSectionState = { copyPending: false, copyApproved: false, copyChanges: false, pending: false, changes: false, approved: false, scheduled: false };
  }

  const EMPTY_APPROVALS = {
    copyPending: 'No copy pending — create a post and send for copy approval.',
    copyApproved: 'No approved copy yet.',
    copyChanges: 'No copy revisions requested.',
    awaiting: 'No content is currently being created.',
    changes: 'No client changes requested.',
    approved: 'No approved content yet.',
    scheduled: 'No scheduled posts.'
  };

  function renderSection(title, items, containerEl, sectionKey, emptyMessage) {
    const section = el('div', { class: 'approvals-section', 'data-pipeline-section': sectionKey });
    const sectionTitle = el('div', { class: 'approvals-section__title' });
    
    // If section is empty, default to collapsed
    const isEmpty = items.length === 0;
    if (isEmpty && window.approvalsSectionState[sectionKey] === undefined) {
      window.approvalsSectionState[sectionKey] = true; // Collapse empty sections by default
    }
    
    // Title content with arrow
    const titleContent = el('div', { class: 'approvals-section__title-content' });
    const arrow = el('span', { 
      class: `approvals-section__arrow ${window.approvalsSectionState[sectionKey] ? 'collapsed' : ''}`
    });
    // Use SVG arrow for better compatibility
    arrow.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const titleText = el('span', {});
    titleText.textContent = `${title} (${items.length})`;
    titleContent.appendChild(arrow);
    titleContent.appendChild(titleText);
    sectionTitle.appendChild(titleContent);
    
    // Make title clickable to toggle (only if there are items)
    if (items.length > 0) {
      sectionTitle.style.cursor = 'pointer';
      sectionTitle.addEventListener('click', () => {
        window.approvalsSectionState[sectionKey] = !window.approvalsSectionState[sectionKey];
        const isCollapsed = window.approvalsSectionState[sectionKey];
        
        if (isCollapsed) {
          arrow.classList.add('collapsed');
          list.classList.remove('expanded');
          list.classList.add('collapsed');
        } else {
          arrow.classList.remove('collapsed');
          list.classList.remove('collapsed');
          list.classList.add('expanded');
        }
      });
    } else {
      // Empty section - no hover effect
      sectionTitle.style.cursor = 'default';
      sectionTitle.style.opacity = '0.6';
    }
    
    section.appendChild(sectionTitle);
    
    const list = el('div', { 
      class: `approvals-list approvals-section__list ${window.approvalsSectionState[sectionKey] ? 'collapsed' : 'expanded'}`
    });
    
    if (items.length === 0) {
      const emptyMsg = el('div', { 
        class: 'approvals-section__empty',
        style: 'padding: 16px; text-align: center; color: #64748b; font-size: 14px; line-height: 1.5;'
      }, emptyMessage || 'No items in this section');
      list.appendChild(emptyMsg);
    } else {
      items.forEach(item => {
        const itemEl = el('div', {
          class: `approval-item ${selectedApprovalId === item.id ? 'selected' : ''}`,
          'data-approval-id': item.id
        });
        
        const header = el('div', { class: 'approval-item__header' });
        const titleEl = el('div', { class: 'approval-item__title' });
        titleEl.textContent = item.title;
        header.appendChild(titleEl);
        
        const meta = el('div', { class: 'approval-item__meta' });
        meta.appendChild(el('span', { class: 'chip chip--type' }, item.type || 'Post'));
        // Format status display
        let statusDisplay = (item.status || 'pending');
        if (statusDisplay === 'copy_pending') statusDisplay = 'Copy Pending';
        else if (statusDisplay === 'copy_approved') statusDisplay = 'Copy Approved';
        else if (statusDisplay === 'copy_changes') statusDisplay = 'Copy Changes';
        else statusDisplay = statusDisplay.charAt(0).toUpperCase() + statusDisplay.slice(1);
        meta.appendChild(el('span', {
          class: `chip chip--status-${item.status || 'pending'}`
        }, statusDisplay));
        meta.appendChild(el('span', { class: 'approval-item__date' }, `Due ${item.date || 'N/A'}`));
        if (item.returnedFromChanges && (item.status === 'pending' || item.status === 'copy_pending')) {
          meta.appendChild(el('span', { class: 'chip', style: 'background:#fff7ed;color:#c2410c;font-size:11px;border:1px solid #fed7aa;' }, 'Updated from changes'));
        }
        if (item.source === 'production') {
          const fromProd = el('span', { class: 'chip chip--from-production', style: 'background: #dbeafe; color: #1d4ed8; font-size: 11px;' }, 'From Production');
          meta.appendChild(fromProd);
        }

        itemEl.appendChild(header);
        itemEl.appendChild(meta);
        
        // Show change request notes if status is "changes" or "copy_changes" and notes exist
        if ((item.status === 'changes' || item.status === 'copy_changes') && item.change_notes && item.change_notes.length > 0) {
          const latestNote = item.change_notes[item.change_notes.length - 1];
          const changeRequestBox = el('div', { 
            class: 'approval-item__change-request',
            style: 'margin-top: 12px; padding: 12px; background: #fff7ed; border-left: 3px solid #ea580c; border-radius: 6px;'
          });
          
          const changeRequestLabel = el('div', {
            style: 'font-size: 12px; font-weight: 600; color: #ea580c; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;'
          }, 'Change Request:');
          
          const changeRequestText = el('div', {
            style: 'font-size: 13px; color: #9a3412; line-height: 1.5;'
          }, latestNote.note || 'Change requested.');
          
          changeRequestBox.appendChild(changeRequestLabel);
          changeRequestBox.appendChild(changeRequestText);
          itemEl.appendChild(changeRequestBox);
        }

        if (sectionKey === 'copyApproved') {
          itemEl.setAttribute('data-approval-id', item.id);
          if (item.productionStatus === 'art_approved') {
            const artApprovedWrap = el('div', {
              class: 'schedule-section',
              style: 'margin-top: 12px; padding: 12px; background: #ecfdf5; border-radius: 8px; border: 1px solid #a7f3d0; font-size: 13px; color: #065f46;'
            });
            artApprovedWrap.textContent = 'Final art attached — click to review and send to client.';
            artApprovedWrap.addEventListener('click', (e) => e.stopPropagation());
            itemEl.appendChild(artApprovedWrap);
          } else if (item.source !== 'production') {
            const sendToDesignerWrap = el('div', {
              class: 'schedule-section',
              style: 'margin-top: 12px; padding: 12px; background: #f0f7ff; border-radius: 8px; border: 1px solid #d0e3ff;'
            });
            sendToDesignerWrap.addEventListener('click', (e) => e.stopPropagation());
            const sendToDesignerBtn = document.createElement('button');
            sendToDesignerBtn.textContent = 'Send to Designer';
            sendToDesignerBtn.style.cssText = 'padding: 6px 14px; background: #1a56db; color: white; border: 2px solid #1a56db; border-radius: 6px; cursor: pointer; font-size: 13px;';
            sendToDesignerBtn.addEventListener('click', (e) => { e.stopPropagation(); if (typeof openSendToDesignerModal === 'function') openSendToDesignerModal(item); });
            sendToDesignerWrap.appendChild(sendToDesignerBtn);
            itemEl.appendChild(sendToDesignerWrap);
          }
        }

        // Send to Designer button for Content Pending, Copy Pending, Changes Requested, Copy Changes
        if (sectionKey === 'pending' || sectionKey === 'copyPending' || sectionKey === 'changes' || sectionKey === 'copyChanges') {
          const isChangesSection = (sectionKey === 'changes' || sectionKey === 'copyChanges');
          const stdWrap = el('div', {
            class: 'schedule-section',
            style: 'margin-top: 12px; padding: 12px; background: #f0f7ff; border-radius: 8px; border: 1px solid #d0e3ff;'
          });
          stdWrap.addEventListener('click', (e) => e.stopPropagation());
          const stdBtn = document.createElement('button');
          stdBtn.textContent = 'Send to Designer';
          stdBtn.style.cssText = 'padding: 6px 14px; background: #1a56db; color: white; border: 2px solid #1a56db; border-radius: 6px; cursor: pointer; font-size: 13px;';
          stdBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isChangesSection) {
              // Show confirmation popup first
              var confirmed = confirm('This item was already sent to the assigned designer.\n\nAre you sure you want to send again?');
              if (!confirmed) return;
              // Pass change notes so designer sees them, and mark as changes_requested
              var changeNote = '';
              if (item.change_notes && item.change_notes.length) {
                changeNote = item.change_notes[item.change_notes.length - 1].note || '';
              }
              item._sendAsChangesRequested = true;
              item._changeRequestNote = changeNote;
            }
            if (typeof openSendToDesignerModal === 'function') openSendToDesignerModal(item);
          });
          stdWrap.appendChild(stdBtn);
          if (isChangesSection) {
            const sentNote = el('span', { style: 'margin-left: 10px; font-size: 12px; color: #64748b; font-style: italic;' }, 'Already sent to designer assigned');
            stdWrap.appendChild(sentNote);
          }
          itemEl.appendChild(stdWrap);
        }

        if (sectionKey === 'approved') {
          itemEl.setAttribute('data-approval-id', item.id);
          const prefillDate = item.postDate ? (function() {
            const d = new Date(item.postDate);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const h = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            return y + '-' + m + '-' + day + 'T' + h + ':' + min;
          })() : '';
          const scheduleSection = el('div', {
            class: 'schedule-section',
            style: 'margin-top: 12px; padding: 12px; background: #f0f7ff; border-radius: 8px; border: 1px solid #d0e3ff;'
          });
          scheduleSection.addEventListener('click', (e) => e.stopPropagation());
          if (item.source !== 'production') {
            const sendToDesignerBtn = document.createElement('button');
            sendToDesignerBtn.textContent = 'Send to Designer';
            sendToDesignerBtn.style.cssText = 'margin-bottom: 12px; padding: 6px 14px; background: #1a56db; color: white; border: 2px solid #1a56db; border-radius: 6px; cursor: pointer; font-size: 13px;';
            sendToDesignerBtn.addEventListener('click', (e) => { e.stopPropagation(); if (typeof openSendToDesignerModal === 'function') openSendToDesignerModal(item); });
            scheduleSection.appendChild(sendToDesignerBtn);
          }
          const heading = el('h4', { style: 'margin: 0 0 8px 0; font-size: 14px; color: #1a56db;' }, 'Schedule to Social Media');
          scheduleSection.appendChild(heading);
          const connectedWrap = el('div', { class: 'schedule-section-connected', style: 'display: none;' });
          const platformsRow = el('div', { style: 'display: flex; gap: 12px; align-items: center; flex-wrap: wrap;' });
          const igLabel = el('label', { style: 'display: flex; align-items: center; gap: 4px;' });
          const igCheck = document.createElement('input');
          igCheck.type = 'checkbox';
          igCheck.checked = true;
          igCheck.dataset.platform = 'instagram';
          igLabel.appendChild(igCheck);
          igLabel.appendChild(document.createTextNode(' Instagram'));
          const fbLabel = el('label', { style: 'display: flex; align-items: center; gap: 4px;' });
          const fbCheck = document.createElement('input');
          fbCheck.type = 'checkbox';
          fbCheck.checked = true;
          fbCheck.dataset.platform = 'facebook';
          fbLabel.appendChild(fbCheck);
          fbLabel.appendChild(document.createTextNode(' Facebook'));
          const dateInput = document.createElement('input');
          dateInput.type = 'datetime-local';
          dateInput.className = 'schedule-datetime';
          dateInput.value = prefillDate;
          dateInput.style.cssText = 'padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 6px;';
          const scheduleBtn = document.createElement('button');
          scheduleBtn.textContent = 'Schedule';
          scheduleBtn.style.cssText = 'padding: 6px 16px; background: #1a56db; color: white; border: none; border-radius: 6px; cursor: pointer;';
          scheduleBtn.addEventListener('click', () => { if (typeof scheduleFromApproval === 'function') scheduleFromApproval(item.id); });
          const postNowBtn = document.createElement('button');
          postNowBtn.textContent = 'Post Now';
          postNowBtn.style.cssText = 'padding: 6px 16px; background: #059669; color: white; border: none; border-radius: 6px; cursor: pointer;';
          postNowBtn.addEventListener('click', () => { if (typeof postNowFromApproval === 'function') postNowFromApproval(item.id); });
          platformsRow.appendChild(igLabel);
          platformsRow.appendChild(fbLabel);
          platformsRow.appendChild(dateInput);
          platformsRow.appendChild(scheduleBtn);
          platformsRow.appendChild(postNowBtn);
          connectedWrap.appendChild(platformsRow);
          const notConnectedWrap = el('div', { class: 'schedule-section-not-connected', style: 'display: none;' });
          const notConnectedP = el('p', { style: 'color: #6b7280; margin: 0;' }, "Connect this client's social accounts first.");
          const link = el('a', { href: '#', style: 'color: #1a56db; text-decoration: underline;' }, 'Go to Scheduled Posts → Connect');
          link.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); if (typeof switchTab === 'function') switchTab('scheduled'); return false; });
          notConnectedWrap.appendChild(notConnectedP);
          notConnectedWrap.appendChild(link);
          scheduleSection.appendChild(connectedWrap);
          scheduleSection.appendChild(notConnectedWrap);
          itemEl.appendChild(scheduleSection);
        }
        
        itemEl.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent section toggle and container click when clicking item
          selectedApprovalId = item.id;
          $$('.approval-item').forEach(i => i.classList.remove('selected'));
          itemEl.classList.add('selected');
          loadApprovalForEdit(item.id);
        });
        
        list.appendChild(itemEl);
      });
    }
    
    section.appendChild(list);
    containerEl.appendChild(section);
  }
  
  renderSection('Copy Pending', copyPending, container, 'copyPending', EMPTY_APPROVALS.copyPending);
  renderSection('Copy Changes', copyChanges, container, 'copyChanges', EMPTY_APPROVALS.copyChanges);
  renderSection('Copy Approved', copyApproved, container, 'copyApproved', EMPTY_APPROVALS.copyApproved);
  renderSection('Content Pending', pending, container, 'pending', EMPTY_APPROVALS.awaiting);
  renderSection('Changes Requested', changes, container, 'changes', EMPTY_APPROVALS.changes);
  renderSection('Approved', approved, container, 'approved', EMPTY_APPROVALS.approved);
  renderSection('Scheduled', scheduled, container, 'scheduled', EMPTY_APPROVALS.scheduled);

  if (approved.length > 0 && currentClientId) {
    getMetaStatusForClient(currentClientId).then(function(connected) {
      container.querySelectorAll('.schedule-section-connected').forEach(function(el) { el.style.display = connected ? 'block' : 'none'; });
      container.querySelectorAll('.schedule-section-not-connected').forEach(function(el) { el.style.display = connected ? 'none' : 'block'; });
    });
  }
  // Inject production badges on ALL approval cards (not just when approved section has items)
  if (currentClientId) {
    injectProductionBadgesOnApprovals(container);
  }

  if (approvalsList.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__text' }, 'No approvals yet. Create one using the form on the right.')
    ));
  }

  // Activity feed preview in Approvals tab
  const activityListEl = $('#approvalsActivityList');
  if (activityListEl) {
    const activity = (state.activity || []).slice(-10).reverse();
    if (activity.length === 0) {
      activityListEl.innerHTML = '<div class="activity-log-item activity-log-item--empty">Activity will appear here once you start creating approvals or receiving client feedback.</div>';
      activityListEl.className = 'activity-log-list';
    } else {
      activityListEl.innerHTML = activity.map(entry =>
        `<div class="activity-log-item"><span class="activity-log-item__icon" aria-hidden="true">•</span><span>${entry.text || 'Activity'}</span><span class="activity-log-item__time">${fmtDate(entry.when)}</span></div>`
      ).join('');
      activityListEl.className = 'activity-log-list';
    }
  }

  // Pipeline stage click: filter list to stage and scroll; highlight active; show "Show All"
  applyApprovalsFilter(window.approvalsStageFilter || null);
  const pipeline = document.getElementById('approvalPipeline');
  if (pipeline && !pipeline._bound) {
    pipeline._bound = true;
    pipeline.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-pipeline-filter]');
      if (!btn) return;
      const filter = btn.getAttribute('data-pipeline-filter');
      const sectionKey = filter === 'awaiting' ? 'pending' : filter;
      window.approvalsStageFilter = sectionKey;
      applyApprovalsFilter(sectionKey);
      const section = container.querySelector(`[data-pipeline-section="${sectionKey}"]`);
      if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }
  const showAllBtn = $('#approvalsShowAllBtn');
  const showAllWrap = $('#approvalsShowAllWrap');
  if (showAllBtn && showAllWrap) {
    showAllBtn.onclick = () => {
      window.approvalsStageFilter = null;
      applyApprovalsFilter(null);
    };
  }
}

function applyApprovalsFilter(filterKey) {
  const container = $('#approvalsList');
  const showAllWrap = $('#approvalsShowAllWrap');
  if (!container) return;
  const sections = container.querySelectorAll('[data-pipeline-section]');
  const pipelineButtons = document.querySelectorAll('#approvalPipeline [data-pipeline-filter]');
  const globalEmpty = container.querySelector('.empty-state');
  pipelineButtons.forEach(btn => {
    const key = btn.getAttribute('data-pipeline-filter');
    const sectionKey = key === 'awaiting' ? 'pending' : key;
    if (filterKey === null) {
      btn.classList.remove('active');
    } else {
      if (sectionKey === filterKey) btn.classList.add('active');
      else btn.classList.remove('active');
    }
  });
  sections.forEach(section => {
    const key = section.getAttribute('data-pipeline-section');
    if (filterKey === null) {
      section.style.display = '';
    } else {
      section.style.display = key === filterKey ? '' : 'none';
    }
  });
  if (globalEmpty) globalEmpty.style.display = filterKey ? 'none' : '';
  if (showAllWrap) showAllWrap.style.display = filterKey ? 'block' : 'none';
}

// Auto-set due date to 2 days from today
function setAutoDueDate() {
  const dueDateInput = $('#approvalDate');
  if (!dueDateInput) return;
  
  // Only auto-set if the field is empty (new approval)
  if (!dueDateInput.value) {
    const today = new Date();
    const twoDaysLater = new Date(today);
    twoDaysLater.setDate(today.getDate() + 2);
    
    // Format as YYYY-MM-DD for date input
    const year = twoDaysLater.getFullYear();
    const month = String(twoDaysLater.getMonth() + 1).padStart(2, '0');
    const day = String(twoDaysLater.getDate()).padStart(2, '0');
    dueDateInput.value = `${year}-${month}-${day}`;
  }
}

function loadApprovalForEdit(id) {
  const state = load();
  const item = (state.approvals || []).find(a => a.id === id);
  
  if (!item) {
    // Reset form for new item
    $('#approvalForm').reset();
    $('#approvalId').value = '';
    $('#editPanelTitle').textContent = 'Create Approval';
    $('#approvalDelete').style.display = 'none';
    selectedApprovalId = null;
    var noteEl = document.getElementById('approvalFormProductionNote');
    if (noteEl) noteEl.style.display = 'none';
    setAutoDueDate();
    updateSchedulePostSectionVisibility();
    return;
  }
  
  $('#approvalId').value = item.id;
  $('#approvalTitle').value = item.title || '';
  $('#approvalType').value = item.type || 'Post';
  $('#approvalDate').value = item.date || '';
  $('#approvalPostDate').value = item.postDate || '';
  $('#approvalCopyText').value = item.copyText || '';
  $('#approvalCaption').value = item.caption || '';
  $('#approvalStatus').value = item.status || 'pending';
  
  // Load image URLs: prefer finalArtUrls (from production), then imageUrls, then imageUrl
  var urls = [];
  if (Array.isArray(item.finalArtUrls) && item.finalArtUrls.length > 0) {
    urls = item.finalArtUrls.filter(function (u) { return u && String(u).trim(); });
  } else if (Array.isArray(item.imageUrls) && item.imageUrls.length > 0) {
    urls = item.imageUrls.filter(function (u) { return u && String(u).trim(); });
  } else if (item.imageUrl) {
    urls = [item.imageUrl];
  }
  renderApprovalImageUrlRows(urls);
  var firstInput = document.querySelector('.approval-image-url-input');
  if (firstInput) firstInput.dispatchEvent(new Event('input'));
  
  // Load uploaded images if they exist
  if (item.uploadedImages && item.uploadedImages.length > 0) {
    uploadedImages = item.uploadedImages;
    displayUploadedImages();
  } else {
    uploadedImages = [];
    displayUploadedImages();
  }
  
  $('#editPanelTitle').textContent = 'Edit Approval';
  $('#approvalDelete').style.display = 'block';

  postSelectedAssetIds = Array.isArray(item.assetIds) ? item.assetIds.slice() : [];
  renderApprovedVisualsSection();
  updatePostFormFromAssets();

  updateSchedulePostSectionVisibility();
  updateScheduleCaptionCount();

  var formNote = document.getElementById('approvalFormProductionNote');
  if (formNote) {
    if (item.productionStatus === 'art_approved') {
      formNote.textContent = 'Final art from production is attached. Change status to Content Pending to send to client.';
      formNote.style.display = 'block';
    } else {
      formNote.style.display = 'none';
    }
  }
}

function updateSchedulePostSectionVisibility() {
  const section = $('#schedulePostSection');
  const statusVal = $('#approvalStatus') ? $('#approvalStatus').value : '';
  const isApproved = statusVal === 'approved' && selectedApprovalId && currentClientId;
  if (section) section.style.display = isApproved ? 'block' : 'none';
  if (isApproved) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateInput = $('#schedulePostDate');
    const timeInput = $('#schedulePostTime');
    if (dateInput && !dateInput.value) dateInput.value = tomorrow.toISOString().slice(0, 10);
    if (timeInput && !timeInput.value) timeInput.value = '10:00';
  }
}

function updateScheduleCaptionCount() {
  const el = $('#scheduleCaptionCount');
  const caption = $('#approvalCaption') ? $('#approvalCaption').value : '';
  const len = caption.length;
  if (el) {
    el.textContent = 'Caption: ' + len + ' / 2,200 characters' + (len > 2200 ? ' (Instagram limit exceeded)' : '');
    el.style.color = len > 2200 ? '#dc2626' : '#64748b';
  }
}

/** Render Approved Visuals section: load approved assets, filters, grid + selected list. */
function renderApprovedVisualsSection() {
  const grid = $('#postApprovedVisualsGrid');
  const selectedWrap = $('#postSelectedVisualsWrap');
  const selectedList = $('#postSelectedVisualsList');
  const filterFormat = $('#postAssetFilterFormat');
  const filterPillar = $('#postAssetFilterPillar');
  if (!grid) return;

  if (!currentClientId) {
    grid.innerHTML = '<div class="empty-state__text" style="font-size: 12px; color: #94a3b8;">Select a client to see visuals.</div>';
    if (selectedWrap) selectedWrap.style.display = 'none';
    return;
  }

  let assets = loadAssets(currentClientId);
  const formatVal = filterFormat ? filterFormat.value : 'ANY';
  const pillarVal = filterPillar ? filterPillar.value : '';
  if (formatVal && formatVal !== 'ANY') assets = assets.filter(a => (a.formatUse || 'ANY') === formatVal);
  if (pillarVal) assets = assets.filter(a => (a.pillars || []).includes(pillarVal));

  const allPillars = [...new Set(loadAssets(currentClientId).flatMap(a => a.pillars || []))].sort();
  if (filterPillar) {
    const cur = filterPillar.value;
    filterPillar.innerHTML = '<option value="">All pillars</option>' + allPillars.map(p => '<option value="' + p + '">' + p + '</option>').join('');
    if (allPillars.includes(cur)) filterPillar.value = cur;
  }

  grid.innerHTML = '';
  assets.forEach(asset => {
    const card = el('div', { class: 'post-approved-visual-card' + (postSelectedAssetIds.includes(asset.id) ? ' selected' : ''), 'data-asset-id': asset.id });
    const thumb = el('div', { class: 'post-approved-visual-card__thumb' });
    const previewUrl = asset.thumbnailUrl || getPreviewUrl(asset);
    if (previewUrl) {
      const img = el('img', { src: previewUrl, alt: asset.title || '' });
      img.onerror = function () { img.style.display = 'none'; };
      thumb.appendChild(img);
    } else {
      thumb.textContent = { PHOTO: '🖼', VIDEO: '▶', GRAPHIC: '◇', DOC: '📄' }[asset.mediaType] || '🖼';
    }
    const title = el('div', { class: 'post-approved-visual-card__title' });
    title.textContent = (asset.title || 'Untitled').slice(0, 20) + ((asset.title || '').length > 20 ? '…' : '');
    card.appendChild(thumb);
    card.appendChild(title);
    card.addEventListener('click', () => {
      const idx = postSelectedAssetIds.indexOf(asset.id);
      if (idx >= 0) {
        postSelectedAssetIds.splice(idx, 1);
      } else {
        postSelectedAssetIds.push(asset.id);
      }
      renderApprovedVisualsSection();
      updatePostFormFromAssets();
    });
    grid.appendChild(card);
  });

  var approvedVisualCue = document.getElementById('postApprovedVisualCue');
  if (approvedVisualCue) approvedVisualCue.style.display = postSelectedAssetIds.length > 0 ? 'inline-flex' : 'none';

  if (postSelectedAssetIds.length > 0 && selectedWrap && selectedList) {
    selectedWrap.style.display = 'block';
    selectedList.innerHTML = '';
    const allAssets = loadAssets(currentClientId);
    postSelectedAssetIds.forEach(id => {
      const asset = allAssets.find(a => a.id === id);
      if (!asset) return;
      const previewUrl = asset.thumbnailUrl || getPreviewUrl(asset) || asset.url;
      const item = el('div', { class: 'post-selected-item' });
      if (previewUrl && (previewUrl.startsWith('data:') || previewUrl.startsWith('http'))) {
        const img = el('img', { src: previewUrl, alt: asset.title || '' });
        item.appendChild(img);
      }
      const label = document.createElement('span');
      label.textContent = asset.title || 'Untitled';
      item.appendChild(label);
      const remove = el('button', { type: 'button', class: 'btn btn--sm btn-secondary', style: 'margin-left: 4px; padding: 2px 6px; font-size: 11px;' }, '×');
      remove.addEventListener('click', (e) => { e.stopPropagation(); postSelectedAssetIds = postSelectedAssetIds.filter(i => i !== id); renderApprovedVisualsSection(); updatePostFormFromAssets(); });
      item.appendChild(remove);
      selectedList.appendChild(item);
    });
  } else if (selectedWrap) selectedWrap.style.display = 'none';
}

/** Sync Image URL and disabled state from postSelectedAssetIds. When assets are selected, set first URL input and disable all URL inputs; when none, only re-enable (do not clear existing URL values). */
function updatePostFormFromAssets() {
  const inputs = document.querySelectorAll('.approval-image-url-input');
  if (!inputs.length) return;
  if (postSelectedAssetIds.length > 0) {
    const assets = loadAssets(currentClientId);
    const first = assets.find(a => a.id === postSelectedAssetIds[0]);
    if (first && inputs[0]) inputs[0].value = first.url || '';
    inputs.forEach(function (inp) { inp.disabled = true; });
  } else {
    inputs.forEach(function (inp) { inp.disabled = false; });
  }
}

function setupSchedulePostHandlers() {
  const statusSelect = $('#approvalStatus');
  const captionInput = $('#approvalCaption');
  if (statusSelect) statusSelect.addEventListener('change', updateSchedulePostSectionVisibility);
  if (captionInput) captionInput.addEventListener('input', updateScheduleCaptionCount);

  const scheduleBtn = $('#schedulePostBtn');
  const postNowBtn = $('#postNowBtn');
  if (scheduleBtn) scheduleBtn.addEventListener('click', schedulePostToMeta);
  if (postNowBtn) postNowBtn.addEventListener('click', postNowToMeta);
}

async function getMediaUrlForApproval() {
  const state = load();
  const item = (state.approvals || []).find(a => a.id === selectedApprovalId);
  if (!item || !currentClientId) return null;
  const urls = getApprovalImageUrls();
  if (urls.length > 0 && urls[0].startsWith('http')) return urls[0];
  if (postSelectedAssetIds.length > 0) {
    const assets = loadAssets(currentClientId);
    const first = assets.find(a => a.id === postSelectedAssetIds[0]);
    if (first) return first.thumbnailUrl || getPreviewUrl(first) || first.url || null;
  }
  const uploadBase64 = function(base64) {
    return fetch(`${getApiBaseUrl()}/api/upload/image`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64 })
    }).then(function(r) { return r.json(); }).then(function(j) { return j && j.url ? j.url : null; });
  };
  if (uploadedImages && uploadedImages.length > 0 && (uploadedImages[0].dataUrl || uploadedImages[0].data)) {
    const base64 = uploadedImages[0].dataUrl || uploadedImages[0].data;
    if (base64 && String(base64).startsWith('data:image/')) {
      const url = await uploadBase64(base64);
      if (url) return url;
    }
  }
  if (item.uploadedImages && item.uploadedImages.length > 0 && (item.uploadedImages[0].dataUrl || item.uploadedImages[0].data)) {
    const base64 = item.uploadedImages[0].dataUrl || item.uploadedImages[0].data;
    if (base64 && String(base64).startsWith('data:image/')) {
      const url = await uploadBase64(base64);
      if (url) return url;
    }
  }
  return urls[0] || null;
}

async function getMediaUrlForApprovalId(approvalId) {
  const state = load();
  const item = (state.approvals || []).find(a => a.id === approvalId);
  if (!currentClientId) return null;
  const uploadBase64 = async function(base64) {
    try {
      const r = await fetch(getApiBaseUrl() + '/api/upload/image', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64 })
      });
      const j = await r.json();
      return (j && j.url) ? j.url : null;
    } catch (e) { return null; }
  };
  const urls = item ? (Array.isArray(item.imageUrls) && item.imageUrls.length > 0
    ? item.imageUrls.filter(u => u && String(u).trim())
    : (item.imageUrl ? [item.imageUrl] : [])) : [];
  if (urls.length > 0 && urls[0].startsWith('http')) return urls[0];
  // Check global uploadedImages from file input first
  if (typeof uploadedImages !== 'undefined' && uploadedImages.length > 0) {
    const base64 = uploadedImages[0].dataUrl || uploadedImages[0].data;
    if (base64 && String(base64).startsWith('data:image/')) {
      const url = await uploadBase64(base64);
      if (url) return url;
    }
  }
  // Check saved approval images
  if (item && item.uploadedImages && item.uploadedImages.length > 0) {
    const base64 = item.uploadedImages[0].dataUrl || item.uploadedImages[0].data;
    if (base64 && String(base64).startsWith('data:image/')) {
      const url = await uploadBase64(base64);
      if (url) return url;
    }
  }
  // If urls has a base64, upload it too
  if (urls.length > 0 && urls[0].startsWith('data:image/')) {
    const url = await uploadBase64(urls[0]);
    if (url) return url;
  }
  return urls[0] || null;
}

async function scheduleFromApproval(approvalId) {
  const card = document.querySelector(`[data-approval-id="${approvalId}"]`);
  if (!card) return;
  const datetimeInput = card.querySelector('.schedule-datetime');
  if (!datetimeInput || !datetimeInput.value) {
    showToast('Please select a date and time', 'error');
    return;
  }
  const platforms = [];
  if (card.querySelector('[data-platform="instagram"]') && card.querySelector('[data-platform="instagram"]').checked) platforms.push('instagram');
  if (card.querySelector('[data-platform="facebook"]') && card.querySelector('[data-platform="facebook"]').checked) platforms.push('facebook');
  if (platforms.length === 0) {
    showToast('Select at least one platform', 'error');
    return;
  }
  const mediaUrl = await getMediaUrlForApprovalId(approvalId);
  if (platforms.includes('instagram') && !mediaUrl) {
    showToast('Instagram requires an image. Add an image in the approval or post to Facebook only.', 'error');
    return;
  }
  const state = load();
  const item = (state.approvals || []).find(a => a.id === approvalId);
  const caption = (item && (item.caption || item.title)) || '';
  const scheduledAt = new Date(datetimeInput.value).toISOString();
  try {
    const r = await fetch(`${getApiBaseUrl()}/api/posts/schedule`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: currentClientId,
        contentId: approvalId,
        caption,
        mediaUrl: mediaUrl || '',
        platforms,
        scheduledAt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
      })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to schedule');
    if (item) {
      item.status = 'scheduled';
      save(state);
    }
    renderApprovalsTab();
    renderScheduledPostsTab();
    createNotification({ type: 'PROGRESS', title: 'Post scheduled', message: 'Post scheduled to publish at ' + new Date(scheduledAt).toLocaleString(), clientId: currentClientId, action: { label: 'View scheduled', href: '#scheduled' } });
  } catch (e) {
    showToast(e.message || 'Failed to schedule', 'error');
  }
}

async function postNowFromApproval(approvalId) {
  const card = document.querySelector(`[data-approval-id="${approvalId}"]`);
  if (!card) return;
  const platforms = [];
  if (card.querySelector('[data-platform="instagram"]') && card.querySelector('[data-platform="instagram"]').checked) platforms.push('instagram');
  if (card.querySelector('[data-platform="facebook"]') && card.querySelector('[data-platform="facebook"]').checked) platforms.push('facebook');
  if (platforms.length === 0) {
    showToast('Select at least one platform', 'error');
    return;
  }
  if (!confirm('Post now to ' + platforms.join(' & ') + '?')) return;
  const mediaUrl = await getMediaUrlForApprovalId(approvalId);
  if (platforms.includes('instagram') && !mediaUrl) {
    showToast('Instagram requires an image. Add an image in the approval or post to Facebook only.', 'error');
    return;
  }
  const state = load();
  const item = (state.approvals || []).find(a => a.id === approvalId);
  const caption = (item && (item.caption || item.title)) || '';
  try {
    const r = await fetch(`${getApiBaseUrl()}/api/posts/schedule`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: currentClientId,
        contentId: approvalId,
        caption,
        mediaUrl: mediaUrl || '',
        platforms,
        scheduledAt: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
      })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to schedule');
    const postId = j.post && j.post.id;
    if (!postId) throw new Error('No post ID returned');
    const pubRes = await fetch(`${getApiBaseUrl()}/api/posts/${postId}/publish-now`, { method: 'POST', credentials: 'include' });
    const pubJ = await pubRes.json();
    if (!pubRes.ok) throw new Error(pubJ.error || 'Publish failed');
    if (item) {
      item.status = 'scheduled';
      save(state);
    }
    renderApprovalsTab();
    renderScheduledPostsTab();
    createNotification({ type: 'REWARD', title: 'Post published', message: 'Post published to ' + platforms.join(' & '), clientId: currentClientId, action: { label: 'View', href: '#scheduled' } });
  } catch (e) {
    showToast(e.message || 'Failed to publish', 'error');
  }
}

async function schedulePostToMeta() {
  const statusEl = $('#schedulePostStatus');
  if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Scheduling...'; statusEl.style.color = '#64748b'; }
  try {
    const platforms = [];
    if ($('#schedulePlatformIg') && $('#schedulePlatformIg').checked) platforms.push('instagram');
    if ($('#schedulePlatformFb') && $('#schedulePlatformFb').checked) platforms.push('facebook');
    if (platforms.length === 0) throw new Error('Select at least one platform');
    const mediaUrl = await getMediaUrlForApproval();
    if (platforms.includes('instagram') && !mediaUrl) throw new Error('Instagram requires an image. Add an image or post to Facebook only.');
    const caption = ($('#approvalCaption') && $('#approvalCaption').value) || ($('#approvalTitle') && $('#approvalTitle').value) || '';
    const dateVal = $('#schedulePostDate') ? $('#schedulePostDate').value : '';
    const timeVal = $('#schedulePostTime') ? $('#schedulePostTime').value : '10:00';
    const scheduledAt = dateVal && timeVal ? new Date(dateVal + 'T' + timeVal).toISOString() : new Date(Date.now() + 3600000).toISOString();
    const r = await fetch(`${getApiBaseUrl()}/api/posts/schedule`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: currentClientId,
        contentId: selectedApprovalId,
        caption,
        mediaUrl: mediaUrl || '',
        platforms,
        scheduledAt,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
      })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to schedule');
    const state = load();
    const approval = (state.approvals || []).find(a => a.id === selectedApprovalId);
    if (approval) {
      approval.status = 'scheduled';
      save(state);
    }
    if (statusEl) { statusEl.textContent = 'Scheduled for ' + new Date(scheduledAt).toLocaleString(); statusEl.style.color = '#059669'; }
    renderScheduledPostsTab();
    renderApprovalsTab();
    createNotification({ type: 'PROGRESS', title: 'Post scheduled', message: 'Post scheduled to publish at ' + new Date(scheduledAt).toLocaleString(), clientId: currentClientId, action: { label: 'View scheduled', href: '#scheduled' } });
  } catch (e) {
    if (statusEl) { statusEl.textContent = e.message || 'Failed'; statusEl.style.color = '#dc2626'; }
  }
}

async function postNowToMeta() {
  const statusEl = $('#schedulePostStatus');
  if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = 'Publishing...'; statusEl.style.color = '#64748b'; }
  try {
    const platforms = [];
    if ($('#schedulePlatformIg') && $('#schedulePlatformIg').checked) platforms.push('instagram');
    if ($('#schedulePlatformFb') && $('#schedulePlatformFb').checked) platforms.push('facebook');
    if (platforms.length === 0) throw new Error('Select at least one platform');
    const mediaUrl = await getMediaUrlForApproval();
    if (platforms.includes('instagram') && !mediaUrl) throw new Error('Instagram requires an image. Add an image or post to Facebook only.');
    const caption = ($('#approvalCaption') && $('#approvalCaption').value) || ($('#approvalTitle') && $('#approvalTitle').value) || '';
    const r = await fetch(`${getApiBaseUrl()}/api/posts/schedule`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: currentClientId,
        contentId: selectedApprovalId,
        caption,
        mediaUrl: mediaUrl || '',
        platforms,
        scheduledAt: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
      })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Failed to schedule');
    const postId = j.post && j.post.id;
    if (!postId) throw new Error('No post ID returned');
    const pubRes = await fetch(`${getApiBaseUrl()}/api/posts/${postId}/publish-now`, { method: 'POST', credentials: 'include' });
    const pubJ = await pubRes.json();
    if (!pubRes.ok) throw new Error(pubJ.error || 'Publish failed');
    const state = load();
    const approval = (state.approvals || []).find(a => a.id === selectedApprovalId);
    if (approval) {
      approval.status = 'scheduled';
      save(state);
    }
    if (statusEl) { statusEl.textContent = 'Published to ' + (platforms.includes('instagram') ? 'Instagram' : '') + (platforms.includes('facebook') ? (platforms.includes('instagram') ? ' & Facebook' : 'Facebook') : ''); statusEl.style.color = '#059669'; }
    renderScheduledPostsTab();
    renderApprovalsTab();
    createNotification({ type: 'REWARD', title: 'Post published', message: 'Post published to ' + platforms.join(' & '), clientId: currentClientId, action: { label: 'View', href: '#scheduled' } });
  } catch (e) {
    if (statusEl) { statusEl.textContent = e.message || 'Failed'; statusEl.style.color = '#dc2626'; }
  }
}

// Setup approval form handler - will be called after DOM loads
function setupApprovalHandlers() {
  setupSchedulePostHandlers();
  const createNewPostBtn = $('#approvalsCreateNewPostBtn');
  if (createNewPostBtn) {
    createNewPostBtn.addEventListener('click', () => {
      switchTab('approvals');
      const form = $('#approvalForm');
      const editPanel = document.querySelector('#tabApprovals .edit-panel');
      if (form) {
        form.reset();
        $('#approvalId').value = '';
        const titleEl = $('#editPanelTitle');
        if (titleEl) titleEl.textContent = 'Create Approval';
        const delBtn = $('#approvalDelete');
        if (delBtn) delBtn.style.display = 'none';
        selectedApprovalId = null;
        uploadedImages = [];
        postSelectedAssetIds = [];
        displayUploadedImages();
        setAutoDueDate();
        renderApprovalImageUrlRows(['']);
        renderApprovedVisualsSection();
        updatePostFormFromAssets();
        const warn = $('#postUploadApprovalWarning');
        if (warn) warn.style.display = 'none';
      }
      if (editPanel) editPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  const approvalForm = $('#approvalForm');
  if (approvalForm) {
    approvalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const state = load();
    const id = $('#approvalId').value;
    
    const postDateValue = $('#approvalPostDate').value.trim();
    var imageUrlsCollected = getApprovalImageUrls();
    var imageUrl = imageUrlsCollected.length > 0 ? imageUrlsCollected[0] : '';
    
    var previewImageUrl = undefined;
    var previewImageUrls = [];
    if (postSelectedAssetIds.length > 0 && currentClientId) {
      var assets = loadAssets(currentClientId);
      var firstAsset = assets.find(function(a) { return a.id === postSelectedAssetIds[0]; });
      if (firstAsset) previewImageUrl = firstAsset.thumbnailUrl || getPreviewUrl(firstAsset) || firstAsset.url || undefined;
    }
    if (!previewImageUrl && imageUrlsCollected.length > 0) {
      previewImageUrls = imageUrlsCollected.map(function(u) { return toDisplayableImageUrl(u); });
      previewImageUrl = previewImageUrls[0];
    }
    const approvalData = {
      id: id || `ap${Date.now()}`,
      title: $('#approvalTitle').value.trim(),
      type: $('#approvalType').value,
      date: $('#approvalDate').value,
      postDate: postDateValue || null,
      copyText: $('#approvalCopyText').value.trim() || undefined,
      caption: $('#approvalCaption').value.trim() || undefined,
      imageUrl: imageUrl || undefined,
      imageUrls: imageUrlsCollected.length > 0 ? imageUrlsCollected : undefined,
      previewImageUrl: previewImageUrl,
      previewImageUrls: previewImageUrls.length > 0 ? previewImageUrls : undefined,
      uploadedImages: uploadedImages.length > 0 ? uploadedImages : undefined,
      assetIds: postSelectedAssetIds.length > 0 ? postSelectedAssetIds.slice() : undefined,
      status: $('#approvalStatus').value,
      tags: []
    };
    
    if (!state.approvals) state.approvals = [];
    
    const existingIndex = state.approvals.findIndex(a => a.id === approvalData.id);
    if (existingIndex >= 0) {
      // Update existing - preserve change_notes if they exist
      const existing = state.approvals[existingIndex];
      approvalData.change_notes = existing.change_notes;
      state.approvals[existingIndex] = approvalData;
    } else {
      // Create new
      state.approvals.push(approvalData);
    }
    
    // Update KPIs
    const pendingCount = state.approvals.filter(a => !a.status || a.status === 'pending').length;
    const scheduledCount = calculateScheduledPosts(state.approvals);
    if (state.kpis) {
      state.kpis.waitingApproval = pendingCount;
      state.kpis.scheduled = scheduledCount;
    }
    
    // Log activity
    if (!state.activity) state.activity = [];
    state.activity.push({
      when: Date.now(),
      text: existingIndex >= 0 ? `Updated approval: ${approvalData.title}` : `Created approval: ${approvalData.title}`
    });
    
    save(state);
    if (showPipelineModal()) {
      // First time sending for approval: pipeline modal shown
    }
    var clientName = (loadClientsRegistry() && loadClientsRegistry()[currentClientId] && loadClientsRegistry()[currentClientId].name) || 'Client';
    if (approvalData.status === 'approved') createNotification({ type: 'ACTION', title: 'Post approved', message: approvalData.title + ' is approved.', clientId: currentClientId, action: { label: 'View approvals', href: '#approvals' } });
    if (approvalData.postDate) createNotification({ type: 'PROGRESS', title: 'Post scheduled', message: approvalData.title + ' is on the calendar.', clientId: currentClientId, action: { label: 'Approvals', href: '#approvals' } });
    // Push notifications to client
    if (currentClientId) {
      if (approvalData.status === 'pending') {
        // Content sent for client approval
        fetch(getApiBaseUrl() + '/api/notifications/notify-client', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ clientId: currentClientId, type: 'content_ready', postTitle: approvalData.title || approvalData.caption || 'New content' })
        }).catch(function() {});
      }
      if (approvalData.status === 'copy_pending') {
        // Copy sent for client review
        fetch(getApiBaseUrl() + '/api/notifications/notify-client', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ clientId: currentClientId, type: 'copy_ready', postTitle: approvalData.title || approvalData.copyText || 'New copy' })
        }).catch(function() {});
      }
    }
    var approvalsForClient = (state.approvals || []).filter(function(a) { return a.clientId === currentClientId; });
    var pendingForClient = approvalsForClient.filter(function(a) { return !a.status || a.status === 'pending' || a.status === 'copy_pending'; });
    if (approvalsForClient.length > 0 && pendingForClient.length === 0) createNotification({ type: 'REWARD', title: 'All clear for ' + clientName, message: 'No pending approvals for this client.', clientId: currentClientId, action: { label: 'Overview', href: '#overview' } });
    runNotificationTriggers();
    renderApprovalsTab();
    renderOverviewTab();

    // Reset form
    approvalForm.reset();
    $('#approvalId').value = '';
    $('#editPanelTitle').textContent = 'Create Approval';
    $('#approvalDelete').style.display = 'none';
    selectedApprovalId = null;
    uploadedImages = [];
    postSelectedAssetIds = [];
    renderApprovalImageUrlRows(['']);
    displayUploadedImages();
    renderApprovedVisualsSection();
    updatePostFormFromAssets();
    setAutoDueDate();
    const warn = $('#postUploadApprovalWarning');
    if (warn) warn.style.display = 'none';
    var ipw = $('#imageUrlPreviewWrap'); if (ipw) ipw.style.display = 'none';
  });
  }

  const approvalCancel = $('#approvalCancel');
  if (approvalCancel) {
    approvalCancel.addEventListener('click', () => {
    approvalForm.reset();
    $('#approvalId').value = '';
    $('#editPanelTitle').textContent = 'Create Approval';
    $('#approvalDelete').style.display = 'none';
    selectedApprovalId = null;
    uploadedImages = [];
    postSelectedAssetIds = [];
    displayUploadedImages();
    renderApprovedVisualsSection();
    updatePostFormFromAssets();
    $$('.approval-item').forEach(i => i.classList.remove('selected'));
    setAutoDueDate();
    if ($('#postUploadApprovalWarning')) $('#postUploadApprovalWarning').style.display = 'none';
    var ipw = $('#imageUrlPreviewWrap'); if (ipw) ipw.style.display = 'none';
    });
  }

  const postAssetFilterFormat = $('#postAssetFilterFormat');
  const postAssetFilterPillar = $('#postAssetFilterPillar');
  [postAssetFilterFormat, postAssetFilterPillar].forEach(el => {
    if (el) el.addEventListener('change', () => renderApprovedVisualsSection());
  });
  
  // Auto-set due date to 2 days from today
  setAutoDueDate();
  
  // Setup image upload handlers
  setupImageUpload();
  setupImageUrlPreview();

  // Preview button handler
  const approvalPreview = $('#approvalPreview');
  if (approvalPreview) {
    approvalPreview.addEventListener('click', () => {
      openPreviewModal();
    });
  }

// Preview Modal functions
function openPreviewModal() {
  const title = $('#approvalTitle').value.trim() || 'Untitled';
  const copyText = $('#approvalCopyText').value.trim();
  const caption = $('#approvalCaption').value.trim() || 'No caption provided.';
  var imageUrlsFromForm = getApprovalImageUrls();

  // Resolve preview: prefer uploadedImages, then asset thumbnails, then image URL(s) from form
  var displayUrls = [];
  if (uploadedImages && uploadedImages.length > 0) {
    displayUrls = uploadedImages.map(function (img) { return img.dataUrl; });
  } else if (postSelectedAssetIds && postSelectedAssetIds.length > 0 && currentClientId) {
    var assets = loadAssets(currentClientId);
    postSelectedAssetIds.forEach(function (id) {
      var a = assets.find(function (x) { return x.id === id; });
      if (a) displayUrls.push(a.thumbnailUrl || getPreviewUrl(a) || a.url || '');
    });
    displayUrls = displayUrls.filter(Boolean);
  }
  if (displayUrls.length === 0 && imageUrlsFromForm.length > 0) {
    displayUrls = imageUrlsFromForm.map(function (u) { return toDisplayableImageUrl(u); });
  }

  var previewTitle = $('#previewModalTitle');
  if (previewTitle) previewTitle.textContent = title;

  var previewImageContainer = $('#previewImageContainer');
  if (previewImageContainer) {
    var contentHTML = '';
    if (displayUrls.length > 0) {
      if (displayUrls.length === 1) {
        contentHTML = '<img id="previewModalImg" src="' + displayUrls[0] + '" alt="' + (title || 'Preview') + '" style="max-width: 100%; max-height: 400px; border-radius: 8px; object-fit: contain; border: 1px solid #e2e8f0;">';
      } else {
        var slidePct = (100 / displayUrls.length).toFixed(4);
        contentHTML = '<div class="preview-carousel" style="position:relative;max-width:100%;overflow:hidden;">';
        contentHTML += '<div class="preview-carousel__track" style="display:flex;flex-wrap:nowrap;overflow:hidden;border-radius:8px;border:1px solid #e2e8f0;width:' + (displayUrls.length * 100) + '%;">';
        displayUrls.forEach(function (url, i) {
          contentHTML += '<div class="preview-carousel__slide" data-index="' + i + '" style="flex:0 0 ' + slidePct + '%;min-width:0;display:flex;align-items:center;justify-content:center;background:#f1f5f9;">';
          contentHTML += '<img src="' + url + '" alt="Slide ' + (i + 1) + '" style="max-width:100%;max-height:400px;object-fit:contain;">';
          contentHTML += '</div>';
        });
        contentHTML += '</div>';
        contentHTML += '<div class="preview-carousel__nav" style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:12px;">';
        contentHTML += '<button type="button" class="btn btn-secondary btn--sm preview-carousel-prev" aria-label="Previous">‹</button>';
        contentHTML += '<span class="preview-carousel-dots"></span>';
        contentHTML += '<button type="button" class="btn btn-secondary btn--sm preview-carousel-next" aria-label="Next">›</button>';
        contentHTML += '</div></div>';
      }
    } else if (copyText) {
      contentHTML = '<div style="padding: 24px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;"><div style="font-size: 14px; font-weight: 600; color: #1e40af; margin-bottom: 8px;">Copy Text:</div><div style="color: #0f172a; line-height: 1.6; white-space: pre-wrap;">' + copyText + '</div></div>';
    } else {
      contentHTML = '<div style="padding: 40px; text-align: center; color: #94a3b8;">No content provided</div>';
    }
    previewImageContainer.innerHTML = contentHTML;

    if (displayUrls.length === 1) {
      var previewImg = document.getElementById('previewModalImg');
      var firstUrl = imageUrlsFromForm[0];
      if (previewImg && firstUrl) {
        var fallbacks = getDriveFallbackUrls(firstUrl);
        if (fallbacks) {
          var fbIdx = 1;
          previewImg.onerror = function () {
            if (fbIdx < fallbacks.length) {
              previewImg.src = fallbacks[fbIdx++];
            } else {
              previewImg.style.display = 'none';
              if (previewImg.parentElement) previewImg.parentElement.innerHTML = '<div style="padding: 40px; text-align: center; color: #94a3b8;">Image could not be loaded</div>';
            }
          };
        } else {
          previewImg.onerror = function () {
            this.style.display = 'none';
            if (this.parentElement) this.parentElement.innerHTML = '<div style="padding: 40px; text-align: center; color: #94a3b8;">Image could not be loaded</div>';
          };
        }
      }
    } else if (displayUrls.length > 1) {
      var track = previewImageContainer.querySelector('.preview-carousel__track');
      var slides = previewImageContainer.querySelectorAll('.preview-carousel__slide');
      var dotsEl = previewImageContainer.querySelector('.preview-carousel-dots');
      var prevBtn = previewImageContainer.querySelector('.preview-carousel-prev');
      var nextBtn = previewImageContainer.querySelector('.preview-carousel-next');
      var curIdx = 0;
      function updateCarousel() {
        if (track && slides.length) {
          track.style.transform = 'translateX(-' + (curIdx * 100 / slides.length) + '%)';
          if (dotsEl) {
            dotsEl.innerHTML = '';
            for (var d = 0; d < slides.length; d++) {
              var dot = document.createElement('button');
              dot.type = 'button';
              dot.className = 'preview-carousel-dot' + (d === curIdx ? ' active' : '');
              dot.style.cssText = 'width:8px;height:8px;border-radius:50%;border:none;background:' + (d === curIdx ? '#0052CC' : '#cbd5e1') + ';cursor:pointer;';
              dot.setAttribute('aria-label', 'Slide ' + (d + 1));
              (function (idx) {
                dot.addEventListener('click', function () { curIdx = idx; updateCarousel(); });
              })(d);
              dotsEl.appendChild(dot);
            }
          }
        }
      }
      if (prevBtn) prevBtn.addEventListener('click', function () {
        curIdx = curIdx <= 0 ? slides.length - 1 : curIdx - 1;
        updateCarousel();
      });
      if (nextBtn) nextBtn.addEventListener('click', function () {
        curIdx = curIdx >= slides.length - 1 ? 0 : curIdx + 1;
        updateCarousel();
      });
      updateCarousel();
    }
  }

  var previewInstagramContainer = $('#previewInstagramContainer');
  if (previewInstagramContainer) previewInstagramContainer.style.display = 'none';

  var previewCaption = $('#previewCaption');
  if (previewCaption) previewCaption.textContent = caption;

  var previewModal = $('#previewModal');
  if (previewModal) previewModal.classList.add('show');
}

function closePreviewModal() {
  const previewModal = $('#previewModal');
  if (previewModal) {
    previewModal.classList.remove('show');
  }
}

  // Close preview modal handlers
  const closePreviewModalBtn = $('#closePreviewModal');
  if (closePreviewModalBtn) {
    closePreviewModalBtn.addEventListener('click', () => {
      closePreviewModal();
    });
  }

  // Close on backdrop click
  const previewModal = $('#previewModal');
  if (previewModal) {
    previewModal.addEventListener('click', (e) => {
      if (e.target === previewModal) {
        closePreviewModal();
      }
    });
  }

  // Close on ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const previewModal = $('#previewModal');
      if (previewModal && previewModal.classList.contains('show')) {
        closePreviewModal();
      }
    }
  });

  const approvalDelete = $('#approvalDelete');
  if (approvalDelete) {
    approvalDelete.addEventListener('click', () => {
    const id = $('#approvalId').value;
    if (!id || !confirm('Are you sure you want to delete this approval?')) return;
    
    const state = load();
    const item = state.approvals.find(a => a.id === id);
    if (item) {
      state.approvals = state.approvals.filter(a => a.id !== id);
      
      // Update KPIs
      const pendingCount = state.approvals.filter(a => !a.status || a.status === 'pending').length;
      const scheduledCount = calculateScheduledPosts(state.approvals);
      if (state.kpis) {
        state.kpis.waitingApproval = pendingCount;
        state.kpis.scheduled = scheduledCount;
      }
      
      // Log activity
      if (!state.activity) state.activity = [];
      state.activity.push({
        when: Date.now(),
        text: `Deleted approval: ${item.title}`
      });
      
      save(state);
      renderApprovalsTab();
      renderOverviewTab(); // Update overview to reflect new scheduled count
      
      // Reset form
      approvalForm.reset();
      $('#approvalId').value = '';
      $('#editPanelTitle').textContent = 'Create Approval';
      $('#approvalDelete').style.display = 'none';
      selectedApprovalId = null;
      var ipw = $('#imageUrlPreviewWrap'); if (ipw) ipw.style.display = 'none';
    }
    });
  }
}


/* ================== Requests Tab ================== */
let showClosedRequests = false;

function renderRequestsTab() {
  const state = load();
  const container = $('#requestsList');
  if (!container) return;
  
  container.innerHTML = '';
  
  const requests = (state.requests || []).filter(r => showClosedRequests || r.status === 'open');
  
  if (requests.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__text' }, "Your client hasn't requested anything yet.")
    ));
    return;
  }
  
  requests.forEach(req => {
    const item = el('div', { class: 'request-item' });
    item.style.cursor = 'pointer';
    item.style.transition = 'box-shadow 0.2s';
    item.addEventListener('mouseenter', function() { item.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; });
    item.addEventListener('mouseleave', function() { item.style.boxShadow = ''; });

    const info = el('div', { class: 'request-item__info' });
    const type = el('div', { class: 'request-item__type' });
    type.textContent = req.type || 'Request';
    const details = el('div', { class: 'request-item__details' });
    details.textContent = (req.details || '').slice(0, 120) + ((req.details || '').length > 120 ? '...' : '');
    const meta = el('div', { class: 'request-item__meta' });
    var metaText = `By ${req.by || 'Client'} • ${fmtDate(req.createdAt || Date.now())}`;
    var hasAttachments = (req.images && req.images.length) || (req.link && req.link.trim());
    if (hasAttachments) {
      var attachCount = (req.images ? req.images.length : 0) + (req.link && req.link.trim() ? 1 : 0);
      metaText += ' • 📎 ' + attachCount + ' attachment(s)';
    }
    meta.textContent = metaText;

    info.appendChild(type);
    info.appendChild(details);
    info.appendChild(meta);

    const actions = el('div', { style: 'display: flex; align-items: center;' });
    const status = el('span', {
      class: `request-item__status request-item__status--${req.status || 'open'}`
    }, req.status === 'done' ? 'Done' : 'Open');
    actions.appendChild(status);

    if (req.status === 'open') {
      const btn = el('button', { class: 'btn btn-primary' }, 'Mark Done');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        markRequestDone(req.id);
      });
      actions.appendChild(btn);
    }

    item.addEventListener('click', function() { openRequestDetail(req); });

    item.appendChild(info);
    item.appendChild(actions);
    container.appendChild(item);
  });
}

function markRequestDone(id) {
  const state = load();
  const req = (state.requests || []).find(r => r.id === id);
  if (!req) return;
  
  req.status = 'done';
  req.doneAt = Date.now();
  if (!req.createdAt) req.createdAt = Date.now();

  if (!state.activity) state.activity = [];
  state.activity.push({
    when: Date.now(),
    text: `Marked request as done: ${req.type}`
  });

  save(state);
  // Notify client their request was completed
  if (currentClientId) {
    fetch(getApiBaseUrl() + '/api/notifications/notify-client', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ clientId: currentClientId, type: 'request_done', requestTitle: req.type || req.title || 'Your request' })
    }).catch(function() {});
  }
  renderRequestsTab();
  updateTabCountBadges();
  if (currentTab === 'overview' && typeof renderOverviewTab === 'function') renderOverviewTab();
}

function setupRequestsHandlers() {
  const showClosedCheckbox = $('#showClosedRequests');
  if (showClosedCheckbox) {
    showClosedCheckbox.addEventListener('change', (e) => {
      showClosedRequests = e.target.checked;
      renderRequestsTab();
    });
  }
}

function openRequestDetail(req) {
  var existing = document.getElementById('requestDetailModal');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'requestDetailModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
  overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

  var panel = document.createElement('div');
  panel.style.cssText = 'background:#fff;border-radius:16px;max-width:600px;width:100%;max-height:85vh;overflow-y:auto;padding:32px;position:relative;box-shadow:0 20px 60px rgba(0,0,0,0.15);';

  var closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&times;';
  closeBtn.style.cssText = 'position:absolute;top:16px;right:16px;width:32px;height:32px;border-radius:50%;border:none;background:#f1f5f9;font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#64748b;';
  closeBtn.addEventListener('click', function() { overlay.remove(); });
  panel.appendChild(closeBtn);

  var statusColor = req.status === 'done' ? '#059669' : '#2563eb';
  var statusLabel = req.status === 'done' ? 'Done' : 'Open';

  var h = '';
  h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="width:10px;height:10px;border-radius:50%;background:' + statusColor + ';"></span><span style="font-size:12px;font-weight:600;color:' + statusColor + ';text-transform:uppercase;letter-spacing:0.05em;">' + statusLabel + '</span></div>';
  h += '<h2 style="margin:0 0 16px 0;font-size:22px;font-weight:700;color:#0f172a;">' + (req.type || 'Request').replace(/</g, '&lt;') + '</h2>';
  h += '<div style="font-size:14px;color:#475569;white-space:pre-wrap;line-height:1.6;margin-bottom:16px;padding:16px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;">' + (req.details || 'No details').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div>';

  if (req.link && req.link.trim()) {
    h += '<div style="margin-bottom:16px;padding:12px 16px;background:#eff6ff;border-radius:10px;border:1px solid #bfdbfe;display:flex;align-items:center;gap:8px;">';
    h += '<svg width="16" height="16" fill="none" stroke="#2563eb" stroke-width="2" viewBox="0 0 24 24"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>';
    h += '<a href="' + req.link.replace(/"/g, '&quot;') + '" target="_blank" style="color:#2563eb;font-size:14px;word-break:break-all;text-decoration:underline;">' + req.link.replace(/</g, '&lt;') + '</a>';
    h += '</div>';
  }

  if (req.images && req.images.length) {
    h += '<div style="margin-bottom:16px;"><p style="font-size:13px;font-weight:600;color:#475569;margin:0 0 10px 0;">Attached Images (' + req.images.length + ')</p>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;">';
    req.images.forEach(function(img, i) {
      h += '<div class="req-thumb" data-img-index="' + i + '" style="border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;cursor:pointer;">';
      h += '<img src="' + img + '" style="width:100%;height:140px;object-fit:cover;display:block;" alt="Attachment ' + (i+1) + '">';
      h += '</div>';
    });
    h += '</div></div>';
  }

  h += '<div style="font-size:13px;color:#94a3b8;margin-top:8px;">By ' + (req.by || 'Client').replace(/</g, '&lt;') + ' • ' + fmtDate(req.createdAt || Date.now()) + '</div>';

  if (req.status === 'open') {
    h += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;">';
    h += '<button id="reqDetailMarkDone" style="padding:10px 24px;background:#059669;color:white;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Mark Done</button>';
    h += '</div>';
  }

  var content = document.createElement('div');
  content.innerHTML = h;
  panel.appendChild(content);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  // Image lightbox — click thumbnail to view full size
  if (req.images && req.images.length) {
    content.querySelectorAll('.req-thumb').forEach(function(thumb) {
      thumb.addEventListener('click', function() {
        var idx = parseInt(thumb.getAttribute('data-img-index'), 10);
        var src = req.images[idx];
        if (!src) return;
        var lb = document.createElement('div');
        lb.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:10000;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:20px;';
        lb.innerHTML = '<img src="' + src + '" style="max-width:90%;max-height:90%;border-radius:8px;object-fit:contain;">';
        lb.addEventListener('click', function() { lb.remove(); });
        document.body.appendChild(lb);
      });
    });
  }

  var markDoneBtn = document.getElementById('reqDetailMarkDone');
  if (markDoneBtn) {
    markDoneBtn.addEventListener('click', function() {
      markRequestDone(req.id);
      overlay.remove();
    });
  }
}

/* ================== Needs Tab ================== */
function renderNeedsTab() {
  const state = load();
  const container = $('#needsList');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Only show open needs
  const openNeeds = (state.needs || []).filter(n => !n.status || n.status === 'open');
  
  if (openNeeds.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__text' }, 'You have no outstanding needs from this client.')
    ));
    return;
  }
  
  openNeeds.forEach(need => {
    const item = el('div', { class: 'need-item' });
    
    const text = el('div', { class: 'need-item__text' });
    text.textContent = need.text;
    
    const actions = el('div', { style: 'display: flex; align-items: center; gap: 8px;' });
    const severity = el('span', {
      class: `need-item__severity need-item__severity--${need.severity || 'warn'}`
    }, need.severity === 'bad' ? 'Bad' : 'Warning');
    actions.appendChild(severity);
    
    // Add "Mark done" button
    const markDoneBtn = el('button', { class: 'btn btn-primary', style: 'padding: 6px 12px; font-size: 12px; background: #22c55e; color: white; border: none;' }, 'Mark done');
    markDoneBtn.addEventListener('click', () => {
      markNeedDone(need.id);
    });
    actions.appendChild(markDoneBtn);
    
    const removeBtn = el('button', { class: 'btn btn-danger', style: 'padding: 6px 12px; font-size: 12px;' }, 'Remove');
    removeBtn.addEventListener('click', () => {
      if (confirm('Remove this need?')) {
        removeNeed(need.id);
      }
    });
    actions.appendChild(removeBtn);
    
    item.appendChild(text);
    item.appendChild(actions);
    container.appendChild(item);
  });
}

function markNeedDone(id) {
  const state = load();
  const need = (state.needs || []).find(n => n.id === id);
  if (!need) return;
  
  // Mark as done
  need.status = 'done';
  need.doneAt = Date.now();
  
  // Update missing assets count (only count open needs)
  const openNeeds = (state.needs || []).filter(n => !n.status || n.status === 'open');
  if (state.kpis) {
    state.kpis.missingAssets = openNeeds.length;
  }
  
  // Log activity
  if (!state.activity) state.activity = [];
  state.activity.push({
    when: Date.now(),
    text: `Marked need as done: ${need.text.substring(0, 50)}${need.text.length > 50 ? '...' : ''}`
  });

  save(state);
  renderNeedsTab();
  updateTabCountBadges();
  if (currentTab === 'overview' && typeof renderOverviewTab === 'function') renderOverviewTab();
}

function removeNeed(id) {
  const state = load();
  const need = (state.needs || []).find(n => n.id === id);
  if (!need) return;
  
  // Mark as done instead of deleting
  need.status = 'done';
  need.doneAt = Date.now();
  
  // Update missing assets count (only count open needs)
  const openNeeds = (state.needs || []).filter(n => !n.status || n.status === 'open');
  if (state.kpis) {
    state.kpis.missingAssets = openNeeds.length;
  }
  
  // Log activity
  if (!state.activity) state.activity = [];
  state.activity.push({
    when: Date.now(),
    text: 'Removed need from client'
  });
  
  save(state);
  renderNeedsTab();
}

function setupNeedsHandlers() {
  const needForm = $('#needForm');
  if (needForm) {
    needForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const state = load();
    if (!state.needs) state.needs = [];
    
    const need = {
      id: `n${Date.now()}`,
      text: $('#needText').value.trim(),
      severity: $('#needSeverity').value,
      status: 'open',
      createdAt: Date.now()
    };
    
    state.needs.push(need);
    
    // Update missing assets count (only count open needs)
    const openNeeds = (state.needs || []).filter(n => !n.status || n.status === 'open');
    if (state.kpis) {
      state.kpis.missingAssets = openNeeds.length;
    }
    
    // Log activity
    if (!state.activity) state.activity = [];
    state.activity.push({
      when: Date.now(),
      text: `Added need: ${need.text.substring(0, 50)}${need.text.length > 50 ? '...' : ''}`
    });
    
    save(state);
    needForm.reset();
    renderNeedsTab();
    });
  }
}

/* ================== Assets & References (Content Library) Tab ================== */

function renderContentLibraryTab() {
  const container = $('#assetsGrid');
  const summaryApproved = $('#assetsSummaryApproved');
  const summaryPending = $('#assetsSummaryPending');
  const summaryNeedsChanges = $('#assetsSummaryNeedsChanges');
  const filterFormatUse = $('#assetsFilterFormatUse');
  const filterPillar = $('#assetsFilterPillar');
  const filterMediaType = $('#assetsFilterMediaType');
  const showApprovedOnlyCheck = $('#assetsShowAllOnly');
  if (!currentClientId) {
    if (container) container.innerHTML = '';
    return;
  }

  const assets = loadAssets(currentClientId);
  const approvedCount = assets.filter(a => a.approvalStatus === 'APPROVED').length;
  const pendingCount = assets.filter(a => a.approvalStatus === 'PENDING').length;
  const needsChangesCount = assets.filter(a => a.approvalStatus === 'NEEDS_CHANGES').length;

  if (summaryApproved) summaryApproved.textContent = 'Approved: ' + approvedCount;
  if (summaryPending) summaryPending.textContent = 'Pending: ' + pendingCount;
  if (summaryNeedsChanges) summaryNeedsChanges.textContent = 'Needs changes: ' + needsChangesCount;

  var needsChangesCue = document.getElementById('assetsNeedsChangesCue');
  if (needsChangesCount > 0) {
    if (!needsChangesCue) {
      var panelHeader = document.querySelector('#assetsApprovedPanel .assets-panel__header');
      if (panelHeader) {
        needsChangesCue = document.createElement('span');
        needsChangesCue.id = 'assetsNeedsChangesCue';
        needsChangesCue.className = 'inline-cue inline-cue--action';
        needsChangesCue.textContent = 'Client requested changes';
        panelHeader.appendChild(document.createTextNode(' '));
        panelHeader.appendChild(needsChangesCue);
      }
    }
    if (needsChangesCue) needsChangesCue.style.display = 'inline-flex';
  } else if (needsChangesCue) needsChangesCue.style.display = 'none';

  // Build unique pillars for filter dropdown
  const allPillars = [...new Set(assets.flatMap(a => a.pillars || []))].sort();
  const suggestedPillars = ['Promo', 'Branding', 'Testimonial', 'Menu', 'BTS', 'Event', 'Education'];
  const pillarOpts = [...new Set([...suggestedPillars.filter(p => allPillars.includes(p)), ...allPillars])];
  if (filterPillar) {
    const current = filterPillar.value;
    filterPillar.innerHTML = '<option value="">All pillars</option>' + pillarOpts.map(p => '<option value="' + p + '">' + p + '</option>').join('');
    if (pillarOpts.includes(current)) filterPillar.value = current;
  }

  const filters = {
    formatUse: filterFormatUse ? filterFormatUse.value : 'ANY',
    pillar: filterPillar ? filterPillar.value : '',
    mediaType: filterMediaType ? filterMediaType.value : '',
    approvedOnly: showApprovedOnlyCheck ? showApprovedOnlyCheck.checked : true
  };
  let filtered = filterAssets(assets, filters);
  filtered.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());

  if (container) {
    container.innerHTML = '';
    if (filtered.length === 0) {
      container.appendChild(el('div', { class: 'empty-state' },
        el('div', { class: 'empty-state__text' }, filters.approvedOnly ? 'No approved assets match the filters. Try "Show approved only" off or adjust filters.' : 'No assets match the filters. Add a reference using the form below.')
      ));
    } else {
      filtered.forEach(asset => {
        container.appendChild(buildAssetCard(asset));
      });
    }
  }

  // Console logging for selected client
  if (assets.length) {
    assets.slice(0, 6).forEach(a => {
    });
  }
}

function buildAssetCard(asset) {
  const card = el('div', { class: 'asset-card' });
  const mediaIcon = { PHOTO: '🖼', VIDEO: '▶', GRAPHIC: '◇', DOC: '📄' }[asset.mediaType] || '🖼';
  const thumbContainer = el('div', { class: 'asset-card__thumb' });
  const thumbPlaceholder = el('div', { class: 'asset-card__thumb-placeholder', style: 'display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;font-size:28px;color:#94a3b8;' });
  const iconSpan = document.createElement('span');
  iconSpan.textContent = mediaIcon;
  thumbPlaceholder.appendChild(iconSpan);
  const previewUrl = asset.thumbnailUrl || getPreviewUrl(asset);
  const fileId = (asset.url && (asset.sourceProvider === 'GOOGLE_DRIVE' || asset.url.includes('drive.google.com'))) ? extractGoogleDriveFileId(asset.url) : null;
  if (previewUrl) {
    const img = el('img', {
      class: 'asset-card__thumb-img',
      src: previewUrl,
      alt: asset.title || 'Preview',
      loading: 'lazy',
      referrerPolicy: 'no-referrer'
    });
    img.onload = function () {
      thumbPlaceholder.style.display = 'none';
    };
    img.onerror = function () {
      img.style.display = 'none';
      thumbPlaceholder.style.display = 'flex';
      thumbPlaceholder.title = 'Preview unavailable (permissions)';
      var note = thumbPlaceholder.querySelector('.asset-card__thumb-note');
      if (!note) {
        note = document.createElement('span');
        note.className = 'asset-card__thumb-note';
        note.textContent = 'Preview unavailable (permissions)';
        thumbPlaceholder.appendChild(note);
      }
    };
    thumbContainer.appendChild(img);
  }
  thumbContainer.appendChild(thumbPlaceholder);
  card.appendChild(thumbContainer);

  const body = el('div', { class: 'asset-card__body' });
  const title = el('div', { class: 'asset-card__title' });
  title.textContent = asset.title || 'Untitled';
  body.appendChild(title);

  const statusClass = 'asset-card__status asset-card__status--' + (asset.approvalStatus || 'PENDING').toLowerCase().replace(/_/g, '-');
  const statusLabel = (asset.approvalStatus || 'PENDING').replace(/_/g, ' ');
  body.appendChild(el('span', { class: statusClass }, statusLabel));

  const meta = el('div', { class: 'asset-card__meta' });
  meta.appendChild(el('span', { class: 'asset-card__provider' }, getProviderLabel(asset.sourceProvider)));
  meta.appendChild(el('span', { class: 'asset-card__use' }, (asset.formatUse || 'Any').replace(/_/g, ' ')));
  if ((asset.pillars || []).length) {
    asset.pillars.forEach(p => meta.appendChild(el('span', { class: 'asset-card__pillar' }, p)));
  }
  body.appendChild(meta);

  const actions = el('div', { class: 'asset-card__actions' });
  const openBtn = el('button', { type: 'button', class: 'btn btn--sm btn-secondary' }, 'Open');
  openBtn.addEventListener('click', () => { if (asset.url) window.open(asset.url, '_blank'); });
  const copyBtn = el('button', { type: 'button', class: 'btn btn--sm btn-secondary' }, 'Copy link');
  copyBtn.addEventListener('click', () => {
    if (asset.url) {
      navigator.clipboard.writeText(asset.url);
      if (typeof showToast === 'function') showToast('Link copied', 'success');
      else alert('Link copied');
    }
  });
  actions.appendChild(openBtn);
  actions.appendChild(copyBtn);

  const deleteBtn = el('button', { type: 'button', class: 'btn btn--sm btn-danger' }, 'Delete');
  deleteBtn.addEventListener('click', () => {
    if (confirm('Delete "' + (asset.title || 'this reference') + '"?')) {
      deleteAsset(asset.id);
    }
  });
  actions.appendChild(deleteBtn);

  const statusSelect = el('select', { class: 'form-select form-select--sm', 'data-asset-id': asset.id });
  ['PENDING', 'APPROVED', 'NEEDS_CHANGES', 'REJECTED'].forEach(s => {
    const opt = document.createElement('option');
    opt.value = s;
    opt.textContent = s.replace(/_/g, ' ');
    if ((asset.approvalStatus || '') === s) opt.selected = true;
    statusSelect.appendChild(opt);
  });
  statusSelect.addEventListener('change', () => {
    const newStatus = statusSelect.value;
    updateAssetStatus(currentClientId, asset.id, newStatus);
    renderContentLibraryTab();
  });
  actions.appendChild(statusSelect);

  const useInContentBtn = el('button', { type: 'button', class: 'btn btn--sm btn-primary' }, 'Use in Content');
  useInContentBtn.addEventListener('click', () => { alert('Use in Content will open the Content Engine. Coming soon.'); });
  actions.appendChild(useInContentBtn);

  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

function approveAsset(id) {
  if (!currentClientId) return;
  updateAssetStatus(currentClientId, id, 'APPROVED');
  renderContentLibraryTab();
}

function deleteAsset(id) {
  if (!currentClientId) return;
  const key = getAssetsStorageKey(currentClientId);
  if (!key) return;
  const list = loadAssets(currentClientId).filter(a => a.id !== id);
  try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { console.warn('deleteAsset', e); }
  renderContentLibraryTab();
}

// Setup asset handlers: Add-by toggle, form submit, filters
function setupAssetHandlers() {
  // Add-by toggle: show Link vs Upload group
  const linkGroup = $('#assetLinkGroup');
  const uploadGroup = $('#assetUploadGroup');
  $$('input[name="assetSourceType"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isLink = ($('input[name="assetSourceType"]:checked') || {}).value === 'LINK';
      if (linkGroup) linkGroup.style.display = isLink ? 'block' : 'none';
      if (uploadGroup) uploadGroup.style.display = isLink ? 'none' : 'block';
    });
  });
  if (linkGroup) linkGroup.style.display = 'block';
  if (uploadGroup) uploadGroup.style.display = 'none';

  const assetForm = $('#assetForm');
  if (assetForm) {
    assetForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!currentClientId) {
        if (typeof showToast === 'function') showToast('Please select a client first');
        else alert('Please select a client first');
        return;
      }
      const sourceType = ($('input[name="assetSourceType"]:checked') || {}).value || 'LINK';
      const urlInput = $('#assetUrl');
      const url = (urlInput && urlInput.value && sourceType === 'LINK') ? urlInput.value.trim() : '';
      const sourceProvider = sourceType === 'LINK' ? parseProviderFromUrl(url) : 'LOCAL_UPLOAD';
      const asset = {
        title: ($('#assetTitle') && $('#assetTitle').value) ? $('#assetTitle').value.trim() : '',
        sourceType: sourceType,
        sourceProvider,
        url: url || (sourceType === 'UPLOAD' && $('#assetFile') && $('#assetFile').files[0] ? '#' + $('#assetFile').files[0].name : ''),
        mediaType: ($('#assetMediaType') && $('#assetMediaType').value) || 'PHOTO',
        formatUse: ($('#assetFormatUse') && $('#assetFormatUse').value) || 'ANY',
        pillars: normalizePillars(($('#assetPillars') && $('#assetPillars').value) || ''),
        approvalStatus: ($('#assetApprovalStatus') && $('#assetApprovalStatus').value) || 'PENDING',
        clientNotes: ($('#assetClientNotes') && $('#assetClientNotes').value) ? $('#assetClientNotes').value.trim() : '',
        internalNotes: ($('#assetInternalNotes') && $('#assetInternalNotes').value) ? $('#assetInternalNotes').value.trim() : ''
      };
      asset.thumbnailUrl = getPreviewUrl(asset);
      saveAsset(currentClientId, asset);
      assetForm.reset();
      if ($('#assetApprovalStatus')) $('#assetApprovalStatus').value = 'PENDING';
      if ($('input[name="assetSourceType"]')) { const r = $('input[name="assetSourceType"][value="LINK"]'); if (r) r.checked = true; }
      if (linkGroup) linkGroup.style.display = 'block';
      if (uploadGroup) uploadGroup.style.display = 'none';
      // Show all assets so the new one (usually Pending) is visible
      const showApprovedOnly = $('#assetsShowAllOnly');
      if (showApprovedOnly) showApprovedOnly.checked = false;
      renderContentLibraryTab();
      if (typeof showToast === 'function') showToast('Reference saved');
      else alert('Reference saved');
    });
  }

  // Filter and toggle handlers for Assets panel
  const filterFormatUse = $('#assetsFilterFormatUse');
  const filterPillar = $('#assetsFilterPillar');
  const filterMediaType = $('#assetsFilterMediaType');
  const showApprovedOnly = $('#assetsShowAllOnly');
  [filterFormatUse, filterPillar, filterMediaType, showApprovedOnly].forEach(el => {
    if (el) el.addEventListener('change', () => renderContentLibraryTab());
  });
}

/* ================== New Client Modal ================== */
function showNewClientModal() {
  const modal = $('#newClientModal');
  if (!modal) return;
  if (window.editingClientId) {
    modal.classList.add('show');
    return;
  }
  window.editingClientId = null;
  modal.classList.add('show');
  const form = $('#newClientForm');
  if (form) form.reset();
  // Clear client ID input (will auto-generate)
  const clientIdInput = $('#clientIdInput');
    if (clientIdInput) {
      clientIdInput.value = '';
      clientIdInput.disabled = false;
    }
    // Hide custom frequency note
    const customGroup = $('#customFrequencyGroup');
    if (customGroup) customGroup.style.display = 'none';
    // Clear errors
    $$('.error-message').forEach(el => {
      el.classList.remove('show');
      el.textContent = '';
    });
  // Reset form title and submit button
  const formTitle = document.querySelector('#newClientForm h2');
  if (formTitle) formTitle.textContent = 'Create New Client';
    const submitBtn = $('#newClientForm button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Create Client';
    // Password required for new clients
    const passwordInput = $('#clientPassword');
    if (passwordInput) passwordInput.required = true;
    // Reset logo in form
    updateFormLogo(null, '');
    // Clear form logo input
    const formLogoInput = $('#formLogoInput');
  if (formLogoInput) formLogoInput.value = '';
  // Store form logo URL (will be set when user uploads)
  window.formLogoUrl = null;
}

// Update logo display in form
function updateFormLogo(logoUrl, clientName) {
  const formLogoImg = $('#formLogoImg');
  const formLogoInitials = $('#formLogoInitials');
  const formAddLogoBtn = $('#formAddLogoBtn');
  
  if (logoUrl) {
    if (formLogoImg) {
      formLogoImg.src = logoUrl;
      formLogoImg.style.display = 'block';
    }
    if (formLogoInitials) {
      formLogoInitials.style.display = 'none';
    }
    if (formAddLogoBtn) {
      formAddLogoBtn.textContent = 'Change Logo';
    }
    window.formLogoUrl = logoUrl;
  } else {
    if (formLogoImg) {
      formLogoImg.style.display = 'none';
    }
    if (formLogoInitials) {
      formLogoInitials.style.display = 'block';
      // Get initials from client name or current name input
      const nameInput = $('#clientName');
      const name = clientName || (nameInput ? nameInput.value : '');
      const initials = (name || 'CN')
        .split(' ')
        .map(word => word.charAt(0))
        .join('')
        .substring(0, 2)
        .toUpperCase();
      formLogoInitials.textContent = initials || 'CN';
    }
    if (formAddLogoBtn) {
      formAddLogoBtn.textContent = 'Add Logo';
    }
    window.formLogoUrl = null;
  }
}

// Setup form logo upload handler
function setupFormLogoUpload() {
  const formAddLogoBtn = $('#formAddLogoBtn');
  const formLogoInput = $('#formLogoInput');
  
  if (!formAddLogoBtn || !formLogoInput) return;
  
  // Remove existing handlers
  const newBtn = formAddLogoBtn.cloneNode(true);
  formAddLogoBtn.parentNode.replaceChild(newBtn, formAddLogoBtn);
  
  const newInput = $('#formLogoInput');
  const newAddBtn = $('#formAddLogoBtn');
  
  // Click on Add Logo button to trigger file input
  if (newAddBtn) {
    newAddBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (newInput) newInput.click();
    });
  }
  
  // Handle file selection
  if (newInput) {
    // Remove existing change handler if any
    if (newInput._formLogoChangeHandler) {
      newInput.removeEventListener('change', newInput._formLogoChangeHandler);
    }
    
    newInput._formLogoChangeHandler = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
      }
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB');
        return;
      }
      
      // Read file as data URL
      const reader = new FileReader();
      reader.onload = (event) => {
        const logoUrl = event.target.result;
        const nameInput = $('#clientName');
        const clientName = nameInput ? nameInput.value : '';
        updateFormLogo(logoUrl, clientName);
      };
      reader.onerror = () => {
        alert('Error reading file. Please try again.');
      };
      reader.readAsDataURL(file);
    };
    
    newInput.addEventListener('change', newInput._formLogoChangeHandler);
  }
  
  // Update initials when client name changes
  const nameInput = $('#clientName');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      if (!window.formLogoUrl) {
        // Only update initials if no logo is set
        const formLogoInitials = $('#formLogoInitials');
        if (formLogoInitials && formLogoInitials.style.display !== 'none') {
          const name = nameInput.value;
          const initials = (name || 'CN')
            .split(' ')
            .map(word => word.charAt(0))
            .join('')
            .substring(0, 2)
            .toUpperCase();
          formLogoInitials.textContent = initials || 'CN';
        }
      }
    });
  }
}

function hideNewClientModal() {
  const modal = $('#newClientModal');
  if (modal) {
    modal.classList.remove('show');
  }
}

function showFieldError(fieldId, message) {
  const errorEl = $(`#error-${fieldId}`);
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.add('show');
  }
}

function clearFieldError(fieldId) {
  const errorEl = $(`#error-${fieldId}`);
  if (errorEl) {
    errorEl.classList.remove('show');
    errorEl.textContent = '';
  }
}

function validateNewClientForm(isEditing) {
  let isValid = true;
  
  // Clear all errors
  $$('.error-message').forEach(el => {
    el.classList.remove('show');
    el.textContent = '';
  });
  
  // A) Client Identity
  const clientName = $('#clientName').value.trim();
  if (!clientName) {
    showFieldError('clientName', 'Client name is required');
    isValid = false;
  }
  
  const clientCategory = $('#clientCategory').value;
  if (!clientCategory) {
    showFieldError('clientCategory', 'Category is required');
    isValid = false;
  }
  
  // Client ID validation (only for new clients, editing uses existing ID)
  if (!isEditing) {
    const clientIdInput = $('#clientIdInput').value.trim().toLowerCase();
    if (clientIdInput && !/^[a-z0-9-]+$/.test(clientIdInput)) {
      showFieldError('clientIdInput', 'Client ID must contain only lowercase letters, numbers, and hyphens');
      isValid = false;
    }
  }
  
  // Password validation (required for new clients, optional for editing)
  if (!isEditing) {
    const password = $('#clientPassword').value;
    if (!password || password.length < 6) {
      showFieldError('clientPassword', 'Password must be at least 6 characters long');
      isValid = false;
    }
  } else {
    // For editing, password is optional but if provided must be at least 6 characters
    const password = $('#clientPassword').value;
    if (password && password.length < 6) {
      showFieldError('clientPassword', 'Password must be at least 6 characters long');
      isValid = false;
    }
  }
  
  // B) Primary Contact
  const primaryContactName = $('#primaryContactName').value.trim();
  if (!primaryContactName) {
    showFieldError('primaryContactName', 'Contact name is required');
    isValid = false;
  }
  
  const primaryContactWhatsApp = $('#primaryContactWhatsApp').value.trim();
  if (!primaryContactWhatsApp) {
    showFieldError('primaryContactWhatsApp', 'WhatsApp is required');
    isValid = false;
  }
  
  const primaryContactEmail = $('#primaryContactEmail').value.trim();
  if (!primaryContactEmail || !primaryContactEmail.includes('@')) {
    showFieldError('primaryContactEmail', 'Valid email is required');
    isValid = false;
  }
  
  const preferredChannel = $('#preferredChannel').value;
  if (!preferredChannel) {
    showFieldError('preferredChannel', 'Preferred channel is required');
    isValid = false;
  }
  
  // C) Platforms Managed
  const platformsCheckboxes = $$('input[name="platformsManaged"]:checked');
  if (platformsCheckboxes.length === 0) {
    showFieldError('platformsManaged', 'At least one platform must be selected');
    isValid = false;
  }
  
  return isValid;
}

function generateClientId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
}

async function createNewClient() {
  const isEditing = window.editingClientId;
  
  if (!validateNewClientForm(isEditing)) {
    return false;
  }
  
  const clients = loadClientsRegistry();
  
  // Get or generate client ID
  let clientId = $('#clientIdInput').value.trim().toLowerCase();
  
  if (isEditing) {
    // Editing mode - use existing client ID
    clientId = window.editingClientId;
  } else {
    // Creating new client
    if (!clientId) {
      // Auto-generate from name if empty
      clientId = generateClientId($('#clientName').value.trim());
      let counter = 1;
      while (clients[clientId]) {
        clientId = `${generateClientId($('#clientName').value.trim())}-${counter}`;
        counter++;
      }
    } else {
      // Validate client ID format
      if (!/^[a-z0-9-]+$/.test(clientId)) {
        showFieldError('clientIdInput', 'Client ID must contain only lowercase letters, numbers, and hyphens');
        return false;
      }
      // Check if client ID already exists (only for new clients)
      if (clients[clientId]) {
        showFieldError('clientIdInput', 'Client ID already exists. Please choose a different one.');
        return false;
      }
    }
  }
  
  // Validate password (only required for new clients, optional for editing)
  const password = $('#clientPassword').value;
  if (!isEditing && (!password || password.length < 6)) {
    showFieldError('clientPassword', 'Password must be at least 6 characters long');
    return false;
  }
  
  // Clear any previous errors for these fields
  clearFieldError('clientIdInput');
  if (!isEditing) clearFieldError('clientPassword');
  
  // Get platforms
  const platformsCheckboxes = $$('input[name="platformsManaged"]:checked');
  const platformsManaged = Array.from(platformsCheckboxes).map(cb => cb.value);
  
  // Get posting frequency
  const postingFrequency = $('#postingFrequency').value;
  const postingFrequencyNote = postingFrequency === 'custom' ? $('#postingFrequencyNote').value.trim() : '';
  
  // Create/update client object
  const existingClient = isEditing ? clients[clientId] : null;
  const clientData = {
    id: clientId,
    name: $('#clientName').value.trim(),
    category: $('#clientCategory').value,
    primaryContactName: $('#primaryContactName').value.trim(),
    primaryContactWhatsApp: $('#primaryContactWhatsApp').value.trim(),
    primaryContactEmail: $('#primaryContactEmail').value.trim(),
    preferredChannel: $('#preferredChannel').value,
    platformsManaged: platformsManaged,
    postingFrequency: postingFrequency,
    postingFrequencyNote: postingFrequencyNote,
    approvalRequired: $('#approvalRequired').value === 'true',
    language: $('#language').value,
    assetsLink: $('#assetsLink').value.trim() || '',
    brandGuidelinesLink: $('#brandGuidelinesLink').value.trim() || '',
    primaryGoal: $('#primaryGoal').value || '',
    secondaryGoal: $('#secondaryGoal').value.trim() || '',
    internalBehaviorType: $('#internalBehaviorType').value,
    riskLevel: $('#riskLevel').value,
    internalNotes: $('#internalNotes').value.trim() || '',
    logoUrl: window.formLogoUrl !== undefined ? window.formLogoUrl : (existingClient ? existingClient.logoUrl : undefined), // Use form logo if uploaded, otherwise preserve existing
    createdAt: existingClient ? existingClient.createdAt : Date.now(),
    updatedAt: Date.now()
  };
  
  const base = getApiBaseUrl();
  const body = {
    id: clientData.id,
    name: clientData.name,
    category: clientData.category,
    primaryContactName: clientData.primaryContactName,
    primaryContactWhatsApp: clientData.primaryContactWhatsApp,
    primaryContactEmail: clientData.primaryContactEmail,
    preferredChannel: clientData.preferredChannel,
    platformsManaged: clientData.platformsManaged,
    postingFrequency: clientData.postingFrequency,
    postingFrequencyNote: clientData.postingFrequencyNote,
    approvalRequired: clientData.approvalRequired,
    language: clientData.language,
    assetsLink: clientData.assetsLink,
    brandGuidelinesLink: clientData.brandGuidelinesLink,
    primaryGoal: clientData.primaryGoal,
    secondaryGoal: clientData.secondaryGoal,
    internalBehaviorType: clientData.internalBehaviorType,
    riskLevel: clientData.riskLevel,
    internalNotes: clientData.internalNotes,
    logoUrl: clientData.logoUrl
  };
  if (!isEditing && password && password.length >= 6) body.password = password;
  if (isEditing && password && password.length >= 6) body.password = password;

  const submitBtn = $('#newClientForm button[type="submit"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Saving...'; }
  try {
    if (isEditing) {
      const r = await fetch(`${base}/api/agency/clients/${clientId}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Update failed');
    } else {
      const r = await fetch(`${base}/api/agency/clients`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Create failed');
    }
    await fetchClientsFromAPI();
    await selectClient(clientId);
    hideNewClientModal();
    if (isEditing) {
      showToast(`Client "${clientData.name}" updated successfully!`);
    } else {
      showToast(`Client "${clientData.name}" created successfully!`);
      alert(`Client "${clientData.name}" created successfully!\n\nClient ID: ${clientId}\nPassword: ${password}\n\nShare these credentials with the client for login.`);
    }
    return true;
  } catch (err) {
    showToast((err.message || 'Failed to save client'), 'error');
    return false;
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = isEditing ? 'Update Client' : 'Create Client'; }
  }
}

function showToast(message, type = 'success') {
  // Simple toast notification with different types
  let bgColor = '#22c55e'; // success (green)
  if (type === 'error') bgColor = '#ef4444'; // error (red)
  if (type === 'info') bgColor = '#3b82f6'; // info (blue)
  
  const toast = el('div', {
    style: `position: fixed; top: 20px; right: 20px; background: ${bgColor}; color: white; padding: 12px 24px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 10000; font-weight: 600; font-size: 14px;`
  }, message);
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Setup new client modal handlers
function setupNewClientHandlers() {
  const newClientBtn = $('#newClientBtn');
  if (newClientBtn) {
    newClientBtn.addEventListener('click', () => {
      showNewClientModal();
    });
  }

  const closeClientModal = $('#closeClientModal');
  if (closeClientModal) {
    closeClientModal.addEventListener('click', () => {
      hideNewClientModal();
    });
  }

  const cancelClientForm = $('#cancelClientForm');
  if (cancelClientForm) {
    cancelClientForm.addEventListener('click', () => {
      hideNewClientModal();
    });
  }
  
  // Setup form logo upload
  setupFormLogoUpload();

  // Close modal on overlay click
  const newClientModal = $('#newClientModal');
  if (newClientModal) {
    newClientModal.addEventListener('click', (e) => {
      if (e.target === newClientModal) {
        hideNewClientModal();
      }
    });
  }

  // Close modal on ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = $('#newClientModal');
      if (modal && modal.classList.contains('show')) {
        hideNewClientModal();
      }
    }
  });

  // Handle posting frequency change
  const postingFrequency = $('#postingFrequency');
  if (postingFrequency) {
    postingFrequency.addEventListener('change', (e) => {
      const customGroup = $('#customFrequencyGroup');
      if (customGroup) {
        customGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
      }
    });
  }

  // Auto-generate client ID when name changes
  const clientNameInput = $('#clientName');
  if (clientNameInput) {
    clientNameInput.addEventListener('input', (e) => {
      const clientIdInput = $('#clientIdInput');
      if (clientIdInput && !clientIdInput.value.trim()) {
        // Only auto-generate if field is empty
        const generatedId = generateClientId(e.target.value.trim());
        if (generatedId) {
          clientIdInput.value = generatedId;
        }
      }
    });
  }

  const newClientForm = $('#newClientForm');
  if (newClientForm) {
    newClientForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await createNewClient();
    });
  }
}

/* ================== Reports Tab ================== */
function renderReportsTab() {
  const container = $('#reportsContent');
  if (!container) return;
  container.innerHTML = '';

  var monthKey = typeof getMonthKey === 'function' ? getMonthKey() : '';
  var ledger = typeof getProgressSummaryLedger === 'function' ? getProgressSummaryLedger() : {};
  var clients = loadClientsRegistry();
  var clientIds = clients && typeof clients === 'object' ? Object.keys(clients) : [];
  var sentThisMonth = clientIds.filter(function (cid) {
    return ledger[cid] && ledger[cid][monthKey];
  });
  var clientNames = sentThisMonth.map(function (cid) {
    return (clients[cid] && clients[cid].name) || cid;
  });

  var progressCard = el('div', { class: 'report-card' });
  progressCard.appendChild(el('div', { class: 'report-card__header' },
    el('div', { class: 'report-card__title' }, 'Monthly progress summaries')
  ));
  progressCard.appendChild(el('div', { class: 'card__sub', style: 'margin-bottom: 12px;' },
    'One PROGRESS notification per client per month. Clients see it in their bell and can open the Progress page. You see it in your notifications with a link to this client and the Reports tab.'
  ));
  progressCard.appendChild(el('div', { class: 'card__sub', style: 'margin-bottom: 8px;' },
    'Current month: ' + (monthKey || '—')
  ));
  progressCard.appendChild(el('div', { class: 'card__sub', style: 'margin-bottom: 12px;' },
    sentThisMonth.length === 0
      ? 'Summary not sent for any client this month yet.'
      : 'Sent for: ' + clientNames.join(', ')
  ));
  var runBtn = el('button', { class: 'btn btn-primary', type: 'button' }, 'Run monthly summary');
  runBtn.addEventListener('click', function () {
    if (typeof maybeGenerateMonthlyProgressSummaryNotifications === 'function') {
      maybeGenerateMonthlyProgressSummaryNotifications();
      if (typeof renderNotificationBell === 'function') renderNotificationBell();
      renderReportsTab();
    }
  });
  progressCard.appendChild(runBtn);
  container.appendChild(progressCard);

  var r = loadReports();
  var w = (r && r.work) ? r.work : {};
  var ads = (r && r.ads) ? r.ads : {};
  var summaryEl = $('#reportsDataSummary');
  if (summaryEl) {
    var period = (r && r.period) ? r.period : '—';
    var running = (ads && typeof ads.running === 'number') ? ads.running : 0;
    var posts = (w && typeof w.posts === 'number') ? w.posts : 0;
    var reels = (w && typeof w.reels === 'number') ? w.reels : 0;
    summaryEl.textContent = 'Current: ' + period + ' • ' + running + ' ads running • ' + posts + ' posts, ' + reels + ' reels.';
  }
}

// Setup PIN-based invite handlers
function setupPinInviteHandlers() {
  const pinInviteForm = $('#pinInviteForm');
  const submitBtn = $('#submitInviteBtn');
  const successMsg = $('#inviteSuccessMessage');
  const errorMsg = $('#inviteErrorMessage');
  
  if (!pinInviteForm) return;

  pinInviteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Hide previous messages
    if (successMsg) successMsg.style.display = 'none';
    if (errorMsg) errorMsg.style.display = 'none';
    
    const email = $('#inviteEmail')?.value.trim();
    const pin = $('#invitePin')?.value.trim();
    
    if (!email || !pin) {
      if (errorMsg) {
        errorMsg.textContent = 'Please fill in all fields';
        errorMsg.style.display = 'block';
      }
      return;
    }
    
    // Disable submit button
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';
    }
    
    try {
      const response = await fetch(`${getApiBaseUrl()}/api/users/invite-with-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, pin, agencyId: getAgencyIdFromSession() })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to send invite');
      }
      
      // Show success message
      if (successMsg) {
        let message = `✅ Login credentials sent to ${email}`;
        if (data.credentials) {
          message += `\n\n📧 Credentials (DEV MODE):\nUsername: ${data.credentials.username}\nPassword: ${data.credentials.password}`;
        }
        successMsg.textContent = message;
        successMsg.style.display = 'block';
      }
      
      // Reset form
      pinInviteForm.reset();
      
      // Hide success message after 10 seconds
      setTimeout(() => {
        if (successMsg) successMsg.style.display = 'none';
      }, 10000);
      
    } catch (error) {
      console.error('PIN invite error:', error);
      if (errorMsg) {
        errorMsg.textContent = error.message || 'Failed to send invite. Please try again.';
        errorMsg.style.display = 'block';
      }
    } finally {
      // Re-enable submit button
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Login Credentials';
      }
    }
  });
}

// Setup settings modal
function setupSettingsModal() {
  const settingsBtn = $('#settingsBtn');
  const settingsModal = $('#settingsModal');
  const closeSettingsBtn = $('#closeSettingsBtn');
  const settingsModalOverlay = $('#settingsModalOverlay');
  const refreshUsersBtn = $('#refreshUsersBtn');
  
  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', () => {
      settingsModal.style.display = 'block';
      const role = (currentStaff && currentStaff.role) ? currentStaff.role : '';
      const inviteSection = $('#settingsInviteSection');
      if (inviteSection) inviteSection.style.display = (role === 'OWNER' || role === 'ADMIN') ? 'block' : 'none';
      loadUsersList();
      loadClientsList();
      loadMetaIntegrationsList();
      loadPushNotificationStatus();
    });
  }
  var refreshPushBtn = document.getElementById('refreshPushStatusBtn');
  if (refreshPushBtn) refreshPushBtn.addEventListener('click', loadPushNotificationStatus);

  // META_CONNECTED postMessage from OAuth popup - refresh Scheduled Posts connection when opened from that tab
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'META_CONNECTED' && e.data.success) {
      if (currentTab === 'scheduled') {
        renderScheduledPostsConnectionSection();
        renderScheduledPostsTab();
      }
      // Also refresh settings list if open
      if (typeof loadMetaIntegrationsList === 'function') loadMetaIntegrationsList();
    }
  });

  // Close settings modal
  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsModal.style.display = 'none';
    });
  }
  
  if (settingsModalOverlay && settingsModal) {
    settingsModalOverlay.addEventListener('click', () => {
      settingsModal.style.display = 'none';
    });
  }
  
  // Refresh users list
  if (refreshUsersBtn) {
    refreshUsersBtn.addEventListener('click', () => loadUsersList());
  }
  const refreshClientsBtn = $('#refreshClientsBtn');
  if (refreshClientsBtn) {
    refreshClientsBtn.addEventListener('click', async () => {
      try {
        await fetchClientsFromAPI();
        loadClientsList();
      } catch (e) {
        console.error('Refresh clients:', e);
      }
    });
  }
  
  // Meta integrations in settings
  var refreshMetaBtn = $('#refreshMetaIntegrationsBtn');
  if (refreshMetaBtn) refreshMetaBtn.addEventListener('click', function() { loadMetaIntegrationsList(); });

  // Setup settings PIN invite form
  const settingsForm = $('#settingsPinInviteForm');
  const settingsSubmitBtn = $('#settingsSubmitInviteBtn');
  const settingsSuccessMsg = $('#settingsInviteSuccessMessage');
  const settingsErrorMsg = $('#settingsInviteErrorMessage');
  
  if (settingsForm) {
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (settingsSuccessMsg) settingsSuccessMsg.style.display = 'none';
      if (settingsErrorMsg) settingsErrorMsg.style.display = 'none';
      
      const name = $('#settingsInviteName')?.value.trim();
      const email = $('#settingsInviteEmail')?.value.trim();
      const pin = $('#settingsInvitePin')?.value.trim();
      const password = $('#settingsInvitePassword')?.value.trim() || null;
      const role = ($('#settingsInviteRole')?.value || 'staff').toLowerCase();
      
      if (!name || !email || !pin) {
        if (settingsErrorMsg) {
          settingsErrorMsg.textContent = 'Please fill in all required fields';
          settingsErrorMsg.style.display = 'block';
        }
        return;
      }
      if (password && password.length < 8) {
        if (settingsErrorMsg) {
          settingsErrorMsg.textContent = 'Custom password must be at least 8 characters';
          settingsErrorMsg.style.display = 'block';
        }
        return;
      }
      
      if (settingsSubmitBtn) {
        settingsSubmitBtn.disabled = true;
        settingsSubmitBtn.textContent = 'Sending...';
      }
      
      try {
        const payload = { name, email, pin, agencyId: getAgencyIdFromSession(), role: role === 'designer' ? 'designer' : 'staff' };
        if (password) payload.password = password;
        const response = await fetch(`${getApiBaseUrl()}/api/users/invite-with-pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload)
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to send invite');
        }
        
        if (settingsSuccessMsg) {
          let message = password
            ? `✅ User created with your custom password. Credentials sent to ${email}.`
            : `✅ Login credentials sent to ${email}`;
          if (data.credentials) {
            message += `\n\n📧 Credentials (DEV MODE):\nUsername: ${data.credentials.username}\nPassword: ${data.credentials.password}`;
          }
          settingsSuccessMsg.textContent = message;
          settingsSuccessMsg.style.display = 'block';
        }
        if (data.user && data.credentials) {
          const stored = JSON.parse(localStorage.getItem('2fly_staff_credentials_v1') || '{}');
          stored[data.user.id] = { username: data.credentials.username, password: data.credentials.password, email: data.user.email, name: data.user.name };
          localStorage.setItem('2fly_staff_credentials_v1', JSON.stringify(stored));
        }
        settingsForm.reset();
        loadUsersList();
        
        setTimeout(() => {
          if (settingsSuccessMsg) settingsSuccessMsg.style.display = 'none';
        }, 10000);
        
      } catch (error) {
        console.error('Settings PIN invite error:', error);
        if (settingsErrorMsg) {
          settingsErrorMsg.textContent = error.message || 'Failed to send invite. Please try again.';
          settingsErrorMsg.style.display = 'block';
        }
      } finally {
        if (settingsSubmitBtn) {
          settingsSubmitBtn.disabled = false;
          settingsSubmitBtn.textContent = 'Send Login Credentials';
        }
      }
    });
  }
  
  // Load users list
  async function loadUsersList() {
    const usersListContainer = $('#usersListContainer');
    if (!usersListContainer) return;
    
    usersListContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: #64748b;">Loading users...</div>';
    
    try {
      const base = getApiBaseUrl();
      const response = await fetch(`${base}/api/users?role=STAFF`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load users');
      }
      
      const storedCreds = JSON.parse(localStorage.getItem('2fly_staff_credentials_v1') || '{}');
      if (data.users && data.users.length > 0) {
        usersListContainer.innerHTML = '';
        data.users.forEach(user => {
          const userItem = document.createElement('div');
          userItem.className = 'user-item';
          
          const userInfo = document.createElement('div');
          userInfo.className = 'user-info';
          
          const userName = document.createElement('div');
          userName.className = 'user-name';
          userName.textContent = user.name || user.email;
          
          const userDetails = document.createElement('div');
          userDetails.className = 'user-details';
          
          const emailSpan = document.createElement('span');
          emailSpan.textContent = `Email: ${user.email}`;
          
          const usernameSpan = document.createElement('span');
          usernameSpan.textContent = `Username: ${user.username || user.email.split('@')[0]}`;
          
          const roleSpan = document.createElement('span');
          roleSpan.textContent = `Role: ${user.role}`;
          
          const statusSpan = document.createElement('span');
          statusSpan.className = `user-status ${user.status}`;
          statusSpan.textContent = user.status;
          
          userDetails.appendChild(emailSpan);
          userDetails.appendChild(usernameSpan);
          userDetails.appendChild(roleSpan);
          userDetails.appendChild(statusSpan);
          
          const cred = storedCreds[user.id] || (user.password ? { password: user.password } : null);
          const credentialsNote = document.createElement('div');
          credentialsNote.className = 'user-credentials';
          credentialsNote.style.marginTop = '8px';
          credentialsNote.style.padding = '8px';
          credentialsNote.style.background = '#f1f5f9';
          credentialsNote.style.borderRadius = '4px';
          credentialsNote.style.fontSize = '12px';
          credentialsNote.style.fontFamily = 'monospace';
          if (cred && cred.password) {
            credentialsNote.textContent = `Password: ${cred.password}`;
          } else {
            credentialsNote.textContent = `Password: [Set - not shown for security]`;
          }
          
          userInfo.appendChild(userName);
          userInfo.appendChild(userDetails);
          userInfo.appendChild(credentialsNote);
          
          userItem.appendChild(userInfo);
          
          const actions = document.createElement('div');
          actions.className = 'user-item-actions';
          actions.style.display = 'flex';
          actions.style.alignItems = 'center';
          actions.style.gap = '8px';
          actions.style.flexShrink = '0';
          const canManage = (currentStaff && (currentStaff.role === 'OWNER' || currentStaff.role === 'ADMIN'));
          if (canManage) {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn btn-secondary';
            delBtn.style.padding = '6px 12px';
            delBtn.style.fontSize = '12px';
            delBtn.style.background = '#fee2e2';
            delBtn.style.color = '#dc2626';
            delBtn.style.border = '1px solid #fecaca';
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', async () => {
              if (!confirm(`Delete user "${user.name || user.email}"? They will no longer be able to log in.`)) return;
              try {
                const delRes = await fetch(`${getApiBaseUrl()}/api/users/${user.id}`, {
                  method: 'DELETE',
                  credentials: 'include',
                  headers: { 'Content-Type': 'application/json' }
                });
                const delData = await delRes.json();
                if (!delRes.ok) throw new Error(delData.error || 'Delete failed');
                const s = JSON.parse(localStorage.getItem('2fly_staff_credentials_v1') || '{}');
                delete s[user.id];
                localStorage.setItem('2fly_staff_credentials_v1', JSON.stringify(s));
                loadUsersList();
              } catch (e) {
                alert('Failed to delete user: ' + (e.message || 'Unknown error'));
              }
            });
            actions.appendChild(delBtn);
            userItem.appendChild(actions);
          }
          usersListContainer.appendChild(userItem);
        });
      } else {
        usersListContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: #64748b;">No users found</div>';
      }
    } catch (error) {
      console.error('Load users error:', error);
      usersListContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: #dc2626;">Error loading users: ${error.message}</div>`;
    }
  }
  
  function loadClientsList() {
    const container = $('#clientsListContainer');
    if (!container) return;
    const registry = loadClientsRegistry();
    const list = Object.keys(registry).map(id => {
      const c = registry[id];
      return { id, name: c.name || id, password: c.password || null };
    });
    if (list.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 20px; color: #64748b;">No clients yet. Create clients from the sidebar.</div>';
      return;
    }
    container.innerHTML = '';
    list.forEach(({ id, name, password }) => {
      const card = document.createElement('div');
      card.className = 'user-item';
      card.style.marginBottom = '12px';
      card.innerHTML = `
        <div class="user-info">
          <div class="user-name">${escapeHtml(name)}</div>
          <div class="user-details" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; font-size: 13px; color: #64748b;">
            <span>Client ID: <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${escapeHtml(id)}</code></span>
            <span>Password: ${password ? `<code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${escapeHtml(password)}</code>` : '[not set]'}</span>
          </div>
        </div>`;
      container.appendChild(card);
    });
  }
  
  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
  
  async function loadPushNotificationStatus() {
    var container = document.getElementById('pushStatusContainer');
    if (!container) return;
    container.innerHTML = '<div style="text-align:center;padding:20px;color:#64748b;">Loading...</div>';
    try {
      var r = await fetch(getApiBaseUrl() + '/api/notifications/client-status', { credentials: 'include' });
      var d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed');

      var h = '';

      // Staff section
      h += '<div style="margin-bottom:16px;">';
      h += '<div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:8px;">Team (' + d.staff.total + ' device' + (d.staff.total !== 1 ? 's' : '') + ')</div>';
      if (d.staff.total === 0) {
        h += '<div style="font-size:13px;color:#94a3b8;">No team members subscribed yet.</div>';
      } else {
        d.staff.subscriptions.forEach(function(s) {
          h += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #e2e8f0;">';
          h += '<span style="width:8px;height:8px;border-radius:50%;background:#059669;flex-shrink:0;"></span>';
          h += '<span style="font-size:13px;color:#0f172a;flex:1;">' + (s.userId || '').replace(/</g, '&lt;').substring(0, 30) + '</span>';
          h += '<span style="font-size:11px;color:#94a3b8;">' + (s.role || '') + '</span>';
          h += '</div>';
        });
      }
      h += '</div>';

      // Clients section
      h += '<div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:8px;">Clients</div>';
      if (!d.clients || d.clients.length === 0) {
        h += '<div style="font-size:13px;color:#94a3b8;">No clients found.</div>';
      } else {
        d.clients.forEach(function(c) {
          h += '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #e2e8f0;">';
          // Status indicator
          if (c.pushEnabled) {
            h += '<span style="width:8px;height:8px;border-radius:50%;background:#059669;flex-shrink:0;" title="Push enabled"></span>';
          } else {
            h += '<span style="width:8px;height:8px;border-radius:50%;background:#e2e8f0;border:1px solid #cbd5e1;flex-shrink:0;" title="Not subscribed"></span>';
          }
          // Client name
          h += '<span style="font-size:13px;color:#0f172a;font-weight:600;flex:1;">' + (c.clientName || c.clientId || '').replace(/</g, '&lt;') + '</span>';
          // Status badge
          if (c.pushEnabled) {
            h += '<span style="padding:2px 8px;border-radius:6px;background:#dcfce7;color:#059669;font-size:11px;font-weight:700;">' + c.deviceCount + ' device' + (c.deviceCount > 1 ? 's' : '') + '</span>';
          } else {
            h += '<span style="padding:2px 8px;border-radius:6px;background:#f1f5f9;color:#94a3b8;font-size:11px;font-weight:600;">Not enabled</span>';
          }
          // Send test button
          h += '<button type="button" class="push-test-client" data-client-id="' + c.clientId + '" data-client-name="' + (c.clientName || '').replace(/"/g, '&quot;') + '" style="padding:4px 10px;border-radius:6px;border:1px solid #e2e8f0;background:#fff;color:#475569;font-size:11px;font-weight:600;cursor:pointer;' + (c.pushEnabled ? '' : 'opacity:0.4;pointer-events:none;') + '">Test</button>';
          h += '</div>';
        });
      }

      container.innerHTML = h;

      // Wire test buttons
      container.querySelectorAll('.push-test-client').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var cId = btn.getAttribute('data-client-id');
          var cName = btn.getAttribute('data-client-name');
          btn.textContent = 'Sending...';
          try {
            var tr = await fetch(getApiBaseUrl() + '/api/notifications/send-to-client', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
              body: JSON.stringify({ clientId: cId, title: 'Fresh content ready! ✨', body: 'Your team just prepared new content for ' + cName + '. Take a quick look!' })
            });
            var td = await tr.json();
            btn.textContent = td.sent > 0 ? 'Sent!' : 'No device';
            setTimeout(function() { btn.textContent = 'Test'; }, 2000);
          } catch(e) { btn.textContent = 'Failed'; setTimeout(function() { btn.textContent = 'Test'; }, 2000); }
        });
      });
    } catch(e) {
      container.innerHTML = '<div style="color:#dc2626;padding:12px;">Failed to load: ' + (e.message || '') + '</div>';
    }
  }

  async function loadMetaIntegrationsList() {
    var container = $('#metaIntegrationsContainer');
    if (!container) return;
    container.innerHTML = '<div style="text-align: center; padding: 20px; color: #64748b;">Loading...</div>';
    try {
      var r = await fetch(getApiBaseUrl() + '/api/integrations/meta/list', { credentials: 'include' });
      var j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed');
      var integrations = j.integrations || [];
      var registry = loadClientsRegistry();
      if (integrations.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:#64748b;">No Meta connections yet. Connect from the <strong>Scheduled Posts</strong> tab for each client.</div>';
        return;
      }
      container.innerHTML = '';
      integrations.forEach(function(integ) {
        var clientName = (registry && registry[integ.clientId] && registry[integ.clientId].name) || integ.clientId;
        var card = document.createElement('div');
        card.style.cssText = 'padding:14px;background:white;border-radius:10px;border:1px solid #e2e8f0;margin-bottom:10px;';
        var statusColor = integ.connected ? '#059669' : '#dc2626';
        var statusText = integ.connected ? 'Connected' : (integ.tokenExpired ? 'Token Expired' : 'Disconnected');
        var expiresDate = integ.expiresAt ? new Date(integ.expiresAt).toLocaleDateString() : '—';
        var html = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">';
        html += '<div style="flex:1;min-width:0;">';
        html += '<div style="font-weight:600;font-size:15px;color:#0f172a;">' + escapeHtml(clientName) + '</div>';
        html += '<div style="font-size:13px;color:#64748b;margin-top:4px;">';
        html += '<span style="color:' + statusColor + ';font-weight:600;">● ' + statusText + '</span>';
        if (integ.pageName) html += ' · FB: ' + escapeHtml(integ.pageName);
        if (integ.instagramUsername) html += ' · IG: @' + escapeHtml(integ.instagramUsername);
        html += '</div>';
        html += '<div style="font-size:12px;color:#94a3b8;margin-top:2px;">Token expires: ' + expiresDate + '</div>';
        html += '</div>';
        html += '<div style="display:flex;gap:8px;flex-shrink:0;">';
        html += '<button type="button" class="meta-settings-reconnect btn btn-primary" data-client-id="' + escapeHtml(integ.clientId) + '" style="padding:8px 16px;font-size:13px;border-radius:8px;">Reconnect</button>';
        html += '<button type="button" class="meta-settings-disconnect btn btn-secondary" data-client-id="' + escapeHtml(integ.clientId) + '" style="padding:8px 16px;font-size:13px;border-radius:8px;color:#dc2626;border-color:#fecaca;">Disconnect</button>';
        html += '</div></div>';
        card.innerHTML = html;
        container.appendChild(card);
      });
      // Bind reconnect and disconnect buttons
      container.querySelectorAll('.meta-settings-reconnect').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var cid = this.getAttribute('data-client-id');
          try {
            var authRes = await fetch(getApiBaseUrl() + '/api/auth/meta?clientId=' + encodeURIComponent(cid), { credentials: 'include' });
            var authJ = await authRes.json();
            if (authJ.authUrl) window.open(authJ.authUrl, 'meta_oauth', 'width=600,height=700');
          } catch (e) { console.error('Meta reconnect:', e); }
        });
      });
      container.querySelectorAll('.meta-settings-disconnect').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var cid = this.getAttribute('data-client-id');
          if (!confirm('Disconnect Meta for this client? You will need to reconnect to schedule posts.')) return;
          try {
            var dr = await fetch(getApiBaseUrl() + '/api/integrations/meta/disconnect', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
              body: JSON.stringify({ clientId: cid })
            });
            var dj = await dr.json();
            if (dj.success) { loadMetaIntegrationsList(); showToast('Meta disconnected for client', 'success'); }
          } catch (e) { console.error('Meta disconnect:', e); }
        });
      });
    } catch (e) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:#dc2626;">Error: ' + (e.message || 'Failed to load') + '</div>';
    }
  }

  window.loadUsersList = loadUsersList;
  window.loadClientsList = loadClientsList;
  window.loadMetaIntegrationsList = loadMetaIntegrationsList;
}

// Setup reports handlers
function setupReportsHandlers() {
  const openReportsAdmin = $('#openReportsAdmin');
  const reportsAdmin = $('#reportsAdmin');
  const reportsForm = $('#reportsForm');
  const cancelReports = $('#cancelReports');

  if (openReportsAdmin) {
    openReportsAdmin.addEventListener('click', () => {
    if (reportsAdmin) {
      reportsAdmin.style.display = reportsAdmin.style.display === 'none' ? 'block' : 'none';
      if (reportsAdmin.style.display === 'block') {
        // Load current values
        const r = loadReports();
        $('#repPeriod').value = r.period || '';
        $('#repAdsRunning').value = r.ads.running || '';
        $('#repImpressions').value = r.ads.impressions || '';
        $('#repClicks').value = r.ads.clicks || '';
        $('#repLeads').value = r.ads.leads || '';
        $('#repGmbViews').value = r.visibility.gmbViews || '';
        $('#repProfileSearches').value = r.visibility.profileSearches || '';
        $('#repWebsiteClicks').value = r.visibility.websiteClicks || '';
        $('#repIgFollowers').value = r.visibility.igFollowersDelta || '';
        $('#repPosts').value = r.work.posts || '';
        $('#repReels').value = r.work.reels || '';
        $('#repCampaigns').value = r.work.campaigns || '';
        $('#repRequests').value = r.work.requestsResolved || '';
      }
    }
    });
  }

  if (cancelReports) {
    cancelReports.addEventListener('click', () => {
      if (reportsAdmin) reportsAdmin.style.display = 'none';
    });
  }

  if (reportsForm) {
    reportsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = $('#repPin').value.trim();
    if (pin !== TEAM_PIN) {
      alert('Invalid PIN');
      return;
    }
    
    const cur = loadReports();
    const prev = JSON.parse(JSON.stringify(cur));
    const val = (id, f = 0) => {
      const v = document.getElementById(id).value.replace(/[, ]/g, '');
      return v ? parseInt(v) : f;
    };
    
    const next = {
      period: $('#repPeriod').value.trim() || cur.period,
      ads: {
        running: val('repAdsRunning', cur.ads.running),
        impressions: val('repImpressions', cur.ads.impressions),
        clicks: val('repClicks', cur.ads.clicks),
        leads: val('repLeads', cur.ads.leads)
      },
      visibility: {
        gmbViews: val('repGmbViews', cur.visibility.gmbViews),
        profileSearches: val('repProfileSearches', cur.visibility.profileSearches),
        websiteClicks: val('repWebsiteClicks', cur.visibility.websiteClicks),
        igFollowersDelta: val('repIgFollowers', cur.visibility.igFollowersDelta)
      },
      work: {
        posts: val('repPosts', cur.work.posts),
        reels: val('repReels', cur.work.reels),
        campaigns: val('repCampaigns', cur.work.campaigns),
        requestsResolved: val('repRequests', cur.work.requestsResolved)
      },
      prev
    };
    
    saveReports(next);
    if (reportsAdmin) reportsAdmin.style.display = 'none';
    
    // Log activity
    const state = load();
    if (!state.activity) state.activity = [];
    state.activity.push({
      when: Date.now(),
      text: `Report updated: ${next.period}`
    });
    save(state);

    renderReportsTab();
    render();
    });
  }
}

/* ================== Render All ================== */
function updateGlobalStatusSummary() {
  var elStatus = $('#headerSystemStatus');
  var elText = $('.header-status__text');
  var elDot = $('.header-status__dot');
  if (!elText) return;
  var summary = getGlobalStatusSummary();

  // Count total actions needed across all clients
  var totalActions = 0;
  var clients = loadClientsRegistry();
  Object.keys(clients).forEach(function(id) {
    var s = portalStateCache[id];
    if (s) {
      totalActions += (s.approvals || []).filter(function(a) { return !a.status || a.status === 'pending' || a.status === 'changes' || a.status === 'copy_pending'; }).length;
      totalActions += (s.requests || []).filter(function(r) { return !r.done; }).length;
      totalActions += (s.needs || []).filter(function(n) { return !n.done; }).length;
    }
  });

  if (totalActions > 0) {
    elText.innerHTML = '<strong>' + totalActions + '</strong> Actions Needed';
    if (elStatus) elStatus.style.background = 'rgba(239,68,68,0.2)';
  } else {
    elText.textContent = 'All Clear';
    if (elStatus) elStatus.style.background = 'rgba(255,255,255,0.1)';
  }

  if (elDot) {
    elDot.className = 'header-status__dot header-status__dot--' + summary.state.toLowerCase();
    if (totalActions > 10) elDot.style.background = '#ef4444';
    else if (totalActions > 0) elDot.style.background = '#f59e0b';
    else elDot.style.background = '#059669';
  }
  if (elStatus) elStatus.title = summary.text;
}

// ── Push Notifications ──
function initPushNotifications() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  // Wait a few seconds so the page loads first
  setTimeout(function() {
    navigator.serviceWorker.ready.then(function(reg) {
      // Check if already subscribed
      reg.pushManager.getSubscription().then(function(existingSub) {
        if (existingSub) {
          // Already subscribed, register with server (in case server lost it)
          registerPushWithServer(existingSub);
          return;
        }
        // Ask permission
        if (Notification.permission === 'granted') {
          subscribeToPush(reg);
        } else if (Notification.permission !== 'denied') {
          Notification.requestPermission().then(function(perm) {
            if (perm === 'granted') subscribeToPush(reg);
          });
        }
      });
    });
  }, 3000);
}

function subscribeToPush(reg) {
  fetch(getApiBaseUrl() + '/api/notifications/vapid-public-key', { credentials: 'include' })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      if (!d.publicKey) return;
      var key = urlBase64ToUint8Array(d.publicKey);
      return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
    })
    .then(function(sub) {
      if (sub) registerPushWithServer(sub);
    })
    .catch(function(e) { console.log('[push] Subscription failed:', e.message); });
}

function registerPushWithServer(sub) {
  fetch(getApiBaseUrl() + '/api/notifications/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ subscription: sub.toJSON() })
  }).catch(function() {});
}

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var raw = window.atob(base64);
  var arr = new Uint8Array(raw.length);
  for (var i = 0; i < raw.length; ++i) arr[i] = raw.charCodeAt(i);
  return arr;
}

function renderAll() {
  ensureScheduledTabExists();
  renderClientsSidebar();
  renderClientHeader();
  updateGlobalStatusSummary();
  renderNotificationBell();
  updateTabCountBadges();
  switchTab(currentTab);
  // Init push on first render
  if (!window.__pushInitDone) { window.__pushInitDone = true; initPushNotifications(); }
}

/* ================== Staff Header ================== */
function updateStaffHeader() {
  if (!currentStaff) return;
  
  const staffNameEl = $('#staffName');
  const staffAvatarEl = $('#staffAvatar');
  
  if (staffNameEl) {
    staffNameEl.textContent = currentStaff.name || currentStaff.fullName || currentStaff.username || 'Team Member';
  }
  
  if (staffAvatarEl) {
    // Get initials from name (from Register form / API), fullName, or username
    const name = currentStaff.name || currentStaff.fullName || currentStaff.username || 'TM';
    const initials = name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .substring(0, 2)
      .toUpperCase();
    staffAvatarEl.textContent = initials || 'TM';
  }
  
  // Setup logout button
  const logoutBtn = $('#logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to logout?')) {
        logout();
      }
    });
  }
}

/* ================== Image Upload ================== */
let uploadedImages = []; // Array of { name, dataUrl, size }
/** Selected asset IDs for the current post (from Approved Visuals or new upload). */
let postSelectedAssetIds = [];

// Compress image to reduce localStorage size
function compressImage(file, maxWidth = 1920, maxHeight = 1920, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Calculate new dimensions
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          } else {
            width = (width * maxHeight) / height;
            height = maxHeight;
          }
        }
        
        // Create canvas and compress
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to JPEG (smaller than PNG) with compression
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        
        resolve({
          name: file.name,
          dataUrl: compressedDataUrl,
          size: compressedDataUrl.length, // Approximate size
          type: 'image/jpeg',
          originalSize: file.size
        });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Setup image upload handlers
function setupImageUpload() {
  const fileInput = $('#approvalImageUpload');
  if (!fileInput) return;
  
  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    // Limit to 3 images max to prevent quota issues
    if (uploadedImages.length + files.length > 3) {
      showToast('Maximum 3 images allowed. Please remove some images first.', 'error');
      fileInput.value = '';
      return;
    }
    
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        showToast(`${file.name} is not an image file`, 'error');
        continue;
      }
      
      // Check file size (max 10MB before compression)
      if (file.size > 10 * 1024 * 1024) {
        showToast(`${file.name} is too large. Maximum size is 10MB.`, 'error');
        continue;
      }
      
      try {
        showToast(`Compressing ${file.name}...`, 'info');
        let compressed = await compressImage(file);

        if (compressed.size > 2 * 1024 * 1024) {
          const moreCompressed = await compressImage(file, 1600, 1600, 0.6);
          if (moreCompressed.size > 2 * 1024 * 1024) {
            showToast(`${file.name} is still too large after compression. Please use a smaller image.`, 'error');
            continue;
          }
          compressed = moreCompressed;
        }

        if (currentClientId) {
          var assetId = 'asset' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
          var uploadAsset = {
            id: assetId,
            title: file.name,
            sourceType: 'UPLOAD',
            sourceProvider: 'LOCAL_UPLOAD',
            url: compressed.dataUrl,
            mediaType: 'PHOTO',
            formatUse: 'ANY',
            pillars: [],
            approvalStatus: 'PENDING',
            clientNotes: '',
            internalNotes: ''
          };
          saveAsset(currentClientId, uploadAsset);
          postSelectedAssetIds.push(assetId);
          renderApprovedVisualsSection();
          updatePostFormFromAssets();
          var warnEl = $('#postUploadApprovalWarning');
          if (warnEl) warnEl.style.display = 'block';
          showToast(`${file.name} added; you can use it in posts.`, 'success');
        } else {
          uploadedImages.push(compressed);
          displayUploadedImages();
          showToast(`${file.name} uploaded successfully`, 'success');
        }
      } catch (error) {
        console.error('Error compressing image:', error);
        showToast(`Error processing ${file.name}`, 'error');
      }
    }
    
    // Reset input to allow selecting the same file again
    fileInput.value = '';
  });
}

const MAX_IMAGE_URLS = 10;

/** Return array of non-empty image URL strings from all .approval-image-url-input inputs. */
function getApprovalImageUrls() {
  var inputs = document.querySelectorAll('.approval-image-url-input');
  var urls = [];
  for (var i = 0; i < inputs.length; i++) {
    var v = (inputs[i].value || '').trim();
    if (v) urls.push(v);
  }
  return urls;
}

/** Render the list of image URL rows from an array of URL strings; keeps first input id="approvalImageUrl". */
function renderApprovalImageUrlRows(urls) {
  var container = $('#approvalImageUrlsContainer');
  if (!container) return;
  urls = Array.isArray(urls) ? urls : [];
  if (urls.length === 0) urls = [''];
  container.innerHTML = '';
  urls.forEach(function (url, index) {
    var row = document.createElement('div');
    row.className = 'approval-image-url-row';
    row.setAttribute('data-index', String(index));
    row.style.marginBottom = '12px';
    var input = document.createElement('input');
    input.type = 'url';
    input.className = 'form-input approval-image-url-input';
    input.placeholder = 'https://drive.google.com/file/d/…/view or direct image link';
    input.value = url || '';
    if (index === 0) input.id = 'approvalImageUrl';
    var previewWrap = document.createElement('div');
    previewWrap.className = 'approval-image-url-preview-wrap';
    previewWrap.style.cssText = 'display: none; margin-top: 8px;';
    var previewImg = document.createElement('img');
    previewImg.className = 'approval-image-url-preview-img';
    previewImg.style.cssText = 'max-width: 100%; max-height: 120px; border-radius: 8px; object-fit: contain; border: 1px solid #e2e8f0;';
    previewImg.alt = 'Preview';
    previewWrap.appendChild(previewImg);
    row.appendChild(input);
    row.appendChild(previewWrap);
    if (index > 0) {
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn--sm btn-secondary';
      removeBtn.style.marginTop = '4px';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', function () {
        row.remove();
        setupImageUrlPreviewForAll();
      });
      row.appendChild(removeBtn);
    }
    container.appendChild(row);
    bindImageUrlPreviewToInput(input, previewWrap, previewImg);
  });
  setupImageUrlPreviewForAll();
}

function bindImageUrlPreviewToInput(input, wrap, img) {
  if (!input || !wrap || !img) return;
  function refresh() {
    var url = (input.value || '').trim();
    if (!url) { wrap.style.display = 'none'; return; }
    var fallbacks = getDriveFallbackUrls(url);
    var idx = 0;
    img.onload = function () { wrap.style.display = 'block'; };
    img.onerror = function () {
      if (fallbacks && idx < fallbacks.length) {
        img.src = fallbacks[idx++];
      } else {
        wrap.style.display = 'none';
      }
    };
    if (fallbacks && fallbacks.length > 0) {
      idx = 1;
      img.src = fallbacks[0];
    } else {
      img.src = url;
    }
  }
  input.addEventListener('input', refresh);
  input.addEventListener('paste', function () { setTimeout(refresh, 50); });
  input.addEventListener('change', refresh);
  refresh();
}

function setupImageUrlPreviewForAll() {
  document.querySelectorAll('.approval-image-url-row').forEach(function (row) {
    var input = row.querySelector('.approval-image-url-input');
    var wrap = row.querySelector('.approval-image-url-preview-wrap');
    var img = row.querySelector('.approval-image-url-preview-img');
    if (input && wrap && img && !input._previewBound) {
      input._previewBound = true;
      bindImageUrlPreviewToInput(input, wrap, img);
    }
  });
}

function setupImageUrlPreview() {
  setupImageUrlPreviewForAll();
  var addBtn = $('#addApprovalImageUrlBtn');
  if (addBtn) {
    addBtn.onclick = function () {
      var inputs = document.querySelectorAll('.approval-image-url-input');
      if (inputs.length >= MAX_IMAGE_URLS) return;
      var container = $('#approvalImageUrlsContainer');
      if (!container) return;
      var row = document.createElement('div');
      row.className = 'approval-image-url-row';
      row.setAttribute('data-index', String(inputs.length));
      row.style.marginBottom = '12px';
      var input = document.createElement('input');
      input.type = 'url';
      input.className = 'form-input approval-image-url-input';
      input.placeholder = 'https://drive.google.com/file/d/…/view or direct image link';
      var previewWrap = document.createElement('div');
      previewWrap.className = 'approval-image-url-preview-wrap';
      previewWrap.style.cssText = 'display: none; margin-top: 8px;';
      var previewImg = document.createElement('img');
      previewImg.className = 'approval-image-url-preview-img';
      previewImg.style.cssText = 'max-width: 100%; max-height: 120px; border-radius: 8px; object-fit: contain; border: 1px solid #e2e8f0;';
      previewImg.alt = 'Preview';
      previewWrap.appendChild(previewImg);
      var removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn--sm btn-secondary';
      removeBtn.style.marginTop = '4px';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', function () {
        row.remove();
        setupImageUrlPreviewForAll();
      });
      row.appendChild(input);
      row.appendChild(previewWrap);
      row.appendChild(removeBtn);
      container.appendChild(row);
      bindImageUrlPreviewToInput(input, previewWrap, previewImg);
    };
  }
}

// Display uploaded images
function displayUploadedImages() {
  const previewContainer = $('#uploadedImagesPreview');
  const imagesList = $('#uploadedImagesList');
  
  if (!previewContainer || !imagesList) return;
  
  if (uploadedImages.length === 0) {
    previewContainer.style.display = 'none';
    return;
  }
  
  previewContainer.style.display = 'block';
  imagesList.innerHTML = '';
  
  uploadedImages.forEach((image, index) => {
    const imageWrapper = el('div', {
      class: 'uploaded-image-preview'
    });
    
    const img = el('img', {
      src: image.dataUrl,
      alt: image.name,
      style: 'width: 100%; height: 100%; object-fit: cover;'
    });
    
    const removeBtn = el('button', {
      class: 'remove-image',
      type: 'button',
      'aria-label': 'Remove image'
    });
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      uploadedImages = uploadedImages.filter((_, i) => i !== index);
      displayUploadedImages();
    });
    
    imageWrapper.appendChild(img);
    imageWrapper.appendChild(removeBtn);
    imagesList.appendChild(imageWrapper);
  });
}

/* ================== Onboarding UI ================== */
function setupOnboarding() {
  const ob = getOnboardingState();
  const overlay = $('#onboardingOverlay');
  if (!overlay) return;

  $('#onboardingStartSetup')?.addEventListener('click', () => {
    ob.step = 2;
    saveOnboardingState(ob);
    showOnboardingOverlay(2);
  });

  $('#onboardingStep2Back')?.addEventListener('click', () => {
    ob.step = 1;
    saveOnboardingState(ob);
    showOnboardingOverlay(1);
  });

  const form = $('#onboardingClientForm');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = $('#onboardingClientName')?.value?.trim();
      const email = $('#onboardingClientEmail')?.value?.trim();
      const password = $('#onboardingClientPassword')?.value;
      if (!name || !email || !password || password.length < 6) {
        showToast('Please fill client name, email, and password (min 6 characters)', 'error');
        return;
      }
      const clientId = generateClientId(name);
      const body = {
        id: clientId,
        name,
        category: 'Other',
        primaryContactName: name,
        primaryContactWhatsApp: '',
        primaryContactEmail: email,
        preferredChannel: 'portal',
        platformsManaged: ['instagram'],
        postingFrequency: '4x_week',
        approvalRequired: true,
        language: 'english',
        password
      };
      try {
        const r = await fetch(`${getApiBaseUrl()}/api/agency/clients`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Create failed');
        await fetchClientsFromAPI();
        await selectClient(clientId);
        ob.step = 3;
        ob.checklist.clients = Math.max(ob.checklist.clients || 0, Object.keys(loadClientsRegistry()).length);
        saveOnboardingState(ob);
        hideOnboardingOverlay();
        showOnboardingOverlay(3);
      } catch (err) {
        showToast(err.message || 'Failed to create client', 'error');
      }
    });
  }

  $('#onboardingStep3Back')?.addEventListener('click', () => {
    ob.step = 2;
    saveOnboardingState(ob);
    showOnboardingOverlay(2);
  });
  $('#onboardingStep3Next')?.addEventListener('click', () => {
    ob.step = 4;
    saveOnboardingState(ob);
    showOnboardingOverlay(4);
  });
  $$('.onboarding-checklist-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const focus = btn.getAttribute('data-focus');
      focusOnSection(focus);
      hideOnboardingOverlay();
    });
  });

  $('#onboardingStep4Back')?.addEventListener('click', () => {
    ob.step = 3;
    saveOnboardingState(ob);
    showOnboardingOverlay(3);
  });
  $('#onboardingStep4CreatePost')?.addEventListener('click', () => {
    hideOnboardingOverlay();
    switchTab('approvals');
    showToast('Use the form on the right to create your first post. Then click "Save" and set status to send for approval.');
  });

  $('#onboardingStep5Done')?.addEventListener('click', () => {
    ob.step = 6;
    saveOnboardingState(ob);
    showOnboardingOverlay(6);
  });

  $('#onboardingStep6Close')?.addEventListener('click', () => {
    ob.completed = true;
    ob.dismissedAt = Date.now();
    saveOnboardingState(ob);
    setHasSeenOnboarding();
    hideOnboardingOverlay();
    updateOnboardingChecklistSidebar();
  });
  $$('.onboarding-next-actions button').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      hideOnboardingOverlay();
      if (action === 'addClient') showNewClientModal();
      else if (action === 'assets') switchTab('contentlibrary');
      else if (action === 'contentLibrary') switchTab('contentlibrary');
      else if (action === 'reports') switchTab('reports');
    });
  });
}

function updateOnboardingChecklistSidebar() {
  const ob = getOnboardingState();
  const sidebar = document.getElementById('onboardingChecklistSidebar');
  if (!sidebar) return;
  const daysSince = (Date.now() - (ob.firstVisitAt || Date.now())) / (24 * 60 * 60 * 1000);
  if (ob.completed && ob.dismissedAt) {
    sidebar.style.display = 'none';
    return;
  }
  if (daysSince > ONBOARDING_SIDEBAR_DAYS) {
    sidebar.style.display = 'none';
    return;
  }
  const clients = loadClientsRegistry();
  const clientCount = (clients != null && typeof clients === 'object') ? Object.keys(clients).length : 0;
  let totalAssets = 0;
  let totalPosts = 0;
  let totalApprovals = 0;
  try {
    const clientIds = Object.keys(clients || {});
    clientIds.forEach(cid => { totalAssets += (loadAssets(cid) || []).length; });
    Object.keys(portalStateCache || {}).forEach(cid => {
      const s = portalStateCache[cid];
      if (s?.approvals) {
        totalPosts += s.approvals.length;
        totalApprovals += (s.approvals || []).filter(a => a.status === 'pending' || a.status === 'approved').length;
      }
    });
  } catch (_) {}
  const items = [
    { label: 'Add 3 clients', done: clientCount >= 3, action: () => { $('#newClientBtn')?.click(); } },
    { label: 'Upload 10 assets', done: totalAssets >= 10, action: () => { switchTab('contentlibrary'); } },
    { label: 'Create 5 posts', done: totalPosts >= 5, action: () => { switchTab('approvals'); } },
    { label: 'Send 3 approvals', done: totalApprovals >= 3, action: () => { switchTab('approvals'); } },
    { label: 'Invite a team member', done: ob.checklist?.invited, action: () => { $('#settingsBtn')?.click(); } }
  ];
  const allDone = items.every(i => i.done);
  if (allDone) {
    const state = getOnboardingState();
    state.completed = true;
    state.dismissedAt = Date.now();
    saveOnboardingState(state);
    sidebar.style.display = 'none';
    return;
  }
  sidebar.style.display = 'block';
  const list = $('#onboardingChecklistList');
  if (!list) return;
  list.innerHTML = '';
  items.forEach(({ label, done, action }) => {
    const li = el('li');
    const btn = el('button', { type: 'button', class: done ? 'done' : '' }, label);
    if (!done) btn.addEventListener('click', action);
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function checkOnboarding() {
  const clients = loadClientsRegistry();
  if (shouldAutoShowOnboarding(clients)) {
    showOnboardingOverlay(1);
    setHasSeenOnboarding();
  }
  updateOnboardingChecklistSidebar();
}

function setupPipelineModal() {
  $('#closePipelineModal')?.addEventListener('click', () => {
    $('#pipelineModal')?.classList.remove('show');
    setPipelineModalSeen();
  });
  $('#pipelineModalGotIt')?.addEventListener('click', () => {
    $('#pipelineModal')?.classList.remove('show');
    setPipelineModalSeen();
  });
}

function setupViewAsClient() {
  const btn = $('#viewAsClientBtn');
  const overlay = $('#viewAsClientOverlay');
  const closeBtn = $('#viewAsClientClose');
  const content = $('#viewAsClientContent');
  if (!btn || !overlay) return;
  btn.addEventListener('click', () => {
    overlay.style.display = 'flex';
    const state = load();
    const html = `
      <div style="max-width: 480px; margin: 0 auto; background: white; border-radius: 16px; padding: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.1);">
        <h3 style="color: #1e40af; margin-bottom: 16px;">Client Portal Preview</h3>
        <p style="color: #475569; margin-bottom: 16px;">This is a simplified preview of what your client sees when they log in.</p>
        <p style="font-size: 13px; color: #64748b;">Scheduled: ${(state.kpis?.scheduled || 0)} • Pending approval: ${(state.approvals || []).filter(a => !a.status || a.status === 'pending').length}</p>
      </div>`;
    content.innerHTML = html;
  });
  closeBtn?.addEventListener('click', () => { overlay.style.display = 'none'; });
}

function setupHelpLink() {
  $('#helpGettingStartedLink')?.addEventListener('click', (e) => {
    e.preventDefault();
    const ob = getOnboardingState();
    showOnboardingOverlay(ob.completed ? 1 : ob.step);
  });
}

function setupOverviewAddFirstClient() {
  $('#overviewAddFirstClientBtn')?.addEventListener('click', () => showNewClientModal());
}

function setupRequestMissingAssetsBtn() {
  $('#requestMissingAssetsBtn')?.addEventListener('click', () => {
    switchTab('needs');
  });
}

function setupContentLibraryLearnMore() {
  $('#contentLibraryLearnMore')?.addEventListener('click', (e) => {
    e.preventDefault();
    alert('Content Library stores photos, videos, and logos you upload. Use them when creating posts in Approvals. Supported types: image URLs, photos, videos, logos. You can tag assets for quick filtering.');
  });
}

/* ================== Production View (designer workflow) ================== */
async function loadDesigners() {
  const r = await fetch(getApiBaseUrl() + '/api/designers', { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Failed to load designers');
  designersCache = j.designers || [];
  return designersCache;
}
async function loadProductionTasks() {
  const r = await fetch(getApiBaseUrl() + '/api/production/tasks', { credentials: 'include' });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Failed to load tasks');
  productionTasksCache = j.tasks || [];
  return productionTasksCache;
}
function productionStatusBadgeLabel(task, designerName) {
  var name = designerName || 'Designer';
  switch (task.status) {
    case 'assigned': return 'In Production — Assigned to ' + name;
    case 'in_progress': return 'In Production — In Progress';
    case 'review': return 'In Production — Review';
    case 'changes_requested': return 'In Production — Changes Requested';
    case 'approved':
    case 'ready_to_post': return 'Art Approved — Ready to Post';
    default: return 'In Production';
  }
}
function productionStatusBadgeColor(status) {
  switch (status) {
    case 'assigned': return { bg: '#f1f5f9', color: '#475569' };
    case 'in_progress': return { bg: '#dbeafe', color: '#1d4ed8' };
    case 'review': return { bg: '#fef9c3', color: '#a16207' };
    case 'changes_requested': return { bg: '#ffedd5', color: '#c2410c' };
    case 'approved':
    case 'ready_to_post': return { bg: '#dcfce7', color: '#166534' };
    default: return { bg: '#f1f5f9', color: '#475569' };
  }
}
async function injectProductionBadgesOnApprovals(container) {
  if (!currentClientId) return;
  try {
    var r = await fetch(getApiBaseUrl() + '/api/production/tasks?clientId=' + encodeURIComponent(currentClientId), { credentials: 'include' });
    var j = await r.json();
    var tasks = (j && j.tasks) ? j.tasks : [];
    var designers = await loadDesigners();
    var designerMap = {};
    designers.forEach(function(d) { designerMap[d.id] = d.name || d.email || 'Designer'; });
    container.querySelectorAll('.approval-item[data-approval-id]').forEach(function(card) {
      var existing = card.querySelector('.approval-production-badge');
      if (existing) existing.remove();
      var approvalId = card.getAttribute('data-approval-id');
      var task = tasks.find(function(t) { return t.approvalId === approvalId; });
      if (!task) return;
      var designerName = designerMap[task.designerId] || 'Designer';
      var label = productionStatusBadgeLabel(task, designerName);
      var colors = productionStatusBadgeColor(task.status);
      var badge = document.createElement('div');
      badge.className = 'approval-production-badge';
      badge.style.cssText = 'margin-bottom: 8px; padding: 6px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; background: ' + colors.bg + '; color: ' + colors.color + ';';
      badge.textContent = label;
      card.insertBefore(badge, card.firstChild);
    });
  } catch (e) {}
}
function switchToProductionView() {
  currentViewMode = 'production';
  var sidebar = document.getElementById('dashboardSidebar');
  var main = document.getElementById('dashboardMain');
  var prod = document.getElementById('productionViewContainer');
  if (sidebar) sidebar.style.display = 'none';
  if (main) main.style.display = 'none';
  if (prod) prod.style.display = 'flex';
  if (document.getElementById('btnViewDashboard')) document.getElementById('btnViewDashboard').style.background = '#94a3b8';
  if (document.getElementById('btnViewProduction')) document.getElementById('btnViewProduction').style.background = '#1a56db';
  var btnD = document.getElementById('btnViewDashboardHeader');
  var btnP = document.getElementById('btnViewProductionHeader');
  if (btnD && btnP) { btnD.classList.remove('view-switch-btn--active'); btnP.classList.add('view-switch-btn--active'); }
  if (!productionNavBound) {
    productionNavBound = true;
    var navDemands = document.getElementById('productionNavDemands');
    var navMyTasks = document.getElementById('productionNavMyTasks');
    if (navDemands) {
      navDemands.addEventListener('click', function() {
        currentProductionSection = 'demands';
        demandFilterAssignee = '';
        document.querySelectorAll('.production-sidebar__link').forEach(function(l) { l.classList.remove('active'); });
        navDemands.classList.add('active');
        renderProductionView();
      });
    }
    if (navMyTasks) {
      navMyTasks.addEventListener('click', function() {
        currentProductionSection = 'demands';
        var myName = (currentStaff && (currentStaff.name || currentStaff.fullName || currentStaff.username || '')).trim();
        if (!myName) {
          showToast('Set your name on your profile to use My Tasks.', 'info');
          return;
        }
        demandFilterAssignee = demandFilterAssignee === myName ? '' : myName;
        demandFilterStatus = '';
        demandFilterDueToday = false;
        demandFilterOverdue = false;
        document.querySelectorAll('.production-sidebar__link').forEach(function(l) { l.classList.remove('active'); });
        if (demandFilterAssignee) navMyTasks.classList.add('active');
        else if (navDemands) navDemands.classList.add('active');
        renderProductionView();
      });
    }
    ['ai-library', 'references'].forEach(function(section) {
      var btn = document.getElementById('productionNav' + (section === 'ai-library' ? 'AILibrary' : 'References'));
      if (btn) btn.addEventListener('click', function() {
        currentProductionSection = section;
        document.querySelectorAll('.production-sidebar__link').forEach(function(l) { l.classList.remove('active'); });
        btn.classList.add('active');
        renderProductionView();
      });
    });
  }
  document.querySelectorAll('.production-sidebar__link').forEach(function(l) { l.classList.remove('active'); });
  var activeBtn = document.querySelector('.production-sidebar__link[data-section="' + currentProductionSection + '"]');
  if (activeBtn) activeBtn.classList.add('active');
  Promise.all([loadProductionTasks(), loadDesigners().catch(function() {})]).then(function() { renderProductionView(); }).catch(function(e) { showToast(e && e.message ? e.message : 'Failed to load', 'error'); });
}
function switchToDashboardView() {
  currentViewMode = 'dashboard';
  currentProductionTaskId = null;
  var sidebar = document.getElementById('dashboardSidebar');
  var main = document.getElementById('dashboardMain');
  var prod = document.getElementById('productionViewContainer');
  if (sidebar) sidebar.style.display = 'block';
  if (main) main.style.display = 'block';
  if (prod) prod.style.display = 'none';
  if (document.getElementById('btnViewDashboard')) document.getElementById('btnViewDashboard').style.background = '#1a56db';
  if (document.getElementById('btnViewProduction')) document.getElementById('btnViewProduction').style.background = 'white';
  var btnD = document.getElementById('btnViewDashboardHeader');
  var btnP = document.getElementById('btnViewProductionHeader');
  if (btnD && btnP) { btnD.classList.add('view-switch-btn--active'); btnP.classList.remove('view-switch-btn--active'); }
}
function priorityColor(p) {
  return { low: '#22c55e', medium: '#3b82f6', high: '#f97316', urgent: '#ef4444' }[p] || '#64748b';
}
function getFilteredDemands() {
  var tasks = productionTasksCache.slice();
  if (demandFilterStatus === 'todo') {
    tasks = tasks.filter(function(t) { return t.status === 'assigned'; });
  } else if (demandFilterStatus === 'in_progress') {
    tasks = tasks.filter(function(t) { return ['in_progress', 'changes_requested'].indexOf(t.status) !== -1; });
  } else if (demandFilterStatus === 'completed') {
    tasks = tasks.filter(function(t) { return ['review', 'approved', 'ready_to_post'].indexOf(t.status) !== -1; });
  }
  if (demandFilterClient) {
    tasks = tasks.filter(function(t) { return t.clientId === demandFilterClient; });
  }
  if (demandFilterDueToday) {
    var today = new Date().toISOString().slice(0, 10);
    tasks = tasks.filter(function(t) { return t.deadline && t.deadline.slice(0, 10) === today; });
  }
  var priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
  var now = new Date();
  tasks.sort(function(a, b) {
    var aOverdue = a.deadline && new Date(a.deadline) < now ? 0 : 1;
    var bOverdue = b.deadline && new Date(b.deadline) < now ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    var aDate = a.deadline ? new Date(a.deadline).getTime() : Infinity;
    var bDate = b.deadline ? new Date(b.deadline).getTime() : Infinity;
    if (aDate !== bDate) return aDate - bDate;
    return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
  });
  return tasks;
}
function getDemandStatusBadge(status) {
  var map = {
    assigned: { label: 'To Do', bg: '#e2e8f0', color: '#475569' },
    in_progress: { label: 'In Progress', bg: '#dbeafe', color: '#1d4ed8' },
    changes_requested: { label: 'In Progress', bg: '#dbeafe', color: '#1d4ed8' },
    review: { label: 'Completed', bg: '#dcfce7', color: '#16a34a' },
    approved: { label: 'Completed', bg: '#dcfce7', color: '#16a34a' },
    ready_to_post: { label: 'Completed', bg: '#dcfce7', color: '#16a34a' }
  };
  var s = map[status] || { label: status, bg: '#e2e8f0', color: '#475569' };
  return '<span style="display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; background: ' + s.bg + '; color: ' + s.color + ';">' + s.label + '</span>';
}
function getDemandStatusBadgeDark(status) {
  var map = {
    assigned: { label: 'To do', bg: '#e2e8f0', color: '#475569' },
    in_progress: { label: 'In Progress', bg: '#dbeafe', color: '#1d4ed8' },
    changes_requested: { label: 'Changes Requested', bg: '#fee2e2', color: '#dc2626' },
    review: { label: 'In Review', bg: '#e0e7ff', color: '#4338ca' },
    approved: { label: 'Approved', bg: '#dcfce7', color: '#16a34a' },
    ready_to_post: { label: 'Ready to Post', bg: '#dcfce7', color: '#16a34a' }
  };
  var s = map[status] || { label: status, bg: '#e2e8f0', color: '#475569' };
  return '<span class="status-badge production-status-badge" style="display:inline-block;padding:4px 10px;border-radius:9999px;font-size:13px;font-weight:600;background:' + (s.bg || '#e2e8f0') + ';color:' + (s.color || '#475569') + ';">' + (s.label || status).replace(/</g, '&lt;') + '</span>';
}
function getWorkspaceStatusBadge(status) {
  var map = {
    assigned: { label: 'To Do', bg: '#e2e8f0', color: '#475569' },
    in_progress: { label: 'In Progress', bg: '#dbeafe', color: '#1d4ed8' },
    changes_requested: { label: 'Changes Requested', bg: '#ffedd5', color: '#ea580c' },
    review: { label: 'In Review', bg: '#e0e7ff', color: '#4338ca' },
    approved: { label: 'Approved', bg: '#dcfce7', color: '#16a34a' },
    ready_to_post: { label: 'Ready to Post', bg: '#dcfce7', color: '#16a34a' }
  };
  var s = map[status] || { label: status, bg: '#e2e8f0', color: '#475569' };
  return '<span style="display:inline-block;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:600;background:' + s.bg + ';color:' + s.color + ';">' + (s.label || status).replace(/</g, '&lt;') + '</span>';
}
function getCommentStatusChangeLabel(statusChange) {
  var map = { in_progress: 'Started working', review: 'Submitted for review', changes_requested: 'Requested changes', approved: 'Approved \u2713', ready_to_post: 'Marked as ready to post' };
  return map[statusChange] || statusChange || '';
}
function formatCommentTime(isoStr) {
  if (!isoStr) return '';
  var d = new Date(isoStr);
  var month = d.toLocaleDateString('en-US', { month: 'short' });
  var day = d.getDate();
  var time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return month + ' ' + day + ', ' + time;
}
function openTaskDetailPanel(taskId) {
  var task = productionTasksCache.find(function(t) { return t.id === taskId; });
  if (!task) return;
  var clientsData = loadClientsRegistry();
  var clientName = (clientsData && clientsData[task.clientId] && clientsData[task.clientId].name) || task.clientId || '—';
  var title = (task.caption || task.briefNotes || 'Untitled demand').replace(/</g, '&lt;').slice(0, 120);
  var dueStr = task.deadline ? new Date(task.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
  var designerName = (designersCache.find(function(d) { return d.id === task.designerId; }) || {}).name || task.designerId || '—';
  var initial = (designerName + '').charAt(0).toUpperCase();
  var titleEl = document.getElementById('productionTaskDetailTitle');
  var metaEl = document.getElementById('productionTaskDetailMeta');
  var descEl = document.getElementById('productionTaskDetailDescription');
  if (titleEl) titleEl.textContent = title || 'Untitled';
  var statusBadgeMap = { assigned: { cls: 'status-badge--todo', label: 'To do' }, in_progress: { cls: 'status-badge--in_progress', label: 'In Progress' }, changes_requested: { cls: 'status-badge--changes_requested', label: 'Changes Requested' }, review: { cls: 'status-badge--review', label: 'Review' }, approved: { cls: 'status-badge--approved', label: 'Approved' }, ready_to_post: { cls: 'status-badge--ready_to_post', label: 'Ready to Post' } };
  var statusInfo = statusBadgeMap[task.status] || { cls: 'status-badge--todo', label: task.status || 'To do' };
  if (metaEl) {
    metaEl.innerHTML = '<div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px;">' +
      '<span class="status-badge ' + statusInfo.cls + '" style="display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;">' + (statusInfo.label || task.status).replace(/</g, '&lt;') + '</span>' +
      '</div><div style="font-size: 13px; color: #64748b; margin-bottom: 4px;">Client: <strong style="color: #1e293b;">' + (clientName + '').replace(/</g, '&lt;') + '</strong></div>' +
      '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;"><span style="width: 24px; height: 24px; border-radius: 50%; background: #e2e8f0; color: #475569; font-size: 11px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center;">' + initial + '</span><span style="font-size: 13px; color: #334155;">' + (designerName + '').replace(/</g, '&lt;') + '</span></div>' +
      '<div style="font-size: 13px; color: #64748b;">Due: ' + dueStr + '</div>';
  }
  if (descEl) descEl.value = [task.caption || '', task.briefNotes || ''].filter(Boolean).join('\n\n') || '';
  var overlay = document.getElementById('productionTaskDetailOverlay');
  var panel = document.getElementById('productionTaskDetailPanel');
  if (overlay) overlay.style.display = 'block';
  if (panel) panel.style.display = 'block';
  currentProductionTaskId = taskId;
  if (!window.__productionPanelCloseBound) {
    window.__productionPanelCloseBound = true;
    var closeBtn = document.getElementById('productionTaskDetailClose');
    if (closeBtn) closeBtn.addEventListener('click', closeTaskDetailPanel);
    if (overlay) overlay.addEventListener('click', closeTaskDetailPanel);
  }
}
function closeTaskDetailPanel() {
  var overlay = document.getElementById('productionTaskDetailOverlay');
  var panel = document.getElementById('productionTaskDetailPanel');
  if (overlay) overlay.style.display = 'none';
  if (panel) panel.style.display = 'none';
  currentProductionTaskId = null;
}
function groupTasksByPeriod(tasks) {
  var now = new Date();
  var y = now.getFullYear(), m = now.getMonth();
  var startThisMonth = new Date(y, m, 1).getTime();
  var endThisMonth = new Date(y, m + 1, 0).getTime();
  var startNextMonth = new Date(y, m + 1, 1).getTime();
  var endNextMonth = new Date(y, m + 2, 0).getTime();
  var overdue = [], thisMonth = [], nextMonth = [], later = [];
  tasks.forEach(function(t) {
    var due = t.deadline ? new Date(t.deadline).getTime() : null;
    if (due !== null && due < startThisMonth) overdue.push(t);
    else if (due !== null && due >= startThisMonth && due <= endThisMonth) thisMonth.push(t);
    else if (due !== null && due >= startNextMonth && due <= endNextMonth) nextMonth.push(t);
    else later.push(t);
  });
  return [
    { label: 'Overdue', tasks: overdue },
    { label: 'This month', tasks: thisMonth },
    { label: 'Next month', tasks: nextMonth },
    { label: 'Later', tasks: later }
  ];
}
function renderProductionWorkspace(task, clientsData, designerMap) {
  var clientName = (clientsData && clientsData[task.clientId] && clientsData[task.clientId].name) || task.clientId || '—';
  var title = (task.caption || task.briefNotes || 'Untitled demand').replace(/</g, '&lt;');
  var dueStr = task.deadline ? (function() { var d = new Date(task.deadline); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); })() : '—';
  var now = new Date();
  var isOverdue = task.deadline && new Date(task.deadline) < now && ['review', 'approved', 'ready_to_post'].indexOf(task.status) === -1;
  var designerName = designerMap[task.designerId] || (currentStaff && task.designerId === currentStaff.id ? (currentStaff.name || currentStaff.fullName || currentStaff.username || 'You') : null) || task.designerId || '—';
  var priorityColors = { low: '#22c55e', medium: '#3b82f6', high: '#f97316', urgent: '#ef4444' };
  var priorityDot = priorityColors[task.priority] || '#64748b';
  var isAssignedDesigner = isDesigner && currentStaff && task.designerId === currentStaff.id;
  var isManager = !isDesigner;
  var hasArt = task.finalArt && task.finalArt.length > 0;
  var refs = task.referenceImages && task.referenceImages.length ? task.referenceImages : [];

  var html = '<div class="production-workspace-wrap">';
  html += '<a href="#" id="productionTaskDetailBack" class="workspace-back">← Back to Demands</a>';
  html += '<div class="workspace-header">';
  html += '<div><h1 class="workspace-title" style="font-size: 24px; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 12px 0; color: #1e293b;">' + title + '</h1>';
  html += '<div class="workspace-meta" style="display: flex; flex-wrap: wrap; gap: 16px; align-items: center; font-size: 13px; color: #64748b;">';
  html += '<span><strong style="color: #475569;">Client</strong> ' + (clientName + '').replace(/</g, '&lt;') + '</span>';
  html += '<span><strong style="color: #475569;">Due</strong> <span style="color:' + (isOverdue ? '#dc2626' : '#334155') + ';">' + dueStr + (isOverdue ? ' (overdue)' : '') + '</span></span>';
  html += '<span style="display:inline-flex;align-items:center;gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:' + priorityDot + ';"></span> <strong style="color: #475569;">' + (task.priority || 'medium') + '</strong></span>';
  html += '<span><strong style="color: #475569;">Assigned to</strong> ' + (designerName + '').replace(/</g, '&lt;') + '</span></div></div>';
  html += '<div class="workspace-header-badge">' + getWorkspaceStatusBadge(task.status) + '</div></div>';

  html += '<div class="workspace-body">';
  html += '<div class="workspace-left">';
  html += '<div class="creative-brief"><h2 class="section-title">Creative Brief</h2>';
  var briefCopyText = task.copyText && task.copyText.trim() ? task.copyText : (task.caption && task.caption.trim() ? task.caption : '');
  html += '<div class="copy-text-box">' + (briefCopyText ? briefCopyText.replace(/</g, '&lt;').replace(/\n/g, '<br>') : 'No copy text provided.') + '</div>';
  html += '<p class="instructions-text" style="margin:0 0 8px 0;font-weight:600;color:#1e293b;">Instructions</p>';
  html += '<p class="instructions-text">' + (task.briefNotes && task.briefNotes.trim() ? (task.briefNotes || '').replace(/</g, '&lt;').replace(/\n/g, '<br>') : 'No additional instructions.') + '</p></div>';
  // Deduplicate and filter empty refs
  var uniqueRefs = refs.filter(function(url, i) { return url && url.trim() && refs.indexOf(url) === i; });
  html += '<div class="references-section"><h2 class="section-title">Design from Post' + (uniqueRefs.length ? ' (' + uniqueRefs.length + ')' : '') + '</h2>';
  if (uniqueRefs.length === 0) html += '<p style="margin:0;font-size:14px;color:#64748b;">No design images attached.</p>';
  else {
    html += '<div class="reference-grid">';
    uniqueRefs.forEach(function(url) {
      var safeUrl = (url || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
      html += '<div><a href="' + safeUrl + '" target="_blank" rel="noopener" class="reference-thumb-wrap"><img src="' + safeUrl + '" alt="Design" class="reference-thumb" onerror="this.style.display=\'none\'"></a><a href="' + safeUrl + '" download class="reference-save" style="display:inline-flex;align-items:center;gap:4px;font-size:12px;color:#2563eb;margin-top:6px;">↓ Save</a></div>';
    });
    html += '</div>';
  }
  html += '</div></div>';

  html += '<div class="workspace-right"><div class="upload-section">';
  if (task.status === 'review' && isManager) {
    html += '<h2 class="section-title">Design Upload</h2>';
    if (hasArt) {
      if (task.finalArt.length > 1) html += '<span style="font-size:12px;color:#7c3aed;font-weight:600;background:#f5f3ff;padding:3px 10px;border-radius:12px;margin-bottom:10px;display:inline-block;">Carousel (' + task.finalArt.length + ' slides)</span>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-bottom:12px;">';
      task.finalArt.forEach(function(url, i) {
        var safe = (url || '').replace(/"/g, '&quot;');
        html += '<div style="position:relative;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;aspect-ratio:4/5;background:#f1f5f9;">';
        html += mediaTag(url, 'Image ' + (i + 1), 'width:100%;height:100%;object-fit:contain;');
        if (task.finalArt.length > 1) html += '<span style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,0.6);color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;">' + (i + 1) + '</span>';
        html += '</div>';
      });
      html += '</div>';
      html += '<div style="margin-top:12px;"><button type="button" class="workspace-btn workspace-btn-approve" data-id="' + task.id + '">Approve</button> <button type="button" class="workspace-btn workspace-btn-request-changes" data-id="' + task.id + '">Request Changes</button></div>';
    } else html += '<p style="color:#64748b;">No art submitted yet.</p>';
  } else if (task.status === 'review' && isAssignedDesigner) {
    html += '<h2 class="section-title">Your Design</h2>';
    if (hasArt) {
      if (task.finalArt.length > 1) html += '<span style="font-size:12px;color:#7c3aed;font-weight:600;background:#f5f3ff;padding:3px 10px;border-radius:12px;margin-bottom:10px;display:inline-block;">Carousel (' + task.finalArt.length + ' slides)</span>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;">';
      task.finalArt.forEach(function(url, i) {
        var safe = (url || '').replace(/"/g, '&quot;');
        html += '<div style="position:relative;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;aspect-ratio:4/5;background:#f1f5f9;">';
        html += mediaTag(url, 'Image ' + (i + 1), 'width:100%;height:100%;object-fit:contain;');
        if (task.finalArt.length > 1) html += '<span style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,0.6);color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;">' + (i + 1) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '<p style="margin-top:12px;color:#64748b;">Submitted for review. Waiting for feedback.</p>';
  } else if ((task.status === 'approved' || task.status === 'ready_to_post') && hasArt) {
    html += '<h2 class="section-title">Design</h2>';
    if (task.finalArt.length > 1) html += '<span style="font-size:12px;color:#7c3aed;font-weight:600;background:#f5f3ff;padding:3px 10px;border-radius:12px;margin-bottom:10px;display:inline-block;">Carousel (' + task.finalArt.length + ' slides)</span>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;">';
    task.finalArt.forEach(function(url, i) {
      var safe = (url || '').replace(/"/g, '&quot;');
      html += '<div style="position:relative;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;aspect-ratio:4/5;background:#f1f5f9;">';
      html += mediaTag(url, 'Image ' + (i + 1), 'width:100%;height:100%;object-fit:contain;');
      if (task.finalArt.length > 1) html += '<span style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,0.6);color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;">' + (i + 1) + '</span>';
      html += '</div>';
    });
    html += '</div>';
    html += '<span style="display:inline-block;margin-top:12px;padding:6px 14px;border-radius:9999px;font-size:13px;font-weight:600;background:#dcfce7;color:#16a34a;">✓ Approved</span>';
  } else if (task.status === 'assigned' && isAssignedDesigner) {
    html += '<h2 class="section-title">Design Upload</h2>';
    html += '<p style="color:#64748b;margin-bottom:12px;">Start working on this task first.</p>';
    html += '<button type="button" class="workspace-btn workspace-btn-primary workspace-btn-start" data-id="' + task.id + '">Start Working</button>';
  } else if ((task.status === 'in_progress' || task.status === 'changes_requested') && isAssignedDesigner) {
    html += '<h2 class="section-title">Design Upload / Preview</h2>';
    if (task.reviewNotes && task.reviewNotes.trim()) {
      var isClientChange = task.reviewNotes.indexOf('Client change request:') === 0;
      var feedbackBg = isClientChange ? '#fff7ed' : '#fef3c7';
      var feedbackBorder = isClientChange ? '#fb923c' : '#fcd34d';
      var feedbackColor = isClientChange ? '#9a3412' : '#92400e';
      var feedbackLabel = isClientChange ? '<strong style="display:block;margin-bottom:4px;color:#c2410c;">CHANGE REQUEST FROM CLIENT:</strong>' : '';
      html += '<div class="review-feedback" style="background:' + feedbackBg + ';border:1px solid ' + feedbackBorder + ';border-left:4px solid ' + feedbackBorder + ';border-radius:8px;padding:12px;margin-bottom:16px;font-size:14px;color:' + feedbackColor + ';">' + feedbackLabel + (task.reviewNotes || '').replace(/^Client change request: /, '').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div>';
    }
    var artCount = hasArt ? task.finalArt.length : 0;
    var maxImages = 5;
    var canAddMore = artCount < maxImages;
    // Image counter
    html += '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">';
    html += '<span style="font-size:13px;color:#64748b;font-weight:500;">Media: <strong style="color:' + (artCount >= maxImages ? '#dc2626' : '#1e40af') + ';">' + artCount + '/' + maxImages + '</strong></span>';
    if (artCount > 1) html += '<span style="font-size:12px;color:#7c3aed;font-weight:600;background:#f5f3ff;padding:3px 10px;border-radius:12px;">Carousel (' + artCount + ' slides)</span>';
    html += '</div>';
    // Upload drop zone (show if can add more)
    if (canAddMore) {
      html += '<div class="upload-drop-zone" id="workspaceDropZone' + task.id + '" style="' + (hasArt ? 'padding:16px;min-height:auto;' : '') + '"><input type="file" id="workspaceFileInput' + task.id + '" accept="image/jpeg,image/png,video/mp4,video/quicktime,video/webm" multiple style="display:none;"><div class="upload-drop-content">' + (hasArt ? '<p style="margin:0;font-size:13px;">+ Add more files <span style="color:#94a3b8;">(' + (maxImages - artCount) + ' remaining)</span></p>' : '<span style="font-size:32px;">📁</span><p>Drop files here or click to browse</p><p style="font-size:12px;color:#94a3b8;">JPG, PNG, MP4, MOV, WebM · Up to ' + maxImages + ' files for carousel</p>') + '</div></div>';
    }
    // Image grid
    if (hasArt) {
      html += '<div class="upload-image-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:12px;">';
      task.finalArt.forEach(function(url, i) {
        var safe = (url || '').replace(/"/g, '&quot;');
        html += '<div style="position:relative;border-radius:10px;overflow:hidden;border:2px solid #e2e8f0;aspect-ratio:4/5;background:#f1f5f9;">';
        html += mediaTag(url, 'Image ' + (i + 1), 'width:100%;height:100%;object-fit:contain;');
        html += '<span style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,0.6);color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;">' + (i + 1) + '</span>';
        html += '<button type="button" class="workspace-remove-image" data-task-id="' + task.id + '" data-index="' + i + '" style="position:absolute;top:4px;right:4px;width:24px;height:24px;border-radius:50%;background:rgba(239,68,68,0.9);color:#fff;border:none;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;line-height:1;">&times;</button>';
        html += '</div>';
      });
      html += '</div>';
      if (!canAddMore) {
        html += '<input type="file" id="workspaceFileInput' + task.id + '" accept="image/jpeg,image/png,video/mp4,video/quicktime,video/webm" multiple style="display:none;">';
      }
      html += '<div style="display:flex;gap:8px;margin-top:12px;">';
      html += '<button type="button" class="workspace-btn workspace-btn-replace" data-id="' + task.id + '" style="flex:1;">Replace All</button>';
      html += '</div>';
      html += '<button type="button" class="workspace-btn workspace-btn-primary workspace-btn-submit-review" data-id="' + task.id + '" style="width:100%;margin-top:16px;">Submit for Review ▶</button>';
    }
  } else {
    html += '<h2 class="section-title">Design Upload</h2>';
    if (hasArt) {
      if (task.finalArt.length > 1) html += '<span style="font-size:12px;color:#7c3aed;font-weight:600;background:#f5f3ff;padding:3px 10px;border-radius:12px;margin-bottom:10px;display:inline-block;">Carousel (' + task.finalArt.length + ' slides)</span>';
      html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;margin-top:8px;">';
      task.finalArt.forEach(function(url, i) {
        var safe = (url || '').replace(/"/g, '&quot;');
        html += '<div style="position:relative;border-radius:10px;overflow:hidden;border:1px solid #e2e8f0;aspect-ratio:4/5;background:#f1f5f9;">';
        html += mediaTag(url, 'Image ' + (i + 1), 'width:100%;height:100%;object-fit:contain;');
        if (task.finalArt.length > 1) html += '<span style="position:absolute;top:6px;left:6px;background:rgba(0,0,0,0.6);color:#fff;font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;">' + (i + 1) + '</span>';
        html += '</div>';
      });
      html += '</div>';
    } else html += '<p style="color:#64748b;">No design uploaded yet.</p>';
  }
  html += '</div></div></div>';

  var comments = task.comments && Array.isArray(task.comments) ? task.comments : [];
  html += '<div class="feedback-section" id="workspaceFeedbackSection' + task.id + '"><h2 class="section-title">Review &amp; Feedback</h2>';
  if (task.status === 'review' && isManager) {
    html += '<div class="feedback-review-actions" style="margin-bottom: 20px; padding: 16px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px;"><p class="feedback-review-p" style="margin: 0 0 12px 0; font-weight: 600; color: #166534;">This task is ready for your review.</p>';
    html += '<button type="button" class="workspace-btn workspace-btn-approve-comment" data-id="' + task.id + '" style="background: #16a34a; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer; margin-right: 8px;">✓ Approve</button>';
    html += '<button type="button" class="workspace-btn workspace-btn-request-changes-comment" data-id="' + task.id + '" style="background: #ea580c; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-weight: 600; cursor: pointer;">✎ Request Changes</button></div>';
  }
  if (comments.length === 0) {
    html += '<p class="feedback-empty">No feedback yet. Comments and review notes will appear here.</p>';
  } else {
    comments.forEach(function(c) {
      var roleLabel = c.authorRole === 'designer' ? 'Designer' : 'Agency';
      var cardClass = 'comment-card from-' + (c.authorRole === 'designer' ? 'designer' : 'agency');
      var safeMsg = (c.message || '').replace(/</g, '&lt;').replace(/\n/g, '<br>');
      var timeStr = formatCommentTime(c.createdAt);
      var statusLabel = c.statusChange ? getCommentStatusChangeLabel(c.statusChange) : '';
      html += '<div class="' + cardClass + '"><div class="comment-header"><span class="comment-author">' + (c.authorName || 'User').replace(/</g, '&lt;') + ' <span class="comment-role">(' + roleLabel + ')</span></span><span class="comment-time">' + timeStr + '</span></div>';
      html += '<div class="comment-body">' + safeMsg + '</div>';
      if (statusLabel) html += '<div class="comment-status-change">Status changed: ' + statusLabel + '</div>';
      html += '</div>';
    });
  }
  html += '<div class="comment-input-row"><textarea id="workspaceCommentInput' + task.id + '" placeholder="Type your feedback..." rows="2" class="comment-input-textarea"></textarea>';
  html += '<button type="button" class="btn-send-comment" data-id="' + task.id + '">Send</button></div></div>';

  html += '</div>';
  return html;
}
function bindWorkspaceEvents(container, task) {
  var taskId = task.id;
  var backLink = container.querySelector('#productionTaskDetailBack');
  if (backLink) backLink.addEventListener('click', function(e) { e.preventDefault(); currentProductionTaskId = null; renderProductionView(); });

  function postCommentAndRefresh(message, statusChange) {
    var body = { message: message || '' };
    if (statusChange) body.statusChange = statusChange;
    return fetch(getApiBaseUrl() + '/api/production/tasks/' + taskId + '/comment', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function(r) { return r.json(); })
      .then(function(j) { if (!j.task) throw new Error(j.error || 'Failed'); return loadProductionTasks(); })
      .then(function() { renderProductionView(); });
  }

  var startBtn = container.querySelector('.workspace-btn-start[data-id="' + taskId + '"]');
  if (startBtn) startBtn.addEventListener('click', function() {
    postCommentAndRefresh('Started working on this task', 'in_progress').then(function() { showToast('Started working'); }).catch(function(e) { showToast(e.message || 'Failed', 'error'); });
  });

  var submitBtn = container.querySelector('.workspace-btn-submit-review[data-id="' + taskId + '"]');
  if (submitBtn) submitBtn.addEventListener('click', function() {
    var msg = task.status === 'changes_requested' ? 'Resubmitted with changes' : 'Submitted design for review';
    postCommentAndRefresh(msg, 'review').then(function() { showToast('Submitted for review'); }).catch(function(e) { showToast(e.message || 'Failed', 'error'); });
  });

  var approveBtn = container.querySelector('.workspace-btn-approve[data-id="' + taskId + '"]');
  if (approveBtn) approveBtn.addEventListener('click', function() {
    postCommentAndRefresh('Approved', 'approved').then(function() {
      showToast('Design approved! Sent to client approvals for review.');
      // Notify client that new content is ready
      var task = productionTasksCache.find(function(t) { return t.id === taskId; });
      if (task && task.clientId) {
        fetch(getApiBaseUrl() + '/api/notifications/notify-client', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ clientId: task.clientId, type: 'content_ready', postTitle: task.title || task.caption || 'New design' })
        }).catch(function() {});
      }
    }).catch(function(e) { showToast(e.message || 'Failed', 'error'); });
  });

  var approveCommentBtn = container.querySelector('.workspace-btn-approve-comment[data-id="' + taskId + '"]');
  if (approveCommentBtn) approveCommentBtn.addEventListener('click', function() {
    postCommentAndRefresh('Approved', 'approved').then(function() {
      showToast('Design approved! Sent to client approvals for review.');
      var task = productionTasksCache.find(function(t) { return t.id === taskId; });
      if (task && task.clientId) {
        fetch(getApiBaseUrl() + '/api/notifications/notify-client', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
          body: JSON.stringify({ clientId: task.clientId, type: 'content_ready', postTitle: task.title || task.caption || 'New design' })
        }).catch(function() {});
      }
    }).catch(function(e) { showToast(e.message || 'Failed', 'error'); });
  });

  var requestChangesBtn = container.querySelector('.workspace-btn-request-changes[data-id="' + taskId + '"]');
  if (requestChangesBtn) requestChangesBtn.addEventListener('click', function() {
    var notes = prompt('Describe what changes are needed...');
    if (notes === null) return;
    postCommentAndRefresh(notes.trim() || 'Requested changes', 'changes_requested').then(function() { showToast('Changes requested'); }).catch(function(e) { showToast(e.message || 'Failed', 'error'); });
  });

  var requestChangesCommentBtn = container.querySelector('.workspace-btn-request-changes-comment[data-id="' + taskId + '"]');
  if (requestChangesCommentBtn) requestChangesCommentBtn.addEventListener('click', function() {
    var textarea = document.getElementById('workspaceCommentInput' + taskId);
    if (textarea) { textarea.placeholder = 'Describe what changes are needed...'; textarea.focus(); }
    var notes = prompt('Describe what changes are needed...');
    if (notes === null) return;
    postCommentAndRefresh(notes.trim() || 'Requested changes', 'changes_requested').then(function() { showToast('Changes requested'); }).catch(function(e) { showToast(e.message || 'Failed', 'error'); });
  });

  var sendCommentBtn = container.querySelector('.btn-send-comment[data-id="' + taskId + '"]');
  var commentInput = document.getElementById('workspaceCommentInput' + taskId);
  if (sendCommentBtn && commentInput) {
    sendCommentBtn.addEventListener('click', function() {
      var msg = (commentInput.value || '').trim();
      if (!msg) return;
      sendCommentBtn.disabled = true;
      postCommentAndRefresh(msg, null).then(function() {
        var section = document.getElementById('workspaceFeedbackSection' + taskId);
        if (section) section.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }).catch(function(e) { showToast(e.message || 'Failed', 'error'); }).finally(function() { sendCommentBtn.disabled = false; });
    });
  }

  var replaceBtn = container.querySelector('.workspace-btn-replace[data-id="' + taskId + '"]');
  if (replaceBtn) replaceBtn.addEventListener('click', function() {
    fetch(getApiBaseUrl() + '/api/production/tasks/' + taskId + '/upload-art', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: [] }) })
      .then(function(r) { return r.json(); }).then(function(j) { if (!j.task) throw new Error(j.error || 'Failed'); return loadProductionTasks(); }).then(function() { renderProductionView(); }).catch(function(e) { showToast(e.message || 'Failed', 'error'); });
  });

  // Remove individual image buttons
  var removeImageBtns = container.querySelectorAll('.workspace-remove-image[data-task-id="' + taskId + '"]');
  removeImageBtns.forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var idx = parseInt(btn.getAttribute('data-index'), 10);
      removeWorkspaceImage(taskId, idx);
    });
  });

  var fileInput = document.getElementById('workspaceFileInput' + taskId);

  var dropZone = document.getElementById('workspaceDropZone' + taskId);
  if (dropZone && fileInput) {
    dropZone.addEventListener('click', function() { fileInput.click(); });
    dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('upload-drop-zone--over'); });
    dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('upload-drop-zone--over'); });
    dropZone.addEventListener('drop', function(e) {
      e.preventDefault();
      dropZone.classList.remove('upload-drop-zone--over');
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) runWorkspaceUpload(taskId, files, dropZone);
    });
  }
  if (fileInput) fileInput.addEventListener('change', function() {
    var files = fileInput.files;
    if (!files || !files.length) return;
    runWorkspaceUpload(taskId, files, dropZone || fileInput.parentElement);
    fileInput.value = '';
  });

  var thumbs = container.querySelectorAll('.upload-thumb-btn');
  var mainPreview = document.getElementById('workspaceMainPreview' + taskId);
  thumbs.forEach(function(btn) {
    btn.addEventListener('click', function() {
      var url = btn.getAttribute('data-url');
      if (mainPreview && url) mainPreview.src = url;
      thumbs.forEach(function(b) { b.style.borderColor = '#e2e8f0'; });
      btn.style.borderColor = '#1a56db';
    });
  });
}
function removeWorkspaceImage(taskId, index) {
  var task = productionTasksCache.find(function(t) { return t.id === taskId; });
  if (!task || !task.finalArt || !task.finalArt.length) return;
  var updatedUrls = task.finalArt.slice();
  updatedUrls.splice(index, 1);
  fetch(getApiBaseUrl() + '/api/production/tasks/' + taskId + '/upload-art', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: updatedUrls }) })
    .then(function(r) { return r.json(); }).then(function(j) {
      if (!j.task) throw new Error(j.error || 'Failed');
      return loadProductionTasks();
    }).then(function() { renderProductionView(); showToast('Image removed'); }).catch(function(e) { showToast(e.message || 'Failed to remove', 'error'); });
}

var ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'video/mp4', 'video/quicktime', 'video/webm', 'video/mov'];
var MAX_VIDEO_SIZE = 100 * 1024 * 1024; // 100MB
var MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

function isVideoUrl(url) {
  if (!url || typeof url !== 'string') return false;
  var lower = url.toLowerCase();
  return lower.match(/\.(mp4|mov|webm|avi)(\?|$)/) !== null || lower.indexOf('video') !== -1;
}

function mediaTag(url, alt, style) {
  var safe = (url || '').replace(/"/g, '&quot;');
  if (isVideoUrl(url)) {
    return '<video src="' + safe + '" ' + (style ? 'style="' + style + '"' : '') + ' preload="metadata" muted playsinline loop onmouseenter="this.play()" onmouseleave="this.pause();this.currentTime=0;"><\/video>';
  }
  return '<img src="' + safe + '" alt="' + (alt || '').replace(/"/g, '&quot;') + '" ' + (style ? 'style="' + style + '"' : '') + '>';
}

function runWorkspaceUpload(taskId, files, feedbackEl) {
  var task = productionTasksCache.find(function(t) { return t.id === taskId; });
  var currentUrls = (task && task.finalArt) ? task.finalArt.slice() : [];
  var maxFiles = 5;
  var remaining = maxFiles - currentUrls.length;
  if (remaining <= 0) { showToast('Maximum ' + maxFiles + ' files allowed. Remove some first.', 'error'); return; }
  var toUpload = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (ALLOWED_MEDIA_TYPES.indexOf(f.type) !== -1) {
      var isVid = f.type.startsWith('video/');
      var maxSize = isVid ? MAX_VIDEO_SIZE : MAX_IMAGE_SIZE;
      if (f.size > maxSize) {
        showToast(f.name + ' is too large (' + (isVid ? '100MB max for video' : '10MB max for image') + ')', 'error');
        continue;
      }
      toUpload.push(f);
    }
  }
  if (toUpload.length === 0) { showToast('No valid files. Accepted: JPG, PNG, MP4, MOV, WebM', 'error'); return; }
  if (toUpload.length > remaining) {
    showToast('Only ' + remaining + ' more file' + (remaining > 1 ? 's' : '') + ' allowed. Uploading first ' + remaining + '.', 'error');
    toUpload = toUpload.slice(0, remaining);
  }
  if (feedbackEl) feedbackEl.classList.add('upload-drop-zone--loading');
  var promises = toUpload.map(function(file) {
    return new Promise(function(resolve) {
      var isVideo = file.type.startsWith('video/');
      var reader = new FileReader();
      reader.onload = function() {
        var endpoint = isVideo ? '/api/upload/media' : '/api/upload/image';
        var body = isVideo ? { media: reader.result, filename: file.name } : { image: reader.result };
        fetch(getApiBaseUrl() + endpoint, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
          .then(function(r) { return r.json(); })
          .then(function(j) { resolve(j && j.url ? j.url : null); })
          .catch(function(err) { resolve(null); });
      };
      reader.readAsDataURL(file);
    });
  });
  Promise.all(promises).then(function(urls) {
    urls = urls.filter(Boolean);
    if (urls.length === 0) { if (feedbackEl) feedbackEl.classList.remove('upload-drop-zone--loading'); showToast('Upload failed', 'error'); return; }
    var allUrls = currentUrls.concat(urls);
    fetch(getApiBaseUrl() + '/api/production/tasks/' + taskId + '/upload-art', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: allUrls }) })
      .then(function(r) { return r.json(); }).then(function(j) {
        if (!j.task) throw new Error(j.error || 'Failed');
        if (feedbackEl) feedbackEl.classList.remove('upload-drop-zone--loading');
        return loadProductionTasks();
      }).then(function() { renderProductionView(); showToast('Uploaded'); }).catch(function(e) { if (feedbackEl) feedbackEl.classList.remove('upload-drop-zone--loading'); showToast(e.message || 'Upload failed', 'error'); });
  });
}

var DESIGNER_STATUS_CONFIG = {
  assigned:          { label: 'To Do',     color: '#3b82f6', bgColor: '#eff6ff',  textColor: '#1d4ed8', borderColor: '#bfdbfe', icon: '○',  action: 'Start Working',    actionColor: '#059669' },
  in_progress:       { label: 'Working',   color: '#f59e0b', bgColor: '#fffbeb',  textColor: '#b45309', borderColor: '#fde68a', icon: '◐',  action: 'Submit for Review', actionColor: '#2563eb' },
  changes_requested: { label: 'Revision',  color: '#ef4444', bgColor: '#fff7ed',  textColor: '#c2410c', borderColor: '#fed7aa', icon: '✎',  action: 'Resubmit',         actionColor: '#dc2626' },
  review:            { label: 'In Review', color: '#8b5cf6', bgColor: '#f5f3ff',  textColor: '#6d28d9', borderColor: '#ddd6fe', icon: '◉',  action: null,               actionColor: null },
  approved:          { label: 'Approved',  color: '#10b981', bgColor: '#ecfdf5',  textColor: '#059669', borderColor: '#a7f3d0', icon: '✓',  action: null,               actionColor: null },
  ready_to_post:     { label: 'Ready',     color: '#14b8a6', bgColor: '#f0fdfa',  textColor: '#0d9488', borderColor: '#99f6e4', icon: '▸',  action: null,               actionColor: null }
};

var PRIORITY_COLORS = { low: '#94a3b8', medium: '#3b82f6', high: '#f97316', urgent: '#ef4444' };

var PRODUCTION_STATUS_CONFIG = {
  assigned:          { label: 'To Do',      short: 'To Do',    bgColor: '#eff6ff',  textColor: '#1d4ed8', borderColor: '#bfdbfe', dotColor: '#3b82f6', icon: '○' },
  in_progress:       { label: 'In Progress',short: 'Working',  bgColor: '#fffbeb',  textColor: '#b45309', borderColor: '#fde68a', dotColor: '#f59e0b', icon: '◐' },
  changes_requested: { label: 'Revision',   short: 'Revision', bgColor: '#fff7ed',  textColor: '#c2410c', borderColor: '#fed7aa', dotColor: '#f97316', icon: '✎' },
  review:            { label: 'In Review',  short: 'Review',   bgColor: '#f5f3ff',  textColor: '#6d28d9', borderColor: '#ddd6fe', dotColor: '#8b5cf6', icon: '◉' },
  approved:          { label: 'Approved',   short: 'Approved', bgColor: '#ecfdf5',  textColor: '#059669', borderColor: '#a7f3d0', dotColor: '#10b981', icon: '✓' },
  ready_to_post:     { label: 'Ready',      short: 'Ready',    bgColor: '#f0fdfa',  textColor: '#0d9488', borderColor: '#99f6e4', dotColor: '#14b8a6', icon: '▸' }
};

function showInlineStatusDropdown(btn) {
  var existing = document.querySelector('.pv-status-dropdown');
  if (existing) existing.remove();

  var taskId = btn.getAttribute('data-task-id');
  var current = btn.getAttribute('data-current');
  if (!taskId) return;

  var rect = btn.getBoundingClientRect();
  var dropdown = document.createElement('div');
  dropdown.className = 'pv-status-dropdown';
  dropdown.style.cssText = 'position:fixed;top:' + (rect.bottom + 4) + 'px;left:' + Math.min(rect.left, window.innerWidth - 200) + 'px;background:#fff;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,0.15);border:1px solid #e2e8f0;padding:4px;z-index:10050;min-width:168px;max-height:70vh;overflow-y:auto;';

  var statuses = ['assigned', 'in_progress', 'review', 'changes_requested', 'approved', 'ready_to_post'];
  statuses.forEach(function(s) {
    var cfg = PRODUCTION_STATUS_CONFIG[s];
    if (!cfg) return;
    var isActive = s === current;
    var item = document.createElement('button');
    item.type = 'button';
    item.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:none;background:' + (isActive ? cfg.bgColor : 'transparent') + ';border-radius:6px;cursor:pointer;font-size:12px;color:' + cfg.textColor + ';font-weight:' + (isActive ? '700' : '500') + ';text-align:left;';
    item.innerHTML = '<span style="font-size:10px;">' + cfg.icon + '</span> ' + cfg.label;
    item.addEventListener('click', function(ev) {
      ev.stopPropagation();
      dropdown.remove();
      document.removeEventListener('mousedown', onDoc);
      if (s === current) return;
      fetch(getApiBaseUrl() + '/api/production/tasks/' + encodeURIComponent(taskId) + '/status', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: s })
      })
        .then(function(r) { return r.json().then(function(j) { if (!r.ok) throw new Error(j.error || 'Failed'); return j; }); })
        .then(function() { return loadProductionTasks(); })
        .then(function() { renderProductionView(); showToast('Status updated', 'success'); })
        .catch(function(e) { showToast(e.message || 'Failed', 'error'); });
    });
    dropdown.appendChild(item);
  });

  document.body.appendChild(dropdown);

  function onDoc(e) {
    if (!dropdown.parentNode) return;
    if (dropdown.contains(e.target) || btn.contains(e.target)) return;
    dropdown.remove();
    document.removeEventListener('mousedown', onDoc);
  }
  setTimeout(function() { document.addEventListener('mousedown', onDoc); }, 0);
}

function openTaskDrawer(taskId) {
  var root = document.getElementById('pvTaskDrawerRoot');
  if (root) root.remove();

  var task = productionTasksCache.find(function(t) { return t.id === taskId; });
  if (!task) return;

  var clients = loadClientsRegistry();
  var clientName = (clients[task.clientId] && clients[task.clientId].name) || '';
  var cfg = PRODUCTION_STATUS_CONFIG[task.status] || PRODUCTION_STATUS_CONFIG.assigned;

  var overlay = document.createElement('div');
  overlay.id = 'pvTaskDrawerRoot';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:10040;display:flex;justify-content:flex-end;';

  var backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.35);';

  var drawer = document.createElement('div');
  drawer.className = 'pv-task-drawer-panel';
  drawer.style.cssText = 'position:relative;z-index:1;width:min(480px,92vw);height:100%;background:#fff;box-shadow:-8px 0 30px rgba(0,0,0,0.12);overflow-y:auto;animation:slideInRight 0.22s ease-out;';

  var titleSafe = (task.title || task.caption || 'Task').replace(/</g, '&lt;');
  var h = '';
  h += '<div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">';
  h += '<div style="min-width:0;">';
  h += '<div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">' + (clientName + '').replace(/</g, '&lt;') + '</div>';
  h += '<div style="font-size:18px;font-weight:700;color:#0f172a;margin-top:4px;line-height:1.3;">' + titleSafe + '</div>';
  h += '</div>';
  h += '<button type="button" id="pvDrawerCloseX" style="flex-shrink:0;background:none;border:none;cursor:pointer;color:#94a3b8;font-size:26px;line-height:1;padding:4px;">&times;</button></div>';

  h += '<div style="padding:16px 24px;display:flex;gap:8px;flex-wrap:wrap;">';
  h += '<span style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:' + cfg.bgColor + ';color:' + cfg.textColor + ';border:1px solid ' + cfg.borderColor + ';">' + cfg.icon + ' ' + cfg.label + '</span>';
  h += '<span style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:#f1f5f9;color:#475569;">' + (task.priority || 'medium') + '</span>';
  if (task.deadline) h += '<span style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:#f1f5f9;color:#475569;">Due ' + (task.deadline + '').replace(/</g, '&lt;').slice(0, 10) + '</span>';
  h += '</div>';

  var cap = task.caption || task.copyText || '';
  if (cap) {
    h += '<div style="padding:0 24px 16px;"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px;">CAPTION</div>';
    h += '<div style="font-size:13px;color:#0f172a;line-height:1.55;background:#f8fafc;padding:12px;border-radius:8px;border:1px solid #e2e8f0;">' + cap.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div></div>';
  }

  if (task.finalArt && task.finalArt.length > 0) {
    h += '<div style="padding:0 24px 16px;"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px;">DESIGN (' + task.finalArt.length + ')</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;">';
    task.finalArt.forEach(function(url) {
      h += '<div style="aspect-ratio:1;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">';
      h += mediaTag(url, 'Art', 'width:100%;height:100%;object-fit:cover;');
      h += '</div>';
    });
    h += '</div></div>';
  }

  if (task.briefNotes) {
    h += '<div style="padding:0 24px 16px;"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px;">BRIEF</div>';
    h += '<div style="font-size:13px;color:#475569;line-height:1.55;">' + (task.briefNotes + '').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div></div>';
  }

  if (task.reviewNotes) {
    h += '<div style="padding:0 24px 16px;"><div style="font-size:11px;font-weight:700;color:#dc2626;margin-bottom:6px;">REVISION NOTES</div>';
    h += '<div style="font-size:13px;color:#991b1b;line-height:1.55;background:#fef2f2;padding:12px;border-radius:8px;border:1px solid #fecaca;">' + (task.reviewNotes + '').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div></div>';
  }

  if (task.comments && task.comments.length > 0) {
    h += '<div style="padding:0 24px 16px;"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px;">COMMENTS (' + task.comments.length + ')</div>';
    task.comments.forEach(function(c) {
      h += '<div style="padding:10px 0;border-bottom:1px solid #f1f5f9;">';
      h += '<div style="font-size:11px;"><strong style="color:#0f172a;">' + ((c.authorName || '') + '').replace(/</g, '&lt;') + '</strong> <span style="color:#94a3b8;">· ' + (c.createdAt ? fmtDate(c.createdAt) : '') + '</span></div>';
      h += '<div style="font-size:13px;color:#475569;margin-top:4px;">' + ((c.message || '') + '').replace(/</g, '&lt;') + '</div>';
      h += '</div>';
    });
    h += '</div>';
  }

  h += '<div style="padding:16px 24px;border-top:1px solid #e2e8f0;display:flex;gap:10px;flex-wrap:wrap;margin-top:auto;">';
  h += '<button type="button" class="pv-drawer-open-full" data-task-id="' + (taskId + '').replace(/"/g, '&quot;') + '" style="flex:1;min-width:140px;padding:10px 14px;border-radius:8px;border:none;background:#1e40af;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">Open Full View</button>';
  h += '<button type="button" id="pvDrawerCloseBtn" style="padding:10px 16px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;color:#475569;font-size:13px;font-weight:600;cursor:pointer;">Close</button>';
  h += '</div>';

  drawer.innerHTML = h;
  overlay.appendChild(backdrop);
  overlay.appendChild(drawer);
  document.body.appendChild(overlay);

  function closeDrawer() {
    overlay.remove();
    document.removeEventListener('keydown', onEsc);
  }
  function onEsc(e) {
    if (e.key === 'Escape') closeDrawer();
  }
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', onEsc);

  var cx = document.getElementById('pvDrawerCloseX');
  var cb = document.getElementById('pvDrawerCloseBtn');
  if (cx) cx.addEventListener('click', closeDrawer);
  if (cb) cb.addEventListener('click', closeDrawer);
  var full = drawer.querySelector('.pv-drawer-open-full');
  if (full) {
    full.addEventListener('click', function() {
      closeDrawer();
      currentProductionTaskId = taskId;
      renderProductionView();
    });
  }
}

function showDeleteTaskConfirm(taskId, taskTitle) {
  // Remove existing modal if any
  var existing = document.getElementById('deleteTaskModal');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'deleteTaskModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.15s ease-out;';

  var modal = document.createElement('div');
  modal.style.cssText = 'background:#fff;border-radius:16px;padding:28px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center;animation:slideUp 0.2s ease-out;';

  modal.innerHTML = '<div style="width:48px;height:48px;border-radius:50%;background:#fee2e2;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">'
    + '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
    + '</div>'
    + '<h3 style="margin:0 0 8px;font-size:18px;font-weight:700;color:#0f172a;">Delete Task</h3>'
    + '<p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.5;">Are you sure you want to delete <strong style="color:#0f172a;">"' + (taskTitle || 'this task').replace(/</g, '&lt;') + '"</strong>? This action cannot be undone.</p>'
    + '<div style="display:flex;gap:10px;justify-content:center;">'
    + '<button type="button" id="deleteTaskCancel" style="flex:1;padding:10px 20px;border-radius:10px;border:1px solid #e2e8f0;background:#fff;color:#475569;font-size:14px;font-weight:600;cursor:pointer;">Cancel</button>'
    + '<button type="button" id="deleteTaskConfirm" style="flex:1;padding:10px 20px;border-radius:10px;border:none;background:#dc2626;color:#fff;font-size:14px;font-weight:600;cursor:pointer;">Delete</button>'
    + '</div>';

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Close on overlay click
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });

  // Cancel
  document.getElementById('deleteTaskCancel').addEventListener('click', function() {
    overlay.remove();
  });

  // Confirm delete
  document.getElementById('deleteTaskConfirm').addEventListener('click', async function() {
    var confirmBtn = document.getElementById('deleteTaskConfirm');
    confirmBtn.textContent = 'Deleting...';
    confirmBtn.style.opacity = '0.6';
    confirmBtn.disabled = true;
    try {
      var r = await fetch(getApiBaseUrl() + '/api/production/tasks/' + encodeURIComponent(taskId), {
        method: 'DELETE',
        credentials: 'include'
      });
      var d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Failed to delete');
      overlay.remove();
      // Remove from cache
      productionTasksCache = productionTasksCache.filter(function(t) { return t.id !== taskId; });
      if (currentProductionTaskId === taskId) currentProductionTaskId = null;
      renderProductionView();
      showToast('Task deleted', 'success');
    } catch (err) {
      confirmBtn.textContent = 'Delete';
      confirmBtn.style.opacity = '1';
      confirmBtn.disabled = false;
      showToast(err.message || 'Failed to delete task', 'error');
    }
  });

  // Escape key
  function onEsc(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } }
  document.addEventListener('keydown', onEsc);
}

function renderProductionView() {
  const container = document.getElementById('productionViewInner');
  if (!container) return;
  document.querySelectorAll('.production-sidebar__link').forEach(function(l) { l.classList.remove('active'); });
  var activeLink = document.querySelector('.production-sidebar__link[data-section="' + currentProductionSection + '"]');
  if (activeLink) activeLink.classList.add('active');
  if (currentProductionSection === 'ai-library') {
    var clients = loadClientsRegistry();
    var clientList = clients ? Object.keys(clients).map(function(id) { return clients[id].name || id; }).join(', ') : '—';
    container.innerHTML = '<div class="production-empty-state" style="max-width: 480px; margin: 0 auto; padding: 48px 24px; text-align: center; border: 2px dashed #e2e8f0; border-radius: 16px; background: #fafafa;"><div style="width: 64px; height: 64px; margin: 0 auto 16px; color: #cbd5e1;"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div><h2 style="margin: 0 0 8px 0; font-size: 20px; color: #334155;">AI Library</h2><p style="color: #64748b; margin-bottom: 12px; font-size: 14px;">A library of images for each client will be available here.</p><span style="display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; background: #e2e8f0; color: #64748b;">Coming soon</span><p style="font-size: 13px; color: #94a3b8; margin-top: 16px;">Clients: ' + (clientList || 'None') + '</p></div>';
    return;
  }
  if (currentProductionSection === 'references') {
    var clientsRef = loadClientsRegistry();
    var list = clientsRef ? Object.keys(clientsRef) : [];
    var refHtml;
    if (list.length === 0) {
      refHtml = '<div class="production-empty-state" style="max-width: 480px; margin: 0 auto; padding: 48px 24px; text-align: center; border: 2px dashed #e2e8f0; border-radius: 16px; background: #fafafa;"><div style="width: 64px; height: 64px; margin: 0 auto 16px; color: #cbd5e1;"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5 7-5v10z"/><path d="M4 5v14l7-5 7-5V5"/></svg></div><h2 style="margin: 0 0 8px 0; font-size: 20px; color: #334155;">References</h2><p style="color: #64748b; margin-bottom: 12px; font-size: 14px;">Check client references and visual identity guidelines.</p><span style="display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; background: #e2e8f0; color: #64748b;">Coming soon</span><p style="color: #94a3b8; margin-top: 16px; font-size: 13px;">No clients yet. References will appear here by client.</p></div>';
    } else {
      refHtml = '<div class="production-empty-state" style="max-width: 480px; margin: 0 auto; padding: 48px 24px; text-align: center; border: 2px dashed #e2e8f0; border-radius: 16px; background: #fafafa;"><div style="width: 64px; height: 64px; margin: 0 auto 16px; color: #cbd5e1;"><svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5 7-5v10z"/><path d="M4 5v14l7-5 7-5V5"/></svg></div><h2 style="margin: 0 0 8px 0; font-size: 20px; color: #334155;">References</h2><p style="color: #64748b; margin-bottom: 12px; font-size: 14px;">Check client references and how the visual identity works.</p><span style="display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; background: #e2e8f0; color: #64748b;">Reference materials coming soon</span><ul style="list-style: none; padding: 0; margin-top: 24px; text-align: left;">';
      list.forEach(function(cid) {
        var c = clientsRef[cid];
        var name = (c && c.name) || cid;
        refHtml += '<li style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;"><strong>' + name + '</strong><span style="color: #64748b; font-size: 13px;"> — Reference materials coming soon.</span></li>';
      });
      refHtml += '</ul></div>';
    }
    container.innerHTML = refHtml;
    return;
  }
  var clientsData = loadClientsRegistry();
  if (currentProductionSection === 'demands' && currentProductionTaskId) {
    var task = productionTasksCache.find(function(t) { return t.id === currentProductionTaskId; });
    if (task) {
      var designerMap = {};
      designersCache.forEach(function(d) { designerMap[d.id] = d.name || d.email || 'Designer'; });
      if (currentStaff && (currentStaff.role === 'DESIGNER' || currentStaff.role === 'STAFF' || currentStaff.role === 'ADMIN' || currentStaff.role === 'OWNER')) {
        designerMap[currentStaff.id] = currentStaff.name || currentStaff.fullName || currentStaff.username || currentStaff.email || 'You';
      }
      container.innerHTML = renderProductionWorkspace(task, clientsData, designerMap);
      bindWorkspaceEvents(container, task);
      return;
    }
    currentProductionTaskId = null;
  }
  if (isDesigner) {
    var tasks = productionTasksCache;
    var todayStr = new Date().toISOString().slice(0, 10);

    // Computed stats
    var completedCount = tasks.filter(function(t) { return ['approved', 'ready_to_post', 'review'].includes(t.status); }).length;
    var overdueCount = tasks.filter(function(t) { return t.deadline && t.deadline < todayStr && !['approved','ready_to_post'].includes(t.status); }).length;
    var changesCount = tasks.filter(function(t) { return t.status === 'changes_requested'; }).length;
    var todayCount = tasks.filter(function(t) { return t.deadline && t.deadline.slice(0,10) <= todayStr && !['approved','ready_to_post'].includes(t.status); }).length;

    // Filter by search
    var filtered = tasks;
    if (designerSearchQuery) {
      var q = designerSearchQuery.toLowerCase();
      filtered = tasks.filter(function(t) {
        var clientName = (clientsData && clientsData[t.clientId] && clientsData[t.clientId].name) || t.clientId || '';
        return (t.title || t.caption || '').toLowerCase().indexOf(q) !== -1 || clientName.toLowerCase().indexOf(q) !== -1;
      });
    }

    // Filter by stat click
    if (designerStatFilter === 'remaining') {
      filtered = filtered.filter(function(t) { return !['approved', 'ready_to_post', 'review'].includes(t.status); });
    } else if (designerStatFilter === 'overdue') {
      filtered = filtered.filter(function(t) { return t.deadline && t.deadline < todayStr && !['approved','ready_to_post'].includes(t.status); });
    } else if (designerStatFilter === 'revisions') {
      filtered = filtered.filter(function(t) { return t.status === 'changes_requested'; });
    } else if (designerStatFilter === 'due_today') {
      filtered = filtered.filter(function(t) { return t.deadline && t.deadline.slice(0,10) <= todayStr && !['approved','ready_to_post'].includes(t.status); });
    } else if (designerStatFilter === 'done') {
      filtered = filtered.filter(function(t) { return ['approved', 'ready_to_post', 'review'].includes(t.status); });
    }

    // Group by status
    var byStatus = {};
    Object.keys(DESIGNER_STATUS_CONFIG).forEach(function(k) { byStatus[k] = []; });
    filtered.forEach(function(t) { if (byStatus[t.status]) byStatus[t.status].push(t); });

    // Group by client
    var byClient = {};
    filtered.forEach(function(t) {
      var cName = (clientsData && clientsData[t.clientId] && clientsData[t.clientId].name) || t.clientId || 'Unknown';
      if (!byClient[t.clientId]) byClient[t.clientId] = { name: cName, tasks: [] };
      byClient[t.clientId].tasks.push(t);
    });
    var clientEntries = Object.keys(byClient).map(function(k) { return { id: k, name: byClient[k].name, tasks: byClient[k].tasks }; }).sort(function(a,b) { return a.name.localeCompare(b.name); });

    // Pick focus task: changes_requested > overdue assigned > assigned > in_progress
    var actionable = filtered.filter(function(t) { return ['assigned','in_progress','changes_requested'].includes(t.status); });
    var focusTask = null;
    if (actionable.length > 0) {
      actionable.sort(function(a, b) {
        var sp = { changes_requested: 0, assigned: 1, in_progress: 2 };
        var sa = sp[a.status] !== undefined ? sp[a.status] : 3;
        var sb = sp[b.status] !== undefined ? sp[b.status] : 3;
        if (sa !== sb) return sa - sb;
        var aOv = a.deadline < todayStr ? 0 : 1;
        var bOv = b.deadline < todayStr ? 0 : 1;
        if (aOv !== bOv) return aOv - bOv;
        return (a.deadline || '9999').localeCompare(b.deadline || '9999');
      });
      focusTask = actionable[0];
    }

    // Progress ring SVG helper
    function progressRingSvg(completed, total, size) {
      size = size || 56;
      var pct = total === 0 ? 0 : Math.round((completed / total) * 100);
      var r = (size - 8) / 2;
      var circ = 2 * Math.PI * r;
      var offset = circ - (pct / 100) * circ;
      return '<div style="position:relative;width:' + size + 'px;height:' + size + 'px;">' +
        '<svg width="' + size + '" height="' + size + '" style="transform:rotate(-90deg);">' +
        '<circle cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + r + '" fill="none" stroke="#e2e8f0" stroke-width="4"/>' +
        '<circle cx="' + (size/2) + '" cy="' + (size/2) + '" r="' + r + '" fill="none" stroke="#10b981" stroke-width="4" stroke-dasharray="' + circ + '" stroke-dashoffset="' + offset + '" stroke-linecap="round" style="transition:all 0.7s;"/>' +
        '</svg>' +
        '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">' +
        '<span style="font-size:12px;font-weight:700;color:#334155;">' + pct + '%</span></div></div>';
    }

    // Client color palette — consistent color per clientId
    var CLIENT_COLORS = [
      { bg: '#dbeafe', text: '#1e40af' },  // blue
      { bg: '#fce7f3', text: '#9d174d' },  // pink
      { bg: '#d1fae5', text: '#065f46' },  // green
      { bg: '#fef3c7', text: '#92400e' },  // amber
      { bg: '#e0e7ff', text: '#3730a3' },  // indigo
      { bg: '#ffe4e6', text: '#9f1239' },  // rose
      { bg: '#ccfbf1', text: '#115e59' },  // teal
      { bg: '#fae8ff', text: '#86198f' },  // fuchsia
      { bg: '#fed7aa', text: '#9a3412' },  // orange
      { bg: '#e2e8f0', text: '#334155' },  // slate
    ];
    var clientColorMap = {};
    var clientColorIndex = 0;
    function getClientColor(clientId) {
      if (!clientId) return CLIENT_COLORS[0];
      if (!clientColorMap[clientId]) {
        clientColorMap[clientId] = CLIENT_COLORS[clientColorIndex % CLIENT_COLORS.length];
        clientColorIndex++;
      }
      return clientColorMap[clientId];
    }

    // Task row HTML helper
    function dvTaskRow(t) {
      var cfg = DESIGNER_STATUS_CONFIG[t.status] || DESIGNER_STATUS_CONFIG.assigned;
      var clientName = (clientsData && clientsData[t.clientId] && clientsData[t.clientId].name) || t.clientId || '';
      var cc = getClientColor(t.clientId);
      var isOverdue = t.deadline && t.deadline < todayStr && !['approved','ready_to_post'].includes(t.status);
      var deadlineLabel = t.deadline ? new Date(t.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
      var taskTitle = (t.title || t.caption || t.briefNotes || 'Untitled').replace(/</g, '&lt;');
      var pColor = PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.medium;
      var r = '';
      r += '<div class="dv-task-row" data-task-id="' + t.id + '">';
      // Status dot
      r += '<div class="dv-task-row__dot" style="background:' + cfg.color + ';"></div>';
      // Client chip with unique color
      r += '<span class="dv-task-row__client" style="background:' + cc.bg + ';color:' + cc.text + ';">' + (clientName.split(' ')[0] || '—').replace(/</g, '&lt;') + '</span>';
      // Title + review notes
      r += '<div class="dv-task-row__title-wrap">';
      r += '<p class="dv-task-row__title">' + taskTitle + '</p>';
      if (t.reviewNotes && t.status === 'changes_requested') {
        r += '<p class="dv-task-row__review-note">&darr; ' + t.reviewNotes.replace(/</g, '&lt;').slice(0, 100) + (t.reviewNotes.length > 100 ? '...' : '') + '</p>';
      }
      r += '</div>';
      // Deadline
      r += '<span class="dv-task-row__deadline' + (isOverdue ? ' dv-task-row__deadline--late' : '') + '">' + deadlineLabel;
      if (isOverdue) r += ' <span class="dv-late-badge">LATE</span>';
      r += '</span>';
      // Priority dot
      r += '<span class="dv-task-row__priority-dot" style="background:' + pColor + ';" title="' + (t.priority || 'medium') + '"></span>';
      // Status badge
      r += '<span class="dv-status-badge" style="background:' + cfg.bgColor + ';color:' + cfg.textColor + ';border-color:' + cfg.borderColor + ';"><span style="font-size:9px;">' + cfg.icon + '</span> ' + cfg.label + '</span>';
      // Action buttons (hidden file input + visible buttons)
      r += '<div class="dv-task-row__actions">';
      if (t.status === 'in_progress' || t.status === 'changes_requested') {
        r += '<input type="file" class="upload-final-art-input" data-id="' + t.id + '" accept="image/*,video/mp4,video/quicktime,video/webm" multiple style="display:none;">';
        r += '<button type="button" class="btn-upload-art dv-action-btn" data-id="' + t.id + '" style="background:#f1f5f9;color:#475569;">Upload</button>';
      }
      if (cfg.action) {
        var btnClass = 'btn-start-task';
        if (t.status === 'in_progress') btnClass = 'btn-submit-review';
        if (t.status === 'changes_requested') btnClass = 'btn-resubmit';
        r += '<button type="button" class="' + btnClass + ' dv-action-btn" data-id="' + t.id + '" style="background:' + cfg.actionColor + ';color:#fff;">' + cfg.action + '</button>';
      }
      r += '</div>';
      r += '</div>';
      return r;
    }

    // Focus card HTML
    function dvFocusCard(t) {
      if (!t) return '';
      var cfg = DESIGNER_STATUS_CONFIG[t.status] || DESIGNER_STATUS_CONFIG.assigned;
      var clientName = (clientsData && clientsData[t.clientId] && clientsData[t.clientId].name) || t.clientId || '';
      var cc = getClientColor(t.clientId);
      var isOverdue = t.deadline && t.deadline < todayStr && !['approved','ready_to_post'].includes(t.status);
      var deadlineLabel = t.deadline ? new Date(t.deadline).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '—';
      var taskTitle = (t.title || t.caption || t.briefNotes || 'Untitled').replace(/</g, '&lt;');
      var pColor = PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.medium;
      var h = '<div class="dv-focus-card">';
      h += '<div class="dv-focus-card__accent"></div>';
      h += '<div class="dv-focus-card__inner">';
      h += '<div class="dv-focus-card__label">' + (isOverdue ? '&#9889; OVERDUE — DO THIS NOW' : 'UP NEXT') + '</div>';
      h += '<div class="dv-focus-card__body">';
      h += '<div class="dv-focus-card__left">';
      h += '<p class="dv-focus-card__client" style="color:' + cc.text + ';">' + clientName.replace(/</g, '&lt;') + '</p>';
      h += '<h3 class="dv-focus-card__title">' + taskTitle + '</h3>';
      h += '<div class="dv-focus-card__meta">';
      h += '<span class="dv-focus-card__meta-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> <span' + (isOverdue ? ' style="color:#dc2626;font-weight:600;"' : '') + '>' + deadlineLabel + '</span>';
      if (isOverdue) h += ' <span class="dv-late-badge">LATE</span>';
      h += '</span>';
      h += '<span class="dv-focus-card__meta-item"><span style="width:8px;height:8px;border-radius:50%;background:' + pColor + ';display:inline-block;"></span> ' + (t.priority || 'medium') + '</span>';
      h += '</div>';
      // Action buttons
      h += '<div class="dv-focus-card__actions">';
      if (t.status === 'assigned') {
        h += '<button type="button" class="btn-start-task dv-focus-btn dv-focus-btn--green" data-id="' + t.id + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Start Working</button>';
      }
      if (t.status === 'in_progress') {
        h += '<input type="file" class="upload-final-art-input" data-id="' + t.id + '" accept="image/*,video/mp4,video/quicktime,video/webm" multiple style="display:none;">';
        h += '<button type="button" class="btn-upload-art dv-focus-btn dv-focus-btn--gray" data-id="' + t.id + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload Art</button>';
        h += '<button type="button" class="btn-submit-review dv-focus-btn dv-focus-btn--blue" data-id="' + t.id + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Submit for Review</button>';
      }
      if (t.status === 'changes_requested') {
        if (t.reviewNotes) {
          h += '<div class="dv-focus-card__revision-note"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg><p>' + t.reviewNotes.replace(/</g, '&lt;').slice(0, 200) + '</p></div>';
        }
        h += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">';
        h += '<input type="file" class="upload-final-art-input" data-id="' + t.id + '" accept="image/*,video/mp4,video/quicktime,video/webm" multiple style="display:none;">';
        h += '<button type="button" class="btn-upload-art dv-focus-btn dv-focus-btn--gray" data-id="' + t.id + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Upload Art</button>';
        h += '<button type="button" class="btn-resubmit dv-focus-btn dv-focus-btn--red" data-id="' + t.id + '"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Resubmit</button>';
        h += '</div>';
      }
      h += '</div>';
      h += '</div>';
      // Status badge on right
      h += '<div class="dv-focus-card__right">';
      h += '<span class="dv-status-badge" style="background:' + cfg.bgColor + ';color:' + cfg.textColor + ';border-color:' + cfg.borderColor + ';"><span style="font-size:10px;">' + cfg.icon + '</span> ' + cfg.label + '</span>';
      h += '</div>';
      h += '</div>';
      h += '</div>';
      h += '</div>';
      return h;
    }

    // Status lane HTML (collapsible)
    function dvStatusLane(status, laneTasks) {
      if (!laneTasks || laneTasks.length === 0) return '';
      var cfg = DESIGNER_STATUS_CONFIG[status];
      if (!cfg) return '';
      var isCollapsed = designerCollapsedStatuses[status] === true;
      var h = '<div class="dv-status-lane">';
      h += '<button type="button" class="dv-status-lane__header" data-status="' + status + '">';
      h += '<span class="dv-status-lane__chevron' + (isCollapsed ? ' dv-status-lane__chevron--collapsed' : '') + '"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg></span>';
      h += '<span class="dv-status-lane__bar" style="background:' + cfg.color + ';"></span>';
      h += '<span class="dv-status-lane__label">' + cfg.label + '</span>';
      h += '<span class="dv-status-lane__count" style="background:' + cfg.color + '18;color:' + cfg.color + ';">' + laneTasks.length + '</span>';
      if (status === 'changes_requested' && laneTasks.length > 0) {
        h += '<span class="dv-status-lane__attention">needs attention</span>';
      }
      h += '</button>';
      if (!isCollapsed) {
        h += '<div class="dv-status-lane__body">';
        laneTasks.forEach(function(t) { h += dvTaskRow(t); });
        h += '</div>';
      }
      h += '</div>';
      return h;
    }

    // === BUILD HTML ===
    var html = '<div class="dv-container">';

    // Top bar
    html += '<header class="dv-header">';
    html += '<div class="dv-header__left"><h1 class="dv-header__title">My Tasks</h1><span class="dv-header__count">' + tasks.length + ' assigned</span></div>';
    html += '<div class="dv-header__right">';
    html += '<div class="dv-search-wrap"><svg class="dv-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';
    html += '<input type="text" class="dv-search-input" placeholder="Search tasks..." value="' + (designerSearchQuery || '').replace(/"/g, '&quot;') + '"></div>';
    html += '</div></header>';

    // Quick stats bar
    html += '<div class="dv-stats-bar">';
    html += progressRingSvg(completedCount, tasks.length, 56);
    html += '<div class="dv-stats-bar__numbers">';
    html += '<div class="dv-stat dv-stat--clickable' + (designerStatFilter === 'remaining' ? ' dv-stat--active' : '') + '" data-stat-filter="remaining"><p class="dv-stat__value">' + (tasks.length - completedCount) + '</p><p class="dv-stat__label">remaining</p></div>';
    if (overdueCount > 0) html += '<div class="dv-stat dv-stat--clickable' + (designerStatFilter === 'overdue' ? ' dv-stat--active' : '') + '" data-stat-filter="overdue"><p class="dv-stat__value dv-stat__value--red">' + overdueCount + '</p><p class="dv-stat__label dv-stat__label--red">overdue</p></div>';
    if (changesCount > 0) html += '<div class="dv-stat dv-stat--clickable' + (designerStatFilter === 'revisions' ? ' dv-stat--active' : '') + '" data-stat-filter="revisions"><p class="dv-stat__value dv-stat__value--orange">' + changesCount + '</p><p class="dv-stat__label dv-stat__label--orange">revisions</p></div>';
    if (todayCount > 0) html += '<div class="dv-stat dv-stat--clickable' + (designerStatFilter === 'due_today' ? ' dv-stat--active' : '') + '" data-stat-filter="due_today"><p class="dv-stat__value dv-stat__value--amber">' + todayCount + '</p><p class="dv-stat__label dv-stat__label--amber">due today</p></div>';
    html += '<div class="dv-stat dv-stat--clickable' + (designerStatFilter === 'done' ? ' dv-stat--active' : '') + '" data-stat-filter="done"><p class="dv-stat__value dv-stat__value--green">' + completedCount + '</p><p class="dv-stat__label dv-stat__label--green">done</p></div>';
    html += '</div>';
    // View toggle
    html += '<div class="dv-view-toggle">';
    ['focus', 'list', 'clients'].forEach(function(key) {
      var label = key === 'focus' ? 'Focus' : key === 'list' ? 'All Tasks' : 'By Client';
      html += '<button type="button" class="dv-view-toggle__btn' + (designerViewMode === key ? ' dv-view-toggle__btn--active' : '') + '" data-view="' + key + '">' + label + '</button>';
    });
    html += '</div>';
    html += '</div>';

    // Content area
    html += '<div class="dv-content">';

    if (tasks.length === 0) {
      html += '<div class="dv-empty">No tasks assigned yet. New tasks will appear here.</div>';
    } else if (designerViewMode === 'focus') {
      // Focus card
      if (focusTask) html += '<div style="margin-bottom:24px;">' + dvFocusCard(focusTask) + '</div>';
      // Status lanes
      html += '<div class="dv-card-panel">';
      ['changes_requested', 'assigned', 'in_progress', 'review', 'approved', 'ready_to_post'].forEach(function(status) {
        html += dvStatusLane(status, byStatus[status]);
      });
      html += '</div>';
    } else if (designerViewMode === 'list') {
      html += '<div class="dv-card-panel">';
      // Header row
      html += '<div class="dv-list-header">';
      html += '<div style="width:24px;"></div>';
      html += '<span class="dv-list-header__col" style="width:96px;text-align:center;">Client</span>';
      html += '<span class="dv-list-header__col" style="flex:1;">Task</span>';
      html += '<span class="dv-list-header__col" style="width:80px;text-align:right;">Due</span>';
      html += '<span style="width:8px;"></span>';
      html += '<span class="dv-list-header__col" style="width:88px;text-align:center;">Status</span>';
      html += '<span style="width:80px;"></span>';
      html += '</div>';
      if (filtered.length === 0) {
        html += '<div class="dv-empty" style="padding:48px;">No tasks match your search.</div>';
      } else {
        filtered.forEach(function(t) { html += dvTaskRow(t); });
      }
      html += '</div>';
    } else if (designerViewMode === 'clients') {
      clientEntries.forEach(function(group) {
        var gcc = getClientColor(group.id);
        html += '<div class="dv-card-panel" style="margin-bottom:16px;">';
        html += '<div class="dv-client-group-header">';
        html += '<div class="dv-client-group-header__avatar" style="background:' + gcc.text + ';">' + group.name.charAt(0).toUpperCase() + '</div>';
        html += '<div><h3 class="dv-client-group-header__name">' + group.name.replace(/</g, '&lt;') + '</h3>';
        html += '<p class="dv-client-group-header__count">' + group.tasks.length + ' task' + (group.tasks.length !== 1 ? 's' : '') + '</p></div>';
        // Status dots
        html += '<div class="dv-client-group-header__dots">';
        Object.keys(DESIGNER_STATUS_CONFIG).forEach(function(s) {
          var n = group.tasks.filter(function(t) { return t.status === s; }).length;
          if (n > 0) html += '<span style="width:8px;height:8px;border-radius:50%;background:' + DESIGNER_STATUS_CONFIG[s].color + ';" title="' + DESIGNER_STATUS_CONFIG[s].label + ': ' + n + '"></span>';
        });
        html += '</div></div>';
        group.tasks.forEach(function(t) { html += dvTaskRow(t); });
        html += '</div>';
      });
    }

    // Footer
    html += '<div class="dv-footer">' + filtered.length + ' task' + (filtered.length !== 1 ? 's' : '') + ' &middot; ' + completedCount + ' completed &middot; ' + (tasks.length - completedCount) + ' remaining</div>';
    html += '</div>'; // dv-content
    html += '</div>'; // dv-container
    container.innerHTML = html;

    // === BIND EVENTS ===

    // Search
    var searchInput = container.querySelector('.dv-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', function() { designerSearchQuery = searchInput.value; renderProductionView(); });
      searchInput.focus();
      searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
    }

    // View toggle
    container.querySelectorAll('.dv-view-toggle__btn').forEach(function(btn) {
      btn.addEventListener('click', function() { designerViewMode = btn.getAttribute('data-view'); renderProductionView(); });
    });

    // Stat filter clicks (toggle on/off)
    container.querySelectorAll('.dv-stat--clickable').forEach(function(el) {
      el.addEventListener('click', function() {
        var filter = el.getAttribute('data-stat-filter');
        designerStatFilter = (designerStatFilter === filter) ? '' : filter;
        renderProductionView();
      });
    });

    // Status lane collapse/expand
    container.querySelectorAll('.dv-status-lane__header').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var st = btn.getAttribute('data-status');
        designerCollapsedStatuses[st] = !designerCollapsedStatuses[st];
        renderProductionView();
      });
    });

    // Task row clicks — open task workspace
    container.querySelectorAll('.dv-task-row').forEach(function(row) {
      row.addEventListener('click', function(e) {
        if (e.target.closest('button') || e.target.closest('input')) return;
        var id = row.getAttribute('data-task-id');
        if (id) { currentProductionTaskId = id; renderProductionView(); }
      });
    });

    // Start Working
    container.querySelectorAll('.btn-start-task').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.getAttribute('data-id');
        btn.disabled = true; btn.textContent = 'Starting...';
        fetch(getApiBaseUrl() + '/api/production/tasks/' + id + '/status', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'in_progress' }) })
          .then(function(r) { return r.json(); }).then(function(j) { if (!j.task) throw new Error(j.error || 'Failed'); return loadProductionTasks(); })
          .then(function() { currentProductionTaskId = id; renderProductionView(); })
          .catch(function(e) { btn.disabled = false; btn.textContent = 'Start Working'; showToast(e.message, 'error'); });
      });
    });

    // Submit for Review
    container.querySelectorAll('.btn-submit-review').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.getAttribute('data-id');
        fetch(getApiBaseUrl() + '/api/production/tasks/' + id + '/status', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'review' }) })
          .then(function(r) { return r.json(); }).then(function(j) { if (!j.task) throw new Error(j.error || 'Failed'); return loadProductionTasks(); }).then(function() { renderProductionView(); }).catch(function(e) { showToast(e.message, 'error'); });
      });
    });

    // Resubmit
    container.querySelectorAll('.btn-resubmit').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var id = btn.getAttribute('data-id');
        fetch(getApiBaseUrl() + '/api/production/tasks/' + id + '/status', { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'review' }) })
          .then(function(r) { return r.json(); }).then(function(j) { if (!j.task) throw new Error(j.error || 'Failed'); return loadProductionTasks(); }).then(function() { renderProductionView(); }).catch(function(e) { showToast(e.message, 'error'); });
      });
    });

    // Upload Art
    container.querySelectorAll('.btn-upload-art').forEach(function(btn) {
      var taskId = btn.getAttribute('data-id');
      var input = container.querySelector('.upload-final-art-input[data-id="' + taskId + '"]');
      if (!input) return;
      btn.addEventListener('click', function(e) { e.stopPropagation(); input.click(); });
      input.addEventListener('change', function() {
        var files = input.files;
        if (!files || !files.length) return;
        var task = productionTasksCache.find(function(t) { return t.id === taskId; });
        var currentUrls = (task && task.finalArt) ? task.finalArt.slice() : [];
        var promises = [];
        for (var i = 0; i < files.length; i++) {
          var f = files[i];
          if (!f.type.startsWith('image/')) continue;
          var p = new Promise(function(resolve) {
            var reader = new FileReader();
            reader.onload = function() {
              fetch(getApiBaseUrl() + '/api/upload/image', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: reader.result }) })
                .then(function(r) { return r.json(); })
                .then(function(j) { resolve(j.url); })
                .catch(function() { resolve(null); });
            };
            reader.readAsDataURL(f);
          });
          promises.push(p);
        }
        Promise.all(promises).then(function(urls) {
          urls = urls.filter(Boolean);
          if (urls.length === 0) { showToast('No valid images uploaded', 'error'); return; }
          var allUrls = currentUrls.concat(urls);
          fetch(getApiBaseUrl() + '/api/production/tasks/' + taskId + '/upload-art', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ urls: allUrls }) })
            .then(function(r) { return r.json(); })
            .then(function(j) { if (!j.task) throw new Error(j.error || 'Failed'); input.value = ''; return loadProductionTasks(); })
            .then(function() { renderProductionView(); showToast('Art uploaded'); })
            .catch(function(e) { showToast(e.message || 'Upload failed', 'error'); });
        });
      });
    });

    return;
  }
  // ─── AGENCY MANAGER: REDESIGNED DEMANDS VIEW ───────────────
  var designerMap = {};
  designersCache.forEach(function(d) { designerMap[d.id] = d.name || d.email || 'Designer'; });
  if (currentStaff) designerMap[currentStaff.id] = currentStaff.name || currentStaff.fullName || currentStaff.username || 'You';
  var allTasks = productionTasksCache.slice();
  var clientsData = loadClientsRegistry();

  // Collect unique assignees
  var uniqueAssignees = [];
  allTasks.forEach(function(t) {
    var name = designerMap[t.designerId] || t.designerId || '';
    if (name && uniqueAssignees.indexOf(name) === -1) uniqueAssignees.push(name);
  });

  // Collect unique client IDs
  var uniqueClientIds = [];
  allTasks.forEach(function(t) {
    if (t.clientId && uniqueClientIds.indexOf(t.clientId) === -1) uniqueClientIds.push(t.clientId);
  });

  // Apply filters
  var tasks = allTasks.slice();
  if (demandFilterStatus === 'todo') tasks = tasks.filter(function(t) { return t.status === 'assigned'; });
  else if (demandFilterStatus === 'in_progress') tasks = tasks.filter(function(t) { return t.status === 'in_progress'; });
  else if (demandFilterStatus === 'changes_requested') tasks = tasks.filter(function(t) { return t.status === 'changes_requested'; });
  else if (demandFilterStatus === 'review') tasks = tasks.filter(function(t) { return t.status === 'review'; });
  else if (demandFilterStatus === 'approved') tasks = tasks.filter(function(t) { return t.status === 'approved' || t.status === 'ready_to_post'; });
  else if (demandFilterStatus === 'completed') tasks = tasks.filter(function(t) { return ['review', 'approved', 'ready_to_post'].indexOf(t.status) !== -1; });

  if (demandFilterClient) tasks = tasks.filter(function(t) { return t.clientId === demandFilterClient; });

  if (demandFilterAssignee) {
    tasks = tasks.filter(function(t) {
      var name = designerMap[t.designerId] || t.designerId || '';
      return name === demandFilterAssignee;
    });
  }

  if (demandFilterDueToday) {
    var todayISO = new Date().toISOString().slice(0, 10);
    tasks = tasks.filter(function(t) { return t.deadline && t.deadline.slice(0, 10) === todayISO; });
  }

  if (demandFilterOverdue) {
    var overdueIso = new Date().toISOString().slice(0, 10);
    tasks = tasks.filter(function(t) {
      return t.deadline && t.deadline.slice(0, 10) < overdueIso && ['review', 'approved', 'ready_to_post'].indexOf(t.status) === -1;
    });
  }

  // Apply sorting
  if (productionSortCol) {
    var statusOrder = ['assigned', 'in_progress', 'changes_requested', 'review', 'approved', 'ready_to_post'];
    tasks.sort(function(a, b) {
      var va, vb;
      if (productionSortCol === 'task') {
        va = (a.caption || a.briefNotes || 'zzz').toLowerCase();
        vb = (b.caption || b.briefNotes || 'zzz').toLowerCase();
      } else if (productionSortCol === 'timeline') {
        va = a.deadline || '9999';
        vb = b.deadline || '9999';
      } else if (productionSortCol === 'assignee') {
        va = (designerMap[a.designerId] || a.designerId || '').toLowerCase();
        vb = (designerMap[b.designerId] || b.designerId || '').toLowerCase();
      } else if (productionSortCol === 'status') {
        va = statusOrder.indexOf(a.status);
        vb = statusOrder.indexOf(b.status);
      }
      if (va < vb) return productionSortDir === 'asc' ? -1 : 1;
      if (va > vb) return productionSortDir === 'asc' ? 1 : -1;
      return 0;
    });
  } else {
    // Default sort: overdue first, then by deadline
    var now = new Date();
    var priorityOrder = { urgent: 0, high: 1, medium: 2, low: 3 };
    tasks.sort(function(a, b) {
      var aOverdue = a.deadline && new Date(a.deadline) < now ? 0 : 1;
      var bOverdue = b.deadline && new Date(b.deadline) < now ? 0 : 1;
      if (aOverdue !== bOverdue) return aOverdue - bOverdue;
      var aDate = a.deadline ? new Date(a.deadline).getTime() : Infinity;
      var bDate = b.deadline ? new Date(b.deadline).getTime() : Infinity;
      if (aDate !== bDate) return aDate - bDate;
      return (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
    });
  }

  // Group by client
  var clientGroupsMap = {};
  var clientGroupOrder = [];
  tasks.forEach(function(t) {
    if (!clientGroupsMap[t.clientId]) {
      clientGroupsMap[t.clientId] = { name: (clientsData && clientsData[t.clientId] && clientsData[t.clientId].name) || t.clientId || 'Unknown', tasks: [] };
      clientGroupOrder.push(t.clientId);
    }
    clientGroupsMap[t.clientId].tasks.push(t);
  });
  clientGroupOrder.sort(function(a, b) { return clientGroupsMap[a].name.localeCompare(clientGroupsMap[b].name); });

  // Stats from ALL tasks (unfiltered)
  var now = new Date();
  var todayStr = now.toISOString().slice(0, 10);
  var statCounts = {};
  ['assigned', 'in_progress', 'changes_requested', 'review', 'approved', 'ready_to_post'].forEach(function(s) { statCounts[s] = 0; });
  allTasks.forEach(function(t) { if (statCounts[t.status] !== undefined) statCounts[t.status]++; });
  var statsOverdue = allTasks.filter(function(t) { return t.deadline && t.deadline.slice(0, 10) < todayStr && ['review', 'approved', 'ready_to_post'].indexOf(t.status) === -1; }).length;
  var statsDueToday = allTasks.filter(function(t) { return t.deadline && t.deadline.slice(0, 10) === todayStr; }).length;

  // SVG icons as strings
  var svgSearch = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';
  var svgFilter = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';
  var svgPlus = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
  var svgTable = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/></svg>';
  var svgKanban = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3" y="3" width="5" height="14" rx="1"/><rect x="10" y="3" width="5" height="18" rx="1"/><rect x="17" y="3" width="5" height="10" rx="1"/></svg>';
  var svgChevron = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>';

  function sortIcon(col) {
    if (productionSortCol !== col) return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" opacity="0.3"><path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/></svg>';
    if (productionSortDir === 'asc') return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m7 9 5-5 5 5"/></svg>';
    return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m7 15 5 5 5-5"/></svg>';
  }

  // Build HTML
  var html = '<div class="production-demands-wrap production-light-canvas" style="padding: 0 24px 24px 24px;">';

  // ── Toolbar ──
  html += '<div class="pv-toolbar">';
  html += '<div class="pv-toolbar-left">';
  // View toggle
  html += '<div class="pv-view-toggle">';
  html += '<button type="button" id="pvViewTable" class="pv-view-btn' + (demandViewMode === 'table' ? ' pv-view-btn--active' : '') + '">' + svgTable + ' Table</button>';
  html += '<button type="button" id="pvViewKanban" class="pv-view-btn' + (demandViewMode === 'kanban' ? ' pv-view-btn--active' : '') + '">' + svgKanban + ' Kanban</button>';
  html += '</div>';
  // Search
  html += '<div class="pv-search-wrap"><span class="pv-search-icon">' + svgSearch + '</span>';
  html += '<input type="text" id="pvSearchInput" class="pv-search-input" placeholder="Search tasks..."></div>';
  // Filter toggle
  var hasActiveFilters = demandFilterStatus || demandFilterClient || demandFilterAssignee || demandFilterDueToday || demandFilterOverdue;
  html += '<button type="button" id="pvFilterToggle" class="pv-filter-btn' + (productionFiltersOpen ? ' pv-filter-btn--active' : '') + '">' + svgFilter + ' Filters';
  if (hasActiveFilters) html += ' <span class="pv-filter-dot"></span>';
  html += '</button>';
  html += '</div>';
  // Assign button
  html += '<button type="button" id="pvAssignTask" class="pv-assign-btn">' + svgPlus + ' Assign Task</button>';
  html += '</div>';

  // ── Filter row ──
  var sKeys = ['assigned', 'in_progress', 'changes_requested', 'review', 'approved', 'ready_to_post'];
  if (productionFiltersOpen) {
    html += '<div class="pv-filter-row">';
    html += '<span class="pv-filter-label">Status</span>';
    html += '<select id="pvFilterStatus" class="pv-filter-select">';
    html += '<option value="">All statuses</option>';
    sKeys.forEach(function(k) {
      var cfg = PRODUCTION_STATUS_CONFIG[k];
      html += '<option value="' + k + '"' + (demandFilterStatus === k ? ' selected' : '') + '>' + cfg.label + '</option>';
    });
    html += '</select>';
    html += '<span class="pv-filter-label">Client</span>';
    html += '<select id="pvFilterClient" class="pv-filter-select">';
    html += '<option value="">All clients</option>';
    uniqueClientIds.forEach(function(cid) {
      var cName = (clientsData && clientsData[cid] && clientsData[cid].name) || cid;
      html += '<option value="' + (cid || '').replace(/"/g, '&quot;') + '"' + (demandFilterClient === cid ? ' selected' : '') + '>' + (cName || 'Unknown').replace(/</g, '&lt;') + '</option>';
    });
    html += '</select>';
    html += '<span class="pv-filter-label">Assignee</span>';
    html += '<select id="pvFilterAssignee" class="pv-filter-select">';
    html += '<option value="">All assignees</option>';
    uniqueAssignees.forEach(function(name) {
      html += '<option value="' + (name || '').replace(/"/g, '&quot;') + '"' + (demandFilterAssignee === name ? ' selected' : '') + '>' + (name || 'Unknown').replace(/</g, '&lt;') + '</option>';
    });
    html += '</select>';
    if (hasActiveFilters) html += '<button type="button" id="pvClearFilters" class="pv-clear-filters">Clear filters</button>';
    html += '</div>';
  }

  // ── Stats bar (clickable filters) ──
  html += '<div class="pv-stats-bar" style="margin: 12px 0; flex-wrap: wrap;">';
  html += '<button type="button" class="pv-stat-chip pv-stat-filter" data-pv-stat="total" style="cursor:pointer;border:none;font:inherit;display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;background:transparent;">';
  html += '<span class="pv-stat-dot" style="background: #94a3b8;"></span> ' + allTasks.length + ' <span style="color: #94a3b8; font-weight: 400;">Total</span></button>';
  html += '<div class="pv-stat-divider"></div>';
  sKeys.forEach(function(k) {
    if (statCounts[k] > 0) {
      var cfg = PRODUCTION_STATUS_CONFIG[k];
      var active = demandFilterStatus === k && !demandFilterOverdue && !demandFilterDueToday;
      html += '<button type="button" class="pv-stat-chip pv-stat-filter" data-pv-stat="' + k + '" style="cursor:pointer;border:none;font:inherit;display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;background:' + (active ? '#e2e8f0' : 'transparent') + ';">';
      html += '<span class="pv-stat-dot" style="background: ' + cfg.dotColor + ';"></span> ' + statCounts[k] + ' <span style="color: #94a3b8; font-weight: 400;">' + cfg.short + '</span></button>';
    }
  });
  if (statsDueToday > 0) {
    html += '<div class="pv-stat-divider"></div>';
    var dtActive = demandFilterDueToday && !demandFilterOverdue;
    html += '<button type="button" class="pv-stat-chip pv-stat-filter pv-stat-chip--duetoday" data-pv-stat="duetoday" style="cursor:pointer;border:none;font:inherit;display:inline-flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;background:' + (dtActive ? '#ffedd5' : 'transparent') + ';">';
    html += '<span class="pv-stat-dot" style="background: #f59e0b;"></span> ' + statsDueToday + ' <span style="color:#d97706;font-weight:600;">Due Today</span></button>';
  }
  if (statsOverdue > 0) {
    html += '<div class="pv-stat-divider"></div>';
    var odActive = demandFilterOverdue;
    html += '<button type="button" class="pv-stat-chip pv-stat-filter pv-stat-chip--alert' + (odActive ? ' pv-stat-chip--pulse' : '') + '" data-pv-stat="overdue" style="cursor:pointer;border:none;font:inherit;display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:8px;background:' + (odActive ? '#fee2e2' : 'transparent') + ';' + (statsOverdue > 0 ? '' : '') + '">';
    html += '<span class="pv-stat-dot" style="background: #ef4444;"></span> ' + statsOverdue + ' <span style="font-weight:600;color:#dc2626;">Overdue</span></button>';
  }
  html += '</div>';

  // ── Kanban mode ──
  if (demandViewMode === 'kanban') {
    html += '<div id="demandsKanbanContainer" style="padding: 20px 0;"></div>';
    html += '</div>';
    container.innerHTML = html;
    var kanbanEl = document.getElementById('demandsKanbanContainer');
    if (kanbanEl) renderProductionKanbanView(kanbanEl, clientsData, tasks);
  } else {
    // ── Table mode ──
    html += '<div class="pv-table-wrap">';
    // Table header
    html += '<table style="width: 100%; border-collapse: collapse;"><thead><tr style="border-bottom: 1px solid #e2e8f0;">';
    html += '<th style="width: 40px; padding-left: 8px;"></th>';
    html += '<th class="pv-sortable-header" data-sort="task" style="padding-right:16px;"><span style="display:flex;align-items:center;gap:4px;">Task ' + sortIcon('task') + '</span></th>';
    html += '<th class="pv-sortable-header" data-sort="timeline" style="width:130px;"><span style="display:flex;align-items:center;gap:4px;">Timeline ' + sortIcon('timeline') + '</span></th>';
    html += '<th class="pv-sortable-header" data-sort="assignee" style="width:160px;"><span style="display:flex;align-items:center;gap:4px;">Assignee ' + sortIcon('assignee') + '</span></th>';
    html += '<th class="pv-sortable-header" data-sort="status" style="width:130px;"><span style="display:flex;align-items:center;gap:4px;">Status ' + sortIcon('status') + '</span></th>';
    html += '</tr></thead></table>';

    // Client groups
    if (tasks.length === 0) {
      html += '<div style="text-align: center; padding: 48px 24px; color: #94a3b8; font-size: 14px;">No demands found.<br><span style="font-size: 12px; margin-top: 8px; display: block;">Use "Send to Designer" from the Approvals tab to create new demands.</span></div>';
    } else {
      clientGroupOrder.forEach(function(clientId) {
        var group = clientGroupsMap[clientId];
        var isCollapsed = productionCollapsedClients[clientId];
        // Client status dots
        var groupStats = {};
        group.tasks.forEach(function(t) { groupStats[t.status] = (groupStats[t.status] || 0) + 1; });
        var dotsHtml = '';
        Object.keys(groupStats).forEach(function(s) {
          var cfg = PRODUCTION_STATUS_CONFIG[s];
          if (cfg && groupStats[s] > 0) {
            dotsHtml += '<span class="pv-stat-dot" style="background: ' + cfg.dotColor + ';" title="' + cfg.label + ': ' + groupStats[s] + '"></span>';
          }
        });
        var doneInGroup = group.tasks.filter(function(t) { return t.status === 'approved' || t.status === 'ready_to_post'; }).length;
        var totalInGroup = group.tasks.length;
        var pctGroup = totalInGroup > 0 ? Math.round((doneInGroup / totalInGroup) * 100) : 0;
        html += '<button type="button" class="pv-client-header" data-client-id="' + clientId + '">';
        html += '<span class="pv-client-chevron' + (isCollapsed ? ' pv-client-chevron--collapsed' : '') + '">' + svgChevron + '</span>';
        html += '<span class="pv-client-name">' + (group.name || '').replace(/</g, '&lt;').toLowerCase() + '</span>';
        html += '<span class="pv-client-count">' + group.tasks.length + ' task' + (group.tasks.length !== 1 ? 's' : '') + '</span>';
        html += '<span class="pv-client-meta-right" style="display:flex;align-items:center;gap:10px;margin-left:auto;flex-shrink:0;">';
        html += '<span class="pv-client-dots" style="margin-left:0;">' + dotsHtml + '</span>';
        html += '<span style="display:flex;align-items:center;gap:6px;">';
        html += '<span style="width:56px;height:4px;border-radius:2px;background:#e2e8f0;overflow:hidden;display:inline-block;vertical-align:middle;">';
        html += '<span style="display:block;width:' + pctGroup + '%;height:100%;border-radius:2px;background:' + (pctGroup === 100 ? '#059669' : '#3b82f6') + ';"></span></span>';
        html += '<span style="font-size:10px;color:#94a3b8;font-weight:600;">' + doneInGroup + '/' + totalInGroup + '</span></span></span>';
        html += '</button>';

        if (!isCollapsed) {
          html += '<table style="width: 100%; border-collapse: collapse;">';
          group.tasks.forEach(function(t, idx) {
            var title = (t.title || t.caption || t.copyText || t.briefNotes || t.description || t.name || t.postCaption || t.content || '').slice(0, 80);
            var fullTitle = (t.title || t.caption || t.copyText || t.briefNotes || t.description || t.name || t.postCaption || t.content || '').replace(/</g, '&lt;');
            var isUntitled = !title || !title.trim();
            var displayTitle = isUntitled ? 'Untitled demand' : title.replace(/</g, '&lt;');
            var designerName = designerMap[t.designerId] || t.designerId || '—';
            var initial = (designerName + '').split(' ').map(function(w) { return w.charAt(0); }).join('').toUpperCase().slice(0, 2);
            var dueDate = t.deadline ? new Date(t.deadline) : null;
            var deadlineLabel = '—';
            var dueClass = 'pv-due--future';
            if (dueDate && !isNaN(dueDate.getTime())) {
              var startOfToday = new Date();
              startOfToday.setHours(0, 0, 0, 0);
              var d0 = new Date(dueDate);
              d0.setHours(0, 0, 0, 0);
              var diffDays = Math.round((d0.getTime() - startOfToday.getTime()) / 86400000);
              if (['review', 'approved', 'ready_to_post'].indexOf(t.status) === -1) {
                if (diffDays < -1) { deadlineLabel = Math.abs(diffDays) + 'd overdue'; dueClass = 'pv-due--overdue'; }
                else if (diffDays === -1) { deadlineLabel = 'Yesterday'; dueClass = 'pv-due--overdue'; }
                else if (diffDays === 0) { deadlineLabel = 'Due today'; dueClass = 'pv-due--today'; }
                else if (diffDays === 1) { deadlineLabel = 'Tomorrow'; dueClass = 'pv-due--future'; }
                else if (diffDays <= 7) { deadlineLabel = 'In ' + diffDays + ' days'; dueClass = 'pv-due--future'; }
                else { deadlineLabel = dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); dueClass = 'pv-due--future'; }
              } else {
                deadlineLabel = dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                dueClass = 'pv-due--future';
              }
            }
            var priorityColors = { low: '#cbd5e1', medium: '#60a5fa', high: '#fb923c', urgent: '#ef4444' };
            var priorityDotColor = priorityColors[t.priority] || priorityColors.medium;
            var cfg = PRODUCTION_STATUS_CONFIG[t.status] || PRODUCTION_STATUS_CONFIG.assigned;
            var isLast = idx === group.tasks.length - 1;
            var reviewNote = t.reviewNotes ? t.reviewNotes.replace(/</g, '&lt;').slice(0, 80) : '';

            html += '<tr class="pv-task-row" data-task-id="' + t.id + '" style="' + (!isLast ? 'border-bottom: 1px solid #f1f5f9;' : '') + '">';
            // Priority dot
            html += '<td style="width: 40px; padding-left: 12px;"><span class="pv-priority-dot" style="background: ' + priorityDotColor + ';" title="' + (t.priority || 'medium') + '"></span></td>';
            // Task title
            html += '<td style="padding: 12px 16px 12px 0;"><div class="pv-task-title' + (isUntitled ? ' pv-task-title--untitled' : '') + '" title="' + fullTitle + '">' + displayTitle + '</div>';
            if (reviewNote) html += '<div class="pv-task-review-note">↳ ' + reviewNote + '</div>';
            html += '</td>';
            // Timeline
            html += '<td style="padding: 12px 16px 12px 0; white-space: nowrap; width: 130px;"><span class="pv-due-label ' + dueClass + '">' + deadlineLabel + '</span></td>';
            // Assignee
            html += '<td style="padding: 12px 16px 12px 0; white-space: nowrap; width: 160px;"><div class="pv-assignee"><span class="pv-assignee-avatar">' + initial + '</span><span class="pv-assignee-name">' + (designerName + '').replace(/</g, '&lt;') + '</span></div></td>';
            // Status
            html += '<td style="padding:12px 16px 12px 0;width:150px;position:relative;">';
            html += '<button type="button" class="pv-status-badge pv-inline-status" data-task-id="' + (t.id + '').replace(/"/g, '&quot;') + '" data-current="' + (t.status || '').replace(/"/g, '&quot;') + '" style="cursor:pointer;border:1px solid ' + cfg.borderColor + ';background:' + cfg.bgColor + ';color:' + cfg.textColor + ';padding:4px 10px;border-radius:9999px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;">';
            html += '<span class="pv-status-icon">' + cfg.icon + '</span> ' + cfg.label + ' <span style="font-size:9px;opacity:0.55;">▾</span></button></td>';
            // Delete button
            html += '<td style="padding: 12px 4px 12px 0; width: 36px;"><button type="button" class="pv-delete-task-btn" data-task-id="' + t.id + '" data-task-title="' + displayTitle.replace(/"/g, '&quot;') + '" title="Delete task" style="background:none;border:none;cursor:pointer;padding:4px;border-radius:6px;color:#94a3b8;display:flex;align-items:center;justify-content:center;transition:color 0.15s,background 0.15s;" onmouseenter="this.style.color=\'#dc2626\';this.style.background=\'#fee2e2\'" onmouseleave="this.style.color=\'#94a3b8\';this.style.background=\'none\'"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button></td>';
            html += '</tr>';
          });
          html += '</table>';
        }
      });
    }

    // Ghost row
    html += '<button type="button" class="pv-ghost-row" id="pvGhostRow"><span class="pv-ghost-plus">' + svgPlus + '</span> New demand...</button>';
    html += '</div>'; // end table wrap

    // Footer count
    html += '<div class="pv-footer-count">' + tasks.length + ' task' + (tasks.length !== 1 ? 's' : '') + ' · ' + clientGroupOrder.length + ' client' + (clientGroupOrder.length !== 1 ? 's' : '') + '</div>';
    html += '</div>'; // end demands wrap
    container.innerHTML = html;
  }

  // ── BIND EVENTS ──
  // View toggle
  var pvVT = document.getElementById('pvViewTable');
  var pvVK = document.getElementById('pvViewKanban');
  if (pvVT) pvVT.addEventListener('click', function() { demandViewMode = 'table'; renderProductionView(); });
  if (pvVK) pvVK.addEventListener('click', function() { demandViewMode = 'kanban'; renderProductionView(); });
  // Search
  var pvSearch = document.getElementById('pvSearchInput');
  if (pvSearch) pvSearch.addEventListener('input', function() {
    var q = (pvSearch.value || '').toLowerCase().trim();
    container.querySelectorAll('.pv-task-row').forEach(function(row) {
      var id = row.getAttribute('data-task-id');
      var task = productionTasksCache.find(function(t) { return t.id === id; });
      var text = ((task && (task.title || '') + ' ' + (task.caption || '') + ' ' + (task.copyText || '') + ' ' + (task.briefNotes || '') + ' ' + (task.description || '') + ' ' + (task.name || '') + ' ' + (task.postCaption || '') + ' ' + (task.content || '')) || '').toLowerCase();
      var clientName = (task && clientsData && clientsData[task.clientId] && clientsData[task.clientId].name || '').toLowerCase();
      var dName = (task && (designerMap[task.designerId] || '')).toLowerCase();
      row.style.display = !q || text.indexOf(q) !== -1 || clientName.indexOf(q) !== -1 || dName.indexOf(q) !== -1 ? '' : 'none';
    });
  });
  // Filter toggle
  var pvFT = document.getElementById('pvFilterToggle');
  if (pvFT) pvFT.addEventListener('click', function() { productionFiltersOpen = !productionFiltersOpen; renderProductionView(); });
  // Filter selects
  var pvFS = document.getElementById('pvFilterStatus');
  var pvFC = document.getElementById('pvFilterClient');
  var pvFA = document.getElementById('pvFilterAssignee');
  if (pvFS) pvFS.addEventListener('change', function() {
    demandFilterStatus = pvFS.value;
    demandFilterDueToday = false;
    demandFilterOverdue = false;
    renderProductionView();
  });
  if (pvFC) pvFC.addEventListener('change', function() {
    demandFilterClient = pvFC.value;
    demandFilterDueToday = false;
    demandFilterOverdue = false;
    renderProductionView();
  });
  if (pvFA) pvFA.addEventListener('change', function() {
    demandFilterAssignee = pvFA.value;
    demandFilterDueToday = false;
    demandFilterOverdue = false;
    renderProductionView();
  });
  // Clear filters
  var pvCF = document.getElementById('pvClearFilters');
  if (pvCF) pvCF.addEventListener('click', function() {
    demandFilterStatus = '';
    demandFilterClient = '';
    demandFilterAssignee = '';
    demandFilterDueToday = false;
    demandFilterOverdue = false;
    renderProductionView();
  });
  container.querySelectorAll('.pv-stat-filter').forEach(function(chip) {
    chip.addEventListener('click', function() {
      var st = chip.getAttribute('data-pv-stat');
      if (st === 'total') {
        demandFilterStatus = '';
        demandFilterDueToday = false;
        demandFilterOverdue = false;
        demandFilterClient = '';
        demandFilterAssignee = '';
      } else if (st === 'overdue') {
        demandFilterOverdue = !demandFilterOverdue;
        if (demandFilterOverdue) {
          demandFilterDueToday = false;
          demandFilterStatus = '';
        }
      } else if (st === 'duetoday') {
        demandFilterDueToday = !demandFilterDueToday;
        if (demandFilterDueToday) {
          demandFilterOverdue = false;
          demandFilterStatus = '';
        }
      } else {
        demandFilterStatus = demandFilterStatus === st ? '' : st;
        demandFilterDueToday = false;
        demandFilterOverdue = false;
      }
      renderProductionView();
    });
  });
  // Assign task
  var pvAT = document.getElementById('pvAssignTask');
  var pvGR = document.getElementById('pvGhostRow');
  function handleAssign() { if (typeof openSendToDesignerModal === 'function' && window.__lastApprovalForAssign) openSendToDesignerModal(window.__lastApprovalForAssign); else showToast('Create an approval first, then use Send to Designer from Approvals.', 'info'); }
  if (pvAT) pvAT.addEventListener('click', handleAssign);
  if (pvGR) pvGR.addEventListener('click', handleAssign);
  // Sortable headers
  container.querySelectorAll('.pv-sortable-header').forEach(function(th) {
    th.addEventListener('click', function() {
      var col = th.getAttribute('data-sort');
      if (productionSortCol === col) {
        if (productionSortDir === 'asc') productionSortDir = 'desc';
        else { productionSortCol = null; productionSortDir = null; }
      } else {
        productionSortCol = col;
        productionSortDir = 'asc';
      }
      renderProductionView();
    });
  });
  // Client group collapse
  container.querySelectorAll('.pv-client-header').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var cid = btn.getAttribute('data-client-id');
      productionCollapsedClients[cid] = !productionCollapsedClients[cid];
      renderProductionView();
    });
  });
  // Delete task buttons
  container.querySelectorAll('.pv-delete-task-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var taskId = btn.getAttribute('data-task-id');
      var taskTitle = btn.getAttribute('data-task-title') || 'this task';
      showDeleteTaskConfirm(taskId, taskTitle);
    });
  });
  container.querySelectorAll('.pv-inline-status').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      showInlineStatusDropdown(btn);
    });
  });
  // Task row click → drawer (full view from drawer)
  container.querySelectorAll('.pv-task-row').forEach(function(row) {
    row.addEventListener('click', function(e) {
      if (e.target.closest('button')) return;
      var id = row.getAttribute('data-task-id');
      if (id) openTaskDrawer(id);
    });
  });
  container.querySelectorAll('.btnAssignTaskColumn').forEach(function(btn) {
    btn.addEventListener('click', function(e) { e.stopPropagation(); handleAssign(); });
  });
  container.querySelectorAll('.btn-review-approve').forEach(function(btn) {
    btn.addEventListener('click', function(e) { e.stopPropagation(); var id = btn.getAttribute('data-id'); fetch(getApiBaseUrl() + '/api/production/tasks/' + id + '/review', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) }).then(function(r) { return r.json(); }).then(function(j) { if (!j.task) throw new Error(j.error || 'Failed'); return loadProductionTasks(); }).then(function() { renderProductionView(); showToast('Design approved!'); }).catch(function(e) { showToast(e.message, 'error'); }); });
  });
  container.querySelectorAll('.btn-review-changes').forEach(function(btn) {
    btn.addEventListener('click', function(e) { e.stopPropagation(); var id = btn.getAttribute('data-id'); var notes = prompt('Feedback for designer:'); if (notes === null) return; fetch(getApiBaseUrl() + '/api/production/tasks/' + id + '/review', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'request_changes', reviewNotes: notes }) }).then(function(r) { return r.json(); }).then(function(j) { if (!j.task) throw new Error(j.error || 'Failed'); return loadProductionTasks(); }).then(renderProductionView).catch(function(e) { showToast(e.message, 'error'); }); });
  });

  var navDem = document.getElementById('productionNavDemands');
  var navMy = document.getElementById('productionNavMyTasks');
  var myNm = (currentStaff && (currentStaff.name || currentStaff.fullName || currentStaff.username || '')).trim();
  if (navDem && navMy && currentProductionSection === 'demands') {
    if (demandFilterAssignee && myNm && demandFilterAssignee === myNm) {
      navDem.classList.remove('active');
      navMy.classList.add('active');
    } else {
      navMy.classList.remove('active');
      navDem.classList.add('active');
    }
  }
}

if (!window._productionShortcutsBound) {
  window._productionShortcutsBound = true;
  document.addEventListener('keydown', function(e) {
    if (currentViewMode !== 'production') return;
    var t = e.target;
    var tag = (t && t.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (e.key === 'n' || e.key === 'N') {
      if (typeof openSendToDesignerModal === 'function' && window.__lastApprovalForAssign) openSendToDesignerModal(window.__lastApprovalForAssign);
      else showToast('Create an approval first, then use Send to Designer from Approvals.', 'info');
      e.preventDefault();
    } else if (e.key === 'f' || e.key === 'F') {
      productionFiltersOpen = !productionFiltersOpen;
      renderProductionView();
      e.preventDefault();
    } else if (e.key === 't') {
      demandViewMode = 'table';
      renderProductionView();
      e.preventDefault();
    } else if (e.key === 'k') {
      demandViewMode = 'kanban';
      renderProductionView();
      e.preventDefault();
    } else if (e.key === '/') {
      var s = document.getElementById('pvSearchInput');
      if (s) { s.focus(); e.preventDefault(); }
    } else if (e.key === 'Escape') {
      var d = document.getElementById('pvTaskDrawerRoot');
      if (d) d.remove();
    }
  });
}

function renderProductionKanbanView(container, clientsData, tasksFiltered) {
  if (!container) return;
  var taskPool = tasksFiltered && Array.isArray(tasksFiltered) ? tasksFiltered : productionTasksCache.slice();
  var designerMapKanban = {};
  designersCache.forEach(function(d) { designerMapKanban[d.id] = d.name || d.email || 'Designer'; });
  if (currentStaff) designerMapKanban[currentStaff.id] = currentStaff.name || currentStaff.fullName || currentStaff.username || 'You';
  var colColors = { assigned: { bg: '#f1f5f9', color: '#475569' }, in_progress: { bg: '#dbeafe', color: '#1d4ed8' }, review: { bg: '#fef3c7', color: '#d97706' }, changes_requested: { bg: '#fee2e2', color: '#dc2626' }, approved: { bg: '#dcfce7', color: '#16a34a' }, ready_to_post: { bg: '#dcfce7', color: '#16a34a' } };
  var priorityBorder = { low: '#22c55e', medium: '#3b82f6', high: '#f97316', urgent: '#ef4444' };
  var columns = ['assigned', 'in_progress', 'review', 'changes_requested', 'approved', 'ready_to_post'];
  var labels = { assigned: 'Assigned', in_progress: 'In Progress', review: 'Review', changes_requested: 'Changes Requested', approved: 'Approved', ready_to_post: 'Ready to Post' };
  var todayStrK = new Date().toISOString().slice(0, 10);
  var html = '<div class="production-kanban production-kanban--scroll" style="display:flex;gap:20px;overflow-x:auto;padding-bottom:12px;min-height:400px;">';
  columns.forEach(function(col) {
    var colTasks = taskPool.filter(function(t) { return t.status === col; });
    var cc = colColors[col] || colColors.assigned;
    html += '<div class="kanban-column" data-column-status="' + col + '" style="min-width:280px;max-width:280px;display:flex;flex-direction:column;">';
    html += '<div class="kanban-column-header" style="padding:10px 14px;border-radius:8px;font-size:12px;font-weight:600;margin-bottom:12px;background:' + cc.bg + ';color:' + cc.color + ';">' + labels[col] + ' <span style="opacity:0.9;">(' + colTasks.length + ')</span></div>';
    html += '<div class="kanban-column-cards" data-column-status="' + col + '" style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:10px;min-height:120px;">';
    colTasks.forEach(function(t) {
      var clientName = (clientsData && clientsData[t.clientId] && clientsData[t.clientId].name) || t.clientId || '—';
      var cap = (t.caption || t.briefNotes || '').slice(0, 60) + ((t.caption || t.briefNotes || '').length > 60 ? '…' : '');
      var designerName = designerMapKanban[t.designerId] || t.designerId || '—';
      var initial = (designerName + '').charAt(0).toUpperCase();
      var dueStr = t.deadline ? new Date(t.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
      var borderColor = priorityBorder[t.priority] || priorityBorder.medium;
      var thumbHtml = (t.finalArt && t.finalArt[0]) ? mediaTag(t.finalArt[0], '', 'width:100%;height:100px;object-fit:cover;border-radius:8px 8px 0 0;') : '';
      var isOverdue = t.deadline && String(t.deadline).slice(0, 10) < todayStrK && ['approved', 'ready_to_post'].indexOf(t.status) === -1;
      var overdueDays = 0;
      if (isOverdue) {
        overdueDays = Math.max(1, Math.round((Date.now() - new Date(t.deadline).getTime()) / 86400000));
      }
      var leftExtra = isOverdue ? '3px solid #ef4444' : '4px solid ' + borderColor;
      html += '<div class="kanban-card kanban-card--' + col + '" draggable="true" data-task-id="' + t.id + '" data-status="' + col + '" style="position:relative;background:#fff;border-radius:12px;padding:0;box-shadow:0 1px 3px rgba(0,0,0,0.08);border-left:' + leftExtra + ';cursor:grab;transition:opacity 0.15s ease,box-shadow 0.15s ease;overflow:hidden;">';
      html += '<div class="kanban-card-actions" style="display:none;position:absolute;top:6px;right:6px;z-index:2;gap:4px;background:#fff;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.12);padding:4px;align-items:center;">';
      html += '<button type="button" class="kanban-quick-status" data-task-id="' + t.id + '" data-current="' + (t.status || '') + '" style="padding:4px 8px;border:none;background:#f1f5f9;border-radius:6px;font-size:10px;font-weight:700;color:#475569;cursor:pointer;">Status</button>';
      html += '<button type="button" class="kanban-quick-open" data-task-id="' + t.id + '" style="padding:4px 8px;border:none;background:#eff6ff;border-radius:6px;font-size:10px;font-weight:700;color:#1d4ed8;cursor:pointer;">Open</button>';
      html += '</div>';
      if (thumbHtml) html += thumbHtml;
      html += '<div style="padding:12px;">';
      if (isOverdue) {
        html += '<div style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:4px;background:#fef2f2;color:#dc2626;font-size:9px;font-weight:700;margin-bottom:6px;">' + overdueDays + 'd late</div>';
      }
      html += '<div class="kanban-card__client-chip" style="font-size:11px;color:#64748b;margin-bottom:4px;">' + (clientName + '').replace(/</g, '&lt;') + '</div>';
      html += '<div class="kanban-card__title" style="font-size:14px;font-weight:600;color:#1e293b;margin-bottom:8px;">' + (cap || 'Untitled').replace(/</g, '&lt;') + '</div>';
      if (col === 'review') {
        html += '<div style="margin-bottom:8px;display:flex;gap:6px;flex-wrap:wrap;"><button type="button" class="btn-review-approve" data-id="' + t.id + '" style="padding:6px 12px;font-size:12px;background:#16a34a;color:white;border:none;border-radius:6px;cursor:pointer;">Approve</button><button type="button" class="btn-review-changes" data-id="' + t.id + '" style="padding:6px 12px;font-size:12px;background:#ea580c;color:white;border:none;border-radius:6px;cursor:pointer;">Request Changes</button></div>';
      }
      html += '<div class="kanban-card__footer" style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid #f1f5f9;"><span style="display:flex;align-items:center;gap:6px;"><span style="width:24px;height:24px;border-radius:50%;background:#e2e8f0;color:#475569;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;">' + initial + '</span><span style="font-size:12px;color:#64748b;">' + (designerName + '').replace(/</g, '&lt;') + '</span></span><span style="font-size:11px;color:#94a3b8;">' + dueStr + '</span></div>';
      html += '</div></div>';
    });
    if (colTasks.length === 0) html += '<div class="kanban-column-empty" style="padding:24px;text-align:center;color:#94a3b8;font-size:13px;border:2px dashed #e2e8f0;border-radius:8px;background:#fafafa;">No tasks in this column</div>';
    html += '</div>';
    html += '<button type="button" class="kanban-column-add-btn btnAssignTaskColumn" style="margin-top:10px;padding:10px;border:2px dashed #cbd5e1;border-radius:8px;background:transparent;color:#64748b;font-size:14px;cursor:pointer;">+ Add</button>';
    html += '</div>';
  });
  html += '</div>';
  container.innerHTML = html;

  function clearColumnHighlight() {
    container.querySelectorAll('.kanban-column-cards').forEach(function(c) {
      c.style.outline = 'none';
      c.style.background = '';
    });
  }

  container.querySelectorAll('.kanban-card[draggable="true"]').forEach(function(card) {
    card.addEventListener('dragstart', function(e) {
      e.dataTransfer.setData('text/plain', card.getAttribute('data-task-id'));
      e.dataTransfer.effectAllowed = 'move';
      card.style.opacity = '0.45';
      container.querySelectorAll('.kanban-column-cards').forEach(function(col) {
        col.style.outline = '2px dashed #93c5fd';
        col.style.outlineOffset = '-2px';
      });
    });
    card.addEventListener('dragend', function() {
      card.style.opacity = '1';
      clearColumnHighlight();
    });
    var actions = card.querySelector('.kanban-card-actions');
    if (actions) {
      card.addEventListener('mouseenter', function() { actions.style.display = 'flex'; });
      card.addEventListener('mouseleave', function() { actions.style.display = 'none'; });
    }
  });

  container.querySelectorAll('.kanban-column-cards').forEach(function(colEl) {
    colEl.addEventListener('dragover', function(e) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      colEl.style.background = '#eff6ff';
    });
    colEl.addEventListener('dragleave', function(e) {
      if (!colEl.contains(e.relatedTarget)) colEl.style.background = '';
    });
    colEl.addEventListener('drop', function(e) {
      e.preventDefault();
      colEl.style.background = '';
      clearColumnHighlight();
      var taskId = e.dataTransfer.getData('text/plain');
      var newStatus = colEl.getAttribute('data-column-status');
      if (!taskId || !newStatus) return;
      fetch(getApiBaseUrl() + '/api/production/tasks/' + encodeURIComponent(taskId) + '/status', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      })
        .then(function(r) { return r.json().then(function(j) { if (!r.ok) throw new Error(j.error || 'Failed'); return j; }); })
        .then(function() { return loadProductionTasks(); })
        .then(function() {
          renderProductionView();
          showToast('Moved to ' + (labels[newStatus] || newStatus).replace(/_/g, ' '), 'success');
        })
        .catch(function(err) { showToast(err.message || 'Failed to move task', 'error'); });
    });
  });

  container.querySelectorAll('.kanban-card').forEach(function(card) {
    card.addEventListener('click', function(e) {
      if (e.target.closest('button')) return;
      var id = card.getAttribute('data-task-id');
      if (id) openTaskDrawer(id);
    });
  });
  container.querySelectorAll('.kanban-quick-open').forEach(function(b) {
    b.addEventListener('click', function(e) {
      e.stopPropagation();
      var id = b.getAttribute('data-task-id');
      if (id) openTaskDrawer(id);
    });
  });
  container.querySelectorAll('.kanban-quick-status').forEach(function(b) {
    b.addEventListener('click', function(e) {
      e.stopPropagation();
      var id = b.getAttribute('data-task-id');
      var task = productionTasksCache.find(function(x) { return x.id === id; });
      if (!task) return;
      var rect = b.getBoundingClientRect();
      var ghost = document.createElement('button');
      ghost.type = 'button';
      ghost.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + (rect.bottom + 2) + 'px;width:2px;height:2px;opacity:0;pointer-events:none;';
      ghost.setAttribute('data-task-id', id);
      ghost.setAttribute('data-current', task.status || 'assigned');
      document.body.appendChild(ghost);
      showInlineStatusDropdown(ghost);
      setTimeout(function() { try { ghost.remove(); } catch (err) {} }, 800);
    });
  });
  container.querySelectorAll('.btnAssignTaskColumn').forEach(function(btn) {
    btn.addEventListener('click', function(e) { e.stopPropagation(); if (typeof openSendToDesignerModal === 'function' && window.__lastApprovalForAssign) openSendToDesignerModal(window.__lastApprovalForAssign); else showToast('Create an approval first, then use Send to Designer from Approvals.', 'info'); });
  });
  container.querySelectorAll('.btn-review-approve').forEach(function(btn) {
    btn.addEventListener('click', function(e) { e.stopPropagation(); var id = btn.getAttribute('data-id'); fetch(getApiBaseUrl() + '/api/production/tasks/' + id + '/review', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'approve' }) }).then(function(r) { return r.json(); }).then(function(j) { if (!j.task) throw new Error(j.error || 'Failed'); return loadProductionTasks(); }).then(function() { renderProductionView(); showToast('Design approved! Sent to client approvals for review.'); }).catch(function(e) { showToast(e.message, 'error'); }); });
  });
  container.querySelectorAll('.btn-review-changes').forEach(function(btn) {
    btn.addEventListener('click', function(e) { e.stopPropagation(); var id = btn.getAttribute('data-id'); var notes = prompt('Feedback for designer:'); if (notes === null) return; fetch(getApiBaseUrl() + '/api/production/tasks/' + id + '/review', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'request_changes', reviewNotes: notes }) }).then(function(r) { return r.json(); }).then(function(j) { if (!j.task) throw new Error(j.error || 'Failed'); return loadProductionTasks(); }).then(renderProductionView).catch(function(e) { showToast(e.message, 'error'); }); });
  });
}
function openSendToDesignerModal(item) {
  var modal = document.getElementById('sendToDesignerModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sendToDesignerModal';
    modal.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 9999; display: none; align-items: center; justify-content: center;';
    modal.innerHTML = '<div style="background: white; border-radius: 12px; padding: 24px; max-width: 440px; width: 90%;"><h3 style="margin: 0 0 16px 0;">Send to Designer</h3><label style="display: block; margin-bottom: 8px; font-weight: 600;">Designer *</label><select id="sendToDesignerDesigner" style="width: 100%; padding: 8px; margin-bottom: 16px;"></select><label style="display: block; margin-bottom: 8px; font-weight: 600;">Priority *</label><select id="sendToDesignerPriority" style="width: 100%; padding: 8px; margin-bottom: 16px;"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option><option value="urgent">Urgent</option></select><label style="display: block; margin-bottom: 8px; font-weight: 600;">Deadline *</label><input type="date" id="sendToDesignerDeadline" style="width: 100%; padding: 8px; margin-bottom: 16px;"><label style="display: block; margin-bottom: 8px; font-weight: 600;">Notes for Designer (optional)</label><textarea id="sendToDesignerNotes" rows="3" style="width: 100%; padding: 8px; margin-bottom: 16px;"></textarea><div style="display: flex; gap: 8px; justify-content: flex-end;"><button type="button" id="sendToDesignerCancel" class="btn btn-secondary">Cancel</button><button type="button" id="sendToDesignerSubmit" style="padding: 8px 16px; background: #1a56db; color: white; border: none; border-radius: 8px; cursor: pointer;">Send to Designer</button></div></div>';
    document.body.appendChild(modal);
    document.getElementById('sendToDesignerCancel').addEventListener('click', function() { modal.style.display = 'none'; });
    document.getElementById('sendToDesignerSubmit').addEventListener('click', function() { submitSendToDesigner(modal); });
  }
  window.__sendToDesignerItem = item;
  var sel = document.getElementById('sendToDesignerDesigner');
  sel.innerHTML = '<option value="">Select designer</option>';
  loadDesigners().then(function(list) {
    if (list.length === 0) sel.innerHTML = '<option value="">No designers registered. Add a designer in Staff settings first.</option>';
    else list.forEach(function(d) {
      var opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = d.name + ' (' + d.email + ')';
      sel.appendChild(opt);
    });
  });
  var d = new Date();
  d.setDate(d.getDate() + 3);
  document.getElementById('sendToDesignerDeadline').value = d.toISOString().slice(0, 10);
  document.getElementById('sendToDesignerNotes').value = '';
  modal.style.display = 'flex';
}
function submitSendToDesigner(modal) {
  var item = window.__sendToDesignerItem;
  if (!item || !currentClientId) return;
  var designerId = document.getElementById('sendToDesignerDesigner').value;
  var priority = document.getElementById('sendToDesignerPriority').value;
  var deadline = document.getElementById('sendToDesignerDeadline').value;
  var notes = document.getElementById('sendToDesignerNotes').value;
  if (!designerId) { showToast('Select a designer', 'error'); return; }
  var designerOpt = document.getElementById('sendToDesignerDesigner').selectedOptions[0];
  var designerName = designerOpt && designerOpt.textContent ? designerOpt.textContent.split(' (')[0].trim() : 'designer';
  var refImages = [];
  if (item.imageUrls && item.imageUrls.length) refImages = refImages.concat(item.imageUrls);
  else if (item.imageUrl && item.imageUrl.trim()) refImages.push(item.imageUrl);
  // Deduplicate and filter empty
  refImages = refImages.filter(function(url, i, arr) { return url && url.trim() && arr.indexOf(url) === i; });
  var payload = { clientId: currentClientId, contentId: item.id, approvalId: item.id, designerId, title: item.title || '', caption: item.caption || '', copyText: item.copyText || '', referenceImages: refImages, briefNotes: notes, priority, deadline: deadline ? new Date(deadline).toISOString() : new Date().toISOString() };
  // If sent from Changes Requested section, create as changes_requested with the client note
  if (item._sendAsChangesRequested) {
    payload.initialStatus = 'changes_requested';
    payload.reviewNotes = 'Client change request: ' + (item._changeRequestNote || 'Change requested');
    delete item._sendAsChangesRequested;
    delete item._changeRequestNote;
  }
  fetch(getApiBaseUrl() + '/api/production/tasks', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    .then(function(r) { return r.json(); })
    .then(function(j) {
      if (!j.task) throw new Error(j.error || 'Failed');
      modal.style.display = 'none';
      showToast('Task sent to ' + designerName);
      renderApprovalsTab();
      if (currentViewMode === 'production') loadProductionTasks().then(renderProductionView);
    })
    .catch(function(e) { showToast(e.message || 'Failed', 'error'); });
}

/* ================== Initialize ================== */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    if (!currentStaff) {
      setTimeout(() => {
        if (!currentStaff) window.location.href = staffLoginUrl();
      }, 100);
      return;
    }
    isDesigner = currentStaff.role === 'DESIGNER';
    // Init AI Co-Pilot for all staff
    initAICopilot();
    try {
      updateStaffHeader();
    } catch (e) {
      console.error('updateStaffHeader failed:', e);
    }

    if (isDesigner) {
      document.getElementById('viewSwitcher').style.display = 'none';
      var headerSwitcher = document.getElementById('viewSwitcherInHeader');
      if (headerSwitcher) headerSwitcher.style.display = 'none';
      document.getElementById('dashboardSidebar').style.display = 'none';
      document.getElementById('dashboardMain').style.display = 'none';
      document.getElementById('productionViewContainer').style.display = 'flex';
      document.querySelector('.header__logo').textContent = '2FlyFlow Production';
      try {
        await loadProductionTasks();
        renderProductionView();
      } catch (e) {
        console.error('Production load failed:', e);
        showToast('Failed to load production tasks', 'error');
      }
      return;
    }

    document.getElementById('viewSwitcher').style.display = 'flex';
    var headerSwitcher = document.getElementById('viewSwitcherInHeader');
    if (headerSwitcher) headerSwitcher.style.display = 'flex';
    function updateProductionViewHeaderActive() {
      var btnD = document.getElementById('btnViewDashboardHeader');
      var btnP = document.getElementById('btnViewProductionHeader');
      if (btnD && btnP) {
        btnD.classList.toggle('view-switch-btn--active', currentViewMode === 'dashboard');
        btnP.classList.toggle('view-switch-btn--active', currentViewMode === 'production');
      }
    }
    updateProductionViewHeaderActive();
    if (!document.body._viewSwitcherDelegationBound) {
      document.body._viewSwitcherDelegationBound = true;
      document.body.addEventListener('click', function viewSwitcherClick(e) {
        var t = e.target && e.target.closest ? e.target.closest('[data-view="dashboard"], [data-view="production"]') : null;
        if (!t) return;
        var wrap = document.getElementById('viewSwitcherInHeader');
        if (!wrap || !wrap.contains(t)) return;
        e.preventDefault();
        e.stopPropagation();
        if (t.getAttribute('data-view') === 'production') {
          currentViewMode = 'production';
          switchToProductionView();
          updateProductionViewHeaderActive();
        } else if (t.getAttribute('data-view') === 'dashboard') {
          currentViewMode = 'dashboard';
          switchToDashboardView();
          updateProductionViewHeaderActive();
        }
      });
    }
    const btnDashboard = document.getElementById('btnViewDashboard');
    const btnProduction = document.getElementById('btnViewProduction');
    if (btnDashboard) btnDashboard.addEventListener('click', () => { currentViewMode = 'dashboard'; switchToDashboardView(); updateProductionViewHeaderActive(); });
    if (btnProduction) btnProduction.addEventListener('click', () => { currentViewMode = 'production'; switchToProductionView(); updateProductionViewHeaderActive(); });
    var btnDashboardHeader = document.getElementById('btnViewDashboardHeader');
    var btnProductionHeader = document.getElementById('btnViewProductionHeader');
    if (btnDashboardHeader) btnDashboardHeader.addEventListener('click', function(e) { e.preventDefault(); currentViewMode = 'dashboard'; switchToDashboardView(); updateProductionViewHeaderActive(); });
    if (btnProductionHeader) btnProductionHeader.addEventListener('click', function(e) { e.preventDefault(); currentViewMode = 'production'; switchToProductionView(); updateProductionViewHeaderActive(); });

    let clients = {};
    try {
      clients = await fetchClientsFromAPI();
      const last = localStorage.getItem(LS_LAST_CLIENT_KEY);
      if (!currentClientId && Object.keys(clients).length > 0) {
        currentClientId = (last && clients[last]) ? last : Object.keys(clients)[0];
      }
      if (currentClientId && clients[currentClientId]) {
        await fetchPortalStateFromAPI(currentClientId);
      } else {
        const firstId = Object.keys(clients)[0];
        if (firstId) {
          currentClientId = firstId;
          await fetchPortalStateFromAPI(currentClientId);
        }
      }
    } catch (e) {
      console.error('fetchClientsFromAPI/fetchPortalStateFromAPI failed:', e);
      let msg = e.message || '';
      if (msg.includes('Failed to fetch') || msg.includes('Load failed') || msg.includes('NetworkError')) {
        msg = 'Cannot reach the API. Start the backend: cd server && npm start';
      }
      showToast('Failed to load dashboard data. ' + msg, 'error');
    }

    const savedTab = localStorage.getItem('2fly_agency_current_tab');
    if (savedTab) {
      currentTab = savedTab;
    }
    
    try { setupTabHandlers(); } catch (e) { console.error('Error setting up tab handlers:', e); }
    try { setupApprovalHandlers(); } catch (e) { console.error('Error setting up approval handlers:', e); }
    try { setupScheduledPostsFilters(); } catch (e) { console.error('Error setting up scheduled posts filters:', e); }
    try { setupRequestsHandlers(); } catch (e) { console.error('Error setting up request handlers:', e); }
    try { setupNeedsHandlers(); } catch (e) { console.error('Error setting up needs handlers:', e); }
    try { setupAssetHandlers(); } catch (e) { console.error('Error setting up asset handlers:', e); }
    try { setupNewClientHandlers(); } catch (e) { console.error('Error setting up new client handlers:', e); }
    try { setupReportsHandlers(); } catch (e) { console.error('Error setting up reports handlers:', e); }
    try { setupPinInviteHandlers(); } catch (e) { console.error('Error setting up PIN invite handlers:', e); }
    try { setupSettingsModal(); } catch (e) { console.error('Error setting up settings modal:', e); }
    try { setupLogoUpload(); } catch (e) { console.error('Error setting up logo upload handlers:', e); }
    try { setupOnboarding(); } catch (e) { console.error('Error setting up onboarding:', e); }
    try { setupPipelineModal(); } catch (e) { console.error('Error setting up pipeline modal:', e); }
    try { setupViewAsClient(); } catch (e) { console.error('Error setting up view as client:', e); }
    try { setupHelpLink(); } catch (e) { console.error('Error setting up help link:', e); }
    try { setupOverviewAddFirstClient(); } catch (e) { console.error('Error setting up overview add first client:', e); }
    try { setupRequestMissingAssetsBtn(); } catch (e) { console.error('Error setting up request missing assets btn:', e); }
    try { setupContentLibraryLearnMore(); } catch (e) { console.error('Error setting up content library learn more:', e); }
    try { setupNotificationBell(); } catch (e) { console.error('Error setting up notification bell:', e); }

    // Poll portal state so client-side actions create agency notifications live (no refresh)
    function pollClientActions() {
      var clients = loadClientsRegistry();
      var ids = clients ? Object.keys(clients) : [];
      ids.forEach(function(cid) {
        fetchPortalStateFromAPI(cid).then(function() {
          if (typeof renderNotificationBell === 'function') renderNotificationBell();
        }).catch(function(err) {
          console.warn('Agency poll portal state failed for', cid, err && err.message);
        });
      });
    }
    // Baseline: fetch all clients so we have prev state for diffing (no notifications on first run)
    (function baselineThenPoll() {
      var clients = loadClientsRegistry();
      var ids = clients ? Object.keys(clients) : [];
      if (ids.length === 0) {
        setInterval(pollClientActions, 5000);
        return;
      }
      Promise.all(ids.map(function(cid) { return fetchPortalStateFromAPI(cid).catch(function() {}); })).then(function() {
        if (typeof renderNotificationBell === 'function') renderNotificationBell();
        setInterval(pollClientActions, 5000);
        setTimeout(pollClientActions, 2000);
        if (typeof maybeGenerateMonthlyProgressSummaryNotifications === 'function') maybeGenerateMonthlyProgressSummaryNotifications();
      });
    })();

    try {
      renderAll();
      renderNotificationBell();
    } catch (e) {
      console.error('Error rendering initial view:', e);
    }
    
    if (savedTab) {
      try { switchTab(savedTab); } catch (e) { console.error('Error switching to saved tab:', e); }
    }
    if (location.hash && typeof applyNotificationAction === 'function') {
      try { applyNotificationAction(location.hash); } catch (e) { console.warn('Hash apply:', e); }
    }
    window.addEventListener('hashchange', function () {
      if (location.hash && typeof applyNotificationAction === 'function') applyNotificationAction(location.hash);
    });

    try {
      updateOnboardingChecklistSidebar();
    } catch (e) {
      console.error('Error updating onboarding checklist sidebar:', e);
    }
    try {
      const clientsForOnboarding = loadClientsRegistry();
      if (shouldAutoShowOnboarding(clientsForOnboarding)) {
        setHasSeenOnboarding();
        showOnboardingOverlay(1);
      } else {
        hideOnboardingOverlay();
      }
    } catch (e) {
      console.error('Error showing onboarding overlay:', e);
      hideOnboardingOverlay();
    }

    // Action-driving layer: console checklist
    try {
      const lastStored = localStorage.getItem(LS_LAST_CLIENT_KEY);
      const clients = loadClientsRegistry();
      const restored = !!(lastStored && clients[lastStored]);
      const summary = getGlobalStatusSummary();
      const nextLabel = currentClientId ? computeNextAction(getClientHealthData(currentClientId)).label : '—';
      Object.keys(clients).forEach(id => {
        const h = computeHealth(getClientHealthData(id));
      });
    } catch (e) { console.warn('Checklist log:', e); }

    var notifs = loadNotifications();
    var actionUnread = notifs.filter(function(n) { return n.type === 'ACTION' && !n.read; });
    var clearEl = document.getElementById('headerClearToday');
  } catch (e) {
    console.error('Fatal error during agency dashboard initialization:', e);
    alert('An error occurred while loading the dashboard. Please check the console for details.');
  }

});

// ══════════════════════════════════════════════════════════════
// AI CO-PILOT — floating chat for designers
// ══════════════════════════════════════════════════════════════
var copilotConversation = [];
var copilotOpen = false;
var copilotLoading = false;
var copilotLang = localStorage.getItem('copilot_lang') || 'en'; // 'en' | 'pt'
var copilotSavedPrompts = JSON.parse(localStorage.getItem('copilot_saved') || '[]');
var copilotPendingImage = null; // { url, dataUrl, name }
var copilotAutoSuggestionShown = false;

var COPILOT_CHEERS_EN = [
  "Hey, you're doing great! \u{1F525}",
  "Looking good! Keep it up \u{1F4AA}",
  "You're on fire today! \u{1F680}",
  "Nice work! Almost there \u{2728}",
  "Crushing it! \u{1F3AF}",
  "That's some A+ work \u{1F31F}",
  "Love the progress! \u{1F60D}",
  "You got this! \u{1F4A5}",
  "Smooth workflow today \u{1F3B6}",
  "Creative genius at work \u{1F9E0}",
  "Taking names today! \u{26A1}",
  "Your work is \u{1F44C} chef's kiss",
  "Need anything? I'm here! \u{1F44B}",
  "Keep that momentum! \u{1F3C3}",
  "Design magic happening \u{2728}\u{1F3A8}"
];
var COPILOT_CHEERS_PT = [
  "Ei, voc\u00ea t\u00e1 mandando bem! \u{1F525}",
  "T\u00e1 lindo! Continua assim \u{1F4AA}",
  "Voc\u00ea t\u00e1 on fire hoje! \u{1F680}",
  "\u00D3timo trabalho! Quase l\u00e1 \u{2728}",
  "Arrasando! \u{1F3AF}",
  "Trabalho nota 10 \u{1F31F}",
  "Amei o progresso! \u{1F60D}",
  "Voc\u00ea consegue! \u{1F4A5}",
  "Fluxo suave hoje \u{1F3B6}",
  "G\u00eanio criativo em a\u00e7\u00e3o \u{1F9E0}",
  "Que workflow! \u{26A1}",
  "Seu trabalho t\u00e1 \u{1F44C} demais",
  "Precisa de algo? T\u00f4 aqui! \u{1F44B}",
  "Mant\u00e9m o ritmo! \u{1F3C3}",
  "Magia do design acontecendo \u{2728}\u{1F3A8}"
];
var copilotLastCheerIdx = -1;
var copilotSpeechTimer = null;

function showCopilotCheer() {
  var panel = document.getElementById('copilot-panel');
  if (panel && !panel.classList.contains('copilot-panel--hidden')) return; // don't show if chat is open
  var speechEl = document.getElementById('copilot-speech');
  if (!speechEl) return;
  var cheers = copilotLang === 'pt' ? COPILOT_CHEERS_PT : COPILOT_CHEERS_EN;
  var idx = copilotLastCheerIdx;
  while (idx === copilotLastCheerIdx) { idx = Math.floor(Math.random() * cheers.length); }
  copilotLastCheerIdx = idx;
  speechEl.textContent = cheers[idx];
  speechEl.style.display = 'block';
  speechEl.style.animation = 'none';
  void speechEl.offsetWidth; // reflow
  speechEl.style.animation = 'copilotSpeechIn 4.5s ease forwards';
  setTimeout(function() { speechEl.style.display = 'none'; }, 4600);
}

function startCopilotCheers() {
  // First cheer after 15-25s, then every 45-90s
  function scheduleNext() {
    var delay = 45000 + Math.floor(Math.random() * 45000);
    copilotSpeechTimer = setTimeout(function() {
      showCopilotCheer();
      scheduleNext();
    }, delay);
  }
  // Initial cheer
  setTimeout(function() {
    showCopilotCheer();
    scheduleNext();
  }, 15000 + Math.floor(Math.random() * 10000));
}

function initAICopilot() {
  if (document.getElementById('copilot-bubble')) return;
  var wrapper = document.createElement('div');
  wrapper.id = 'copilot-wrapper';
  wrapper.innerHTML = getCopilotHTML();
  document.body.appendChild(wrapper);
  bindCopilotEvents();
  updateCopilotContext();
  startCopilotCheers();
}

function getCopilotContextInfo() {
  var taskId = currentProductionTaskId || null;
  var task = null, clientName = '';
  if (taskId && productionTasksCache) {
    task = productionTasksCache.find(function(t) { return t.id === taskId; });
  }
  if (task) {
    var cd = loadClientsRegistry ? loadClientsRegistry() : null;
    clientName = (cd && cd[task.clientId] && cd[task.clientId].name) || task.clientId || '';
  }
  return { task: task, clientName: clientName, taskId: taskId };
}

function updateCopilotContext() {
  var ctx = getCopilotContextInfo();
  var el = document.getElementById('copilot-context');
  if (!el) return;
  if (ctx.task) {
    var caption = (ctx.task.title || ctx.task.caption || 'Untitled').slice(0, 35);
    if ((ctx.task.title || ctx.task.caption || '').length > 35) caption += '...';
    el.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> ' +
      '<span>' + (ctx.clientName || '').replace(/</g, '&lt;') + '</span> &middot; ' +
      '<span>' + caption.replace(/</g, '&lt;') + '</span>';
    el.style.display = 'flex';
    // #5: Auto-suggestion for revision tasks
    checkCopilotAutoSuggestion(ctx.task);
  } else {
    el.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72 1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg> No task selected — open a task for full context';
    el.style.display = 'flex';
  }
}

// #5: Smart auto-suggestion for revision tasks
function checkCopilotAutoSuggestion(task) {
  if (copilotAutoSuggestionShown) return;
  if (task.status === 'changes_requested' && task.reviewNotes && task.reviewNotes.trim()) {
    copilotAutoSuggestionShown = true;
    // Pulse the bubble
    var bubble = document.getElementById('copilot-bubble');
    if (bubble && !copilotOpen) {
      bubble.classList.add('copilot-bubble--pulse');
      // Add suggestion badge
      var badge = document.createElement('span');
      badge.className = 'copilot-bubble__badge';
      badge.textContent = '!';
      bubble.appendChild(badge);
    }
    // If panel is open, show auto-suggestion
    if (copilotOpen) { showAutoSuggestion(task); }
    // Save for when panel opens
    window._copilotPendingSuggestion = task;
  }
}

function showAutoSuggestion(task) {
  var messagesEl = document.getElementById('copilot-messages');
  if (!messagesEl) return;
  if (messagesEl.querySelector('.copilot-auto-suggest')) return;
  var suggest = document.createElement('div');
  suggest.className = 'copilot-auto-suggest';
  suggest.innerHTML = '<p class="copilot-auto-suggest__text">I see revision notes on this task:</p>' +
    '<p class="copilot-auto-suggest__note">"' + (task.reviewNotes || '').replace(/</g, '&lt;').slice(0, 120) + '"</p>' +
    '<button class="copilot-auto-suggest__btn" data-action="address_revision">Help me address this feedback</button>';
  messagesEl.appendChild(suggest);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  suggest.querySelector('.copilot-auto-suggest__btn').addEventListener('click', function() {
    suggest.remove();
    sendCopilotMessage('improve_copy');
  });
}

function getCopilotHTML() {
  var langBtnEn = copilotLang === 'en' ? 'copilot-lang-btn--active' : '';
  var langBtnPt = copilotLang === 'pt' ? 'copilot-lang-btn--active' : '';
  return '' +
    '<button id="copilot-bubble" class="copilot-bubble" title="AI Co-Pilot">' +
    '<svg class="copilot-avatar" width="96" height="96" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">' +
    /* chair */
    '<rect x="24" y="72" rx="5" width="44" height="7" fill="#7c3aed" opacity="0.9"/>' +
    '<rect x="22" y="68" rx="3" width="5" height="10" fill="#6d28d9"/>' +
    '<rect x="65" y="68" rx="3" width="5" height="10" fill="#6d28d9"/>' +
    '<rect x="26" y="79" rx="2" width="5" height="12" fill="#6d28d9"/>' +
    '<rect x="61" y="79" rx="2" width="5" height="12" fill="#6d28d9"/>' +
    /* dangling legs */
    '<g class="copilot-avatar__leg-l"><rect x="36" y="72" rx="3" width="7" height="16" fill="#1e293b"/><rect x="35" y="85" rx="3" width="9" height="5" fill="#4338ca"/></g>' +
    '<g class="copilot-avatar__leg-r"><rect x="51" y="72" rx="3" width="7" height="16" fill="#1e293b"/><rect x="50" y="85" rx="3" width="9" height="5" fill="#4338ca"/></g>' +
    /* body hoodie */
    '<rect x="32" y="46" rx="8" width="30" height="28" fill="#2563eb"/>' +
    '<path d="M42 46 L47 56 L52 46" fill="#3b82f6" opacity="0.5"/>' +
    '<circle cx="47" cy="50" r="1.5" fill="#93c5fd" opacity="0.6"/>' +
    /* head group */
    '<g class="copilot-avatar__head">' +
    '<rect x="44" y="42" width="6" height="6" fill="#fbbf24" rx="2"/>' +
    '<circle cx="47" cy="32" r="16" fill="#fbbf24"/>' +
    '<path d="M31 30c0-10 7-17 16-17s16 7 16 17" fill="#4338ca"/>' +
    '<ellipse cx="47" cy="18" rx="14" ry="5" fill="#4338ca"/>' +
    '<path d="M33 26 Q31 20 34 16" stroke="#4338ca" stroke-width="4" fill="none" stroke-linecap="round"/>' +
    '<g class="copilot-avatar__eyes">' +
    '<ellipse cx="41" cy="33" rx="2.5" ry="2.8" fill="#1e1b4b"/>' +
    '<ellipse cx="53" cy="33" rx="2.5" ry="2.8" fill="#1e1b4b"/>' +
    '<circle cx="40" cy="32" r="0.8" fill="#fff"/>' +
    '<circle cx="52" cy="32" r="0.8" fill="#fff"/>' +
    '</g>' +
    '<path d="M38 28 Q41 26 43 28" stroke="#312e81" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
    '<path d="M51 28 Q53 26 56 28" stroke="#312e81" stroke-width="1.2" fill="none" stroke-linecap="round"/>' +
    '<path d="M42 39 Q47 44 52 39" stroke="#92400e" stroke-width="1.8" fill="none" stroke-linecap="round"/>' +
    '<ellipse cx="37" cy="37" rx="3" ry="2" fill="#f59e0b" opacity="0.3"/>' +
    '<ellipse cx="57" cy="37" rx="3" ry="2" fill="#f59e0b" opacity="0.3"/>' +
    '<path d="M31 30 Q29 22 31 17" stroke="#6d28d9" stroke-width="3.5" stroke-linecap="round" fill="none"/>' +
    '<path d="M63 30 Q65 22 63 17" stroke="#6d28d9" stroke-width="3.5" stroke-linecap="round" fill="none"/>' +
    '<rect x="27" y="27" rx="4" width="7" height="9" fill="#7c3aed"/>' +
    '<rect x="60" y="27" rx="4" width="7" height="9" fill="#7c3aed"/>' +
    '<rect x="28" y="29" rx="2" width="5" height="5" fill="#a78bfa" opacity="0.4"/>' +
    '<rect x="61" y="29" rx="2" width="5" height="5" fill="#a78bfa" opacity="0.4"/>' +
    '</g>' +
    /* laptop */
    '<rect x="34" y="64" rx="3" width="26" height="3" fill="#a78bfa"/>' +
    '<rect x="35" y="56" rx="2" width="24" height="9" fill="#c4b5fd"/>' +
    '<rect x="37" y="57" rx="1" width="20" height="7" fill="#818cf8" opacity="0.4"/>' +
    '<rect x="39" y="58" rx="0.5" width="16" height="2" fill="#e0e7ff" opacity="0.6"/>' +
    '<rect x="39" y="61" rx="0.5" width="10" height="1.5" fill="#e0e7ff" opacity="0.4"/>' +
    /* typing hands */
    '<g class="copilot-avatar__typing">' +
    '<ellipse cx="39" cy="56" rx="4" ry="3" fill="#fbbf24"/>' +
    '<ellipse cx="55" cy="56" rx="4" ry="3" fill="#fbbf24"/>' +
    '</g>' +
    /* wave hand */
    '<g class="copilot-avatar__hand">' +
    '<ellipse cx="72" cy="48" rx="5" ry="4.5" fill="#fbbf24"/>' +
    '<rect x="70" y="41" rx="2" width="3.5" height="6" fill="#fbbf24" transform="rotate(-15 71 44)"/>' +
    '<rect x="73" y="42" rx="2" width="3" height="5" fill="#fbbf24" transform="rotate(5 74 44)"/>' +
    '</g>' +
    '</svg>' +
    '</button>' +
    '<div id="copilot-speech" class="copilot-speech" style="display:none;"></div>' +
    '<div id="copilot-panel" class="copilot-panel copilot-panel--hidden">' +
    // Header
    '<div class="copilot-header">' +
    '<div class="copilot-header__left">' +
    '<div class="copilot-header__icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a7 7 0 0 1 7 7c0 3-2 5.5-4 7l-3 3-3-3c-2-1.5-4-4-4-7a7 7 0 0 1 7-7z"/><circle cx="12" cy="9" r="1.5" fill="currentColor" stroke="none"/></svg></div>' +
    '<div><p class="copilot-header__title">2Fly Co-Pilot</p><p class="copilot-header__sub">AI assistant for ' + (isDesigner ? 'designers' : 'your team') + '</p></div>' +
    '</div>' +
    '<div class="copilot-header__right-btns">' +
    // #6: Language toggle
    '<div class="copilot-lang-toggle">' +
    '<button class="copilot-lang-btn ' + langBtnEn + '" data-lang="en">EN</button>' +
    '<button class="copilot-lang-btn ' + langBtnPt + '" data-lang="pt">PT</button>' +
    '</div>' +
    // #4: Saved prompts button
    '<button id="copilot-saved-btn" class="copilot-header-btn" title="Saved Prompts"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>' +
    (copilotSavedPrompts.length > 0 ? '<span class="copilot-saved-count">' + copilotSavedPrompts.length + '</span>' : '') +
    '</button>' +
    '<button id="copilot-close" class="copilot-close">&times;</button>' +
    '</div></div>' +
    // #2: Context indicator
    '<div id="copilot-context" class="copilot-context"></div>' +
    // Quick actions (role-aware)
    '<div class="copilot-actions">' +
    (isDesigner ?
      '<button class="copilot-action-btn" data-action="generate_prompt"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Generate Prompt</button>' +
      '<button class="copilot-action-btn" data-action="give_ideas"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> Give Ideas</button>' +
      '<button class="copilot-action-btn" data-action="improve_copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Improve Copy</button>' +
      '<button class="copilot-action-btn" data-action="references"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg> References</button>' +
      '<button class="copilot-action-btn" data-action="variations"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="7" width="6" height="10" rx="1"/><rect x="9" y="4" width="6" height="16" rx="1"/><rect x="16" y="7" width="6" height="10" rx="1"/></svg> Variations</button>'
    :
      '<button class="copilot-action-btn" data-action="write_caption"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg> Write Caption</button>' +
      '<button class="copilot-action-btn" data-action="hashtag_strategy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg> Hashtags</button>' +
      '<button class="copilot-action-btn" data-action="content_ideas"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg> Content Ideas</button>' +
      '<button class="copilot-action-btn" data-action="improve_copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Improve Copy</button>' +
      '<button class="copilot-action-btn" data-action="strategy_tips"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Strategy Tips</button>'
    ) +
    '</div>' +
    // Messages
    '<div id="copilot-messages" class="copilot-messages">' +
    '<div class="copilot-welcome">' +
    '<p class="copilot-welcome__emoji">&#9889;</p>' +
    '<p class="copilot-welcome__title">Hey! I\'m your Co-Pilot.</p>' +
    '<p class="copilot-welcome__sub">' + (isDesigner
      ? 'Ask me anything or hit a quick action. I already know your current task and client.'
      : 'Write captions, get hashtags, brainstorm content ideas, or ask me anything about social media strategy.') + '</p>' +
    '</div></div>' +
    // #3: Image preview area
    '<div id="copilot-image-preview" class="copilot-image-preview" style="display:none;"></div>' +
    // #4: Saved prompts dropdown
    '<div id="copilot-saved-panel" class="copilot-saved-panel" style="display:none;"></div>' +
    // Input area
    '<div class="copilot-input-area">' +
    '<div class="copilot-input-wrap">' +
    // #3: Image upload button
    '<button id="copilot-img-btn" class="copilot-img-btn" title="Attach image"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg></button>' +
    '<input type="file" id="copilot-img-input" accept="image/*,video/mp4,video/quicktime,video/webm" style="display:none;" />' +
    '<input type="text" id="copilot-input" class="copilot-input" placeholder="Ask anything..." />' +
    '<button id="copilot-send" class="copilot-send" title="Send"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button>' +
    '</div></div></div>';
}

function bindCopilotEvents() {
  var bubble = document.getElementById('copilot-bubble');
  var closeBtn = document.getElementById('copilot-close');
  var input = document.getElementById('copilot-input');
  var sendBtn = document.getElementById('copilot-send');

  if (bubble) bubble.addEventListener('click', function() {
    toggleCopilot(true);
    // Show pending auto-suggestion
    if (window._copilotPendingSuggestion) {
      showAutoSuggestion(window._copilotPendingSuggestion);
      window._copilotPendingSuggestion = null;
      bubble.classList.remove('copilot-bubble--pulse');
      var badge = bubble.querySelector('.copilot-bubble__badge');
      if (badge) badge.remove();
    }
  });
  if (closeBtn) closeBtn.addEventListener('click', function() { toggleCopilot(false); });
  if (input) input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCopilotMessage(); }
  });
  if (sendBtn) sendBtn.addEventListener('click', function() { sendCopilotMessage(); });

  // Quick action buttons
  document.querySelectorAll('.copilot-action-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { sendCopilotMessage(btn.getAttribute('data-action')); });
  });

  // #6: Language toggle
  document.querySelectorAll('.copilot-lang-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      copilotLang = btn.getAttribute('data-lang');
      localStorage.setItem('copilot_lang', copilotLang);
      document.querySelectorAll('.copilot-lang-btn').forEach(function(b) { b.classList.remove('copilot-lang-btn--active'); });
      btn.classList.add('copilot-lang-btn--active');
    });
  });

  // #3: Image upload
  var imgBtn = document.getElementById('copilot-img-btn');
  var imgInput = document.getElementById('copilot-img-input');
  if (imgBtn && imgInput) {
    imgBtn.addEventListener('click', function() { imgInput.click(); });
    imgInput.addEventListener('change', function() {
      var file = imgInput.files[0];
      if (!file || !file.type.startsWith('image/')) return;
      var reader = new FileReader();
      reader.onload = function() {
        // Upload to get URL
        fetch(getApiBaseUrl() + '/api/upload/image', {
          method: 'POST', credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: reader.result })
        }).then(function(r) { return r.json(); }).then(function(j) {
          if (j.url) {
            copilotPendingImage = { url: j.url, dataUrl: reader.result, name: file.name };
            showImagePreview();
          }
        }).catch(function() { showToast('Image upload failed', 'error'); });
      };
      reader.readAsDataURL(file);
      imgInput.value = '';
    });
  }

  // #4: Saved prompts button
  var savedBtn = document.getElementById('copilot-saved-btn');
  if (savedBtn) savedBtn.addEventListener('click', function() { toggleSavedPrompts(); });
}

// #3: Image preview
function showImagePreview() {
  var el = document.getElementById('copilot-image-preview');
  if (!el || !copilotPendingImage) return;
  el.style.display = 'flex';
  el.innerHTML = '<img src="' + copilotPendingImage.dataUrl + '" class="copilot-image-preview__img" />' +
    '<span class="copilot-image-preview__name">' + (copilotPendingImage.name || 'image').replace(/</g, '&lt;') + '</span>' +
    '<button class="copilot-image-preview__remove" title="Remove">&times;</button>';
  el.querySelector('.copilot-image-preview__remove').addEventListener('click', function() {
    copilotPendingImage = null;
    el.style.display = 'none';
    el.innerHTML = '';
  });
}

// #4: Saved prompts panel
function toggleSavedPrompts() {
  var panel = document.getElementById('copilot-saved-panel');
  if (!panel) return;
  if (panel.style.display === 'none') {
    renderSavedPrompts();
    panel.style.display = 'block';
  } else {
    panel.style.display = 'none';
  }
}

function renderSavedPrompts() {
  var panel = document.getElementById('copilot-saved-panel');
  if (!panel) return;
  if (copilotSavedPrompts.length === 0) {
    panel.innerHTML = '<div class="copilot-saved-empty">No saved prompts yet. Click the &#9734; on any AI response to save it.</div>';
    return;
  }
  var h = '<div class="copilot-saved-header"><span>Saved Prompts</span><button class="copilot-saved-close">&times;</button></div>';
  copilotSavedPrompts.forEach(function(p, i) {
    h += '<div class="copilot-saved-item" data-idx="' + i + '">' +
      '<p class="copilot-saved-item__text">' + (p.text || '').replace(/</g, '&lt;').slice(0, 80) + (p.text.length > 80 ? '...' : '') + '</p>' +
      '<div class="copilot-saved-item__actions">' +
      '<button class="copilot-saved-item__use" data-idx="' + i + '" title="Use this prompt">Use</button>' +
      '<button class="copilot-saved-item__copy" data-idx="' + i + '" title="Copy">Copy</button>' +
      '<button class="copilot-saved-item__del" data-idx="' + i + '" title="Delete">&times;</button>' +
      '</div></div>';
  });
  panel.innerHTML = h;
  // Bind
  panel.querySelector('.copilot-saved-close').addEventListener('click', function() { panel.style.display = 'none'; });
  panel.querySelectorAll('.copilot-saved-item__use').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.getAttribute('data-idx'));
      var inp = document.getElementById('copilot-input');
      if (inp && copilotSavedPrompts[idx]) { inp.value = copilotSavedPrompts[idx].text; inp.focus(); }
      panel.style.display = 'none';
    });
  });
  panel.querySelectorAll('.copilot-saved-item__copy').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.getAttribute('data-idx'));
      if (copilotSavedPrompts[idx]) {
        navigator.clipboard.writeText(copilotSavedPrompts[idx].text).then(function() { showToast('Copied!'); });
      }
    });
  });
  panel.querySelectorAll('.copilot-saved-item__del').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(btn.getAttribute('data-idx'));
      copilotSavedPrompts.splice(idx, 1);
      localStorage.setItem('copilot_saved', JSON.stringify(copilotSavedPrompts));
      renderSavedPrompts();
      updateSavedCount();
    });
  });
}

function saveCopilotPrompt(text) {
  copilotSavedPrompts.push({ text: text, date: new Date().toISOString() });
  localStorage.setItem('copilot_saved', JSON.stringify(copilotSavedPrompts));
  updateSavedCount();
  showToast('Prompt saved!');
}

function updateSavedCount() {
  var btn = document.getElementById('copilot-saved-btn');
  if (!btn) return;
  var existing = btn.querySelector('.copilot-saved-count');
  if (existing) existing.remove();
  if (copilotSavedPrompts.length > 0) {
    var sp = document.createElement('span');
    sp.className = 'copilot-saved-count';
    sp.textContent = copilotSavedPrompts.length;
    btn.appendChild(sp);
  }
}

function toggleCopilot(open) {
  copilotOpen = open;
  var panel = document.getElementById('copilot-panel');
  var bubble = document.getElementById('copilot-bubble');
  if (panel) {
    if (open) {
      panel.classList.remove('copilot-panel--hidden');
      panel.classList.add('copilot-panel--visible');
      updateCopilotContext();
      var inp = document.getElementById('copilot-input');
      if (inp) setTimeout(function() { inp.focus(); }, 100);
    } else {
      panel.classList.add('copilot-panel--hidden');
      panel.classList.remove('copilot-panel--visible');
      var savedPanel = document.getElementById('copilot-saved-panel');
      if (savedPanel) savedPanel.style.display = 'none';
    }
  }
  if (bubble) bubble.style.display = open ? 'none' : 'flex';
  var speechEl = document.getElementById('copilot-speech');
  if (speechEl && open) { speechEl.style.display = 'none'; }
}

function appendCopilotMessage(role, content) {
  var messagesEl = document.getElementById('copilot-messages');
  if (!messagesEl) return;
  var welcome = messagesEl.querySelector('.copilot-welcome');
  if (welcome) welcome.remove();

  var msgDiv = document.createElement('div');
  msgDiv.className = 'copilot-msg copilot-msg--' + role;

  if (role === 'assistant') {
    var html = content
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/^- (.+)$/gm, '<span class="copilot-bullet">&bull;</span> $1')
      .replace(/^\d+\. (.+)$/gm, function(m, p1) { return '<span class="copilot-bullet">' + m.split('.')[0] + '.</span> ' + p1; })
      .replace(/\n/g, '<br>');
    // #1: Copy + #4: Save buttons
    msgDiv.innerHTML = '<div class="copilot-msg__content">' + html + '</div>' +
      '<div class="copilot-msg__toolbar">' +
      '<button class="copilot-msg__copy" title="Copy to clipboard"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button>' +
      '<button class="copilot-msg__save" title="Save prompt"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Save</button>' +
      '</div>';
    // Bind copy + save
    var rawText = content;
    msgDiv.querySelector('.copilot-msg__copy').addEventListener('click', function() {
      navigator.clipboard.writeText(rawText).then(function() {
        var btn = msgDiv.querySelector('.copilot-msg__copy');
        btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Copied!';
        setTimeout(function() { btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy'; }, 2000);
      });
    });
    msgDiv.querySelector('.copilot-msg__save').addEventListener('click', function() {
      saveCopilotPrompt(rawText);
      var btn = msgDiv.querySelector('.copilot-msg__save');
      btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="#2563eb" stroke="#2563eb" stroke-width="2" stroke-linecap="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg> Saved!';
    });
  } else {
    msgDiv.textContent = content;
  }

  messagesEl.appendChild(msgDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showCopilotLoading() {
  var messagesEl = document.getElementById('copilot-messages');
  if (!messagesEl) return;
  var loader = document.createElement('div');
  loader.className = 'copilot-msg copilot-msg--assistant copilot-msg--loading';
  loader.id = 'copilot-loader';
  loader.innerHTML = '<span class="copilot-typing"><span></span><span></span><span></span></span>';
  messagesEl.appendChild(loader);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function hideCopilotLoading() {
  var loader = document.getElementById('copilot-loader');
  if (loader) loader.remove();
}

function sendCopilotMessage(action) {
  if (copilotLoading) return;
  var input = document.getElementById('copilot-input');
  var message = input ? input.value.trim() : '';

  if (action && !message) {
    var actionLabels = isDesigner ? {
      generate_prompt: 'Generate a prompt for this task',
      give_ideas: 'Give me visual ideas for this task',
      improve_copy: 'Improve the copy for this task',
      references: 'Suggest visual references for this task',
      variations: 'Create variations of this concept'
    } : {
      write_caption: 'Write a caption for this post',
      hashtag_strategy: 'Create a hashtag strategy for this post',
      content_ideas: 'Give me content ideas for this client',
      improve_copy: 'Improve the copy for this post',
      strategy_tips: 'Give me strategy tips for this client'
    };
    message = actionLabels[action] || 'Help me with this task';
  }
  if (!message && !copilotPendingImage) return;
  if (!message && copilotPendingImage) message = 'Analyze this image and suggest improvements';
  if (input) input.value = '';

  // Show user message (with image thumbnail if attached)
  if (copilotPendingImage) {
    appendCopilotMessage('user', '📎 [Image attached] ' + message);
  } else {
    appendCopilotMessage('user', message);
  }
  copilotConversation.push({ role: 'user', content: message });

  // Context
  var ctx = getCopilotContextInfo();

  copilotLoading = true;
  showCopilotLoading();
  document.querySelectorAll('.copilot-action-btn').forEach(function(b) { b.disabled = true; });

  var requestBody = {
    message: message,
    action: action || null,
    taskId: ctx.taskId,
    clientId: ctx.task ? ctx.task.clientId : null,
    language: copilotLang,
    role: isDesigner ? 'designer' : 'agency',
    conversationHistory: copilotConversation.slice(-8)
  };
  // #3: Attach image URL if present
  if (copilotPendingImage) {
    requestBody.imageUrl = copilotPendingImage.url;
    copilotPendingImage = null;
    var imgPreview = document.getElementById('copilot-image-preview');
    if (imgPreview) { imgPreview.style.display = 'none'; imgPreview.innerHTML = ''; }
  }

  fetch(getApiBaseUrl() + '/api/ai-copilot/chat', {
    method: 'POST', credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    hideCopilotLoading();
    copilotLoading = false;
    document.querySelectorAll('.copilot-action-btn').forEach(function(b) { b.disabled = false; });
    if (data.error) { appendCopilotMessage('assistant', '⚠️ ' + data.error); return; }
    var reply = data.reply || 'No response.';
    appendCopilotMessage('assistant', reply);
    copilotConversation.push({ role: 'assistant', content: reply });
  })
  .catch(function(err) {
    hideCopilotLoading();
    copilotLoading = false;
    document.querySelectorAll('.copilot-action-btn').forEach(function(b) { b.disabled = false; });
    appendCopilotMessage('assistant', '⚠️ Connection error. Check your internet.');
  });
}

// Update context whenever task changes
var _origRenderProdView = typeof renderProductionView === 'function' ? renderProductionView : null;
if (_origRenderProdView) {
  var _origRPVRef = renderProductionView;
  // We patch via a post-render hook instead of overriding to avoid breaking the function
  setInterval(function() { if (copilotOpen) updateCopilotContext(); }, 2000);
}

