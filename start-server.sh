#!/bin/bash

# Offline local server – no npm/node needed. Uses Python only.
# Serves from public/ so /agency.js, /agency.html, etc. work.

cd "$(dirname "$0")/public" || exit 1
PORT=8000

echo "=========================================="
echo "  2Fly Client Portal – Local (offline)"
echo "=========================================="
echo ""
echo "  Server: http://localhost:$PORT"
echo ""
echo "  Pages:"
echo "    • Client portal:  http://localhost:$PORT/index.html"
echo "    • Client login:   http://localhost:$PORT/login.html"
echo "    • Staff login:    http://localhost:$PORT/staff-login.html"
echo "    • Agency:         http://localhost:$PORT/agency.html"
echo ""
echo "  Stop: Ctrl+C"
echo "=========================================="
echo ""

if command -v python3 &> /dev/null; then
    python3 -m http.server $PORT
elif command -v python &> /dev/null; then
    python -m SimpleHTTPServer $PORT
else
    echo "Error: Python not found. Install Python to run locally."
    exit 1
fi
