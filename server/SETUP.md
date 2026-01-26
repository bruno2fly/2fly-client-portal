# Initial Setup - Create Agency and Owner

This script creates the initial agency and OWNER user needed to start using the credentials system.

## Quick Setup (Recommended)

```bash
cd server
npm run setup
```

This will create:
- **Agency**: "2Fly Agency"
- **Owner Email**: owner@2flyflow.com
- **Owner Name**: "Agency Owner"
- **Status**: INVITED (you'll get an invite link)

## Custom Setup

### Option 1: Invite Flow (Recommended)

```bash
npm run setup "My Agency" "admin@example.com" "Admin Name"
```

This creates an INVITED user and generates an invite link.

### Option 2: Direct Password (Testing Only)

```bash
npm run setup "My Agency" "admin@example.com" "Admin Name" --password "mypassword123"
```

⚠️ **Warning**: Only use this for local testing. In production, always use the invite flow.

## What Gets Created

1. **Agency** (`data/agencies.json`)
   - ID: auto-generated
   - Name: as specified
   - Created timestamp

2. **Owner User** (`data/users.json`)
   - Role: OWNER
   - Email: as specified
   - Status: INVITED (or ACTIVE if using --password)
   - Agency-scoped

3. **Invite Token** (`data/invite-tokens.json`) - if using invite flow
   - Valid for 72 hours
   - One-time use

## Output

The script will output:
- Agency ID
- User ID
- **Invite Link** (if using invite flow)
- Next steps

## Example Output

```
🚀 Setting up 2Fly Agency and Initial Owner...

✅ Created agency: "2Fly Agency" (ID: agency_1234567890_abc123)
✅ Created owner user: owner@2flyflow.com (ID: user_1234567890_xyz789)

📧 Invite link generated:
   http://localhost:5173/accept-invite?token=TOKEN&agencyId=agency_1234567890_abc123

📝 Next steps:
   1. Copy the invite link above
   2. Visit the link in your browser
   3. Set your password
   4. Log in at /staff-login.html
```

## Using the Invite Link

1. Copy the invite link from the output
2. Open it in your browser
3. Set your password (minimum 8 characters)
4. You'll be redirected to the login page
5. Log in with your email and the password you just set

## Troubleshooting

### "Agency already exists"
The script will use the existing agency. If you want a new one, use a different name.

### "Owner user already exists"
The script will:
- If INVITED: Generate a new invite link
- If ACTIVE: Tell you the user is ready to log in

### "Cannot find module"
Make sure you've run `npm install` first.

## After Setup

Once you have an active OWNER user, you can:
1. Log in at `/staff-login.html`
2. Access the agency dashboard
3. Invite more users via the API or UI (once implemented)
4. Create clients and invite client users

## API Usage

You can also create agencies and users via the API:

```bash
# Create agency (manual)
# Then invite owner:
curl -X POST http://localhost:3001/api/users/invite \
  -H "Content-Type: application/json" \
  -H "Cookie: 2fly_session=YOUR_JWT_TOKEN" \
  -d '{
    "email": "owner@example.com",
    "name": "Owner Name",
    "role": "OWNER"
  }'
```

But the setup script is easier for initial setup!
