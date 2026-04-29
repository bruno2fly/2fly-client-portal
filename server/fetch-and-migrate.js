/**
 * ONE-TIME SCRIPT: Fetch JSON data from Railway export server → migrate into Render Postgres
 *
 * This runs ON Render where the internal DATABASE_URL works.
 * It pulls data from the Railway export server (still running at api.2flyflow.com),
 * saves to /tmp/migration-data/, then calls the existing migration function.
 *
 * Usage: node fetch-and-migrate.js
 */
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import https from 'https';

const RAILWAY_EXPORT_URL = 'https://api.2flyflow.com';
const TMP_DIR = '/tmp/migration-data';

// All JSON files to download — portal-state.json EXCLUDED (155MB, causes OOM on 512MB free tier)
// Portal state will be migrated separately via streaming
const FILES = [
  'agencies.json',
  'ai-images.json',
  'assets.json',
  'audit-logs.json',
  'brand-kits.json',
  'client-credentials.json',
  'clients.json',
  'integrations.json',
  'invite-tokens.json',
  'meta-integrations.json',
  'password-reset-tokens.json',
  'production-tasks.json',
  'push-subscriptions.json',
  'references.json',
  'scheduled-posts.json',
  'staff.json',
  'users.json',
  'workspaces.json',
];

function fetchFile(url) {
  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }
      https.get(requestUrl, { timeout: 300000 }, (res) => {
        // Handle redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          makeRequest(res.headers.location, redirectCount + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}`));
          return;
        }
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      }).on('error', reject);
    };
    makeRequest(url);
  });
}

async function downloadAll() {
  if (!existsSync(TMP_DIR)) {
    mkdirSync(TMP_DIR, { recursive: true });
  }

  console.log(`[fetch] Downloading ${FILES.length} files from ${RAILWAY_EXPORT_URL}...`);

  for (const file of FILES) {
    const url = `${RAILWAY_EXPORT_URL}/file/${file}`;
    console.log(`[fetch] Downloading ${file}...`);
    try {
      const data = await fetchFile(url);

      // Check if we got an error response
      if (data.startsWith('{"error"')) {
        console.warn(`[fetch] ${file}: got error response, writing empty default`);
        // Determine if file should be array or object
        const arrayFiles = ['assets', 'audit-logs', 'scheduled-posts', 'production-tasks', 'staff', 'integrations', 'invite-tokens', 'password-reset-tokens', 'workspaces'];
        const isArray = arrayFiles.some(af => file.startsWith(af));
        writeFileSync(join(TMP_DIR, file), isArray ? '[]' : '{}');
      } else {
        writeFileSync(join(TMP_DIR, file), data);
        const sizeMB = (Buffer.byteLength(data) / 1024 / 1024).toFixed(2);
        console.log(`[fetch] ${file}: ${sizeMB} MB`);
      }
    } catch (e) {
      console.error(`[fetch] Failed to download ${file}:`, e.message);
      // Write empty default so migration doesn't crash
      writeFileSync(join(TMP_DIR, file), '{}');
    }
  }

  // Write empty portal-state so migration script doesn't crash
  writeFileSync(join(TMP_DIR, 'portal-state.json'), '{}');
  console.log('[fetch] All files downloaded. (portal-state.json skipped — will migrate separately)');
}

async function runMigration() {
  // Set the data directory to our temp folder
  process.env.RAILWAY_VOLUME_MOUNT_PATH = TMP_DIR;

  // Import and run the existing migration
  const { migrateAll } = await import('./dist/scripts/migrate-json-to-postgres.js');
  const stats = await migrateAll();

  console.log('\n[fetch-and-migrate] Core migration complete!');
  return stats;
}

/**
 * Migrate portal-state entries one at a time to avoid OOM.
 * Uses the /portal-state-keys and /portal-state-entry/:key endpoints
 * on Railway export server to fetch one entry at a time (~14MB each).
 */
async function migratePortalStateOneByOne() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();

  console.log('\n[portal-state] Fetching portal-state keys from Railway...');

  let keys;
  try {
    const keysRaw = await fetchFile(`${RAILWAY_EXPORT_URL}/portal-state-keys`);
    keys = JSON.parse(keysRaw);
    console.log(`[portal-state] Found ${keys.length} portal state entries`);
  } catch (e) {
    console.error('[portal-state] Failed to get keys (Railway may need redeploy):', e.message);
    console.log('[portal-state] Skipping portal-state migration — will retry on next deploy');
    await prisma.$disconnect();
    return;
  }

  let migrated = 0, errors = 0;
  for (const key of keys) {
    try {
      const [agencyId, clientId] = key.split(':');
      if (!agencyId || !clientId) {
        console.warn(`[portal-state] Skipping invalid key: ${key}`);
        errors++;
        continue;
      }

      console.log(`[portal-state] Fetching ${key}...`);
      const entryRaw = await fetchFile(`${RAILWAY_EXPORT_URL}/portal-state-entry/${encodeURIComponent(key)}`);
      const state = JSON.parse(entryRaw);

      await prisma.portalState.upsert({
        where: { agencyId_clientId: { agencyId, clientId } },
        update: { data: state },
        create: { agencyId, clientId, data: state },
      });

      migrated++;
      const sizeMB = (Buffer.byteLength(entryRaw) / 1024 / 1024).toFixed(1);
      console.log(`[portal-state] ${migrated}/${keys.length} — ${key} (${sizeMB} MB)`);
    } catch (e) {
      errors++;
      console.error(`[portal-state] Error for ${key}:`, e.message);
    }
  }

  console.log(`[portal-state] Done: ${migrated}/${keys.length} migrated, ${errors} errors`);
  await prisma.$disconnect();
}

// Main
console.log('══════════════════════════════════════════════');
console.log('  FETCH & MIGRATE: Railway JSON → Render PG  ');
console.log('══════════════════════════════════════════════');

try {
  await downloadAll();
  await runMigration();
  await migratePortalStateOneByOne();
  console.log('\n✅ Migration successful! All data transferred.');
} catch (e) {
  console.error('\n❌ Migration failed:', e);
  process.exit(1);
}
