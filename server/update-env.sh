#!/bin/bash

# Update .env with Google OAuth credentials
# Usage: ./update-env.sh

CLIENT_ID="1062456267326-7dkkvemc0nud22qng1tuk8hhnm9qe8am.apps.googleusercontent.com"
CLIENT_SECRET="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"

# Generate a secure token secret (32+ characters)
TOKEN_SECRET=$(openssl rand -hex 32)

cat > .env << EOF
# Google OAuth Credentials
GOOGLE_CLIENT_ID=${CLIENT_ID}
GOOGLE_CLIENT_SECRET=${CLIENT_SECRET}
GOOGLE_REDIRECT_URI=http://localhost:3001/api/integrations/google-drive/callback

# Token Encryption Secret (32+ characters)
GOOGLE_TOKEN_SECRET=${TOKEN_SECRET}

# Server Configuration
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
EOF

echo "✅ .env file updated with Google OAuth credentials!"
echo "   Client ID: ${CLIENT_ID}"
echo "   Token Secret: ${TOKEN_SECRET:0:20}..."

