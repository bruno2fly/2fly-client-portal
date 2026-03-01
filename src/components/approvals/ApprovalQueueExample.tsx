/**
 * Example usage of ApprovalModal and ApprovalCard components
 * 
 * This shows how to integrate the approval components into your app
 */

import React, { useState, useEffect } from "react";
import { ApprovalCard } from "./ApprovalCard";
import { ApprovalModal } from "./ApprovalModal";
import { getAllApprovals, ApprovalItem } from "../../lib/approvalsStore";

type TabFilter = "all" | "pending" | "approved" | "changes";

export const ApprovalQueueExample: React.FC = () => {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<ApprovalItem | null>(null);
  const [activeTab, setActiveTab] = useState<TabFilter>("all");

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

  const filteredApprovals = activeTab === "all"
    ? approvals
    : approvals.filter((a) => a.status === activeTab);

  const tabs: { key: TabFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "changes", label: "Changes" },
  ];

  return (
    <div className="relative min-h-screen pb-24" style={{ background: "#0b1121" }}>
      {/* Header */}
      <div className="px-5 pt-6 pb-4">
        <h2 className="text-2xl font-bold text-white mb-5">
          Approvals
        </h2>

        {/* Pill Tab Selector */}
        <div className="flex gap-2 p-1 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 py-2 px-4 rounded-full text-sm font-semibold transition-all ${
                activeTab === tab.key
                  ? "bg-blue-600 text-white shadow-md"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Card List */}
      <div className="px-5 space-y-3">
        {filteredApprovals.length === 0 ? (
          <p className="text-gray-500 text-center py-12 text-sm">No items found</p>
        ) : (
          filteredApprovals.map((item) => (
            <ApprovalCard
              key={item.id}
              item={item}
              onClick={() => setSelectedItem(item)}
            />
          ))
        )}
      </div>

      {/* FAB */}
      <button
        className="fixed bottom-24 right-5 flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold pl-4 pr-5 py-3.5 shadow-lg transition-colors"
        style={{ borderRadius: 50, boxShadow: "0 4px 20px rgba(37,99,235,0.4)" }}
      >
        <span className="text-lg">✏️</span>
        <span className="text-sm">Request</span>
      </button>

      {/* Bottom Nav */}
      <nav
        className="fixed bottom-0 left-0 right-0 flex items-center justify-around py-3 px-4 border-t"
        style={{
          background: "#0b1121",
          borderColor: "rgba(255,255,255,0.06)",
        }}
      >
        {[
          { label: "Home", icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1", active: false },
          { label: "Tasks", icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4", active: true },
          { label: "Chat", icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z", active: false },
          { label: "Profile", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z", active: false },
        ].map((nav) => (
          <button
            key={nav.label}
            className={`flex flex-col items-center gap-1 px-4 py-1 rounded-full transition-colors ${
              nav.active ? "bg-blue-600/15" : ""
            }`}
          >
            <svg
              className={`w-6 h-6 ${nav.active ? "text-blue-500" : "text-gray-500"}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d={nav.icon} />
            </svg>
            <span className={`text-[10px] font-medium ${nav.active ? "text-blue-500" : "text-gray-500"}`}>
              {nav.label}
            </span>
          </button>
        ))}
      </nav>

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
