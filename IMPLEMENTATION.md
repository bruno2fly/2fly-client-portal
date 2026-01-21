# Google Drive Integration Implementation

## Files Changed/Added

### Backend (Server)
1. **server/package.json** - New server dependencies
2. **server/tsconfig.json** - TypeScript config for server
3. **server/src/types.ts** - Type definitions
4. **server/src/db.ts** - Database layer (JSON-based for MVP)
5. **server/src/utils/crypto.ts** - Token encryption utilities
6. **server/src/utils/googleAuth.ts** - Google OAuth utilities
7. **server/src/utils/storage.ts** - File storage utilities
8. **server/src/utils/driveImport.ts** - Drive import logic
9. **server/src/middleware/auth.ts** - Authentication middleware
10. **server/src/routes/googleDrive.ts** - Google Drive API routes
11. **server/src/server.ts** - Main Express server
12. **server/README.md** - Server setup instructions

### Frontend
13. **src/lib/googleDrive.ts** - Google Drive client library
14. **agency.html** - Added Google Drive button to approval form
15. **agency.js** - Added Google Drive integration handlers

## Setup Instructions

### 1. Backend Setup

```bash
cd server
npm install
cp .env.example .env
# Edit .env with your Google OAuth credentials
npm run dev
```

### 2. Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create/select a project
3. Enable **Google Drive API**
4. Create **OAuth 2.0 Client ID** (Web application):
   - **Authorized JavaScript origins**: 
     - `http://localhost:5173` (development)
     - Your production frontend URL
   - **Authorized redirect URIs**:
     - `http://localhost:3001/api/integrations/google-drive/callback` (development)
     - Your production callback URL
5. Copy Client ID and Secret to `server/.env`

### 3. Environment Variables

Set in `server/.env`:
- `GOOGLE_CLIENT_ID` - Your OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Your OAuth client secret
- `GOOGLE_REDIRECT_URI` - OAuth callback URL
- `GOOGLE_TOKEN_SECRET` - Encryption secret (32+ characters)
- `PORT` - Server port (default: 3001)
- `FRONTEND_URL` - Frontend URL (default: http://localhost:5173)

### 4. Frontend Configuration

Update `agency.js`:
- Set `API_BASE_URL` to your server URL
- Set `GOOGLE_API_KEY` if using Google Picker (optional)

## API Endpoints

### GET /api/integrations/google-drive/connect
Returns OAuth URL for connecting Google Drive.

**Headers:**
- `X-User-Id`: User ID
- `X-Workspace-Id`: Workspace ID

**Response:**
```json
{
  "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?..."
}
```

### GET /api/integrations/google-drive/callback
OAuth callback handler. Exchanges code for tokens and stores encrypted refresh token.

### GET /api/integrations/google-drive/status
Check connection status.

**Response:**
```json
{
  "connected": true,
  "status": "active",
  "connectedAt": 1234567890,
  "lastUsedAt": 1234567890
}
```

### POST /api/integrations/google-drive/import
Import files from Google Drive.

**Body:**
```json
{
  "clientId": "client-id",
  "files": [
    {
      "fileId": "drive-file-id",
      "name": "file-name",
      "mimeType": "image/jpeg",
      "size": 12345
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "imported": 2,
  "assets": [...]
}
```

### POST /api/integrations/google-drive/disconnect
Disconnect Google Drive integration.

## Features

✅ Multi-tenant workspace-level integration
✅ Encrypted refresh token storage (AES-256-GCM)
✅ OAuth 2.0 flow with Google Identity Services
✅ Google Drive Picker integration
✅ File import from Drive to local storage
✅ Support for Google Docs/Sheets (exports to PDF/XLSX)
✅ Shared Drives support
✅ File size limits (200MB default)
✅ Progress indicators and error handling

## Production Migration Notes

1. **Database**: Replace JSON files with PostgreSQL/MongoDB
2. **Storage**: Migrate from local `uploads/` to S3/Cloudflare R2
3. **Authentication**: Replace header-based auth with JWT tokens
4. **Thumbnails**: Implement image processing for thumbnails
5. **CDN**: Use CDN for asset delivery
6. **Rate Limiting**: Add rate limiting for API endpoints
7. **Error Monitoring**: Add error tracking (Sentry, etc.)

## Security Considerations

- Refresh tokens are encrypted at rest using AES-256-GCM
- Access tokens are never stored long-term
- Workspace isolation enforced at API level
- File size limits prevent abuse
- OAuth scopes limited to `drive.file` (only files created by app)

## Known Limitations (MVP)

1. Google Drive Picker requires access token - needs server endpoint to provide token
2. Local file storage (not production-ready)
3. JSON-based database (not scalable)
4. Simple header-based auth (needs JWT in production)

