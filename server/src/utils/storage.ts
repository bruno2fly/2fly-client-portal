/**
 * Storage utilities for file uploads
 *
 * ⚠️  MIGRATION NOTE (Apr 2026)
 * ──────────────────────────────────────────────────────────────────────
 * The express.static('/uploads') route in server.ts has been REMOVED to
 * stop Railway bandwidth charges (~$320/month).  All NEW uploads now go
 * through Vercel Blob (see routes/upload.ts) and return public CDN URLs.
 *
 * The saveFile() function below still writes to the LOCAL uploads/ dir
 * and returns relative /uploads/... paths. It is ONLY called by
 * driveImport.ts.  Any files saved this way are:
 *   1. Ephemeral on Railway (filesystem resets on redeploy)
 *   2. No longer served (the /uploads/* route returns 410 Gone)
 *
 * TODO: Migrate driveImport.ts to upload directly to Vercel Blob so
 * that imported Drive files get permanent CDN URLs. Until then, Drive-
 * imported assets with /uploads/... URLs will show broken images after
 * the next Railway redeploy.
 * ──────────────────────────────────────────────────────────────────────
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import { randomBytes } from 'crypto';
import type { Asset } from '../types.js';

const UPLOADS_DIR = join(process.cwd(), 'uploads');
const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

// Ensure uploads directory exists
if (!existsSync(UPLOADS_DIR)) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Generate a unique filename
 */
function generateFilename(originalName: string): string {
  const ext = extname(originalName);
  const timestamp = Date.now();
  const random = randomBytes(8).toString('hex');
  return `${timestamp}_${random}${ext}`;
}

/**
 * Save uploaded file to storage
 * Returns the storage URL/path
 */
export async function saveFile(
  buffer: Buffer,
  originalName: string,
  mimeType: string
): Promise<{ filename: string; path: string; url: string; size: number }> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }
  
  const filename = generateFilename(originalName);
  const path = join(UPLOADS_DIR, filename);
  
  writeFileSync(path, buffer);
  
  // In production, upload to S3/R2 and return public URL
  // For MVP, return relative path
  const url = `/uploads/${filename}`;
  
  return {
    filename,
    path,
    url,
    size: buffer.length
  };
}

/**
 * Read file from storage
 */
export function readFile(filename: string): Buffer {
  const path = join(UPLOADS_DIR, filename);
  if (!existsSync(path)) {
    throw new Error('File not found');
  }
  return readFileSync(path);
}

/**
 * Generate thumbnail URL (placeholder for MVP)
 * In production, use image processing library to create thumbnails
 */
export function generateThumbnailUrl(asset: Asset): string | undefined {
  // For MVP, return undefined (no thumbnails)
  // In production, generate and store thumbnails
  return undefined;
}

