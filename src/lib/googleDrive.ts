/**
 * Google Drive integration client
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface GoogleDriveFile {
  fileId: string;
  name: string;
  mimeType: string;
  size?: number;
}

export interface GoogleDriveStatus {
  connected: boolean;
  status: 'active' | 'revoked' | 'error' | 'not_connected';
  connectedAt?: number;
  lastUsedAt?: number;
  errorMessage?: string;
}

export interface ImportedAsset {
  id: string;
  workspaceId: string;
  clientId: string;
  source: 'google_drive';
  originalFileId: string;
  originalName: string;
  filename: string;
  mimeType: string;
  size: number;
  storageUrl: string;
  type: 'photo' | 'video' | 'logo' | 'doc';
  status: 'pending';
  tags: string[];
  createdAt: number;
}

/**
 * Get authentication headers
 * In production, get from session/JWT token
 */
function getAuthHeaders(): HeadersInit {
  // MVP: Get from localStorage (matching agency.js pattern)
  const session = localStorage.getItem('2fly_staff_session');
  if (session) {
    try {
      const sessionData = JSON.parse(session);
      // Extract workspace ID from current client selection
      // For MVP, we'll use a default workspace
      const workspaceId = 'default-workspace'; // TODO: Get from actual workspace selection
      return {
        'X-User-Id': sessionData.userId || sessionData.id || 'default-user',
        'X-Workspace-Id': workspaceId,
        'Content-Type': 'application/json'
      };
    } catch (e) {
      console.error('Error parsing session:', e);
    }
  }
  
  // Fallback for development
  return {
    'X-User-Id': 'default-user',
    'X-Workspace-Id': 'default-workspace',
    'Content-Type': 'application/json'
  };
}

/**
 * Check Google Drive connection status
 */
export async function checkGoogleDriveStatus(): Promise<GoogleDriveStatus> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/integrations/google-drive/status`, {
      method: 'GET',
      headers: getAuthHeaders()
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error checking Google Drive status:', error);
    return {
      connected: false,
      status: 'not_connected'
    };
  }
}

/**
 * Get Google Drive OAuth URL
 */
export async function getGoogleDriveAuthUrl(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/integrations/google-drive/connect`, {
    method: 'GET',
    headers: getAuthHeaders()
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get auth URL: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.authUrl;
}

/**
 * Import files from Google Drive
 */
export async function importGoogleDriveFiles(
  clientId: string,
  files: GoogleDriveFile[]
): Promise<ImportedAsset[]> {
  const response = await fetch(`${API_BASE_URL}/api/integrations/google-drive/import`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ clientId, files })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || `Failed to import files: ${response.statusText}`);
  }
  
  const data = await response.json();
  return data.assets;
}

/**
 * Disconnect Google Drive
 */
export async function disconnectGoogleDrive(): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/integrations/google-drive/disconnect`, {
    method: 'POST',
    headers: getAuthHeaders()
  });
  
  if (!response.ok) {
    throw new Error(`Failed to disconnect: ${response.statusText}`);
  }
}

/**
 * Load Google Drive Picker API
 */
export function loadGoogleDrivePicker(
  apiKey: string,
  onLoad: () => void,
  onError: (error: Error) => void
): void {
  // Check if already loaded
  if (window.gapi && window.gapi.load) {
    window.gapi.load('picker', { callback: onLoad, onerror: onError });
    return;
  }
  
  // Load gapi script
  const script = document.createElement('script');
  script.src = 'https://apis.google.com/js/api.js';
  script.onload = () => {
    window.gapi.load('picker', { callback: onLoad, onerror: onError });
  };
  script.onerror = () => {
    onError(new Error('Failed to load Google API'));
  };
  document.head.appendChild(script);
}

/**
 * Open Google Drive Picker
 */
export function openGoogleDrivePicker(
  accessToken: string,
  apiKey: string,
  onSelect: (files: GoogleDriveFile[]) => void,
  onCancel: () => void
): void {
  if (!window.google || !window.google.picker) {
    throw new Error('Google Picker API not loaded');
  }
  
  const view = new window.google.picker.DocsView(window.google.picker.ViewId.DOCS);
  view.setIncludeFolders(true);
  view.setSelectFolderEnabled(false);
  
  const picker = new window.google.picker.PickerBuilder()
    .setOAuthToken(accessToken)
    .setDeveloperKey(apiKey)
    .setCallback((data: any) => {
      if (data[window.google.picker.Response.ACTION] === window.google.picker.Action.PICKED) {
        const files: GoogleDriveFile[] = data[window.google.picker.Response.DOCUMENTS].map((doc: any) => ({
          fileId: doc.id,
          name: doc.name,
          mimeType: doc.mimeType,
          size: doc.sizeBytes
        }));
        onSelect(files);
      } else if (data[window.google.picker.Response.ACTION] === window.google.picker.Action.CANCEL) {
        onCancel();
      }
    })
    .addView(view)
    .setMaxItems(50) // Allow multi-select up to 50 files
    .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
    .build();
  
  picker.setVisible(true);
}

// Type declarations for Google APIs
declare global {
  interface Window {
    gapi?: {
      load: (api: string, options: { callback?: () => void; onerror?: (error: Error) => void }) => void;
      auth2?: any;
      client?: any;
    };
    google?: {
      picker: {
        PickerBuilder: new () => any;
        DocsView: new (viewId: any) => any;
        ViewId: {
          DOCS: any;
        };
        Response: {
          ACTION: string;
          DOCUMENTS: string;
        };
        Action: {
          PICKED: string;
          CANCEL: string;
        };
        Feature: {
          MULTISELECT_ENABLED: string;
        };
      };
    };
  }
}

