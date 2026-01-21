/**
 * Google Drive import utilities
 * Downloads files from Drive and saves to our storage
 */

import { createDriveClient } from './googleAuth.js';
import { saveFile } from './storage.js';
import { saveAsset } from '../db.js';
import type { Asset, GoogleDriveFile } from '../types.js';

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB

/**
 * Determine asset type from MIME type
 */
function getAssetType(mimeType: string): 'photo' | 'video' | 'logo' | 'doc' {
  if (mimeType.startsWith('image/')) {
    if (mimeType.includes('logo') || mimeType.includes('icon')) {
      return 'logo';
    }
    return 'photo';
  }
  if (mimeType.startsWith('video/')) {
    return 'video';
  }
  return 'doc';
}

/**
 * Export Google Docs/Sheets to downloadable format
 */
async function exportGoogleFile(
  drive: any,
  fileId: string,
  mimeType: string
): Promise<{ buffer: Buffer; exportedMimeType: string; exportedName: string }> {
  let exportMimeType: string;
  let exportName: string;
  
  if (mimeType === 'application/vnd.google-apps.document') {
    exportMimeType = 'application/pdf';
    exportName = 'document.pdf';
  } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    exportMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    exportName = 'spreadsheet.xlsx';
  } else if (mimeType === 'application/vnd.google-apps.presentation') {
    exportMimeType = 'application/pdf';
    exportName = 'presentation.pdf';
  } else {
    throw new Error(`Unsupported Google file type: ${mimeType}`);
  }
  
  const response = await drive.files.export(
    { fileId, mimeType: exportMimeType },
    { responseType: 'arraybuffer' }
  );
  
  return {
    buffer: Buffer.from(response.data),
    exportedMimeType: exportMimeType,
    exportedName: exportName
  };
}

/**
 * Download file from Google Drive
 */
async function downloadDriveFile(
  drive: any,
  fileId: string
): Promise<{ buffer: Buffer; mimeType: string; name: string; size: number }> {
  // Get file metadata
  const fileMetadata = await drive.files.get({
    fileId,
    fields: 'name, mimeType, size',
    supportsAllDrives: true
  });
  
  const name = fileMetadata.data.name || 'unnamed';
  const mimeType = fileMetadata.data.mimeType || 'application/octet-stream';
  const size = parseInt(fileMetadata.data.size || '0', 10);
  
  if (size > MAX_FILE_SIZE) {
    throw new Error(`File size (${size / 1024 / 1024}MB) exceeds maximum of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }
  
  // Check if it's a Google-native file (Docs, Sheets, etc.)
  if (mimeType.startsWith('application/vnd.google-apps.')) {
    const exported = await exportGoogleFile(drive, fileId, mimeType);
    return {
      buffer: exported.buffer,
      mimeType: exported.exportedMimeType,
      name: exported.exportedName,
      size: exported.buffer.length
    };
  }
  
  // Regular file - download directly
  const response = await drive.files.get(
    { fileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'arraybuffer' }
  );
  
  return {
    buffer: Buffer.from(response.data),
    mimeType,
    name,
    size: response.data.byteLength
  };
}

/**
 * Import files from Google Drive
 */
export async function importDriveFiles(
  workspaceId: string,
  clientId: string,
  userId: string,
  files: GoogleDriveFile[]
): Promise<Asset[]> {
  const drive = await createDriveClient(workspaceId);
  const importedAssets: Asset[] = [];
  
  for (const file of files) {
    try {
      // Download file from Drive
      const { buffer, mimeType, name, size } = await downloadDriveFile(drive, file.fileId);
      
      // Save to our storage
      const { filename, url, size: savedSize } = await saveFile(buffer, name, mimeType);
      
      // Create asset record
      const asset: Asset = {
        id: `asset_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        workspaceId,
        clientId,
        source: 'google_drive',
        originalFileId: file.fileId,
        originalName: file.name,
        filename,
        mimeType,
        size: savedSize,
        storageUrl: url,
        type: getAssetType(mimeType),
        status: 'pending',
        tags: [],
        createdByUserId: userId,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      
      saveAsset(asset);
      importedAssets.push(asset);
    } catch (error: any) {
      console.error(`Error importing file ${file.fileId}:`, error);
      // Continue with other files
    }
  }
  
  return importedAssets;
}

