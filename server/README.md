# 2Fly Server

Backend server for 2Fly Client Portal with Google Drive integration.

## Setup

1. Install dependencies:
```bash
cd server
npm install
```

2. Copy `.env.example` to `.env` and fill in your Google OAuth credentials:
```bash
cp .env.example .env
```

3. Set up Google Cloud Console:
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Create a new project or select existing
   - Enable Google Drive API
   - Create OAuth 2.0 credentials (Web application)
   - Add authorized redirect URI: `http://localhost:3001/api/integrations/google-drive/callback`
   - Add authorized JavaScript origins: `http://localhost:5173`
   - Copy Client ID and Client Secret to `.env`

4. Set `GOOGLE_TOKEN_SECRET` in `.env` (at least 32 characters for security)

5. Run the server:
```bash
npm run dev
```

## Google Cloud Setup Instructions

### APIs to Enable:
1. Google Drive API
2. Google Identity Services (for OAuth)

### OAuth Client Configuration:
- **Type**: Web application
- **Authorized JavaScript origins**: 
  - `http://localhost:5173` (development)
  - Your production frontend URL
- **Authorized redirect URIs**:
  - `http://localhost:3001/api/integrations/google-drive/callback` (development)
  - Your production callback URL

### Required Scopes:
- `https://www.googleapis.com/auth/drive.file` - Access to files created by the app
- `openid` - OpenID Connect
- `email` - User email
- `profile` - User profile

## API Endpoints

### Google Drive Integration

- `GET /api/integrations/google-drive/connect` - Get OAuth URL
- `GET /api/integrations/google-drive/callback` - OAuth callback handler
- `GET /api/integrations/google-drive/status` - Check connection status
- `POST /api/integrations/google-drive/import` - Import files from Drive
- `POST /api/integrations/google-drive/disconnect` - Disconnect integration

## Data Storage

MVP uses JSON files in `data/` directory:
- `workspaces.json` - Workspace data
- `staff.json` - Staff members
- `integrations.json` - Google integrations
- `assets.json` - Imported assets

Uploaded files are stored in `uploads/` directory.

**Production Migration**: Replace with PostgreSQL/MongoDB and S3/Cloudflare R2.

