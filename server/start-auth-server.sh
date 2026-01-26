#!/bin/bash

# Start the 2Fly Auth Server
# This script sets up the environment and starts the server

cd "$(dirname "$0")" || exit 1

echo "🚀 Starting 2Fly Auth Server..."
echo ""

# Check if .env exists, create from example if not
if [ ! -f .env ]; then
  echo "📝 Creating .env file from template..."
  cat > .env << EOF
# JWT Secret (change this to a strong random string in production)
JWT_SECRET=$(openssl rand -hex 32)

# Frontend URL
FRONTEND_URL=http://localhost:5173

# Node Environment
NODE_ENV=development

# Server Port
PORT=3001

# Google OAuth (if using Google Drive integration)
# GOOGLE_CLIENT_ID=your-client-id
# GOOGLE_CLIENT_SECRET=your-client-secret
# GOOGLE_REDIRECT_URI=http://localhost:3001/api/integrations/google-drive/callback
# GOOGLE_TOKEN_SECRET=$(openssl rand -hex 32)
EOF
  echo "✅ Created .env file"
  echo ""
fi

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies..."
  npm install
  echo ""
fi

# Check if JWT_SECRET is set
if ! grep -q "JWT_SECRET=" .env || grep -q "JWT_SECRET=change-me" .env; then
  echo "⚠️  Warning: JWT_SECRET should be set to a strong random string"
  echo "   Generating a new one..."
  # Generate a random secret
  NEW_SECRET=$(openssl rand -hex 32)
  if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' "s/JWT_SECRET=.*/JWT_SECRET=$NEW_SECRET/" .env
  else
    # Linux
    sed -i "s/JWT_SECRET=.*/JWT_SECRET=$NEW_SECRET/" .env
  fi
  echo "✅ Updated JWT_SECRET in .env"
  echo ""
fi

echo "🔧 Environment configured"
echo "📁 Data directory: $(pwd)/data"
echo "🌐 Server will run on: http://localhost:3001"
echo "🔗 Frontend URL: http://localhost:5173"
echo ""
echo "Starting server..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Start the server
npm run dev
