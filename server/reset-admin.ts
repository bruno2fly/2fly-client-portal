/**
 * Delete all users and create a single admin (username: admin, password: 2fly2026).
 * Run from server directory: npx tsx reset-admin.ts
 * Use this to get a clean portal login. Run again after deploy if data is not persisted.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { hashPassword, generateId } from './src/utils/auth.js';
import type { Agency, User } from './src/types.js';

const DATA_DIR = join(process.cwd(), 'data');
const AGENCIES_FILE = join(DATA_DIR, 'agencies.json');
const USERS_FILE = join(DATA_DIR, 'users.json');

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '2fly2026';
const ADMIN_EMAIL = 'admin@2flyflow.com';

function readJSON<T>(file: string, defaultValue: T): T {
  if (!existsSync(file)) return defaultValue;
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as T;
  } catch (e) {
    return defaultValue;
  }
}

async function main() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const agencies = readJSON<Record<string, Agency>>(AGENCIES_FILE, {});
  const agencyIds = Object.keys(agencies);
  let agencyId: string;

  if (agencyIds.length > 0) {
    agencyId = agencyIds[0];
    console.log(`Using agency: ${agencies[agencyId].name} (${agencyId})`);
  } else {
    agencyId = generateId('agency');
    const agency: Agency = {
      id: agencyId,
      name: '2Fly Agency',
      createdAt: Date.now()
    };
    writeFileSync(AGENCIES_FILE, JSON.stringify({ [agencyId]: agency }, null, 2), 'utf-8');
    console.log(`Created agency: 2Fly Agency (${agencyId})`);
  }

  const passwordHash = await hashPassword(ADMIN_PASSWORD);
  const now = Date.now();
  const userId = generateId('user');
  const adminUser: User = {
    id: userId,
    agencyId,
    email: ADMIN_EMAIL,
    username: ADMIN_USERNAME,
    name: 'Admin',
    role: 'OWNER',
    status: 'ACTIVE',
    passwordHash,
    clientId: null,
    lastLoginAt: null,
    createdAt: now,
    updatedAt: now
  };

  const users: Record<string, User> = { [userId]: adminUser };
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
  console.log('\n✅ All users removed. Single admin created.\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Username: ${ADMIN_USERNAME}`);
  console.log(`Password: ${ADMIN_PASSWORD}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('📝 Log in at /staff-login.html\n');
}

main().catch((err) => {
  console.error('❌', err.message);
  process.exit(1);
});
