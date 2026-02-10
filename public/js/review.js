// ─── State ────────────────────────────────────────────────────
let projectId = null;
let creativeId = null;
let project = null;
let creative = null;
let creativeIndex = -1;
let currentAuthTab = 'guest';
let devToken = null;
let savedTitle = '';
let savedCaption = '';
let savedImageText = '';
let zoomLevel = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let pinMode = false;
let pendingPin = null; // { x, y } percentages
let pinsVisible = false;
let activePinCommentId = null;

// ─── Identity & Auth ──────────────────────────────────────────
function getIdentity() {
  try {
    const data = localStorage.getItem('reviewflow_identity');
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

function setIdentity(name, email, userId) {
  const data = { name };
  if (email) data.email = email;
  if (userId) data.userId = userId;
  localStorage.setItem('reviewflow_identity', JSON.stringify(data));
}

function getToken() {
  return localStorage.getItem('reviewflow_token');
}

function isSignedIn() {
  const token = getToken();
  if (!token) return false;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 > Date.now();
  } catch { return false; }
}

function showIdentityModal() {
  const modal = document.getElementById('identity-modal');
  const closeBtn = document.getElementById('identity-close-btn');
  const identity = getIdentity();

  // Show close button if already has identity (changing, not first visit)
  closeBtn.style.display = identity && identity.name ? 'block' : 'none';

  // Pre-fill
  if (identity) {
    document.getElementById('identity-name').value = identity.name || '';
    const signinEmail = document.getElementById('signin-email');
    const signinName = document.getElementById('signin-name');
    if (identity.email && signinEmail) signinEmail.value = identity.email;
    if (identity.name && signinName) signinName.value = identity.name;
  }

  // Reset state (guard for guest-only mode where these elements don't exist)
  const magicLinkSent = document.getElementById('magic-link-sent');
  if (magicLinkSent) magicLinkSent.style.display = 'none';
  const submitBtn = document.getElementById('auth-submit-btn');
  if (submitBtn) submitBtn.style.display = '';
  devToken = null;

  // Default to guest mode
  currentAuthTab = 'guest';

  modal.style.display = 'flex';
  setTimeout(() => {
    document.getElementById('identity-name').focus();
  }, 100);
}

function hideIdentityModal() {
  document.getElementById('identity-modal').style.display = 'none';
}

function switchAuthTab(tab) {
  currentAuthTab = tab;
  document.getElementById('tab-signin').classList.toggle('active', tab === 'signin');
  document.getElementById('tab-guest').classList.toggle('active', tab === 'guest');
  document.getElementById('auth-signin').style.display = tab === 'signin' ? 'block' : 'none';
  document.getElementById('auth-guest').style.display = tab === 'guest' ? 'block' : 'none';
  document.getElementById('auth-submit-btn').textContent = tab === 'signin' ? 'Send Sign-In Link' : 'Continue as Guest';

  // Reset magic link sent state when switching tabs
  document.getElementById('magic-link-sent').style.display = 'none';
  document.getElementById('auth-submit-btn').style.display = '';
}

async function submitAuth() {
  if (currentAuthTab === 'guest') {
    // Guest mode
    const name = document.getElementById('identity-name').value.trim();
    if (!name) {
      showToast('Please enter your name', 'error');
      return;
    }
    setIdentity(name);
    localStorage.removeItem('reviewflow_token');
    hideIdentityModal();
    updateIdentityDisplay();
  } else {
    // Magic link sign in
    const email = document.getElementById('signin-email').value.trim();
    const name = document.getElementById('signin-name').value.trim();
    if (!email) {
      showToast('Please enter your email', 'error');
      return;
    }

    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name })
      });
      const data = await res.json();

      // Save redirect URL so after verification we come back here
      localStorage.setItem('reviewflow_redirect', window.location.href);

      // Show response message
      const sentDiv = document.getElementById('magic-link-sent');
      sentDiv.style.display = 'flex';
      sentDiv.querySelector('p').textContent = data.message || 'Check your email for a sign-in link!';
      document.getElementById('auth-submit-btn').style.display = 'none';

      // Show direct sign-in button when devToken is provided (dev mode or email failure)
      if (data.devToken) {
        devToken = data.devToken;
        document.getElementById('dev-token-hint').style.display = 'block';
      }
    } catch (err) {
      showToast('Failed to send sign-in link', 'error');
    }
  }
}

async function useDevToken() {
  if (!devToken) return;
  try {
    const res = await fetch('/api/auth/verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: devToken })
    });
    const data = await res.json();
    if (data.token && data.user) {
      localStorage.setItem('reviewflow_token', data.token);
      setIdentity(data.user.name, data.user.email, data.user.id);
      hideIdentityModal();
      updateIdentityDisplay();
      showToast(`Signed in as ${data.user.name}`);
    }
  } catch (err) {
    showToast('Sign in failed', 'error');
  }
}

function signOut() {
  localStorage.removeItem('reviewflow_token');
  localStorage.removeItem('reviewflow_identity');
  updateIdentityDisplay();
  showIdentityModal();
}

function updateIdentityDisplay() {
  const identity = getIdentity();
  const el = document.getElementById('commenting-as');
  const signoutBtn = document.getElementById('signout-btn');
  const signed = isSignedIn();

  if (identity && identity.name) {
    el.textContent = `Commenting as ${identity.name}`;
    if (signed) {
      el.textContent += ' (signed in)';
      signoutBtn.style.display = 'inline';
    } else {
      signoutBtn.style.display = 'none';
    }
  } else {
    el.textContent = 'Anonymous';
    signoutBtn.style.display = 'none';
  }
}

function checkIdentity() {
  const identity = getIdentity();
  if (!identity || !identity.name) {
    showIdentityModal();
  }
  updateIdentityDisplay();
}

// ─── Admin Check (for version uploads) ───────────────────────
function getAdminToken() {
  return localStorage.getItem('rf_admin_token');
}

function isAdmin() {
  return !!getAdminToken();
}

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyInstantSettings();
  loadAppSettings();
  parseUrl();
  setupKeyboardNav();
  setupModalKeys();
  setupVersionUpload();
  setupZoom();
});

// ─── Settings (read-only on review page) ─────────────────────
function applyInstantSettings() {
  const savedTheme = localStorage.getItem('rf_theme');
  const savedAccent = localStorage.getItem('rf_accent');
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  if (savedAccent) {
    document.documentElement.style.setProperty('--accent', savedAccent);
    const r = parseInt(savedAccent.slice(1,3), 16);
    const g = parseInt(savedAccent.slice(3,5), 16);
    const b = parseInt(savedAccent.slice(5,7), 16);
    document.documentElement.style.setProperty('--accent-hover', `rgb(${Math.min(r+30,255)}, ${Math.min(g+30,255)}, ${Math.min(b+30,255)})`);
    document.documentElement.style.setProperty('--accent-bg', `rgba(${r}, ${g}, ${b}, 0.1)`);
  }
}

async function loadAppSettings() {
  try {
    const res = await fetch('/api/settings');
    const s = await res.json();

    // Theme
    document.documentElement.setAttribute('data-theme', s.theme || 'dark');

    // Accent
    if (s.accentColor) {
      const r = parseInt(s.accentColor.slice(1,3), 16);
      const g = parseInt(s.accentColor.slice(3,5), 16);
      const b = parseInt(s.accentColor.slice(5,7), 16);
      document.documentElement.style.setProperty('--accent', s.accentColor);
      document.documentElement.style.setProperty('--accent-hover', `rgb(${Math.min(r+30,255)}, ${Math.min(g+30,255)}, ${Math.min(b+30,255)})`);
      document.documentElement.style.setProperty('--accent-bg', `rgba(${r}, ${g}, ${b}, 0.1)`);
    }

    // Brand name
    const brandEl = document.getElementById('brand-name');
    if (brandEl) brandEl.textContent = s.brandName || 'ReviewFlow';

    // Logo — hide brand text when custom logo is set
    const defaultIcon = document.getElementById('logo-default-icon');
    const customImg = document.getElementById('logo-custom-img');
    const brandText = document.getElementById('brand-name');
    if (s.logoUrl && customImg) {
      customImg.src = s.logoUrl;
      customImg.style.display = 'block';
      if (defaultIcon) defaultIcon.style.display = 'none';
      if (brandText) brandText.style.display = 'none';
    }
  } catch { /* use defaults */ }
}

function parseUrl() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  // /review/:projectId or /review/:projectId/:creativeId
  if (parts.length >= 2 && parts[0] === 'review') {
    projectId = parts[1];

    // Show admin panel link if user is admin
    const adminPanelBtn = document.getElementById('admin-panel-btn');
    if (adminPanelBtn && getAdminToken()) {
      adminPanelBtn.style.display = 'inline-flex';
    }

    if (parts.length >= 3) {
      creativeId = parts[2];
      loadCreative();
    } else {
      loadProjectOverview();
    }
  }
}

// ─── PDF Export ──────────────────────────────────────────────
function downloadPDF() {
  if (!projectId) return;
  showToast('Generating PDF...');
  const link = document.createElement('a');
  link.href = `/api/projects/${projectId}/export-pdf`;
  link.click();
}

// ─── Download Creatives ──────────────────────────────────────
function downloadAllCreatives() {
  if (!projectId) return;
  showToast('Preparing download...');
  const link = document.createElement('a');
  link.href = `/api/projects/${projectId}/download-all`;
  link.click();
}

function downloadCreative() {
  if (!projectId || !creativeId) return;
  const link = document.createElement('a');
  link.href = `/api/projects/${projectId}/creatives/${creativeId}/download`;
  link.click();
}

// ─── Project Overview ─────────────────────────────────────────
async function loadProjectOverview() {
  try {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) throw new Error('Not found');
    project = await res.json();
    renderProjectOverview();
  } catch (err) {
    showToast('Project not found', 'error');
  }
}

function renderProjectOverview() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('project-overview').style.display = 'block';
  document.title = `${project.name} - Review`;

  // Logo links back to project overview, not dashboard
  document.getElementById('logo-link').href = `/review/${projectId}`;

  document.getElementById('overview-project-name').textContent = project.name;
  document.getElementById('overview-client-name').textContent =
    project.clientName ? `Client: ${project.clientName}` : '';

  const total = project.creatives.length;
  const approved = project.creatives.filter(c => c.status === 'approved').length;
  const pending = project.creatives.filter(c => c.status === 'pending').length;
  const revision = project.creatives.filter(c => c.status === 'revision_requested').length;
  const pct = total > 0 ? Math.round((approved / total) * 100) : 0;

  document.getElementById('ov-approved').textContent = approved;
  document.getElementById('ov-pending').textContent = pending;
  document.getElementById('ov-revision').textContent = revision;
  document.getElementById('ov-progress-fill').style.width = `${pct}%`;

  const grid = document.getElementById('overview-grid');
  if (total === 0) {
    grid.innerHTML = '<p class="no-creatives">No creatives in this project yet.</p>';
    return;
  }

  grid.innerHTML = project.creatives.map(c => {
    const statusClass = c.status === 'approved' ? 'approved' :
                        c.status === 'revision_requested' ? 'revision' : 'pending';
    const statusLabel = c.status === 'approved' ? 'Approved' :
                        c.status === 'revision_requested' ? 'Revision Requested' : 'Pending Review';

    let thumbnail = '';
    if (c.mediaType === 'video') {
      thumbnail = `
        <div class="thumb-video">
          <video src="${c.filePath}" preload="metadata"></video>
          <div class="play-badge">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          </div>
        </div>`;
    } else if (c.mediaType === 'pdf') {
      thumbnail = `
        <div class="thumb-pdf">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
          <span>PDF</span>
        </div>`;
    } else {
      thumbnail = `<img src="${c.filePath}" alt="${escapeHtml(c.originalName)}" loading="lazy">`;
    }

    return `
      <a href="/review/${projectId}/${c.id}" class="creative-card">
        <div class="creative-thumb">${thumbnail}</div>
        <div class="creative-info">
          <div class="creative-name" title="${escapeHtml(c.originalName)}">${escapeHtml(c.title || c.originalName)}</div>
          <div class="creative-meta">
            <span class="status-badge status-${statusClass}">${statusLabel}</span>
            <span class="comment-count">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
              ${c.comments.length}
            </span>
          </div>
        </div>
      </a>
    `;
  }).join('');

  // Ask for identity after rendering (so page always displays even if modal has issues)
  checkIdentity();
}

// ─── Single Creative Review ──────────────────────────────────
async function loadCreative() {
  try {
    // Load full project for navigation
    const projRes = await fetch(`/api/projects/${projectId}`);
    if (!projRes.ok) throw new Error('Project not found');
    project = await projRes.json();

    // Find creative
    creative = project.creatives.find(c => c.id === creativeId);
    if (!creative) throw new Error('Creative not found');

    creativeIndex = project.creatives.findIndex(c => c.id === creativeId);

    renderCreativeReview();
  } catch (err) {
    showToast('Creative not found', 'error');
  }
}

function renderCreativeReview() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('review-content').style.display = 'flex';
  document.title = `${creative.title || creative.originalName} - Review`;

  // Logo links back to project overview, not dashboard
  document.getElementById('logo-link').href = `/review/${projectId}`;

  // Navigation controls (header + media arrows)
  const navControls = document.getElementById('nav-controls');
  const mediaPrev = document.getElementById('media-prev-btn');
  const mediaNext = document.getElementById('media-next-btn');
  if (project.creatives.length > 1) {
    navControls.style.display = 'flex';
    document.getElementById('creative-counter').textContent =
      `${creativeIndex + 1} of ${project.creatives.length}`;
    document.getElementById('prev-btn').disabled = creativeIndex === 0;
    document.getElementById('next-btn').disabled = creativeIndex === project.creatives.length - 1;
    // Media panel arrows
    if (creativeIndex > 0) mediaPrev.style.display = 'flex';
    if (creativeIndex < project.creatives.length - 1) mediaNext.style.display = 'flex';
  }

  // Back to all creatives link (in header nav)
  const backLink = document.getElementById('back-to-all');
  const navDivider = document.getElementById('nav-divider');
  if (backLink) {
    backLink.href = `/review/${projectId}`;
    backLink.style.display = 'inline-flex';
    if (navDivider) navDivider.style.display = '';
    backLink.onclick = (e) => {
      if (hasUnsavedChanges() && !confirm('You have unsaved changes. Leave without saving?')) {
        e.preventDefault();
      }
    };
  }

  // Media
  renderMedia();

  // Filename
  document.getElementById('media-filename').textContent = creative.originalName;

  // Status
  updateStatusBanner();

  // Title & Caption
  document.getElementById('creative-title').value = creative.title || '';
  document.getElementById('creative-caption').value = creative.caption || '';
  savedTitle = creative.title || '';
  savedCaption = creative.caption || '';
  savedImageText = (creative.imageText && creative.imageText.current) ? creative.imageText.current : '';

  // Caption tracking
  showCaptionTracking();

  // Comments
  renderComments();

  // Image Text (OCR) section
  showImageTextSection();

  // Version section (admin only)
  showVersionSection();

  // Delete button (admin only)
  const deleteBtn = document.getElementById('delete-creative-btn');
  if (deleteBtn && isAdmin()) {
    deleteBtn.style.display = 'flex';
  }

  // Ask for identity after rendering (so page always displays even if modal has issues)
  checkIdentity();
}

function renderMedia() {
  const container = document.getElementById('media-container');

  // Reset zoom when media changes
  zoomLevel = 1;
  panX = 0;
  panY = 0;
  applyZoom();

  if (creative.mediaType === 'video') {
    container.innerHTML = `
      <video controls preload="metadata" class="media-content">
        <source src="${creative.filePath}" type="${creative.mimeType}">
        Your browser does not support video playback.
      </video>`;
    container.querySelector('video').addEventListener('error', () => showMediaError(container));
  } else if (creative.mediaType === 'pdf') {
    container.innerHTML = `
      <iframe src="${creative.filePath}" class="media-content media-pdf" title="PDF Preview"></iframe>`;
  } else {
    container.innerHTML = `
      <img src="${creative.filePath}" alt="${escapeHtml(creative.originalName)}" class="media-content" draggable="false">`;
    container.querySelector('img').addEventListener('error', () => showMediaError(container));
  }

  // Show zoom controls for images only
  const zoomControls = document.getElementById('zoom-controls');
  if (zoomControls) {
    zoomControls.style.display = creative.mediaType === 'image' ? 'flex' : 'none';
  }

  // Render pin markers
  activePinCommentId = null;
  renderPins();
}

function showMediaError(container) {
  container.innerHTML = `
    <div class="media-error">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
        <circle cx="8.5" cy="8.5" r="1.5"></circle>
        <polyline points="21 15 16 10 5 21"></polyline>
      </svg>
      <p>File not found</p>
      <span>This file may need to be re-uploaded.</span>
    </div>`;
}

function updateStatusBanner() {
  const banner = document.getElementById('status-banner');
  const icon = document.getElementById('status-icon');
  const text = document.getElementById('status-text');

  banner.className = 'status-banner';

  if (creative.status === 'approved') {
    banner.classList.add('status-approved');
    icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    text.textContent = 'Approved';
  } else if (creative.status === 'revision_requested') {
    banner.classList.add('status-revision');
    icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>';
    text.textContent = `Revision Requested (Rev. ${creative.revisionNumber || 1})`;
  } else {
    banner.classList.add('status-pending');
    icon.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>';
    text.textContent = 'Pending Review';
  }
}

// ─── Actions ─────────────────────────────────────────────────
async function saveDetails() {
  const identity = getIdentity();
  const author = (identity && identity.name) ? identity.name : 'Anonymous';
  const title = document.getElementById('creative-title').value;
  const caption = document.getElementById('creative-caption').value;

  try {
    const body = { title, caption };
    // Track caption changes with author if caption was modified
    if (caption !== savedCaption) {
      body.captionAuthor = author;
    }
    const res = await fetch(`/api/projects/${projectId}/creatives/${creativeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    creative = await res.json();
    savedTitle = creative.title || '';
    savedCaption = creative.caption || '';
    showCaptionTracking();
    showToast('Details saved!');
  } catch (err) {
    showToast('Failed to save', 'error');
  }
}

function hasUnsavedChanges() {
  if (!creative) return false;
  const currentTitle = document.getElementById('creative-title')?.value || '';
  const currentCaption = document.getElementById('creative-caption')?.value || '';
  const currentImageText = document.getElementById('image-text-input')?.value || '';
  return currentTitle !== savedTitle || currentCaption !== savedCaption || currentImageText !== savedImageText;
}

async function setStatus(status) {
  try {
    const res = await fetch(`/api/projects/${projectId}/creatives/${creativeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    creative = await res.json();
    updateStatusBanner();

    const label = status === 'approved' ? 'Approved!' :
                  status === 'revision_requested' ? 'Revision requested' : 'Reset to pending';
    showToast(label);
  } catch (err) {
    showToast('Failed to update status', 'error');
  }
}

async function deleteCreative() {
  if (!confirm('Are you sure you want to delete this creative? This cannot be undone.')) {
    return;
  }

  const adminToken = getAdminToken();
  if (!adminToken) {
    showToast('Admin login required', 'error');
    return;
  }

  try {
    const res = await fetch(`/api/projects/${projectId}/creatives/${creativeId}`, {
      method: 'DELETE',
      headers: { 'x-admin-token': adminToken }
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to delete');
    }

    showToast('Creative deleted');
    // Navigate back to project overview
    window.location.href = `/review/${projectId}`;
  } catch (err) {
    showToast(err.message || 'Failed to delete creative', 'error');
  }
}

// ─── Comments ────────────────────────────────────────────────
function renderComments() {
  const list = document.getElementById('comments-list');
  const countBadge = document.getElementById('comment-count');
  countBadge.textContent = creative.comments.length;

  if (creative.comments.length === 0) {
    list.innerHTML = '<p class="no-comments">No comments yet</p>';
    return;
  }

  const pinnedComments = creative.comments.filter(c => c.pinX !== undefined);
  let pinNum = 0;
  list.innerHTML = creative.comments.map(c => {
    const isPinned = c.pinX !== undefined && c.pinY !== undefined;
    if (isPinned) pinNum++;
    const pinBadge = isPinned ? `<span class="comment-pin-badge" onclick="focusPin('${c.id}')" title="Show pin on image">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path></svg>
      ${pinNum}</span>` : '';
    const isResolved = !!c.resolved;
    const resolvedBadge = isResolved ? '<span class="comment-resolved-badge">Resolved</span>' : '';
    const resolveBtn = `<button class="comment-resolve-btn ${isResolved ? 'resolved' : ''}" onclick="resolveComment('${c.id}')" title="${isResolved ? 'Unresolve' : 'Mark as resolved'}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
    </button>`;
    return `
    <div class="comment ${isPinned ? 'comment-pinned' : ''} ${isResolved ? 'comment-resolved' : ''}" id="comment-${c.id}" data-comment-id="${c.id}">
      <div class="comment-header">
        ${pinBadge}
        <strong class="comment-author">${escapeHtml(c.author)}</strong>
        ${resolvedBadge}
        <span class="comment-date">${formatDate(c.createdAt)}</span>
        <div class="comment-actions">
          ${resolveBtn}
          <button class="comment-delete" onclick="deleteComment('${c.id}')" title="Delete comment">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>
      <p class="comment-text">${escapeHtml(c.text)}</p>
    </div>
  `;}).join('');

  // Scroll to bottom of comments
  list.scrollTop = list.scrollHeight;
}

async function addComment() {
  const identity = getIdentity();
  const author = (identity && identity.name) ? identity.name : 'Anonymous';
  const text = document.getElementById('comment-text').value.trim();

  if (!identity || !identity.name) {
    showIdentityModal();
    return;
  }

  if (!text) {
    showToast('Please enter a comment', 'error');
    return;
  }

  try {
    const body = { author, text };
    if (pendingPin) {
      body.pinX = pendingPin.x;
      body.pinY = pendingPin.y;
    }
    const res = await fetch(`/api/projects/${projectId}/creatives/${creativeId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const comment = await res.json();
    creative.comments.push(comment);
    cancelPin();
    renderComments();
    renderPins();
    document.getElementById('comment-text').value = '';
    showToast(body.pinX !== undefined ? 'Pin comment posted' : 'Comment posted');
  } catch (err) {
    showToast('Failed to post comment', 'error');
  }
}

async function deleteComment(commentId) {
  try {
    await fetch(`/api/projects/${projectId}/creatives/${creativeId}/comments/${commentId}`, {
      method: 'DELETE'
    });
    creative.comments = creative.comments.filter(c => c.id !== commentId);
    if (activePinCommentId === commentId) activePinCommentId = null;
    renderComments();
    renderPins();
  } catch (err) {
    showToast('Failed to delete comment', 'error');
  }
}

async function resolveComment(commentId) {
  const comment = creative.comments.find(c => c.id === commentId);
  if (!comment) return;

  const newResolved = !comment.resolved;
  try {
    const res = await fetch(`/api/projects/${projectId}/creatives/${creativeId}/comments/${commentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: newResolved })
    });
    const updated = await res.json();
    const idx = creative.comments.findIndex(c => c.id === commentId);
    if (idx !== -1) {
      creative.comments[idx] = { ...creative.comments[idx], ...updated };
    }
    renderComments();
    showToast(newResolved ? 'Comment resolved' : 'Comment unresolved');
  } catch (err) {
    showToast('Failed to update comment', 'error');
  }
}

// ─── Navigation ──────────────────────────────────────────────
function navigateCreative(direction) {
  const newIndex = creativeIndex + direction;
  if (newIndex < 0 || newIndex >= project.creatives.length) return;
  if (hasUnsavedChanges()) {
    if (!confirm('You have unsaved changes. Leave without saving?')) return;
  }
  const nextCreative = project.creatives[newIndex];
  window.location.href = `/review/${projectId}/${nextCreative.id}`;
}

// Warn on browser navigation/close with unsaved changes
window.addEventListener('beforeunload', (e) => {
  if (hasUnsavedChanges()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

function setupKeyboardNav() {
  document.addEventListener('keydown', e => {
    // Don't navigate when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'ArrowLeft') navigateCreative(-1);
    if (e.key === 'ArrowRight') navigateCreative(1);
    if (e.key === '+' || e.key === '=') zoomIn();
    if (e.key === '-') zoomOut();
  });
}

function setupModalKeys() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const identity = getIdentity();
      if (identity && identity.name) hideIdentityModal();
    }
    if (e.key === 'Enter') {
      const modal = document.getElementById('identity-modal');
      if (modal && modal.style.display === 'flex') {
        // Don't submit if magic link was already sent
        if (document.getElementById('auth-submit-btn').style.display !== 'none') {
          submitAuth();
        }
      }
    }
  });
}

// ─── Image Zoom ───────────────────────────────────────────────
function setupZoom() {
  const wrapper = document.getElementById('media-wrapper');
  if (!wrapper) return;

  wrapper.addEventListener('wheel', (e) => {
    if (!creative || creative.mediaType !== 'image') return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    const newZoom = Math.max(1, Math.min(5, zoomLevel + delta));
    if (newZoom === zoomLevel) return;

    // Zoom toward cursor position
    const rect = wrapper.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;
    const scale = newZoom / zoomLevel;
    panX = cursorX - scale * (cursorX - panX);
    panY = cursorY - scale * (cursorY - panY);

    zoomLevel = newZoom;
    constrainPan(wrapper);
    applyZoom();
  }, { passive: false });

  // Pan with mouse drag when zoomed
  let didPan = false;
  wrapper.addEventListener('mousedown', (e) => {
    didPan = false;
    if (zoomLevel <= 1 || pinMode) return;
    if (e.target.closest('.pin-marker') || e.target.tagName === 'VIDEO') return;
    isPanning = true;
    panStartX = e.clientX - panX;
    panStartY = e.clientY - panY;
    wrapper.style.cursor = 'grabbing';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isPanning) return;
    didPan = true;
    const wrapper = document.getElementById('media-wrapper');
    panX = e.clientX - panStartX;
    panY = e.clientY - panStartY;
    constrainPan(wrapper);
    applyZoom();
  });

  window.addEventListener('mouseup', () => {
    if (isPanning) {
      isPanning = false;
      const wrapper = document.getElementById('media-wrapper');
      if (wrapper) wrapper.style.cursor = zoomLevel > 1 ? 'grab' : '';
    }
  });

  // Double-click to reset
  wrapper.addEventListener('dblclick', (e) => {
    if (!creative || creative.mediaType !== 'image') return;
    if (e.target.closest('.pin-marker')) return;
    if (pinMode) return;
    resetZoom();
  });

  // Click handler — pin placement or open fullscreen
  wrapper.addEventListener('click', (e) => {
    if (pinMode) { handlePinClick(e); return; }
    // Open fullscreen on image tap (not when zoomed/panning/clicking pins)
    if (!isFullscreen && !didPan && zoomLevel <= 1
        && creative && creative.mediaType === 'image'
        && !e.target.closest('.pin-marker')
        && !e.target.closest('.fullscreen-close-btn')) {
      toggleFullscreen();
    }
  });

  // Touch pinch-to-zoom + single-finger pan
  let lastTouchDist = 0;
  let touchStartZoom = 1;
  let isTouchPanning = false;
  let touchPanStartX = 0;
  let touchPanStartY = 0;

  wrapper.addEventListener('touchstart', (e) => {
    if (!creative || creative.mediaType !== 'image') return;
    didPan = false;

    if (e.touches.length === 2) {
      // Two-finger pinch-to-zoom — lock touch actions immediately
      wrapper.style.touchAction = 'none';
      e.preventDefault();
      isTouchPanning = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist = Math.sqrt(dx * dx + dy * dy);
      touchStartZoom = zoomLevel;
    } else if (e.touches.length === 1 && zoomLevel > 1 && !pinMode) {
      // Single-finger pan when zoomed in
      isTouchPanning = true;
      touchPanStartX = e.touches[0].clientX - panX;
      touchPanStartY = e.touches[0].clientY - panY;
      e.preventDefault();
    }
  }, { passive: false });

  wrapper.addEventListener('touchmove', (e) => {
    if (!creative || creative.mediaType !== 'image') return;

    if (e.touches.length === 2 && lastTouchDist > 0) {
      // Pinch-to-zoom
      e.preventDefault();
      didPan = true;
      isTouchPanning = false;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scale = dist / lastTouchDist;
      zoomLevel = Math.max(1, Math.min(5, touchStartZoom * scale));
      constrainPan(wrapper);
      applyZoom();
    } else if (e.touches.length === 1 && isTouchPanning) {
      // Single-finger pan
      e.preventDefault();
      didPan = true;
      panX = e.touches[0].clientX - touchPanStartX;
      panY = e.touches[0].clientY - touchPanStartY;
      constrainPan(wrapper);
      applyZoom();
    }
  }, { passive: false });

  wrapper.addEventListener('touchend', () => {
    lastTouchDist = 0;
    isTouchPanning = false;
    // Restore normal touch scrolling if zoomed back to 1
    if (zoomLevel <= 1) {
      wrapper.style.touchAction = '';
    }
  });
}

function constrainPan(wrapper) {
  if (zoomLevel <= 1) { panX = 0; panY = 0; return; }
  const rect = wrapper.getBoundingClientRect();

  // Use actual image dimensions for accurate constraints
  const img = document.querySelector('#media-container .media-content');
  let contentW = rect.width;
  let contentH = rect.height;
  if (img && (img.tagName === 'IMG' || img.tagName === 'VIDEO')) {
    contentW = img.offsetWidth;
    contentH = img.offsetHeight;
  }

  // Max pan = how far the zoomed content overflows the viewport on each side
  const maxX = Math.max(0, (contentW * zoomLevel - rect.width) / 2);
  const maxY = Math.max(0, (contentH * zoomLevel - rect.height) / 2);
  panX = Math.max(-maxX, Math.min(maxX, panX));
  panY = Math.max(-maxY, Math.min(maxY, panY));
}

function applyZoom() {
  const container = document.getElementById('media-container');
  const overlay = document.getElementById('pin-overlay');
  const wrapper = document.getElementById('media-wrapper');
  if (!container) return;

  const transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
  container.style.transform = transform;
  if (overlay) overlay.style.transform = transform;

  const zoomLevelEl = document.getElementById('zoom-level');
  if (zoomLevelEl) {
    zoomLevelEl.textContent = `${Math.round(zoomLevel * 100)}%`;
  }
  if (wrapper) {
    wrapper.style.cursor = zoomLevel > 1 ? 'grab' : '';
    // Disable browser touch scrolling when zoomed so our pan handlers work
    wrapper.style.touchAction = zoomLevel > 1 ? 'none' : '';
  }
}

function resetZoom() {
  zoomLevel = 1;
  panX = 0;
  panY = 0;
  applyZoom();
}

// ─── Fullscreen Image View ────────────────────────────────────
let isFullscreen = false;

function toggleFullscreen() {
  const panel = document.querySelector('.media-panel');
  const closeBtn = document.getElementById('fullscreen-close-btn');
  if (!panel) return;

  isFullscreen = !isFullscreen;
  panel.classList.toggle('fullscreen', isFullscreen);
  closeBtn.style.display = isFullscreen ? '' : 'none';

  // Lock body scroll when fullscreen
  document.body.style.overflow = isFullscreen ? 'hidden' : '';

  // Reset zoom when entering/exiting
  resetZoom();
}

function zoomIn() {
  if (!creative || creative.mediaType !== 'image') return;
  const wrapper = document.getElementById('media-wrapper');
  zoomLevel = Math.min(5, zoomLevel + 0.5);
  constrainPan(wrapper);
  applyZoom();
}

function zoomOut() {
  if (!creative || creative.mediaType !== 'image') return;
  const wrapper = document.getElementById('media-wrapper');
  zoomLevel = Math.max(1, zoomLevel - 0.5);
  constrainPan(wrapper);
  applyZoom();
}

// ─── Pin Annotations ──────────────────────────────────────────
function enterPinMode() {
  if (!creative || creative.mediaType !== 'image') {
    showToast('Pins can only be placed on images', 'error');
    return;
  }
  pinMode = true;
  const wrapper = document.getElementById('media-wrapper');
  wrapper.classList.add('pin-mode');
  wrapper.style.cursor = 'crosshair';
  document.getElementById('pin-mode-btn').classList.add('active');
  showToast('Click on the image to place a pin');
}

function handlePinClick(e) {
  if (!pinMode) return;
  const wrapper = document.getElementById('media-wrapper');
  const rect = wrapper.getBoundingClientRect();

  // Calculate position as percentage, accounting for zoom, pan, and center-origin transform
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;
  const cx = rect.width / 2;
  const cy = rect.height / 2;
  const imgX = (clickX - panX - cx) / zoomLevel + cx;
  const imgY = (clickY - panY - cy) / zoomLevel + cy;
  const pctX = (imgX / rect.width) * 100;
  const pctY = (imgY / rect.height) * 100;

  if (pctX < 0 || pctX > 100 || pctY < 0 || pctY > 100) {
    cancelPin();
    return;
  }

  pendingPin = { x: Math.round(pctX * 10) / 10, y: Math.round(pctY * 10) / 10 };

  // Show pending pin on overlay
  const overlay = document.getElementById('pin-overlay');
  const pinnedCount = creative.comments.filter(c => c.pinX !== undefined).length;
  const marker = document.createElement('div');
  marker.className = 'pin-marker pin-marker-pending';
  marker.style.left = `${pendingPin.x}%`;
  marker.style.top = `${pendingPin.y}%`;
  marker.textContent = pinnedCount + 1;
  marker.id = 'pending-pin-marker';
  overlay.appendChild(marker);

  // Exit pin mode, show indicator in comment form
  wrapper.classList.remove('pin-mode');
  wrapper.style.cursor = zoomLevel > 1 ? 'grab' : '';
  document.getElementById('pin-mode-btn').classList.remove('active');
  pinMode = false;

  const indicator = document.getElementById('pin-indicator');
  indicator.style.display = 'flex';
  document.getElementById('pin-indicator-text').textContent = `Pin #${pinnedCount + 1}`;
  document.getElementById('comment-text').focus();
}

function cancelPin() {
  pendingPin = null;
  pinMode = false;
  const wrapper = document.getElementById('media-wrapper');
  if (wrapper) {
    wrapper.classList.remove('pin-mode');
    wrapper.style.cursor = zoomLevel > 1 ? 'grab' : '';
  }
  const btn = document.getElementById('pin-mode-btn');
  if (btn) btn.classList.remove('active');
  const indicator = document.getElementById('pin-indicator');
  if (indicator) indicator.style.display = 'none';
  const pendingMarker = document.getElementById('pending-pin-marker');
  if (pendingMarker) pendingMarker.remove();
}

function renderPins() {
  const overlay = document.getElementById('pin-overlay');
  const toggleBtn = document.getElementById('toggle-pins-btn');
  if (!overlay || !creative) return;

  overlay.innerHTML = '';
  const pinnedComments = creative.comments.filter(c => c.pinX !== undefined && c.pinY !== undefined);

  if (toggleBtn) {
    if (pinnedComments.length > 0) {
      toggleBtn.style.display = 'inline-flex';
      toggleBtn.title = pinsVisible ? 'Hide all pins' : 'Show all pins';
      document.getElementById('pin-count-label').textContent = pinnedComments.length;
    } else {
      toggleBtn.style.display = 'none';
    }
  }

  pinnedComments.forEach((c, i) => {
    const marker = document.createElement('div');
    marker.className = 'pin-marker';
    marker.style.left = `${c.pinX}%`;
    marker.style.top = `${c.pinY}%`;
    marker.textContent = i + 1;
    marker.dataset.commentId = c.id;
    marker.title = `${c.author}: ${c.text.substring(0, 60)}${c.text.length > 60 ? '...' : ''}`;

    // Show pin if "show all" is on, or if this is the active pin
    if (pinsVisible || c.id === activePinCommentId) {
      marker.style.display = '';
      if (c.id === activePinCommentId) marker.classList.add('pin-active');
    } else {
      marker.style.display = 'none';
    }

    marker.addEventListener('click', (e) => {
      e.stopPropagation();
      focusPin(c.id);
    });
    marker.addEventListener('mouseenter', () => {
      const commentEl = document.getElementById(`comment-${c.id}`);
      if (commentEl) commentEl.classList.add('comment-highlight');
    });
    marker.addEventListener('mouseleave', () => {
      const commentEl = document.getElementById(`comment-${c.id}`);
      if (commentEl) commentEl.classList.remove('comment-highlight');
    });
    overlay.appendChild(marker);
  });
}

function focusPin(commentId) {
  // Toggle off if clicking the same pin
  if (activePinCommentId === commentId) {
    activePinCommentId = null;
    renderPins();
    const commentEl = document.getElementById(`comment-${commentId}`);
    if (commentEl) commentEl.classList.remove('comment-highlight');
    return;
  }

  // Remove previous highlight
  if (activePinCommentId) {
    const prevComment = document.getElementById(`comment-${activePinCommentId}`);
    if (prevComment) prevComment.classList.remove('comment-highlight');
  }

  // Activate this pin
  activePinCommentId = commentId;
  renderPins();

  // Scroll to and highlight comment
  const commentEl = document.getElementById(`comment-${commentId}`);
  if (commentEl) {
    commentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    commentEl.classList.add('comment-highlight');
  }
}

function togglePinsVisibility() {
  pinsVisible = !pinsVisible;
  if (!pinsVisible) activePinCommentId = null;
  const btn = document.getElementById('toggle-pins-btn');
  btn.classList.toggle('active', pinsVisible);
  renderPins();
}

// ─── Version Management ───────────────────────────────────────
function setupVersionUpload() {
  const input = document.getElementById('version-file-input');
  if (!input) return;
  input.addEventListener('change', async () => {
    if (!input.files.length || !projectId || !creativeId) return;
    await uploadNewVersion(input.files[0]);
    input.value = '';
  });
}

function showVersionSection() {
  if (!isAdmin() || !creative) return;
  const section = document.getElementById('version-section');
  section.style.display = 'block';

  const versionNum = (creative.versions ? creative.versions.length : 0) + 1;
  document.getElementById('version-badge').textContent = versionNum;
  document.getElementById('version-label').textContent = `Version ${versionNum} (current)`;

  // Show history toggle if there are previous versions
  const historyBtn = document.getElementById('toggle-history-btn');
  if (creative.versions && creative.versions.length > 0) {
    historyBtn.style.display = '';
  } else {
    historyBtn.style.display = 'none';
  }
}

function toggleVersionHistory() {
  const historyEl = document.getElementById('version-history');
  const btn = document.getElementById('toggle-history-btn');
  if (historyEl.style.display === 'none') {
    renderVersionHistory();
    historyEl.style.display = 'block';
    btn.textContent = 'Hide History';
  } else {
    historyEl.style.display = 'none';
    btn.textContent = 'View History';
  }
}

function renderVersionHistory() {
  const historyEl = document.getElementById('version-history');
  if (!creative.versions || creative.versions.length === 0) {
    historyEl.innerHTML = '<p style="color:var(--text-muted);font-size:0.82rem;">No previous versions</p>';
    return;
  }

  const currentNum = creative.versions.length + 1;
  let html = `<div class="version-item active" onclick="viewCurrentVersion()">
    <span class="version-item-label">v${currentNum} (current)</span>
    <span class="version-item-date">${formatDate(creative.uploadedAt)}</span>
  </div>`;

  // Show versions in reverse chronological order
  for (let i = creative.versions.length - 1; i >= 0; i--) {
    const v = creative.versions[i];
    html += `<div class="version-item" onclick="viewOldVersion(${i})">
      <span class="version-item-label">v${v.versionNumber}</span>
      <span class="version-item-date">${formatDate(v.uploadedAt)}</span>
    </div>`;
  }

  historyEl.innerHTML = html;
}

function viewOldVersion(versionIndex) {
  const v = creative.versions[versionIndex];
  if (!v) return;

  // Temporarily show old version media
  const container = document.getElementById('media-container');
  if (v.mediaType === 'video') {
    container.innerHTML = `<video controls preload="metadata" class="media-content"><source src="${v.filePath}" type="${v.mimeType}"></video>`;
  } else if (v.mediaType === 'pdf') {
    container.innerHTML = `<iframe src="${v.filePath}" class="media-content media-pdf" title="PDF Preview"></iframe>`;
  } else {
    container.innerHTML = `<img src="${v.filePath}" alt="${escapeHtml(v.originalName)}" class="media-content">`;
  }
  document.getElementById('media-filename').textContent = `${v.originalName} (v${v.versionNumber})`;

  // Highlight active version in history
  document.querySelectorAll('.version-item').forEach(el => el.classList.remove('active'));
  const items = document.querySelectorAll('.version-item');
  // Index 0 is current, old versions start at 1 in reverse
  const itemIndex = creative.versions.length - versionIndex;
  if (items[itemIndex]) items[itemIndex].classList.add('active');

  showToast(`Viewing version ${v.versionNumber}`);
}

function viewCurrentVersion() {
  // Restore current version media
  renderMedia();
  document.getElementById('media-filename').textContent = creative.originalName;

  // Highlight current version in history
  document.querySelectorAll('.version-item').forEach((el, i) => {
    el.classList.toggle('active', i === 0);
  });

  showToast('Viewing current version');
}

function viewCurrentVersion() {
  renderMedia();
  document.getElementById('media-filename').textContent = creative.originalName;

  // Highlight current in history
  document.querySelectorAll('.version-item').forEach(el => el.classList.remove('active'));
  const first = document.querySelector('.version-item');
  if (first) first.classList.add('active');
}

async function uploadNewVersion(file) {
  const adminToken = getAdminToken();
  if (!adminToken) {
    showToast('Admin login required to upload versions', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);

  const btn = document.getElementById('upload-version-btn');
  const origText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = 'Uploading...';

  try {
    const res = await fetch(`/api/projects/${projectId}/creatives/${creativeId}/versions`, {
      method: 'POST',
      headers: { 'x-admin-token': adminToken },
      body: formData
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Upload failed');
    }

    creative = await res.json();
    renderMedia();
    document.getElementById('media-filename').textContent = creative.originalName;
    updateStatusBanner();
    showVersionSection();
    renderVersionHistory();
    showToast('New version uploaded! Status reset to pending.');
  } catch (err) {
    showToast(err.message || 'Failed to upload version', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
  }
}

// ─── Caption / Copy Tracking ──────────────────────────────────
function showCaptionTracking() {
  const tabs = document.getElementById('caption-tabs');
  const meta = document.getElementById('caption-meta');
  if (!creative || !creative.captionData) {
    if (tabs) tabs.style.display = 'none';
    if (meta) meta.textContent = '';
    return;
  }
  const cd = creative.captionData;
  if (cd.history && cd.history.length > 0) {
    tabs.style.display = 'flex';
  }
  if (cd.lastEditedBy) {
    meta.textContent = `Last edit: ${cd.lastEditedBy}`;
  }
  renderCaptionChanges();
  renderCaptionHistory();
}

function switchCaptionTab(tab) {
  document.querySelectorAll('#caption-tabs .image-text-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('caption-edit').style.display = tab === 'edit' ? 'block' : 'none';
  document.getElementById('caption-changes').style.display = tab === 'changes' ? 'block' : 'none';
  document.getElementById('caption-history').style.display = tab === 'history' ? 'block' : 'none';
}

function renderCaptionChanges() {
  const container = document.getElementById('caption-changes');
  if (!creative.captionData || !creative.captionData.original) {
    container.innerHTML = '<p class="no-comments">No changes yet.</p>';
    return;
  }
  const original = creative.captionData.original;
  const current = creative.caption || '';
  if (original === current) {
    container.innerHTML = '<p class="no-comments">No changes from original.</p>';
    return;
  }
  const diff = computeWordDiff(original, current);
  container.innerHTML = `
    <div class="diff-legend">
      <span class="diff-legend-item"><span class="diff-added-sample">added</span></span>
      <span class="diff-legend-item"><span class="diff-removed-sample">removed</span></span>
    </div>
    <div class="diff-content">${renderDiff(diff)}</div>
  `;
}

function renderCaptionHistory() {
  const container = document.getElementById('caption-history');
  if (!creative.captionData || !creative.captionData.history || creative.captionData.history.length === 0) {
    container.innerHTML = '<p class="no-comments">No edit history yet.</p>';
    return;
  }
  const history = creative.captionData.history;
  let html = '';
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    const prevText = entry.text;
    const nextText = i === history.length - 1 ? (creative.caption || '') : history[i + 1].text;
    const nextAuthor = i === history.length - 1 ? (creative.captionData.lastEditedBy || 'Unknown') : history[i + 1].author;
    const nextTime = i === history.length - 1 ? creative.captionData.lastEditedAt : history[i + 1].timestamp;
    const diff = computeWordDiff(prevText, nextText);
    html += `
      <div class="history-entry">
        <div class="history-entry-header">
          <strong>${escapeHtml(nextAuthor)}</strong>
          <span class="comment-date">${formatDate(nextTime)}</span>
        </div>
        <div class="diff-content">${renderDiff(diff)}</div>
      </div>
    `;
  }
  container.innerHTML = html;
}

// ─── Image Text (OCR) ─────────────────────────────────────────
function showImageTextSection() {
  const section = document.getElementById('image-text-section');
  if (!creative || creative.mediaType !== 'image') {
    if (section) section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  // Show existing text if any
  if (creative.imageText && creative.imageText.current) {
    document.getElementById('image-text-input').value = creative.imageText.current;
    document.getElementById('image-text-tabs').style.display = 'flex';
    updateImageTextMeta();
    renderImageTextChanges();
    renderImageTextHistory();
  } else {
    document.getElementById('image-text-input').value = '';
    document.getElementById('image-text-tabs').style.display = 'none';
  }
}

function updateImageTextMeta() {
  const meta = document.getElementById('image-text-meta');
  if (!creative.imageText || !creative.imageText.lastEditedBy) {
    meta.textContent = '';
    return;
  }
  meta.textContent = `Last edit: ${creative.imageText.lastEditedBy}`;
}

async function saveImageText() {
  const identity = getIdentity();
  const author = (identity && identity.name) ? identity.name : 'Anonymous';
  const text = document.getElementById('image-text-input').value;

  try {
    // If no imageText exists yet, set original; otherwise update current
    const payload = (!creative.imageText || !creative.imageText.original)
      ? { imageText: { original: text } }
      : { imageText: { current: text, author } };

    const res = await fetch(`/api/projects/${projectId}/creatives/${creativeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    creative = await res.json();
    savedImageText = (creative.imageText && creative.imageText.current) ? creative.imageText.current : text;

    // Show tabs now that we have saved text
    document.getElementById('image-text-tabs').style.display = 'flex';
    updateImageTextMeta();
    renderImageTextChanges();
    renderImageTextHistory();
    showToast('Text saved!');
  } catch (err) {
    showToast('Failed to save text', 'error');
  }
}

function switchImageTextTab(tab) {
  document.querySelectorAll('#image-text-tabs .image-text-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  document.getElementById('image-text-edit').style.display = tab === 'edit' ? 'block' : 'none';
  document.getElementById('image-text-changes').style.display = tab === 'changes' ? 'block' : 'none';
  document.getElementById('image-text-history').style.display = tab === 'history' ? 'block' : 'none';
}

function renderImageTextChanges() {
  const container = document.getElementById('image-text-changes');
  if (!creative.imageText || !creative.imageText.original) {
    container.innerHTML = '<p class="no-comments">No text extracted yet.</p>';
    return;
  }

  const original = creative.imageText.original;
  const current = creative.imageText.current || original;

  if (original === current) {
    container.innerHTML = '<p class="no-comments">No changes from original.</p>';
    return;
  }

  const diff = computeWordDiff(original, current);
  container.innerHTML = `
    <div class="diff-legend">
      <span class="diff-legend-item"><span class="diff-added-sample">added</span></span>
      <span class="diff-legend-item"><span class="diff-removed-sample">removed</span></span>
    </div>
    <div class="diff-content">${renderDiff(diff)}</div>
  `;
}

function renderImageTextHistory() {
  const container = document.getElementById('image-text-history');
  if (!creative.imageText || !creative.imageText.history || creative.imageText.history.length === 0) {
    container.innerHTML = '<p class="no-comments">No edit history yet.</p>';
    return;
  }

  const history = creative.imageText.history;
  let html = '';

  // Show each revision as a diff against the previous version
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    const prevText = entry.text;
    const nextText = i === history.length - 1 ? creative.imageText.current : history[i + 1].text;
    const nextAuthor = i === history.length - 1 ? (creative.imageText.lastEditedBy || 'Unknown') : history[i + 1].author;
    const diff = computeWordDiff(prevText, nextText);

    html += `
      <div class="history-entry">
        <div class="history-entry-header">
          <strong>${escapeHtml(nextAuthor)}</strong>
          <span class="comment-date">${formatDate(i === history.length - 1 ? creative.imageText.lastEditedAt : history[i + 1].timestamp)}</span>
        </div>
        <div class="diff-content">${renderDiff(diff)}</div>
      </div>
    `;
  }

  container.innerHTML = html;
}

// Word-level diff using LCS (Longest Common Subsequence)
function computeWordDiff(oldText, newText) {
  const oldWords = oldText.split(/(\s+)/).filter(w => w);
  const newWords = newText.split(/(\s+)/).filter(w => w);

  const m = oldWords.length;
  const n = newWords.length;

  // Build LCS table
  const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldWords[i - 1] === newWords[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to produce diff
  const result = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1] === newWords[j - 1]) {
      result.unshift({ type: 'same', word: oldWords[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', word: newWords[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'removed', word: oldWords[i - 1] });
      i--;
    }
  }
  return result;
}

function renderDiff(diff) {
  return diff.map(d => {
    if (d.type === 'added') return `<span class="diff-added">${escapeHtml(d.word)}</span>`;
    if (d.type === 'removed') return `<span class="diff-removed">${escapeHtml(d.word)}</span>`;
    return escapeHtml(d.word);
  }).join('');
}

// ─── Utilities ────────────────────────────────────────────────
function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast-${type}`;
  toast.style.display = 'block';
  setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDate(iso) {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);
  const diffDay = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
