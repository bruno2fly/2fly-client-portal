/**
 * Content Library Page
 * 
 * Centralize photos & videos; approve what we'll use next.
 * 
 * Backend Migration Notes:
 * - Replace localStorage with API endpoints (GET /api/assets, POST /api/assets, etc.)
 * - Upload files to S3/Cloudflare R2, return public URLs
 * - Store metadata in database (PostgreSQL/MongoDB)
 * - Add authentication middleware
 * - Implement file size/type validation server-side
 * - Add rate limiting for uploads
 * - Use CDN for asset delivery
 */

import React, { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Asset,
  AssetType,
  AssetStatus,
  listAssets,
  createAssets,
  updateAsset,
  deleteAssets,
  approveAssets,
  requestChanges,
  markUsed,
  getTags,
} from "../lib/contentStore";
import { FiltersBar } from "../components/content/FiltersBar";
import { AssetGrid } from "../components/content/AssetGrid";
import { AssetList } from "../components/content/AssetList";
import { AssetModal } from "../components/content/AssetModal";
import { UploadBox } from "../components/content/UploadBox";
import { BulkBar } from "../components/content/BulkBar";

const CLIENT_ID = "casa-nova";

type Tab = "all" | "approved" | "attention" | "upload";
type ViewMode = "grid" | "list";

export const ContentLibrary: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState<Tab>(
    (searchParams.get("tab") as Tab) || "all"
  );
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Filters
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [typeFilter, setTypeFilter] = useState<AssetType | "all">(
    (searchParams.get("type") as AssetType | "all") || "all"
  );
  const [statusFilter, setStatusFilter] = useState<AssetStatus | "all">(
    (searchParams.get("status") as AssetStatus | "all") || "all"
  );
  const [selectedTags, setSelectedTags] = useState<string[]>(
    searchParams.get("tags")?.split(",").filter(Boolean) || []
  );
  const [sort, setSort] = useState<"newest" | "oldest" | "mostUsed" | "unreviewed">(
    (searchParams.get("sort") as typeof sort) || "newest"
  );

  const availableTags = getTags(CLIENT_ID);

  // Get filtered assets
  const getFilteredAssets = (): Asset[] => {
    let filter: Parameters<typeof listAssets>[1] = {
      search,
      type: typeFilter,
      status: statusFilter,
      tags: selectedTags,
      sort,
    };

    // Override status based on active tab
    if (activeTab === "approved") {
      filter.status = "approved";
    } else if (activeTab === "attention") {
      // Needs attention = changes status OR pending with comments
      const allAssets = listAssets(CLIENT_ID, { ...filter, status: "all" });
      return allAssets.filter(
        (a) => a.status === "changes" || (a.status === "pending" && a.comments.length > 0)
      );
    } else if (activeTab === "all") {
      filter.status = "all";
    }

    return listAssets(CLIENT_ID, filter);
  };

  const assets = getFilteredAssets();

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (activeTab !== "all") params.set("tab", activeTab);
    if (search) params.set("search", search);
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (selectedTags.length > 0) params.set("tags", selectedTags.join(","));
    if (sort !== "newest") params.set("sort", sort);
    setSearchParams(params, { replace: true });
  }, [activeTab, search, typeFilter, statusFilter, selectedTags, sort, setSearchParams]);

  const showToast = (message: string, type: "success" | "error" = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleUpload = async (
    files: File[],
    type: AssetType,
    tags: string[],
    notes?: string
  ) => {
    try {
      await createAssets(
        CLIENT_ID,
        files.map(() => ({ type, tags, caption: notes })),
        files
      );
      showToast(`Successfully uploaded ${files.length} file${files.length !== 1 ? "s" : ""}`);
      setRefreshKey((prev) => prev + 1);
    } catch (error) {
      showToast("Upload failed", "error");
    }
  };

  const handleApprove = (id: string) => {
    approveAssets(CLIENT_ID, [id]);
    showToast("Asset approved");
    setSelectedAsset(null);
    setRefreshKey((prev) => prev + 1);
  };

  const handleBulkApprove = () => {
    approveAssets(CLIENT_ID, Array.from(selectedIds));
    showToast(`Approved ${selectedIds.size} asset${selectedIds.size !== 1 ? "s" : ""}`);
    setSelectedIds(new Set());
    setRefreshKey((prev) => prev + 1);
  };

  const handleRequestChanges = (id: string, comment: string) => {
    requestChanges(CLIENT_ID, id, comment);
    showToast("Changes requested");
    setSelectedAsset(null);
    setRefreshKey((prev) => prev + 1);
  };

  const handleMarkUsed = (id: string) => {
    markUsed(CLIENT_ID, [id]);
    showToast("Marked as used");
    setRefreshKey((prev) => prev + 1);
  };

  const handleBulkMarkUsed = () => {
    markUsed(CLIENT_ID, Array.from(selectedIds));
    showToast(`Marked ${selectedIds.size} asset${selectedIds.size !== 1 ? "s" : ""} as used`);
    setSelectedIds(new Set());
    setRefreshKey((prev) => prev + 1);
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this asset?")) {
      deleteAssets(CLIENT_ID, [id]);
      showToast("Asset deleted");
      setSelectedAsset(null);
      setRefreshKey((prev) => prev + 1);
    }
  };

  const handleBulkDelete = () => {
    if (confirm(`Are you sure you want to delete ${selectedIds.size} asset${selectedIds.size !== 1 ? "s" : ""}?`)) {
      deleteAssets(CLIENT_ID, Array.from(selectedIds));
      showToast(`Deleted ${selectedIds.size} asset${selectedIds.size !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      setRefreshKey((prev) => prev + 1);
    }
  };

  const handleUpdate = (id: string, updates: Partial<Asset>) => {
    updateAsset(CLIENT_ID, id, updates);
    setRefreshKey((prev) => prev + 1);
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  // Force re-render when assets change
  const [refreshKey, setRefreshKey] = useState(0);
  
  // Listen for storage changes (for cross-tab sync)
  useEffect(() => {
    const handleStorageChange = () => {
      setRefreshKey((prev) => prev + 1);
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);
  
  // Re-fetch assets when refresh key changes
  useEffect(() => {
    // This will cause assets to be re-fetched
  }, [refreshKey]);

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)]">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-[var(--surface)] border-b border-[var(--stroke)]">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-2xl font-bold text-[var(--text)]">
                Content Library
              </h1>
              <p className="text-sm text-[var(--muted)] mt-1">
                Centralize photos & videos; approve what we'll use next.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {activeTab !== "upload" && (
                <>
                  <button
                    onClick={() => setViewMode(viewMode === "grid" ? "list" : "grid")}
                    className="px-4 py-2 rounded-lg border border-[var(--stroke)] bg-[var(--surface-2)] text-[var(--text)] hover:bg-[var(--surface)] transition-colors"
                  >
                    {viewMode === "grid" ? "☰ List" : "⊞ Grid"}
                  </button>
                  <button
                    onClick={() => setActiveTab("upload")}
                    className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white font-medium hover:opacity-90 transition-opacity"
                  >
                    Upload new
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-[var(--stroke)]">
            {(["all", "approved", "attention", "upload"] as Tab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? "border-[var(--accent)] text-[var(--accent)]"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {tab === "all"
                  ? "All Files"
                  : tab === "approved"
                  ? "Approved for Use"
                  : tab === "attention"
                  ? "Needs Attention"
                  : "Upload Center"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === "upload" ? (
          <div className="max-w-3xl mx-auto">
            <UploadBox onUpload={handleUpload} />
          </div>
        ) : (
          <>
            <FiltersBar
              search={search}
              onSearchChange={setSearch}
              typeFilter={typeFilter}
              onTypeFilterChange={setTypeFilter}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
              selectedTags={selectedTags}
              availableTags={availableTags}
              onTagToggle={handleTagToggle}
              sort={sort}
              onSortChange={setSort}
            />

            <div className="mt-6">
              {viewMode === "grid" ? (
                <AssetGrid
                  assets={assets}
                  selectedIds={selectedIds}
                  onSelect={handleSelect}
                  onView={setSelectedAsset}
                  onApprove={handleApprove}
                  onRequestChanges={(id) => {
                    const asset = assets.find((a) => a.id === id);
                    if (asset) setSelectedAsset(asset);
                  }}
                  onMarkUsed={handleMarkUsed}
                  onDelete={handleDelete}
                />
              ) : (
                <AssetList
                  assets={assets}
                  selectedIds={selectedIds}
                  onSelect={handleSelect}
                  onView={setSelectedAsset}
                  onApprove={handleApprove}
                  onRequestChanges={(id) => {
                    const asset = assets.find((a) => a.id === id);
                    if (asset) setSelectedAsset(asset);
                  }}
                  onMarkUsed={handleMarkUsed}
                  onDelete={handleDelete}
                />
              )}
            </div>

            <BulkBar
              selectedCount={selectedIds.size}
              onApprove={handleBulkApprove}
              onMarkUsed={handleBulkMarkUsed}
              onDelete={handleBulkDelete}
              onClearSelection={() => setSelectedIds(new Set())}
            />
          </>
        )}
      </div>

      {/* Modal */}
      {selectedAsset && (
        <AssetModal
          asset={selectedAsset}
          clientId={CLIENT_ID}
          onClose={() => setSelectedAsset(null)}
          onApprove={handleApprove}
          onRequestChanges={handleRequestChanges}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg ${
            toast.type === "success"
              ? "bg-[var(--ok)] text-white"
              : "bg-[var(--bad)] text-white"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
};

