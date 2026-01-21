#!/bin/bash

# 2Fly Server Setup Script

echo "🚀 Setting up 2Fly Server..."

# Check if .env exists
if [ ! -f .env ]; then
  echo "📝 Creating .env file from template..."
  cat > .env << 'EOF'
# Google OAuth Credentials
# Get these from Google Cloud Console: https://console.cloud.google.com/
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3001/api/integrations/google-drive/callback

# Token Encryption Secret (must be at least 32 characters)
GOOGLE_TOKEN_SECRET=change-this-to-a-secure-32-character-or-longer-secret-key

# Server Configuration
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173
EOF
  echo "✅ .env file created. Please edit it with your Google OAuth credentials."
else
  echo "✅ .env file already exists."
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Setup complete!"
  echo ""
  echo "Next steps:"
  echo "1. Edit .env file with your Google OAuth credentials"
  echo "2. Run 'npm run dev' to start the server"
  echo ""
else
  echo ""
  echo "❌ npm install failed. Please run 'npm install' manually."
  echo ""
fi

