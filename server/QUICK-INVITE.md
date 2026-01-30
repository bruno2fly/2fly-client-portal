# Quick Invite Link Generation

Since npm isn't available in the sandbox, I've created the initial data files. To generate an invite link, run:

## Option 1: Using Node.js directly

```bash
cd server
node generate-invite.js
```

This will:
- Find the existing owner user
- Generate a secure invite token
- Create the invite link
- Display it in the console

## Option 2: Using npm script (when npm is available)

```bash
cd server
npm run generate-invite
```

## What Was Created

✅ **Agency**: "2Fly Agency" (ID: `agency_1737676800000_abc123`)
✅ **Owner User**: owner@2flyflow.com (ID: `user_1737676800000_xyz789`)
✅ **Status**: INVITED (ready for invite link)

## After Generating Invite Link

1. Copy the invite link from the output
2. Open it in your browser
3. Set your password (minimum 8 characters)
4. You'll be redirected to login
5. Log in with `owner@2flyflow.com` and your new password

## Files Ready

All data files are created in `server/data/`:
- ✅ `agencies.json` - Agency record
- ✅ `users.json` - Owner user (INVITED)
- ✅ `invite-tokens.json` - Will be populated when you run generate-invite.js
- ✅ `clients.json` - Empty, ready for clients
- ✅ `password-reset-tokens.json` - Empty, ready for resets
- ✅ `audit-logs.json` - Empty, ready for logs

## Next: Start Server

Once you have the invite link and have set your password:

```bash
cd server
npm install  # If not done yet
npm run dev
```

Then visit `http://localhost:8000/staff-login.html` to log in!
