# Quick Fix - Get Your Invite Link

## Problem
- You're trying to access `localhost:5173` but the server is running on `localhost:8000`
- You need the actual token (not "TOKEN" placeholder)

## Solution

### Step 1: Use Port 8000 (Python Server is Already Running!)

Your Python server is already running on port 8000. Use that instead of 5173.

### Step 2: Get the Actual Token

Run this Python script (no Node.js needed):

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server
python3 get-token-from-hash.py
```

This will output the complete invite link with the correct token.

### Step 3: Use the Link

Copy the link from the output and open it in your browser.

## Quick Command

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server && python3 get-token-from-hash.py
```

## What You'll Get

The script will output something like:

```
✅ Generated new invite token!

📧 Invite Link:
   http://localhost:8000/accept-invite.html?token=ACTUAL_TOKEN_HERE&agencyId=agency_1737676800000_abc123
```

Copy that link and open it in your browser!

## Important Notes

- ✅ Use **port 8000** (not 5173)
- ✅ The Python server is already running
- ✅ Use the `.html` extension: `/accept-invite.html` (not just `/accept-invite`)
- ✅ The token will be a long random string
