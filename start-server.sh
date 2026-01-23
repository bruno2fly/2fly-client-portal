#!/bin/bash

# Simple HTTP server for agency.html
# This works without npm/node

PORT=8000

echo "Starting server on http://localhost:$PORT"
echo "Open http://localhost:$PORT/agency.html in your browser"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Try Python 3 first, then Python 2
if command -v python3 &> /dev/null; then
    python3 -m http.server $PORT
elif command -v python &> /dev/null; then
    python -m SimpleHTTPServer $PORT
else
    echo "Error: Python is not installed."
    echo "Please install Python or use a different method to serve the files."
    exit 1
fi
