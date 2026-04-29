/**
 * ONE-TIME: Migrate stpetersburg portal-state field by field.
 * The full entry is 75MB which kills any DB connection in a single INSERT.
 * This script fetches each top-level field separately from Railway and
 * builds the jsonb object incrementally using jsonb_set().
 */
import pg from 'pg';
import https from 'https';

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

console.log(`[stpetersburg] Starting field-by-field migration...`);

try {
  // Check if already exists
  const checkClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await checkClient.connect();
  const existing = await checkClient.query(
    'SELECT "agencyId" FROM "PortalState" WHERE "agencyId" = $1 AND "clientId" = $2',
    [AGENCY_ID, CLIENT_ID]
  );
  await checkClient.end();

  if (existing.rows.length > 0) {
    console.log('[stpetersburg] Already exists — skipping');
  } else {
    // Get field list from Railway
    console.log('[stpetersburg] Getting field list...');
    const fieldsRaw = await fetchFile(`${RAILWAY_EXPORT_URL}/portal-state-fields/${encodeURIComponent(KEY)}`);
    const fields = JSON.parse(fieldsRaw);

    if (fields.error) {
      console.error('[stpetersburg] Railway error:', fields.error);
      console.log('[stpetersburg] Railway may need to redeploy with new endpoints. Skipping.');
    } else {
      console.log(`[stpetersburg] Found ${fields.length} fields:`);
      for (const f of fields) {
        console.log(`  ${f.name}: ${(f.size / 1024 / 1024).toFixed(2)} MB`);
      }

      // Step 1: Create empty row
      const initClient = new pg.Client({ connectionString: process.env.DATABASE_URL });
      await initClient.connect();
      await initClient.query(
        `INSERT INTO "PortalState" ("agencyId", "clientId", "data", "updatedAt")
         VALUES ($1, $2, '{}'::jsonb, NOW())
         ON CONFLICT ("agencyId", "clientId") DO NOTHING`,
        [AGENCY_ID, CLIENT_ID]
      );
      await initClient.end();
      console.log('[stpetersburg] Created empty row');

      // Step 2: Insert each field separately
      let done = 0;
      for (const field of fields) {
        console.log(`[stpetersburg] Fetching field "${field.name}" (${(field.size / 1024 / 1024).toFixed(1)} MB)...`);

        try {
          const fieldData = await fetchFile(
            `${RAILWAY_EXPORT_URL}/portal-state-field/${encodeURIComponent(KEY)}/${encodeURIComponent(field.name)}`
          );

          const sizeMB = (Buffer.byteLength(fieldData) / 1024 / 1024).toFixed(1);
          console.log(`[stpetersburg] Inserting field "${field.name}" (${sizeMB} MB)...`);

          const fieldClient = new pg.Client({
            connectionString: process.env.DATABASE_URL,
            statement_timeout: 0,
            query_timeout: 300000,
          });
          await fieldClient.connect();

          await fieldClient.query(
            `UPDATE "PortalState"
             SET "data" = jsonb_set("data", $1::text[], $2::jsonb),
                 "updatedAt" = NOW()
             WHERE "agencyId" = $3 AND "clientId" = $4`,
            [`{${field.name}}`, fieldData, AGENCY_ID, CLIENT_ID]
          );

          await fieldClient.end();
          done++;
          console.log(`[stpetersburg] ✓ "${field.name}" — ${done}/${fields.length}`);
        } catch (e) {
          console.error(`[stpetersburg] ✗ "${field.name}":`, e.message?.slice(0, 200));
        }

        // Breathing room
        await new Promise(r => setTimeout(r, 2000));
      }

      console.log(`[stpetersburg] Complete: ${done}/${fields.length} fields inserted`);
    }
  }
} catch (e) {
  console.error('[stpetersburg] Error:', e.message?.slice(0, 500));
}

console.log('[stpetersburg] Done.\n');
