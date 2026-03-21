# CURSOR PROMPT: Overview Page V2 — UI/UX Improvements

> **IMPORTANT**: Read `DEV-AGENT-GUIDE.md` in the project root FIRST before making any changes. This project uses **vanilla JS** (NOT React/Next.js), Express backend, and JSON file storage.

---

## TECH STACK REALITY CHECK

- **Frontend**: `public/agency.js` (~8000+ lines vanilla JS) + `public/agency.html`
- **Backend**: `server/src/` with TypeScript → compiled to `server/dist/`
- **NO React, NO Tailwind, NO Supabase** — all styling is inline CSS in JS strings
- **Cache busting**: Every change to `agency.js` requires incrementing `?v=XX` in `agency.html`
- **Build step**: `cd server && npm run build` after any server changes
- **Pattern**: HTML built via string concatenation, events bound after `innerHTML` assignment

---

## ANALYSIS OF CURRENT OVERVIEW PAGE PROBLEMS

### 1. KPI Strip
**Problem**: All numbers are same blue color. No urgency signal. Not clickable.
**Fix**: Color-code by severity (green=0/good, orange=warning, red=critical). Make each KPI clickable to jump to the relevant tab.

### 2. AI Summary Card
**Problem**: Dense paragraph — not scannable in under 5 seconds. No links to referenced items. No visual severity.
**Fix**: Restructure as bullet points with severity icons. Make each line clickable to navigate to the relevant section. Add collapse/expand.

### 3. AI Ideas Card
**Problem**: Takes premium viewport space. Ideas are read-only with no action path.
**Fix**: Make collapsible (collapsed by default). Add "Create Post" button on each idea that opens the approval creation form pre-filled with the idea text.

### 4. Important Links Card
**Problem**: Shows empty "+ Add Links" box wasting space when no links saved.
**Fix**: When empty, collapse to a single-line "Add links →" prompt. When populated, show as compact icon row with favicons.

### 5. Requests Feed
**Problem**: All items look identical. No priority. No category. Timestamps not relative. No quick actions. "URGENT" text in body has no visual badge.
**Fix**: Auto-detect "urgent/asap/important" keywords and show red badge. Show relative time ("3d ago"). Add inline "Assign" and "Mark Done" quick actions. Limit to 2-line truncation.

### 6. Content Calendar
**Problem**: Tiny month view with only dots. Can't see post titles or status. Not clickable.
**Fix**: Make dates clickable → opens that date in Scheduled Posts tab. Show post count per day as number (not just dot). Color-code: blue=planned, green=published, orange=in-review.

### 7. Designer Tasks Ring
**Problem**: Standalone donut with no task names, no assignees, no deadlines. Disconnected from Production View.
**Fix**: Below the ring, show 3 most recent tasks with status chips and designer initials. Make "View Production" link. Show overdue count in red.

### 8. Tab Bar
**Problem**: No count badges. User must click into each tab to see if anything needs attention.
**Fix**: Add count badges to tabs — "Requests (9)", "Agency Needs (2)", "Approvals (1)".

### 9. Section Order
**Problem**: AI Ideas takes premium space. Requests are buried.
**Fix**: Reorder: KPIs → AI Summary (compact) → Requests + Calendar (side by side) → AI Ideas + Links (bottom, collapsed).

---

## IMPLEMENTATION GUIDE (Step by Step)

### FILES TO MODIFY:
1. `public/agency.js` — the `renderOverviewTab()` function (starts around line 1775)
2. `public/agency.html` — bump cache version `?v=XX`
3. NO server changes needed (all data already available from existing endpoints)

### STEP 1: Make KPI Strip Clickable + Color-Coded

In the KPI strip section of `renderOverviewTab()`, replace the current static KPI rendering.

**Logic for colors:**
```
Scheduled: val >= 7 → green, val >= 3 → orange, val < 3 → red
In Production: val > 0 → blue (neutral info), val === 0 → gray
Awaiting Approval: val === 0 → green, val <= 3 → orange, val > 3 → red
Requests: val === 0 → green, val <= 3 → orange, val > 3 → red
Missing Assets: val === 0 → green, val > 0 → red
```

**Click behavior:**
- Scheduled → `switchTab('scheduled')`
- In Production → `switchToProductionView()`
- Awaiting Approval → `switchTab('approvals')`
- Requests → `switchTab('requests')`
- Missing Assets → `switchTab('needs')`

Each KPI should have `cursor:pointer` and a hover effect (`background:#f8fafc` on hover).

### STEP 2: Add Tab Count Badges

Find the tab rendering code (search for `renderClientsSidebar` or the `.tabs` container in `agency.html`). For each tab button, append a count badge:

```javascript
// Calculate counts from state
var tabCounts = {
  approvals: pendingApprovals.length,
  requests: openRequests.length,
  needs: openNeeds.length,
};
```

Badge style: `display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:9px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;margin-left:4px;`

Only show badge when count > 0.

### STEP 3: Restructure AI Summary as Bullet Points

Currently the AI summary returns a paragraph. Change the system prompt in `server/src/routes/aiCopilot.ts` (the `overview-summary` endpoint) to generate structured bullets:

**New system prompt for summary:**
```
Write 4-5 bullet points summarizing this client's status. Each bullet must start with a severity emoji:
🔴 = needs immediate action
🟡 = needs attention soon
🟢 = on track
Format: [emoji] [one sentence, max 15 words]
Example: 🔴 4 approvals stuck waiting on client for 5+ days
```

On the frontend, render each line as a clickable row. Detect severity from the emoji to set left border color (red/yellow/green).

Add a collapse/expand toggle (collapsed shows first 2 bullets, expanded shows all).

### STEP 4: Improve Requests Feed

In the Requests section of `renderOverviewTab()`:

**a) Auto-detect urgency:**
```javascript
var isUrgent = (r.details || '').toLowerCase().match(/urgent|asap|important|rush|emergency/);
```
If urgent, prepend a red badge: `<span style="padding:1px 6px;border-radius:4px;background:#fecaca;color:#dc2626;font-size:9px;font-weight:800;margin-right:4px;">URGENT</span>`

**b) Relative time:**
Replace `fmtDate(r.createdAt)` with a relative time function:
```javascript
function relativeTime(ts) {
  if (!ts) return '';
  var diff = Date.now() - (typeof ts === 'number' ? ts : new Date(ts).getTime());
  var mins = Math.floor(diff / 60000);
  if (mins < 60) return mins + 'm ago';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  var days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  return Math.floor(days / 7) + 'w ago';
}
```

**c) Quick action buttons:**
Add "Done" button inline on each request row:
```javascript
h += '<button type="button" class="ov-req-done" data-index="' + i + '" style="padding:2px 8px;border-radius:4px;border:1px solid #e2e8f0;background:#fff;color:#475569;font-size:10px;font-weight:600;cursor:pointer;flex-shrink:0;">Done</button>';
```
Wire the click to mark the request as done and re-render.

### STEP 5: Improve Content Calendar

**a) Show post count as number (not just dot):**
When a day has posts, show the count number instead of a dot:
```javascript
if (count === 1) dotHtml = '<div style="width:4px;height:4px;border-radius:50%;background:#2563eb;margin:1px auto 0;"></div>';
else if (count > 1) dotHtml = '<div style="font-size:7px;color:#2563eb;font-weight:900;line-height:1;">' + count + '</div>';
```

**b) Make days clickable:**
Wrap each day cell in a clickable div. On click, switch to the Scheduled Posts tab and set a date filter:
```javascript
h += '<div data-date="' + dateKey + '" class="ov-cal-day" style="cursor:pointer;" ...>';
```
```javascript
overviewContent.querySelectorAll('.ov-cal-day').forEach(function(day) {
  day.addEventListener('click', function() {
    var date = day.getAttribute('data-date');
    // Store date for filter, then switch tab
    window.__scheduledFilterDate = date;
    switchTab('scheduled');
  });
});
```

### STEP 6: Improve Designer Tasks Section

Below the donut ring, add a compact task list:

```javascript
// Get 3 most recent non-completed tasks
var recentTasks = prodTasks.filter(function(t) {
  return t.status !== 'approved' && t.status !== 'ready_to_post';
}).slice(0, 3);

recentTasks.forEach(function(t) {
  var statusColors = {
    assigned: { bg: '#f1f5f9', color: '#475569', label: 'Assigned' },
    in_progress: { bg: '#dbeafe', color: '#1d4ed8', label: 'Working' },
    review: { bg: '#fef3c7', color: '#d97706', label: 'Review' },
    changes_requested: { bg: '#fee2e2', color: '#dc2626', label: 'Changes' },
  };
  var sc = statusColors[t.status] || statusColors.assigned;
  h += '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f8fafc;">';
  h += '<span style="padding:2px 6px;border-radius:4px;background:' + sc.bg + ';color:' + sc.color + ';font-size:9px;font-weight:700;">' + sc.label + '</span>';
  h += '<span style="font-size:11px;color:#0f172a;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (t.title || 'Task').replace(/</g, '&lt;').substring(0, 25) + '</span>';
  h += '</div>';
});
```

Add a "View Production →" link button at the bottom that calls `switchToProductionView()`.

### STEP 7: Reorder Sections + Tighten Spacing

New layout order:
1. **KPI Strip** (clickable, color-coded)
2. **Row 2**: AI Summary (compact/collapsible) | Important Links (compact) — 2 columns
3. **Row 3**: Requests (with urgency) | Content Calendar | Designer Ring+Tasks — 3 columns
4. **Row 4** (below fold): AI Ideas (collapsible, collapsed by default)

Reduce `margin-bottom` from `18px` to `12px` between sections.
Reduce card `padding` from `16px` to `12px 14px`.
Reduce `gap` from `14px` to `10px`.
This fits more content above the fold.

### STEP 8: AI Ideas — Add "Create Post" Button

On each AI idea bullet, add a button that opens the approval creation form with the idea text pre-filled:

```javascript
h += '<button type="button" class="ov-create-from-idea" data-text="' + ideaText.replace(/"/g, '&quot;') + '" style="padding:3px 8px;border-radius:4px;border:1px solid #e2e8f0;background:#fff;color:#1e40af;font-size:10px;font-weight:600;cursor:pointer;margin-left:auto;">Create Post</button>';
```

Wire click to:
```javascript
overviewContent.querySelectorAll('.ov-create-from-idea').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var text = btn.getAttribute('data-text');
    switchTab('approvals');
    // After tab switch, pre-fill the form
    setTimeout(function() {
      var captionField = document.getElementById('approvalCaption') || document.getElementById('approvalCopyText');
      if (captionField) captionField.value = text;
    }, 200);
  });
});
```

---

## CRITICAL REMINDERS

1. **Cache busting**: After editing `agency.js`, ALWAYS increment `?v=XX` in `agency.html`
2. **No React/JSX**: All code is vanilla JS string concatenation
3. **Event binding**: Attach events AFTER `innerHTML` is set (not inline, except for hover effects)
4. **Test locally**: The agency dashboard is at `/agency` route
5. **Build server**: If you touch any file in `server/src/`, run `cd server && npm run build`
6. **Push = deploy**: Pushing to `main` triggers Vercel deploy (frontend) and Railway deploy (API)

---

## COLOR REFERENCE

| Purpose | Color | Hex |
|---------|-------|-----|
| Primary blue | — | #1e40af |
| Success/green | — | #059669 |
| Warning/orange | — | #d97706 |
| Error/red | — | #dc2626 |
| Purple accent | — | #7c3aed |
| Text primary | — | #0f172a |
| Text secondary | — | #64748b |
| Text muted | — | #94a3b8 |
| Border | — | #e2e8f0 |
| Background | — | #f8fafc |
| Card | — | #ffffff |

---

## FONT & SPACING SYSTEM

- Font: Montserrat (Google Fonts, already loaded)
- Section title: 13px, font-weight 800, color #0f172a
- Body text: 12-13px, font-weight 400-500
- Small labels: 10-11px, font-weight 700, uppercase, letter-spacing 0.5px
- Card border-radius: 12-14px
- Card padding: 12px 14px (compact) or 14px 16px (standard)
- Section gap: 10-12px
- Mobile breakpoint: 768px
