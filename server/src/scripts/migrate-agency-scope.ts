/**
 * One-time migration: agency-scoped dashboard.
 * - Ensure agency "2Fly" exists.
 * - Backfill assets.agencyId from workspaceId.
 * - Create portal-state.json if missing.
 *
 * Run: npx tsx src/scripts/migrate-agency-scope.ts (from server dir)
 */

import { getAgencies, saveAgency, getAssets, saveAssets } from '../db.js';
import type { Agency, Asset } from '../types.js';

const DEFAULT_AGENCY_ID = 'agency_1737676800000_abc123';

function main() {
  console.log('Migration: agency-scope...');

  const agencies = getAgencies();
  let agency = agencies[DEFAULT_AGENCY_ID];
  if (!agency) {
    agency = {
      id: DEFAULT_AGENCY_ID,
      name: '2Fly',
      createdAt: Date.now(),
    };
    saveAgency(agency);
    console.log('Created agency:', agency.id, agency.name);
  } else if (agency.name !== '2Fly') {
    agency.name = '2Fly';
    saveAgency(agency);
    console.log('Updated agency name to 2Fly');
  } else {
    console.log('Agency 2Fly already present');
  }

  const assets = getAssets();
  let changed = 0;
  for (const a of assets) {
    if (!a.agencyId && a.workspaceId) {
      a.agencyId = a.workspaceId;
      changed++;
    }
  }
  if (changed > 0) {
    saveAssets(assets);
    console.log('Backfilled agencyId on', changed, 'assets');
  } else {
    console.log('No assets to backfill');
  }

  console.log('Migration done.');
}

main();
