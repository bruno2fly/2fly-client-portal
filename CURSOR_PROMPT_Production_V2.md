# CURSOR PROMPT: Production View V2 — Full UI/UX Overhaul

> **CRITICAL**: Read `DEV-AGENT-GUIDE.md` first. This project uses **vanilla JS** (NOT React/Next.js/Tailwind). All code is in `public/agency.js` as string concatenation. No npm UI libraries.

---

## TECH STACK REALITY

- **Frontend**: `public/agency.js` (~8500+ lines vanilla JS) + `public/agency.html`
- **Backend**: `server/src/` TypeScript → compiled to `server/dist/`
- **NO React, NO Tailwind, NO Supabase** — inline CSS in JS strings
- **Cache bust**: Increment `?v=XX` in `agency.html` after every `agency.js` change
- **Server build**: `cd server && npm run build` after server changes
- **Pattern**: HTML via string concatenation, events bound AFTER `innerHTML`

---

## KEY CODE LOCATIONS IN agency.js

| What | Line | Function |
|------|------|----------|
| Production view entry | ~7229 | `renderProductionView()` |
| Status configs | ~7141-7159 | `DESIGNER_STATUS_CONFIG`, `PRODUCTION_STATUS_CONFIG` |
| Priority colors | ~7150 | `PRIORITY_COLORS` |
| Designer focus card | ~7426 | `dvFocusCard()` |
| Designer task row | ~7379 | `dvTaskRow()` |
| Agency table view | ~7906 | Table rendering block |
| Agency kanban view | ~8098 | `renderProductionKanbanView()` |
| Toolbar | ~7826 | Search, filters, view toggle |
| Stats strip | ~7882 | Status count chips |
| Event binding | ~7997 | All click handlers |
| SendToDesigner modal | ~8157 | Task creation form |

**Global State Variables:**
- `demandViewMode`: `'table'` or `'kanban'`
- `productionTasksCache`: Array of all tasks
- `productionFiltersOpen`: Boolean
- `demandFilterStatus/Client/Assignee/DueToday`: Filter values
- `productionCollapsedClients`: Map of collapsed groups
- `productionSortCol` / `productionSortDir`: Sort state

---

## IMPROVEMENTS — IMPLEMENT IN ORDER

### STEP 1: Make Status Strip Clickable + Add Urgency Pulse

**Location**: Status strip rendering (~line 7882)

**Current**: Static text chips. Not clickable. Overdue is same visual weight as everything else.

**Change**: Wrap each status chip in a clickable button. On click, set `demandFilterStatus` and re-render. Add CSS pulse animation on Overdue chip.

```javascript
// Replace static chip with clickable button
html += '<button type="button" class="pv-stat-chip pv-stat-filter" data-status="' + k + '" style="cursor:pointer;border:none;background:transparent;padding:4px 8px;border-radius:6px;' + (demandFilterStatus === k ? 'background:#e2e8f0;' : '') + '">';
html += '<span class="pv-stat-dot" style="background:' + cfg.dotColor + ';"></span> ';
html += statCounts[k] + ' <span style="color:#94a3b8;font-weight:400;">' + cfg.short + '</span>';
html += '</button>';
```

For Overdue chip, add pulsing red glow:
```javascript
if (statsOverdue > 0) {
  html += '<button class="pv-stat-chip pv-stat-filter pv-stat-chip--alert" data-status="overdue" style="animation:pulseRed 2s ease-in-out infinite;cursor:pointer;border:none;background:transparent;">';
  html += '<span class="pv-stat-dot" style="background:#ef4444;"></span> ';
  html += statsOverdue + ' <span style="font-weight:600;color:#dc2626;">Overdue</span></button>';
}
```

Merge "Due Today" into the strip (remove it from toolbar):
```javascript
if (statsDueToday > 0) {
  html += '<button class="pv-stat-chip pv-stat-filter" data-status="duetoday" style="cursor:pointer;border:none;background:transparent;">';
  html += '<span class="pv-stat-dot" style="background:#f59e0b;"></span> ';
  html += statsDueToday + ' <span style="color:#d97706;font-weight:600;">Due Today</span></button>';
}
```

**Event binding** (add after existing binding block):
```javascript
container.querySelectorAll('.pv-stat-filter').forEach(function(btn) {
  btn.addEventListener('click', function() {
    var status = btn.getAttribute('data-status');
    if (status === 'overdue') { demandFilterDueToday = false; /* custom overdue filter */ }
    else if (status === 'duetoday') { demandFilterDueToday = !demandFilterDueToday; demandFilterStatus = ''; }
    else { demandFilterStatus = demandFilterStatus === status ? '' : status; demandFilterDueToday = false; }
    renderProductionView();
  });
});
```

**Add CSS animation** in `agency.html` `<style>` block:
```css
@keyframes pulseRed {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239,68,68,0); }
  50% { box-shadow: 0 0 0 6px rgba(239,68,68,0.15); border-radius: 8px; }
}
```

---

### STEP 2: Table View — Inline Status Dropdown

**Location**: Table row status column (~line 7977)

**Current**: Status badge is a static colored pill. Must open task to change status.

**Change**: Make the status badge a clickable dropdown. On click, show a small popup with all status options. Clicking an option calls the API to update status.

Replace the status `<td>` with:
```javascript
html += '<td style="padding:12px 16px 12px 0;width:140px;position:relative;">';
html += '<button type="button" class="pv-status-badge pv-inline-status" data-task-id="' + t.id + '" data-current="' + t.status + '" style="cursor:pointer;border:none;background:' + cfg.bgColor + ';color:' + cfg.textColor + ';border:1px solid ' + cfg.borderColor + ';padding:4px 10px;border-radius:9999px;font-size:12px;font-weight:600;display:inline-flex;align-items:center;gap:4px;">';
html += '<span style="font-size:10px;">' + cfg.icon + '</span> ' + cfg.label;
html += ' <span style="font-size:9px;opacity:0.5;">▾</span></button>';
html += '</td>';
```

**Dropdown popup function** (add before `renderProductionView`):
```javascript
function showInlineStatusDropdown(btn) {
  // Remove any existing dropdown
  var existing = document.querySelector('.pv-status-dropdown');
  if (existing) existing.remove();

  var taskId = btn.getAttribute('data-task-id');
  var current = btn.getAttribute('data-current');
  var rect = btn.getBoundingClientRect();

  var dropdown = document.createElement('div');
  dropdown.className = 'pv-status-dropdown';
  dropdown.style.cssText = 'position:fixed;top:' + (rect.bottom + 4) + 'px;left:' + rect.left + 'px;background:#fff;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,0.15);border:1px solid #e2e8f0;padding:4px;z-index:9999;min-width:160px;';

  var statuses = ['assigned','in_progress','review','changes_requested','approved','ready_to_post'];
  statuses.forEach(function(s) {
    var cfg = PRODUCTION_STATUS_CONFIG[s];
    var isActive = s === current;
    var item = document.createElement('button');
    item.style.cssText = 'display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border:none;background:' + (isActive ? cfg.bgColor : 'transparent') + ';border-radius:6px;cursor:pointer;font-size:12px;color:' + cfg.textColor + ';font-weight:' + (isActive ? '700' : '500') + ';';
    item.innerHTML = '<span style="font-size:10px;">' + cfg.icon + '</span> ' + cfg.label;
    item.addEventListener('click', function() {
      dropdown.remove();
      if (s === current) return;
      // Call API to update status
      fetch(getApiBaseUrl() + '/api/production/tasks/' + taskId + '/status', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: s })
      }).then(function(r) { return r.json(); })
        .then(function() { return loadProductionTasks(); })
        .then(function() { renderProductionView(); showToast('Status updated', 'success'); })
        .catch(function(e) { showToast(e.message || 'Failed', 'error'); });
    });
    dropdown.appendChild(item);
  });

  document.body.appendChild(dropdown);
  // Close on outside click
  setTimeout(function() {
    document.addEventListener('click', function closeDropdown(e) {
      if (!dropdown.contains(e.target) && e.target !== btn) {
        dropdown.remove();
        document.removeEventListener('click', closeDropdown);
      }
    });
  }, 10);
}
```

**Event binding**:
```javascript
container.querySelectorAll('.pv-inline-status').forEach(function(btn) {
  btn.addEventListener('click', function(e) {
    e.stopPropagation(); // Don't open task workspace
    showInlineStatusDropdown(btn);
  });
});
```

---

### STEP 3: Table View — Relative Time for Dates

**Location**: Timeline column (~line 7970)

**Current**: Shows "Mar 18" with "LATE" or "TODAY" badge. No relative context.

**Change**: Show relative time: "2d overdue" (red), "Due today" (amber), "In 3 days" (gray).

```javascript
// Replace the deadline label logic
var deadlineLabel = '—';
var dueClass = 'pv-due--future';
if (dueDate) {
  var diffDays = Math.round((dueDate.getTime() - new Date().setHours(0,0,0,0)) / 86400000);
  if (diffDays < -1) { deadlineLabel = Math.abs(diffDays) + 'd overdue'; dueClass = 'pv-due--overdue'; }
  else if (diffDays === -1) { deadlineLabel = 'Yesterday'; dueClass = 'pv-due--overdue'; }
  else if (diffDays === 0) { deadlineLabel = 'Due today'; dueClass = 'pv-due--today'; }
  else if (diffDays === 1) { deadlineLabel = 'Tomorrow'; dueClass = 'pv-due--future'; }
  else if (diffDays <= 7) { deadlineLabel = 'In ' + diffDays + ' days'; dueClass = 'pv-due--future'; }
  else { deadlineLabel = dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); dueClass = 'pv-due--future'; }
}
```

Remove the separate "LATE" and "TODAY" badge elements — the relative text already conveys this.

---

### STEP 4: Table View — Client Group Progress Bar

**Location**: Group header rendering (~line 7935)

**Current**: Shows "Ardan Spa — 7 tasks" with status dots.

**Change**: Add a mini progress bar showing completion ratio.

```javascript
// After the task count span, add progress bar
var doneCount = group.tasks.filter(function(t) { return t.status === 'approved' || t.status === 'ready_to_post'; }).length;
var totalCount = group.tasks.length;
var pctDone = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

html += '<div style="display:flex;align-items:center;gap:6px;margin-left:auto;">';
html += '<div style="width:60px;height:4px;border-radius:2px;background:#e2e8f0;overflow:hidden;">';
html += '<div style="width:' + pctDone + '%;height:100%;border-radius:2px;background:' + (pctDone === 100 ? '#059669' : '#3b82f6') + ';"></div></div>';
html += '<span style="font-size:10px;color:#94a3b8;font-weight:600;">' + doneCount + '/' + totalCount + '</span>';
html += '</div>';
```

---

### STEP 5: Kanban View — Drag and Drop

**Location**: `renderProductionKanbanView()` (~line 8098)

**Current**: Cards are NOT draggable. Click only opens workspace.

**Change**: Make cards draggable between columns using native HTML5 drag-drop (no library needed in vanilla JS).

**On each card**, add:
```javascript
html += '<div class="kanban-card" draggable="true" data-task-id="' + t.id + '" data-status="' + t.status + '" ...>';
```

**On each column**, add drop zone attributes:
```javascript
html += '<div class="kanban-column" data-column-status="' + col + '" style="...; min-height:100px;">';
```

**Event binding** (add to kanban section):
```javascript
// Drag start
container.querySelectorAll('.kanban-card[draggable]').forEach(function(card) {
  card.addEventListener('dragstart', function(e) {
    e.dataTransfer.setData('text/plain', card.getAttribute('data-task-id'));
    card.style.opacity = '0.5';
    // Highlight all columns
    container.querySelectorAll('.kanban-column').forEach(function(col) {
      col.style.outline = '2px dashed #93c5fd';
      col.style.outlineOffset = '-2px';
    });
  });
  card.addEventListener('dragend', function() {
    card.style.opacity = '1';
    container.querySelectorAll('.kanban-column').forEach(function(col) {
      col.style.outline = 'none';
      col.style.background = '';
    });
  });
});

// Drop zones
container.querySelectorAll('.kanban-column').forEach(function(col) {
  col.addEventListener('dragover', function(e) {
    e.preventDefault();
    col.style.background = '#eff6ff';
  });
  col.addEventListener('dragleave', function() {
    col.style.background = '';
  });
  col.addEventListener('drop', function(e) {
    e.preventDefault();
    col.style.background = '';
    col.style.outline = 'none';
    var taskId = e.dataTransfer.getData('text/plain');
    var newStatus = col.getAttribute('data-column-status');
    if (!taskId || !newStatus) return;
    // Update via API
    fetch(getApiBaseUrl() + '/api/production/tasks/' + taskId + '/status', {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    }).then(function(r) { return r.json(); })
      .then(function() { return loadProductionTasks(); })
      .then(function() { renderProductionView(); showToast('Task moved to ' + newStatus.replace(/_/g, ' '), 'success'); })
      .catch(function(e) { showToast(e.message || 'Failed to move task', 'error'); });
  });
});
```

---

### STEP 6: Kanban View — Overdue Card Styling

**Location**: Card rendering in `renderProductionKanbanView()` (~line 8114)

**Current**: Overdue cards look identical to on-time cards.

**Change**: Add red left border and "X days late" badge on overdue cards.

```javascript
var isOverdue = t.deadline && t.deadline < todayStr && ['approved','ready_to_post'].indexOf(t.status) === -1;
var overdueDays = 0;
if (isOverdue) {
  overdueDays = Math.round((new Date().getTime() - new Date(t.deadline).getTime()) / 86400000);
}

// In card HTML
html += '<div class="kanban-card" ... style="...;' + (isOverdue ? 'border-left:3px solid #ef4444;' : '') + '">';
if (isOverdue) {
  html += '<div style="display:inline-flex;align-items:center;gap:3px;padding:2px 6px;border-radius:4px;background:#fef2f2;color:#dc2626;font-size:9px;font-weight:700;margin-bottom:4px;">' + overdueDays + 'd late</div>';
}
```

---

### STEP 7: Tab Count Badges

**Location**: Tab rendering in `agency.html` (the `.tabs` container, ~line 1924)

**Current**: Tabs show plain text: "Requests", "Agency Needs"

**Change**: Add badge counts. This needs to happen in the tab rendering JS, not HTML.

Find where tabs are rendered/updated. In `renderAll()` or wherever tab buttons get their text, append counts:

```javascript
// After renderAll or switchTab, update tab badges
function updateTabBadges() {
  var state = load();
  var pendingApprovals = (state.approvals || []).filter(function(a) { return !a.status || a.status === 'pending' || a.status === 'changes'; }).length;
  var openRequests = (state.requests || []).filter(function(r) { return !r.done; }).length;
  var openNeeds = (state.needs || []).filter(function(n) { return !n.done; }).length;

  var badges = { approvals: pendingApprovals, requests: openRequests, needs: openNeeds };
  document.querySelectorAll('.tab[data-tab]').forEach(function(tab) {
    var tabName = tab.getAttribute('data-tab');
    var existingBadge = tab.querySelector('.tab-badge');
    if (existingBadge) existingBadge.remove();
    var count = badges[tabName] || 0;
    if (count > 0) {
      var badge = document.createElement('span');
      badge.className = 'tab-badge';
      badge.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;border-radius:9px;background:#ef4444;color:#fff;font-size:10px;font-weight:700;margin-left:6px;padding:0 5px;';
      badge.textContent = count;
      tab.appendChild(badge);
    }
  });
}
```

Call `updateTabBadges()` at the end of `renderAll()` and after any state change.

---

### STEP 8: Task Detail Side Panel (Drawer)

**Current**: Clicking a task navigates away from the board to a workspace view.

**Change**: Add a slide-out drawer from the right side that shows task details without leaving the board.

```javascript
function openTaskDrawer(taskId) {
  var existing = document.getElementById('taskDrawer');
  if (existing) existing.remove();

  var task = productionTasksCache.find(function(t) { return t.id === taskId; });
  if (!task) return;

  var clients = loadClientsRegistry();
  var clientName = (clients[task.clientId] && clients[task.clientId].name) || '';
  var cfg = PRODUCTION_STATUS_CONFIG[task.status] || PRODUCTION_STATUS_CONFIG.assigned;

  var overlay = document.createElement('div');
  overlay.id = 'taskDrawer';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:9998;display:flex;justify-content:flex-end;';

  // Backdrop
  var backdrop = document.createElement('div');
  backdrop.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.3);';
  backdrop.addEventListener('click', function() { overlay.remove(); });
  overlay.appendChild(backdrop);

  // Drawer panel
  var drawer = document.createElement('div');
  drawer.style.cssText = 'position:relative;width:480px;max-width:90vw;height:100%;background:#fff;box-shadow:-8px 0 30px rgba(0,0,0,0.1);overflow-y:auto;animation:slideInRight 0.2s ease-out;';

  var h = '';
  h += '<div style="padding:20px 24px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;">';
  h += '<div>';
  h += '<div style="font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;">' + clientName.replace(/</g, '&lt;') + '</div>';
  h += '<div style="font-size:18px;font-weight:700;color:#0f172a;margin-top:2px;">' + (task.title || task.caption || 'Task').replace(/</g, '&lt;') + '</div>';
  h += '</div>';
  h += '<button id="drawerClose" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:24px;padding:4px;">&times;</button></div>';

  // Status + Priority + Deadline
  h += '<div style="padding:16px 24px;display:flex;gap:8px;flex-wrap:wrap;">';
  h += '<span style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:' + cfg.bgColor + ';color:' + cfg.textColor + ';border:1px solid ' + cfg.borderColor + ';">' + cfg.icon + ' ' + cfg.label + '</span>';
  h += '<span style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:#f1f5f9;color:#475569;">' + (task.priority || 'medium') + '</span>';
  if (task.deadline) h += '<span style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;background:#f1f5f9;color:#475569;">Due ' + task.deadline + '</span>';
  h += '</div>';

  // Caption / Copy
  if (task.caption || task.copyText) {
    h += '<div style="padding:0 24px 16px;"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px;">CAPTION</div>';
    h += '<div style="font-size:13px;color:#0f172a;line-height:1.5;background:#f8fafc;padding:12px;border-radius:8px;">' + (task.caption || task.copyText || '').replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div></div>';
  }

  // Final Art
  if (task.finalArt && task.finalArt.length > 0) {
    h += '<div style="padding:0 24px 16px;"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px;">DESIGN (' + task.finalArt.length + ')</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:8px;">';
    task.finalArt.forEach(function(url) {
      h += '<div style="aspect-ratio:1;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;">';
      h += mediaTag(url, 'Art', 'width:100%;height:100%;object-fit:cover;');
      h += '</div>';
    });
    h += '</div></div>';
  }

  // Brief Notes
  if (task.briefNotes) {
    h += '<div style="padding:0 24px 16px;"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:4px;">BRIEF</div>';
    h += '<div style="font-size:13px;color:#475569;line-height:1.5;">' + task.briefNotes.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div></div>';
  }

  // Review Notes
  if (task.reviewNotes) {
    h += '<div style="padding:0 24px 16px;"><div style="font-size:11px;font-weight:700;color:#dc2626;margin-bottom:4px;">REVISION NOTES</div>';
    h += '<div style="font-size:13px;color:#991b1b;line-height:1.5;background:#fef2f2;padding:12px;border-radius:8px;">' + task.reviewNotes.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</div></div>';
  }

  // Comments
  if (task.comments && task.comments.length > 0) {
    h += '<div style="padding:0 24px 16px;"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:8px;">COMMENTS (' + task.comments.length + ')</div>';
    task.comments.forEach(function(c) {
      h += '<div style="padding:8px 0;border-bottom:1px solid #f8fafc;">';
      h += '<div style="font-size:11px;"><strong style="color:#0f172a;">' + (c.authorName || '').replace(/</g, '&lt;') + '</strong> <span style="color:#94a3b8;">· ' + (c.createdAt || '') + '</span></div>';
      h += '<div style="font-size:13px;color:#475569;margin-top:2px;">' + (c.message || '').replace(/</g, '&lt;') + '</div>';
      h += '</div>';
    });
    h += '</div>';
  }

  // Action buttons at bottom
  h += '<div style="padding:16px 24px;border-top:1px solid #e2e8f0;display:flex;gap:8px;">';
  h += '<button type="button" class="drawer-open-full" data-task-id="' + taskId + '" style="flex:1;padding:10px;border-radius:8px;border:none;background:#1e40af;color:#fff;font-size:13px;font-weight:600;cursor:pointer;">Open Full View</button>';
  h += '<button type="button" style="padding:10px 16px;border-radius:8px;border:1px solid #e2e8f0;background:#fff;color:#dc2626;font-size:13px;font-weight:600;cursor:pointer;" onclick="document.getElementById(\'taskDrawer\').remove();">Close</button>';
  h += '</div>';

  drawer.innerHTML = h;
  overlay.appendChild(drawer);
  document.body.appendChild(overlay);

  // Events
  document.getElementById('drawerClose').addEventListener('click', function() { overlay.remove(); });
  overlay.querySelector('.drawer-open-full').addEventListener('click', function() {
    overlay.remove();
    currentProductionTaskId = taskId;
    renderProductionView();
  });

  // Escape key
  function onEsc(e) { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onEsc); } }
  document.addEventListener('keydown', onEsc);
}
```

**Add CSS animation** in `agency.html`:
```css
@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
```

**Wire it up**: In the task row click handler, change from directly opening workspace to opening the drawer:
```javascript
// Replace: currentProductionTaskId = id; renderProductionView();
// With: openTaskDrawer(id);
```

---

### STEP 9: Kanban — Quick Actions on Card Hover

**Location**: Card rendering in kanban view

Add a hover action bar that appears on each card:

```javascript
// Inside each kanban-card div, at the top:
html += '<div class="kanban-card-actions" style="display:none;position:absolute;top:4px;right:4px;background:#fff;border-radius:6px;box-shadow:0 2px 8px rgba(0,0,0,0.1);padding:2px;">';
html += '<button class="kanban-quick-status" data-task-id="' + t.id + '" style="...; font-size:10px;">Status</button>';
html += '<button class="kanban-quick-open" data-task-id="' + t.id + '" style="...; font-size:10px;">Open</button>';
html += '</div>';
```

Show on hover via CSS or JS:
```javascript
container.querySelectorAll('.kanban-card').forEach(function(card) {
  var actions = card.querySelector('.kanban-card-actions');
  if (actions) {
    card.addEventListener('mouseenter', function() { actions.style.display = 'flex'; });
    card.addEventListener('mouseleave', function() { actions.style.display = 'none'; });
  }
});
```

---

### STEP 10: Sidebar — Hide Coming Soon, Add My Tasks

**Location**: `agency.html` sidebar nav (~line 2370)

**Changes**:
- Add `style="opacity:0.4;pointer-events:none;"` to AI Library and References buttons
- Add a "My Tasks" button that filters to current user's tasks:

```html
<button id="productionNavMyTasks" class="production-sidebar__link" data-section="mytasks">
  <!-- user icon -->MY TASKS
</button>
```

Wire it to filter `demandFilterAssignee` to the current user's ID and switch to demands.

---

### STEP 11: Keyboard Shortcuts

Add a global keydown listener (only active when Production View is visible):

```javascript
document.addEventListener('keydown', function(e) {
  if (currentViewMode !== 'production') return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  if (e.key === 'n' || e.key === 'N') { handleAssign(); e.preventDefault(); }
  if (e.key === 'f' || e.key === 'F') { productionFiltersOpen = !productionFiltersOpen; renderProductionView(); e.preventDefault(); }
  if (e.key === 't') { demandViewMode = 'table'; renderProductionView(); e.preventDefault(); }
  if (e.key === 'k') { demandViewMode = 'kanban'; renderProductionView(); e.preventDefault(); }
  if (e.key === '/') { var s = document.getElementById('pvSearchInput'); if (s) { s.focus(); e.preventDefault(); } }
  if (e.key === 'Escape') { var d = document.getElementById('taskDrawer'); if (d) d.remove(); }
});
```

---

## CRITICAL REMINDERS

1. **Cache bust**: Increment `?v=XX` in `agency.html` after EVERY `agency.js` change
2. **No React/JSX**: All vanilla JS string concatenation
3. **Events AFTER innerHTML**: Never attach events before rendering
4. **Build server**: `cd server && npm run build` if touching `server/src/`
5. **Test**: Production view is at `/agency` → click "Production View" toggle
6. **Mobile**: Add `@media(max-width:768px)` overrides for kanban (stack columns vertically)

---

## COLOR REFERENCE

| Status | Dot Color | Badge BG | Badge Text | Border |
|--------|-----------|----------|------------|--------|
| Assigned/To Do | #3b82f6 | #eff6ff | #1d4ed8 | #bfdbfe |
| In Progress | #f59e0b | #fffbeb | #b45309 | #fde68a |
| Review | #8b5cf6 | #f5f3ff | #6d28d9 | #ddd6fe |
| Changes Req | #f97316 | #fff7ed | #c2410c | #fed7aa |
| Approved | #10b981 | #ecfdf5 | #059669 | #a7f3d0 |
| Ready to Post | #14b8a6 | #f0fdfa | #0d9488 | #99f6e4 |
| Overdue | #ef4444 | #fef2f2 | #dc2626 | #fecaca |
| Priority Low | #94a3b8 | | | |
| Priority Medium | #3b82f6 | | | |
| Priority High | #f97316 | | | |
| Priority Urgent | #ef4444 | | | |
