/* ================== Agency Dashboard Script ================== */
console.log('agency.js file loaded successfully');

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

// Agency-scoped data from API (dashboard is agencyId-scoped; only prefs use userId).
let clientsRegistryCache = {};
let portalStateCache = {};
// Track which clients have been successfully fetched from the API.
// save() is blocked until the client's state has been loaded at least once,
// preventing empty/default state from overwriting real server data.
const portalStateFetched = new Set();

function getApiBaseUrl() {
  return (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:3001'
    : 'https://api.2flyflow.com';
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

async function parseJsonOrThrow(r) {
  const ct = r.headers.get('content-type') || '';
  const text = await r.text();
  if (!ct.includes('application/json') || text.trim().startsWith('<')) {
    const hint = isLocal() ? ' Make sure the backend is running: cd server && npm start' : '';
    throw new Error('API returned HTML instead of JSON. Is the server running on ' + getApiBaseUrl() + '?' + hint);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error('Invalid API response: ' + (e.message || 'parse error'));
  }
}

async function fetchClientsFromAPI() {
  const r = await fetch(`${getApiBaseUrl()}/api/agency/clients`, {
    method: 'GET',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' }
  });
  const j = await parseJsonOrThrow(r);
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
              console.log('Agency: client action detected – approved', a.title, clientId);
              createNotification({ type: 'PROGRESS', title: 'Client approved', message: (a.title || 'Post') + ' was approved by client.', clientId: clientId, action: { label: 'View approvals', href: '#approvals' } });
            }
          } else if (newStatus === 'changes' || newStatus === 'copy_changes') {
            if (oldStatus === 'pending' || oldStatus === 'copy_pending' || oldStatus === 'copy_approved' || !oldStatus) {
              console.log('Agency: client action detected – requested changes', a.title, clientId);
              createNotification({ type: 'ACTION', title: 'Client requested changes', message: (a.title || 'Post') + ' – client requested changes.', clientId: clientId, action: { label: 'View approvals', href: '#approvals' } });
            }
          }
        }
      });
      prevApprovals.forEach(function(a) {
        if (!dataIds[a.id]) {
          console.log('Agency: client action detected – deleted post', a.title, clientId);
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
          console.log('Agency: client action detected – new request', r.type, clientId);
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
      item.innerHTML = '<span class="notif-item__icon">' + icon + '</span><div class="notif-item__body"><div class="notif-item__title">' + (n.title || '').replace(/</g, '&lt;') + '</div><div class="notif-item__message">' + (n.message || '').replace(/</g, '&lt;') + '</div><div class="notif-item__time">' + timeAgo(n.createdAt) + '</div></div>';
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

  console.log('Monthly progress summary: monthKey=' + monthKey + ', clientsProcessed=' + clientIds.length + ', notificationsCreated=' + created);
  logReasons.forEach(function (r) { console.log('  ' + r.clientId + ': ' + r.reason); });

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
    case 'reports':
      renderReportsTab();
      break;
    default:
      break;
  }
}

// Setup tab click handlers - will be called after DOM loads
function setupTabHandlers() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });
}

/* ================== Overview Tab ================== */
function renderOverviewTab() {
  const state = load();
  const clients = loadClientsRegistry();
  const hasClients = Object.keys(clients).length > 0;
  const overviewEmpty = $('#overviewEmptyNoClient');
  const overviewContent = $('#overviewContent');
  if (overviewEmpty) overviewEmpty.style.display = !hasClients ? 'block' : 'none';
  if (overviewContent) overviewContent.style.display = hasClients ? 'block' : 'none';

  // Calculate scheduled posts from approvals with postDate within next 15 days
  const scheduledCount = calculateScheduledPosts(state.approvals || []);
  if (state.kpis) {
    const prevScheduled = state.kpis.scheduled;
    state.kpis.scheduled = scheduledCount;
    if (prevScheduled !== scheduledCount && portalStateFetched.has(currentClientId)) {
      save(state);
    }
  }

  const kpiScheduled = $('#kpiScheduled');
  if (kpiScheduled) kpiScheduled.textContent = scheduledCount;
  const cardScheduledSub = $('#cardScheduled')?.querySelector('.card__sub');
  if (cardScheduledSub) {
    if (scheduledCount === 0) cardScheduledSub.textContent = '⚠️ Nothing scheduled — create posts now';
    else if (scheduledCount <= 3) cardScheduledSub.textContent = 'Light schedule — add more content';
    else cardScheduledSub.textContent = 'Good coverage for next 15 days';
  }
  const emptyScheduled = $('#emptyScheduled');
  if (emptyScheduled) emptyScheduled.style.display = scheduledCount === 0 && hasClients ? 'block' : 'none';

  const pendingCount = (state.approvals || []).filter(a => !a.status || a.status === 'pending').length;
  const kpiWaiting = $('#kpiWaiting');
  if (kpiWaiting) kpiWaiting.textContent = pendingCount;
  const awaitingList = (state.approvals || []).filter(a => !a.status || a.status === 'pending');
  const lastApprovalRequestAt = awaitingList.length ? Math.max(...awaitingList.map(a => a.updatedAt || a.createdAt || 0).filter(Boolean)) : null;
  const approvalStaleDays = lastApprovalRequestAt ? daysSince(lastApprovalRequestAt) : 0;
  const cardWaitingSub = $('#cardWaiting')?.querySelector('.card__sub');
  if (cardWaitingSub) {
    if (pendingCount === 0) cardWaitingSub.textContent = '✅ Nothing waiting';
    else if (approvalStaleDays >= APPROVALS_STALE_DAYS_THRESHOLD) cardWaitingSub.textContent = `⏳ Stuck ${approvalStaleDays} days — send reminder`;
    else cardWaitingSub.textContent = 'On client review';
  }

  const missingCount = state.kpis?.missingAssets || 0;
  const kpiMissing = $('#kpiMissing');
  if (kpiMissing) kpiMissing.textContent = missingCount;
  const cardMissingSub = $('#cardMissing')?.querySelector('.card__sub');
  if (cardMissingSub) {
    if (missingCount === 0) cardMissingSub.textContent = '✅ All set';
    else cardMissingSub.textContent = '❌ Missing info from client';
  }
  const emptyMissingCta = $('#emptyMissingCta');
  if (emptyMissingCta) emptyMissingCta.style.display = missingCount > 0 && hasClients ? 'block' : 'none';

  const lastActivity = $('#lastActivity');
  if (lastActivity && state.activity && state.activity.length > 0) {
    const latest = state.activity[state.activity.length - 1];
    lastActivity.textContent = `Last portal activity: ${latest.text} (${fmtDate(latest.when)})`;
  } else if (lastActivity) {
    lastActivity.textContent = 'Last portal activity: None';
  }

  renderActivityLog(state.activity);
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
    setAutoDueDate();
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
  
  // Load image URLs (carousel): imageUrls array or single imageUrl
  var urls = Array.isArray(item.imageUrls) && item.imageUrls.length > 0
    ? item.imageUrls.filter(function (u) { return u && String(u).trim(); })
    : (item.imageUrl ? [item.imageUrl] : []);
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
    grid.innerHTML = '<div class="empty-state__text" style="font-size: 12px; color: #94a3b8;">Select a client to see approved visuals.</div>';
    if (selectedWrap) selectedWrap.style.display = 'none';
    return;
  }

  let assets = loadAssets(currentClientId).filter(a => a.approvalStatus === 'APPROVED');
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
      label.textContent = (asset.title || 'Untitled') + (asset.approvalStatus === 'PENDING' ? ' (pending approval)' : '');
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

// Setup approval form handler - will be called after DOM loads
function setupApprovalHandlers() {
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
    console.log('Save post: selected asset IDs', approvalData.assetIds || []);
    
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
    
    const info = el('div', { class: 'request-item__info' });
    const type = el('div', { class: 'request-item__type' });
    type.textContent = req.type || 'Request';
    const details = el('div', { class: 'request-item__details' });
    details.textContent = req.details || '';
    const meta = el('div', { class: 'request-item__meta' });
    meta.textContent = `By ${req.by || 'Client'} • ${fmtDate(req.createdAt || Date.now())}`;
    
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
      btn.addEventListener('click', () => {
        markRequestDone(req.id);
      });
      actions.appendChild(btn);
    }
    
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
  req.doneAt = Date.now(); // Use doneAt instead of completedAt
  // Ensure createdAt exists (for backward compatibility)
  if (!req.createdAt) req.createdAt = Date.now();
  
  // Log activity
  if (!state.activity) state.activity = [];
  state.activity.push({
    when: Date.now(),
    text: `Marked request as done: ${req.type}`
  });
  
  save(state);
  renderRequestsTab();
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
  console.log('Assets & References: loaded', assets.length, 'for client', currentClientId, '| approved:', approvedCount);
  if (assets.length) {
    assets.slice(0, 6).forEach(a => {
      console.log('Provider detection:', a.url ? parseProviderFromUrl(a.url) : '—', 'for', (a.title || '').slice(0, 30));
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
    if (fileId) console.log('Drive preview:', { fileId, previewUrl, assetId: asset.id });
    const img = el('img', {
      class: 'asset-card__thumb-img',
      src: previewUrl,
      alt: asset.title || 'Preview',
      loading: 'lazy',
      referrerPolicy: 'no-referrer'
    });
    img.onload = function () {
      thumbPlaceholder.style.display = 'none';
      if (fileId) console.log('Drive preview loaded:', { fileId, previewUrl });
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
      if (fileId) console.log('Drive preview onerror (permissions):', { fileId, previewUrl });
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
    });
  }
  
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
        const payload = { name, email, pin, agencyId: getAgencyIdFromSession() };
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
  
  window.loadUsersList = loadUsersList;
  window.loadClientsList = loadClientsList;
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
  const elStatus = $('#headerSystemStatus');
  const elText = $('.header-status__text');
  const elDot = $('.header-status__dot');
  if (!elText) return;
  const summary = getGlobalStatusSummary();
  elText.textContent = summary.text;
  if (elDot) {
    elDot.className = 'header-status__dot header-status__dot--' + summary.state.toLowerCase();
  }
  if (elStatus) elStatus.title = summary.text;
}

function renderAll() {
  renderClientsSidebar();
  renderClientHeader();
  updateGlobalStatusSummary();
  renderNotificationBell();
  switchTab(currentTab);
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
          showToast(`${file.name} added; requires approval before reuse.`, 'success');
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

/* ================== Initialize ================== */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('Agency dashboard loaded');
    if (!currentStaff) {
      console.log('No staff session, redirecting to staff login');
      setTimeout(() => {
        if (!currentStaff) window.location.href = staffLoginUrl();
      }, 100);
      return;
    }
    console.log('Staff authenticated:', currentStaff.name || currentStaff.username || currentStaff.fullName);
    try { updateStaffHeader(); } catch (e) { console.error('Error updating staff header:', e); }

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
      console.error('Error loading clients/portal:', e);
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
      console.log('Initial view rendered');
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
      console.log('--- Dashboard checklist ---');
      console.log('Selected client restored:', restored ? 'yes' : 'no');
      console.log('Global summary state:', summary.state);
      console.log('Next action label:', nextLabel);
      Object.keys(clients).forEach(id => {
        const h = computeHealth(getClientHealthData(id));
        console.log('Health for', clients[id].name || id + ':', h);
      });
      console.log('----------------------------');
    } catch (e) { console.warn('Checklist log:', e); }

    var notifs = loadNotifications();
    var actionUnread = notifs.filter(function(n) { return n.type === 'ACTION' && !n.read; });
    var clearEl = document.getElementById('headerClearToday');
    console.log('Notifications: total=' + notifs.length + ', unread ACTION=' + actionUnread.length + ', header clear shown=' + (clearEl && clearEl.style.display !== 'none'));
    console.log('Agency dashboard initialization complete');
  } catch (e) {
    console.error('Fatal error during agency dashboard initialization:', e);
    alert('An error occurred while loading the dashboard. Please check the console for details.');
  }
});

