/**
 * Database layer
 * 
 * MVP: Uses JSON files for storage
 * Production: Migrate to PostgreSQL/MongoDB
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
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
  PortalStateData
} from './types.js';

const DB_DIR = join(process.cwd(), 'data');
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

// Ensure data directory exists
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

function readJSON<T>(file: string, defaultValue: T): T {
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify(defaultValue, null, 2), 'utf-8');
    return defaultValue;
  }
  try {
    const content = readFileSync(file, 'utf-8');
    return JSON.parse(content) as T;
  } catch (e) {
    console.error(`Error reading ${file}:`, e);
    return defaultValue;
  }
}

function writeJSON<T>(file: string, data: T): void {
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

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
  if (logs.length > 10000) {
    logs.sort((a, b) => b.createdAt - a.createdAt);
    logs.splice(10000);
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
  map[portalKey(agencyId, clientId)] = data;
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

