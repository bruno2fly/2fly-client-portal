# Get Started with 2Fly Credentials System

## Step 1: Install Dependencies

```bash
cd server
npm install
```

## Step 2: Run Initial Setup

This creates your first agency and OWNER user:

```bash
cd server
npm run setup
```

**Output will include:**
- Agency ID
- Invite link for the owner

## Step 3: Accept Invitation

1. Copy the invite link from Step 2
2. Open it in your browser
3. Set your password (min 8 characters)
4. You'll be redirected to login

## Step 4: Start the Server

```bash
cd server
npm run dev
```

Server runs on **http://localhost:3001**

## Step 5: Start Frontend

In a separate terminal:

```bash
./start-server.sh
```

Frontend runs on **http://localhost:8000**

## Step 6: Log In

1. Visit **http://localhost:8000/staff-login.html**
2. Enter the email you used in setup
3. Enter the password you set
4. You'll be logged into the agency dashboard

## What You Can Do Now

✅ **Log in** with your OWNER account  
✅ **Invite staff** via API (user management UI coming soon)  
✅ **Invite clients** via API (client creation flow update coming soon)  
✅ **Reset passwords** via forgot password flow  
✅ **Manage users** via API endpoints  

## Quick Test Commands

```bash
# Health check
curl http://localhost:3001/health

# API info
curl http://localhost:3001/

# Login (replace with your credentials)
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{
    "email": "owner@2flyflow.com",
    "password": "your-password",
    "agencyId": "your-agency-id"
  }'
```

## Next Steps

1. ✅ Initial setup complete
2. 🔄 Update agency.js to use invite flow for client creation
3. 🔄 Add user management UI to agency dashboard
4. 🔄 Test the full flow end-to-end

## Need Help?

- See `server/SETUP.md` for detailed setup options
- See `RUN-LOCAL.md` for local development guide
- See `QUICK-START.md` for quick reference
