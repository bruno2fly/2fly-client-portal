# Start Backend Server - Correct Commands

## Issue: Terminal shows `quote>` prompt

The terminal might be waiting for input. Press `Ctrl+C` to cancel and start fresh.

## Correct Commands

### Step 1: Navigate to Server Directory

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server
```

**OR** if you're already in the project root:

```bash
cd server
```

### Step 2: Install Dependencies (First Time Only)

```bash
npm install
```

### Step 3: Start the Server

```bash
npm run dev
```

**Note:** It's `npm run dev` (with a **space**), NOT `npm run_dev` (with underscore)

## What You Should See

After running `npm run dev`, you should see:

```
🚀 2Fly Server running on http://localhost:3001
📁 Uploads directory: /path/to/uploads
💾 Data directory: /path/to/data
```

## If You See `quote>` Prompt

1. Press `Ctrl+C` to cancel
2. Type the commands again (make sure no quotes or special characters)
3. Use `npm run dev` (space, not underscore)

## Complete Command Sequence

Copy and paste these commands one by one:

```bash
cd /Users/brunolima/Desktop/2Flyflow.com/2fly-client-portal-main/server
npm install
npm run dev
```

## Troubleshooting

### "command not found: npm"
Node.js is not installed. See `FIX-NODE.md` for installation instructions.

### "Cannot find module"
Run `npm install` first to install dependencies.

### Port 3001 already in use
```bash
lsof -ti:3001 | xargs kill -9
```
Then run `npm run dev` again.
