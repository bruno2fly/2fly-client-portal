/**
 * Setup script to create initial agency and OWNER user
 * Run with: npx tsx src/scripts/setup.ts
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { hashPassword, generateToken, generateId } from '../utils/auth.js';
import { sendInviteEmail } from '../utils/email.js';
import type { Agency, User, InviteToken } from '../types.js';

const DB_DIR = join(process.cwd(), 'data');
const AGENCIES_FILE = join(DB_DIR, 'agencies.json');
const USERS_FILE = join(DB_DIR, 'users.json');
const INVITE_TOKENS_FILE = join(DB_DIR, 'invite-tokens.json');

// Ensure data directory exists
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

function readJSON<T>(file: string, defaultValue: T): T {
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify(defaultValue, null, 2), 'utf-8');
    return defaultValue;
  }
  try {
    const content = readFileSync(file, 'utf-8');
    return JSON.parse(content) as T;
  } catch (e) {
    console.error(`Error reading ${file}:`, e);
    return defaultValue;
  }
}

function writeJSON<T>(file: string, data: T): void {
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

async function setup() {
  console.log('\n🚀 Setting up 2Fly Agency and Initial Owner...\n');

  // Get input from command line args or use defaults
  const args = process.argv.slice(2);
  const agencyName = args[0] || '2Fly Agency';
  const ownerEmail = args[1] || 'owner@2flyflow.com';
  const ownerName = args[2] || 'Agency Owner';
  
  // Check if --password flag is present
  const passwordIndex = args.indexOf('--password');
  const createWithPassword = passwordIndex !== -1;
  const password = createWithPassword ? (args[passwordIndex + 1] || 'admin123') : null;

  // Check if agency already exists
  const agencies = readJSON<Record<string, Agency>>(AGENCIES_FILE, {});
  let agencyId: string;
  let agency: Agency;

  const existingAgency = Object.values(agencies).find(a => a.name === agencyName);
  if (existingAgency) {
    console.log(`✅ Agency "${agencyName}" already exists (ID: ${existingAgency.id})`);
    agencyId = existingAgency.id;
    agency = existingAgency;
  } else {
    // Create agency
    agencyId = generateId('agency');
    agency = {
      id: agencyId,
      name: agencyName,
      createdAt: Date.now()
    };
    agencies[agencyId] = agency;
    writeJSON(AGENCIES_FILE, agencies);
    console.log(`✅ Created agency: "${agencyName}" (ID: ${agencyId})`);
  }

  // Check if owner user already exists
  const users = readJSON<Record<string, User>>(USERS_FILE, {});
  const existingUser = Object.values(users).find(
    u => u.agencyId === agencyId && u.email.toLowerCase() === ownerEmail.toLowerCase()
  );

  if (existingUser) {
    console.log(`✅ Owner user already exists: ${ownerEmail}`);
    console.log(`   User ID: ${existingUser.id}`);
    console.log(`   Status: ${existingUser.status}`);
    
    if (existingUser.status === 'INVITED') {
      // Find active invite token
      const inviteTokens = readJSON<Record<string, InviteToken>>(INVITE_TOKENS_FILE, {});
      const activeToken = Object.values(inviteTokens).find(
        t => t.userId === existingUser.id && !t.usedAt && t.expiresAt > Date.now()
      );
      
      if (activeToken) {
        // We can't get the plain token back, so generate a new one
        console.log('\n📧 Generating new invite link...');
        const { token, tokenHash } = generateToken();
        const expiresAt = Date.now() + (72 * 60 * 60 * 1000); // 72 hours
        
        // Invalidate old tokens
        Object.values(inviteTokens).forEach(t => {
          if (t.userId === existingUser.id && !t.usedAt) {
            t.usedAt = Date.now();
          }
        });
        
        const newInviteToken: InviteToken = {
          id: generateId('invite'),
          agencyId: agencyId,
          userId: existingUser.id,
          tokenHash,
          expiresAt,
          usedAt: null,
          createdAt: Date.now()
        };
        
        inviteTokens[newInviteToken.id] = newInviteToken;
        writeJSON(INVITE_TOKENS_FILE, inviteTokens);
        
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const inviteLink = `${frontendUrl}/accept-invite?token=${token}&agencyId=${agencyId}`;
        
        console.log(`\n✅ New invite link generated:`);
        console.log(`   ${inviteLink}\n`);
        return;
      }
    }
    
    if (existingUser.status === 'ACTIVE' && existingUser.passwordHash) {
      console.log(`\n✅ Owner is already active and can log in.`);
      console.log(`   Email: ${ownerEmail}`);
      console.log(`   Use the login page to sign in.\n`);
      return;
    }
  } else {
    // Create owner user
    const userId = generateId('user');
    let passwordHash: string | null = null;
    let status: 'INVITED' | 'ACTIVE' = 'INVITED';

    if (createWithPassword && password) {
      // Create with password (for testing)
      passwordHash = await hashPassword(password);
      status = 'ACTIVE';
      console.log(`\n⚠️  Creating user with password (for testing only)`);
      console.log(`   Password: ${password}`);
      console.log(`   ⚠️  Change this password immediately in production!\n`);
    }

    const ownerUser: User = {
      id: userId,
      agencyId: agencyId,
      email: ownerEmail.toLowerCase(),
      name: ownerName,
      role: 'OWNER',
      status: status,
      passwordHash: passwordHash,
      clientId: null,
      lastLoginAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    users[userId] = ownerUser;
    writeJSON(USERS_FILE, users);
    console.log(`✅ Created owner user: ${ownerEmail} (ID: ${userId})`);

    if (status === 'INVITED') {
      // Generate invite token
      const { token, tokenHash } = generateToken();
      const expiresAt = Date.now() + (72 * 60 * 60 * 1000); // 72 hours

      const inviteTokens = readJSON<Record<string, InviteToken>>(INVITE_TOKENS_FILE, {});
      const inviteToken: InviteToken = {
        id: generateId('invite'),
        agencyId: agencyId,
        userId: userId,
        tokenHash,
        expiresAt,
        usedAt: null,
        createdAt: Date.now()
      };

      inviteTokens[inviteToken.id] = inviteToken;
      writeJSON(INVITE_TOKENS_FILE, inviteTokens);

      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      const inviteLink = `${frontendUrl}/accept-invite?token=${token}&agencyId=${agencyId}`;

      console.log(`\n📧 Invite link generated:`);
      console.log(`   ${inviteLink}\n`);
      console.log(`📝 Next steps:`);
      console.log(`   1. Copy the invite link above`);
      console.log(`   2. Visit the link in your browser`);
      console.log(`   3. Set your password`);
      console.log(`   4. Log in at /staff-login.html\n`);
    } else {
      console.log(`\n✅ Owner user is active and ready to log in.`);
      console.log(`   Email: ${ownerEmail}`);
      if (password) {
        console.log(`   Password: ${password}\n`);
      }
    }
  }
}

// Run setup
setup().catch(error => {
  console.error('❌ Setup failed:', error);
  process.exit(1);
});
