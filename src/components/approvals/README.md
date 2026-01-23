# Approval Components

Reusable React components for managing approval items in the 2Fly Client Portal.

## Components

### ApprovalCard
Clickable card component that displays approval item information.

**Props:**
```typescript
interface ApprovalCardProps {
  item: ApprovalItem;
  onClick: () => void;
}
```

**Usage:**
```tsx
<ApprovalCard 
  item={approvalItem} 
  onClick={() => setSelectedItem(approvalItem)} 
/>
```

### ApprovalModal
Modal component for viewing and approving/rejecting items.

**Props:**
```typescript
interface ApprovalModalProps {
  open: boolean;
  onClose: () => void;
  item: ApprovalItem | null;
  onApprove?: () => void;
  onRequestChanges?: () => void;
}
```

**Usage:**
```tsx
<ApprovalModal
  open={!!selectedItem}
  item={selectedItem}
  onClose={() => setSelectedItem(null)}
  onApprove={() => {
    // Handle approval
    refreshApprovals();
  }}
  onRequestChanges={() => {
    // Handle changes requested
    refreshApprovals();
  }}
/>
```

## Store Functions

### `getAllApprovals(): ApprovalItem[]`
Get all approval items from localStorage.

### `getApprovalItem(id: string): ApprovalItem | null`
Get a specific approval item by ID.

### `approveItem(id: string): void`
Approve an item. Updates status to "approved" and saves to localStorage.

### `requestChanges(id: string, message: string): void`
Request changes for an item. Updates status to "changes", adds note, and saves to localStorage.

### `getApprovalsByStatus(status: ApprovalStatus): ApprovalItem[]`
Get all approvals filtered by status.

## Example Integration

See `ApprovalQueueExample.tsx` for a complete example of how to integrate these components.

## Storage

Approvals are stored in localStorage with key: `approvals_v1`

To reset approvals to seed data:
```typescript
import { resetApprovals } from '../../lib/approvalsStore';
resetApprovals();
```

## Types

```typescript
type ApprovalType = "post" | "story" | "reel";
type ApprovalStatus = "pending" | "changes" | "approved";

interface ApprovalItem {
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
```

