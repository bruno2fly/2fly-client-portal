# Start Frontend Server

## Issue: "ERR_CONNECTION_REFUSED" on localhost:5173

The frontend server is not running. You need to start it first.

## Option 1: Python Server (Easiest - Port 8000)

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main
./start-server.sh
```

Then use: **http://localhost:8000/accept-invite.html?token=TOKEN&agencyId=agency_1737676800000_abc123**

## Option 2: Vite Dev Server (Port 5173)

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main
npm run dev
```

Then use: **http://localhost:5173/accept-invite.html?token=TOKEN&agencyId=agency_1737676800000_abc123**

## Quick Start (Recommended)

**Terminal 1 - Frontend:**
```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main
./start-server.sh
```

**Terminal 2 - Backend (if needed):**
```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server
npm run dev
```

## Using the Invite Link

Once the server is running, you need the actual token. I can see you've generated a token in `invite-tokens.json`. 

The token hash is: `6053bf269ed5552caef3fb9fbe9a8034e79c5f3777f147b07ee1a04e90f40e15`

But you need the **plain token** (not the hash) for the URL. The `generate-invite.js` script outputs the plain token.

## Get the Actual Token

Run this to get the invite link with the correct token:

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server
node generate-invite.js
```

This will output the complete invite link with the correct token.

## Complete Workflow

1. **Start frontend server:**
   ```bash
   cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main
   ./start-server.sh
   ```

2. **Get invite link:**
   ```bash
   cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server
   node generate-invite.js
   ```

3. **Copy the invite link from output**

4. **Open it in your browser**

5. **Set your password**

6. **Log in at:** http://localhost:8000/staff-login.html
