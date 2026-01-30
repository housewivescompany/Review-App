require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;

// JWT secret - use env var in production
const JWT_SECRET = process.env.JWT_SECRET || 'reviewflow-dev-secret-change-in-prod';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ─── Email Config ────────────────────────────────────────────
// Configure via .env file:
//   SMTP_HOST=smtp.gmail.com
//   SMTP_PORT=587
//   SMTP_USER=you@gmail.com
//   SMTP_PASS=your-app-password
//   SMTP_FROM=ReviewFlow <you@gmail.com>
function createMailTransport() {
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return null;
}

// Middleware
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// ─── Data Helpers ─────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PROJECTS_FILE)) fs.writeFileSync(PROJECTS_FILE, '[]');
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
}

function readProjects() {
  ensureDataDir();
  return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
}

function writeProjects(projects) {
  ensureDataDir();
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

function readUsers() {
  ensureDataDir();
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

function writeUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

// ─── Auth Middleware ──────────────────────────────────────────
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      req.user = jwt.verify(token, JWT_SECRET);
    } catch { /* token invalid, continue as guest */ }
  }
  next();
}

// ─── Auth Routes ─────────────────────────────────────────────

// Request magic link
app.post('/api/auth/magic-link', async (req, res) => {
  const { email, name } = req.body;
  if (!email || !email.trim()) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const emailNorm = email.trim().toLowerCase();
  const users = readUsers();
  let user = users.find(u => u.email === emailNorm);

  if (!user) {
    // Create new user
    user = {
      id: uuidv4(),
      email: emailNorm,
      name: (name || email.split('@')[0]).trim(),
      createdAt: new Date().toISOString()
    };
    users.push(user);
    writeUsers(users);
  } else if (name && name.trim()) {
    // Update name if provided
    user.name = name.trim();
    writeUsers(users);
  }

  // Generate magic link token (valid 15 min)
  const token = jwt.sign({ userId: user.id, email: emailNorm }, JWT_SECRET, { expiresIn: '15m' });
  const magicLink = `${BASE_URL}/auth/verify?token=${token}`;

  // Try to send email
  const transport = createMailTransport();
  if (transport) {
    try {
      console.log(`Sending magic link email to ${emailNorm}...`);
      await transport.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to: emailNorm,
        subject: 'Sign in to ReviewFlow',
        html: `
          <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
            <h2 style="margin-bottom: 16px;">Sign in to ReviewFlow</h2>
            <p style="color: #666; margin-bottom: 24px;">Click the button below to sign in. This link expires in 15 minutes.</p>
            <a href="${magicLink}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 500;">Sign In</a>
            <p style="color: #999; font-size: 13px; margin-top: 24px;">If you didn't request this, you can safely ignore this email.</p>
          </div>
        `
      });
      console.log(`Magic link email sent successfully to ${emailNorm}`);
      res.json({ success: true, message: 'Magic link sent! Check your email.' });
    } catch (err) {
      console.error('Email send error:', err.message);
      console.log(`\n  Fallback magic link for ${emailNorm}:\n  ${magicLink}\n`);
      // Return error info + dev token fallback
      res.json({ success: true, message: `Email failed to send (${err.message}). Use the direct sign-in button below.`, devToken: token });
    }
  } else {
    // No email configured - return token directly (dev mode)
    console.log(`\n  Magic link for ${emailNorm}:\n  ${magicLink}\n`);
    res.json({ success: true, message: 'Email not configured. Use the direct sign-in button below.', devToken: token });
  }
});

// Verify magic link token (browser redirect)
app.get('/auth/verify', (req, res) => {
  const { token } = req.query;
  // Serve a tiny HTML page that stores the token and redirects
  res.send(`
    <!DOCTYPE html>
    <html><head><title>Signing in...</title></head>
    <body>
      <p>Signing you in...</p>
      <script>
        try {
          var payload = JSON.parse(atob('${token}'.split('.')[1]));
          localStorage.setItem('reviewflow_token', '${token}');
          localStorage.setItem('reviewflow_identity', JSON.stringify({
            name: payload.name || '',
            email: payload.email || '',
            userId: payload.userId || ''
          }));
        } catch(e) {}
        // Redirect to where they came from, or home
        var redirect = localStorage.getItem('reviewflow_redirect') || '/';
        localStorage.removeItem('reviewflow_redirect');
        window.location.href = redirect;
      </script>
    </body></html>
  `);
});

// Verify token via API (for JS clients)
app.post('/api/auth/verify-token', (req, res) => {
  const { token } = req.body;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    // Issue a long-lived session token (30 days)
    const users = readUsers();
    const user = users.find(u => u.id === payload.userId);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const sessionToken = jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token: sessionToken, user: { id: user.id, name: user.name, email: user.email } });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// Get current user from token
app.get('/api/auth/me', optionalAuth, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  const users = readUsers();
  const user = users.find(u => u.id === req.user.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ id: user.id, name: user.name, email: user.email });
});

// Update user profile
app.patch('/api/auth/me', optionalAuth, (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  const users = readUsers();
  const user = users.find(u => u.id === req.user.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });

  if (req.body.name) user.name = req.body.name.trim();
  writeUsers(users);

  // Issue updated token
  const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

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

// Get all unique client names for autocomplete
app.get('/api/client-names', (req, res) => {
  const projects = readProjects();
  const names = [...new Set(
    projects.map(p => p.clientName).filter(n => n && n.trim())
  )].sort();
  res.json(names);
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
