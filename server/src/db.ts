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
  Asset 
} from './types.js';

const DB_DIR = join(process.cwd(), 'data');
const WORKSPACES_FILE = join(DB_DIR, 'workspaces.json');
const STAFF_FILE = join(DB_DIR, 'staff.json');
const INTEGRATIONS_FILE = join(DB_DIR, 'integrations.json');
const ASSETS_FILE = join(DB_DIR, 'assets.json');

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

