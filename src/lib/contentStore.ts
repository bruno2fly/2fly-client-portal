/**
 * Content Library Store
 * 
 * DEV NOTE: To reset storage, run:
 * localStorage.removeItem('content_library_v1_casa-nova')
 * 
 * Backend migration path:
 * - Replace localStorage with API calls to your backend
 * - Store files in S3/Cloudflare R2, return URLs
 * - Use real database (PostgreSQL/MongoDB) for metadata
 * - Add authentication/authorization checks
 * - Implement file size limits and validation server-side
 */

export type AssetStatus = "pending" | "approved" | "changes";
export type AssetType = "photo" | "video" | "logo" | "doc";

export interface Asset {
  id: string;
  clientId: string;
  filename: string;
  mime: string;
  size: number;
  type: AssetType;
  status: AssetStatus;
  url: string; // Object URL for MVP
  tags: string[];
  caption?: string;
  uploadedAt: number;
  usedCount: number;
  comments: { id: string; by: "client" | "team"; text: string; when: number }[];
}

const STORAGE_KEY = (clientId: string) => `content_library_v1_${clientId}`;

// Seed data with placeholder images
const seedAssets = (clientId: string): Asset[] => {
  const now = Date.now();
  const day = 86400000;
  
  return [
    {
      id: "a1",
      clientId,
      filename: "restaurant-ambience-1.jpg",
      mime: "image/jpeg",
      size: 2456789,
      type: "photo",
      status: "approved",
      url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23151821' width='400' height='300'/%3E%3Ctext fill='%239aa3b2' font-family='system-ui' font-size='16' x='50%25' y='50%25' text-anchor='middle'%3EPhoto: Restaurant Ambience%3C/text%3E%3C/svg%3E",
      tags: ["ambience", "interior"],
      caption: "Main dining area",
      uploadedAt: now - day * 5,
      usedCount: 3,
      comments: []
    },
    {
      id: "a2",
      clientId,
      filename: "chef-special-dish.mp4",
      mime: "video/mp4",
      size: 12456789,
      type: "video",
      status: "pending",
      url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23151821' width='400' height='300'/%3E%3Ctext fill='%239aa3b2' font-family='system-ui' font-size='16' x='50%25' y='50%25' text-anchor='middle'%3EVideo: Chef Special%3C/text%3E%3C/svg%3E",
      tags: ["food", "menu"],
      uploadedAt: now - day * 2,
      usedCount: 0,
      comments: []
    },
    {
      id: "a3",
      clientId,
      filename: "logo-primary.svg",
      mime: "image/svg+xml",
      size: 12345,
      type: "logo",
      status: "approved",
      url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23151821' width='400' height='300'/%3E%3Ctext fill='%239aa3b2' font-family='system-ui' font-size='16' x='50%25' y='50%25' text-anchor='middle'%3ELogo: Primary%3C/text%3E%3C/svg%3E",
      tags: ["branding"],
      uploadedAt: now - day * 10,
      usedCount: 12,
      comments: []
    },
    {
      id: "a4",
      clientId,
      filename: "menu-items-closeup.jpg",
      mime: "image/jpeg",
      size: 3456789,
      type: "photo",
      status: "changes",
      url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23151821' width='400' height='300'/%3E%3Ctext fill='%239aa3b2' font-family='system-ui' font-size='16' x='50%25' y='50%25' text-anchor='middle'%3EPhoto: Menu Items%3C/text%3E%3C/svg%3E",
      tags: ["food", "menu"],
      caption: "Need better lighting",
      uploadedAt: now - day * 3,
      usedCount: 0,
      comments: [{ id: "c1", by: "team", text: "Please retake with better lighting", when: now - day * 2 }]
    },
    {
      id: "a5",
      clientId,
      filename: "team-photo.jpg",
      mime: "image/jpeg",
      size: 2234567,
      type: "photo",
      status: "approved",
      url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23151821' width='400' height='300'/%3E%3Ctext fill='%239aa3b2' font-family='system-ui' font-size='16' x='50%25' y='50%25' text-anchor='middle'%3EPhoto: Team%3C/text%3E%3C/svg%3E",
      tags: ["team"],
      uploadedAt: now - day * 7,
      usedCount: 5,
      comments: []
    },
    {
      id: "a6",
      clientId,
      filename: "promo-video-2024.mp4",
      mime: "video/mp4",
      size: 45678901,
      type: "video",
      status: "pending",
      url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23151821' width='400' height='300'/%3E%3Ctext fill='%239aa3b2' font-family='system-ui' font-size='16' x='50%25' y='50%25' text-anchor='middle'%3EVideo: Promo 2024%3C/text%3E%3C/svg%3E",
      tags: ["promo", "marketing"],
      uploadedAt: now - day * 1,
      usedCount: 0,
      comments: []
    },
    {
      id: "a7",
      clientId,
      filename: "exterior-night.jpg",
      mime: "image/jpeg",
      size: 3123456,
      type: "photo",
      status: "approved",
      url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23151821' width='400' height='300'/%3E%3Ctext fill='%239aa3b2' font-family='system-ui' font-size='16' x='50%25' y='50%25' text-anchor='middle'%3EPhoto: Exterior Night%3C/text%3E%3C/svg%3E",
      tags: ["exterior", "ambience"],
      uploadedAt: now - day * 6,
      usedCount: 2,
      comments: []
    },
    {
      id: "a8",
      clientId,
      filename: "menu-pdf.pdf",
      mime: "application/pdf",
      size: 1234567,
      type: "doc",
      status: "approved",
      url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23151821' width='400' height='300'/%3E%3Ctext fill='%239aa3b2' font-family='system-ui' font-size='16' x='50%25' y='50%25' text-anchor='middle'%3EDoc: Menu PDF%3C/text%3E%3C/svg%3E",
      tags: ["menu", "documents"],
      uploadedAt: now - day * 8,
      usedCount: 8,
      comments: []
    },
    {
      id: "a9",
      clientId,
      filename: "dessert-plating.jpg",
      mime: "image/jpeg",
      size: 2789012,
      type: "photo",
      status: "pending",
      url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23151821' width='400' height='300'/%3E%3Ctext fill='%239aa3b2' font-family='system-ui' font-size='16' x='50%25' y='50%25' text-anchor='middle'%3EPhoto: Dessert%3C/text%3E%3C/svg%3E",
      tags: ["food", "dessert"],
      uploadedAt: now - day * 1,
      usedCount: 0,
      comments: []
    },
    {
      id: "a10",
      clientId,
      filename: "logo-secondary.png",
      mime: "image/png",
      size: 45678,
      type: "logo",
      status: "approved",
      url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%23151821' width='400' height='300'/%3E%3Ctext fill='%239aa3b2' font-family='system-ui' font-size='16' x='50%25' y='50%25' text-anchor='middle'%3ELogo: Secondary%3C/text%3E%3C/svg%3E",
      tags: ["branding"],
      uploadedAt: now - day * 12,
      usedCount: 15,
      comments: []
    }
  ];
};

function loadAssets(clientId: string): Asset[] {
  const key = STORAGE_KEY(clientId);
  const stored = localStorage.getItem(key);
  if (!stored) {
    const seeded = seedAssets(clientId);
    localStorage.setItem(key, JSON.stringify(seeded));
    return seeded;
  }
  try {
    return JSON.parse(stored);
  } catch {
    return seedAssets(clientId);
  }
}

function saveAssets(clientId: string, assets: Asset[]): void {
  const key = STORAGE_KEY(clientId);
  localStorage.setItem(key, JSON.stringify(assets));
}

export function listAssets(
  clientId: string,
  filter?: Partial<{
    status: AssetStatus | "all";
    type: AssetType | "all";
    tags: string[];
    search: string;
    sort: "newest" | "oldest" | "mostUsed" | "unreviewed";
  }>
): Asset[] {
  let assets = loadAssets(clientId);

  if (filter?.status && filter.status !== "all") {
    assets = assets.filter((a) => a.status === filter.status);
  }

  if (filter?.type && filter.type !== "all") {
    assets = assets.filter((a) => a.type === filter.type);
  }

  if (filter?.tags && filter.tags.length > 0) {
    assets = assets.filter((a) =>
      filter.tags!.some((tag) => a.tags.includes(tag))
    );
  }

  if (filter?.search) {
    const searchLower = filter.search.toLowerCase();
    assets = assets.filter(
      (a) =>
        a.filename.toLowerCase().includes(searchLower) ||
        a.caption?.toLowerCase().includes(searchLower) ||
        a.tags.some((tag) => tag.toLowerCase().includes(searchLower))
    );
  }

  // Sort
  if (filter?.sort) {
    switch (filter.sort) {
      case "newest":
        assets.sort((a, b) => b.uploadedAt - a.uploadedAt);
        break;
      case "oldest":
        assets.sort((a, b) => a.uploadedAt - b.uploadedAt);
        break;
      case "mostUsed":
        assets.sort((a, b) => b.usedCount - a.usedCount);
        break;
      case "unreviewed":
        assets.sort((a, b) => {
          if (a.status === "pending" && b.status !== "pending") return -1;
          if (a.status !== "pending" && b.status === "pending") return 1;
          return b.uploadedAt - a.uploadedAt;
        });
        break;
    }
  } else {
    assets.sort((a, b) => b.uploadedAt - a.uploadedAt);
  }

  return assets;
}

export async function createAssets(
  clientId: string,
  batch: Omit<Asset, "id" | "url" | "uploadedAt" | "usedCount" | "comments">[],
  files: File[]
): Promise<Asset[]> {
  const assets = loadAssets(clientId);
  const newAssets: Asset[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const meta = batch[i] || batch[0];
    const url = URL.createObjectURL(file);

    const asset: Asset = {
      id: `a${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      clientId,
      filename: file.name,
      mime: file.type,
      size: file.size,
      type: meta.type,
      status: "pending",
      url,
      tags: meta.tags || [],
      caption: meta.caption,
      uploadedAt: Date.now(),
      usedCount: 0,
      comments: [],
    };

    newAssets.push(asset);
    assets.push(asset);
  }

  saveAssets(clientId, assets);
  return newAssets;
}

export function updateAsset(
  clientId: string,
  id: string,
  patch: Partial<Asset>
): Asset | null {
  const assets = loadAssets(clientId);
  const index = assets.findIndex((a) => a.id === id);
  if (index === -1) return null;

  assets[index] = { ...assets[index], ...patch };
  saveAssets(clientId, assets);
  return assets[index];
}

export function deleteAssets(clientId: string, ids: string[]): void {
  const assets = loadAssets(clientId);
  const filtered = assets.filter((a) => !ids.includes(a.id));
  
  // Revoke object URLs for deleted assets
  ids.forEach((id) => {
    const asset = assets.find((a) => a.id === id);
    if (asset?.url && asset.url.startsWith("blob:")) {
      URL.revokeObjectURL(asset.url);
    }
  });
  
  saveAssets(clientId, filtered);
}

export function approveAssets(clientId: string, ids: string[]): void {
  const assets = loadAssets(clientId);
  assets.forEach((asset) => {
    if (ids.includes(asset.id)) {
      asset.status = "approved";
    }
  });
  saveAssets(clientId, assets);
}

export function requestChanges(
  clientId: string,
  id: string,
  comment: string
): void {
  const asset = updateAsset(clientId, id, { status: "changes" });
  if (asset) {
    addComment(clientId, id, "team", comment);
  }
}

export function markUsed(clientId: string, ids: string[]): void {
  const assets = loadAssets(clientId);
  assets.forEach((asset) => {
    if (ids.includes(asset.id)) {
      asset.usedCount++;
    }
  });
  saveAssets(clientId, assets);
}

export function addComment(
  clientId: string,
  id: string,
  by: "client" | "team",
  text: string
): void {
  const asset = updateAsset(clientId, id, {});
  if (asset) {
    asset.comments.push({
      id: `c${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      by,
      text,
      when: Date.now(),
    });
    saveAssets(clientId, loadAssets(clientId).map((a) => (a.id === id ? asset : a)));
  }
}

export function getTags(clientId: string): string[] {
  const assets = loadAssets(clientId);
  const tagSet = new Set<string>();
  assets.forEach((asset) => {
    asset.tags.forEach((tag) => tagSet.add(tag));
  });
  return Array.from(tagSet).sort();
}

