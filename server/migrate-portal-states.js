/**
 * ONE-TIME: Migrate portal-state entries from Railway → Render Postgres
 * Uses RAW SQL to avoid JSON.parse() in Node.js — inserts the JSON string
 * directly into Postgres which handles JSON natively. This prevents OOM
 * on entries like stpetersburg (75MB).
 *
 * Usage: node migrate-portal-states.js (runs on Render during startup)
 */
import { PrismaClient } from '@prisma/client';
import https from 'https';

const RAILWAY_EXPORT_URL = 'https://api.2flyflow.com';

function fetchFile(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 600000 }, (res) => {
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

console.log('[portal-state] Starting portal-state migration (raw SQL mode)...');

try {
  const keysRaw = await fetchFile(`${RAILWAY_EXPORT_URL}/portal-state-keys`);
  const keys = JSON.parse(keysRaw);
  console.log(`[portal-state] Found ${keys.length} entries`);

  const prisma = new PrismaClient();
  let migrated = 0, skipped = 0, errors = 0;

  for (const key of keys) {
    const [agencyId, clientId] = key.split(':');
    if (!agencyId || !clientId) {
      console.warn(`[portal-state] Invalid key: ${key}`);
      errors++;
      continue;
    }

    // Check if already migrated
    try {
      const existing = await prisma.portalState.findUnique({
        where: { agencyId_clientId: { agencyId, clientId } },
        select: { agencyId: true },
      });
      if (existing) {
        console.log(`[portal-state] ${key} — already exists, skipping`);
        skipped++;
        continue;
      }
    } catch (e) {
      // If check fails, try to migrate anyway
    }

    // Fetch raw JSON string from Railway
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
    console.log(`[portal-state] ${key}: ${sizeMB} MB — inserting via raw SQL...`);

    // Insert using RAW SQL — no JSON.parse() needed!
    // Postgres casts the string to jsonb natively, saving hundreds of MB of RAM
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PortalState" ("agencyId", "clientId", "data", "updatedAt")
         VALUES ($1, $2, $3::jsonb, NOW())
         ON CONFLICT ("agencyId", "clientId")
         DO UPDATE SET "data" = $3::jsonb, "updatedAt" = NOW()`,
        agencyId,
        clientId,
        entryRaw
      );

      migrated++;
      console.log(`[portal-state] ✓ ${key} — ${migrated} done`);
    } catch (e) {
      errors++;
      console.error(`[portal-state] ✗ ${key}:`, e.message?.slice(0, 200));
    }

    // Free memory and give GC time
    entryRaw = null;
    await new Promise(r => setTimeout(r, 2000));
  }

  await prisma.$disconnect();
  console.log(`\n[portal-state] Complete: ${migrated} migrated, ${skipped} skipped, ${errors} errors (${keys.length} total)`);
} catch (e) {
  console.error('[portal-state] Fatal error:', e);
  process.exit(1);
}
