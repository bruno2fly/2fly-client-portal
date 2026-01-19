import React from "react";
import { ApprovalItem } from "../../lib/approvalsStore";

interface ApprovalCardProps {
  item: ApprovalItem;
  onClick: () => void;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({ item, onClick }) => {
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

  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between gap-4 p-4 rounded-xl bg-white shadow-sm hover:shadow-md transition-all cursor-pointer group"
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-2">
          <h3 className="text-base font-semibold text-blue-900">{item.title}</h3>
          <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
            {getTypeLabel()}
          </span>
        </div>
        <p className="text-sm text-gray-600">Due {item.dueDate}</p>
      </div>
      
      <div className="flex items-center gap-3">
        <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getStatusColor()}`}>
          {item.status === "pending" ? "Pending" : item.status === "changes" ? "Changes Requested" : "Approved"}
        </span>
        <svg
          className="w-5 h-5 text-blue-600 transition-transform group-hover:translate-x-1"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.5}
            d="M5 12h14M12 5l7 7-7 7"
          />
        </svg>
      </div>
    </div>
  );
};

