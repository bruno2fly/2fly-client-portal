/**
 * Example usage of ApprovalModal and ApprovalCard components
 * 
 * This shows how to integrate the approval components into your app
 */

import React, { useState, useEffect } from "react";
import { ApprovalCard } from "./ApprovalCard";
import { ApprovalModal } from "./ApprovalModal";
import { getAllApprovals, ApprovalItem } from "../../lib/approvalsStore";

export const ApprovalQueueExample: React.FC = () => {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<ApprovalItem | null>(null);

  // Load approvals on mount and listen for storage changes
  useEffect(() => {
    const loadApprovals = () => {
      setApprovals(getAllApprovals());
    };

    loadApprovals();

    // Listen for storage changes (cross-tab sync)
    const handleStorageChange = () => {
      loadApprovals();
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const handleApprove = () => {
    // Reload approvals after approval
    setApprovals(getAllApprovals());
    setSelectedItem(null);
  };

  const handleRequestChanges = () => {
    // Reload approvals after requesting changes
    setApprovals(getAllApprovals());
    // Keep modal open to show the change note was added
    if (selectedItem) {
      const updated = getAllApprovals().find((a) => a.id === selectedItem.id);
      if (updated) setSelectedItem(updated);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
        Approvals Queue
      </h2>

      <div className="space-y-3">
        {approvals.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No approvals pending</p>
        ) : (
          approvals.map((item) => (
            <ApprovalCard
              key={item.id}
              item={item}
              onClick={() => setSelectedItem(item)}
            />
          ))
        )}
      </div>

      <ApprovalModal
        open={!!selectedItem}
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onApprove={handleApprove}
        onRequestChanges={handleRequestChanges}
      />
    </div>
  );
};

