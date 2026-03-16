/**
 * Seed script: Import E.B. Express Provisions vendor & products
 * Run with: npx tsx src/seed-products.ts
 */

import { getAgencies, saveVendor, saveProductsBulk, getVendorsByAgency, getProductsByVendor } from './db.js';
import type { Vendor, Product } from './types.js';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// Raw product data parsed from E.B. EXPRESS PROVISIONS inventory price list (03/10/26)
const VENDOR_INFO = {
  name: 'E.B. EXPRESS PROVISIONS INC.',
  address: '181-191 Vanderpool Street, Newark, NJ 07114',
  phone: '(973) 624-5703',
  fax: '(973) 622-3111'
};

// Inline product data - will be loaded from JSON
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const PRODUCTS_SEED_FILE = join(process.cwd(), 'data', 'seed-eb-express.json');

async function main() {
  // Find agency
  const agencies = getAgencies();
  const agencyIds = Object.keys(agencies);
  if (agencyIds.length === 0) {
    console.error('No agencies found. Create an agency first.');
    process.exit(1);
  }
  const agencyId = agencyIds[0];
  console.log(`Using agency: ${agencyId} (${agencies[agencyId].name})`);

  // Check if vendor already exists
  const existingVendors = getVendorsByAgency(agencyId);
  const existing = existingVendors.find(v => v.name === VENDOR_INFO.name);

  let vendorId: string;
  if (existing) {
    console.log(`Vendor already exists: ${existing.id}`);
    vendorId = existing.id;
    const existingProducts = getProductsByVendor(agencyId, vendorId);
    if (existingProducts.length > 0) {
      console.log(`Already has ${existingProducts.length} products. Skipping import.`);
      console.log('To re-import, delete existing products first.');
      return;
    }
  } else {
    vendorId = generateId();
    const vendor: Vendor = {
      id: vendorId,
      agencyId,
      name: VENDOR_INFO.name,
      address: VENDOR_INFO.address,
      phone: VENDOR_INFO.phone,
      fax: VENDOR_INFO.fax,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    saveVendor(vendor);
    console.log(`Created vendor: ${vendor.name} (${vendorId})`);
  }

  // Load products from seed file
  if (!existsSync(PRODUCTS_SEED_FILE)) {
    console.error(`Seed file not found: ${PRODUCTS_SEED_FILE}`);
    console.error('Run the parser first to generate the seed file.');
    process.exit(1);
  }

  const rawProducts: Array<{
    description: string;
    category: string;
    packSize: string;
    unitOfMeasure: string;
    sku: string;
    brand: string;
  }> = JSON.parse(readFileSync(PRODUCTS_SEED_FILE, 'utf-8'));

  console.log(`Loaded ${rawProducts.length} products from seed file`);

  const now = Date.now();
  const products: Product[] = rawProducts.map((p, i) => ({
    id: generateId() + i.toString(36),
    agencyId,
    vendorId,
    description: p.description,
    category: p.category,
    packSize: p.packSize,
    unitOfMeasure: p.unitOfMeasure,
    sku: p.sku,
    brand: p.brand,
    status: 'active' as const,
    createdAt: now,
    updatedAt: now
  }));

  saveProductsBulk(products);
  console.log(`Imported ${products.length} products for ${VENDOR_INFO.name}`);

  // Category summary
  const cats: Record<string, number> = {};
  products.forEach(p => { cats[p.category] = (cats[p.category] || 0) + 1; });
  console.log(`\nCategories: ${Object.keys(cats).length}`);
  const sorted = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  sorted.slice(0, 10).forEach(([cat, n]) => console.log(`  ${cat}: ${n}`));
  if (sorted.length > 10) console.log(`  ... and ${sorted.length - 10} more`);
}

main().catch(console.error);
