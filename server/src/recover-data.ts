/**
 * One-time recovery: rebuild portal-state.json approvals from production-tasks.json.
 *
 * Run (from server/): npx tsx src/recover-data.ts
 * Or: GET /api/recover-data?key=recover2fly2026 (temporary — remove after use)
 *
 * Rules:
 * - Skips portal entries that already have a non-empty approvals array.
 * - Backs up portal-state.json → portal-state.pre-recovery.bak before writing.
 * - Writes via .tmp + renameSync (atomic).
 */

import 'dotenv/config';
import { readFileSync, existsSync, writeFileSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { ProductionTask, PortalStateData, AuditLog } from './types.js';

const DB_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || join(process.cwd(), 'data');
const PRODUCTION_TASKS_FILE = join(DB_DIR, 'production-tasks.json');
const PORTAL_STATE_FILE = join(DB_DIR, 'portal-state.json');
const AUDIT_LOGS_FILE = join(DB_DIR, 'audit-logs.json');
const PRE_RECOVERY_BAK = join(DB_DIR, 'portal-state.pre-recovery.bak');

export type RecoveryLogEntry = { level: 'info' | 'warn' | 'error'; message: string };

export interface RecoveryResult {
  success: boolean;
  dataRoot: string;
  log: RecoveryLogEntry[];
  tasksLoaded: number;
  portalKeysTotal: number;
  clientsSkippedNonEmptyApprovals: string[];
  clientsRecovered: string[];
  approvalsInserted: number;
  auditOverridesApplied: number;
  errors: string[];
}

function logEntry(log: RecoveryLogEntry[], level: RecoveryLogEntry['level'], message: string): void {
  log.push({ level, message });
  const prefix = `[recover-data] ${level.toUpperCase()}:`;
  if (level === 'error') console.error(prefix, message);
  else if (level === 'warn') console.warn(prefix, message);
  else console.log(prefix, message);
}

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

export function mapTaskStatusToApprovalStatus(taskStatus: string): string {
  switch (taskStatus) {
    case 'approved':
    case 'ready_to_post':
      return 'approved';
    case 'changes_requested':
      return 'changes';
    case 'review':
    case 'assigned':
    case 'in_progress':
      return 'pending';
    default:
      return 'pending';
  }
}

function taskToApprovalEntry(task: ProductionTask, statusOverride?: 'approved' | 'changes'): Record<string, unknown> {
  const t = task as ProductionTask & { approvalId?: string };
  const id = t.approvalId || t.contentId || t.id;
  const status = statusOverride ?? mapTaskStatusToApprovalStatus(t.status);
  const imageUrl =
    (t.finalArt && t.finalArt[0]) || (t.referenceImages && t.referenceImages[0]) || '';
  const imageUrls =
    t.finalArt && t.finalArt.length > 0 ? t.finalArt : t.referenceImages || [];

  return {
    id,
    contentId: t.contentId || t.id,
    approvalId: t.approvalId || t.id,
    title: t.title || '',
    caption: t.caption || '',
    copyText: t.copyText || '',
    imageUrl,
    imageUrls,
    finalArtUrls: t.finalArt || [],
    productionTaskId: t.id,
    productionStatus: t.status === 'approved' ? 'art_approved' : t.status,
    status,
    updatedAt: t.updatedAt || t.createdAt,
    createdAt: t.createdAt,
  };
}

function loadAuditStatusOverrides(log: RecoveryLogEntry[]): Map<string, 'approved' | 'changes'> {
  const map = new Map<string, 'approved' | 'changes'>();
  if (!existsSync(AUDIT_LOGS_FILE)) {
    logEntry(log, 'info', `No audit log file at ${AUDIT_LOGS_FILE} — skipping audit overrides.`);
    return map;
  }
  let logs: AuditLog[];
  try {
    logs = JSON.parse(readFileSync(AUDIT_LOGS_FILE, 'utf-8')) as AuditLog[];
    if (!Array.isArray(logs)) throw new Error('audit-logs.json is not an array');
  } catch (e) {
    logEntry(log, 'warn', `Could not read audit-logs.json: ${e instanceof Error ? e.message : e}`);
    return map;
  }
  const sorted = [...logs].sort((a, b) => a.createdAt - b.createdAt);
  let eventCount = 0;
  for (const entry of sorted) {
    const action = (entry.action || '').toLowerCase();
    let meta: Record<string, unknown> = {};
    if (entry.metaJson) {
      try {
        meta = JSON.parse(entry.metaJson) as Record<string, unknown>;
      } catch {
        continue;
      }
    }
    const aid = String(meta.approvalId || meta.contentId || meta.id || '').trim();
    if (!aid) continue;

    const isApprove =
      action === 'client.approve' ||
      action.includes('client.approve') ||
      (action.includes('approve') &&
        !action.includes('unapprove') &&
        (action.includes('client') || action.includes('portal')));
    const isRequestChanges =
      action.includes('request-changes') ||
      action.includes('request_changes') ||
      action === 'client.request-changes';

    if (isApprove) {
      map.set(aid, 'approved');
      eventCount++;
    }
    if (isRequestChanges) {
      map.set(aid, 'changes');
      eventCount++;
    }
  }
  logEntry(
    log,
    'info',
    `Audit log scan: ${eventCount} relevant events → ${map.size} unique approval/content id(s) with final override.`
  );
  return map;
}

function resolvePortalKey(
  portalMap: Record<string, PortalStateData>,
  agencyId: string,
  clientId: string,
  log: RecoveryLogEntry[],
  cache: Map<string, string | null>,
  warnedFallback: Set<string>
): string | null {
  const cacheKey = `${agencyId}\0${clientId}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey)!;

  const direct = `${agencyId}:${clientId}`;
  if (portalMap[direct] !== undefined) {
    cache.set(cacheKey, direct);
    return direct;
  }

  const suffix = `:${clientId}`;
  const matches = Object.keys(portalMap).filter((k) => k.endsWith(suffix));
  if (matches.length === 1) {
    if (!warnedFallback.has(clientId)) {
      warnedFallback.add(clientId);
      logEntry(
        log,
        'info',
        `Portal key fallback: client ${clientId} → ${matches[0]} (no entry for exact ${direct}).`
      );
    }
    cache.set(cacheKey, matches[0]);
    return matches[0];
  }
  if (matches.length > 1) {
    logEntry(
      log,
      'warn',
      `Multiple portal keys for clientId ${clientId}: ${matches.join(', ')} — cannot map tasks reliably; skipped.`
    );
    cache.set(cacheKey, null);
    return null;
  }
  logEntry(
    log,
    'warn',
    `No portal-state entry for agency ${agencyId} client ${clientId} — skipping tasks for this client.`
  );
  cache.set(cacheKey, null);
  return null;
}

function approvalsArrayNonEmpty(state: PortalStateData | undefined): boolean {
  return Array.isArray(state?.approvals) && state.approvals.length > 0;
}

export function runRecoverPortalApprovals(): RecoveryResult {
  const log: RecoveryLogEntry[] = [];
  const errors: string[] = [];
  const clientsSkippedNonEmptyApprovals: string[] = [];
  const clientsRecovered: string[] = [];
  let approvalsInserted = 0;

  logEntry(log, 'info', `Data directory: ${DB_DIR}`);

  if (!existsSync(PRODUCTION_TASKS_FILE)) {
    const msg = `Missing ${PRODUCTION_TASKS_FILE}`;
    logEntry(log, 'error', msg);
    errors.push(msg);
    return {
      success: false,
      dataRoot: DB_DIR,
      log,
      tasksLoaded: 0,
      portalKeysTotal: 0,
      clientsSkippedNonEmptyApprovals,
      clientsRecovered,
      approvalsInserted: 0,
      auditOverridesApplied: 0,
      errors,
    };
  }

  if (!existsSync(PORTAL_STATE_FILE)) {
    const msg = `Missing ${PORTAL_STATE_FILE}`;
    logEntry(log, 'error', msg);
    errors.push(msg);
    return {
      success: false,
      dataRoot: DB_DIR,
      log,
      tasksLoaded: 0,
      portalKeysTotal: 0,
      clientsSkippedNonEmptyApprovals,
      clientsRecovered,
      approvalsInserted: 0,
      auditOverridesApplied: 0,
      errors,
    };
  }

  let tasks: ProductionTask[];
  try {
    tasks = JSON.parse(readFileSync(PRODUCTION_TASKS_FILE, 'utf-8')) as ProductionTask[];
    if (!Array.isArray(tasks)) throw new Error('not an array');
  } catch (e) {
    const msg = `Invalid production-tasks.json: ${e instanceof Error ? e.message : e}`;
    logEntry(log, 'error', msg);
    errors.push(msg);
    return {
      success: false,
      dataRoot: DB_DIR,
      log,
      tasksLoaded: 0,
      portalKeysTotal: 0,
      clientsSkippedNonEmptyApprovals,
      clientsRecovered,
      approvalsInserted: 0,
      auditOverridesApplied: 0,
      errors,
    };
  }

  let portalMap: Record<string, PortalStateData>;
  try {
    portalMap = JSON.parse(readFileSync(PORTAL_STATE_FILE, 'utf-8')) as Record<string, PortalStateData>;
    if (!portalMap || typeof portalMap !== 'object' || Array.isArray(portalMap)) {
      throw new Error('portal-state.json must be a JSON object');
    }
  } catch (e) {
    const msg = `Invalid portal-state.json: ${e instanceof Error ? e.message : e}`;
    logEntry(log, 'error', msg);
    errors.push(msg);
    return {
      success: false,
      dataRoot: DB_DIR,
      log,
      tasksLoaded: tasks.length,
      portalKeysTotal: 0,
      clientsSkippedNonEmptyApprovals,
      clientsRecovered,
      approvalsInserted: 0,
      auditOverridesApplied: 0,
      errors,
    };
  }

  const auditOverrides = loadAuditStatusOverrides(log);

  const keyCache = new Map<string, string | null>();
  const warnedFallback = new Set<string>();
  const tasksByClientKey = new Map<string, ProductionTask[]>();
  for (const task of tasks) {
    if (!task.clientId || !task.agencyId) {
      logEntry(log, 'warn', `Task ${task.id} missing clientId or agencyId — skipped`);
      continue;
    }
    const pKey = resolvePortalKey(portalMap, task.agencyId, task.clientId, log, keyCache, warnedFallback);
    if (!pKey) continue;
    if (!tasksByClientKey.has(pKey)) tasksByClientKey.set(pKey, []);
    tasksByClientKey.get(pKey)!.push(task);
  }

  const approvalIdsTouchedByAudit = new Set<string>();

  for (const [portalKey, state] of Object.entries(portalMap)) {
    if (!Array.isArray(state.approvals)) state.approvals = [];

    if (approvalsArrayNonEmpty(state)) {
      clientsSkippedNonEmptyApprovals.push(portalKey);
      logEntry(log, 'info', `Skip ${portalKey}: approvals array already has ${state.approvals.length} item(s).`);
      continue;
    }

    const clientTasks = tasksByClientKey.get(portalKey);
    if (!clientTasks || clientTasks.length === 0) {
      logEntry(log, 'info', `No production tasks mapped to ${portalKey} — leaving empty approvals.`);
      continue;
    }

    const byId = new Map<string, Record<string, unknown>>();
    for (const task of clientTasks) {
      const t = task as ProductionTask & { approvalId?: string };
      const id = String(t.approvalId || t.contentId || t.id);
      const override = auditOverrides.get(id);
      if (override) approvalIdsTouchedByAudit.add(`${portalKey}:${id}`);
      const entry = taskToApprovalEntry(task, override);
      byId.set(String(entry.id), entry);
    }

    state.approvals = Array.from(byId.values());
    approvalsInserted += state.approvals.length;

    const pending = state.approvals.filter((a: any) => a.status === 'pending').length;
    const approved = state.approvals.filter((a: any) => a.status === 'approved').length;
    if (!state.kpis) {
      state.kpis = { scheduled: 0, waitingApproval: 0, missingAssets: 0, frustration: 0 };
    }
    state.kpis.waitingApproval = pending;
    state.kpis.scheduled = approved;

    clientsRecovered.push(portalKey);
    logEntry(
      log,
      'info',
      `Recovered ${portalKey}: ${state.approvals.length} approvals (pending=${pending}, approved=${approved}).`
    );
  }

  const auditOverridesApplied = approvalIdsTouchedByAudit.size;

  const json = JSON.stringify(portalMap, null, 2);
  try {
    const currentPortal = readFileSync(PORTAL_STATE_FILE, 'utf-8');
    atomicWriteUtf8(PRE_RECOVERY_BAK, currentPortal);
    logEntry(log, 'info', `Wrote backup → ${PRE_RECOVERY_BAK}`);
  } catch (e) {
    const msg = `Failed to write pre-recovery backup: ${e instanceof Error ? e.message : e}`;
    logEntry(log, 'error', msg);
    errors.push(msg);
    return {
      success: false,
      dataRoot: DB_DIR,
      log,
      tasksLoaded: tasks.length,
      portalKeysTotal: Object.keys(portalMap).length,
      clientsSkippedNonEmptyApprovals,
      clientsRecovered,
      approvalsInserted,
      auditOverridesApplied,
      errors,
    };
  }

  try {
    atomicWriteUtf8(PORTAL_STATE_FILE, json);
    logEntry(log, 'info', `Wrote updated portal-state.json (${json.length} chars) via atomic replace.`);
  } catch (e) {
    const msg = `Failed to write portal-state.json: ${e instanceof Error ? e.message : e}`;
    logEntry(log, 'error', msg);
    errors.push(msg);
    return {
      success: false,
      dataRoot: DB_DIR,
      log,
      tasksLoaded: tasks.length,
      portalKeysTotal: Object.keys(portalMap).length,
      clientsSkippedNonEmptyApprovals,
      clientsRecovered,
      approvalsInserted,
      auditOverridesApplied,
      errors,
    };
  }

  return {
    success: errors.length === 0,
    dataRoot: DB_DIR,
    log,
    tasksLoaded: tasks.length,
    portalKeysTotal: Object.keys(portalMap).length,
    clientsSkippedNonEmptyApprovals,
    clientsRecovered,
    approvalsInserted,
    auditOverridesApplied,
    errors,
  };
}

const isCli =
  typeof process !== 'undefined' &&
  process.argv.some((a) => a.includes('recover-data'));

if (isCli) {
  const r = runRecoverPortalApprovals();
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.success ? 0 : 1);
}
