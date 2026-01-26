#!/bin/bash

# Setup script wrapper for initial agency and owner creation
# Usage: ./setup.sh [agency-name] [owner-email] [owner-name] [--password] [password]

cd "$(dirname "$0")/.." || exit 1

echo "🔧 Running 2Fly Setup Script..."
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
  echo "📦 Installing dependencies first..."
  npm install
  echo ""
fi

# Run the TypeScript setup script
npx tsx src/scripts/setup.ts "$@"
