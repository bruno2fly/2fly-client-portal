/* ================== Agency Dashboard Script ================== */
console.log('agency.js file loaded successfully');

/* ================== Authentication ================== */
const LS_STAFF_SESSION_KEY = "2fly_staff_session";

function isLocal() {
  return window.location.protocol === 'file:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';
}

function staffLoginUrl() {
  if (window.location.protocol === 'file:') {
    const p = window.location.pathname;
    const base = p.substring(0, p.lastIndexOf('/'));
    return base + '/staff-login.html';
  }
  return isLocal() ? '/staff-login.html' : '/staff-login';
}

function checkStaffAuth() {
  const session = localStorage.getItem(LS_STAFF_SESSION_KEY);
  if (!session) {
    window.location.href = staffLoginUrl();
    return null;
  }
  try {
    const sessionData = JSON.parse(session);
    if (Date.now() - sessionData.loggedInAt > 24 * 60 * 60 * 1000) {
      localStorage.removeItem(LS_STAFF_SESSION_KEY);
      window.location.href = staffLoginUrl();
      return null;
    }
    return sessionData;
  } catch {
    localStorage.removeItem(LS_STAFF_SESSION_KEY);
    window.location.href = staffLoginUrl();
    return null;
  }
}

function logout() {
  localStorage.removeItem(LS_STAFF_SESSION_KEY);
  window.location.href = staffLoginUrl();
}

// Check authentication on page load
let currentStaff = checkStaffAuth();

/* ================== State Management ================== */
const LS_CLIENTS_KEY = "2fly_agency_clients_v1";
const LS_REPORTS_KEY = "client_portal_reports_v1";
const TEAM_PIN = "2468";

// Current selected client
let currentClientId = null;

// Load clients registry
function loadClientsRegistry() {
  const data = localStorage.getItem(LS_CLIENTS_KEY);
  if (!data) {
    // Create default client if none exist
    const defaultClient = {
      id: "casa-nova",
      name: "CASA NOVA",
      category: "Restaurant",
      primaryContactName: "Client",
      primaryContactWhatsApp: "",
      primaryContactEmail: "",
      preferredChannel: "portal",
      platformsManaged: ["instagram", "facebook"],
      postingFrequency: "4x_week",
      approvalRequired: true,
      language: "bilingual",
      assetsLink: "",
      brandGuidelinesLink: "",
      primaryGoal: "visibility",
      secondaryGoal: "",
      internalBehaviorType: "fast",
      riskLevel: "low",
      internalNotes: "",
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    const clients = { [defaultClient.id]: defaultClient };
    localStorage.setItem(LS_CLIENTS_KEY, JSON.stringify(clients));
    if (!currentClientId) {
      currentClientId = defaultClient.id;
    }
    return clients;
  }
  try {
    const clients = JSON.parse(data);
    // Remove _lastSelected from clients object (it's metadata, not a client)
    if (clients._lastSelected) {
      currentClientId = clients._lastSelected;
      delete clients._lastSelected;
    }
    // Set current client if not set
    if (!currentClientId && Object.keys(clients).length > 0) {
      currentClientId = Object.keys(clients)[0];
    }
    return clients;
  } catch {
    return {};
  }
}

function saveClientsRegistry(clients) {
  // Preserve _lastSelected if it exists
  const data = localStorage.getItem(LS_CLIENTS_KEY);
  if (data) {
    try {
      const existing = JSON.parse(data);
      if (existing._lastSelected) {
        clients._lastSelected = existing._lastSelected;
      }
    } catch {}
  }
  localStorage.setItem(LS_CLIENTS_KEY, JSON.stringify(clients));
}

// Get current client data
function getCurrentClient() {
  const clients = loadClientsRegistry();
  return clients[currentClientId] || null;
}

// Legacy support - get portal data key for a client
function getClientPortalKey(clientId) {
  return `client_portal_${clientId}_v1`;
}

function load() {
  if (!currentClientId) {
    loadClientsRegistry();
  }
  const key = getClientPortalKey(currentClientId);
  const d = localStorage.getItem(key);
  if (!d) {
    // Initialize with empty state if doesn't exist
    const client = getCurrentClient();
    const empty = {
      client: { id: currentClientId, name: client?.name || "Client", whatsapp: client?.primaryContactWhatsApp || "" },
      kpis: { scheduled: 0, waitingApproval: 0, missingAssets: 0, frustration: 0 },
      approvals: [],
      needs: [],
      requests: [],
      assets: [],
      activity: [],
      seen: false
    };
    localStorage.setItem(key, JSON.stringify(empty));
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
    const client = getCurrentClient();
    return {
      client: { id: currentClientId, name: client?.name || "Client", whatsapp: client?.primaryContactWhatsApp || "" },
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
  if (!currentClientId) return;
  const key = getClientPortalKey(currentClientId);
  
  try {
    // Check size before saving
    const dataString = JSON.stringify(x);
    const sizeInMB = new Blob([dataString]).size / (1024 * 1024);
    
    // Warn if approaching limit (5MB is typical localStorage limit)
    if (sizeInMB > 4.5) {
      console.warn('Warning: Data size is', sizeInMB.toFixed(2), 'MB. Approaching localStorage limit.');
      showToast('Warning: Data size is large. Some images may not be saved.', 'error');
    }
    
    localStorage.setItem(key, dataString);
  } catch (error) {
    if (error.name === 'QuotaExceededError') {
      console.error('localStorage quota exceeded. Data size:', new Blob([JSON.stringify(x)]).size / (1024 * 1024), 'MB');
      showToast('Error: Cannot save - storage limit exceeded. Please remove some images or clear old data.', 'error');
      
      // Try to save without uploadedImages as fallback
      if (x.approvals) {
        const approvalsWithoutImages = x.approvals.map(approval => {
          const { uploadedImages, ...rest } = approval;
          return rest;
        });
        const fallbackData = { ...x, approvals: approvalsWithoutImages };
        try {
          localStorage.setItem(key, JSON.stringify(fallbackData));
          showToast('Saved without images. Please use image URLs instead of uploads.', 'error');
        } catch (e) {
          console.error('Even fallback save failed:', e);
        }
      }
    } else {
      throw error;
    }
  }
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
  const clients = loadClientsRegistry();
  const container = $('#clientsList');
  if (!container) return;

  container.innerHTML = '';

  if (Object.keys(clients).length === 0) {
    container.appendChild(el('div', { style: 'color: rgba(255,255,255,0.7); font-size: 13px; padding: 16px; text-align: center;' }, 'No clients yet. Click "+ New Client" to add one.'));
    return;
  }

  Object.values(clients).forEach(client => {
    const clientTile = el('div', { 
      class: `client-tile ${currentClientId === client.id ? 'active' : ''}`, 
      'data-client-id': client.id 
    });
    
    const name = el('div', { class: 'client-tile__name' });
    name.textContent = client.name;
    
    const badges = el('div', { class: 'client-tile__badges' });
    
    // Load client's portal data to get counts
    const portalKey = getClientPortalKey(client.id);
    const portalData = localStorage.getItem(portalKey);
    if (portalData) {
      try {
        const state = JSON.parse(portalData);
        const pendingCount = (state.approvals || []).filter(a => !a.status || a.status === 'pending').length;
        const openRequests = (state.requests || []).filter(r => r.status === 'open').length;
        
        if (state.kpis && state.kpis.scheduled) {
          badges.appendChild(el('div', { class: 'badge' }, `${state.kpis.scheduled} scheduled`));
        }
        badges.appendChild(el('div', { class: 'badge' }, `${pendingCount} pending`));
        badges.appendChild(el('div', { class: 'badge' }, `${openRequests} requests`));
      } catch (e) {
        console.warn('Error loading client data:', e);
      }
    }
    
    clientTile.appendChild(name);
    clientTile.appendChild(badges);
    
    clientTile.addEventListener('click', () => {
      selectClient(client.id);
    });
    
    container.appendChild(clientTile);
  });
}

function selectClient(clientId) {
  currentClientId = clientId;
  const clients = loadClientsRegistry();
  const client = clients[clientId];
  
  if (!client) return;
  
  // Update client registry with last selected (preserve existing clients)
  const allClients = { ...clients, _lastSelected: clientId };
  localStorage.setItem(LS_CLIENTS_KEY, JSON.stringify(allClients));
  
  // Re-render sidebar and main view
  renderClientsSidebar();
  renderClientHeader();
  renderAll();
}

/* ================== Client Header with Logo ================== */
function renderClientHeader() {
  if (!currentClientId) {
    const header = $('#clientHeader');
    if (header) header.style.display = 'none';
    return;
  }
  
  const clients = loadClientsRegistry();
  const client = clients[currentClientId];
  
  if (!client) {
    const header = $('#clientHeader');
    if (header) header.style.display = 'none';
    return;
  }
  
  const header = $('#clientHeader');
  const logoImg = $('#clientLogoImg');
  const logoInitials = $('#clientLogoInitials');
  const headerName = $('#clientHeaderName');
  
  if (!header) return;
  
  header.style.display = 'block';
  
  // Set client name
  if (headerName) {
    headerName.textContent = client.name || 'Client';
  }
  
  // Set logo or initials
  const addLogoBtn = $('#addLogoBtn');
  if (client.logoUrl) {
    if (logoImg) {
      logoImg.src = client.logoUrl;
      logoImg.style.display = 'block';
    }
    if (logoInitials) {
      logoInitials.style.display = 'none';
    }
    if (addLogoBtn) {
      addLogoBtn.textContent = 'Change Logo';
    }
  } else {
    if (logoImg) {
      logoImg.style.display = 'none';
    }
    if (logoInitials) {
      logoInitials.style.display = 'block';
      // Get initials from client name
      const initials = (client.name || 'CN')
        .split(' ')
        .map(word => word.charAt(0))
        .join('')
        .substring(0, 2)
        .toUpperCase();
      logoInitials.textContent = initials || 'CN';
    }
    if (addLogoBtn) {
      addLogoBtn.textContent = 'Add Logo';
    }
  }
  
  // Setup logo upload handler
  setupLogoUpload();
}

function setupLogoUpload() {
  const addLogoBtn = $('#addLogoBtn');
  const logoInput = $('#clientLogoInput');
  
  if (!addLogoBtn || !logoInput) return;
  
  // Remove existing handlers
  const newBtn = addLogoBtn.cloneNode(true);
  addLogoBtn.parentNode.replaceChild(newBtn, addLogoBtn);
  
  const newInput = $('#clientLogoInput');
  const newAddBtn = $('#addLogoBtn');
  
  // Click on Add Logo button to trigger file input
  if (newAddBtn) {
    newAddBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (newInput) newInput.click();
    });
  }
  
  // Handle file selection
  if (newInput) {
    // Remove existing change handler if any
    if (newInput._logoChangeHandler) {
      newInput.removeEventListener('change', newInput._logoChangeHandler);
    }
    
    newInput._logoChangeHandler = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
      }
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB');
        return;
      }
      
      // Read file as data URL
      const reader = new FileReader();
      reader.onload = (event) => {
        const logoUrl = event.target.result;
        saveClientLogo(logoUrl);
      };
      reader.onerror = () => {
        alert('Error reading file. Please try again.');
      };
      reader.readAsDataURL(file);
    };
    
    newInput.addEventListener('change', newInput._logoChangeHandler);
  }
}

function saveClientLogo(logoUrl) {
  if (!currentClientId) return;
  
  const clients = loadClientsRegistry();
  const client = clients[currentClientId];
  
  if (!client) return;
  
  // Save logo URL to client data
  client.logoUrl = logoUrl;
  client.updatedAt = Date.now();
  clients[currentClientId] = client;
  saveClientsRegistry(clients);
  
  // Update display
  renderClientHeader();
  
  showToast('Logo uploaded successfully!');
}

/* ================== Tab Management ================== */
// Load saved tab from localStorage or default to 'overview'
let currentTab = localStorage.getItem('2fly_agency_current_tab') || 'overview';

function switchTab(tabName) {
  currentTab = tabName;
  
  // Save current tab to localStorage
  localStorage.setItem('2fly_agency_current_tab', tabName);
  
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
      // Set auto due date when switching to approvals tab (if form is empty)
      setTimeout(() => {
        const approvalId = $('#approvalId');
        if (!approvalId || !approvalId.value) {
          setAutoDueDate();
        }
      }, 100);
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
    default:
      break;
  }
}

// Setup tab click handlers - will be called after DOM loads
function setupTabHandlers() {
  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      switchTab(tab.dataset.tab);
    });
  });
}

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
  
  // Setup edit and delete client buttons
  setupClientManagementButtons();
}

// Setup edit and delete client buttons
function setupClientManagementButtons() {
  const editBtn = $('#editClientBtn');
  const deleteBtn = $('#deleteClientBtn');
  
  if (editBtn) {
    editBtn.removeEventListener('click', editCurrentClient);
    editBtn.addEventListener('click', editCurrentClient);
  }
  
  if (deleteBtn) {
    deleteBtn.removeEventListener('click', deleteCurrentClient);
    deleteBtn.addEventListener('click', deleteCurrentClient);
  }
}

// Edit current client - opens form with existing data
function editCurrentClient() {
  if (!currentClientId) {
    showToast('Please select a client first');
    return;
  }
  
  const clients = loadClientsRegistry();
  const client = clients[currentClientId];
  
  if (!client) {
    showToast('Client not found');
    return;
  }
  
  // Set edit mode flag
  window.editingClientId = currentClientId;
  
  // Populate form with client data
  $('#clientName').value = client.name || '';
  $('#clientIdInput').value = client.id || '';
  $('#clientIdInput').disabled = true; // Don't allow ID changes
  $('#clientCategory').value = client.category || '';
  $('#primaryContactName').value = client.primaryContactName || '';
  $('#primaryContactWhatsApp').value = client.primaryContactWhatsApp || '';
  $('#primaryContactEmail').value = client.primaryContactEmail || '';
  $('#preferredChannel').value = client.preferredChannel || '';
  
  // Populate logo in form
  updateFormLogo(client.logoUrl, client.name);
  
  // Set platforms
  $$('input[name="platformsManaged"]').forEach(cb => {
    cb.checked = (client.platformsManaged || []).includes(cb.value);
  });
  
  $('#postingFrequency').value = client.postingFrequency || '';
  if (client.postingFrequency === 'custom' && client.postingFrequencyNote) {
    $('#postingFrequencyNote').value = client.postingFrequencyNote;
    $('#postingFrequencyNote').style.display = 'block';
  }
  
  $('#approvalRequired').value = client.approvalRequired ? 'true' : 'false';
  $('#language').value = client.language || '';
  $('#assetsLink').value = client.assetsLink || '';
  $('#brandGuidelinesLink').value = client.brandGuidelinesLink || '';
  $('#primaryGoal').value = client.primaryGoal || '';
  $('#secondaryGoal').value = client.secondaryGoal || '';
  $('#internalBehaviorType').value = client.internalBehaviorType || '';
  $('#riskLevel').value = client.riskLevel || '';
  $('#internalNotes').value = client.internalNotes || '';
  
  // Update form title and submit button
  const formTitle = $('#editPanelTitle') || document.querySelector('#newClientForm h2');
  if (formTitle) formTitle.textContent = 'Edit Client';
  
  const submitBtn = $('#newClientForm button[type="submit"]');
  if (submitBtn) submitBtn.textContent = 'Update Client';
  
  // Clear password field (don't show existing password)
  $('#clientPassword').value = '';
  $('#clientPassword').required = false;
  
  // Show modal
  showNewClientModal();
}

// Delete current client
function deleteCurrentClient() {
  if (!currentClientId) {
    showToast('Please select a client first');
    return;
  }
  
  const clients = loadClientsRegistry();
  const client = clients[currentClientId];
  
  if (!client) {
    showToast('Client not found');
    return;
  }
  
  const confirmMessage = `Are you sure you want to delete "${client.name}"?\n\nThis will permanently delete:\n- Client information\n- All approvals\n- All requests\n- All portal data\n\nThis action cannot be undone!`;
  
  if (!confirm(confirmMessage)) {
    return;
  }
  
  // Delete client from registry
  delete clients[currentClientId];
  saveClientsRegistry(clients);
  
  // Delete client login credentials
  const LS_CLIENTS_LOGIN_KEY = "2fly_clients_v1";
  const loginClients = JSON.parse(localStorage.getItem(LS_CLIENTS_LOGIN_KEY) || '{}');
  delete loginClients[currentClientId];
  localStorage.setItem(LS_CLIENTS_LOGIN_KEY, JSON.stringify(loginClients));
  
  // Delete client portal data
  const portalKey = getClientPortalKey(currentClientId);
  localStorage.removeItem(portalKey);
  
  // Clear current client selection
  currentClientId = null;
  clients._lastSelected = null;
  saveClientsRegistry(clients);
  
  // Re-render sidebar and switch to first available client
  renderClientsSidebar();
  const remainingClients = Object.keys(clients).filter(k => k !== '_lastSelected');
  if (remainingClients.length > 0) {
    selectClient(remainingClients[0]);
  } else {
    // No clients left, render empty state
    switchTab('overview');
  }
  
  showToast(`Client "${client.name}" has been deleted`);
}

/* ================== Approvals Tab ================== */
let selectedApprovalId = null;

function renderApprovalsTab() {
  const state = load();
  const container = $('#approvalsList');
  if (!container) return;
  
  container.innerHTML = '';
  
  // Add click handler to container to deselect when clicking outside items
  // Remove previous handler if exists
  if (container._deselectHandler) {
    container.removeEventListener('click', container._deselectHandler);
  }
  
  container._deselectHandler = function(e) {
    // If clicking directly on the container or section title (but not on approval items)
    const clickedItem = e.target.closest('.approval-item');
    
    // Only deselect if clicking on container background or section titles (not on items)
    if (!clickedItem) {
      // Deselect approval
      selectedApprovalId = null;
      $$('.approval-item').forEach(i => i.classList.remove('selected'));
      // Reset form
      const approvalForm = $('#approvalForm');
      if (approvalForm) {
        approvalForm.reset();
        $('#approvalId').value = '';
        $('#editPanelTitle').textContent = 'Create Approval';
        $('#approvalDelete').style.display = 'none';
      }
    }
  };
  
  container.addEventListener('click', container._deselectHandler);
  
  // Group by status - copy sections first, then content sections
  const copyPending = (state.approvals || []).filter(a => a.status === 'copy_pending');
  const copyApproved = (state.approvals || []).filter(a => a.status === 'copy_approved');
  const copyChanges = (state.approvals || []).filter(a => a.status === 'copy_changes');
  const pending = (state.approvals || []).filter(a => (!a.status || a.status === 'pending') && a.status !== 'copy_pending' && a.status !== 'copy_approved' && a.status !== 'copy_changes');
  const changes = (state.approvals || []).filter(a => a.status === 'changes');
  const approved = (state.approvals || []).filter(a => a.status === 'approved');
  
  // Store collapsed state for each section (default: all expanded)
  if (!window.approvalsSectionState) {
    window.approvalsSectionState = {
      copyPending: false,
      copyApproved: false,
      copyChanges: false,
      pending: false,
      changes: false,
      approved: false
    };
  }
  
  function renderSection(title, items, containerEl, sectionKey) {
    // Always show section, even if empty (but collapsed by default if empty)
    const section = el('div', { class: 'approvals-section' });
    const sectionTitle = el('div', { class: 'approvals-section__title' });
    
    // If section is empty, default to collapsed
    const isEmpty = items.length === 0;
    if (isEmpty && window.approvalsSectionState[sectionKey] === undefined) {
      window.approvalsSectionState[sectionKey] = true; // Collapse empty sections by default
    }
    
    // Title content with arrow
    const titleContent = el('div', { class: 'approvals-section__title-content' });
    const arrow = el('span', { 
      class: `approvals-section__arrow ${window.approvalsSectionState[sectionKey] ? 'collapsed' : ''}`
    });
    // Use SVG arrow for better compatibility
    arrow.innerHTML = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.5 5.25L7 8.75L10.5 5.25" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const titleText = el('span', {});
    titleText.textContent = `${title} (${items.length})`;
    titleContent.appendChild(arrow);
    titleContent.appendChild(titleText);
    sectionTitle.appendChild(titleContent);
    
    // Make title clickable to toggle (only if there are items)
    if (items.length > 0) {
      sectionTitle.style.cursor = 'pointer';
      sectionTitle.addEventListener('click', () => {
        window.approvalsSectionState[sectionKey] = !window.approvalsSectionState[sectionKey];
        const isCollapsed = window.approvalsSectionState[sectionKey];
        
        if (isCollapsed) {
          arrow.classList.add('collapsed');
          list.classList.remove('expanded');
          list.classList.add('collapsed');
        } else {
          arrow.classList.remove('collapsed');
          list.classList.remove('collapsed');
          list.classList.add('expanded');
        }
      });
    } else {
      // Empty section - no hover effect
      sectionTitle.style.cursor = 'default';
      sectionTitle.style.opacity = '0.6';
    }
    
    section.appendChild(sectionTitle);
    
    const list = el('div', { 
      class: `approvals-list approvals-section__list ${window.approvalsSectionState[sectionKey] ? 'collapsed' : 'expanded'}`
    });
    
    if (items.length === 0) {
      // Show empty state message
      const emptyMsg = el('div', { 
        style: 'padding: 16px; text-align: center; color: #94a3b8; font-size: 14px; font-style: italic;'
      }, 'No items in this section');
      list.appendChild(emptyMsg);
    } else {
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
        // Format status display
        let statusDisplay = (item.status || 'pending');
        if (statusDisplay === 'copy_pending') {
          statusDisplay = 'Copy Pending';
        } else if (statusDisplay === 'copy_approved') {
          statusDisplay = 'Copy Approved';
        } else if (statusDisplay === 'copy_changes') {
          statusDisplay = 'Copy Changes';
        } else {
          statusDisplay = statusDisplay.charAt(0).toUpperCase() + statusDisplay.slice(1);
        }
        meta.appendChild(el('span', {
          class: `chip chip--status-${item.status || 'pending'}`
        }, statusDisplay));
        meta.appendChild(el('span', { class: 'approval-item__date' }, `Due ${item.date || 'N/A'}`));
        
        itemEl.appendChild(header);
        itemEl.appendChild(meta);
        
        // Show change request notes if status is "changes" or "copy_changes" and notes exist
        if ((item.status === 'changes' || item.status === 'copy_changes') && item.change_notes && item.change_notes.length > 0) {
          const latestNote = item.change_notes[item.change_notes.length - 1];
          const changeRequestBox = el('div', { 
            class: 'approval-item__change-request',
            style: 'margin-top: 12px; padding: 12px; background: #fff7ed; border-left: 3px solid #ea580c; border-radius: 6px;'
          });
          
          const changeRequestLabel = el('div', {
            style: 'font-size: 12px; font-weight: 600; color: #ea580c; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;'
          }, 'Change Request:');
          
          const changeRequestText = el('div', {
            style: 'font-size: 13px; color: #9a3412; line-height: 1.5;'
          }, latestNote.note || 'Change requested.');
          
          changeRequestBox.appendChild(changeRequestLabel);
          changeRequestBox.appendChild(changeRequestText);
          itemEl.appendChild(changeRequestBox);
        }
        
        itemEl.addEventListener('click', (e) => {
          e.stopPropagation(); // Prevent section toggle and container click when clicking item
          selectedApprovalId = item.id;
          $$('.approval-item').forEach(i => i.classList.remove('selected'));
          itemEl.classList.add('selected');
          loadApprovalForEdit(item.id);
        });
        
        list.appendChild(itemEl);
      });
    }
    
    section.appendChild(list);
    containerEl.appendChild(section);
  }
  
    // Render copy sections first (on top), then content sections
    renderSection('Copy Pending', copyPending, container, 'copyPending');
    renderSection('Copy Changes', copyChanges, container, 'copyChanges');
    renderSection('Copy Approved', copyApproved, container, 'copyApproved');
    renderSection('Pending', pending, container, 'pending');
    renderSection('Changes Requested', changes, container, 'changes');
    renderSection('Approved', approved, container, 'approved');
  
  if ((state.approvals || []).length === 0) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-state__text' }, 'No approvals yet. Create one using the form on the right.')
    ));
  }
}

// Auto-set due date to 2 days from today
function setAutoDueDate() {
  const dueDateInput = $('#approvalDate');
  if (!dueDateInput) return;
  
  // Only auto-set if the field is empty (new approval)
  if (!dueDateInput.value) {
    const today = new Date();
    const twoDaysLater = new Date(today);
    twoDaysLater.setDate(today.getDate() + 2);
    
    // Format as YYYY-MM-DD for date input
    const year = twoDaysLater.getFullYear();
    const month = String(twoDaysLater.getMonth() + 1).padStart(2, '0');
    const day = String(twoDaysLater.getDate()).padStart(2, '0');
    dueDateInput.value = `${year}-${month}-${day}`;
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
    setAutoDueDate();
    return;
  }
  
  $('#approvalId').value = item.id;
  $('#approvalTitle').value = item.title || '';
  $('#approvalType').value = item.type || 'Post';
  $('#approvalDate').value = item.date || '';
  $('#approvalPostDate').value = item.postDate || '';
  $('#approvalCopyText').value = item.copyText || '';
  $('#approvalCaption').value = item.caption || '';
  $('#approvalStatus').value = item.status || 'pending';
  
  // Load image URL if exists
  $('#approvalImageUrl').value = item.imageUrl || '';
  
  // Load uploaded images if they exist
  if (item.uploadedImages && item.uploadedImages.length > 0) {
    uploadedImages = item.uploadedImages;
    displayUploadedImages();
  } else {
    uploadedImages = [];
    displayUploadedImages();
  }
  
  $('#editPanelTitle').textContent = 'Edit Approval';
  $('#approvalDelete').style.display = 'block';
}

// Setup approval form handler - will be called after DOM loads
function setupApprovalHandlers() {
  const approvalForm = $('#approvalForm');
  if (approvalForm) {
    approvalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const state = load();
    const id = $('#approvalId').value;
    
    const postDateValue = $('#approvalPostDate').value.trim();
    const imageUrl = $('#approvalImageUrl').value.trim();
    
    const approvalData = {
      id: id || `ap${Date.now()}`,
      title: $('#approvalTitle').value.trim(),
      type: $('#approvalType').value,
      date: $('#approvalDate').value,
      postDate: postDateValue || null,
      copyText: $('#approvalCopyText').value.trim() || undefined,
      caption: $('#approvalCaption').value.trim() || undefined,
      imageUrl: imageUrl || undefined,
      uploadedImages: uploadedImages.length > 0 ? uploadedImages : undefined,
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
    uploadedImages = [];
    displayUploadedImages();
    setAutoDueDate();
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
    uploadedImages = [];
    displayUploadedImages();
    $$('.approval-item').forEach(i => i.classList.remove('selected'));
    setAutoDueDate();
    });
  }
  
  // Auto-set due date to 2 days from today
  setAutoDueDate();
  
  // Setup image upload handlers
  setupImageUpload();

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
  const copyText = $('#approvalCopyText').value.trim();
  const caption = $('#approvalCaption').value.trim() || 'No caption provided.';
  const imageUrl = $('#approvalImageUrl').value.trim();
  
  // Set title
  const previewTitle = $('#previewModalTitle');
  if (previewTitle) previewTitle.textContent = title;
  
  // Set content (images or copy text)
  const previewImageContainer = $('#previewImageContainer');
  if (previewImageContainer) {
    let contentHTML = '';
    
    // Priority: uploadedImages > imageUrl > copyText > "No content"
    if (uploadedImages && uploadedImages.length > 0) {
      // Show uploaded images
      contentHTML = '<div style="display: flex; flex-wrap: wrap; gap: 12px; justify-content: center;">';
      uploadedImages.forEach((image) => {
        contentHTML += `<img src="${image.dataUrl}" alt="${image.name}" style="max-width: 100%; max-height: 400px; border-radius: 8px; object-fit: contain; border: 1px solid #e2e8f0;" />`;
      });
      contentHTML += '</div>';
    } else if (imageUrl) {
      // Show image from URL
      contentHTML = `<img src="${imageUrl}" alt="${title}" style="max-width: 100%; max-height: 400px; border-radius: 8px; object-fit: contain; border: 1px solid #e2e8f0;" onerror="this.onerror=null; this.style.display='none'; this.parentElement.innerHTML='<div style=\\'padding: 40px; text-align: center; color: #94a3b8;\\'>Image could not be loaded</div>';">`;
    } else if (copyText) {
      // Show copy text
      contentHTML = `<div style="padding: 24px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;"><div style="font-size: 14px; font-weight: 600; color: #1e40af; margin-bottom: 8px;">Copy Text:</div><div style="color: #0f172a; line-height: 1.6; white-space: pre-wrap;">${copyText}</div></div>`;
    } else {
      contentHTML = '<div style="padding: 40px; text-align: center; color: #94a3b8;">No content provided</div>';
    }
    
    previewImageContainer.innerHTML = contentHTML;
  }
  
  // Hide Instagram link section (removed)
  const previewInstagramContainer = $('#previewInstagramContainer');
  if (previewInstagramContainer) {
    previewInstagramContainer.style.display = 'none';
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

function setupRequestsHandlers() {
  const showClosedCheckbox = $('#showClosedRequests');
  if (showClosedCheckbox) {
    showClosedCheckbox.addEventListener('change', (e) => {
      showClosedRequests = e.target.checked;
      renderRequestsTab();
    });
  }
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

function setupNeedsHandlers() {
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

// Setup asset handlers
function setupAssetHandlers() {
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
}

/* ================== New Client Modal ================== */
function showNewClientModal() {
  const modal = $('#newClientModal');
  if (modal) {
    modal.classList.add('show');
    // Reset form and clear edit mode
    window.editingClientId = null;
    const form = $('#newClientForm');
    if (form) form.reset();
    // Clear client ID input (will auto-generate)
    const clientIdInput = $('#clientIdInput');
    if (clientIdInput) {
      clientIdInput.value = '';
      clientIdInput.disabled = false;
    }
    // Hide custom frequency note
    const customGroup = $('#customFrequencyGroup');
    if (customGroup) customGroup.style.display = 'none';
    // Clear errors
    $$('.error-message').forEach(el => {
      el.classList.remove('show');
      el.textContent = '';
    });
    // Reset form title and submit button
    const formTitle = $('#editPanelTitle') || document.querySelector('#newClientForm h2');
    if (formTitle) formTitle.textContent = 'Create New Client';
    const submitBtn = $('#newClientForm button[type="submit"]');
    if (submitBtn) submitBtn.textContent = 'Create Client';
    // Password required for new clients
    const passwordInput = $('#clientPassword');
    if (passwordInput) passwordInput.required = true;
    // Reset logo in form
    updateFormLogo(null, '');
    // Clear form logo input
    const formLogoInput = $('#formLogoInput');
    if (formLogoInput) formLogoInput.value = '';
    // Store form logo URL (will be set when user uploads)
    window.formLogoUrl = null;
  }
}

// Update logo display in form
function updateFormLogo(logoUrl, clientName) {
  const formLogoImg = $('#formLogoImg');
  const formLogoInitials = $('#formLogoInitials');
  const formAddLogoBtn = $('#formAddLogoBtn');
  
  if (logoUrl) {
    if (formLogoImg) {
      formLogoImg.src = logoUrl;
      formLogoImg.style.display = 'block';
    }
    if (formLogoInitials) {
      formLogoInitials.style.display = 'none';
    }
    if (formAddLogoBtn) {
      formAddLogoBtn.textContent = 'Change Logo';
    }
    window.formLogoUrl = logoUrl;
  } else {
    if (formLogoImg) {
      formLogoImg.style.display = 'none';
    }
    if (formLogoInitials) {
      formLogoInitials.style.display = 'block';
      // Get initials from client name or current name input
      const nameInput = $('#clientName');
      const name = clientName || (nameInput ? nameInput.value : '');
      const initials = (name || 'CN')
        .split(' ')
        .map(word => word.charAt(0))
        .join('')
        .substring(0, 2)
        .toUpperCase();
      formLogoInitials.textContent = initials || 'CN';
    }
    if (formAddLogoBtn) {
      formAddLogoBtn.textContent = 'Add Logo';
    }
    window.formLogoUrl = null;
  }
}

// Setup form logo upload handler
function setupFormLogoUpload() {
  const formAddLogoBtn = $('#formAddLogoBtn');
  const formLogoInput = $('#formLogoInput');
  
  if (!formAddLogoBtn || !formLogoInput) return;
  
  // Remove existing handlers
  const newBtn = formAddLogoBtn.cloneNode(true);
  formAddLogoBtn.parentNode.replaceChild(newBtn, formAddLogoBtn);
  
  const newInput = $('#formLogoInput');
  const newAddBtn = $('#formAddLogoBtn');
  
  // Click on Add Logo button to trigger file input
  if (newAddBtn) {
    newAddBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (newInput) newInput.click();
    });
  }
  
  // Handle file selection
  if (newInput) {
    // Remove existing change handler if any
    if (newInput._formLogoChangeHandler) {
      newInput.removeEventListener('change', newInput._formLogoChangeHandler);
    }
    
    newInput._formLogoChangeHandler = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      // Validate file type
      if (!file.type.startsWith('image/')) {
        alert('Please select an image file');
        return;
      }
      
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB');
        return;
      }
      
      // Read file as data URL
      const reader = new FileReader();
      reader.onload = (event) => {
        const logoUrl = event.target.result;
        const nameInput = $('#clientName');
        const clientName = nameInput ? nameInput.value : '';
        updateFormLogo(logoUrl, clientName);
      };
      reader.onerror = () => {
        alert('Error reading file. Please try again.');
      };
      reader.readAsDataURL(file);
    };
    
    newInput.addEventListener('change', newInput._formLogoChangeHandler);
  }
  
  // Update initials when client name changes
  const nameInput = $('#clientName');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      if (!window.formLogoUrl) {
        // Only update initials if no logo is set
        const formLogoInitials = $('#formLogoInitials');
        if (formLogoInitials && formLogoInitials.style.display !== 'none') {
          const name = nameInput.value;
          const initials = (name || 'CN')
            .split(' ')
            .map(word => word.charAt(0))
            .join('')
            .substring(0, 2)
            .toUpperCase();
          formLogoInitials.textContent = initials || 'CN';
        }
      }
    });
  }
}

function hideNewClientModal() {
  const modal = $('#newClientModal');
  if (modal) {
    modal.classList.remove('show');
  }
}

function showFieldError(fieldId, message) {
  const errorEl = $(`#error-${fieldId}`);
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.add('show');
  }
}

function clearFieldError(fieldId) {
  const errorEl = $(`#error-${fieldId}`);
  if (errorEl) {
    errorEl.classList.remove('show');
    errorEl.textContent = '';
  }
}

function validateNewClientForm(isEditing) {
  let isValid = true;
  
  // Clear all errors
  $$('.error-message').forEach(el => {
    el.classList.remove('show');
    el.textContent = '';
  });
  
  // A) Client Identity
  const clientName = $('#clientName').value.trim();
  if (!clientName) {
    showFieldError('clientName', 'Client name is required');
    isValid = false;
  }
  
  const clientCategory = $('#clientCategory').value;
  if (!clientCategory) {
    showFieldError('clientCategory', 'Category is required');
    isValid = false;
  }
  
  // Client ID validation (only for new clients, editing uses existing ID)
  if (!isEditing) {
    const clientIdInput = $('#clientIdInput').value.trim().toLowerCase();
    if (clientIdInput && !/^[a-z0-9-]+$/.test(clientIdInput)) {
      showFieldError('clientIdInput', 'Client ID must contain only lowercase letters, numbers, and hyphens');
      isValid = false;
    }
  }
  
  // Password validation (required for new clients, optional for editing)
  if (!isEditing) {
    const password = $('#clientPassword').value;
    if (!password || password.length < 6) {
      showFieldError('clientPassword', 'Password must be at least 6 characters long');
      isValid = false;
    }
  } else {
    // For editing, password is optional but if provided must be at least 6 characters
    const password = $('#clientPassword').value;
    if (password && password.length < 6) {
      showFieldError('clientPassword', 'Password must be at least 6 characters long');
      isValid = false;
    }
  }
  
  // B) Primary Contact
  const primaryContactName = $('#primaryContactName').value.trim();
  if (!primaryContactName) {
    showFieldError('primaryContactName', 'Contact name is required');
    isValid = false;
  }
  
  const primaryContactWhatsApp = $('#primaryContactWhatsApp').value.trim();
  if (!primaryContactWhatsApp) {
    showFieldError('primaryContactWhatsApp', 'WhatsApp is required');
    isValid = false;
  }
  
  const primaryContactEmail = $('#primaryContactEmail').value.trim();
  if (!primaryContactEmail || !primaryContactEmail.includes('@')) {
    showFieldError('primaryContactEmail', 'Valid email is required');
    isValid = false;
  }
  
  const preferredChannel = $('#preferredChannel').value;
  if (!preferredChannel) {
    showFieldError('preferredChannel', 'Preferred channel is required');
    isValid = false;
  }
  
  // C) Platforms Managed
  const platformsCheckboxes = $$('input[name="platformsManaged"]:checked');
  if (platformsCheckboxes.length === 0) {
    showFieldError('platformsManaged', 'At least one platform must be selected');
    isValid = false;
  }
  
  return isValid;
}

function generateClientId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50);
}

function createNewClient() {
  // Check if we're editing or creating
  const isEditing = window.editingClientId;
  
  if (!validateNewClientForm(isEditing)) {
    return false;
  }
  
  const clients = loadClientsRegistry();
  
  // Get or generate client ID
  let clientId = $('#clientIdInput').value.trim().toLowerCase();
  
  if (isEditing) {
    // Editing mode - use existing client ID
    clientId = window.editingClientId;
  } else {
    // Creating new client
    if (!clientId) {
      // Auto-generate from name if empty
      clientId = generateClientId($('#clientName').value.trim());
      let counter = 1;
      while (clients[clientId]) {
        clientId = `${generateClientId($('#clientName').value.trim())}-${counter}`;
        counter++;
      }
    } else {
      // Validate client ID format
      if (!/^[a-z0-9-]+$/.test(clientId)) {
        showFieldError('clientIdInput', 'Client ID must contain only lowercase letters, numbers, and hyphens');
        return false;
      }
      // Check if client ID already exists (only for new clients)
      if (clients[clientId]) {
        showFieldError('clientIdInput', 'Client ID already exists. Please choose a different one.');
        return false;
      }
    }
  }
  
  // Validate password (only required for new clients, optional for editing)
  const password = $('#clientPassword').value;
  if (!isEditing && (!password || password.length < 6)) {
    showFieldError('clientPassword', 'Password must be at least 6 characters long');
    return false;
  }
  
  // Clear any previous errors for these fields
  clearFieldError('clientIdInput');
  if (!isEditing) clearFieldError('clientPassword');
  
  // Get platforms
  const platformsCheckboxes = $$('input[name="platformsManaged"]:checked');
  const platformsManaged = Array.from(platformsCheckboxes).map(cb => cb.value);
  
  // Get posting frequency
  const postingFrequency = $('#postingFrequency').value;
  const postingFrequencyNote = postingFrequency === 'custom' ? $('#postingFrequencyNote').value.trim() : '';
  
  // Create/update client object
  const existingClient = isEditing ? clients[clientId] : null;
  const clientData = {
    id: clientId,
    name: $('#clientName').value.trim(),
    category: $('#clientCategory').value,
    primaryContactName: $('#primaryContactName').value.trim(),
    primaryContactWhatsApp: $('#primaryContactWhatsApp').value.trim(),
    primaryContactEmail: $('#primaryContactEmail').value.trim(),
    preferredChannel: $('#preferredChannel').value,
    platformsManaged: platformsManaged,
    postingFrequency: postingFrequency,
    postingFrequencyNote: postingFrequencyNote,
    approvalRequired: $('#approvalRequired').value === 'true',
    language: $('#language').value,
    assetsLink: $('#assetsLink').value.trim() || '',
    brandGuidelinesLink: $('#brandGuidelinesLink').value.trim() || '',
    primaryGoal: $('#primaryGoal').value || '',
    secondaryGoal: $('#secondaryGoal').value.trim() || '',
    internalBehaviorType: $('#internalBehaviorType').value,
    riskLevel: $('#riskLevel').value,
    internalNotes: $('#internalNotes').value.trim() || '',
    logoUrl: window.formLogoUrl !== undefined ? window.formLogoUrl : (existingClient ? existingClient.logoUrl : undefined), // Use form logo if uploaded, otherwise preserve existing
    createdAt: existingClient ? existingClient.createdAt : Date.now(),
    updatedAt: Date.now()
  };
  
  // Save to clients registry
  clients[clientId] = clientData;
  saveClientsRegistry(clients);
  
  // Update login credentials (only if password was provided)
  const LS_CLIENTS_LOGIN_KEY = "2fly_clients_v1";
  const loginClients = JSON.parse(localStorage.getItem(LS_CLIENTS_LOGIN_KEY) || '{}');
  
  if (isEditing) {
    // Update existing login credentials (only update password if provided)
    if (password && password.length >= 6) {
      loginClients[clientId].password = password;
    }
    loginClients[clientId].name = clientData.name;
    loginClients[clientId].whatsapp = clientData.primaryContactWhatsApp;
  } else {
    // Create new login credentials
    loginClients[clientId] = {
      name: clientData.name,
      password: password,
      whatsapp: clientData.primaryContactWhatsApp,
      createdAt: Date.now()
    };
  }
  localStorage.setItem(LS_CLIENTS_LOGIN_KEY, JSON.stringify(loginClients));
  
  // Initialize/update client portal data (only create if new)
  if (!isEditing) {
    const portalKey = getClientPortalKey(clientId);
    const portalData = {
      client: { 
        id: clientId, 
        name: clientData.name, 
        whatsapp: clientData.primaryContactWhatsApp 
      },
      kpis: { scheduled: 0, waitingApproval: 0, missingAssets: 0, frustration: 0 },
      approvals: [],
      needs: [],
      requests: [],
      assets: [],
      activity: [],
      seen: false
    };
    localStorage.setItem(portalKey, JSON.stringify(portalData));
  } else {
    // Update client name in portal data if it changed
    const portalKey = getClientPortalKey(clientId);
    const portalData = localStorage.getItem(portalKey);
    if (portalData) {
      try {
        const data = JSON.parse(portalData);
        if (data.client) {
          data.client.name = clientData.name;
          data.client.whatsapp = clientData.primaryContactWhatsApp;
          localStorage.setItem(portalKey, JSON.stringify(data));
        }
      } catch(e) {
        console.error('Error updating portal data:', e);
      }
    }
  }
  
  // Select the client
  selectClient(clientId);
  
  // Show success message
  if (isEditing) {
    showToast(`Client "${clientData.name}" updated successfully!`);
  } else {
    showToast(`Client "${clientData.name}" created successfully!\n\nClient ID: ${clientId}\nPassword: ${password.substring(0, 3)}***`);
    // Also show alert with full credentials for easy copying
    alert(`Client "${clientData.name}" created successfully!\n\nClient ID: ${clientId}\nPassword: ${password}\n\nShare these credentials with the client for login.`);
  }
  
  // Close modal
  hideNewClientModal();
  
  return true;
}

function showToast(message, type = 'success') {
  // Simple toast notification with different types
  let bgColor = '#22c55e'; // success (green)
  if (type === 'error') bgColor = '#ef4444'; // error (red)
  if (type === 'info') bgColor = '#3b82f6'; // info (blue)
  
  const toast = el('div', {
    style: `position: fixed; top: 20px; right: 20px; background: ${bgColor}; color: white; padding: 12px 24px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.2); z-index: 10000; font-weight: 600; font-size: 14px;`
  }, message);
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Setup new client modal handlers
function setupNewClientHandlers() {
  const newClientBtn = $('#newClientBtn');
  if (newClientBtn) {
    newClientBtn.addEventListener('click', () => {
      showNewClientModal();
    });
  }

  const closeClientModal = $('#closeClientModal');
  if (closeClientModal) {
    closeClientModal.addEventListener('click', () => {
      hideNewClientModal();
    });
  }

  const cancelClientForm = $('#cancelClientForm');
  if (cancelClientForm) {
    cancelClientForm.addEventListener('click', () => {
      hideNewClientModal();
    });
  }
  
  // Setup form logo upload
  setupFormLogoUpload();

  // Close modal on overlay click
  const newClientModal = $('#newClientModal');
  if (newClientModal) {
    newClientModal.addEventListener('click', (e) => {
      if (e.target === newClientModal) {
        hideNewClientModal();
      }
    });
  }

  // Close modal on ESC key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modal = $('#newClientModal');
      if (modal && modal.classList.contains('show')) {
        hideNewClientModal();
      }
    }
  });

  // Handle posting frequency change
  const postingFrequency = $('#postingFrequency');
  if (postingFrequency) {
    postingFrequency.addEventListener('change', (e) => {
      const customGroup = $('#customFrequencyGroup');
      if (customGroup) {
        customGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
      }
    });
  }

  // Auto-generate client ID when name changes
  const clientNameInput = $('#clientName');
  if (clientNameInput) {
    clientNameInput.addEventListener('input', (e) => {
      const clientIdInput = $('#clientIdInput');
      if (clientIdInput && !clientIdInput.value.trim()) {
        // Only auto-generate if field is empty
        const generatedId = generateClientId(e.target.value.trim());
        if (generatedId) {
          clientIdInput.value = generatedId;
        }
      }
    });
  }

  // New client form submission
  const newClientForm = $('#newClientForm');
  if (newClientForm) {
    newClientForm.addEventListener('submit', (e) => {
      e.preventDefault();
      createNewClient();
    });
  }
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

// Setup PIN-based invite handlers
function setupPinInviteHandlers() {
  const pinInviteForm = $('#pinInviteForm');
  const submitBtn = $('#submitInviteBtn');
  const successMsg = $('#inviteSuccessMessage');
  const errorMsg = $('#inviteErrorMessage');
  
  if (!pinInviteForm) return;
  
  const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:3001' 
    : 'https://api.2flyflow.com';
  
  // Get agencyId from session or use default
  function getAgencyId() {
    const session = localStorage.getItem(LS_STAFF_SESSION_KEY);
    if (session) {
      try {
        const sessionData = JSON.parse(session);
        return sessionData.agencyId || 'agency_1737676800000_abc123';
      } catch {
        return 'agency_1737676800000_abc123';
      }
    }
    return 'agency_1737676800000_abc123';
  }
  
  pinInviteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Hide previous messages
    if (successMsg) successMsg.style.display = 'none';
    if (errorMsg) errorMsg.style.display = 'none';
    
    const email = $('#inviteEmail')?.value.trim();
    const pin = $('#invitePin')?.value.trim();
    
    if (!email || !pin) {
      if (errorMsg) {
        errorMsg.textContent = 'Please fill in all fields';
        errorMsg.style.display = 'block';
      }
      return;
    }
    
    // Disable submit button
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Sending...';
    }
    
    try {
      const agencyId = getAgencyId();
      const response = await fetch(`${API_BASE_URL}/api/users/invite-with-pin`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({ email, pin, agencyId })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to send invite');
      }
      
      // Show success message
      if (successMsg) {
        let message = `✅ Login credentials sent to ${email}`;
        if (data.credentials) {
          message += `\n\n📧 Credentials (DEV MODE):\nUsername: ${data.credentials.username}\nPassword: ${data.credentials.password}`;
        }
        successMsg.textContent = message;
        successMsg.style.display = 'block';
      }
      
      // Reset form
      pinInviteForm.reset();
      
      // Hide success message after 10 seconds
      setTimeout(() => {
        if (successMsg) successMsg.style.display = 'none';
      }, 10000);
      
    } catch (error) {
      console.error('PIN invite error:', error);
      if (errorMsg) {
        errorMsg.textContent = error.message || 'Failed to send invite. Please try again.';
        errorMsg.style.display = 'block';
      }
    } finally {
      // Re-enable submit button
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Send Login Credentials';
      }
    }
  });
}

// Setup settings modal
function setupSettingsModal() {
  const settingsBtn = $('#settingsBtn');
  const settingsModal = $('#settingsModal');
  const closeSettingsBtn = $('#closeSettingsBtn');
  const settingsModalOverlay = $('#settingsModalOverlay');
  const refreshUsersBtn = $('#refreshUsersBtn');
  
  // Open settings modal
  if (settingsBtn && settingsModal) {
    settingsBtn.addEventListener('click', () => {
      settingsModal.style.display = 'block';
      loadUsersList();
      loadClientsList();
    });
  }
  
  // Close settings modal
  if (closeSettingsBtn && settingsModal) {
    closeSettingsBtn.addEventListener('click', () => {
      settingsModal.style.display = 'none';
    });
  }
  
  if (settingsModalOverlay && settingsModal) {
    settingsModalOverlay.addEventListener('click', () => {
      settingsModal.style.display = 'none';
    });
  }
  
  // Refresh users list
  if (refreshUsersBtn) {
    refreshUsersBtn.addEventListener('click', () => loadUsersList());
  }
  const refreshClientsBtn = $('#refreshClientsBtn');
  if (refreshClientsBtn) {
    refreshClientsBtn.addEventListener('click', () => loadClientsList());
  }
  
  // Setup settings PIN invite form
  const settingsForm = $('#settingsPinInviteForm');
  const settingsSubmitBtn = $('#settingsSubmitInviteBtn');
  const settingsSuccessMsg = $('#settingsInviteSuccessMessage');
  const settingsErrorMsg = $('#settingsInviteErrorMessage');
  
  if (settingsForm) {
    const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
      ? 'http://localhost:3001' 
      : 'https://api.2flyflow.com';
    
    function getAgencyId() {
      const session = localStorage.getItem(LS_STAFF_SESSION_KEY);
      if (session) {
        try {
          const sessionData = JSON.parse(session);
          return sessionData.agencyId || 'agency_1737676800000_abc123';
        } catch {
          return 'agency_1737676800000_abc123';
        }
      }
      return 'agency_1737676800000_abc123';
    }
    
    settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      if (settingsSuccessMsg) settingsSuccessMsg.style.display = 'none';
      if (settingsErrorMsg) settingsErrorMsg.style.display = 'none';
      
      const name = $('#settingsInviteName')?.value.trim();
      const email = $('#settingsInviteEmail')?.value.trim();
      const pin = $('#settingsInvitePin')?.value.trim();
      
      if (!name || !email || !pin) {
        if (settingsErrorMsg) {
          settingsErrorMsg.textContent = 'Please fill in all fields';
          settingsErrorMsg.style.display = 'block';
        }
        return;
      }
      
      if (settingsSubmitBtn) {
        settingsSubmitBtn.disabled = true;
        settingsSubmitBtn.textContent = 'Sending...';
      }
      
      try {
        const agencyId = getAgencyId();
        const response = await fetch(`${API_BASE_URL}/api/users/invite-with-pin`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          credentials: 'include',
          body: JSON.stringify({ name, email, pin, agencyId })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
          throw new Error(data.error || 'Failed to send invite');
        }
        
        if (settingsSuccessMsg) {
          let message = `✅ Login credentials sent to ${email}`;
          if (data.credentials) {
            message += `\n\n📧 Credentials (DEV MODE):\nUsername: ${data.credentials.username}\nPassword: ${data.credentials.password}`;
          }
          settingsSuccessMsg.textContent = message;
          settingsSuccessMsg.style.display = 'block';
        }
        if (data.user && data.credentials) {
          const stored = JSON.parse(localStorage.getItem('2fly_staff_credentials_v1') || '{}');
          stored[data.user.id] = { username: data.credentials.username, password: data.credentials.password, email: data.user.email, name: data.user.name };
          localStorage.setItem('2fly_staff_credentials_v1', JSON.stringify(stored));
        }
        settingsForm.reset();
        loadUsersList();
        
        setTimeout(() => {
          if (settingsSuccessMsg) settingsSuccessMsg.style.display = 'none';
        }, 10000);
        
      } catch (error) {
        console.error('Settings PIN invite error:', error);
        if (settingsErrorMsg) {
          settingsErrorMsg.textContent = error.message || 'Failed to send invite. Please try again.';
          settingsErrorMsg.style.display = 'block';
        }
      } finally {
        if (settingsSubmitBtn) {
          settingsSubmitBtn.disabled = false;
          settingsSubmitBtn.textContent = 'Send Login Credentials';
        }
      }
    });
  }
  
  // Load users list
  async function loadUsersList() {
    const usersListContainer = $('#usersListContainer');
    if (!usersListContainer) return;
    
    usersListContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: #64748b;">Loading users...</div>';
    
    try {
      const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
        ? 'http://localhost:3001' 
        : 'https://api.2flyflow.com';
      
      function getAgencyId() {
        const session = localStorage.getItem(LS_STAFF_SESSION_KEY);
        if (session) {
          try {
            const sessionData = JSON.parse(session);
            return sessionData.agencyId || 'agency_1737676800000_abc123';
          } catch {
            return 'agency_1737676800000_abc123';
          }
        }
        return 'agency_1737676800000_abc123';
      }
      
      // Get auth token from cookie or session
      const response = await fetch(`${API_BASE_URL}/api/users?role=STAFF`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load users');
      }
      
      const storedCreds = JSON.parse(localStorage.getItem('2fly_staff_credentials_v1') || '{}');
      if (data.users && data.users.length > 0) {
        usersListContainer.innerHTML = '';
        data.users.forEach(user => {
          const userItem = document.createElement('div');
          userItem.className = 'user-item';
          
          const userInfo = document.createElement('div');
          userInfo.className = 'user-info';
          
          const userName = document.createElement('div');
          userName.className = 'user-name';
          userName.textContent = user.name || user.email;
          
          const userDetails = document.createElement('div');
          userDetails.className = 'user-details';
          
          const emailSpan = document.createElement('span');
          emailSpan.textContent = `Email: ${user.email}`;
          
          const usernameSpan = document.createElement('span');
          usernameSpan.textContent = `Username: ${user.username || user.email.split('@')[0]}`;
          
          const roleSpan = document.createElement('span');
          roleSpan.textContent = `Role: ${user.role}`;
          
          const statusSpan = document.createElement('span');
          statusSpan.className = `user-status ${user.status}`;
          statusSpan.textContent = user.status;
          
          userDetails.appendChild(emailSpan);
          userDetails.appendChild(usernameSpan);
          userDetails.appendChild(roleSpan);
          userDetails.appendChild(statusSpan);
          
          const cred = storedCreds[user.id] || (user.password ? { password: user.password } : null);
          const credentialsNote = document.createElement('div');
          credentialsNote.className = 'user-credentials';
          credentialsNote.style.marginTop = '8px';
          credentialsNote.style.padding = '8px';
          credentialsNote.style.background = '#f1f5f9';
          credentialsNote.style.borderRadius = '4px';
          credentialsNote.style.fontSize = '12px';
          credentialsNote.style.fontFamily = 'monospace';
          if (cred && cred.password) {
            credentialsNote.textContent = `Password: ${cred.password}`;
          } else {
            credentialsNote.textContent = `Password: [Set - not shown for security]`;
          }
          
          userInfo.appendChild(userName);
          userInfo.appendChild(userDetails);
          userInfo.appendChild(credentialsNote);
          
          userItem.appendChild(userInfo);
          
          const actions = document.createElement('div');
          actions.className = 'user-item-actions';
          actions.style.display = 'flex';
          actions.style.alignItems = 'center';
          actions.style.gap = '8px';
          actions.style.flexShrink = '0';
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'btn btn-secondary';
          delBtn.style.padding = '6px 12px';
          delBtn.style.fontSize = '12px';
          delBtn.style.background = '#fee2e2';
          delBtn.style.color = '#dc2626';
          delBtn.style.border = '1px solid #fecaca';
          delBtn.textContent = 'Delete';
          delBtn.addEventListener('click', async () => {
            if (!confirm(`Delete user "${user.name || user.email}"? They will no longer be able to log in.`)) return;
            try {
              const delRes = await fetch(`${API_BASE_URL}/api/users/${user.id}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' }
              });
              const delData = await delRes.json();
              if (!delRes.ok) throw new Error(delData.error || 'Delete failed');
              const s = JSON.parse(localStorage.getItem('2fly_staff_credentials_v1') || '{}');
              delete s[user.id];
              localStorage.setItem('2fly_staff_credentials_v1', JSON.stringify(s));
              loadUsersList();
            } catch (e) {
              alert('Failed to delete user: ' + (e.message || 'Unknown error'));
            }
          });
          actions.appendChild(delBtn);
          userItem.appendChild(actions);
          
          usersListContainer.appendChild(userItem);
        });
      } else {
        usersListContainer.innerHTML = '<div style="text-align: center; padding: 20px; color: #64748b;">No users found</div>';
      }
    } catch (error) {
      console.error('Load users error:', error);
      usersListContainer.innerHTML = `<div style="text-align: center; padding: 20px; color: #dc2626;">Error loading users: ${error.message}</div>`;
    }
  }
  
  function loadClientsList() {
    const container = $('#clientsListContainer');
    if (!container) return;
    const loginClients = JSON.parse(localStorage.getItem('2fly_clients_v1') || '{}');
    const registry = loadClientsRegistry();
    const list = Object.keys(registry).filter(k => k !== '_lastSelected').map(id => {
      const c = registry[id];
      const login = loginClients[id] || {};
      return { id, name: c.name || id, password: login.password || null };
    });
    if (list.length === 0) {
      container.innerHTML = '<div style="text-align: center; padding: 20px; color: #64748b;">No clients yet. Create clients from the sidebar.</div>';
      return;
    }
    container.innerHTML = '';
    list.forEach(({ id, name, password }) => {
      const card = document.createElement('div');
      card.className = 'user-item';
      card.style.marginBottom = '12px';
      card.innerHTML = `
        <div class="user-info">
          <div class="user-name">${escapeHtml(name)}</div>
          <div class="user-details" style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; font-size: 13px; color: #64748b;">
            <span>Client ID: <code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${escapeHtml(id)}</code></span>
            <span>Password: ${password ? `<code style="background: #e2e8f0; padding: 2px 6px; border-radius: 4px;">${escapeHtml(password)}</code>` : '[not set]'}</span>
          </div>
        </div>`;
      container.appendChild(card);
    });
  }
  
  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }
  
  window.loadUsersList = loadUsersList;
  window.loadClientsList = loadClientsList;
}

// Setup reports handlers
function setupReportsHandlers() {
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
}

/* ================== Render All ================== */
function renderAll() {
  renderClientsSidebar();
  renderClientHeader();
  // Only render the current tab (switchTab will handle rendering)
  // This prevents duplicate rendering during initialization
  switchTab(currentTab);
}

/* ================== Staff Header ================== */
function updateStaffHeader() {
  if (!currentStaff) return;
  
  const staffNameEl = $('#staffName');
  const staffAvatarEl = $('#staffAvatar');
  
  if (staffNameEl) {
    staffNameEl.textContent = currentStaff.name || currentStaff.fullName || currentStaff.username || 'Team Member';
  }
  
  if (staffAvatarEl) {
    // Get initials from name (from Register form / API), fullName, or username
    const name = currentStaff.name || currentStaff.fullName || currentStaff.username || 'TM';
    const initials = name
      .split(' ')
      .map(word => word.charAt(0))
      .join('')
      .substring(0, 2)
      .toUpperCase();
    staffAvatarEl.textContent = initials || 'TM';
  }
  
  // Setup logout button
  const logoutBtn = $('#logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to logout?')) {
        logout();
      }
    });
  }
}

/* ================== Image Upload ================== */
let uploadedImages = []; // Array of { name, dataUrl, size }

// Compress image to reduce localStorage size
function compressImage(file, maxWidth = 1920, maxHeight = 1920, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        // Calculate new dimensions
        let width = img.width;
        let height = img.height;
        
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = (height * maxWidth) / width;
            width = maxWidth;
          } else {
            width = (width * maxHeight) / height;
            height = maxHeight;
          }
        }
        
        // Create canvas and compress
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        // Convert to JPEG (smaller than PNG) with compression
        const compressedDataUrl = canvas.toDataURL('image/jpeg', quality);
        
        resolve({
          name: file.name,
          dataUrl: compressedDataUrl,
          size: compressedDataUrl.length, // Approximate size
          type: 'image/jpeg',
          originalSize: file.size
        });
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Setup image upload handlers
function setupImageUpload() {
  const fileInput = $('#approvalImageUpload');
  if (!fileInput) return;
  
  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    
    // Limit to 3 images max to prevent quota issues
    if (uploadedImages.length + files.length > 3) {
      showToast('Maximum 3 images allowed. Please remove some images first.', 'error');
      fileInput.value = '';
      return;
    }
    
    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        showToast(`${file.name} is not an image file`, 'error');
        continue;
      }
      
      // Check file size (max 10MB before compression)
      if (file.size > 10 * 1024 * 1024) {
        showToast(`${file.name} is too large. Maximum size is 10MB.`, 'error');
        continue;
      }
      
      try {
        showToast(`Compressing ${file.name}...`, 'info');
        const compressed = await compressImage(file);
        
        // Check if compressed image is still too large (max 2MB per image)
        if (compressed.size > 2 * 1024 * 1024) {
          // Try with lower quality
          const moreCompressed = await compressImage(file, 1600, 1600, 0.6);
          if (moreCompressed.size > 2 * 1024 * 1024) {
            showToast(`${file.name} is still too large after compression. Please use a smaller image.`, 'error');
            continue;
          }
          uploadedImages.push(moreCompressed);
        } else {
          uploadedImages.push(compressed);
        }
        
        displayUploadedImages();
        showToast(`${file.name} uploaded successfully`, 'success');
      } catch (error) {
        console.error('Error compressing image:', error);
        showToast(`Error processing ${file.name}`, 'error');
      }
    }
    
    // Reset input to allow selecting the same file again
    fileInput.value = '';
  });
}

// Display uploaded images
function displayUploadedImages() {
  const previewContainer = $('#uploadedImagesPreview');
  const imagesList = $('#uploadedImagesList');
  
  if (!previewContainer || !imagesList) return;
  
  if (uploadedImages.length === 0) {
    previewContainer.style.display = 'none';
    return;
  }
  
  previewContainer.style.display = 'block';
  imagesList.innerHTML = '';
  
  uploadedImages.forEach((image, index) => {
    const imageWrapper = el('div', {
      class: 'uploaded-image-preview'
    });
    
    const img = el('img', {
      src: image.dataUrl,
      alt: image.name,
      style: 'width: 100%; height: 100%; object-fit: cover;'
    });
    
    const removeBtn = el('button', {
      class: 'remove-image',
      type: 'button',
      'aria-label': 'Remove image'
    });
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      uploadedImages = uploadedImages.filter((_, i) => i !== index);
      displayUploadedImages();
    });
    
    imageWrapper.appendChild(img);
    imageWrapper.appendChild(removeBtn);
    imagesList.appendChild(imageWrapper);
  });
}

/* ================== Initialize ================== */
document.addEventListener('DOMContentLoaded', () => {
  try {
    console.log('Agency dashboard loaded');
    // Check authentication first
    if (!currentStaff) {
      console.log('No staff session, redirecting to staff login');
      setTimeout(() => {
        if (!currentStaff) {
          window.location.href = staffLoginUrl();
        }
      }, 100);
      return;
    }
    console.log('Staff authenticated:', currentStaff.name || currentStaff.username || currentStaff.fullName);
    
    // Update staff header
    try {
      updateStaffHeader();
    } catch (e) {
      console.error('Error updating staff header:', e);
    }
    
    // Initialize clients registry and set current client
    let clients;
    try {
      clients = loadClientsRegistry();
      if (!currentClientId && Object.keys(clients).length > 0) {
        // Use last selected or first client
        currentClientId = clients._lastSelected || Object.keys(clients)[0];
      }
    } catch (e) {
      console.error('Error loading clients registry:', e);
      clients = {};
    }
    
    // Restore saved tab from localStorage
    const savedTab = localStorage.getItem('2fly_agency_current_tab');
    if (savedTab) {
      currentTab = savedTab;
    }
    
    // Setup all event handlers with error handling
    try {
      setupTabHandlers();
      console.log('Tab handlers set up');
    } catch (e) {
      console.error('Error setting up tab handlers:', e);
    }
    
    try {
      setupApprovalHandlers();
      console.log('Approval handlers set up');
    } catch (e) {
      console.error('Error setting up approval handlers:', e);
    }
    
    try {
      setupRequestsHandlers();
      console.log('Request handlers set up');
    } catch (e) {
      console.error('Error setting up request handlers:', e);
    }
    
    try {
      setupNeedsHandlers();
      console.log('Needs handlers set up');
    } catch (e) {
      console.error('Error setting up needs handlers:', e);
    }
    
    try {
      setupAssetHandlers();
      console.log('Asset handlers set up');
    } catch (e) {
      console.error('Error setting up asset handlers:', e);
    }
    
    try {
      setupNewClientHandlers();
      console.log('New client handlers set up');
    } catch (e) {
      console.error('Error setting up new client handlers:', e);
    }
    
    try {
      setupReportsHandlers();
      console.log('Reports handlers set up');
    } catch (e) {
      console.error('Error setting up reports handlers:', e);
    }
    
    try {
      setupPinInviteHandlers();
      console.log('PIN invite handlers set up');
    } catch (e) {
      console.error('Error setting up PIN invite handlers:', e);
    }
    
    try {
      setupSettingsModal();
      console.log('Settings modal handlers set up');
    } catch (e) {
      console.error('Error setting up settings modal:', e);
    }
    
    try {
      setupLogoUpload();
      console.log('Logo upload handlers set up');
    } catch (e) {
      console.error('Error setting up logo upload handlers:', e);
    }
    
    // Render initial view
    try {
      renderAll();
      console.log('Initial view rendered');
    } catch (e) {
      console.error('Error rendering initial view:', e);
    }
    
    // Switch to saved tab to ensure UI is updated correctly
    if (savedTab) {
      try {
        switchTab(savedTab);
        console.log('Switched to saved tab:', savedTab);
      } catch (e) {
        console.error('Error switching to saved tab:', e);
      }
    }
    
    console.log('Agency dashboard initialization complete');
  } catch (e) {
    console.error('Fatal error during agency dashboard initialization:', e);
    alert('An error occurred while loading the dashboard. Please check the console for details.');
  }
});

