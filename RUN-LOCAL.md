# Running 2Fly Client Portal Locally

## Quick Start

### 1. Start the Backend Server (Auth API)

```bash
cd server
./start-auth-server.sh
```

Or manually:
```bash
cd server
npm install
npm run dev
```

The server will run on `http://localhost:3001`

### 2. Start the Frontend (if using Vite dev server)

In a separate terminal:
```bash
npm run dev
```

Or use the simple Python server:
```bash
./start-server.sh
```

The frontend will be available at `http://localhost:8000` (Python) or `http://localhost:5173` (Vite)

## Environment Setup

The `start-auth-server.sh` script will automatically:
- Create a `.env` file if it doesn't exist
- Generate a secure JWT_SECRET
- Install dependencies if needed
- Start the server

### Manual .env Setup

If you need to create `.env` manually, create `server/.env`:

```env
JWT_SECRET=your-strong-secret-key-here-min-32-chars
FRONTEND_URL=http://localhost:5173
NODE_ENV=development
PORT=3001
```

## Testing the New Credentials System

### 1. Create an Agency (First Time Setup)

You'll need to create an agency and an initial OWNER user. For now, you can do this via API or create a migration script.

### 2. Test the Flow

1. **Staff Login**: Visit `http://localhost:8000/staff-login.html`
   - Registration is now disabled
   - Use "Have an invite link?" to accept invitations
   - Use "Forgot password?" to reset passwords

2. **Accept Invitation**: Visit `http://localhost:8000/accept-invite.html?token=TOKEN&agencyId=AGENCY_ID`
   - Set password for invited users

3. **Forgot Password**: Visit `http://localhost:8000/forgot-password.html?agencyId=AGENCY_ID`
   - Request password reset link

4. **Reset Password**: Visit `http://localhost:8000/reset-password.html?token=TOKEN&agencyId=AGENCY_ID`
   - Reset password using token from email

## API Endpoints

### Authentication
- `POST /api/auth/login` - Login with email/password
- `POST /api/auth/logout` - Logout
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password with token

### User Management (Admin/Owner only)
- `POST /api/users/invite` - Invite new user
- `POST /api/users/resend-invite` - Resend invitation
- `POST /api/users/accept-invite` - Accept invitation
- `GET /api/users` - List users
- `PATCH /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user

## Dev Mode Features

- **Email Links**: In dev mode, invite and reset links are logged to the console
- **No Email Service**: Emails are not actually sent, links appear in server logs
- **Rate Limiting**: In-memory (resets on server restart)

## Data Storage

All data is stored in JSON files in `server/data/`:
- `agencies.json` - Agency records
- `users.json` - User accounts
- `clients.json` - Client records
- `invite-tokens.json` - Invitation tokens
- `password-reset-tokens.json` - Password reset tokens
- `audit-logs.json` - Audit trail

## Troubleshooting

### Port Already in Use
```bash
lsof -ti:3001 | xargs kill -9
```

### Dependencies Not Found
```bash
cd server
npm install
```

### JWT Secret Issues
The script auto-generates a secure secret. If you need to change it, edit `server/.env` and set `JWT_SECRET` to a strong random string (32+ characters).
