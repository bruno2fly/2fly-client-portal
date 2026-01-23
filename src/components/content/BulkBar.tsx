import React from "react";

interface BulkBarProps {
  selectedCount: number;
  onApprove: () => void;
  onMarkUsed: () => void;
  onDelete: () => void;
  onClearSelection: () => void;
}

export const BulkBar: React.FC<BulkBarProps> = ({
  selectedCount,
  onApprove,
  onMarkUsed,
  onDelete,
  onClearSelection,
}) => {
  if (selectedCount === 0) return null;

  return (
    <div className="sticky bottom-4 z-10 flex items-center justify-between p-4 rounded-lg border border-[var(--stroke)] bg-[var(--surface)] shadow-lg">
      <div className="flex items-center gap-4">
        <span className="font-semibold text-[var(--text)]">
          {selectedCount} item{selectedCount !== 1 ? "s" : ""} selected
        </span>
        <button
          onClick={onClearSelection}
          className="text-sm text-[var(--muted)] hover:text-[var(--text)]"
        >
          Clear
        </button>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onApprove}
          className="px-4 py-2 rounded-lg bg-[var(--ok)] text-white font-medium hover:opacity-90 transition-opacity"
        >
          Approve
        </button>
        <button
          onClick={onMarkUsed}
          className="px-4 py-2 rounded-lg border border-[var(--stroke)] bg-[var(--surface-2)] text-[var(--text)] font-medium hover:bg-[var(--surface)] transition-colors"
        >
          Mark used
        </button>
        <button
          onClick={onDelete}
          className="px-4 py-2 rounded-lg bg-[var(--bad)] text-white font-medium hover:opacity-90 transition-opacity"
        >
          Delete
        </button>
      </div>
    </div>
  );
};

