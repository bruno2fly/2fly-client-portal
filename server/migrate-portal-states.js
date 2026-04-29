/**
 * ONE-TIME: Migrate portal-state entries from Railway → Render Postgres
 * Creates a fresh DB connection for each entry to avoid connection drops.
 *
 * Usage: node migrate-portal-states.js (runs on Render during startup)
 */
import { PrismaClient } from '@prisma/client';
import https from 'https';

const RAILWAY_EXPORT_URL = 'https://api.2flyflow.com';

function fetchFile(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 300000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchFile(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      res.on('error', reject);
    }).on('error', reject);
  });
}

console.log('[portal-state] Starting portal-state migration...');

try {
  // 1. Get all keys
  const keysRaw = await fetchFile(`${RAILWAY_EXPORT_URL}/portal-state-keys`);
  const keys = JSON.parse(keysRaw);
  console.log(`[portal-state] Found ${keys.length} entries`);

  let migrated = 0, skipped = 0, errors = 0;

  for (const key of keys) {
    const [agencyId, clientId] = key.split(':');
    if (!agencyId || !clientId) {
      console.warn(`[portal-state] Invalid key: ${key}`);
      errors++;
      continue;
    }

    // Check if already migrated
    const checkPrisma = new PrismaClient();
    try {
      const existing = await checkPrisma.portalState.findUnique({
        where: { agencyId_clientId: { agencyId, clientId } },
        select: { agencyId: true },
      });
      if (existing) {
        console.log(`[portal-state] ${key} — already exists, skipping`);
        skipped++;
        await checkPrisma.$disconnect();
        continue;
      }
    } catch (e) {
      // If check fails, try to migrate anyway
    }
    await checkPrisma.$disconnect();

    // Fetch entry from Railway
    console.log(`[portal-state] Fetching ${key}...`);
    let entryRaw;
    try {
      entryRaw = await fetchFile(`${RAILWAY_EXPORT_URL}/portal-state-entry/${encodeURIComponent(key)}`);
    } catch (e) {
      console.error(`[portal-state] Failed to fetch ${key}:`, e.message);
      errors++;
      continue;
    }

    const sizeMB = (Buffer.byteLength(entryRaw) / 1024 / 1024).toFixed(1);
    console.log(`[portal-state] ${key}: ${sizeMB} MB — inserting...`);

    // Parse and insert with a FRESH connection
    const prisma = new PrismaClient();
    try {
      const state = JSON.parse(entryRaw);
      entryRaw = null; // Free memory

      await prisma.portalState.upsert({
        where: { agencyId_clientId: { agencyId, clientId } },
        update: { data: state },
        create: { agencyId, clientId, data: state },
      });

      migrated++;
      console.log(`[portal-state] ✓ ${key} — ${migrated} done`);
    } catch (e) {
      errors++;
      console.error(`[portal-state] ✗ ${key}:`, e.message);
    } finally {
      await prisma.$disconnect();
    }

    // Small delay to let GC run
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n[portal-state] Complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors (${keys.length} total)`);
} catch (e) {
  console.error('[portal-state] Fatal error:', e);
  process.exit(1);
}
