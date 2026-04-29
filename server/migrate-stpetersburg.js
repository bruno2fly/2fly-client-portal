/**
 * ONE-TIME: Migrate stpetersburg portal-state using pg driver directly.
 * Prisma's query engine drops the connection on 75MB+ parameters.
 * The pg driver gives direct control over timeouts.
 */
import https from 'https';
import pg from 'pg';

const RAILWAY_EXPORT_URL = 'https://api.2flyflow.com';
const AGENCY_ID = 'agency_1737676800000_abc123';
const CLIENT_ID = 'stpetersburg';
const KEY = `${AGENCY_ID}:${CLIENT_ID}`;

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

console.log(`[stpetersburg] Starting migration for ${KEY}...`);

try {
  // Check if already exists using pg directly
  const checkClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    statement_timeout: 30000,
  });
  await checkClient.connect();

  const existing = await checkClient.query(
    'SELECT "agencyId" FROM "PortalState" WHERE "agencyId" = $1 AND "clientId" = $2',
    [AGENCY_ID, CLIENT_ID]
  );
  await checkClient.end();

  if (existing.rows.length > 0) {
    console.log('[stpetersburg] Already exists — skipping');
  } else {
    // Download from Railway
    console.log('[stpetersburg] Downloading from Railway...');
    const data = await fetchFile(`${RAILWAY_EXPORT_URL}/portal-state-entry/${encodeURIComponent(KEY)}`);
    const sizeMB = (Buffer.byteLength(data) / 1024 / 1024).toFixed(1);
    console.log(`[stpetersburg] Downloaded: ${sizeMB} MB`);

    // Insert using pg directly with NO statement timeout
    const insertClient = new pg.Client({
      connectionString: process.env.DATABASE_URL,
      statement_timeout: 0,        // No statement timeout
      query_timeout: 600000,        // 10 minute query timeout
      connectionTimeoutMillis: 30000,
    });
    await insertClient.connect();

    console.log('[stpetersburg] Inserting via raw pg (no timeout)...');
    await insertClient.query(
      `INSERT INTO "PortalState" ("agencyId", "clientId", "data", "updatedAt")
       VALUES ($1, $2, $3::jsonb, NOW())
       ON CONFLICT ("agencyId", "clientId")
       DO UPDATE SET "data" = $3::jsonb, "updatedAt" = NOW()`,
      [AGENCY_ID, CLIENT_ID, data]
    );

    await insertClient.end();
    console.log('[stpetersburg] ✓ Migration successful!');
  }
} catch (e) {
  console.error('[stpetersburg] ✗ Failed:', e.message?.slice(0, 500));
  // Don't exit(1) — let the server start anyway
}

console.log('[stpetersburg] Done.\n');
