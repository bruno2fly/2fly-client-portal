# Quick Start - Run Server Locally

## Step 1: Install Dependencies

```bash
cd server
npm install
```

This will install:
- bcrypt (password hashing)
- jsonwebtoken (JWT tokens)
- cookie-parser (session cookies)
- express, cors, dotenv (existing)

## Step 2: Start the Server

```bash
cd server
npm run dev
```

Or use the convenience script:
```bash
cd server
./start-auth-server.sh
```

The server will start on **http://localhost:3001**

## Step 3: Test the API

Open your browser or use curl:

```bash
# Health check
curl http://localhost:3001/health

# API info
curl http://localhost:3001/
```

## Step 4: Test Frontend

Start the frontend server (in a separate terminal):

```bash
# Option 1: Python server (simpler)
./start-server.sh

# Option 2: Vite dev server
npm run dev
```

Then visit:
- **Staff Login**: http://localhost:8000/staff-login.html
- **Accept Invite**: http://localhost:8000/accept-invite.html
- **Forgot Password**: http://localhost:8000/forgot-password.html

## Environment Variables

The `.env` file in `server/` is already configured with:
- `JWT_SECRET` - For signing JWT tokens
- `FRONTEND_URL` - CORS origin
- `PORT` - Server port (3001)
- `NODE_ENV` - development

## What's New

✅ **Invite-only registration** - No more public staff registration
✅ **Secure password hashing** - bcrypt with 12 rounds
✅ **JWT-based sessions** - httpOnly cookies
✅ **Password reset flow** - Token-based reset
✅ **Rate limiting** - Protection against brute force
✅ **Role-based access** - OWNER, ADMIN, STAFF, CLIENT
✅ **Multi-tenant** - Agency-scoped users

## Next Steps

1. Create an initial agency and OWNER user (via API or migration script)
2. Test the invite flow
3. Update agency.js to use invite flow for client creation
4. Add user management UI to agency dashboard

See `RUN-LOCAL.md` for detailed documentation.
