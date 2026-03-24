/**
 * TEMPORARY recovery/debug routes — remove after data is recovered.
 * GET /api/debug-volume?key=recover2fly
 * GET /api/debug-volume/download?key=recover2fly
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const router = Router();
const RECOVER_KEY = 'recover2fly';

function dataRoot(): string {
  return process.env.RAILWAY_VOLUME_MOUNT_PATH || join(process.cwd(), 'data');
}

function requireRecoverKey(req: Request, res: Response, next: NextFunction): void {
  const key = typeof req.query.key === 'string' ? req.query.key : '';
  if (key !== RECOVER_KEY) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
}

type FileEntry = { relativePath: string; size: number; mtimeMs: number };

function walkDir(dir: string, root: string): FileEntry[] {
  const out: FileEntry[] = [];
  if (!existsSync(dir)) return out;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walkDir(full, root));
    } else {
      const st = statSync(full);
      out.push({
        relativePath: relative(root, full) || e.name,
        size: st.size,
        mtimeMs: st.mtimeMs,
      });
    }
  }
  return out;
}

function looksLikeBackupOrTemp(name: string): boolean {
  const lower = name.toLowerCase();
  return /\.bak\d*$/i.test(lower) || /\.old\d*$/i.test(lower) || /\.tmp\d*$/i.test(lower);
}

const MAX_PORTAL_EMBED = 2_000_000;
const MAX_PREVIEW = 12_000;

router.get('/api/debug-volume', requireRecoverKey, (req, res) => {
  try {
    const root = dataRoot();
    const files = existsSync(root) ? walkDir(root, root) : [];
    const portalPath = join(root, 'portal-state.json');

    let portalRaw: string | null = null;
    let portalState: unknown = null;
    let portalParseError: string | null = null;

    if (existsSync(portalPath)) {
      portalRaw = readFileSync(portalPath, 'utf-8');
      try {
        portalState = JSON.parse(portalRaw) as unknown;
      } catch (e: unknown) {
        portalParseError = e instanceof Error ? e.message : String(e);
      }
    }

    const portalTooLarge =
      portalRaw != null && Buffer.byteLength(portalRaw, 'utf8') > MAX_PORTAL_EMBED;

    const backupFiles = files.filter((f) => looksLikeBackupOrTemp(f.relativePath));

    const backupDetails = backupFiles.map((f) => {
      const full = join(root, f.relativePath);
      let rawPreview = '';
      let parseError: string | null = null;
      let parsed: unknown = null;
      try {
        const raw = readFileSync(full, 'utf-8');
        rawPreview = raw.length > MAX_PREVIEW ? raw.slice(0, MAX_PREVIEW) + '\n...[truncated]' : raw;
        try {
          parsed = JSON.parse(raw) as unknown;
        } catch (e: unknown) {
          parseError = e instanceof Error ? e.message : String(e);
        }
      } catch (e: unknown) {
        parseError = e instanceof Error ? e.message : String(e);
      }
      let jsonKeyCount: number | null = null;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        jsonKeyCount = Object.keys(parsed).length;
      }
      return {
        relativePath: f.relativePath,
        size: f.size,
        mtimeMs: f.mtimeMs,
        parseError,
        jsonKeyCount,
        contentPreview: rawPreview,
      };
    });

    res.json({
      dataRoot: root,
      volumeEnv: process.env.RAILWAY_VOLUME_MOUNT_PATH || null,
      rootExists: existsSync(root),
      fileCount: files.length,
      files: files.map((f) => ({
        path: f.relativePath,
        size: f.size,
        mtimeMs: f.mtimeMs,
      })),
      portalStatePath: portalPath,
      portalStateExists: existsSync(portalPath),
      portalStateByteLength: portalRaw ? Buffer.byteLength(portalRaw, 'utf8') : null,
      portalStateJson: portalTooLarge ? null : portalState,
      portalStateParseError: portalParseError,
      portalStateOmittedReason: portalTooLarge
        ? `Raw file exceeds ${MAX_PORTAL_EMBED} bytes; use /api/debug-volume/download`
        : null,
      portalStateRawPreview:
        portalParseError && portalRaw
          ? portalRaw.slice(0, 8000)
          : portalTooLarge
            ? portalRaw!.slice(0, 8000) + '\n...[truncated — use download endpoint]'
            : null,
      backupAndRelatedFiles: backupDetails,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: message });
  }
});

router.get('/api/debug-volume/download', requireRecoverKey, (req, res) => {
  const root = dataRoot();
  const portalPath = join(root, 'portal-state.json');
  if (!existsSync(portalPath)) {
    res.status(404).json({ error: 'portal-state.json not found', dataRoot: root });
    return;
  }
  const raw = readFileSync(portalPath);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="portal-state-recovery.json"');
  res.send(raw);
});

export default router;
