/**
 * Script to create owner credentials
 * Run with: npx tsx create-owner-credentials.ts
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { hashPassword, generateUsernameFromEmail, generateRandomPassword } from './src/utils/auth.js';

const USERS_FILE = join(process.cwd(), 'data', 'users.json');

async function createOwnerCredentials() {
  try {
    // Read users
    const users = JSON.parse(readFileSync(USERS_FILE, 'utf-8'));
    const owner = Object.values(users).find((u: any) => u.role === 'OWNER');

    if (!owner) {
      console.log('❌ Owner user not found. Run npm run setup first.');
      process.exit(1);
    }

    // Generate credentials
    const username = generateUsernameFromEmail(owner.email);
    const password = generateRandomPassword(12);
    const passwordHash = await hashPassword(password);

    // Update owner
    owner.passwordHash = passwordHash;
    owner.status = 'ACTIVE';
    owner.username = username;
    owner.updatedAt = Date.now();

    // Save
    users[owner.id] = owner;
    writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));

    console.log('\n✅ Owner credentials created!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Email: ${owner.email}`);
    console.log(`Username: ${username}`);
    console.log(`Password: ${password}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📝 You can now log in at /staff-login.html');
    console.log(`   Use either email (${owner.email}) or username (${username})\n`);
  } catch (error: any) {
    console.error('❌ Error creating owner credentials:', error.message);
    process.exit(1);
  }
}

createOwnerCredentials();
