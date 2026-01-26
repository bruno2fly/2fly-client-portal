/**
 * Set a known password for the owner user (for local dev)
 * Run with: node set-owner-password.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import bcrypt from 'bcrypt';

const USERS_FILE = join(process.cwd(), 'data', 'users.json');
const PASSWORD = 'Owner123!';

const users = JSON.parse(readFileSync(USERS_FILE, 'utf-8'));
const owner = Object.values(users).find((u) => u.role === 'OWNER');
if (!owner) {
  console.error('❌ Owner user not found.');
  process.exit(1);
}

const passwordHash = await bcrypt.hash(PASSWORD, 12);
owner.passwordHash = passwordHash;
owner.status = 'ACTIVE';
owner.username = owner.username || 'owner';
owner.updatedAt = Date.now();
users[owner.id] = owner;
writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

console.log('\n✅ Owner password set!\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Username: owner');
console.log('Password: Owner123!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
console.log('Log in at http://localhost:8000/staff-login.html\n');
