/**
 * Setup CLI: create agency + owner (with optional password).
 * Run: node setup-cli.js "2Fly Agency" "owner@2flyflow.com" "Agency Owner" --password "Owner123!"
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

const DB_DIR = join(process.cwd(), 'data');
const AGENCIES_FILE = join(DB_DIR, 'agencies.json');
const USERS_FILE = join(DB_DIR, 'users.json');
const INVITE_TOKENS_FILE = join(DB_DIR, 'invite-tokens.json');
const CLIENTS_FILE = join(DB_DIR, 'clients.json');
const AUDIT_LOGS_FILE = join(DB_DIR, 'audit-logs.json');
const PASSWORD_RESET_TOKENS_FILE = join(DB_DIR, 'password-reset-tokens.json');

function generateId(prefix = '') {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 9);
  return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}

function usernameFromEmail(email) {
  return email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'owner';
}

function readJSON(file, defaultValue) {
  if (!existsSync(file)) {
    writeFileSync(file, JSON.stringify(defaultValue, null, 2), 'utf-8');
    return defaultValue;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error(`Error reading ${file}:`, e.message);
    return defaultValue;
  }
}

function writeJSON(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

async function main() {
  console.log('\n🚀 Setting up 2Fly Agency and Initial Owner...\n');

  const args = process.argv.slice(2);
  const agencyName = args[0] || '2Fly Agency';
  const ownerEmail = (args[1] || 'owner@2flyflow.com').toLowerCase();
  const ownerName = args[2] || 'Agency Owner';
  const passwordIdx = args.indexOf('--password');
  const withPassword = passwordIdx !== -1;
  const password = withPassword ? (args[passwordIdx + 1] || 'admin123') : null;

  if (!existsSync(DB_DIR)) mkdirSync(DB_DIR, { recursive: true });

  const agencies = readJSON(AGENCIES_FILE, {});
  let agencyId;
  let agency;

  const existingAgency = Object.values(agencies).find((a) => a.name === agencyName);
  if (existingAgency) {
    console.log(`✅ Agency "${agencyName}" already exists (ID: ${existingAgency.id})`);
    agencyId = existingAgency.id;
    agency = existingAgency;
  } else {
    agencyId = generateId('agency');
    agency = { id: agencyId, name: agencyName, createdAt: Date.now() };
    agencies[agencyId] = agency;
    writeJSON(AGENCIES_FILE, agencies);
    console.log(`✅ Created agency: "${agencyName}" (ID: ${agencyId})`);
  }

  const users = readJSON(USERS_FILE, {});
  const existing = Object.values(users).find(
    (u) => u.agencyId === agencyId && (u.email || '').toLowerCase() === ownerEmail
  );

  if (existing) {
    console.log(`✅ Owner user already exists: ${ownerEmail}`);
    if (existing.status === 'ACTIVE' && existing.passwordHash) {
      console.log('   Owner is active and can log in.\n');
      return;
    }
  } else {
    const userId = generateId('user');
    let passwordHash = null;
    const status = withPassword && password ? 'ACTIVE' : 'INVITED';
    const username = usernameFromEmail(ownerEmail);

    if (withPassword && password) {
      passwordHash = await bcrypt.hash(password, 12);
      console.log(`\n⚠️  Creating owner with password (testing only)`);
      console.log(`   Password: ${password}\n`);
    }

    const ownerUser = {
      id: userId,
      agencyId,
      email: ownerEmail,
      name: ownerName,
      username,
      role: 'OWNER',
      status,
      passwordHash,
      clientId: null,
      lastLoginAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    users[userId] = ownerUser;
    writeJSON(USERS_FILE, users);
    console.log(`✅ Created owner user: ${ownerEmail} (ID: ${userId})`);

    if (status === 'ACTIVE') {
      console.log(`\n✅ Owner ready to log in.`);
      console.log(`   Email: ${ownerEmail}  Username: ${username}`);
      console.log(`   Password: ${password}\n`);
    } else {
      const token = crypto.randomBytes(32).toString('base64url');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      const inviteTokens = readJSON(INVITE_TOKENS_FILE, {});
      const inviteId = generateId('invite');
      inviteTokens[inviteId] = {
        id: inviteId,
        agencyId,
        userId,
        tokenHash,
        expiresAt: Date.now() + 72 * 60 * 60 * 1000,
        usedAt: null,
        createdAt: Date.now(),
      };
      writeJSON(INVITE_TOKENS_FILE, inviteTokens);
      const frontend = process.env.FRONTEND_URL || 'http://localhost:8000';
      console.log(`\n📧 Invite link: ${frontend}/accept-invite.html?token=${token}&agencyId=${agencyId}\n`);
    }
  }

  readJSON(CLIENTS_FILE, {});
  readJSON(AUDIT_LOGS_FILE, {});
  readJSON(PASSWORD_RESET_TOKENS_FILE, {});
}

main().catch((e) => {
  console.error('❌ Setup failed:', e.message);
  process.exit(1);
});
