/**
 * Products & Vendors API routes
 */
import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { getAgencyScope } from '../middleware/auth.js';
import {
  getVendorsByAgency,
  getVendor,
  saveVendor,
  deleteVendor,
  getProductsByAgency,
  getProductsByVendor,
  getProductById,
  saveProduct,
  saveProductsBulk,
  deleteProduct,
  deleteProductsByVendor
} from '../db.js';
import type { Vendor, Product } from '../types.js';

const router = Router();
router.use(authenticate);

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

// ==================== VENDORS ====================

router.get('/vendors', (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const vendors = getVendorsByAgency(agencyId);
    res.json(vendors);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/vendors', (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const { name, address, phone, fax } = req.body;
    if (!name) return res.status(400).json({ error: 'Vendor name required' });
    const vendor: Vendor = {
      id: generateId(),
      agencyId,
      name,
      address: address || '',
      phone: phone || '',
      fax: fax || '',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    saveVendor(vendor);
    res.status(201).json(vendor);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/vendors/:id', (req: AuthenticatedRequest, res) => {
  try {
    const vendor = getVendor(req.params.id);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    const { agencyId } = getAgencyScope(req);
    if (vendor.agencyId !== agencyId) return res.status(403).json({ error: 'Forbidden' });
    const updates = req.body;
    const updated: Vendor = { ...vendor, ...updates, id: vendor.id, agencyId: vendor.agencyId, updatedAt: Date.now() };
    saveVendor(updated);
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/vendors/:id', (req: AuthenticatedRequest, res) => {
  try {
    const vendor = getVendor(req.params.id);
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    const { agencyId } = getAgencyScope(req);
    if (vendor.agencyId !== agencyId) return res.status(403).json({ error: 'Forbidden' });
    deleteVendor(req.params.id);
    deleteProductsByVendor(agencyId, req.params.id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== PRODUCTS ====================

router.get('/list', (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const vendorId = req.query.vendorId as string | undefined;
    const products = vendorId
      ? getProductsByVendor(agencyId, vendorId)
      : getProductsByAgency(agencyId);
    res.json(products);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/', (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const { vendorId, description, category, packSize, unitOfMeasure, sku, brand } = req.body;
    if (!vendorId || !description) return res.status(400).json({ error: 'vendorId and description required' });
    const product: Product = {
      id: generateId(),
      agencyId,
      vendorId,
      description,
      category: category || '',
      packSize: packSize || '',
      unitOfMeasure: unitOfMeasure || '',
      sku: sku || '',
      brand: brand || '',
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    saveProduct(product);
    res.status(201).json(product);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Bulk import products
router.post('/bulk', (req: AuthenticatedRequest, res) => {
  try {
    const { agencyId } = getAgencyScope(req);
    const { vendorId, products: productList } = req.body;
    if (!vendorId || !Array.isArray(productList)) {
      return res.status(400).json({ error: 'vendorId and products array required' });
    }
    const now = Date.now();
    const newProducts: Product[] = productList.map((p: any) => ({
      id: generateId() + Math.random().toString(36).slice(2, 5),
      agencyId,
      vendorId,
      description: p.description || '',
      category: p.category || '',
      packSize: p.packSize || '',
      unitOfMeasure: p.unitOfMeasure || '',
      sku: p.sku || '',
      brand: p.brand || '',
      status: 'active' as const,
      createdAt: now,
      updatedAt: now
    }));
    saveProductsBulk(newProducts);
    res.status(201).json({ imported: newProducts.length, products: newProducts });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/:id', (req: AuthenticatedRequest, res) => {
  try {
    const product = getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const { agencyId } = getAgencyScope(req);
    if (product.agencyId !== agencyId) return res.status(403).json({ error: 'Forbidden' });
    const updates = req.body;
    const updated: Product = { ...product, ...updates, id: product.id, agencyId: product.agencyId, updatedAt: Date.now() };
    saveProduct(updated);
    res.json(updated);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/:id', (req: AuthenticatedRequest, res) => {
  try {
    const product = getProductById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    const { agencyId } = getAgencyScope(req);
    if (product.agencyId !== agencyId) return res.status(403).json({ error: 'Forbidden' });
    deleteProduct(req.params.id);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
