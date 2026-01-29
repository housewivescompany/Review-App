// ─── State ────────────────────────────────────────────────────
let currentProjectId = null;
let currentProject = null;

// ─── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupDragAndDrop();
  setupFileInput();
  setupModalKeys();
  loadProjects();
});

// ─── Projects List ────────────────────────────────────────────
async function loadProjects() {
  try {
    const res = await fetch('/api/projects');
    const projects = await res.json();
    renderProjectsList(projects);
  } catch (err) {
    showToast('Failed to load projects', 'error');
  }
}

function renderProjectsList(projects) {
  const list = document.getElementById('projects-list');
  const empty = document.getElementById('empty-state');

  if (projects.length === 0) {
    list.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  list.style.display = 'grid';

  list.innerHTML = projects.map(p => {
    const total = p.creativeCount;
    const pct = total > 0 ? Math.round((p.approvedCount / total) * 100) : 0;
    return `
      <div class="project-card" onclick="openProject('${p.id}')">
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
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText));
        } else {
          reject(new Error('Upload failed'));
        }
      };
      xhr.onerror = () => reject(new Error('Upload failed'));
      xhr.send(formData);
    });

    showToast(`${files.length} file${files.length > 1 ? 's' : ''} uploaded successfully!`);
    await openProject(currentProjectId);
  } catch (err) {
    showToast('Upload failed. Please try again.', 'error');
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
    }
    if (e.key === 'Enter') {
      const modal = document.getElementById('new-project-modal');
      if (modal.style.display === 'flex') {
        createProject();
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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
