import React, { useState, useEffect } from "react";
import { Asset, addComment } from "../../lib/contentStore";

interface AssetModalProps {
  asset: Asset | null;
  clientId: string;
  onClose: () => void;
  onApprove: (id: string) => void;
  onRequestChanges: (id: string, comment: string) => void;
  onUpdate: (id: string, updates: Partial<Asset>) => void;
  onDelete: (id: string) => void;
}

export const AssetModal: React.FC<AssetModalProps> = ({
  asset,
  clientId,
  onClose,
  onApprove,
  onRequestChanges,
  onUpdate,
  onDelete,
}) => {
  const [commentText, setCommentText] = useState("");
  const [showChangesDialog, setShowChangesDialog] = useState(false);
  const [changesComment, setChangesComment] = useState("");
  const [newTag, setNewTag] = useState("");

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  if (!asset) return null;

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const handleAddComment = () => {
    if (!commentText.trim()) return;
    addComment(clientId, asset.id, "client", commentText);
    setCommentText("");
    // Trigger re-render by updating asset
    onUpdate(asset.id, {});
  };

  const handleRequestChanges = () => {
    if (!changesComment.trim()) return;
    onRequestChanges(asset.id, changesComment);
    setShowChangesDialog(false);
    setChangesComment("");
  };

  const handleAddTag = () => {
    if (!newTag.trim()) return;
    const updatedTags = [...asset.tags, newTag.trim()];
    onUpdate(asset.id, { tags: updatedTags });
    setNewTag("");
  };

  const handleRemoveTag = (tag: string) => {
    const updatedTags = asset.tags.filter((t) => t !== tag);
    onUpdate(asset.id, { tags: updatedTags });
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = asset.url;
    link.download = asset.filename;
    link.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="relative w-full max-w-6xl max-h-[90vh] bg-[var(--surface)] rounded-[14px] border border-[var(--stroke)] shadow-lg flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--stroke)]">
          <h2 className="text-lg font-semibold text-[var(--text)]">
            {asset.filename}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[var(--surface-2)] flex items-center justify-center text-[var(--text)]"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Preview */}
          <div className="flex-1 flex items-center justify-center bg-[var(--surface-2)] p-8 overflow-auto">
            {asset.type === "video" ? (
              <video
                src={asset.url}
                controls
                className="max-w-full max-h-full rounded-lg"
              />
            ) : (
              <img
                src={asset.url}
                alt={asset.filename}
                className="max-w-full max-h-full object-contain rounded-lg"
              />
            )}
          </div>

          {/* Sidebar */}
          <div className="w-80 border-l border-[var(--stroke)] flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Metadata */}
              <div className="space-y-2">
                <div>
                  <div className="text-xs text-[var(--muted)] mb-1">Size</div>
                  <div className="text-sm text-[var(--text)]">
                    {formatSize(asset.size)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[var(--muted)] mb-1">
                    Uploaded
                  </div>
                  <div className="text-sm text-[var(--text)]">
                    {new Date(asset.uploadedAt).toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[var(--muted)] mb-1">Type</div>
                  <div className="text-sm text-[var(--text)] capitalize">
                    {asset.type}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[var(--muted)] mb-1">Status</div>
                  <div
                    className={`text-sm px-2 py-1 rounded-full inline-block ${
                      asset.status === "approved"
                        ? "bg-[rgba(34,197,94,.10)] text-[#22c55e]"
                        : asset.status === "changes"
                        ? "bg-[rgba(234,179,8,.12)] text-[#facc15]"
                        : "bg-[rgba(59,130,246,.10)] text-[#3b82f6]"
                    }`}
                  >
                    {asset.status}
                  </div>
                </div>
                {asset.usedCount > 0 && (
                  <div>
                    <div className="text-xs text-[var(--muted)] mb-1">
                      Used
                    </div>
                    <div className="text-sm text-[var(--text)]">
                      {asset.usedCount} time{asset.usedCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                )}
              </div>

              {/* Tags */}
              <div>
                <div className="text-xs text-[var(--muted)] mb-2">Tags</div>
                <div className="flex flex-wrap gap-2 mb-2">
                  {asset.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-1 rounded-full text-xs bg-[var(--surface-2)] text-[var(--text)] border border-[var(--stroke)] flex items-center gap-1"
                    >
                      {tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="hover:text-[var(--bad)]"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter") handleAddTag();
                    }}
                    placeholder="Add tag"
                    className="flex-1 px-2 py-1 rounded text-sm border border-[var(--stroke)] bg-[var(--surface-2)] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  />
                  <button
                    onClick={handleAddTag}
                    className="px-3 py-1 rounded text-sm bg-[var(--accent)] text-white hover:opacity-90"
                  >
                    Add
                  </button>
                </div>
              </div>

              {/* Caption */}
              {asset.caption && (
                <div>
                  <div className="text-xs text-[var(--muted)] mb-1">
                    Caption
                  </div>
                  <div className="text-sm text-[var(--text)]">
                    {asset.caption}
                  </div>
                </div>
              )}

              {/* Comments */}
              <div>
                <div className="text-xs text-[var(--muted)] mb-2">Comments</div>
                <div className="space-y-2 max-h-48 overflow-y-auto mb-2">
                  {asset.comments.map((comment) => (
                    <div
                      key={comment.id}
                      className="p-2 rounded-lg bg-[var(--surface-2)]"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-[var(--text)]">
                          {comment.by === "client" ? "You" : "Team"}
                        </span>
                        <span className="text-xs text-[var(--muted)]">
                          {new Date(comment.when).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="text-sm text-[var(--text)]">
                        {comment.text}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === "Enter") handleAddComment();
                    }}
                    placeholder="Add a comment..."
                    className="flex-1 px-2 py-1 rounded text-sm border border-[var(--stroke)] bg-[var(--surface-2)] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
                  />
                  <button
                    onClick={handleAddComment}
                    className="px-3 py-1 rounded text-sm bg-[var(--accent)] text-white hover:opacity-90"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="border-t border-[var(--stroke)] p-4 space-y-2">
              {asset.status !== "approved" && (
                <button
                  onClick={() => onApprove(asset.id)}
                  className="w-full px-4 py-2 rounded-lg bg-[var(--ok)] text-white font-medium hover:opacity-90 transition-opacity"
                >
                  Approve
                </button>
              )}
              <button
                onClick={() => setShowChangesDialog(true)}
                className="w-full px-4 py-2 rounded-lg bg-[var(--warn)] text-white font-medium hover:opacity-90 transition-opacity"
              >
                Needs change
              </button>
              <button
                onClick={handleDownload}
                className="w-full px-4 py-2 rounded-lg border border-[var(--stroke)] bg-[var(--surface-2)] text-[var(--text)] font-medium hover:bg-[var(--surface)] transition-colors"
              >
                Download
              </button>
              <button
                onClick={() => {
                  if (confirm("Are you sure you want to delete this asset?")) {
                    onDelete(asset.id);
                    onClose();
                  }
                }}
                className="w-full px-4 py-2 rounded-lg bg-[var(--bad)] text-white font-medium hover:opacity-90 transition-opacity"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Changes Dialog */}
      {showChangesDialog && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60">
          <div className="bg-[var(--surface)] rounded-[14px] border border-[var(--stroke)] p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-[var(--text)] mb-4">
              Request Changes
            </h3>
            <p className="text-sm text-[var(--muted)] mb-4">
              Please provide a comment explaining what needs to be changed.
            </p>
            <textarea
              value={changesComment}
              onChange={(e) => setChangesComment(e.target.value)}
              placeholder="Describe the changes needed..."
              rows={4}
              className="w-full px-4 py-2 rounded-lg border border-[var(--stroke)] bg-[var(--surface-2)] text-[var(--text)] placeholder:text-[var(--muted)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)] mb-4"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowChangesDialog(false);
                  setChangesComment("");
                }}
                className="flex-1 px-4 py-2 rounded-lg border border-[var(--stroke)] bg-[var(--surface-2)] text-[var(--text)] font-medium hover:bg-[var(--surface)] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleRequestChanges}
                disabled={!changesComment.trim()}
                className="flex-1 px-4 py-2 rounded-lg bg-[var(--warn)] text-white font-medium hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

