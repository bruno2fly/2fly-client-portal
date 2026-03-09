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
        return "bg-green-50 text-green-700";
      case "changes":
        return "bg-orange-50 text-orange-700";
      case "pending":
      default:
        return "bg-blue-50 text-blue-700";
    }
  };

  return (
    <div
      onClick={onClick}
      className="flex items-center justify-between gap-4 px-5 py-4 bg-white shadow-[0_1px_8px_rgba(0,0,0,0.06)] hover:shadow-[0_4px_16px_rgba(0,0,0,0.10)] transition-all cursor-pointer group"
      style={{ borderRadius: 18 }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5 mb-1.5">
          <h3 className="text-[15px] font-bold text-gray-900 truncate">{item.title}</h3>
          <span className="shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-gray-100 text-gray-500 tracking-wide uppercase">
            {getTypeLabel()}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-[13px] text-gray-400">Due {item.dueDate}</p>
          {item.status !== "pending" && (
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${getStatusColor()}`}>
              {item.status === "changes" ? "Changes" : "Approved"}
            </span>
          )}
        </div>
      </div>
      
      <svg
        className="w-5 h-5 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-blue-500 shrink-0"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 5l7 7-7 7"
        />
      </svg>
    </div>
  );
};
