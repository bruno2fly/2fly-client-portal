import React from "react";
import { Asset } from "../../lib/contentStore";

interface AssetCardProps {
  asset: Asset;
  selected: boolean;
  onSelect: (id: string) => void;
  onView: (asset: Asset) => void;
  onApprove: (id: string) => void;
  onRequestChanges: (id: string) => void;
  onMarkUsed: (id: string) => void;
  onDelete: (id: string) => void;
  viewMode: "grid" | "list";
}

export const AssetCard: React.FC<AssetCardProps> = ({
  asset,
  selected,
  onSelect,
  onView,
  onApprove,
  onRequestChanges,
  onMarkUsed,
  onDelete,
  viewMode,
}) => {
  const getStatusColor = () => {
    switch (asset.status) {
      case "approved":
        return "bg-[rgba(34,197,94,.10)] text-[#22c55e] border-[rgba(34,197,94,.35)]";
      case "changes":
        return "bg-[rgba(234,179,8,.12)] text-[#facc15] border-[rgba(234,179,8,.35)]";
      case "pending":
        return "bg-[rgba(59,130,246,.10)] text-[#3b82f6] border-[rgba(59,130,246,.35)]";
    }
  };

  const getTypeLabel = () => {
    switch (asset.type) {
      case "photo":
        return "Photo";
      case "video":
        return "Video";
      case "logo":
        return "Logo";
      case "doc":
        return "Doc";
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  if (viewMode === "list") {
    return (
      <div
        className={`flex items-center gap-4 p-4 rounded-[14px] border border-[var(--stroke)] bg-[var(--surface)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer ${
          selected ? "ring-2 ring-[var(--accent)]" : ""
        }`}
        onClick={() => onView(asset)}
      >
        <div className="relative flex-shrink-0">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => {
              e.stopPropagation();
              onSelect(asset.id);
            }}
            onClick={(e) => e.stopPropagation()}
            className="absolute top-2 left-2 z-10 w-5 h-5"
          />
          <img
            src={asset.url}
            alt={asset.filename}
            className="w-20 h-20 object-cover rounded-lg"
          />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-[var(--text)] truncate">
              {asset.filename}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor()}`}
            >
              {asset.status}
            </span>
            <span className="px-2 py-0.5 rounded-full text-xs bg-[var(--surface-2)] text-[var(--muted)] border border-[var(--stroke)]">
              {getTypeLabel()}
            </span>
          </div>
          <div className="flex items-center gap-3 text-sm text-[var(--muted)]">
            <span>{formatSize(asset.size)}</span>
            <span>•</span>
            <span>{new Date(asset.uploadedAt).toLocaleDateString()}</span>
            {asset.usedCount > 0 && (
              <>
                <span>•</span>
                <span>Used {asset.usedCount}x</span>
              </>
            )}
          </div>
          {asset.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {asset.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 rounded text-xs bg-[var(--surface-2)] text-[var(--muted)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="flex-shrink-0">
          <MenuButton
            asset={asset}
            onView={() => onView(asset)}
            onApprove={() => onApprove(asset.id)}
            onRequestChanges={() => onRequestChanges(asset.id)}
            onMarkUsed={() => onMarkUsed(asset.id)}
            onDelete={() => onDelete(asset.id)}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative group rounded-[14px] border border-[var(--stroke)] bg-[var(--surface)] overflow-hidden hover:border-[var(--accent)] transition-all cursor-pointer ${
        selected ? "ring-2 ring-[var(--accent)]" : ""
      }`}
      onClick={() => onView(asset)}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => {
          e.stopPropagation();
          onSelect(asset.id);
        }}
        onClick={(e) => e.stopPropagation()}
        className="absolute top-2 left-2 z-10 w-5 h-5"
      />
      <div className="aspect-square relative">
        {asset.type === "video" ? (
          <div className="w-full h-full bg-[var(--surface-2)] flex items-center justify-center">
            <div className="text-center">
              <div className="text-4xl mb-2">▶</div>
              <div className="text-sm text-[var(--muted)]">Video</div>
            </div>
          </div>
        ) : (
          <img
            src={asset.url}
            alt={asset.filename}
            className="w-full h-full object-cover"
          />
        )}
        <div className="absolute top-2 right-2 flex gap-1">
          <span
            className={`px-2 py-1 rounded-full text-xs font-medium border ${getStatusColor()}`}
          >
            {asset.status}
          </span>
          <span className="px-2 py-1 rounded-full text-xs bg-[var(--surface-2)] text-[var(--muted)] border border-[var(--stroke)]">
            {getTypeLabel()}
          </span>
        </div>
      </div>
      <div className="p-3">
        <div className="font-medium text-sm text-[var(--text)] truncate mb-1">
          {asset.filename}
        </div>
        <div className="flex items-center justify-between text-xs text-[var(--muted)] mb-2">
          <span>{formatSize(asset.size)}</span>
          {asset.usedCount > 0 && <span>Used {asset.usedCount}x</span>}
        </div>
        {asset.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {asset.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="px-1.5 py-0.5 rounded text-xs bg-[var(--surface-2)] text-[var(--muted)]"
              >
                {tag}
              </span>
            ))}
            {asset.tags.length > 2 && (
              <span className="px-1.5 py-0.5 rounded text-xs text-[var(--muted)]">
                +{asset.tags.length - 2}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <MenuButton
          asset={asset}
          onView={() => onView(asset)}
          onApprove={() => onApprove(asset.id)}
          onRequestChanges={() => onRequestChanges(asset.id)}
          onMarkUsed={() => onMarkUsed(asset.id)}
          onDelete={() => onDelete(asset.id)}
        />
      </div>
    </div>
  );
};

const MenuButton: React.FC<{
  asset: Asset;
  onView: () => void;
  onApprove: () => void;
  onRequestChanges: () => void;
  onMarkUsed: () => void;
  onDelete: () => void;
}> = ({ asset, onView, onApprove, onRequestChanges, onMarkUsed, onDelete }) => {
  const [open, setOpen] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="w-8 h-8 rounded-lg bg-[var(--surface-2)] border border-[var(--stroke)] flex items-center justify-center hover:bg-[var(--surface)] transition-colors"
      >
        <span className="text-[var(--text)]">⋯</span>
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-48 rounded-lg border border-[var(--stroke)] bg-[var(--surface)] shadow-lg py-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onView();
              setOpen(false);
            }}
            className="w-full text-left px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--surface-2)]"
          >
            View
          </button>
          {asset.status !== "approved" && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onApprove();
                setOpen(false);
              }}
              className="w-full text-left px-4 py-2 text-sm text-[var(--ok)] hover:bg-[var(--surface-2)]"
            >
              Approve
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onRequestChanges();
              setOpen(false);
            }}
            className="w-full text-left px-4 py-2 text-sm text-[var(--warn)] hover:bg-[var(--surface-2)]"
          >
            Needs change
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onMarkUsed();
              setOpen(false);
            }}
            className="w-full text-left px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--surface-2)]"
          >
            Mark used
          </button>
          <div className="border-t border-[var(--stroke)] my-1" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
              setOpen(false);
            }}
            className="w-full text-left px-4 py-2 text-sm text-[var(--bad)] hover:bg-[var(--surface-2)]"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
};

