/* ================== State Management ================== */
const LS_KEY = "client_portal_casa_nova_v1";
const LS_REPORTS_KEY = "client_portal_reports_v1";
const TEAM_PIN = "2468";

// Current selected client (for future multi-client support)
let currentClientId = "casa-nova";

function load() {
  const d = localStorage.getItem(LS_KEY);
  if (!d) {
    // Initialize with empty state if doesn't exist
    const empty = {
      client: { id: "casa-nova", name: "CASA NOVA", whatsapp: "" },
      kpis: { scheduled: 0, waitingApproval: 0, missingAssets: 0, frustration: 0 },
      approvals: [],
      needs: [],
      requests: [],
      assets: [],
      activity: [],
      seen: false
    };
    localStorage.setItem(LS_KEY, JSON.stringify(empty));
    return empty;
  }
  try {
    const state = JSON.parse(d);
    // Ensure assets array exists
    if (!Array.isArray(state.assets)) {
      state.assets = [];
      save(state);
    }
    // Migrate completedAt to doneAt for backward compatibility
    let changed = false;
    if (Array.isArray(state.requests)) {
      state.requests.forEach(r => {
        if (r.completedAt && !r.doneAt) {
          r.doneAt = r.completedAt;
          delete r.completedAt;
          changed = true;
        }
        // Ensure createdAt exists for all requests
        if (!r.createdAt) {
          r.createdAt = Date.now();
          changed = true;
        }
      });
    }
    // Ensure needs have status field (migrate old needs to have status: 'open')
    if (Array.isArray(state.needs)) {
      state.needs.forEach(n => {
        if (!n.status) {
          n.status = 'open';
          changed = true;
        }
      });
    }
    if (changed) save(state);
    return state;
  } catch {
    return {
      client: { id: "casa-nova", name: "CASA NOVA", whatsapp: "" },
      kpis: { scheduled: 0, waitingApproval: 0, missingAssets: 0, frustration: 0 },
      approvals: [],
      needs: [],
      requests: [],
      assets: [],
      activity: [],
      seen: false
    };
  }
}

function save(x) {
  localStorage.setItem(LS_KEY, JSON.stringify(x));
}

function loadReports() {
  const raw = localStorage.getItem(LS_REPORTS_KEY);
  if (!raw) {
    const reportSeed = {
      period: "Nov 2025",
      ads: { running: 4, impressions: 48000, clicks: 1200, leads: 35 },
      visibility: { gmbViews: 3800, profileSearches: 1200, websiteClicks: 220, igFollowersDelta: 75 },
      work: { posts: 16, reels: 8, campaigns: 2, requestsResolved: 3 },
      prev: {
        period: "Oct 2025",
        ads: { running: 3, impressions: 42000, clicks: 1100, leads: 31 },
        visibility: { gmbViews: 3220, profileSearches: 1090, websiteClicks: 208, igFollowersDelta: 54 },
        work: { posts: 15, reels: 6, campaigns: 1, requestsResolved: 2 }
      }
    };
    localStorage.setItem(LS_REPORTS_KEY, JSON.stringify(reportSeed));
    return reportSeed;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return {
      period: "Nov 2025",
      ads: { running: 0, impressions: 0, clicks: 0, leads: 0 },
      visibility: { gmbViews: 0, profileSearches: 0, websiteClicks: 0, igFollowersDelta: 0 },
      work: { posts: 0, reels: 0, campaigns: 0, requestsResolved: 0 },
      prev: null
    };
  }
}

function saveReports(r) {
  localStorage.setItem(LS_REPORTS_KEY, JSON.stringify(r));
}

/* ================== Helpers ================== */
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);
const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  });
  kids.forEach(k => node.append(k));
  return node;
};

const fmtDate = ts => new Date(ts).toLocaleString([], { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });

// Calculate scheduled posts (approvals with postDate within next 15 days)
function calculateScheduledPosts(approvals) {
  if (!approvals || !Array.isArray(approvals)) return 0;
  
  const now = new Date();
  const fifteenDaysFromNow = new Date(now);
  fifteenDaysFromNow.setDate(now.getDate() + 15);
  
  return approvals.filter(a => {
    if (!a.postDate) return false;
    const postDate = new Date(a.postDate);
    // Include posts scheduled for today and within the next 15 days
    return postDate >= now && postDate <= fifteenDaysFromNow;
  }).length;
}

/* ================== Client Selection ================== */
function renderClientsSidebar() {
  const state = load();
  const container = $('#clientsList');
  if (!container) return;

  container.innerHTML = '';

  // For now, just show Casa Nova
  const clientTile = el('div', { class: 'client-tile active', 'data-client-id': state.client.id });
  
  const name = el('div', { class: 'client-tile__name' });
  name.textContent = state.client.name;
  
  const badges = el('div', { class: 'client-tile__badges' });
  
  // Calculate counts
  const pendingCount = (state.approvals || []).filter(a => !a.status || a.status === 'pending').length;
  const openRequests = (state.requests || []).filter(r => r.status === 'open').length;
  
  if (state.kpis && state.kpis.scheduled) {
    badges.appendChild(el('div', { class: 'badge' }, `${state.kpis.scheduled} scheduled`));
  }
  badges.appendChild(el('div', { class: 'badge' }, `${pendingCount} pending`));
  badges.appendChild(el('div', { class: 'badge' }, `${openRequests} requests`));
  
  clientTile.appendChild(name);
  clientTile.appendChild(badges);
  
  clientTile.addEventListener('click', () => {
    currentClientId = state.client.id;
    $$('.client-tile').forEach(t => t.classList.remove('active'));
    clientTile.classList.add('active');
    renderAll();
  });
  
  container.appendChild(clientTile);
}

/* ================== Tab Management ================== */
let currentTab = 'overview';

function switchTab(tabName) {
  currentTab = tabName;
  
  // Update tab buttons
  $$('.tab').forEach(tab => {
    if (tab.dataset.tab === tabName) {
      tab.classList.add('active');
    } else {
      tab.classList.remove('active');
    }
  });
  
  // Update tab content
  $$('.tab-content').forEach(content => {
    if (content.id === `tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
  
  // Render appropriate tab
  switch(tabName) {
    case 'overview':
      renderOverviewTab();
      break;
    case 'approvals':
      renderApprovalsTab();
      break;
    case 'requests':
      renderRequestsTab();
      break;
    case 'needs':
      renderNeedsTab();
      break;
    case 'contentlibrary':
      renderContentLibraryTab();
      break;
    case 'reports':
      renderReportsTab();
      break;
  }
}

// Setup tab click handlers
$$('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    switchTab(tab.dataset.tab);
  });
});

/* ================== Overview Tab ================== */
function renderOverviewTab() {
  const state = load();
  
  // Calculate scheduled posts from approvals with postDate within next 15 days
  const scheduledCount = calculateScheduledPosts(state.approvals || []);
  // Update state to keep it in sync
  if (state.kpis) {
    state.kpis.scheduled = scheduledCount;
    save(state);
  }
  
  const kpiScheduled = $('#kpiScheduled');
  if (kpiScheduled) kpiScheduled.textContent = scheduledCount;
  
  const kpiWaiting = $('#kpiWaiting');
  if (kpiWaiting) {
    const pendingCount = (state.approvals || []).filter(a => !a.status || a.status === 'pending').length;
    kpiWaiting.textContent = pendingCount;
  }
  
  const kpiMissing = $('#kpiMissing');
  if (kpiMissing) kpiMissing.textContent = state.kpis?.missingAssets || 0;
  
  const lastActivity = $('#lastActivity');
  if (lastActivity && state.activity && state.activity.length > 0) {
    const latest = state.activity[state.activity.length - 1];
    lastActivity.textContent = `Last portal activity: ${latest.text} (${fmtDate(latest.when)})`;
  } else if (lastActivity) {
    lastActivity.textContent = 'Last portal activity: None';
  }
}

/* ================== Approvals Tab ================== */
let selectedApprovalId = null;

function renderApprovalsTab() {
  const state = load();
  const container = $('#approvalsList');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Group by status
  const pending = (state.approvals || []).filter(a => !a.status || a.status === 'pending');
  const changes = (state.approvals || []).filter(a => a.status === 'changes');
  const approved = (state.approvals || []).filter(a => a.status === 'approved');
  
  function renderSection(title, items, containerEl) {
    if (items.length === 0) return;
    
    const section = el('div', { class: 'approvals-section' });
    const sectionTitle = el('div', { class: 'approvals-section__title' });
    sectionTitle.textContent = `${title} (${items.length})`;
    section.appendChild(sectionTitle);
    
    const list = el('div', { class: 'approvals-list' });
    
    items.forEach(item => {
      const itemEl = el('div', {
        class: `approval-item ${selectedApprovalId === item.id ? 'selected' : ''}`,
        'data-approval-id': item.id
      });
      
      const header = el('div', { class: 'approval-item__header' });
      const titleEl = el('div', { class: 'approval-item__title' });
      titleEl.textContent = item.title;
      header.appendChild(titleEl);
      
      const meta = el('div', { class: 'approval-item__meta' });
      meta.appendChild(el('span', { class: 'chip chip--type' }, item.type || 'Post'));
      meta.appendChild(el('span', {
        class: `chip chip--status-${item.status || 'pending'}`
      }, (item.status || 'pending').charAt(0).toUpperCase() + (item.status || 'pending').slice(1)));
      meta.appendChild(el('span', { class: 'approval-item__date' }, `Due ${item.date || 'N/A'}`));
      
      itemEl.appendChild(header);
      itemEl.appendChild(meta);
      
      itemEl.addEventListener('click', () => {
        selectedApprovalId = item.id;
        $$('.approval-item').forEach(i => i.classList.remove('selected'));
        itemEl.classList.add('selected');
        loadApprovalForEdit(item.id);
      });
      
      list.appendChild(itemEl);
    });
    
    section.appendChild(list);
    containerEl.appendChild(section);
  }
  
  renderSection('Pending', pending, container);
  renderSection('Changes Requested', changes, container);
  renderSection('Approved', approved, container);
  
  if ((state.approvals || []).length === 0) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__text' }, 'No approvals yet. Create one using the form on the right.')
    ));
  }
}

function loadApprovalForEdit(id) {
  const state = load();
  const item = (state.approvals || []).find(a => a.id === id);
  
  if (!item) {
    // Reset form for new item
    $('#approvalForm').reset();
    $('#approvalId').value = '';
    $('#editPanelTitle').textContent = 'Create Approval';
    $('#approvalDelete').style.display = 'none';
    selectedApprovalId = null;
    return;
  }
  
  $('#approvalId').value = item.id;
  $('#approvalTitle').value = item.title || '';
  $('#approvalType').value = item.type || 'Post';
  $('#approvalDate').value = item.date || '';
  $('#approvalPostDate').value = item.postDate || '';
  $('#approvalDescription').value = item.description || '';
  $('#approvalImageUrl').value = item.imageUrl || '';
  $('#approvalCaption').value = item.caption || '';
  $('#approvalInstagramLink').value = item.instagramLink || '';
  $('#approvalStatus').value = item.status || 'pending';
  $('#editPanelTitle').textContent = 'Edit Approval';
  $('#approvalDelete').style.display = 'block';
}

// Approval form handler
const approvalForm = $('#approvalForm');
if (approvalForm) {
  approvalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const state = load();
    const id = $('#approvalId').value;
    
    const postDateValue = $('#approvalPostDate').value.trim();
    const approvalData = {
      id: id || `ap${Date.now()}`,
      title: $('#approvalTitle').value.trim(),
      type: $('#approvalType').value,
      date: $('#approvalDate').value,
      postDate: postDateValue || null,
      description: $('#approvalDescription').value.trim(),
      imageUrl: $('#approvalImageUrl').value.trim() || undefined,
      caption: $('#approvalCaption').value.trim() || undefined,
      instagramLink: $('#approvalInstagramLink').value.trim() || undefined,
      status: $('#approvalStatus').value,
      tags: []
    };
    
    if (!state.approvals) state.approvals = [];
    
    const existingIndex = state.approvals.findIndex(a => a.id === approvalData.id);
    if (existingIndex >= 0) {
      // Update existing - preserve change_notes if they exist
      const existing = state.approvals[existingIndex];
      approvalData.change_notes = existing.change_notes;
      state.approvals[existingIndex] = approvalData;
    } else {
      // Create new
      state.approvals.push(approvalData);
    }
    
    // Update KPIs
    const pendingCount = state.approvals.filter(a => !a.status || a.status === 'pending').length;
    const scheduledCount = calculateScheduledPosts(state.approvals);
    if (state.kpis) {
      state.kpis.waitingApproval = pendingCount;
      state.kpis.scheduled = scheduledCount;
    }
    
    // Log activity
    if (!state.activity) state.activity = [];
    state.activity.push({
      when: Date.now(),
      text: existingIndex >= 0 ? `Updated approval: ${approvalData.title}` : `Created approval: ${approvalData.title}`
    });
    
    save(state);
    renderApprovalsTab();
    renderOverviewTab(); // Update overview to reflect new scheduled count
    
    // Reset form
    approvalForm.reset();
    $('#approvalId').value = '';
    $('#editPanelTitle').textContent = 'Create Approval';
    $('#approvalDelete').style.display = 'none';
    selectedApprovalId = null;
  });
}

const approvalCancel = $('#approvalCancel');
if (approvalCancel) {
  approvalCancel.addEventListener('click', () => {
    approvalForm.reset();
    $('#approvalId').value = '';
    $('#editPanelTitle').textContent = 'Create Approval';
    $('#approvalDelete').style.display = 'none';
    selectedApprovalId = null;
    $$('.approval-item').forEach(i => i.classList.remove('selected'));
  });
}

// Preview button handler
const approvalPreview = $('#approvalPreview');
if (approvalPreview) {
  approvalPreview.addEventListener('click', () => {
    openPreviewModal();
  });
}

// Preview Modal functions
function openPreviewModal() {
  const title = $('#approvalTitle').value.trim() || 'Untitled';
  const imageUrl = $('#approvalImageUrl').value.trim();
  const caption = $('#approvalCaption').value.trim() || 'No caption provided.';
  const instagramLink = $('#approvalInstagramLink').value.trim();
  
  // Set title
  const previewTitle = $('#previewModalTitle');
  if (previewTitle) previewTitle.textContent = title;
  
  // Set image
  const previewImage = $('#previewImage');
  const previewImageContainer = $('#previewImageContainer');
  if (previewImage && previewImageContainer) {
    if (imageUrl) {
      previewImage.src = imageUrl;
      previewImage.alt = title;
      previewImage.onerror = function() {
        previewImageContainer.innerHTML = '<div style="padding: 40px; text-align: center; color: #94a3b8;">Image not available</div>';
      };
    } else {
      previewImageContainer.innerHTML = '<div style="padding: 40px; text-align: center; color: #94a3b8;">No image provided</div>';
    }
  }
  
  // Set Instagram link
  const previewInstagramContainer = $('#previewInstagramContainer');
  const previewInstagramLink = $('#previewInstagramLink');
  if (previewInstagramContainer && previewInstagramLink) {
    if (instagramLink) {
      previewInstagramLink.href = instagramLink;
      previewInstagramContainer.style.display = 'block';
    } else {
      previewInstagramContainer.style.display = 'none';
    }
  }
  
  // Set caption
  const previewCaption = $('#previewCaption');
  if (previewCaption) {
    previewCaption.textContent = caption;
  }
  
  // Show modal
  const previewModal = $('#previewModal');
  if (previewModal) {
    previewModal.classList.add('show');
  }
}

function closePreviewModal() {
  const previewModal = $('#previewModal');
  if (previewModal) {
    previewModal.classList.remove('show');
  }
}

// Close preview modal handlers
const closePreviewModalBtn = $('#closePreviewModal');
if (closePreviewModalBtn) {
  closePreviewModalBtn.addEventListener('click', () => {
    closePreviewModal();
  });
}

// Close on backdrop click
const previewModal = $('#previewModal');
if (previewModal) {
  previewModal.addEventListener('click', (e) => {
    if (e.target === previewModal) {
      closePreviewModal();
    }
  });
}

// Close on ESC key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const previewModal = $('#previewModal');
    if (previewModal && previewModal.classList.contains('show')) {
      closePreviewModal();
    }
  }
});

const approvalDelete = $('#approvalDelete');
if (approvalDelete) {
  approvalDelete.addEventListener('click', () => {
    const id = $('#approvalId').value;
    if (!id || !confirm('Are you sure you want to delete this approval?')) return;
    
    const state = load();
    const item = state.approvals.find(a => a.id === id);
    if (item) {
      state.approvals = state.approvals.filter(a => a.id !== id);
      
      // Update KPIs
      const pendingCount = state.approvals.filter(a => !a.status || a.status === 'pending').length;
      const scheduledCount = calculateScheduledPosts(state.approvals);
      if (state.kpis) {
        state.kpis.waitingApproval = pendingCount;
        state.kpis.scheduled = scheduledCount;
      }
      
      // Log activity
      if (!state.activity) state.activity = [];
      state.activity.push({
        when: Date.now(),
        text: `Deleted approval: ${item.title}`
      });
      
      save(state);
      renderApprovalsTab();
      renderOverviewTab(); // Update overview to reflect new scheduled count
      
      // Reset form
      approvalForm.reset();
      $('#approvalId').value = '';
      $('#editPanelTitle').textContent = 'Create Approval';
      $('#approvalDelete').style.display = 'none';
      selectedApprovalId = null;
    }
  });
}

/* ================== Requests Tab ================== */
let showClosedRequests = false;

function renderRequestsTab() {
  const state = load();
  const container = $('#requestsList');
  if (!container) return;
  
  container.innerHTML = '';
  
  const requests = (state.requests || []).filter(r => showClosedRequests || r.status === 'open');
  
  if (requests.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__text' }, 'No requests found.')
    ));
    return;
  }
  
  requests.forEach(req => {
    const item = el('div', { class: 'request-item' });
    
    const info = el('div', { class: 'request-item__info' });
    const type = el('div', { class: 'request-item__type' });
    type.textContent = req.type || 'Request';
    const details = el('div', { class: 'request-item__details' });
    details.textContent = req.details || '';
    const meta = el('div', { class: 'request-item__meta' });
    meta.textContent = `By ${req.by || 'Client'} • ${fmtDate(req.createdAt || Date.now())}`;
    
    info.appendChild(type);
    info.appendChild(details);
    info.appendChild(meta);
    
    const actions = el('div', { style: 'display: flex; align-items: center;' });
    const status = el('span', {
      class: `request-item__status request-item__status--${req.status || 'open'}`
    }, req.status === 'done' ? 'Done' : 'Open');
    actions.appendChild(status);
    
    if (req.status === 'open') {
      const btn = el('button', { class: 'btn btn-primary' }, 'Mark Done');
      btn.addEventListener('click', () => {
        markRequestDone(req.id);
      });
      actions.appendChild(btn);
    }
    
    item.appendChild(info);
    item.appendChild(actions);
    container.appendChild(item);
  });
}

function markRequestDone(id) {
  const state = load();
  const req = (state.requests || []).find(r => r.id === id);
  if (!req) return;
  
  req.status = 'done';
  req.doneAt = Date.now(); // Use doneAt instead of completedAt
  // Ensure createdAt exists (for backward compatibility)
  if (!req.createdAt) req.createdAt = Date.now();
  
  // Log activity
  if (!state.activity) state.activity = [];
  state.activity.push({
    when: Date.now(),
    text: `Marked request as done: ${req.type}`
  });
  
  save(state);
  renderRequestsTab();
}

const showClosedCheckbox = $('#showClosedRequests');
if (showClosedCheckbox) {
  showClosedCheckbox.addEventListener('change', (e) => {
    showClosedRequests = e.target.checked;
    renderRequestsTab();
  });
}

/* ================== Needs Tab ================== */
function renderNeedsTab() {
  const state = load();
  const container = $('#needsList');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Only show open needs
  const openNeeds = (state.needs || []).filter(n => !n.status || n.status === 'open');
  
  if (openNeeds.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__text' }, 'No needs listed.')
    ));
    return;
  }
  
  openNeeds.forEach(need => {
    const item = el('div', { class: 'need-item' });
    
    const text = el('div', { class: 'need-item__text' });
    text.textContent = need.text;
    
    const actions = el('div', { style: 'display: flex; align-items: center; gap: 8px;' });
    const severity = el('span', {
      class: `need-item__severity need-item__severity--${need.severity || 'warn'}`
    }, need.severity === 'bad' ? 'Bad' : 'Warning');
    actions.appendChild(severity);
    
    // Add "Mark done" button
    const markDoneBtn = el('button', { class: 'btn btn-primary', style: 'padding: 6px 12px; font-size: 12px; background: #22c55e; color: white; border: none;' }, 'Mark done');
    markDoneBtn.addEventListener('click', () => {
      markNeedDone(need.id);
    });
    actions.appendChild(markDoneBtn);
    
    const removeBtn = el('button', { class: 'btn btn-danger', style: 'padding: 6px 12px; font-size: 12px;' }, 'Remove');
    removeBtn.addEventListener('click', () => {
      if (confirm('Remove this need?')) {
        removeNeed(need.id);
      }
    });
    actions.appendChild(removeBtn);
    
    item.appendChild(text);
    item.appendChild(actions);
    container.appendChild(item);
  });
}

function markNeedDone(id) {
  const state = load();
  const need = (state.needs || []).find(n => n.id === id);
  if (!need) return;
  
  // Mark as done
  need.status = 'done';
  need.doneAt = Date.now();
  
  // Update missing assets count (only count open needs)
  const openNeeds = (state.needs || []).filter(n => !n.status || n.status === 'open');
  if (state.kpis) {
    state.kpis.missingAssets = openNeeds.length;
  }
  
  // Log activity
  if (!state.activity) state.activity = [];
  state.activity.push({
    when: Date.now(),
    text: `Marked need as done: ${need.text.substring(0, 50)}${need.text.length > 50 ? '...' : ''}`
  });
  
  save(state);
  renderNeedsTab();
}

function removeNeed(id) {
  const state = load();
  const need = (state.needs || []).find(n => n.id === id);
  if (!need) return;
  
  // Mark as done instead of deleting
  need.status = 'done';
  need.doneAt = Date.now();
  
  // Update missing assets count (only count open needs)
  const openNeeds = (state.needs || []).filter(n => !n.status || n.status === 'open');
  if (state.kpis) {
    state.kpis.missingAssets = openNeeds.length;
  }
  
  // Log activity
  if (!state.activity) state.activity = [];
  state.activity.push({
    when: Date.now(),
    text: 'Removed need from client'
  });
  
  save(state);
  renderNeedsTab();
}

const needForm = $('#needForm');
if (needForm) {
  needForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const state = load();
    if (!state.needs) state.needs = [];
    
    const need = {
      id: `n${Date.now()}`,
      text: $('#needText').value.trim(),
      severity: $('#needSeverity').value,
      status: 'open',
      createdAt: Date.now()
    };
    
    state.needs.push(need);
    
    // Update missing assets count (only count open needs)
    const openNeeds = (state.needs || []).filter(n => !n.status || n.status === 'open');
    if (state.kpis) {
      state.kpis.missingAssets = openNeeds.length;
    }
    
    // Log activity
    if (!state.activity) state.activity = [];
    state.activity.push({
      when: Date.now(),
      text: `Added need: ${need.text.substring(0, 50)}${need.text.length > 50 ? '...' : ''}`
    });
    
    save(state);
    needForm.reset();
    renderNeedsTab();
  });
}

/* ================== Content Library Tab ================== */
let assetFilterStatus = 'all';
let assetFilterType = 'all';

function renderContentLibraryTab() {
  const state = load();
  const container = $('#assetsList');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Get assets for current client
  let assets = (state.assets || []).filter(a => a.clientId === currentClientId);
  
  // Apply filters
  if (assetFilterStatus !== 'all') {
    assets = assets.filter(a => a.status === assetFilterStatus);
  }
  if (assetFilterType !== 'all') {
    assets = assets.filter(a => a.type === assetFilterType);
  }
  
  // Sort by uploaded date (newest first)
  assets.sort((a, b) => (b.uploadedDate || 0) - (a.uploadedDate || 0));
  
  if (assets.length === 0) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__text' }, 'No assets found. Upload your first asset using the form above.')
    ));
    return;
  }
  
  assets.forEach(asset => {
    const item = el('div', { class: 'asset-item' });
    
    // Thumbnail
    if (asset.url && (asset.type === 'photo' || asset.type === 'logo')) {
      const thumbnail = el('img', {
        class: 'asset-item__thumbnail',
        src: asset.url,
        alt: asset.title,
        onerror: "this.style.display='none'; this.nextElementSibling.style.display='flex';"
      });
      const placeholder = el('div', {
        class: 'asset-item__thumbnail-placeholder',
        style: 'display: none;'
      }, asset.type === 'video' ? '▶' : '🖼');
      item.appendChild(thumbnail);
      item.appendChild(placeholder);
    } else {
      const placeholder = el('div', { class: 'asset-item__thumbnail-placeholder' },
        asset.type === 'video' ? '▶' : '🖼'
      );
      item.appendChild(placeholder);
    }
    
    // Content
    const content = el('div', { class: 'asset-item__content' });
    
    const title = el('div', { class: 'asset-item__title' });
    title.textContent = asset.title;
    
    const meta = el('div', { class: 'asset-item__meta' });
    meta.appendChild(el('span', {
      class: `chip chip--type`
    }, asset.type.charAt(0).toUpperCase() + asset.type.slice(1)));
    meta.appendChild(el('span', {
      class: `chip chip--status-${asset.status || 'pending'}`
    }, (asset.status || 'pending').charAt(0).toUpperCase() + (asset.status || 'pending').slice(1)));
    
    const date = el('div', { class: 'asset-item__date' });
    if (asset.uploadedDate) {
      date.textContent = `Uploaded: ${fmtDate(asset.uploadedDate)}`;
    }
    
    // Tags
    if (asset.tags && asset.tags.length > 0) {
      const tagsContainer = el('div', { class: 'asset-item__tags' });
      asset.tags.forEach(tag => {
        tagsContainer.appendChild(el('span', { class: 'tag-small' }, tag.trim()));
      });
      content.appendChild(tagsContainer);
    }
    
    // Actions
    const actions = el('div', { class: 'asset-item__actions' });
    
    if (asset.status !== 'approved') {
      const approveBtn = el('button', {
        class: 'btn btn-primary',
        style: 'padding: 6px 12px; font-size: 12px;'
      }, 'Approve');
      approveBtn.addEventListener('click', () => {
        approveAsset(asset.id);
      });
      actions.appendChild(approveBtn);
    }
    
    const deleteBtn = el('button', {
      class: 'btn btn-danger',
      style: 'padding: 6px 12px; font-size: 12px;'
    }, 'Delete');
    deleteBtn.addEventListener('click', () => {
      if (confirm(`Are you sure you want to delete "${asset.title}"?`)) {
        deleteAsset(asset.id);
      }
    });
    actions.appendChild(deleteBtn);
    
    content.appendChild(title);
    content.appendChild(meta);
    content.appendChild(date);
    content.appendChild(actions);
    
    item.appendChild(content);
    container.appendChild(item);
  });
}

function approveAsset(id) {
  const state = load();
  const asset = (state.assets || []).find(a => a.id === id);
  if (!asset) return;
  
  asset.status = 'approved';
  
  // Log activity
  if (!state.activity) state.activity = [];
  state.activity.push({
    when: Date.now(),
    text: `Approved asset: ${asset.title}`
  });
  
  save(state);
  renderContentLibraryTab();
}

function deleteAsset(id) {
  const state = load();
  const asset = (state.assets || []).find(a => a.id === id);
  if (!asset) return;
  
  state.assets = (state.assets || []).filter(a => a.id !== id);
  
  // Log activity
  if (!state.activity) state.activity = [];
  state.activity.push({
    when: Date.now(),
    text: `Deleted asset: ${asset.title}`
  });
  
  save(state);
  renderContentLibraryTab();
}

// Asset form handler
const assetForm = $('#assetForm');
if (assetForm) {
  assetForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const state = load();
    if (!state.assets) state.assets = [];
    
    const tags = $('#assetTags').value.trim();
    const tagsArray = tags ? tags.split(',').map(t => t.trim()).filter(t => t) : [];
    
    const asset = {
      id: `asset${Date.now()}`,
      clientId: currentClientId,
      title: $('#assetTitle').value.trim(),
      url: $('#assetUrl').value.trim(),
      type: $('#assetType').value,
      tags: tagsArray,
      status: $('#assetStatus').value || 'pending',
      uploadedDate: Date.now()
    };
    
    state.assets.push(asset);
    
    // Log activity
    if (!state.activity) state.activity = [];
    state.activity.push({
      when: Date.now(),
      text: `Uploaded asset: ${asset.title}`
    });
    
    save(state);
    assetForm.reset();
    $('#assetStatus').value = 'pending'; // Reset to default
    renderContentLibraryTab();
  });
}

// Filter handlers
const filterStatus = $('#filterStatus');
if (filterStatus) {
  filterStatus.addEventListener('change', (e) => {
    assetFilterStatus = e.target.value;
    renderContentLibraryTab();
  });
}

const filterType = $('#filterType');
if (filterType) {
  filterType.addEventListener('change', (e) => {
    assetFilterType = e.target.value;
    renderContentLibraryTab();
  });
}

/* ================== Reports Tab ================== */
function renderReportsTab() {
  const r = loadReports();
  const prev = r.prev;
  const container = $('#reportsContent');
  if (!container) return;
  
  container.innerHTML = '';
  
  function pctChange(cur, prev) {
    if (prev === 0) return 100;
    return Math.round(((cur - prev) / prev) * 100);
  }
  
  function positivePhrase(label, p) {
    if (p > 0) return `${label} up ${p}% vs last period`;
    if (p === 0) return `${label} holding steady`;
    return `${label} steady with ongoing optimization`;
  }
  
  const impText = prev ? positivePhrase("Impressions", pctChange(r.ads.impressions, prev.ads.impressions)) : "Impressions trending positively";
  const growthScore = prev ? Math.max(0, pctChange(r.visibility.gmbViews + r.visibility.profileSearches + r.visibility.websiteClicks, prev.visibility.gmbViews + prev.visibility.profileSearches + prev.visibility.websiteClicks)) : 0;
  
  // Ads Overview Card
  const adsCard = el('div', { class: 'report-card' });
  adsCard.appendChild(el('div', { class: 'report-card__header' },
    el('div', { class: 'report-card__title' }, 'Ads Overview')
  ));
  adsCard.appendChild(el('div', { class: 'card__value', style: 'font-size: 24px;' }, `${r.ads.running} Running`));
  adsCard.appendChild(el('div', { class: 'card__sub' }, `${r.ads.impressions.toLocaleString()} impressions • ${impText}`));
  const adsChip = el('div', { class: 'chip', style: 'display: inline-block; margin-top: 8px; background: #d1fae5; color: #065f46;' });
  adsChip.textContent = (prev && pctChange(r.ads.leads, prev.ads.leads) > 0) ? "More leads this period" : "Performing well";
  adsCard.appendChild(adsChip);
  container.appendChild(adsCard);
  
  // Google & Social Growth Card
  const growthCard = el('div', { class: 'report-card' });
  growthCard.appendChild(el('div', { class: 'report-card__header' },
    el('div', { class: 'report-card__title' }, 'Google & Social Growth')
  ));
  growthCard.appendChild(el('div', { class: 'card__value', style: 'font-size: 24px;' }, prev ? `+${growthScore}%` : "Growing"));
  growthCard.appendChild(el('div', { class: 'card__sub' }, `${r.visibility.gmbViews.toLocaleString()} Google views • ${r.visibility.profileSearches.toLocaleString()} profile searches`));
  const growthChip = el('div', { class: 'chip', style: 'display: inline-block; margin-top: 8px; background: #d1fae5; color: #065f46;' });
  growthChip.textContent = (growthScore > 0) ? "Visibility up" : "Visibility steady";
  growthCard.appendChild(growthChip);
  container.appendChild(growthCard);
  
  // This Month's Work Card
  const workCard = el('div', { class: 'report-card' });
  workCard.appendChild(el('div', { class: 'report-card__header' },
    el('div', { class: 'report-card__title' }, 'This Month\'s Work')
  ));
  const workList = el('ul', { style: 'list-style: none; padding: 0; margin: 16px 0;' });
  const w = r.work;
  const labelMap = { posts: "posts published", reels: "reels edited", campaigns: "campaigns launched", requestsResolved: "client requests resolved" };
  ["posts", "reels", "campaigns", "requestsResolved"].forEach(k => {
    const li = el('li', { style: 'padding: 8px 0; border-bottom: 1px solid #e2e8f0;' });
    li.textContent = `${w[k]} ${labelMap[k]}`;
    workList.appendChild(li);
  });
  workCard.appendChild(workList);
  workCard.appendChild(el('div', { class: 'card__sub' }, `Period: ${r.period}`));
  container.appendChild(workCard);
  
  // Highlights Card
  const highlightsCard = el('div', { class: 'report-card' });
  highlightsCard.appendChild(el('div', { class: 'report-card__header' },
    el('div', { class: 'report-card__title' }, 'Highlights')
  ));
  function summarizePositive(r, prev) {
    const parts = [];
    if (prev) {
      const imp = pctChange(r.ads.impressions, prev.ads.impressions);
      const leads = pctChange(r.ads.leads, prev.ads.leads);
      const views = pctChange(r.visibility.gmbViews, prev.visibility.gmbViews);
      parts.push(leads > 0 ? `More leads this period (+${leads}%).` : `Lead flow steady while we scale creatives.`);
      parts.push(imp > 0 ? `Reach expanded (+${imp}%).` : `Reach consistent with stable delivery.`);
      parts.push(views > 0 ? `Google visibility growing (+${views}%).` : `Google visibility holding while we test new posts.`);
    } else {
      parts.push(`Ads delivering consistent reach and visibility.`);
    }
    parts.push(`Content engine on track: ${r.work.posts} posts, ${r.work.reels} reels.`);
    return parts.join(" ");
  }
  highlightsCard.appendChild(el('div', { class: 'card__sub', style: 'line-height: 1.8;' }, summarizePositive(r, prev)));
  container.appendChild(highlightsCard);
}

// Reports admin form
const openReportsAdmin = $('#openReportsAdmin');
const reportsAdmin = $('#reportsAdmin');
const reportsForm = $('#reportsForm');
const cancelReports = $('#cancelReports');

if (openReportsAdmin) {
  openReportsAdmin.addEventListener('click', () => {
    if (reportsAdmin) {
      reportsAdmin.style.display = reportsAdmin.style.display === 'none' ? 'block' : 'none';
      if (reportsAdmin.style.display === 'block') {
        // Load current values
        const r = loadReports();
        $('#repPeriod').value = r.period || '';
        $('#repAdsRunning').value = r.ads.running || '';
        $('#repImpressions').value = r.ads.impressions || '';
        $('#repClicks').value = r.ads.clicks || '';
        $('#repLeads').value = r.ads.leads || '';
        $('#repGmbViews').value = r.visibility.gmbViews || '';
        $('#repProfileSearches').value = r.visibility.profileSearches || '';
        $('#repWebsiteClicks').value = r.visibility.websiteClicks || '';
        $('#repIgFollowers').value = r.visibility.igFollowersDelta || '';
        $('#repPosts').value = r.work.posts || '';
        $('#repReels').value = r.work.reels || '';
        $('#repCampaigns').value = r.work.campaigns || '';
        $('#repRequests').value = r.work.requestsResolved || '';
      }
    }
  });
}

if (cancelReports) {
  cancelReports.addEventListener('click', () => {
    if (reportsAdmin) reportsAdmin.style.display = 'none';
  });
}

if (reportsForm) {
  reportsForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pin = $('#repPin').value.trim();
    if (pin !== TEAM_PIN) {
      alert('Invalid PIN');
      return;
    }
    
    const cur = loadReports();
    const prev = JSON.parse(JSON.stringify(cur));
    const val = (id, f = 0) => {
      const v = document.getElementById(id).value.replace(/[, ]/g, '');
      return v ? parseInt(v) : f;
    };
    
    const next = {
      period: $('#repPeriod').value.trim() || cur.period,
      ads: {
        running: val('repAdsRunning', cur.ads.running),
        impressions: val('repImpressions', cur.ads.impressions),
        clicks: val('repClicks', cur.ads.clicks),
        leads: val('repLeads', cur.ads.leads)
      },
      visibility: {
        gmbViews: val('repGmbViews', cur.visibility.gmbViews),
        profileSearches: val('repProfileSearches', cur.visibility.profileSearches),
        websiteClicks: val('repWebsiteClicks', cur.visibility.websiteClicks),
        igFollowersDelta: val('repIgFollowers', cur.visibility.igFollowersDelta)
      },
      work: {
        posts: val('repPosts', cur.work.posts),
        reels: val('repReels', cur.work.reels),
        campaigns: val('repCampaigns', cur.work.campaigns),
        requestsResolved: val('repRequests', cur.work.requestsResolved)
      },
      prev
    };
    
    saveReports(next);
    if (reportsAdmin) reportsAdmin.style.display = 'none';
    
    // Log activity
    const state = load();
    if (!state.activity) state.activity = [];
    state.activity.push({
      when: Date.now(),
      text: `Report updated: ${next.period}`
    });
    save(state);
    
    renderReportsTab();
  });
}

/* ================== Render All ================== */
function renderAll() {
  renderClientsSidebar();
  renderOverviewTab();
  if (currentTab === 'approvals') renderApprovalsTab();
  if (currentTab === 'requests') renderRequestsTab();
  if (currentTab === 'needs') renderNeedsTab();
  if (currentTab === 'contentlibrary') renderContentLibraryTab();
  if (currentTab === 'reports') renderReportsTab();
}

/* ================== Initialize ================== */
document.addEventListener('DOMContentLoaded', () => {
  renderAll();
});

