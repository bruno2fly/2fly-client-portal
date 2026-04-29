/**
 * ONE-TIME: Migrate stpetersburg portal-state using chunked inserts.
 *
 * Large fields (approvals 33MB, requests 42MB) kill DB connections.
 * Solution: split JSON into 5MB text chunks, store in a temp table,
 * reassemble inside Postgres, then update PortalState.
 */
import pg from 'pg';
import https from 'https';

const RAILWAY_EXPORT_URL = 'https://api.2flyflow.com';
const AGENCY_ID = 'agency_1737676800000_abc123';
const CLIENT_ID = 'stpetersburg';
const KEY = `${AGENCY_ID}:${CLIENT_ID}`;
const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks (safe margin under connection limit)

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

async function insertFieldChunked(fieldName, fieldData) {
  const sizeMB = (Buffer.byteLength(fieldData) / 1024 / 1024).toFixed(1);

  if (Buffer.byteLength(fieldData) < CHUNK_SIZE) {
    // Small enough for a direct insert
    console.log(`[stpetersburg] "${fieldName}" (${sizeMB} MB) — direct insert`);
    const client = new pg.Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 60000 });
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

  // Large field — split into chunks and reassemble in Postgres
  const numChunks = Math.ceil(fieldData.length / CHUNK_SIZE);
  console.log(`[stpetersburg] "${fieldName}" (${sizeMB} MB) — ${numChunks} chunks`);

  // Create temp table
  const setupClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await setupClient.connect();
  await setupClient.query(`
    CREATE TABLE IF NOT EXISTS _migration_chunks (
      field_name TEXT,
      chunk_index INT,
      chunk_data TEXT,
      PRIMARY KEY (field_name, chunk_index)
    )
  `);
  await setupClient.query(`DELETE FROM _migration_chunks WHERE field_name = $1`, [fieldName]);
  await setupClient.end();

  // Insert chunks
  for (let i = 0; i < numChunks; i++) {
    const start = i * CHUNK_SIZE;
    const chunk = fieldData.slice(start, start + CHUNK_SIZE);
    const chunkMB = (Buffer.byteLength(chunk) / 1024 / 1024).toFixed(1);

    const chunkClient = new pg.Client({ connectionString: process.env.DATABASE_URL, statement_timeout: 60000 });
    await chunkClient.connect();
    try {
      await chunkClient.query(
        `INSERT INTO _migration_chunks (field_name, chunk_index, chunk_data)
         VALUES ($1, $2, $3)
         ON CONFLICT (field_name, chunk_index) DO UPDATE SET chunk_data = $3`,
        [fieldName, i, chunk]
      );
      console.log(`[stpetersburg]   chunk ${i + 1}/${numChunks} (${chunkMB} MB) ✓`);
    } finally {
      await chunkClient.end();
    }

    await new Promise(r => setTimeout(r, 1000));
  }

  // Reassemble in Postgres and update PortalState
  console.log(`[stpetersburg] Reassembling "${fieldName}" in Postgres...`);
  const assembleClient = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    statement_timeout: 0, // No timeout for reassembly
    query_timeout: 600000,
  });
  await assembleClient.connect();
  try {
    await assembleClient.query(`
      UPDATE "PortalState"
      SET "data" = jsonb_set(
        "data",
        $1::text[],
        (SELECT string_agg(chunk_data, '' ORDER BY chunk_index)::jsonb
         FROM _migration_chunks
         WHERE field_name = $2)
      ),
      "updatedAt" = NOW()
      WHERE "agencyId" = $3 AND "clientId" = $4
    `, [`{${fieldName}}`, fieldName, AGENCY_ID, CLIENT_ID]);
    console.log(`[stpetersburg] ✓ "${fieldName}" reassembled and inserted`);
  } finally {
    await assembleClient.end();
  }

  // Clean up chunks
  const cleanClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await cleanClient.connect();
  await cleanClient.query(`DELETE FROM _migration_chunks WHERE field_name = $1`, [fieldName]);
  await cleanClient.end();
}

console.log(`[stpetersburg] Starting chunked field-by-field migration...`);

try {
  // Check which fields already exist
  const checkClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await checkClient.connect();
  const existing = await checkClient.query(
    `SELECT jsonb_object_keys("data") as key FROM "PortalState"
     WHERE "agencyId" = $1 AND "clientId" = $2`,
    [AGENCY_ID, CLIENT_ID]
  );
  await checkClient.end();
  const existingFields = new Set(existing.rows.map(r => r.key));
  console.log(`[stpetersburg] Fields already in DB: ${[...existingFields].join(', ') || 'none'}`);

  // Always proceed — we'll skip individual fields that already exist
  {
    // Get field list
    console.log('[stpetersburg] Getting field list from Railway...');
    const fieldsRaw = await fetchFile(`${RAILWAY_EXPORT_URL}/portal-state-fields/${encodeURIComponent(KEY)}`);
    const fields = JSON.parse(fieldsRaw);

    if (fields.error) {
      console.error('[stpetersburg] Railway error:', fields.error);
    } else {
      console.log(`[stpetersburg] ${fields.length} fields to migrate`);

      // Ensure empty row exists
      const initClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await initClient.connect();
      await initClient.query(
        `INSERT INTO "PortalState" ("agencyId", "clientId", "data", "updatedAt")
         VALUES ($1, $2, '{}'::jsonb, NOW())
         ON CONFLICT ("agencyId", "clientId") DO NOTHING`,
        [AGENCY_ID, CLIENT_ID]
      );
      await initClient.end();

      // Process each field — skip ones already in DB
      let done = 0;
      for (const field of fields) {
        if (existingFields.has(field.name)) {
          console.log(`[stpetersburg] "${field.name}" — already exists, skipping`);
          done++;
          continue;
        }
        try {
          console.log(`[stpetersburg] Fetching "${field.name}"...`);
          const fieldData = await fetchFile(
            `${RAILWAY_EXPORT_URL}/portal-state-field/${encodeURIComponent(KEY)}/${encodeURIComponent(field.name)}`
          );

          await insertFieldChunked(field.name, fieldData);
          done++;
        } catch (e) {
          console.error(`[stpetersburg] ✗ "${field.name}":`, e.message?.slice(0, 300));
        }

        await new Promise(r => setTimeout(r, 2000));
      }

      console.log(`\n[stpetersburg] Complete: ${done}/${fields.length} fields`);

      // Clean up temp table
      try {
        const dropClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
        await dropClient.connect();
        await dropClient.query('DROP TABLE IF EXISTS _migration_chunks');
        await dropClient.end();
      } catch (e) { /* ignore */ }
    }
  }
} catch (e) {
  console.error('[stpetersburg] Error:', e.message?.slice(0, 500));
}

console.log('[stpetersburg] Done.\n');
