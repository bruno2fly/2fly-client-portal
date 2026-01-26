#!/bin/bash
# Start both frontend (Python, port 8000) and backend (Node, port 3001).

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# Free ports if something is still running
echo "Checking ports 8000 and 3001..."
lsof -ti:8000 | xargs kill -9 2>/dev/null || true
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
sleep 1

PYTHON_PID=""
cleanup() {
  echo ""
  echo "Stopping servers..."
  [ -n "$PYTHON_PID" ] && kill $PYTHON_PID 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

echo "=========================================="
echo "  2Fly Client Portal – Starting all"
echo "=========================================="
echo ""

# Start Python frontend (port 8000)
cd "$ROOT/public"
if command -v python3 &>/dev/null; then
  python3 -m http.server 8000 &
elif command -v python &>/dev/null; then
  python -m SimpleHTTPServer 8000 &
else
  echo "Error: Python not found. Install Python to run the frontend."
  exit 1
fi
PYTHON_PID=$!
cd "$ROOT"

echo "  Frontend:  http://localhost:8000"
echo "    • Staff login:   http://localhost:8000/staff-login.html"
echo "    • Agency:        http://localhost:8000/agency.html"
echo ""
echo "  Backend:   http://localhost:3001 (API)"
echo ""
echo "  Stop both: Ctrl+C"
echo "=========================================="
echo ""

# Start Node backend (port 3001) – runs in foreground
cd "$ROOT/server"
if [ ! -d "node_modules" ]; then
  echo "Installing backend dependencies..."
  npm install
fi
if [ ! -f .env ]; then
  echo "Creating server/.env..."
  secret=$(openssl rand -hex 32 2>/dev/null || echo "change-me-in-production-$(date +%s)")
  cat > .env << EOF
JWT_SECRET=$secret
FRONTEND_URL=http://localhost:8000
NODE_ENV=development
PORT=3001
EOF
  echo "✅ Created .env"
fi
if [ ! -d "data" ] || [ ! -f "data/users.json" ]; then
  echo "⚠️  No server/data found. Run: cd server && npm run setup"
  echo "   Or copy server/data from a working install."
fi
echo "Building backend..."
npm run build
npm start
