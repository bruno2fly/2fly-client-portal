# Correct Path to Run Commands

## Your Project Location

Your project is located at:
```
/Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main
```

## Correct Commands

### Step 1: Navigate to Project Root

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main
```

### Step 2: Navigate to Server Directory

```bash
cd server
```

### Step 3: Generate Invite Link

```bash
node generate-invite.js
```

## Full Command Sequence

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server
node generate-invite.js
```

Or in one line:

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server && node generate-invite.js
```

## Check Current Directory

If you're not sure where you are:

```bash
pwd
```

This will show your current directory.

## Verify Server Directory Exists

```bash
ls -la /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server
```

You should see `generate-invite.js` in the list.

## If Node.js is Not Installed

See `FIX-NODE.md` for instructions on installing Node.js.
