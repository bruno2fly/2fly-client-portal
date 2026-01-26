#!/bin/bash
# Push to Git and deploy to Vercel. Run from project root.

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=========================================="
echo "  2Fly – Git Push & Vercel Deploy"
echo "=========================================="
echo ""

# 1. Git: add (explicit paths only), commit if changes, push
echo "📤 Git..."
git add .gitignore vercel.json package.json tsconfig.json tsconfig.node.json vite.config.ts dummy-entry.js
git add public/
git add server/package.json server/package-lock.json server/tsconfig.json
git add server/create-owner-credentials.ts server/generate-invite.js server/get-token-from-hash.py
git add server/set-owner-password.js server/fix-and-run.sh server/start-auth-server.sh server/setup.sh server/update-env.sh
git add server/src/
git add start-all.sh start-all.command deploy.sh
git add GET-STARTED.md RUN-LOCAL.md START-BACKEND.md START-FRONTEND.md README.md 2>/dev/null || true
git add server/README.md server/SETUP.md server/START-SERVER.md 2>/dev/null || true

if ! git diff --cached --quiet 2>/dev/null; then
  git commit -m "Updates: deploy script, fixes"
  echo "✅ Committed."
fi

echo "Pushing to origin main..."
git push origin main
echo "✅ Pushed."
echo ""

# 2. Vercel
echo "🚀 Vercel deploy..."
npx vercel --prod --yes
echo ""
echo "=========================================="
echo "  Done. Run ./start-all.sh for local."
echo "=========================================="
