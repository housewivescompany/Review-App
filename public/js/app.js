// ─── State ────────────────────────────────────────────────────
let currentProjectId = null;
let currentProject = null;
let currentProjectTab = 'active';
let appSettings = null;
let archivedCount = 0;

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyInstantSettings();
  loadSettings();
  setupDragAndDrop();
  setupFileInput();
  setupModalKeys();
  setupClientAutocomplete();
  setupLogoUpload();
  loadProjects();
  loadClientNames();
  loadArchivedCount();
});

// ─── Projects List ────────────────────────────────────────────
async function loadProjects() {
  try {
    const archived = currentProjectTab === 'archived';
    const res = await fetch(`/api/projects?archived=${archived}`);
    const projects = await res.json();
    renderProjectsList(projects);
  } catch (err) {
    showToast('Failed to load projects', 'error');
  }
}

async function loadArchivedCount() {
  try {
    const res = await fetch('/api/projects?archived=true');
    const projects = await res.json();
    archivedCount = projects.length;
    const el = document.getElementById('archived-tab-count');
    if (el) el.textContent = archivedCount;
  } catch {}
}

function switchProjectTab(tab) {
  currentProjectTab = tab;
  document.querySelectorAll('.project-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  loadProjects();
}

function renderProjectsList(projects) {
  const list = document.getElementById('projects-list');
  const empty = document.getElementById('empty-state');

  // Update tab count
  const countEl = document.getElementById(currentProjectTab === 'archived' ? 'archived-tab-count' : 'active-tab-count');
  if (countEl) countEl.textContent = projects.length;

  if (projects.length === 0) {
    list.style.display = 'none';
    if (currentProjectTab === 'archived') {
      empty.querySelector('h2').textContent = 'No archived projects';
      empty.querySelector('p').textContent = 'Completed projects you archive will appear here';
      empty.querySelector('.btn')?.remove();
    } else {
      empty.querySelector('h2').textContent = 'No projects yet';
      empty.querySelector('p').textContent = 'Create your first project to start collecting creative approvals';
    }
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'grid';

  list.innerHTML = projects.map(p => {
    const total = p.creativeCount;
    const pct = total > 0 ? Math.round((p.approvedCount / total) * 100) : 0;
    const isArchived = currentProjectTab === 'archived';

    // Thumbnail strip
    let thumbHtml = '';
    if (p.thumbnails && p.thumbnails.length > 0) {
      const thumbs = p.thumbnails.map(t => {
        if (t.mediaType === 'video') {
          return `<div class="card-thumb card-thumb-video"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg></div>`;
        } else if (t.mediaType === 'pdf') {
          return `<div class="card-thumb card-thumb-pdf"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg></div>`;
        }
        return `<div class="card-thumb"><img src="${t.filePath}" alt="" loading="lazy"></div>`;
      }).join('');
      const extra = total > 4 ? `<div class="card-thumb card-thumb-more">+${total - 4}</div>` : '';
      thumbHtml = `<div class="card-thumbs">${thumbs}${extra}</div>`;
    }

    return `
      <div class="project-card" onclick="openProject('${p.id}')">
        ${thumbHtml}
        <div class="project-card-header">
          <h3>${escapeHtml(p.name)}</h3>
          ${p.clientName ? `<span class="client-badge">${escapeHtml(p.clientName)}</span>` : ''}
        </div>
        <div class="project-card-stats">
          <div class="mini-progress">
            <div class="mini-progress-fill" style="width: ${pct}%"></div>
          </div>
          <div class="stats-row">
            <span>${total} creative${total !== 1 ? 's' : ''}</span>
            <span>${pct}% approved</span>
          </div>
        </div>
        <div class="project-card-meta">
          <span class="date">${formatDate(p.createdAt)}</span>
          <div class="status-dots">
            ${p.approvedCount > 0 ? `<span class="mini-dot dot-approved" title="${p.approvedCount} approved"></span>` : ''}
            ${p.pendingCount > 0 ? `<span class="mini-dot dot-pending" title="${p.pendingCount} pending"></span>` : ''}
            ${p.revisionCount > 0 ? `<span class="mini-dot dot-revision" title="${p.revisionCount} need revision"></span>` : ''}
          </div>
        </div>
        <div class="project-card-actions" onclick="event.stopPropagation()">
          <button class="card-action-btn" onclick="archiveFromCard('${p.id}', ${!isArchived})" title="${isArchived ? 'Unarchive' : 'Archive'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>
          </button>
          <button class="card-action-btn card-action-danger" onclick="deleteFromCard('${p.id}', '${escapeHtml(p.name)}')" title="Delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function showProjectsList() {
  document.getElementById('projects-view').style.display = 'block';
  document.getElementById('project-view').style.display = 'none';
  currentProjectId = null;
  currentProject = null;
  loadProjects();
  loadArchivedCount();
}

// ─── Single Project ───────────────────────────────────────────
async function openProject(projectId) {
  currentProjectId = projectId;
  try {
    const res = await fetch(`/api/projects/${projectId}`);
    if (!res.ok) throw new Error('Project not found');
    currentProject = await res.json();
    renderProjectView();
  } catch (err) {
    showToast('Failed to load project', 'error');
  }
}

function renderProjectView() {
  const p = currentProject;
  document.getElementById('projects-view').style.display = 'none';
  document.getElementById('project-view').style.display = 'block';

  document.getElementById('project-breadcrumb-name').textContent = p.name;
  document.getElementById('project-title').textContent = p.name;
  document.getElementById('project-client').textContent = p.clientName ? `Client: ${p.clientName}` : '';

  // Archive button label
  const archiveBtn = document.getElementById('archive-btn');
  if (archiveBtn) {
    if (p.archived) {
      archiveBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg> Unarchive`;
    } else {
      archiveBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg> Archive`;
    }
  }

  // Progress
  const total = p.creatives.length;
  const approved = p.creatives.filter(c => c.status === 'approved').length;
  const pending = p.creatives.filter(c => c.status === 'pending').length;
  const revision = p.creatives.filter(c => c.status === 'revision_requested').length;
  const pct = total > 0 ? Math.round((approved / total) * 100) : 0;

  document.getElementById('approved-count').textContent = approved;
  document.getElementById('pending-count').textContent = pending;
  document.getElementById('revision-count').textContent = revision;
  document.getElementById('progress-fill').style.width = `${pct}%`;

  // Creatives grid
  renderCreativesGrid();
}

function renderCreativesGrid() {
  const grid = document.getElementById('creatives-grid');
  const creatives = currentProject.creatives;

  if (creatives.length === 0) {
    grid.innerHTML = '<p class="no-creatives">No creatives uploaded yet. Drag and drop files above to get started.</p>';
    return;
  }

  grid.innerHTML = creatives.map(c => {
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
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
          <span>PDF</span>
        </div>`;
    } else {
      thumbnail = `<img src="${c.filePath}" alt="${escapeHtml(c.originalName)}" loading="lazy">`;
    }

    return `
      <div class="creative-card" onclick="openCreativeReview('${currentProjectId}', '${c.id}')">
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
      </div>
    `;
  }).join('');
}

function openCreativeReview(projectId, creativeId) {
  window.location.href = `/review/${projectId}/${creativeId}`;
}

function copyShareLink() {
  const url = `${window.location.origin}/review/${currentProjectId}`;
  navigator.clipboard.writeText(url).then(() => {
    showToast('Review link copied to clipboard!');
  }).catch(() => {
    // Fallback
    const input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    showToast('Review link copied to clipboard!');
  });
}

// ─── File Upload ──────────────────────────────────────────────
function setupDragAndDrop() {
  const zone = document.getElementById('upload-zone');
  if (!zone) return;

  ['dragenter', 'dragover'].forEach(event => {
    zone.addEventListener(event, e => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(event => {
    zone.addEventListener(event, e => {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.remove('drag-over');
    });
  });

  zone.addEventListener('drop', e => {
    const files = e.dataTransfer.files;
    if (files.length > 0) uploadFiles(files);
  });

  zone.addEventListener('click', e => {
    if (e.target.closest('.link-btn')) return;
    document.getElementById('file-input').click();
  });
}

function setupFileInput() {
  const input = document.getElementById('file-input');
  if (!input) return;
  input.addEventListener('change', () => {
    if (input.files.length > 0) {
      uploadFiles(input.files);
      input.value = '';
    }
  });
}

async function uploadFiles(files) {
  if (!currentProjectId) {
    showToast('Please select a project first', 'error');
    return;
  }

  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }

  const progressEl = document.getElementById('upload-progress');
  const fillEl = document.getElementById('upload-progress-fill');
  const statusEl = document.getElementById('upload-status');
  const contentEl = document.querySelector('.upload-content');

  contentEl.style.display = 'none';
  progressEl.style.display = 'block';
  statusEl.textContent = `Uploading ${files.length} file${files.length > 1 ? 's' : ''}...`;

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/projects/${currentProjectId}/creatives`);

    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        fillEl.style.width = `${pct}%`;
        statusEl.textContent = `Uploading... ${pct}%`;
      }
    });

    await new Promise((resolve, reject) => {
      xhr.timeout = 30 * 60 * 1000; // 30 minute timeout for large files
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          let msg = 'Upload failed';
          try { msg = JSON.parse(xhr.responseText).error || msg; } catch(e) {}
          reject(new Error(msg));
        }
      };
      xhr.onerror = () => reject(new Error('Network error - check your connection and try again'));
      xhr.ontimeout = () => reject(new Error('Upload timed out - file may be too large'));
      xhr.onabort = () => reject(new Error('Upload was cancelled'));
      xhr.send(formData);
    });

    showToast(`${files.length} file${files.length > 1 ? 's' : ''} uploaded successfully!`);
    await openProject(currentProjectId);
  } catch (err) {
    showToast(err.message || 'Upload failed. Please try again.', 'error');
  } finally {
    progressEl.style.display = 'none';
    contentEl.style.display = 'flex';
    fillEl.style.width = '0%';
  }
}

// ─── Project CRUD ─────────────────────────────────────────────
function showNewProjectModal() {
  document.getElementById('new-project-modal').style.display = 'flex';
  document.getElementById('project-name-input').value = '';
  document.getElementById('client-name-input').value = '';
  document.getElementById('client-suggestions').style.display = 'none';
  loadClientNames();
  setTimeout(() => document.getElementById('project-name-input').focus(), 100);
}

function hideNewProjectModal() {
  document.getElementById('new-project-modal').style.display = 'none';
}

async function createProject() {
  const name = document.getElementById('project-name-input').value.trim();
  const clientName = document.getElementById('client-name-input').value.trim();

  if (!name) {
    showToast('Please enter a project name', 'error');
    return;
  }

  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, clientName })
    });
    const project = await res.json();
    hideNewProjectModal();
    openProject(project.id);
    showToast('Project created!');
  } catch (err) {
    showToast('Failed to create project', 'error');
  }
}

function confirmDeleteProject() {
  document.getElementById('delete-modal').style.display = 'flex';
}

function hideDeleteModal() {
  document.getElementById('delete-modal').style.display = 'none';
}

async function deleteProject() {
  try {
    await fetch(`/api/projects/${currentProjectId}`, { method: 'DELETE' });
    hideDeleteModal();
    showProjectsList();
    showToast('Project deleted');
  } catch (err) {
    showToast('Failed to delete project', 'error');
  }
}

// ─── Keyboard Shortcuts ──────────────────────────────────────
function setupModalKeys() {
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      hideNewProjectModal();
      hideDeleteModal();
      closeSettings();
    }
    if (e.key === 'Enter') {
      const modal = document.getElementById('new-project-modal');
      if (modal.style.display === 'flex') {
        createProject();
      }
    }
  });
}

// ─── Client Name Autocomplete ─────────────────────────────────
let cachedClientNames = [];

async function loadClientNames() {
  try {
    const res = await fetch('/api/client-names');
    cachedClientNames = await res.json();
  } catch { cachedClientNames = []; }
}

function setupClientAutocomplete() {
  const input = document.getElementById('client-name-input');
  const list = document.getElementById('client-suggestions');
  if (!input || !list) return;

  input.addEventListener('input', () => {
    const val = input.value.trim().toLowerCase();
    if (!val || cachedClientNames.length === 0) {
      list.style.display = 'none';
      return;
    }
    const matches = cachedClientNames.filter(n => n.toLowerCase().includes(val));
    if (matches.length === 0) {
      list.style.display = 'none';
      return;
    }
    list.innerHTML = matches.map(n =>
      `<div class="suggestion-item" onmousedown="selectClientName('${escapeHtml(n)}')">${escapeHtml(n)}</div>`
    ).join('');
    list.style.display = 'block';
  });

  input.addEventListener('blur', () => {
    setTimeout(() => { list.style.display = 'none'; }, 150);
  });

  input.addEventListener('focus', () => {
    if (input.value.trim()) input.dispatchEvent(new Event('input'));
  });
}

function selectClientName(name) {
  document.getElementById('client-name-input').value = name;
  document.getElementById('client-suggestions').style.display = 'none';
}

// ─── Archive ──────────────────────────────────────────────────
async function archiveFromCard(projectId, archive) {
  try {
    await fetch(`/api/projects/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: archive })
    });
    showToast(archive ? 'Project archived' : 'Project unarchived');
    loadProjects();
    loadArchivedCount();
  } catch {
    showToast('Failed to update project', 'error');
  }
}

async function deleteFromCard(projectId, projectName) {
  if (!confirm(`Delete "${projectName}"? This will permanently remove the project and all its files.`)) return;
  try {
    const res = await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error();
    showToast('Project deleted');
    loadProjects();
    loadArchivedCount();
  } catch {
    showToast('Failed to delete project', 'error');
  }
}

async function toggleArchiveProject() {
  if (!currentProjectId || !currentProject) return;
  const newArchived = !currentProject.archived;
  try {
    await fetch(`/api/projects/${currentProjectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: newArchived })
    });
    showToast(newArchived ? 'Project archived' : 'Project unarchived');
    showProjectsList();
  } catch (err) {
    showToast('Failed to update project', 'error');
  }
}

// ─── Settings ─────────────────────────────────────────────────
function applyInstantSettings() {
  const savedTheme = localStorage.getItem('rf_theme');
  const savedAccent = localStorage.getItem('rf_accent');
  if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  if (savedAccent) applyAccentColor(savedAccent);
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    appSettings = await res.json();
    applySettings(appSettings);
  } catch { /* use defaults */ }
}

function applySettings(s) {
  // Theme
  document.documentElement.setAttribute('data-theme', s.theme || 'dark');
  localStorage.setItem('rf_theme', s.theme || 'dark');

  // Accent color
  if (s.accentColor) {
    applyAccentColor(s.accentColor);
    localStorage.setItem('rf_accent', s.accentColor);
  }

  // Brand name
  const brandEl = document.getElementById('brand-name');
  if (brandEl) brandEl.textContent = s.brandName || 'ReviewFlow';
  document.title = s.brandName || 'Creative Approval Tool';

  // Logo — hide brand text when custom logo is set
  const defaultIcon = document.getElementById('logo-default-icon');
  const customImg = document.getElementById('logo-custom-img');
  const brandText = document.getElementById('brand-name');
  if (s.logoUrl && customImg) {
    customImg.src = s.logoUrl;
    customImg.style.display = 'block';
    if (defaultIcon) defaultIcon.style.display = 'none';
    if (brandText) brandText.style.display = 'none';
  } else if (customImg) {
    customImg.style.display = 'none';
    if (defaultIcon) defaultIcon.style.display = 'block';
    if (brandText) brandText.style.display = '';
  }
}

function applyAccentColor(color) {
  document.documentElement.style.setProperty('--accent', color);
  // Generate hover variant (lighter)
  const r = parseInt(color.slice(1,3), 16);
  const g = parseInt(color.slice(3,5), 16);
  const b = parseInt(color.slice(5,7), 16);
  const lighter = `rgb(${Math.min(r+30,255)}, ${Math.min(g+30,255)}, ${Math.min(b+30,255)})`;
  document.documentElement.style.setProperty('--accent-hover', lighter);
  document.documentElement.style.setProperty('--accent-bg', `rgba(${r}, ${g}, ${b}, 0.1)`);
}

function openSettings() {
  const modal = document.getElementById('settings-modal');
  if (!appSettings) return;

  // Populate fields
  document.getElementById('settings-brand-name').value = appSettings.brandName || 'ReviewFlow';

  // Theme buttons
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === (appSettings.theme || 'dark'));
  });

  // Color swatches
  const color = appSettings.accentColor || '#6366f1';
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === color);
  });
  document.getElementById('custom-color-picker').value = color;

  // Logo preview
  updateSettingsLogoPreview();

  modal.style.display = 'flex';
}

function closeSettings() {
  // Save brand name on close
  const nameInput = document.getElementById('settings-brand-name');
  if (appSettings && nameInput.value.trim() !== appSettings.brandName) {
    saveSettingsField({ brandName: nameInput.value.trim() });
  }
  document.getElementById('settings-modal').style.display = 'none';
}

function updateSettingsLogoPreview() {
  const defaultEl = document.getElementById('settings-logo-default');
  const imgEl = document.getElementById('settings-logo-img');
  const removeBtn = document.getElementById('remove-logo-btn');

  if (appSettings.logoUrl) {
    imgEl.src = appSettings.logoUrl;
    imgEl.style.display = 'block';
    defaultEl.style.display = 'none';
    removeBtn.style.display = 'inline-flex';
  } else {
    imgEl.style.display = 'none';
    defaultEl.style.display = 'flex';
    removeBtn.style.display = 'none';
  }
}

async function saveSettingsField(updates) {
  try {
    const res = await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    appSettings = await res.json();
    applySettings(appSettings);
  } catch {
    showToast('Failed to save settings', 'error');
  }
}

function setTheme(theme) {
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
  saveSettingsField({ theme });
}

function setAccentColor(color) {
  document.querySelectorAll('.color-swatch').forEach(s => {
    s.classList.toggle('active', s.dataset.color === color);
  });
  document.getElementById('custom-color-picker').value = color;
  saveSettingsField({ accentColor: color });
}

function setupLogoUpload() {
  const input = document.getElementById('logo-file-input');
  if (!input) return;
  input.addEventListener('change', async () => {
    if (!input.files.length) return;
    const formData = new FormData();
    formData.append('logo', input.files[0]);
    try {
      const res = await fetch('/api/settings/logo', { method: 'POST', body: formData });
      appSettings = await res.json();
      applySettings(appSettings);
      updateSettingsLogoPreview();
      showToast('Logo updated!');
    } catch {
      showToast('Failed to upload logo', 'error');
    }
    input.value = '';
  });
}

async function removeLogo() {
  try {
    const res = await fetch('/api/settings/logo', { method: 'DELETE' });
    appSettings = await res.json();
    applySettings(appSettings);
    updateSettingsLogoPreview();
    showToast('Logo removed');
  } catch {
    showToast('Failed to remove logo', 'error');
  }
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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
