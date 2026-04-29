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

// All JSON files to download
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
  'portal-state.json',
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

  console.log('[fetch] All files downloaded.');
}

async function runMigration() {
  // Set the data directory to our temp folder
  process.env.RAILWAY_VOLUME_MOUNT_PATH = TMP_DIR;

  // Import and run the existing migration
  const { migrateAll } = await import('./dist/scripts/migrate-json-to-postgres.js');
  const stats = await migrateAll();

  console.log('\n[fetch-and-migrate] Migration complete!');
  return stats;
}

// Main
console.log('══════════════════════════════════════════════');
console.log('  FETCH & MIGRATE: Railway JSON → Render PG  ');
console.log('══════════════════════════════════════════════');

try {
  await downloadAll();
  await runMigration();
  console.log('\n✅ Migration successful! All data transferred.');
} catch (e) {
  console.error('\n❌ Migration failed:', e);
  process.exit(1);
}
