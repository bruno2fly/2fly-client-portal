/**
 * One-time migration: agency-scoped dashboard.
 * - Ensure agency "2Fly" exists.
 * - Backfill assets.agencyId from workspaceId.
 * - Create portal-state.json if missing.
 *
 * Run: npx tsx src/scripts/migrate-agency-scope.ts (from server dir)
 */

import { getAgencies, saveAgency, getAssets, saveAssets, getClients, saveClient } from '../db.js';
import type { Agency, Asset } from '../types.js';

const DEFAULT_AGENCY_ID = 'agency_1737676800000_abc123';

async function main() {
  console.log('Migration: agency-scope...');

  const agencies = await getAgencies();
  let agency = agencies[DEFAULT_AGENCY_ID];
  if (!agency) {
    agency = {
      id: DEFAULT_AGENCY_ID,
      name: '2Fly',
      createdAt: Date.now(),
    };
    await saveAgency(agency);
    console.log('Created agency:', agency.id, agency.name);
  } else if (agency.name !== '2Fly') {
    agency.name = '2Fly';
    await saveAgency(agency);
    console.log('Updated agency name to 2Fly');
  } else {
    console.log('Agency 2Fly already present');
  }

  const assets = await getAssets();
  let changed = 0;
  for (const a of assets) {
    if (!a.agencyId && a.workspaceId) {
      a.agencyId = a.workspaceId;
      changed++;
    }
  }
  if (changed > 0) {
    await saveAssets(assets);
    console.log('Backfilled agencyId on', changed, 'assets');
  } else {
    console.log('No assets to backfill');
  }

  // Backfill agencyId on clients that were created before agency-scoping
  const clients = await getClients();
  let clientsChanged = 0;
  for (const c of Object.values(clients)) {
    if (!c.agencyId) {
      c.agencyId = DEFAULT_AGENCY_ID;
      await saveClient(c);
      clientsChanged++;
    }
  }
  if (clientsChanged > 0) {
    console.log('Backfilled agencyId on', clientsChanged, 'clients');
  } else {
    console.log('No clients to backfill');
  }

  console.log('Migration done.');
}

main();
