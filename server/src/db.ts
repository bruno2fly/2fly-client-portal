/**
 * Database layer
 * 
 * MVP: Uses JSON files for storage
 * Production: Migrate to PostgreSQL/MongoDB
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import type {
  Workspace,
  Staff,
  WorkspaceIntegrationGoogle,
  Asset,
  Agency,
  User,
  Client,
  InviteToken,
  PasswordResetToken,
  AuditLog,
  PortalStateData,
  MetaIntegration,
  ScheduledPost,
  ProductionTask,
  PushSubscriptionRecord
} from './types.js';

const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || join(process.cwd(), 'data');
const WORKSPACES_FILE = join(DB_DIR, 'workspaces.json');
const STAFF_FILE = join(DB_DIR, 'staff.json');
const INTEGRATIONS_FILE = join(DB_DIR, 'integrations.json');
const ASSETS_FILE = join(DB_DIR, 'assets.json');
// New credentials system files
const AGENCIES_FILE = join(DB_DIR, 'agencies.json');
const USERS_FILE = join(DB_DIR, 'users.json');
const CLIENTS_FILE = join(DB_DIR, 'clients.json');
const INVITE_TOKENS_FILE = join(DB_DIR, 'invite-tokens.json');
const PASSWORD_RESET_TOKENS_FILE = join(DB_DIR, 'password-reset-tokens.json');
const AUDIT_LOGS_FILE = join(DB_DIR, 'audit-logs.json');
const PORTAL_STATE_FILE = join(DB_DIR, 'portal-state.json');
const CLIENT_CREDENTIALS_FILE = join(DB_DIR, 'client-credentials.json');
const META_INTEGRATIONS_FILE = join(DB_DIR, 'meta-integrations.json');
const SCHEDULED_POSTS_FILE = join(DB_DIR, 'scheduled-posts.json');
const PRODUCTION_TASKS_FILE = join(DB_DIR, 'production-tasks.json');
const PUSH_SUBSCRIPTIONS_FILE = join(DB_DIR, 'push-subscriptions.json');
// Ensure data directory exists
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}
console.log(`[db] Data directory: ${DB_DIR} (volume: ${process.env.RAILWAY_VOLUME_MOUNT_PATH ? 'yes' : 'no'})`);

/** Atomic replace: tmp file then rename (avoids half-written JSON if process dies mid-write). */
function atomicWriteUtf8(targetPath: string, content: string): void {
  const tmpFile = targetPath + '.tmp';
  writeFileSync(tmpFile, content, 'utf-8');
  try {
    renameSync(tmpFile, targetPath);
  } catch {
    writeFileSync(targetPath, content, 'utf-8');
    try {
      unlinkSync(tmpFile);
    } catch {
      /* ignore */
    }
  }
}

function readJSON<T>(file: string, defaultValue: T): T {
  if (!existsSync(file)) {
    atomicWriteUtf8(file, JSON.stringify(defaultValue, null, 2));
    return defaultValue;
  }
  try {
    const content = readFileSync(file, 'utf-8');
    if (!content || !content.trim()) {
      // File exists but is empty — try backup
      console.error(`[db] WARNING: ${file} is empty, trying backup`);
      const backupFile = file + '.bak';
      if (existsSync(backupFile)) {
        const backupContent = readFileSync(backupFile, 'utf-8');
        if (backupContent && backupContent.trim()) {
          const restored = JSON.parse(backupContent) as T;
          console.log(`[db] Restored ${file} from backup`);
          atomicWriteUtf8(file, backupContent);
          return restored;
        }
      }
      return defaultValue;
    }
    return JSON.parse(content) as T;
  } catch (e) {
    console.error(`[db] Error reading ${file}:`, e);
    // Try backup before falling back to empty default (which causes data loss)
    const backupFile = file + '.bak';
    try {
      if (existsSync(backupFile)) {
        const backupContent = readFileSync(backupFile, 'utf-8');
        if (backupContent && backupContent.trim()) {
          const restored = JSON.parse(backupContent) as T;
          console.log(`[db] Restored ${file} from backup after read error`);
          atomicWriteUtf8(file, backupContent);
          return restored;
        }
      }
    } catch (backupErr) {
      console.error(`[db] Backup read also failed for ${file}:`, backupErr);
    }
    return defaultValue;
  }
}

function writeJSON<T>(file: string, data: T): void {
  const json = JSON.stringify(data, null, 2);
  // Safety: never write empty or tiny data to portal-state (likely corruption)
  if (file === PORTAL_STATE_FILE && json.length < 20) {
    console.error(`[db] BLOCKED write of suspiciously small data to ${file} (${json.length} bytes)`);
    return;
  }
  // Only backup critical files (portal-state, clients, meta-integrations, users)
  // Backing up ALL files doubles disk usage and filled the Railway volume
  const CRITICAL_FILES = [PORTAL_STATE_FILE, CLIENTS_FILE, META_INTEGRATIONS_FILE, USERS_FILE];
  const isCritical = CRITICAL_FILES.includes(file);
  if (isCritical) {
    try {
      if (existsSync(file)) {
        const existing = readFileSync(file, 'utf-8');
        if (existing.trim().length > 0) {
          atomicWriteUtf8(file + '.bak', existing);
        }
      }
    } catch {
      // Don't fail the write if backup fails
    }
  }
  atomicWriteUtf8(file, json);
}

/** If portal-state.json or clients.json is corrupt on boot, restore from .bak before any request runs. */
function validateCriticalJsonStoresAtStartup(): void {
  for (const file of [PORTAL_STATE_FILE, CLIENTS_FILE]) {
    const shortName = file.split(/[/\\]/).pop() || file;
    if (!existsSync(file)) continue;
    let content: string;
    try {
      content = readFileSync(file, 'utf-8');
    } catch {
      continue;
    }
    if (!content.trim()) continue;
    try {
      JSON.parse(content);
      continue;
    } catch {
      console.warn(`[db] WARNING: ${shortName} has corrupted JSON on startup. Trying ${shortName}.bak...`);
      const bak = file + '.bak';
      if (!existsSync(bak)) {
        console.error(`[db] ERROR: No backup found at ${bak}`);
        continue;
      }
      try {
        const bakContent = readFileSync(bak, 'utf-8');
        JSON.parse(bakContent);
        atomicWriteUtf8(file, bakContent);
        console.warn(`[db] Restored ${shortName} from .bak on startup.`);
      } catch (e) {
        console.error(`[db] ERROR: ${shortName}.bak is missing or invalid.`, e);
      }
    }
  }
}

validateCriticalJsonStoresAtStartup();

// ── Disk cleanup — prevent Railway volume from filling up ──
function cleanupDiskSpace(): void {
  try {
    const files = readdirSync(DB_DIR);
    let freedBytes = 0;

    // 1. Delete .tmp files (leftover from failed atomic writes)
    for (const f of files) {
      if (f.endsWith('.tmp')) {
        try {
          const fp = join(DB_DIR, f);
          const sz = statSync(fp).size;
          unlinkSync(fp);
          freedBytes += sz;
        } catch { /* ignore */ }
      }
    }

    // 2. Trim audit logs to 2,000 entries (was 10,000 — each entry ~500 bytes = 5MB cap → 1MB)
    try {
      const logsFile = join(DB_DIR, 'audit-logs.json');
      if (existsSync(logsFile)) {
        const logs = JSON.parse(readFileSync(logsFile, 'utf-8'));
        if (Array.isArray(logs) && logs.length > 2000) {
          const before = Buffer.byteLength(JSON.stringify(logs));
          logs.sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0));
          logs.splice(2000);
          const trimmed = JSON.stringify(logs, null, 2);
          atomicWriteUtf8(logsFile, trimmed);
          freedBytes += before - Buffer.byteLength(trimmed);
        }
      }
    } catch (e) { console.warn('[cleanup] audit logs trim failed:', e); }

    // 3. Trim old completed/failed scheduled posts (keep last 500, remove posts older than 90 days)
    try {
      const postsFile = join(DB_DIR, 'scheduled-posts.json');
      if (existsSync(postsFile)) {
        const posts = JSON.parse(readFileSync(postsFile, 'utf-8'));
        if (Array.isArray(posts) && posts.length > 500) {
          const before = Buffer.byteLength(JSON.stringify(posts));
          const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
          const cutoff = Date.now() - NINETY_DAYS;
          // Keep: all scheduled/pending + recent completed/failed + up to 500 total
          const kept = posts.filter((p: any) => {
            if (p.status === 'scheduled' || p.status === 'pending') return true;
            const ts = new Date(p.updatedAt || p.createdAt || 0).getTime();
            return ts > cutoff;
          });
          // If still too many, sort by date and keep newest 500
          if (kept.length > 500) {
            kept.sort((a: any, b: any) => {
              const ta = new Date(b.updatedAt || b.createdAt || 0).getTime();
              const tb = new Date(a.updatedAt || a.createdAt || 0).getTime();
              return ta - tb;
            });
            kept.splice(500);
          }
          const trimmed = JSON.stringify(kept, null, 2);
          atomicWriteUtf8(postsFile, trimmed);
          freedBytes += before - Buffer.byteLength(trimmed);
        }
      }
    } catch (e) { console.warn('[cleanup] scheduled posts trim failed:', e); }

    // 4. Trim expired invite/password-reset tokens (older than 7 days)
    for (const tokenFile of ['invite-tokens.json', 'password-reset-tokens.json']) {
      try {
        const fp = join(DB_DIR, tokenFile);
        if (!existsSync(fp)) continue;
        const tokens = JSON.parse(readFileSync(fp, 'utf-8'));
        if (Array.isArray(tokens)) {
          const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
          const cutoff = Date.now() - SEVEN_DAYS;
          const kept = tokens.filter((t: any) => !t.usedAt && t.expiresAt > cutoff);
          if (kept.length < tokens.length) {
            const before = Buffer.byteLength(JSON.stringify(tokens));
            const trimmed = JSON.stringify(kept, null, 2);
            atomicWriteUtf8(fp, trimmed);
            freedBytes += before - Buffer.byteLength(trimmed);
          }
        }
      } catch { /* ignore */ }
    }

    // 5. Trim stale push subscriptions (older than 60 days — browsers auto-expire them anyway)
    try {
      const subFile = join(DB_DIR, 'push-subscriptions.json');
      if (existsSync(subFile)) {
        const subs = JSON.parse(readFileSync(subFile, 'utf-8'));
        if (subs && typeof subs === 'object') {
          const SIXTY_DAYS = 60 * 24 * 60 * 60 * 1000;
          const cutoff = Date.now() - SIXTY_DAYS;
          const before = Buffer.byteLength(JSON.stringify(subs));
          let removed = 0;
          for (const key of Object.keys(subs)) {
            if ((subs[key].createdAt || 0) < cutoff) {
              delete subs[key];
              removed++;
            }
          }
          if (removed > 0) {
            const trimmed = JSON.stringify(subs, null, 2);
            atomicWriteUtf8(subFile, trimmed);
            freedBytes += before - Buffer.byteLength(trimmed);
            console.log(`[cleanup] Removed ${removed} stale push subscriptions`);
          }
        }
      }
    } catch (e) { console.warn('[cleanup] push subscriptions trim failed:', e); }

    // 6. Trim AI images — keep last 500 per agency, always keep pending_approval
    try {
      const aiImgFile = join(DB_DIR, 'ai-images.json');
      if (existsSync(aiImgFile)) {
        const images = JSON.parse(readFileSync(aiImgFile, 'utf-8'));
        if (images && typeof images === 'object') {
          const allImages = Object.values(images) as any[];
          if (allImages.length > 500) {
            const before = Buffer.byteLength(JSON.stringify(images));
            // Group by agency, trim each to 500 (keep pending_approval first)
            const byAgency: Record<string, any[]> = {};
            for (const img of allImages) {
              const aid = img.agencyId || 'unknown';
              if (!byAgency[aid]) byAgency[aid] = [];
              byAgency[aid].push(img);
            }
            const kept: Record<string, any> = {};
            for (const agencyImages of Object.values(byAgency)) {
              // Sort: pending_approval first, then newest first
              agencyImages.sort((a: any, b: any) => {
                if (a.status === 'pending_approval' && b.status !== 'pending_approval') return -1;
                if (b.status === 'pending_approval' && a.status !== 'pending_approval') return 1;
                return (b.createdAt || 0) - (a.createdAt || 0);
              });
              const capped = agencyImages.slice(0, 500);
              for (const img of capped) kept[img.id] = img;
            }
            const trimmed = JSON.stringify(kept, null, 2);
            atomicWriteUtf8(aiImgFile, trimmed);
            freedBytes += before - Buffer.byteLength(trimmed);
            console.log(`[cleanup] Trimmed AI images from ${allImages.length} to ${Object.keys(kept).length}`);
          }
        }
      }
    } catch (e) { console.warn('[cleanup] ai images trim failed:', e); }

    // 7. Trim production tasks — keep all active + last 300 completed/cancelled
    try {
      const tasksFile = join(DB_DIR, 'production-tasks.json');
      if (existsSync(tasksFile)) {
        const tasks = JSON.parse(readFileSync(tasksFile, 'utf-8'));
        if (Array.isArray(tasks) && tasks.length > 300) {
          const before = Buffer.byteLength(JSON.stringify(tasks));
          const active = tasks.filter((t: any) => t.status !== 'completed' && t.status !== 'cancelled');
          const terminal = tasks.filter((t: any) => t.status === 'completed' || t.status === 'cancelled');
          terminal.sort((a: any, b: any) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
          const kept = [...active, ...terminal.slice(0, 300)];
          if (kept.length < tasks.length) {
            const trimmed = JSON.stringify(kept, null, 2);
            atomicWriteUtf8(tasksFile, trimmed);
            freedBytes += before - Buffer.byteLength(trimmed);
            console.log(`[cleanup] Trimmed production tasks from ${tasks.length} to ${kept.length}`);
          }
        }
      }
    } catch (e) { console.warn('[cleanup] production tasks trim failed:', e); }

    // 8. Trim portal-state per-client history — cap approvals to 200 per client
    try {
      const psFile = join(DB_DIR, 'portal-state.json');
      if (existsSync(psFile)) {
        const raw = readFileSync(psFile, 'utf-8');
        const map = JSON.parse(raw);
        if (map && typeof map === 'object') {
          const before = Buffer.byteLength(raw);
          let changed = false;
          for (const key of Object.keys(map)) {
            const state = map[key];
            if (!state) continue;
            // Trim approvals: keep newest 200
            if (Array.isArray(state.approvals) && state.approvals.length > 200) {
              state.approvals = state.approvals.slice(-200);
              changed = true;
            }
            // Trim requests: keep all pending + newest 200 done ones
            if (Array.isArray(state.requests) && state.requests.length > 200) {
              const pending = state.requests.filter((r: any) => r.status !== 'done' && !r.done);
              const done = state.requests.filter((r: any) => r.status === 'done' || r.done);
              if (done.length > 200) {
                done.sort((a: any, b: any) => (b.doneAt || b.updatedAt || 0) - (a.doneAt || a.updatedAt || 0));
                state.requests = [...pending, ...done.slice(0, 200)];
                changed = true;
              }
            }
          }
          if (changed) {
            const trimmed = JSON.stringify(map, null, 2);
            atomicWriteUtf8(psFile, trimmed);
            freedBytes += before - Buffer.byteLength(trimmed);
            console.log('[cleanup] Trimmed portal-state history');
          }
        }
      }
    } catch (e) { console.warn('[cleanup] portal-state trim failed:', e); }

    // Log disk usage summary
    let totalBytes = 0;
    for (const f of readdirSync(DB_DIR)) {
      try { totalBytes += statSync(join(DB_DIR, f)).size; } catch { /* ignore */ }
    }
    const totalMB = (totalBytes / 1024 / 1024).toFixed(1);
    const freedMB = (freedBytes / 1024 / 1024).toFixed(1);
    console.log(`[cleanup] Disk: ${totalMB}MB used in ${DB_DIR} | freed ${freedMB}MB`);
  } catch (e) {
    console.error('[cleanup] Disk cleanup failed:', e);
  }
}

// Cleanup disabled - caused data issues
// cleanupDiskSpace();
// const cleanupInterval = setInterval(cleanupDiskSpace, 6 * 60 * 60 * 1000);
// cleanupInterval.unref();

// Workspaces
export function getWorkspaces(): Record<string, Workspace> {
  return readJSON<Record<string, Workspace>>(WORKSPACES_FILE, {});
}

export function getWorkspace(id: string): Workspace | null {
  const workspaces = getWorkspaces();
  return workspaces[id] || null;
}

export function saveWorkspace(workspace: Workspace): void {
  const workspaces = getWorkspaces();
  workspaces[workspace.id] = workspace;
  writeJSON(WORKSPACES_FILE, workspaces);
}

// Staff
export function getStaff(): Record<string, Staff> {
  return readJSON<Record<string, Staff>>(STAFF_FILE, {});
}

export function getStaffByUsername(username: string): Staff | null {
  const staff = getStaff();
  return Object.values(staff).find(s => s.username === username) || null;
}

export function getStaffById(id: string): Staff | null {
  const staff = getStaff();
  return staff[id] || null;
}

export function saveStaff(staffMember: Staff): void {
  const staff = getStaff();
  staff[staffMember.id] = staffMember;
  writeJSON(STAFF_FILE, staff);
}

// Google Integrations
export function getGoogleIntegrations(): Record<string, WorkspaceIntegrationGoogle> {
  return readJSON<Record<string, WorkspaceIntegrationGoogle>>(INTEGRATIONS_FILE, {});
}

export function getGoogleIntegrationByWorkspace(workspaceId: string): WorkspaceIntegrationGoogle | null {
  const integrations = getGoogleIntegrations();
  return Object.values(integrations).find(i => i.workspaceId === workspaceId) || null;
}

export function saveGoogleIntegration(integration: WorkspaceIntegrationGoogle): void {
  const integrations = getGoogleIntegrations();
  integrations[integration.id] = integration;
  writeJSON(INTEGRATIONS_FILE, integrations);
}

export function updateGoogleIntegrationStatus(
  workspaceId: string, 
  status: 'active' | 'revoked' | 'error',
  errorMessage?: string
): void {
  const integration = getGoogleIntegrationByWorkspace(workspaceId);
  if (integration) {
    integration.status = status;
    integration.lastUsedAt = Date.now();
    if (errorMessage) {
      integration.errorMessage = errorMessage;
    }
    saveGoogleIntegration(integration);
  }
}

// Assets
export function getAssets(): Asset[] {
  return readJSON<Asset[]>(ASSETS_FILE, []);
}

export function getAssetsByWorkspace(workspaceId: string): Asset[] {
  const assets = getAssets();
  return assets.filter(a => a.workspaceId === workspaceId);
}

export function getAssetsByClient(workspaceId: string, clientId: string): Asset[] {
  const assets = getAssets();
  return assets.filter(a => a.workspaceId === workspaceId && a.clientId === clientId);
}

export function getAssetsByAgency(agencyId: string): Asset[] {
  const assets = getAssets();
  return assets.filter(a => (a.agencyId || a.workspaceId) === agencyId);
}

export function getAssetById(id: string): Asset | null {
  const assets = getAssets();
  return assets.find(a => a.id === id) || null;
}

export function saveAsset(asset: Asset): void {
  const assets = getAssets();
  const index = assets.findIndex(a => a.id === asset.id);
  if (index >= 0) {
    assets[index] = asset;
  } else {
    assets.push(asset);
  }
  writeJSON(ASSETS_FILE, assets);
}

export function saveAssets(newAssets: Asset[]): void {
  const existingAssets = getAssets();
  const assetMap = new Map(existingAssets.map(a => [a.id, a]));
  
  // Update or add new assets
  newAssets.forEach(asset => {
    assetMap.set(asset.id, asset);
  });
  
  writeJSON(ASSETS_FILE, Array.from(assetMap.values()));
}

// ==================== NEW CREDENTIALS SYSTEM DATABASE FUNCTIONS ====================

// Agencies
export function getAgencies(): Record<string, Agency> {
  return readJSON<Record<string, Agency>>(AGENCIES_FILE, {});
}

export function getAgency(id: string): Agency | null {
  const agencies = getAgencies();
  return agencies[id] || null;
}

export function saveAgency(agency: Agency): void {
  const agencies = getAgencies();
  agencies[agency.id] = agency;
  writeJSON(AGENCIES_FILE, agencies);
}

// Users
export function getUsers(): Record<string, User> {
  return readJSON<Record<string, User>>(USERS_FILE, {});
}

export function getUser(id: string): User | null {
  const users = getUsers();
  return users[id] || null;
}

export function getUserByEmail(agencyId: string, email: string): User | null {
  const users = getUsers();
  return Object.values(users).find(
    u => u.agencyId === agencyId && u.email.toLowerCase() === email.toLowerCase()
  ) || null;
}

export function getUserByUsername(agencyId: string, username: string): User | null {
  const users = getUsers();
  return Object.values(users).find(
    u => u.agencyId === agencyId && u.username && u.username.toLowerCase() === username.toLowerCase()
  ) || null;
}

export function getUsersByAgency(agencyId: string): User[] {
  const users = getUsers();
  return Object.values(users).filter(u => u.agencyId === agencyId);
}

export function getUsersByClient(clientId: string): User[] {
  const users = getUsers();
  return Object.values(users).filter(u => u.clientId === clientId && u.role === 'CLIENT');
}

export function saveUser(user: User): void {
  const users = getUsers();
  users[user.id] = user;
  writeJSON(USERS_FILE, users);
}

export function deleteUser(userId: string): void {
  const users = getUsers();
  delete users[userId];
  writeJSON(USERS_FILE, users);
}

// Clients
export function getClients(): Record<string, Client> {
  return readJSON<Record<string, Client>>(CLIENTS_FILE, {});
}

export function getClient(id: string): Client | null {
  const clients = getClients();
  return clients[id] || null;
}

export function getClientsByAgency(agencyId: string): Client[] {
  const clients = getClients();
  return Object.values(clients).filter(c => c.agencyId === agencyId);
}

export function saveClient(client: Client): void {
  const clients = getClients();
  clients[client.id] = client;
  writeJSON(CLIENTS_FILE, clients);
}

export function deleteClient(clientId: string): void {
  const clients = getClients();
  delete clients[clientId];
  writeJSON(CLIENTS_FILE, clients);
}

// Invite Tokens
export function getInviteTokens(): Record<string, InviteToken> {
  return readJSON<Record<string, InviteToken>>(INVITE_TOKENS_FILE, {});
}

export function getInviteTokenByHash(tokenHash: string): InviteToken | null {
  const tokens = getInviteTokens();
  return Object.values(tokens).find(t => t.tokenHash === tokenHash && !t.usedAt && t.expiresAt > Date.now()) || null;
}

export function getInviteTokensByUser(userId: string): InviteToken[] {
  const tokens = getInviteTokens();
  return Object.values(tokens).filter(t => t.userId === userId);
}

export function saveInviteToken(token: InviteToken): void {
  const tokens = getInviteTokens();
  tokens[token.id] = token;
  writeJSON(INVITE_TOKENS_FILE, tokens);
}

export function markInviteTokenUsed(tokenId: string): void {
  const tokens = getInviteTokens();
  if (tokens[tokenId]) {
    tokens[tokenId].usedAt = Date.now();
    writeJSON(INVITE_TOKENS_FILE, tokens);
  }
}

// Password Reset Tokens
export function getPasswordResetTokens(): Record<string, PasswordResetToken> {
  return readJSON<Record<string, PasswordResetToken>>(PASSWORD_RESET_TOKENS_FILE, {});
}

export function getPasswordResetTokenByHash(tokenHash: string): PasswordResetToken | null {
  const tokens = getPasswordResetTokens();
  return Object.values(tokens).find(t => t.tokenHash === tokenHash && !t.usedAt && t.expiresAt > Date.now()) || null;
}

export function getPasswordResetTokensByUser(userId: string): PasswordResetToken[] {
  const tokens = getPasswordResetTokens();
  return Object.values(tokens).filter(t => t.userId === userId);
}

export function savePasswordResetToken(token: PasswordResetToken): void {
  const tokens = getPasswordResetTokens();
  tokens[token.id] = token;
  writeJSON(PASSWORD_RESET_TOKENS_FILE, tokens);
}

export function markPasswordResetTokenUsed(tokenId: string): void {
  const tokens = getPasswordResetTokens();
  if (tokens[tokenId]) {
    tokens[tokenId].usedAt = Date.now();
    writeJSON(PASSWORD_RESET_TOKENS_FILE, tokens);
  }
}

// Audit Logs
export function getAuditLogs(): AuditLog[] {
  return readJSON<AuditLog[]>(AUDIT_LOGS_FILE, []);
}

export function getAuditLogsByAgency(agencyId: string, limit: number = 100): AuditLog[] {
  const logs = getAuditLogs();
  return logs
    .filter(log => log.agencyId === agencyId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

export function saveAuditLog(log: AuditLog): void {
  const logs = getAuditLogs();
  logs.push(log);
  if (logs.length > 2000) {
    logs.sort((a, b) => b.createdAt - a.createdAt);
    logs.splice(2000);
  }
  writeJSON(AUDIT_LOGS_FILE, logs);
}

// Portal state (per client, scoped by agencyId). Dashboard is agencyId-scoped.
type PortalStateMap = Record<string, PortalStateData>;

function portalKey(agencyId: string, clientId: string): string {
  return `${agencyId}:${clientId}`;
}

export function getPortalState(agencyId: string, clientId: string): PortalStateData | null {
  const map = readJSON<PortalStateMap>(PORTAL_STATE_FILE, {});
  return map[portalKey(agencyId, clientId)] ?? null;
}

export function savePortalState(agencyId: string, clientId: string, data: PortalStateData): void {
  const map = readJSON<PortalStateMap>(PORTAL_STATE_FILE, {});
  const key = portalKey(agencyId, clientId);
  const existing = map[key];

  // Safety: if incoming data has empty approvals but existing data had approvals, preserve them
  if (existing && Array.isArray(existing.approvals) && existing.approvals.length > 0) {
    if (!data.approvals || !Array.isArray(data.approvals) || data.approvals.length === 0) {
      console.warn(`[db] WARNING: savePortalState for ${key} would clear ${existing.approvals.length} approvals. Preserving existing approvals.`);
      data.approvals = existing.approvals;
    }
  }

  // Merge request statuses: once a request is marked "done", never let a stale save revert it.
  // This prevents race conditions where agency marks done but client's cached state overwrites it.
  if (existing && Array.isArray(existing.requests) && existing.requests.length > 0 && Array.isArray(data.requests)) {
    const existingById: Record<string, any> = {};
    for (const r of existing.requests) {
      const req = r as any;
      if (req && req.id) existingById[req.id] = req;
    }
    data.requests = data.requests.map((r: any) => {
      if (!r || !r.id) return r;
      const prev = existingById[r.id];
      if (prev && (prev.status === 'done' || prev.done === true) && r.status !== 'done') {
        // Server already has this request as done — don't let it revert
        return { ...r, status: 'done', done: true, doneAt: prev.doneAt || r.doneAt || Date.now() };
      }
      return r;
    });
  }

  map[key] = data;
  writeJSON(PORTAL_STATE_FILE, map);
}

// Client login credentials (agency-scoped). Keys: agencyId:clientId.
type ClientCredentialsMap = Record<string, { password: string }>;

export function getClientCredentials(agencyId: string, clientId: string): string | null {
  const map = readJSON<ClientCredentialsMap>(CLIENT_CREDENTIALS_FILE, {});
  const ent = map[portalKey(agencyId, clientId)];
  return ent?.password ?? null;
}

export function saveClientCredentials(agencyId: string, clientId: string, password: string): void {
  const map = readJSON<ClientCredentialsMap>(CLIENT_CREDENTIALS_FILE, {});
  map[portalKey(agencyId, clientId)] = { password };
  writeJSON(CLIENT_CREDENTIALS_FILE, map);
}

export function deletePortalState(agencyId: string, clientId: string): void {
  const map = readJSON<PortalStateMap>(PORTAL_STATE_FILE, {});
  delete map[portalKey(agencyId, clientId)];
  writeJSON(PORTAL_STATE_FILE, map);
}

export function deleteClientCredentials(agencyId: string, clientId: string): void {
  const map = readJSON<ClientCredentialsMap>(CLIENT_CREDENTIALS_FILE, {});
  delete map[portalKey(agencyId, clientId)];
  writeJSON(CLIENT_CREDENTIALS_FILE, map);
}

// Meta integrations (per client: agencyId + clientId)
export function getMetaIntegrations(): Record<string, MetaIntegration> {
  return readJSON<Record<string, MetaIntegration>>(META_INTEGRATIONS_FILE, {});
}

export function getMetaIntegrationByAgency(agencyId: string): MetaIntegration | null {
  const integrations = getMetaIntegrations();
  return Object.values(integrations).find(i => i.agencyId === agencyId) || null;
}

export function getMetaIntegrationByClient(agencyId: string, clientId: string): MetaIntegration | null {
  const integrations = getMetaIntegrations();
  return Object.values(integrations).find(
    i => i.agencyId === agencyId && i.clientId === clientId
  ) || null;
}

export function saveMetaIntegration(integration: MetaIntegration): void {
  const integrations = getMetaIntegrations();
  integrations[integration.id] = integration;
  writeJSON(META_INTEGRATIONS_FILE, integrations);
}

export function deleteMetaIntegration(agencyId: string): void {
  const integrations = getMetaIntegrations();
  const toDelete = Object.entries(integrations).find(([, i]) => i.agencyId === agencyId);
  if (toDelete) {
    delete integrations[toDelete[0]];
    writeJSON(META_INTEGRATIONS_FILE, integrations);
  }
}

export function deleteMetaIntegrationByClient(agencyId: string, clientId: string): void {
  const integrations = getMetaIntegrations();
  const toDelete = Object.entries(integrations).find(
    ([, i]) => i.agencyId === agencyId && i.clientId === clientId
  );
  if (toDelete) {
    delete integrations[toDelete[0]];
    writeJSON(META_INTEGRATIONS_FILE, integrations);
  }
}

// Scheduled posts
export function getScheduledPosts(): ScheduledPost[] {
  return readJSON<ScheduledPost[]>(SCHEDULED_POSTS_FILE, []);
}

export function getScheduledPostsByAgency(agencyId: string): ScheduledPost[] {
  return getScheduledPosts().filter(p => p.agencyId === agencyId);
}

export function getScheduledPostById(id: string): ScheduledPost | null {
  return getScheduledPosts().find(p => p.id === id) || null;
}

export function saveScheduledPost(post: ScheduledPost): void {
  const posts = getScheduledPosts();
  const idx = posts.findIndex(p => p.id === post.id);
  if (idx >= 0) posts[idx] = post;
  else posts.push(post);
  writeJSON(SCHEDULED_POSTS_FILE, posts);
}

export function deleteScheduledPost(id: string): void {
  const posts = getScheduledPosts().filter(p => p.id !== id);
  writeJSON(SCHEDULED_POSTS_FILE, posts);
}

// Production tasks (designer workflow)
export function getProductionTasks(): ProductionTask[] {
  const tasks = readJSON<ProductionTask[]>(PRODUCTION_TASKS_FILE, []);
  tasks.forEach(t => { if (!t.comments) t.comments = []; });
  return tasks;
}

export function getProductionTasksByAgency(agencyId: string): ProductionTask[] {
  return getProductionTasks().filter(t => t.agencyId === agencyId);
}

export function getProductionTaskById(id: string): ProductionTask | null {
  return getProductionTasks().find(t => t.id === id) || null;
}

export function getProductionTasksByDesigner(designerId: string): ProductionTask[] {
  return getProductionTasks().filter(t => t.designerId === designerId);
}

export function getProductionTasksByClient(agencyId: string, clientId: string): ProductionTask[] {
  return getProductionTasks().filter(t => t.agencyId === agencyId && t.clientId === clientId);
}

export function saveProductionTask(task: ProductionTask): void {
  const tasks = getProductionTasks();
  const idx = tasks.findIndex(t => t.id === task.id);
  if (idx >= 0) tasks[idx] = task;
  else tasks.push(task);
  writeJSON(PRODUCTION_TASKS_FILE, tasks);
}

export function deleteProductionTask(id: string): void {
  const tasks = getProductionTasks().filter(t => t.id !== id);
  writeJSON(PRODUCTION_TASKS_FILE, tasks);
}

// Push Subscriptions
export function getPushSubscriptions(): Record<string, PushSubscriptionRecord> {
  return readJSON<Record<string, PushSubscriptionRecord>>(PUSH_SUBSCRIPTIONS_FILE, {});
}

export function savePushSubscription(sub: PushSubscriptionRecord): void {
  const all = getPushSubscriptions();
  // Use endpoint as key to prevent duplicates
  const key = Buffer.from(sub.endpoint).toString('base64').substring(0, 64);
  all[key] = sub;
  writeJSON(PUSH_SUBSCRIPTIONS_FILE, all);
}

export function deletePushSubscription(endpoint: string): void {
  const all = getPushSubscriptions();
  const key = Buffer.from(endpoint).toString('base64').substring(0, 64);
  delete all[key];
  // Also search by endpoint value
  Object.keys(all).forEach(k => {
    if (all[k].endpoint === endpoint) delete all[k];
  });
  writeJSON(PUSH_SUBSCRIPTIONS_FILE, all);
}

// ==================== AI LIBRARY DATABASE FUNCTIONS ====================

const BRAND_KITS_FILE = join(DB_DIR, 'brand-kits.json');
const AI_IMAGES_FILE = join(DB_DIR, 'ai-images.json');

// Brand Kit
export interface BrandKit {
  id: string;
  clientId: string;
  agencyId: string;
  logoUrls: string[];
  colors: { name: string; hex: string }[];
  fonts: { heading: string; body: string; weights: string[] };
  styleTags: string[];  // e.g. 'clean', 'bold', 'minimal', 'luxury'
  photoStyle: string;   // e.g. 'natural lighting, warm tones'
  rulesText: string;    // e.g. 'always use dark backgrounds'
  referenceImages: string[];
  createdAt: number;
  updatedAt: number;
}

export function getBrandKits(): Record<string, BrandKit> {
  return readJSON(BRAND_KITS_FILE, {});
}

export function getBrandKitByClient(clientId: string): BrandKit | null {
  const kits = getBrandKits();
  return Object.values(kits).find(k => k.clientId === clientId) || null;
}

export function saveBrandKit(kit: BrandKit): void {
  const kits = getBrandKits();
  kits[kit.id] = kit;
  writeJSON(BRAND_KITS_FILE, kits);
}

export function deleteBrandKit(id: string): void {
  const kits = getBrandKits();
  delete kits[id];
  writeJSON(BRAND_KITS_FILE, kits);
}

// AI Images
export interface AIImage {
  id: string;
  clientId: string;
  agencyId: string;
  brandKitId: string | null;
  prompt: string;
  enhancedPrompt: string;
  imageUrl: string;
  thumbnailUrl: string;
  format: 'feed' | 'story' | 'carousel' | 'ad_banner';
  formatDimensions: string;
  status: 'generated' | 'pending_approval' | 'approved' | 'rejected' | 'used_in_post';
  generatedBy: string;
  approvedBy: string | null;
  approvalDate: number | null;
  feedback: string;
  usedInPostId: string | null;
  modelUsed: string;
  batchId: string | null;
  createdAt: number;
  updatedAt: number;
}

export function getAIImages(): Record<string, AIImage> {
  return readJSON(AI_IMAGES_FILE, {});
}

export function getAIImagesByClient(clientId: string): AIImage[] {
  return Object.values(getAIImages()).filter(i => i.clientId === clientId);
}

export function getAIImagesByAgency(agencyId: string): AIImage[] {
  return Object.values(getAIImages()).filter(i => i.agencyId === agencyId);
}

export function getAIImageById(id: string): AIImage | null {
  return getAIImages()[id] || null;
}

export function saveAIImage(img: AIImage): void {
  const images = getAIImages();
  images[img.id] = img;
  writeJSON(AI_IMAGES_FILE, images);
}

export function deleteAIImage(id: string): void {
  const images = getAIImages();
  delete images[id];
  writeJSON(AI_IMAGES_FILE, images);
}

// ==================== Reference Images ====================
const REFERENCES_FILE = join(DB_DIR, 'references.json');

export interface ReferenceImage {
  id: string;
  agencyId: string;
  clientId: string;
  imageUrl: string;
  source: 'published_post' | 'ai_approved' | 'client_approved';
  sourceId: string | null; // post ID, AI image ID, or approval ID
  caption: string;
  platforms: string[];
  publishedAt: string | null;
  createdAt: string;
}

export function getReferences(): Record<string, ReferenceImage> {
  return readJSON(REFERENCES_FILE, {});
}

export function getReferencesByAgency(agencyId: string): ReferenceImage[] {
  return Object.values(getReferences()).filter(r => r.agencyId === agencyId);
}

export function getReferencesByClient(clientId: string): ReferenceImage[] {
  return Object.values(getReferences()).filter(r => r.clientId === clientId);
}

export function saveReference(ref: ReferenceImage): void {
  const refs = getReferences();
  refs[ref.id] = ref;
  writeJSON(REFERENCES_FILE, refs);
}

export function deleteReference(id: string): void {
  const refs = getReferences();
  delete refs[id];
  writeJSON(REFERENCES_FILE, refs);
}

/**
 * Check if a reference already exists for a given URL + client combo (avoid duplicates)
 */
export function referenceExistsForUrl(clientId: string, imageUrl: string): boolean {
  return Object.values(getReferences()).some(r => r.clientId === clientId && r.imageUrl === imageUrl);
}

