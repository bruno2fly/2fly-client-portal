/**
 * ONE-TIME: Migrate stpetersburg portal-state using a text assembly column.
 *
 * The 33MB+ fields can't be cast to jsonb in one step. Instead:
 * 1. Store each field as raw TEXT in a helper column (no jsonb parsing)
 * 2. Append text chunks to the helper column
 * 3. At the end, rebuild data from all text fields using a single controlled cast
 *
 * Actually simplest approach: use a _migration_text table that stores the complete
 * assembled text, then do the jsonb cast in a single optimized UPDATE with
 * SET work_mem = '256MB' for the session.
 */
import pg from 'pg';
import https from 'https';

const RAILWAY_EXPORT_URL = 'https://api.2flyflow.com';
const AGENCY_ID = 'agency_1737676800000_abc123';
const CLIENT_ID = 'stpetersburg';
const KEY = `${AGENCY_ID}:${CLIENT_ID}`;
const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB

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

async function insertFieldViaTextColumn(fieldName, fieldData) {
  const sizeMB = (Buffer.byteLength(fieldData) / 1024 / 1024).toFixed(1);

  if (Buffer.byteLength(fieldData) < CHUNK_SIZE) {
    // Small enough for direct insert
    console.log(`[stpetersburg] "${fieldName}" (${sizeMB} MB) — direct insert`);
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 60000 });
    client.on('error', () => {});
    await client.connect();
    try {
      await client.query(
        `UPDATE "PortalState"
         SET "data" = jsonb_set("data", $1::text[], $2::jsonb), "updatedAt" = NOW()
         WHERE "agencyId" = $3 AND "clientId" = $4`,
        [`{${fieldName}}`, fieldData, AGENCY_ID, CLIENT_ID]
      );
    } finally {
      await client.end();
    }
    return;
  }

  // Large field — use text column approach
  const numChunks = Math.ceil(fieldData.length / CHUNK_SIZE);
  console.log(`[stpetersburg] "${fieldName}" (${sizeMB} MB) — ${numChunks} chunks via text column`);

  // Setup: create helper table with a TEXT column we can append to
  const setupClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
  setupClient.on('error', () => {});
  await setupClient.connect();
  await setupClient.query(`
    CREATE TABLE IF NOT EXISTS _migration_text (
      field_name TEXT PRIMARY KEY,
      assembled TEXT DEFAULT ''
    )
  `);
  await setupClient.query(
    `INSERT INTO _migration_text (field_name, assembled) VALUES ($1, '')
     ON CONFLICT (field_name) DO UPDATE SET assembled = ''`,
    [fieldName]
  );
  await setupClient.end();

  // Append chunks to the text column one at a time
  for (let i = 0; i < numChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = fieldData.slice(start, start + CHUNK_SIZE);
    const chunkMB = (Buffer.byteLength(chunk) / 1024 / 1024).toFixed(1);

    const chunkClient = new pg.Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 120000 });
    chunkClient.on('error', () => {});
    await chunkClient.connect();
    try {
      await chunkClient.query(
        `UPDATE _migration_text SET assembled = assembled || $1 WHERE field_name = $2`,
        [chunk, fieldName]
      );
      console.log(`[stpetersburg]   chunk ${i + 1}/${numChunks} (${chunkMB} MB) ✓`);
    } finally {
      await chunkClient.end();
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  // Now cast text→jsonb and update PortalState
  // Use higher work_mem and longer timeout
  console.log(`[stpetersburg] Converting "${fieldName}" text→jsonb in Postgres...`);
  const castClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    statement_timeout: 0,
    query_timeout: 0,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5000,
  });
  castClient.on('error', (err) => {
    console.error(`[stpetersburg] Cast client error: ${err.message}`);
  });
  await castClient.connect();
  try {
    // Boost memory for this session
    await castClient.query(`SET work_mem = '256MB'`);
    await castClient.query(`SET maintenance_work_mem = '256MB'`);

    await castClient.query(`
      UPDATE "PortalState"
      SET "data" = jsonb_set(
        "data",
        $1::text[],
        (SELECT assembled::jsonb FROM _migration_text WHERE field_name = $2)
      ),
      "updatedAt" = NOW()
      WHERE "agencyId" = $3 AND "clientId" = $4
    `, [`{${fieldName}}`, fieldName, AGENCY_ID, CLIENT_ID]);

    console.log(`[stpetersburg] ✓ "${fieldName}" done!`);
  } finally {
    await castClient.end();
  }

  // Cleanup
  const cleanClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
  cleanClient.on('error', () => {});
  await cleanClient.connect();
  await cleanClient.query(`DELETE FROM _migration_text WHERE field_name = $1`, [fieldName]);
  await cleanClient.end();
}

console.log(`[stpetersburg] Starting migration with text column approach...`);

try {
  // Check which fields exist
  const checkClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
  checkClient.on('error', () => {});
  await checkClient.connect();
  const existing = await checkClient.query(
    `SELECT jsonb_object_keys("data") as key FROM "PortalState"
     WHERE "agencyId" = $1 AND "clientId" = $2`,
    [AGENCY_ID, CLIENT_ID]
  );
  await checkClient.end();
  const existingFields = new Set(existing.rows.map(r => r.key));
  console.log(`[stpetersburg] Fields in DB: ${[...existingFields].join(', ') || 'none'}`);

  // Get field list from Railway
  console.log('[stpetersburg] Getting field list...');
  const fieldsRaw = await fetchFile(`${RAILWAY_EXPORT_URL}/portal-state-fields/${encodeURIComponent(KEY)}`);
  const fields = JSON.parse(fieldsRaw);

  if (fields.error) {
    console.error('[stpetersburg] Railway error:', fields.error);
  } else {
    // Ensure row exists
    const initClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
    initClient.on('error', () => {});
    await initClient.connect();
    await initClient.query(
      `INSERT INTO "PortalState" ("agencyId", "clientId", "data", "updatedAt")
       VALUES ($1, $2, '{}'::jsonb, NOW())
       ON CONFLICT ("agencyId", "clientId") DO NOTHING`,
      [AGENCY_ID, CLIENT_ID]
    );
    await initClient.end();

    let done = 0;
    for (const field of fields) {
      if (existingFields.has(field.name)) {
        console.log(`[stpetersburg] "${field.name}" — exists, skipping`);
        done++;
        continue;
      }
      try {
        console.log(`[stpetersburg] Fetching "${field.name}"...`);
        const fieldData = await fetchFile(
          `${RAILWAY_EXPORT_URL}/portal-state-field/${encodeURIComponent(KEY)}/${encodeURIComponent(field.name)}`
        );
        await insertFieldViaTextColumn(field.name, fieldData);
        done++;
      } catch (e) {
        console.error(`[stpetersburg] ✗ "${field.name}":`, e.message?.slice(0, 300));
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log(`\n[stpetersburg] Complete: ${done}/${fields.length} fields`);

    // Final cleanup
    try {
      const dropClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
      dropClient.on('error', () => {});
      await dropClient.connect();
      await dropClient.query('DROP TABLE IF EXISTS _migration_text');
      await dropClient.query('DROP TABLE IF EXISTS _migration_chunks');
      await dropClient.end();
    } catch (e) { /* ignore */ }
  }
} catch (e) {
  console.error('[stpetersburg] Error:', e.message?.slice(0, 500));
}

console.log('[stpetersburg] Done.\n');
