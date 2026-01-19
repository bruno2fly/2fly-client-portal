import React from "react";
import { Asset } from "../../lib/contentStore";
import { AssetCard } from "./AssetCard";

interface AssetGridProps {
  assets: Asset[];
  selectedIds: Set<string>;
  onSelect: (id: string) => void;
  onView: (asset: Asset) => void;
  onApprove: (id: string) => void;
  onRequestChanges: (id: string) => void;
  onMarkUsed: (id: string) => void;
  onDelete: (id: string) => void;
}

export const AssetGrid: React.FC<AssetGridProps> = ({
  assets,
  selectedIds,
  onSelect,
  onView,
  onApprove,
  onRequestChanges,
  onMarkUsed,
  onDelete,
}) => {
  if (assets.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-6xl mb-4">📁</div>
        <div className="text-lg font-semibold text-[var(--text)] mb-2">
          No assets found
        </div>
        <div className="text-sm text-[var(--muted)]">
          Upload files to get started
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
      {assets.map((asset) => (
        <AssetCard
          key={asset.id}
          asset={asset}
          selected={selectedIds.has(asset.id)}
          onSelect={onSelect}
          onView={onView}
          onApprove={onApprove}
          onRequestChanges={onRequestChanges}
          onMarkUsed={onMarkUsed}
          onDelete={onDelete}
          viewMode="grid"
        />
      ))}
    </div>
  );
};

