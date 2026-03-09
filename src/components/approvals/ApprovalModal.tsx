import React, { useState, useEffect } from "react";
import { ApprovalItem, approveItem, requestChanges } from "../../lib/approvalsStore";

interface ApprovalModalProps {
  open: boolean;
  onClose: () => void;
  item: ApprovalItem | null;
  onApprove?: () => void;
  onRequestChanges?: () => void;
}

export const ApprovalModal: React.FC<ApprovalModalProps> = ({
  open,
  onClose,
  item,
  onApprove,
  onRequestChanges,
}) => {
  const [showChangesForm, setShowChangesForm] = useState(false);
  const [changeMessage, setChangeMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setShowChangesForm(false);
      setChangeMessage("");
    }
  }, [open]);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onClose();
      }
    };

    if (open) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [open, onClose]);

  if (!open || !item) return null;

  const getTypeLabel = () => {
    switch (item.type) {
      case "reel": return "Reel";
      case "story": return "Story";
      case "post": return "Post";
      default: return "Post";
    }
  };

  const getStatusLabel = () => {
    switch (item.status) {
      case "approved": return "Approved";
      case "changes": return "Changes Requested";
      case "pending": default: return "Pending";
    }
  };

  const getStatusColor = () => {
    switch (item.status) {
      case "approved": return "bg-green-50 text-green-700";
      case "changes": return "bg-orange-50 text-orange-700";
      case "pending": default: return "bg-blue-50 text-blue-700";
    }
  };

  const handleApprove = async () => {
    setIsSubmitting(true);
    try {
      approveItem(item.id);
      onApprove?.();
      setTimeout(() => { onClose(); setIsSubmitting(false); }, 300);
    } catch (error) {
      console.error("Error approving item:", error);
      setIsSubmitting(false);
    }
  };

  const handleRequestChanges = async () => {
    if (!changeMessage.trim()) {
      alert("Please describe what needs to be changed.");
      return;
    }
    setIsSubmitting(true);
    try {
      requestChanges(item.id, changeMessage.trim());
      onRequestChanges?.();
      setTimeout(() => { onClose(); setShowChangesForm(false); setChangeMessage(""); setIsSubmitting(false); }, 300);
    } catch (error) {
      console.error("Error requesting changes:", error);
      setIsSubmitting(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black transition-opacity duration-300 z-50 ${open ? "opacity-60" : "opacity-0 pointer-events-none"}`}
        onClick={handleOverlayClick}
      />

      {/* Modal */}
      <div
        className={`fixed inset-0 flex items-end sm:items-center justify-center z-50 transition-opacity duration-300 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={handleOverlayClick}
      >
        <div
          className={`bg-white w-full sm:max-w-[480px] max-h-[92vh] overflow-y-auto transform transition-all duration-300 ${
            open ? "translate-y-0 scale-100" : "translate-y-8 scale-95"
          }`}
          style={{ borderRadius: "20px 20px 0 0", ...(window.innerWidth >= 640 ? { borderRadius: 20 } : {}) }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Drag Handle (mobile) */}
          <div className="flex justify-center pt-3 pb-1 sm:hidden">
            <div className="w-10 h-1 rounded-full bg-gray-300" />
          </div>

          {/* Image Preview */}
          <div className="relative w-full h-56 bg-gray-100 overflow-hidden" style={{ borderRadius: "16px 16px 0 0" }}>
            {item.type === "video" || item.type === "reel" ? (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-500 to-blue-700">
                <svg className="w-14 h-14 text-white/80" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                </svg>
              </div>
            ) : (
              <img
                src={item.imageUrl}
                alt={item.title}
                className="w-full h-full object-cover"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = `https://via.placeholder.com/600x400/2563eb/ffffff?text=${encodeURIComponent(item.title)}`;
                }}
              />
            )}
          </div>

          {/* Content */}
          <div className="p-5">
            {/* Header */}
            <div className="flex items-start justify-between mb-3">
              <div className="flex-1">
                <div className="flex items-center gap-2.5 mb-1.5">
                  <h2 className="text-lg font-bold text-gray-900">{item.title}</h2>
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-500 uppercase tracking-wide">
                    {getTypeLabel()}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[13px] text-gray-400">
                  <span>Due {item.dueDate}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${getStatusColor()}`}>
                    {getStatusLabel()}
                  </span>
                </div>
              </div>
              <button onClick={onClose} className="ml-3 text-gray-300 hover:text-gray-500 transition-colors" aria-label="Close">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Description */}
            <div className="mb-5">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Description</h3>
              <p className="text-sm text-gray-600 leading-relaxed">{item.description}</p>
            </div>

            {/* Tags */}
            {item.tags && item.tags.length > 0 && (
              <div className="mb-5">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Tags</h3>
                <div className="flex flex-wrap gap-1.5">
                  {item.tags.map((tag, index) => (
                    <span key={index} className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Change Notes */}
            {item.status === "changes" && item.changeNotes && item.changeNotes.length > 0 && (
              <div className="mb-5 p-3.5 bg-orange-50 rounded-2xl">
                <h3 className="text-xs font-semibold text-orange-800 uppercase tracking-wide mb-2">Change Requests</h3>
                {item.changeNotes.map((note, index) => (
                  <div key={index} className="mb-2 last:mb-0">
                    <p className="text-sm text-orange-700">{note.note}</p>
                    <p className="text-[11px] text-orange-400 mt-0.5">{new Date(note.when).toLocaleString()}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Request Changes Form */}
            {showChangesForm && (
              <div className="mb-5 p-3.5 bg-gray-50 rounded-2xl">
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  What needs to change?
                </label>
                <textarea
                  value={changeMessage}
                  onChange={(e) => setChangeMessage(e.target.value)}
                  placeholder="Describe the changes needed..."
                  rows={3}
                  className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl bg-white text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  autoFocus
                />
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t border-gray-100">
              {!showChangesForm ? (
                <>
                  {item.status !== "approved" && (
                    <button
                      onClick={handleApprove}
                      disabled={isSubmitting}
                      className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-xl px-4 py-3 transition-colors text-sm"
                    >
                      {isSubmitting ? "Approving..." : "Approve"}
                    </button>
                  )}
                  {item.status !== "approved" && (
                    <button
                      onClick={() => setShowChangesForm(true)}
                      disabled={isSubmitting}
                      className="flex-1 bg-gray-100 hover:bg-gray-200 disabled:bg-gray-100 text-gray-700 font-semibold rounded-xl px-4 py-3 transition-colors text-sm"
                    >
                      Request Changes
                    </button>
                  )}
                  {item.status === "approved" && (
                    <button
                      onClick={onClose}
                      className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl px-4 py-3 transition-colors text-sm"
                    >
                      Close
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    onClick={() => { setShowChangesForm(false); setChangeMessage(""); }}
                    disabled={isSubmitting}
                    className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold rounded-xl px-4 py-3 transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRequestChanges}
                    disabled={isSubmitting || !changeMessage.trim()}
                    className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-red-300 disabled:cursor-not-allowed text-white font-semibold rounded-xl px-4 py-3 transition-colors text-sm"
                  >
                    {isSubmitting ? "Submitting..." : "Submit"}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
