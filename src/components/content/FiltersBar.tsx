import React from "react";
import { AssetType, AssetStatus } from "../../lib/contentStore";

interface FiltersBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  typeFilter: AssetType | "all";
  onTypeFilterChange: (type: AssetType | "all") => void;
  statusFilter: AssetStatus | "all";
  onStatusFilterChange: (status: AssetStatus | "all") => void;
  selectedTags: string[];
  availableTags: string[];
  onTagToggle: (tag: string) => void;
  sort: "newest" | "oldest" | "mostUsed" | "unreviewed";
  onSortChange: (sort: "newest" | "oldest" | "mostUsed" | "unreviewed") => void;
}

export const FiltersBar: React.FC<FiltersBarProps> = ({
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  statusFilter,
  onStatusFilterChange,
  selectedTags,
  availableTags,
  onTagToggle,
  sort,
  onSortChange,
}) => {
  const types: (AssetType | "all")[] = ["all", "photo", "video", "logo", "doc"];
  const statuses: (AssetStatus | "all")[] = ["all", "pending", "approved", "changes"];
  const sorts: Array<{ value: typeof sort; label: string }> = [
    { value: "newest", label: "Newest" },
    { value: "oldest", label: "Oldest" },
    { value: "mostUsed", label: "Most used" },
    { value: "unreviewed", label: "Unreviewed" },
  ];

  return (
    <div className="space-y-4 p-4 rounded-[14px] border border-[var(--stroke)] bg-[var(--surface)]">
      {/* Search */}
      <div className="flex gap-2 flex-wrap">
        <input
          type="text"
          placeholder="Search by filename, caption, tags..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="flex-1 min-w-[200px] px-4 py-2 rounded-lg border border-[var(--stroke)] bg-[var(--surface-2)] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        />
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as typeof sort)}
          className="px-4 py-2 rounded-lg border border-[var(--stroke)] bg-[var(--surface-2)] text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        >
          {sorts.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* Type chips */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm text-[var(--muted)] mr-2">Type:</span>
        {types.map((type) => (
          <button
            key={type}
            onClick={() => onTypeFilterChange(type)}
            className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
              typeFilter === type
                ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                : "bg-[var(--surface-2)] text-[var(--text)] border-[var(--stroke)] hover:bg-[var(--surface)]"
            }`}
          >
            {type === "all" ? "All" : type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm text-[var(--muted)] mr-2">Status:</span>
        {statuses.map((status) => (
          <button
            key={status}
            onClick={() => onStatusFilterChange(status)}
            className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
              statusFilter === status
                ? status === "all"
                  ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                  : status === "approved"
                  ? "bg-[rgba(34,197,94,.20)] text-[#22c55e] border-[rgba(34,197,94,.35)]"
                  : status === "changes"
                  ? "bg-[rgba(234,179,8,.20)] text-[#facc15] border-[rgba(234,179,8,.35)]"
                  : "bg-[rgba(59,130,246,.20)] text-[#3b82f6] border-[rgba(59,130,246,.35)]"
                : "bg-[var(--surface-2)] text-[var(--text)] border-[var(--stroke)] hover:bg-[var(--surface)]"
            }`}
          >
            {status === "all"
              ? "All"
              : status.charAt(0).toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>

      {/* Tags */}
      {availableTags.length > 0 && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-sm text-[var(--muted)] mr-2">Tags:</span>
          {availableTags.map((tag) => (
            <button
              key={tag}
              onClick={() => onTagToggle(tag)}
              className={`px-3 py-1 rounded-full text-sm font-medium border transition-colors ${
                selectedTags.includes(tag)
                  ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                  : "bg-[var(--surface-2)] text-[var(--text)] border-[var(--stroke)] hover:bg-[var(--surface)]"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

