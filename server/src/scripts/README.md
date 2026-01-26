# Setup Scripts

## Initial Setup Script

The `setup.ts` script creates the initial agency and OWNER user needed to start using the credentials system.

### Usage

```bash
# Default setup (creates invite)
npm run setup

# Custom agency and owner
npm run setup "My Agency" "admin@example.com" "Admin Name"

# Create with password (testing only)
npm run setup "My Agency" "admin@example.com" "Admin Name" --password "mypassword123"
```

### What It Does

1. Creates an agency (or uses existing if name matches)
2. Creates an OWNER user
3. Generates an invite link (or sets password if --password flag used)
4. Outputs the invite link and next steps

### Output

The script will show:
- Agency ID
- User ID  
- Invite link (if using invite flow)
- Password (if using --password flag)
- Next steps

### Examples

**Invite Flow (Recommended):**
```bash
npm run setup
# Creates: "2Fly Agency" with owner@2flyflow.com
# Outputs: Invite link to accept and set password
```

**Custom with Invite:**
```bash
npm run setup "Acme Corp" "john@acme.com" "John Doe"
# Creates: "Acme Corp" with john@acme.com
# Outputs: Invite link
```

**With Password (Testing Only):**
```bash
npm run setup "Test Agency" "test@test.com" "Test User" --password "test123"
# Creates: Active user with password "test123"
# ⚠️ Only for local testing!
```

### Files Created

- `data/agencies.json` - Agency records
- `data/users.json` - User accounts
- `data/invite-tokens.json` - Invitation tokens (if using invite flow)

### Troubleshooting

**"Agency already exists"**
- The script will use the existing agency
- Use a different name if you want a new agency

**"Owner user already exists"**
- If INVITED: Script generates a new invite link
- If ACTIVE: Script tells you user is ready to log in

**"Cannot find module"**
- Run `npm install` first
