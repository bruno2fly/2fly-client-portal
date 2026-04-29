/**
 * ONE-TIME: Migrate stpetersburg portal-state.
 *
 * Uses chunk TABLE approach for large fields: each 2MB chunk is a separate ROW
 * (no row ever exceeds 2MB). Final reassembly uses string_agg + jsonb cast
 * which worked for the 33MB approvals field.
 *
 * Includes retry logic for small fields that fail after a DB restart.
 */
import pg from 'pg';
import https from 'https';

const RAILWAY_EXPORT_URL = 'https://api.2flyflow.com';
const AGENCY_ID = 'agency_1737676800000_abc123';
const CLIENT_ID = 'stpetersburg';
const KEY = `${AGENCY_ID}:${CLIENT_ID}`;
const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB

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

async function getClient(timeout = 60000) {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    statement_timeout: timeout,
    keepAlive: true,
    keepAliveInitialDelayMillis: 5000,
  });
  client.on('error', () => {});
  await client.connect();
  return client;
}

async function insertFieldDirect(fieldName, fieldData) {
  const client = await getClient();
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
}

async function insertFieldChunked(fieldName, fieldData) {
  const numChunks = Math.ceil(fieldData.length / CHUNK_SIZE);
  const sizeMB = (Buffer.byteLength(fieldData) / 1024 / 1024).toFixed(1);
  console.log(`[stpetersburg] "${fieldName}" (${sizeMB} MB) — ${numChunks} chunks (table approach)`);

  // Setup chunk table
  const setup = await getClient();
  await setup.query(`
    CREATE TABLE IF NOT EXISTS _mig_chunks (
      field_name TEXT,
      idx INT,
      data TEXT,
      PRIMARY KEY (field_name, idx)
    )
  `);
  await setup.query(`DELETE FROM _mig_chunks WHERE field_name = $1`, [fieldName]);
  await setup.end();

  // Insert each chunk as a SEPARATE ROW (no row ever exceeds 2MB)
  for (let i = 0; i < numChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = fieldData.slice(start, start + CHUNK_SIZE);
    const chunkMB = (Buffer.byteLength(chunk) / 1024 / 1024).toFixed(1);

    const c = await getClient();
    try {
      await c.query(
        `INSERT INTO _mig_chunks (field_name, idx, data) VALUES ($1, $2, $3)
         ON CONFLICT (field_name, idx) DO UPDATE SET data = $3`,
        [fieldName, i, chunk]
      );
      console.log(`[stpetersburg]   chunk ${i + 1}/${numChunks} (${chunkMB} MB) ✓`);
    } finally {
      await c.end();
    }
    await new Promise(r => setTimeout(r, 500));
  }

  // Reassemble with string_agg + jsonb cast (worked for 33MB approvals)
  console.log(`[stpetersburg] Reassembling "${fieldName}" in Postgres...`);
  const cast = await getClient(0); // No timeout
  try {
    await cast.query(`SET work_mem = '256MB'`);
    await cast.query(`SET maintenance_work_mem = '256MB'`);
    await cast.query(`
      UPDATE "PortalState"
      SET "data" = jsonb_set(
        "data",
        $1::text[],
        (SELECT string_agg(data, '' ORDER BY idx)::jsonb FROM _mig_chunks WHERE field_name = $2)
      ),
      "updatedAt" = NOW()
      WHERE "agencyId" = $3 AND "clientId" = $4
    `, [`{${fieldName}}`, fieldName, AGENCY_ID, CLIENT_ID]);
    console.log(`[stpetersburg] ✓ "${fieldName}" done!`);
  } finally {
    await cast.end();
  }

  // Cleanup
  const clean = await getClient();
  await clean.query(`DELETE FROM _mig_chunks WHERE field_name = $1`, [fieldName]);
  await clean.end();
}

console.log(`[stpetersburg] Starting migration (chunk table approach)...`);

try {
  // Check existing fields
  const check = await getClient();
  const existing = await check.query(
    `SELECT jsonb_object_keys("data") as key FROM "PortalState"
     WHERE "agencyId" = $1 AND "clientId" = $2`,
    [AGENCY_ID, CLIENT_ID]
  );
  await check.end();
  const existingFields = new Set(existing.rows.map(r => r.key));
  console.log(`[stpetersburg] Fields in DB: ${[...existingFields].join(', ') || 'none'}`);

  // Get field list
  const fieldsRaw = await fetchFile(`${RAILWAY_EXPORT_URL}/portal-state-fields/${encodeURIComponent(KEY)}`);
  const fields = JSON.parse(fieldsRaw);

  if (fields.error) {
    console.error('[stpetersburg] Railway error:', fields.error);
  } else {
    // Ensure row exists
    const init = await getClient();
    await init.query(
      `INSERT INTO "PortalState" ("agencyId", "clientId", "data", "updatedAt")
       VALUES ($1, $2, '{}'::jsonb, NOW())
       ON CONFLICT ("agencyId", "clientId") DO NOTHING`,
      [AGENCY_ID, CLIENT_ID]
    );
    await init.end();

    // Sort: small fields first, big ones last
    const sorted = [...fields].sort((a, b) => a.size - b.size);

    let done = 0;
    for (const field of sorted) {
      if (existingFields.has(field.name)) {
        console.log(`[stpetersburg] "${field.name}" — exists, skipping`);
        done++;
        continue;
      }

      // Retry logic for fields that fail due to DB restart
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[stpetersburg] Fetching "${field.name}"...`);
          const fieldData = await fetchFile(
            `${RAILWAY_EXPORT_URL}/portal-state-field/${encodeURIComponent(KEY)}/${encodeURIComponent(field.name)}`
          );
          const sizeMB = (Buffer.byteLength(fieldData) / 1024 / 1024).toFixed(1);

          if (Buffer.byteLength(fieldData) < CHUNK_SIZE) {
            console.log(`[stpetersburg] "${field.name}" (${sizeMB} MB) — direct insert`);
            await insertFieldDirect(field.name, fieldData);
          } else {
            await insertFieldChunked(field.name, fieldData);
          }

          done++;
          console.log(`[stpetersburg] ✓ "${field.name}"`);
          break; // Success, no retry needed
        } catch (e) {
          console.error(`[stpetersburg] ✗ "${field.name}" attempt ${attempt}:`, e.message?.slice(0, 200));
          if (attempt < 3) {
            console.log(`[stpetersburg] Waiting 15s for DB to recover...`);
            await new Promise(r => setTimeout(r, 15000));
          }
        }
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`\n[stpetersburg] Complete: ${done}/${fields.length} fields`);

    // Final cleanup
    try {
      const drop = await getClient();
      await drop.query('DROP TABLE IF EXISTS _mig_chunks');
      await drop.query('DROP TABLE IF EXISTS _migration_text');
      await drop.query('DROP TABLE IF EXISTS _migration_chunks');
      await drop.end();
    } catch (e) { /* ignore */ }
  }
} catch (e) {
  console.error('[stpetersburg] Error:', e.message?.slice(0, 500));
}

console.log('[stpetersburg] Done.\n');
