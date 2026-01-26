# Start Backend Server

## Issue: `ERR_CONNECTION_REFUSED` on `localhost:3001`

The backend API server is not running. You need to start it.

## Quick Start

**Open a NEW terminal window** and run:

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server
npm install  # If not done yet
npm run dev
```

The server will start on **http://localhost:3001**

## What You Need Running

You need **TWO servers** running:

### Terminal 1 - Frontend (Port 8000)
```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main
./start-server.sh
```
✅ This is already running (you can see the accept-invite page)

### Terminal 2 - Backend API (Port 3001)
```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server
npm run dev
```
❌ This is NOT running (that's why you get the error)

## After Starting Backend

Once the backend is running, you should see:
```
🚀 2Fly Server running on http://localhost:3001
```

Then go back to your browser and try the accept-invite form again. It should work!

## Verify Backend is Running

Check if port 3001 is listening:
```bash
lsof -ti:3001
```

If it returns a process ID, the server is running.

## Troubleshooting

### "npm: command not found"
Install Node.js first (see `FIX-NODE.md`)

### "Port 3001 already in use"
Kill the process:
```bash
lsof -ti:3001 | xargs kill -9
```

### "Cannot find module"
Install dependencies:
```bash
cd server
npm install
```

## Complete Setup

**Terminal 1 (Frontend):**
```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main
./start-server.sh
# Server runs on http://localhost:8000
```

**Terminal 2 (Backend):**
```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server
npm install  # First time only
npm run dev
# Server runs on http://localhost:3001
```

**Terminal 3 (Get Invite Link - optional):**
```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server
python3 get-token-from-hash.py
# Copy the invite link
```

Then open the invite link in your browser!
