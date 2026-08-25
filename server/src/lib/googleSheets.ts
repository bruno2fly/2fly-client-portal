/**
 * Google Sheets client for Content Automation v2.
 *
 * Standalone on purpose — nothing here is shared with the legacy scheduling
 * pipeline (posts.ts / cron.ts / meta-api.ts). Auth is a Google service account,
 * NOT the per-user OAuth used by googleDrive.ts.
 *
 * Env:
 *   GOOGLE_SERVICE_ACCOUNT_JSON — the service account key, either raw JSON or
 *   base64-encoded JSON (base64 preferred; Render env vars dislike newlines).
 */

import { google } from 'googleapis';
import type { sheets_v4 } from 'googleapis';

// ─── Sheet contract ──────────────────────────────────────────────────────────
// A Platform | B Scheduled Date/Time (ET) | C Caption | D Pillar |
// E Asset Link (Drive) | F Status | G Live URL | H Notes | I Post ID
export const SHEET_RANGE = 'A:I';
export const SHEET_HEADERS = [
  'Platform',
  'Scheduled Date/Time (ET)',
  'Caption',
  'Pillar',
  'Asset Link (Drive)',
  'Status',
  'Live URL',
  'Notes',
  'Post ID',
];

export const COL = {
  platform: 0,
  scheduledAt: 1,
  caption: 2,
  pillar: 3,
  assetLink: 4,
  status: 5,
  liveUrl: 6,
  notes: 7,
  postId: 8,
} as const;

/** Status values the system understands in column F. */
export const SHEET_STATUS = {
  ready: 'Ready',
  synced: 'Synced',
  posted: 'Posted',
  failed: 'Failed',
} as const;

export interface ScheduleRow {
  rowNumber: number; // 1-indexed, matches the Sheet's own row numbering
  platform: string;
  scheduledRaw: string;
  caption: string;
  pillar: string;
  assetLink: string;
  status: string;
  liveUrl: string;
  notes: string;
  postId: string;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  project_id?: string;
}

let cachedKey: ServiceAccountKey | null = null;

/**
 * Parse GOOGLE_SERVICE_ACCOUNT_JSON. Accepts raw JSON or base64-encoded JSON.
 * Throws a clear, actionable error rather than a JSON parse stack trace.
 */
export function getServiceAccountKey(): ServiceAccountKey {
  if (cachedKey) return cachedKey;

  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || !raw.trim()) {
    throw new Error(
      'GOOGLE_SERVICE_ACCOUNT_JSON is not set. Content automation cannot read Sheets without it.',
    );
  }

  let text = raw.trim();
  if (!text.startsWith('{')) {
    try {
      text = Buffer.from(text, 'base64').toString('utf8').trim();
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is neither valid JSON nor valid base64.');
    }
  }

  let parsed: ServiceAccountKey;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON did not parse as JSON after decoding.');
  }

  if (!parsed.client_email || !parsed.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key.');
  }

  // Render env vars often arrive with literal \n instead of real newlines.
  parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');

  cachedKey = parsed;
  return parsed;
}

/** The address each client Sheet must be shared with, as Editor. */
export function getServiceAccountEmail(): string {
  return getServiceAccountKey().client_email;
}

export function isServiceAccountConfigured(): boolean {
  try {
    getServiceAccountKey();
    return true;
  } catch {
    return false;
  }
}

let cachedSheets: sheets_v4.Sheets | null = null;

export function getSheetsClient(): sheets_v4.Sheets {
  if (cachedSheets) return cachedSheets;
  const key = getServiceAccountKey();
  const auth = new google.auth.JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.readonly',
    ],
  });
  cachedSheets = google.sheets({ version: 'v4', auth });
  return cachedSheets;
}

// ─── Read ────────────────────────────────────────────────────────────────────

function cell(row: string[], idx: number): string {
  return (row[idx] ?? '').toString().trim();
}

/**
 * Read every data row from the tab. Row 1 is assumed to be the header.
 * Returns rows in Sheet order with their true 1-indexed row numbers.
 */
export async function readScheduleRows(
  spreadsheetId: string,
  tabName: string,
): Promise<ScheduleRow[]> {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tabName}!${SHEET_RANGE}`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const values = (res.data.values || []) as string[][];
  const out: ScheduleRow[] = [];

  // Skip the header row (index 0 → Sheet row 1)
  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const rowNumber = i + 1;

    // Skip fully blank rows
    if (row.every((c) => !c || !c.toString().trim())) continue;

    out.push({
      rowNumber,
      platform: cell(row, COL.platform),
      scheduledRaw: cell(row, COL.scheduledAt),
      caption: cell(row, COL.caption),
      pillar: cell(row, COL.pillar),
      assetLink: cell(row, COL.assetLink),
      status: cell(row, COL.status),
      liveUrl: cell(row, COL.liveUrl),
      notes: cell(row, COL.notes),
      postId: cell(row, COL.postId),
    });
  }

  return out;
}

/** Rows a human has marked Ready (case-insensitive). */
export async function readReadyRows(
  spreadsheetId: string,
  tabName: string,
): Promise<ScheduleRow[]> {
  const rows = await readScheduleRows(spreadsheetId, tabName);
  return rows.filter((r) => r.status.toLowerCase() === SHEET_STATUS.ready.toLowerCase());
}

// ─── Write back ──────────────────────────────────────────────────────────────

export interface RowWriteback {
  status?: string;
  liveUrl?: string;
  notes?: string;
  postId?: string;
}

/**
 * Write back only the system-owned columns (F Status, G Live URL, H Notes,
 * I Post ID). Human columns A–E are never touched.
 */
export async function writeBackRow(
  spreadsheetId: string,
  tabName: string,
  rowNumber: number,
  patch: RowWriteback,
): Promise<void> {
  const sheets = getSheetsClient();
  const data: sheets_v4.Schema$ValueRange[] = [];

  if (patch.status !== undefined) {
    data.push({ range: `${tabName}!F${rowNumber}`, values: [[patch.status]] });
  }
  if (patch.liveUrl !== undefined) {
    data.push({ range: `${tabName}!G${rowNumber}`, values: [[patch.liveUrl]] });
  }
  if (patch.notes !== undefined) {
    // Sheets rejects cells over 50k chars; error text can be long.
    data.push({ range: `${tabName}!H${rowNumber}`, values: [[patch.notes.slice(0, 40000)]] });
  }
  if (patch.postId !== undefined) {
    data.push({ range: `${tabName}!I${rowNumber}`, values: [[patch.postId]] });
  }

  if (data.length === 0) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: 'RAW', data },
  });
}

/** Cheap reachability check used by /status and before the first sync. */
export async function checkSheetAccess(
  spreadsheetId: string,
  tabName: string,
): Promise<{ ok: boolean; title?: string; error?: string }> {
  try {
    const sheets = getSheetsClient();
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: 'properties.title,sheets.properties.title' });
    const tabs = (meta.data.sheets || []).map((s) => s.properties?.title).filter(Boolean);
    if (tabName && !tabs.includes(tabName)) {
      return {
        ok: false,
        title: meta.data.properties?.title || undefined,
        error: `Tab "${tabName}" not found. Tabs present: ${tabs.join(', ') || '(none)'}`,
      };
    }
    return { ok: true, title: meta.data.properties?.title || undefined };
  } catch (e: any) {
    const msg = e?.message || String(e);
    const hint = /permission|forbidden|403/i.test(msg)
      ? ` — share the Sheet with ${safeEmail()} as Editor`
      : '';
    return { ok: false, error: msg + hint };
  }
}

function safeEmail(): string {
  try {
    return getServiceAccountEmail();
  } catch {
    return 'the service account';
  }
}
