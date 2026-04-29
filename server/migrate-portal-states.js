/**
 * ONE-TIME: Migrate portal-state entries from Railway → Render Postgres
 * - Fresh PrismaClient per entry (prevents cascading connection failures)
 * - Processes small entries first, big ones last
 * - Uses raw SQL to avoid JSON.parse() OOM
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

async function upsertPortalState(agencyId, clientId, jsonString) {
  // Fresh connection for each entry — if one fails, others still work
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  });

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PortalState" ("agencyId", "clientId", "data", "updatedAt")
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT ("agencyId", "clientId")
       DO UPDATE SET "data" = $3::jsonb, "updatedAt" = NOW()`,
      agencyId,
      clientId,
      jsonString
    );
    return true;
  } finally {
    await prisma.$disconnect();
  }
}

console.log('[portal-state] Starting portal-state migration (raw SQL, fresh connections)...');

try {
  // 1. Get keys
  const keysRaw = await fetchFile(`${RAILWAY_EXPORT_URL}/portal-state-keys`);
  const keys = JSON.parse(keysRaw);
  console.log(`[portal-state] Found ${keys.length} entries`);

  // 2. Check which ones already exist
  const checkPrisma = new PrismaClient();
  const existing = await checkPrisma.portalState.findMany({
    select: { agencyId: true, clientId: true },
  });
  await checkPrisma.$disconnect();

  const existingKeys = new Set(existing.map(e => `${e.agencyId}:${e.clientId}`));
  const toMigrate = keys.filter(k => !existingKeys.has(k));
  console.log(`[portal-state] ${existingKeys.size} already exist, ${toMigrate.length} to migrate`);

  if (toMigrate.length === 0) {
    console.log('[portal-state] All portal states already migrated!');
  } else {
    // 3. Fetch sizes to sort small-first
    const entries = [];
    for (const key of toMigrate) {
      console.log(`[portal-state] Downloading ${key}...`);
      try {
        const data = await fetchFile(`${RAILWAY_EXPORT_URL}/portal-state-entry/${encodeURIComponent(key)}`);
        entries.push({ key, data, size: Buffer.byteLength(data) });
        console.log(`[portal-state]   ${(Buffer.byteLength(data) / 1024 / 1024).toFixed(1)} MB`);
      } catch (e) {
        console.error(`[portal-state] Failed to download ${key}:`, e.message);
      }
    }

    // Sort smallest first
    entries.sort((a, b) => a.size - b.size);
    console.log(`[portal-state] Inserting ${entries.length} entries (smallest first)...`);

    let migrated = 0, errors = 0;
    for (const entry of entries) {
      const [agencyId, clientId] = entry.key.split(':');
      const sizeMB = (entry.size / 1024 / 1024).toFixed(1);

      try {
        console.log(`[portal-state] Inserting ${entry.key} (${sizeMB} MB)...`);
        await upsertPortalState(agencyId, clientId, entry.data);
        migrated++;
        entry.data = null; // Free memory
        console.log(`[portal-state] ✓ ${entry.key} — ${migrated}/${entries.length}`);
      } catch (e) {
        errors++;
        entry.data = null;
        console.error(`[portal-state] ✗ ${entry.key}:`, e.message?.slice(0, 300));
      }

      // Give DB and GC breathing room
      await new Promise(r => setTimeout(r, 3000));
    }

    console.log(`\n[portal-state] Results: ${migrated} migrated, ${errors} errors, ${existingKeys.size} already existed`);
  }
} catch (e) {
  console.error('[portal-state] Fatal error:', e);
  // Don't exit(1) — let the server start anyway
}

console.log('[portal-state] Done. Starting server...\n');
