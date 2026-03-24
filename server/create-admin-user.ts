/**
 * Create or update admin user (username: admin, password: 2fly2026).
 * Run manually: npm run seed (from server directory) or: npx tsx create-admin-user.ts
 * Does NOT run on deploy — use npm run start:with-seed only if you need seed + server in one command.
 * Never overwrites agencies.json / users.json when existing files are corrupt (exits with error instead).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { hashPassword, generateId } from './src/utils/auth.js';
import type { Agency, User } from './src/types.js';

const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || join(process.cwd(), 'data');
const AGENCIES_FILE = join(DATA_DIR, 'agencies.json');
const USERS_FILE = join(DATA_DIR, 'users.json');

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '2fly2026';
const ADMIN_EMAIL = 'admin@2flyflow.com';
const ADMIN_NAME = 'Admin';
/** Must match DEFAULT_AGENCY_ID in public/staff-login.html so login finds the admin */
const DEFAULT_AGENCY_ID = 'agency_1737676800000_abc123';

/**
 * Seed-only reader: missing or whitespace-only file → default (first-time init).
 * File with non-empty content that is not valid JSON → exit (never clobber with defaults).
 */
function readJSONForSeed<T>(file: string, defaultValue: T): T {
  if (!existsSync(file)) return defaultValue;
  const content = readFileSync(file, 'utf-8');
  const trimmed = content.trim();
  if (!trimmed) return defaultValue;
  try {
    return JSON.parse(content) as T;
  } catch (e) {
    console.error(`[seed] ERROR: ${file} exists but is not valid JSON. Refusing to overwrite.`, e);
    console.error('[seed] Restore from backup or fix the file, then run seed again.');
    process.exit(1);
  }
}

function writeJSON<T>(file: string, data: T): void {
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

async function main() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  console.log(`[seed] Data directory: ${DATA_DIR} (volume: ${process.env.RAILWAY_VOLUME_MOUNT_PATH ? 'yes' : 'no'})`);

  const agencies = readJSONForSeed<Record<string, Agency>>(AGENCIES_FILE, {});
  const agencyIds = Object.keys(agencies);
  let agencyId: string;

  if (agencies[DEFAULT_AGENCY_ID]) {
    agencyId = DEFAULT_AGENCY_ID;
    console.log(`Using default agency: ${agencies[agencyId].name} (${agencyId})`);
  } else if (agencyIds.length > 0) {
    agencyId = agencyIds[0];
    console.log(`Using existing agency: ${agencies[agencyId].name} (${agencyId})`);
  } else {
    agencyId = DEFAULT_AGENCY_ID;
    agencies[agencyId] = {
      id: agencyId,
      name: '2Fly Agency',
      createdAt: Date.now()
    };
    writeJSON(AGENCIES_FILE, agencies);
    console.log(`Created agency: 2Fly Agency (${agencyId})`);
  }

  const users = readJSONForSeed<Record<string, User>>(USERS_FILE, {});
  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const now = Date.now();

  const existingByUsername = Object.values(users).find(
    u => u.agencyId === agencyId && (u.username === ADMIN_USERNAME || u.email === ADMIN_EMAIL)
  );

  if (existingByUsername) {
    existingByUsername.username = ADMIN_USERNAME;
    existingByUsername.email = ADMIN_EMAIL;
    existingByUsername.name = ADMIN_NAME;
    existingByUsername.passwordHash = passwordHash;
    existingByUsername.status = 'ACTIVE';
    existingByUsername.updatedAt = now;
    users[existingByUsername.id] = existingByUsername;
    writeJSON(USERS_FILE, users);
    console.log('\n✅ Admin user updated.\n');
  } else {
    const userId = generateId('user');
    const newUser: User = {
      id: userId,
      agencyId,
      email: ADMIN_EMAIL,
      username: ADMIN_USERNAME,
      name: ADMIN_NAME,
      role: 'OWNER',
      status: 'ACTIVE',
      passwordHash,
      clientId: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now
    };
    users[userId] = newUser;
    writeJSON(USERS_FILE, users);
    console.log('\n✅ Admin user created.\n');
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Username: ${ADMIN_USERNAME}`);
  console.log(`Password: ${ADMIN_PASSWORD}`);
  console.log(`Email:    ${ADMIN_EMAIL}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📝 Log in at /staff-login.html with the username or email above.\n');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
