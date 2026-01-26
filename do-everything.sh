#!/bin/bash
# 1) Start local servers (background)  2) Push to Git  3) Deploy to Vercel

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

echo "=========================================="
echo "  2Fly – Run Local + Push + Deploy"
echo "=========================================="
echo ""

# Free ports
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
sleep 2

# 1. Start local (background)
echo "🖥️  Starting local servers in background..."
cd "$ROOT/public"
nohup python3 -m http.server 8000 > /tmp/2fly-frontend.log 2>&1 &
PY_PID=$!
cd "$ROOT"

cd "$ROOT/server"
[ ! -d node_modules ] && npm install --silent
[ ! -f .env ] && {
  s=$(openssl rand -hex 32 2>/dev/null || echo "dev-secret-$(date +%s)")
  printf "JWT_SECRET=%s\nFRONTEND_URL=http://localhost:8000\nNODE_ENV=development\nPORT=3001\n" "$s" > .env
}
npm run build 2>/dev/null
nohup node dist/server.js > /tmp/2fly-backend.log 2>&1 &
NODE_PID=$!
disown %1 2>/dev/null || true
disown %2 2>/dev/null || true
cd "$ROOT"

echo "   Frontend: http://localhost:8000 (PID $PY_PID)"
echo "   Backend:  http://localhost:3001 (PID $NODE_PID)"
echo ""
sleep 5

# 2. Deploy (git push + Vercel)
echo "📤 Git push..."
git add .gitignore vercel.json package.json tsconfig.json tsconfig.node.json vite.config.ts dummy-entry.js
git add public/ server/package.json server/package-lock.json server/tsconfig.json
git add server/create-owner-credentials.ts server/generate-invite.js server/get-token-from-hash.py
git add server/set-owner-password.js server/fix-and-run.sh server/start-auth-server.sh server/setup.sh server/update-env.sh
git add server/src/ start-all.sh start-all.command deploy.sh do-everything.sh
git add GET-STARTED.md RUN-LOCAL.md RUN-EVERYTHING.md START-BACKEND.md START-FRONTEND.md README.md server/README.md server/SETUP.md server/START-SERVER.md 2>/dev/null || true

if ! git diff --cached --quiet 2>/dev/null; then
  git commit -m "Run local + deploy fixes" || true
  echo "   ✅ Committed."
fi
PUSH_OK=0
git push origin main && PUSH_OK=1 || echo "   ⚠️  Push failed (check remote, network)."
echo ""

echo "🚀 Vercel deploy..."
VERCEL_OK=0
npx vercel --prod --yes && VERCEL_OK=1 || echo "   ⚠️  Vercel failed (run: npx vercel --prod)."
echo ""

echo "=========================================="
echo "  ✅ Local:  http://localhost:8000 (logs: /tmp/2fly-*.log)"
echo "  Stop:     kill $PY_PID $NODE_PID  OR  lsof -ti:8000 | xargs kill -9; lsof -ti:3001 | xargs kill -9"
[ "$PUSH_OK" = "1" ] && echo "  ✅ Git:    pushed" || echo "  ⚠️  Git:    push failed"
[ "$VERCEL_OK" = "1" ] && echo "  ✅ Vercel: deployed" || echo "  ⚠️  Vercel: deploy failed"
echo "=========================================="
