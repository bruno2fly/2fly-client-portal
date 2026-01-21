/**
 * Storage utilities for file uploads
 * 
 * MVP: Store files locally in uploads/ directory
 * Production: Migrate to S3/Cloudflare R2
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

