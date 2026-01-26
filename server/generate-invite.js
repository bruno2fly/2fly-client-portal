/**
 * Quick script to generate an invite link for the existing owner user
 * Run with: node generate-invite.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { createHash, randomBytes } from 'crypto';
import { join } from 'path';

const DB_DIR = join(process.cwd(), 'data');
const USERS_FILE = join(DB_DIR, 'users.json');
const INVITE_TOKENS_FILE = join(DB_DIR, 'invite-tokens.json');

// Read existing data
const users = JSON.parse(readFileSync(USERS_FILE, 'utf-8'));
const inviteTokens = JSON.parse(readFileSync(INVITE_TOKENS_FILE, 'utf-8'));

// Find the owner user
const ownerUser = Object.values(users).find(u => u.role === 'OWNER' && u.status === 'INVITED');
if (!ownerUser) {
  console.log('❌ No INVITED owner user found. Run npm run setup first.');
  process.exit(1);
}

// Generate token
const token = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('hex');

// Invalidate old tokens for this user
Object.values(inviteTokens).forEach(t => {
  if (t.userId === ownerUser.id && !t.usedAt) {
    t.usedAt = Date.now();
  }
});

// Create new invite token
const inviteToken = {
  id: `invite_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
  agencyId: ownerUser.agencyId,
  userId: ownerUser.id,
  tokenHash: tokenHash,
  expiresAt: Date.now() + (72 * 60 * 60 * 1000), // 72 hours
  usedAt: null,
  createdAt: Date.now()
};

inviteTokens[inviteToken.id] = inviteToken;
writeFileSync(INVITE_TOKENS_FILE, JSON.stringify(inviteTokens, null, 2));

// Generate invite link
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
const inviteLink = `${frontendUrl}/accept-invite?token=${token}&agencyId=${ownerUser.agencyId}`;

console.log('\n✅ Invite link generated!\n');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Agency: ${ownerUser.agencyId}`);
console.log(`User: ${ownerUser.email} (${ownerUser.name})`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`\n📧 Invite Link:`);
console.log(`   ${inviteLink}\n`);
console.log('📝 Next steps:');
console.log('   1. Copy the invite link above');
console.log('   2. Open it in your browser');
console.log('   3. Set your password (min 8 characters)');
console.log('   4. Log in at /staff-login.html\n');
