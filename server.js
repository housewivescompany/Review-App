const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Data helpers
const DATA_DIR = path.join(__dirname, 'data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PROJECTS_FILE)) fs.writeFileSync(PROJECTS_FILE, '[]');
}

function readProjects() {
  ensureDataDir();
  return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
}

function writeProjects(projects) {
  ensureDataDir();
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projectId = req.params.projectId;
    const dir = path.join(__dirname, 'uploads', projectId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${baseName}_${Date.now()}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = /\.(jpg|jpeg|png|gif|webp|svg|bmp|mp4|mov|avi|webm|mkv|m4v|wmv|pdf)$/i;
  if (allowed.test(path.extname(file.originalname))) {
    cb(null, true);
  } else {
    cb(new Error('File type not supported. Please upload images, videos, or PDFs.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB max
});

// ─── API Routes ───────────────────────────────────────────────

// Get all projects
app.get('/api/projects', (req, res) => {
  const projects = readProjects();
  // Return summary data (without full creative details)
  const summaries = projects.map(p => ({
    id: p.id,
    name: p.name,
    clientName: p.clientName,
    createdAt: p.createdAt,
    creativeCount: p.creatives.length,
    approvedCount: p.creatives.filter(c => c.status === 'approved').length,
    pendingCount: p.creatives.filter(c => c.status === 'pending').length,
    revisionCount: p.creatives.filter(c => c.status === 'revision_requested').length
  }));
  res.json(summaries);
});

// Create a new project
app.post('/api/projects', (req, res) => {
  const { name, clientName } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Project name is required' });
  }
  const projects = readProjects();
  const project = {
    id: uuidv4(),
    name: name.trim(),
    clientName: (clientName || '').trim(),
    createdAt: new Date().toISOString(),
    creatives: []
  };
  projects.push(project);
  writeProjects(projects);
  res.status(201).json(project);
});

// Get single project with all creatives
app.get('/api/projects/:projectId', (req, res) => {
  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  res.json(project);
});

// Delete a project
app.delete('/api/projects/:projectId', (req, res) => {
  const projects = readProjects();
  const idx = projects.findIndex(p => p.id === req.params.projectId);
  if (idx === -1) return res.status(404).json({ error: 'Project not found' });

  // Remove uploaded files
  const uploadDir = path.join(__dirname, 'uploads', req.params.projectId);
  if (fs.existsSync(uploadDir)) {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }

  projects.splice(idx, 1);
  writeProjects(projects);
  res.json({ success: true });
});

// Upload creatives to a project
app.post('/api/projects/:projectId/creatives', (req, res, next) => {
  // Extend timeout to 30 minutes for large video uploads
  req.setTimeout(30 * 60 * 1000);
  res.setTimeout(30 * 60 * 1000);
  next();
}, upload.array('files', 50), (req, res) => {
  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const newCreatives = req.files.map(file => {
    const ext = path.extname(file.originalname).toLowerCase();
    const isVideo = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v', '.wmv'].includes(ext);
    const isPdf = ext === '.pdf';

    return {
      id: uuidv4(),
      originalName: file.originalname,
      fileName: file.filename,
      filePath: `/uploads/${req.params.projectId}/${file.filename}`,
      fileSize: file.size,
      mimeType: file.mimetype,
      mediaType: isVideo ? 'video' : isPdf ? 'pdf' : 'image',
      uploadedAt: new Date().toISOString(),
      status: 'pending',        // pending | approved | revision_requested
      caption: '',
      title: '',
      comments: [],
      revisionNumber: 1
    };
  });

  project.creatives.push(...newCreatives);
  writeProjects(projects);
  res.status(201).json(newCreatives);
});

// Get single creative
app.get('/api/projects/:projectId/creatives/:creativeId', (req, res) => {
  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const creative = project.creatives.find(c => c.id === req.params.creativeId);
  if (!creative) return res.status(404).json({ error: 'Creative not found' });

  res.json({ project: { id: project.id, name: project.name, clientName: project.clientName }, creative });
});

// Update creative (caption, title, status)
app.patch('/api/projects/:projectId/creatives/:creativeId', (req, res) => {
  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const creative = project.creatives.find(c => c.id === req.params.creativeId);
  if (!creative) return res.status(404).json({ error: 'Creative not found' });

  const { caption, title, status } = req.body;
  if (caption !== undefined) creative.caption = caption;
  if (title !== undefined) creative.title = title;
  if (status !== undefined) {
    const validStatuses = ['pending', 'approved', 'revision_requested'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    creative.status = status;
    if (status === 'revision_requested') {
      creative.revisionNumber = (creative.revisionNumber || 1) + 1;
    }
  }

  writeProjects(projects);
  res.json(creative);
});

// Delete a creative
app.delete('/api/projects/:projectId/creatives/:creativeId', (req, res) => {
  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const idx = project.creatives.findIndex(c => c.id === req.params.creativeId);
  if (idx === -1) return res.status(404).json({ error: 'Creative not found' });

  const creative = project.creatives[idx];
  // Remove the file
  const filePath = path.join(__dirname, creative.filePath);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  project.creatives.splice(idx, 1);
  writeProjects(projects);
  res.json({ success: true });
});

// Add comment to a creative
app.post('/api/projects/:projectId/creatives/:creativeId/comments', (req, res) => {
  const { author, text } = req.body;
  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Comment text is required' });
  }

  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const creative = project.creatives.find(c => c.id === req.params.creativeId);
  if (!creative) return res.status(404).json({ error: 'Creative not found' });

  const comment = {
    id: uuidv4(),
    author: (author || 'Anonymous').trim(),
    text: text.trim(),
    createdAt: new Date().toISOString()
  };

  creative.comments.push(comment);
  writeProjects(projects);
  res.status(201).json(comment);
});

// Delete a comment
app.delete('/api/projects/:projectId/creatives/:creativeId/comments/:commentId', (req, res) => {
  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const creative = project.creatives.find(c => c.id === req.params.creativeId);
  if (!creative) return res.status(404).json({ error: 'Creative not found' });

  const idx = creative.comments.findIndex(c => c.id === req.params.commentId);
  if (idx === -1) return res.status(404).json({ error: 'Comment not found' });

  creative.comments.splice(idx, 1);
  writeProjects(projects);
  res.json({ success: true });
});

// Shareable review link (serves the review page)
app.get('/review/:projectId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'review.html'));
});

// Single creative review page
app.get('/review/:projectId/:creativeId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'review.html'));
});

// Catch-all: serve index
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling for multer and other upload errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large. Maximum size is 500MB per file.' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Maximum is 50 files at once.' });
    }
    return res.status(400).json({ error: `Upload error: ${err.message}` });
  }
  if (err) {
    return res.status(400).json({ error: err.message || 'Upload failed' });
  }
  next();
});

app.listen(PORT, () => {
  console.log(`Creative Approval Tool running at http://localhost:${PORT}`);
});
