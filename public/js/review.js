// ─── State ────────────────────────────────────────────────────
let projectId = null;
let creativeId = null;
let project = null;
let creative = null;
let creativeIndex = -1;

// ─── Identity ─────────────────────────────────────────────────
function getIdentity() {
  try {
    const data = localStorage.getItem('reviewflow_identity');
    return data ? JSON.parse(data) : null;
  } catch { return null; }
}

function setIdentity(name, email) {
  localStorage.setItem('reviewflow_identity', JSON.stringify({ name, email }));
}

function showIdentityModal() {
  const modal = document.getElementById('identity-modal');
  const identity = getIdentity();
  if (identity) {
    document.getElementById('identity-name').value = identity.name || '';
    document.getElementById('identity-email').value = identity.email || '';
  }
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('identity-name').focus(), 100);
}

function hideIdentityModal() {
  document.getElementById('identity-modal').style.display = 'none';
}

function saveIdentity() {
  const name = document.getElementById('identity-name').value.trim();
  if (!name) {
    showToast('Please enter your name', 'error');
    return;
  }
  const email = document.getElementById('identity-email').value.trim();
  setIdentity(name, email);
  hideIdentityModal();
  updateIdentityDisplay();
}

function updateIdentityDisplay() {
  const identity = getIdentity();
  const el = document.getElementById('commenting-as');
  if (identity && identity.name) {
    el.textContent = `Commenting as ${identity.name}`;
  } else {
    el.textContent = 'Anonymous';
  }
}

function checkIdentity() {
  const identity = getIdentity();
  if (!identity || !identity.name) {
    showIdentityModal();
  }
  updateIdentityDisplay();
}

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  parseUrl();
  setupKeyboardNav();
  setupIdentityKeys();
});

function parseUrl() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  // /review/:projectId or /review/:projectId/:creativeId
  if (parts.length >= 2 && parts[0] === 'review') {
    projectId = parts[1];
    if (parts.length >= 3) {
      creativeId = parts[2];
      loadCreative();
    } else {
      loadProjectOverview();
    }
  }
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

  checkIdentity();

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

  checkIdentity();

  // Navigation controls
  const navControls = document.getElementById('nav-controls');
  if (project.creatives.length > 1) {
    navControls.style.display = 'flex';
    document.getElementById('creative-counter').textContent =
      `${creativeIndex + 1} of ${project.creatives.length}`;
    document.getElementById('prev-btn').disabled = creativeIndex === 0;
    document.getElementById('next-btn').disabled = creativeIndex === project.creatives.length - 1;
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

  // Comments
  renderComments();
}

function renderMedia() {
  const container = document.getElementById('media-container');

  if (creative.mediaType === 'video') {
    container.innerHTML = `
      <video controls preload="metadata" class="media-content">
        <source src="${creative.filePath}" type="${creative.mimeType}">
        Your browser does not support video playback.
      </video>`;
  } else if (creative.mediaType === 'pdf') {
    container.innerHTML = `
      <iframe src="${creative.filePath}" class="media-content media-pdf" title="PDF Preview"></iframe>`;
  } else {
    container.innerHTML = `
      <img src="${creative.filePath}" alt="${escapeHtml(creative.originalName)}" class="media-content">`;
  }
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
  const title = document.getElementById('creative-title').value;
  const caption = document.getElementById('creative-caption').value;

  try {
    const res = await fetch(`/api/projects/${projectId}/creatives/${creativeId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, caption })
    });
    creative = await res.json();
    showToast('Details saved!');
  } catch (err) {
    showToast('Failed to save', 'error');
  }
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

// ─── Comments ────────────────────────────────────────────────
function renderComments() {
  const list = document.getElementById('comments-list');
  const countBadge = document.getElementById('comment-count');
  countBadge.textContent = creative.comments.length;

  if (creative.comments.length === 0) {
    list.innerHTML = '<p class="no-comments">No comments yet</p>';
    return;
  }

  list.innerHTML = creative.comments.map(c => `
    <div class="comment">
      <div class="comment-header">
        <strong class="comment-author">${escapeHtml(c.author)}</strong>
        <span class="comment-date">${formatDate(c.createdAt)}</span>
        <button class="comment-delete" onclick="deleteComment('${c.id}')" title="Delete comment">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      <p class="comment-text">${escapeHtml(c.text)}</p>
    </div>
  `).join('');

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
    const res = await fetch(`/api/projects/${projectId}/creatives/${creativeId}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ author, text })
    });
    const comment = await res.json();
    creative.comments.push(comment);
    renderComments();
    document.getElementById('comment-text').value = '';
    showToast('Comment posted');
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
    renderComments();
  } catch (err) {
    showToast('Failed to delete comment', 'error');
  }
}

// ─── Navigation ──────────────────────────────────────────────
function navigateCreative(direction) {
  const newIndex = creativeIndex + direction;
  if (newIndex < 0 || newIndex >= project.creatives.length) return;
  const nextCreative = project.creatives[newIndex];
  window.location.href = `/review/${projectId}/${nextCreative.id}`;
}

function setupKeyboardNav() {
  document.addEventListener('keydown', e => {
    // Don't navigate when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'ArrowLeft') navigateCreative(-1);
    if (e.key === 'ArrowRight') navigateCreative(1);
  });
}

function setupIdentityKeys() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const modal = document.getElementById('identity-modal');
      if (modal && modal.style.display === 'flex') {
        saveIdentity();
      }
    }
  });
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
