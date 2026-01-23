/**
 * Approvals Store
 * Manages approval items in localStorage
 */

export type ApprovalType = "post" | "story" | "reel";
export type ApprovalStatus = "pending" | "changes" | "approved";

export interface ApprovalItem {
  id: string;
  title: string;
  type: ApprovalType;
  description: string;
  imageUrl: string;
  dueDate: string;
  status: ApprovalStatus;
  tags?: string[];
  changeNotes?: Array<{
    when: number;
    note: string;
  }>;
}

const STORAGE_KEY = "approvals_v1";

/**
 * Load all approvals from localStorage
 */
function loadApprovals(): ApprovalItem[] {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) {
    // Return seed data if no stored data exists
    return getSeedData();
  }
  try {
    return JSON.parse(stored);
  } catch {
    return getSeedData();
  }
}

/**
 * Save approvals to localStorage
 */
function saveApprovals(approvals: ApprovalItem[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(approvals));
}

/**
 * Seed data for development
 */
function getSeedData(): ApprovalItem[] {
  return [
    {
      id: "ap1",
      title: "Weekend Promo",
      type: "reel",
      description: "Promotional reel for weekend special offers and featured items.",
      imageUrl: "https://via.placeholder.com/600x400/2563eb/ffffff?text=Weekend+Promo+Reel",
      dueDate: "2025-11-04",
      status: "pending",
      tags: ["Promo", "Video"],
    },
    {
      id: "ap2",
      title: "New Arrivals (x5)",
      type: "story",
      description: "Story set showcasing 5 new product arrivals with product shots and details.",
      imageUrl: "https://via.placeholder.com/600x400/2563eb/ffffff?text=New+Arrivals+Story",
      dueDate: "2025-11-05",
      status: "pending",
      tags: ["Stories", "Product"],
    },
    {
      id: "ap3",
      title: "Chef's Special",
      type: "post",
      description: "Featured post highlighting the chef's special dish of the week with beautiful food photography.",
      imageUrl: "https://via.placeholder.com/600x400/2563eb/ffffff?text=Chef%27s+Special+Post",
      dueDate: "2025-11-06",
      status: "pending",
      tags: ["Feed", "Food"],
    },
    {
      id: "ap4",
      title: "Summer Collection Launch",
      type: "reel",
      description: "Launch reel for the new summer collection featuring models and lifestyle shots.",
      imageUrl: "https://via.placeholder.com/600x400/2563eb/ffffff?text=Summer+Collection",
      dueDate: "2025-11-07",
      status: "pending",
      tags: ["Promo", "Launch"],
    },
  ];
}

/**
 * Get all approval items
 */
export function getAllApprovals(): ApprovalItem[] {
  return loadApprovals();
}

/**
 * Get a specific approval item by ID
 */
export function getApprovalItem(id: string): ApprovalItem | null {
  const approvals = loadApprovals();
  return approvals.find((item) => item.id === id) || null;
}

/**
 * Approve an item
 */
export function approveItem(id: string): void {
  const approvals = loadApprovals();
  const item = approvals.find((a) => a.id === id);
  if (item) {
    item.status = "approved";
    saveApprovals(approvals);
    
    // Trigger storage event for cross-tab sync
    window.dispatchEvent(new Event("storage"));
  }
}

/**
 * Request changes for an item
 */
export function requestChanges(id: string, message: string): void {
  const approvals = loadApprovals();
  const item = approvals.find((a) => a.id === id);
  if (item) {
    item.status = "changes";
    item.changeNotes = item.changeNotes || [];
    item.changeNotes.push({
      when: Date.now(),
      note: message,
    });
    saveApprovals(approvals);
    
    // Trigger storage event for cross-tab sync
    window.dispatchEvent(new Event("storage"));
  }
}

/**
 * Get approvals by status
 */
export function getApprovalsByStatus(status: ApprovalStatus): ApprovalItem[] {
  return loadApprovals().filter((item) => item.status === status);
}

/**
 * Reset approvals to seed data (useful for development)
 */
export function resetApprovals(): void {
  saveApprovals(getSeedData());
}

