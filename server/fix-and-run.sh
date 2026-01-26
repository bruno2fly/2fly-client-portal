#!/bin/bash

# Fix esbuild error and start server

cd "$(dirname "$0")" || exit 1

echo "🔧 Fixing esbuild error..."
echo ""

# Remove node_modules and lock file
echo "📦 Removing old dependencies..."
rm -rf node_modules package-lock.json

# Reinstall
echo "📥 Installing dependencies..."
npm install

echo ""
echo "✅ Dependencies reinstalled!"
echo ""
echo "🚀 Starting server..."
echo ""

# Start server
npm run dev
