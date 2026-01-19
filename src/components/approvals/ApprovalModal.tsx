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
      // Reset form when modal closes
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
      case "reel":
        return "Reel";
      case "story":
        return "Story";
      case "post":
        return "Post";
      default:
        return "Post";
    }
  };

  const getStatusLabel = () => {
    switch (item.status) {
      case "approved":
        return "Approved";
      case "changes":
        return "Changes Requested";
      case "pending":
      default:
        return "Pending";
    }
  };

  const getStatusColor = () => {
    switch (item.status) {
      case "approved":
        return "bg-green-50 text-green-700 border-green-200";
      case "changes":
        return "bg-orange-50 text-orange-700 border-orange-200";
      case "pending":
      default:
        return "bg-blue-50 text-blue-700 border-blue-200";
    }
  };

  const handleApprove = async () => {
    setIsSubmitting(true);
    try {
      approveItem(item.id);
      onApprove?.();
      setTimeout(() => {
        onClose();
        setIsSubmitting(false);
      }, 300);
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
      setTimeout(() => {
        onClose();
        setShowChangesForm(false);
        setChangeMessage("");
        setIsSubmitting(false);
      }, 300);
    } catch (error) {
      console.error("Error requesting changes:", error);
      setIsSubmitting(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black transition-opacity duration-300 z-50 ${
          open ? "opacity-50" : "opacity-0 pointer-events-none"
        }`}
        onClick={handleOverlayClick}
      />

      {/* Modal */}
      <div
        className={`fixed inset-0 flex items-center justify-center z-50 p-4 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={handleOverlayClick}
      >
        <div
          className={`bg-white dark:bg-[#151821] rounded-2xl shadow-xl max-w-[720px] w-full max-h-[90vh] overflow-y-auto transform transition-all duration-300 ${
            open ? "translate-y-0 scale-100" : "translate-y-8 scale-95"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Image Preview */}
          <div className="relative w-full h-64 bg-gray-100 rounded-t-2xl overflow-hidden">
            {item.type === "video" || item.type === "reel" ? (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-blue-400 to-blue-600">
                <svg
                  className="w-16 h-16 text-white"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
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
          <div className="p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                    {item.title}
                  </h2>
                  <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700">
                    {getTypeLabel()}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
                  <span>Due {item.dueDate}</span>
                  <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor()}`}>
                    {getStatusLabel()}
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                className="ml-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                aria-label="Close"
              >
                <svg
                  className="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            {/* Description */}
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Description
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                {item.description}
              </p>
            </div>

            {/* Tags */}
            {item.tags && item.tags.length > 0 && (
              <div className="mb-6">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Tags
                </h3>
                <div className="flex flex-wrap gap-2">
                  {item.tags.map((tag, index) => (
                    <span
                      key={index}
                      className="px-2.5 py-1 rounded-md text-xs font-medium bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Change Notes */}
            {item.status === "changes" && item.changeNotes && item.changeNotes.length > 0 && (
              <div className="mb-6 p-4 bg-orange-50 dark:bg-orange-900/20 rounded-lg border border-orange-200 dark:border-orange-800">
                <h3 className="text-sm font-medium text-orange-900 dark:text-orange-300 mb-2">
                  Previous Change Requests
                </h3>
                {item.changeNotes.map((note, index) => (
                  <div key={index} className="mb-2 last:mb-0">
                    <p className="text-sm text-orange-800 dark:text-orange-200">
                      {note.note}
                    </p>
                    <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                      {new Date(note.when).toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Request Changes Form */}
            {showChangesForm && (
              <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Describe what needs to be changed...
                </label>
                <textarea
                  value={changeMessage}
                  onChange={(e) => setChangeMessage(e.target.value)}
                  placeholder="Please provide specific details about what needs to be changed..."
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  autoFocus
                />
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              {!showChangesForm ? (
                <>
                  {item.status !== "approved" && (
                    <button
                      onClick={handleApprove}
                      disabled={isSubmitting}
                      className="flex-1 bg-green-500 hover:bg-green-600 disabled:bg-green-400 text-white font-medium rounded-lg px-4 py-2.5 transition-colors"
                    >
                      {isSubmitting ? "Approving..." : "Approve"}
                    </button>
                  )}
                  {item.status !== "approved" && (
                    <button
                      onClick={() => setShowChangesForm(true)}
                      disabled={isSubmitting}
                      className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-red-400 text-white font-medium rounded-lg px-4 py-2.5 transition-colors"
                    >
                      Request Changes
                    </button>
                  )}
                  {item.status === "approved" && (
                    <button
                      onClick={onClose}
                      className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 font-medium rounded-lg px-4 py-2.5 transition-colors"
                    >
                      Close
                    </button>
                  )}
                </>
              ) : (
                <>
                  <button
                    onClick={() => {
                      setShowChangesForm(false);
                      setChangeMessage("");
                    }}
                    disabled={isSubmitting}
                    className="flex-1 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 font-medium rounded-lg px-4 py-2.5 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRequestChanges}
                    disabled={isSubmitting || !changeMessage.trim()}
                    className="flex-1 bg-red-500 hover:bg-red-600 disabled:bg-red-400 disabled:cursor-not-allowed text-white font-medium rounded-lg px-4 py-2.5 transition-colors"
                  >
                    {isSubmitting ? "Submitting..." : "Submit Changes"}
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

