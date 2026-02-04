require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const archiver = require('archiver');

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
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    // Use Gmail service shorthand for Google accounts (handles Workspace better)
    if (!process.env.SMTP_HOST || process.env.SMTP_HOST === 'smtp.gmail.com') {
      return nodemailer.createTransport({
        service: 'gmail',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS.replace(/\s/g, '')
        }
      });
    }
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

// ─── Data Helpers ─────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_SETTINGS = {
  brandName: 'ReviewFlow',
  logoUrl: null,
  theme: 'dark',
  accentColor: '#6366f1'
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  if (!fs.existsSync(PROJECTS_FILE)) fs.writeFileSync(PROJECTS_FILE, '[]');
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
  if (!fs.existsSync(SETTINGS_FILE)) fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2));
}

// Serve uploads from inside data dir (persistent disk)
ensureDataDir();
app.use('/uploads', express.static(UPLOADS_DIR));

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

function readSettings() {
  ensureDataDir();
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeSettings(settings) {
  ensureDataDir();
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
}

// ─── Admin Auth Middleware ────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ error: 'Admin authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.admin) throw new Error();
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid admin token' });
  }
}

// Admin login
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Wrong password' });
  }
});

// Verify admin token
app.get('/api/admin/verify', (req, res) => {
  const token = req.headers['x-admin-token'];
  if (!token) return res.status(401).json({ valid: false });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload.admin) throw new Error();
    res.json({ valid: true });
  } catch {
    res.status(401).json({ valid: false });
  }
});

// ─── Auth Middleware (user) ──────────────────────────────────
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

// ─── Settings Routes ─────────────────────────────────────────

app.get('/api/settings', (req, res) => {
  res.json(readSettings());
});

app.put('/api/settings', requireAdmin, (req, res) => {
  const settings = readSettings();
  const { brandName, theme, accentColor } = req.body;
  if (brandName !== undefined) settings.brandName = (brandName.trim() || 'ReviewFlow');
  if (theme !== undefined && ['dark', 'light'].includes(theme)) settings.theme = theme;
  if (accentColor !== undefined && /^#[0-9a-fA-F]{6}$/.test(accentColor)) settings.accentColor = accentColor;
  writeSettings(settings);
  res.json(settings);
});

// Logo upload
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOADS_DIR, 'branding');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `logo_${Date.now()}${ext}`);
  }
});

const logoUpload = multer({
  storage: logoStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
    if (allowed.test(path.extname(file.originalname))) {
      cb(null, true);
    } else {
      cb(new Error('Logo must be an image file (JPG, PNG, GIF, WebP, or SVG)'), false);
    }
  }
});

app.post('/api/settings/logo', requireAdmin, logoUpload.single('logo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const settings = readSettings();
  if (settings.logoUrl) {
    const oldPath = path.join(UPLOADS_DIR, settings.logoUrl.replace('/uploads/', ''));
    if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch {}
  }
  settings.logoUrl = `/uploads/branding/${req.file.filename}`;
  writeSettings(settings);
  res.json(settings);
});

app.delete('/api/settings/logo', requireAdmin, (req, res) => {
  const settings = readSettings();
  if (settings.logoUrl) {
    const logoPath = path.join(UPLOADS_DIR, settings.logoUrl.replace('/uploads/', ''));
    if (fs.existsSync(logoPath)) try { fs.unlinkSync(logoPath); } catch {}
  }
  settings.logoUrl = null;
  writeSettings(settings);
  res.json(settings);
});

// Multer config for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projectId = req.params.projectId;
    const dir = path.join(UPLOADS_DIR, projectId);
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

// Get all projects (filter by archived status)
app.get('/api/projects', requireAdmin, (req, res) => {
  const projects = readProjects();
  const showArchived = req.query.archived === 'true';
  const filtered = projects.filter(p => showArchived ? p.archived === true : !p.archived);
  const summaries = filtered.map(p => ({
    id: p.id,
    name: p.name,
    clientName: p.clientName,
    createdAt: p.createdAt,
    archived: !!p.archived,
    creativeCount: p.creatives.length,
    approvedCount: p.creatives.filter(c => c.status === 'approved').length,
    pendingCount: p.creatives.filter(c => c.status === 'pending').length,
    revisionCount: p.creatives.filter(c => c.status === 'revision_requested').length,
    thumbnails: p.creatives.slice(0, 4).map(c => ({
      filePath: c.filePath,
      mediaType: c.mediaType
    }))
  }));
  res.json(summaries);
});

// Get all unique client names for autocomplete
app.get('/api/client-names', requireAdmin, (req, res) => {
  const projects = readProjects();
  const names = [...new Set(
    projects.map(p => p.clientName).filter(n => n && n.trim())
  )].sort();
  res.json(names);
});

// Create a new project
app.post('/api/projects', requireAdmin, (req, res) => {
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

// Export project as PDF
app.get('/api/projects/:projectId/export-pdf', async (req, res) => {
  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  try {
    const doc = new PDFDocument({
      size: 'letter',
      margin: 50,
      info: {
        Title: `${project.name} - Creative Review`,
        Author: readSettings().brandName || 'ReviewFlow'
      }
    });

    doc.on('error', (err) => {
      console.error('PDF stream error:', err.message);
    });

    const safeName = project.name.replace(/[^a-zA-Z0-9_\- ]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_review.pdf"`);
    doc.pipe(res);

    const pageW = 512; // usable width (612 - 2*50)

    // ── Cover Page ──
    doc.moveDown(4);
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#000').text(project.name, { align: 'center' });
    doc.moveDown(0.5);
    if (project.clientName) {
      doc.fontSize(14).font('Helvetica').fillColor('#666').text(`Client: ${project.clientName}`, { align: 'center' });
    }
    doc.moveDown(1);
    doc.fontSize(11).fillColor('#999').text(
      `Exported ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`,
      { align: 'center' }
    );

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(562, doc.y).strokeColor('#ddd').stroke();
    doc.moveDown(1.5);

    const total = project.creatives.length;
    const approved = project.creatives.filter(c => c.status === 'approved').length;
    const pending = project.creatives.filter(c => c.status === 'pending').length;
    const revision = project.creatives.filter(c => c.status === 'revision_requested').length;

    doc.fontSize(14).font('Helvetica-Bold').fillColor('#333').text(
      `${total} Creative${total !== 1 ? 's' : ''}`, { align: 'center' }
    );
    doc.moveDown(0.3);
    doc.fontSize(11).font('Helvetica').fillColor('#666').text(
      `${approved} Approved  ·  ${pending} Pending  ·  ${revision} Revision${revision !== 1 ? 's' : ''}`,
      { align: 'center' }
    );

    // ── Creative Pages ──
    const statusColors = { approved: '#22c55e', pending: '#eab308', revision_requested: '#f97316' };
    const statusLabels = { approved: 'Approved', pending: 'Pending Review', revision_requested: 'Revision Requested' };
    const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];

    for (let idx = 0; idx < project.creatives.length; idx++) {
      const creative = project.creatives[idx];
      doc.addPage();

      // Title
      doc.fontSize(18).font('Helvetica-Bold').fillColor('#000');
      doc.text(creative.title || creative.originalName);

      // Subtitle: number + status
      doc.moveDown(0.2);
      doc.fontSize(10).font('Helvetica').fillColor('#999');
      doc.text(`Creative ${idx + 1} of ${total}`, { continued: true });
      doc.fillColor(statusColors[creative.status] || '#666');
      doc.text(`  ·  ${statusLabels[creative.status] || creative.status}`);
      doc.moveDown(0.8);

      // Image — resize with sharp to keep memory low
      if (creative.mediaType === 'image') {
        const imgPath = path.join(UPLOADS_DIR, creative.filePath.replace('/uploads/', ''));
        const ext = path.extname(imgPath).toLowerCase();

        if (fs.existsSync(imgPath) && imageExts.includes(ext)) {
          try {
            const buf = await sharp(imgPath)
              .resize(1600, 1200, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 80 })
              .toBuffer();

            doc.image(buf, { fit: [pageW, 350], align: 'center' });
            doc.moveDown(1);
          } catch (imgErr) {
            console.error(`PDF image error (${creative.originalName}):`, imgErr.message);
            doc.fontSize(10).fillColor('#999').text(`[Could not embed: ${creative.originalName}]`);
            doc.moveDown(0.5);
          }
        } else if (fs.existsSync(imgPath)) {
          doc.fontSize(10).fillColor('#999').text(`[${creative.originalName} — format not supported in PDF]`);
          doc.moveDown(0.5);
        } else {
          doc.fontSize(10).fillColor('#999').text(`[File not found: ${creative.originalName}]`);
          doc.moveDown(0.5);
        }
      } else if (creative.mediaType === 'video') {
        doc.fontSize(10).fillColor('#999').text(`[Video file: ${creative.originalName}]`);
        doc.moveDown(0.5);
      } else if (creative.mediaType === 'pdf') {
        doc.fontSize(10).fillColor('#999').text(`[PDF document: ${creative.originalName}]`);
        doc.moveDown(0.5);
      }

      // Caption
      if (creative.caption) {
        doc.moveDown(0.3);
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#333').text('Caption');
        doc.fontSize(10).font('Helvetica').fillColor('#444').text(creative.caption);
        doc.moveDown(0.5);
      }

      // Comments
      if (creative.comments.length > 0) {
        doc.moveDown(0.3);
        const resolvedCount = creative.comments.filter(c => c.resolved).length;
        const commLabel = `Comments (${creative.comments.length}${resolvedCount > 0 ? `, ${resolvedCount} resolved` : ''})`;
        doc.fontSize(10).font('Helvetica-Bold').fillColor('#333').text(commLabel);
        doc.moveDown(0.2);
        doc.moveTo(50, doc.y).lineTo(300, doc.y).strokeColor('#e0e0e0').stroke();
        doc.moveDown(0.4);

        creative.comments.forEach(comment => {
          const date = new Date(comment.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          doc.fontSize(9).font('Helvetica-Bold').fillColor('#333').text(`${comment.author}`, { continued: true });
          doc.font('Helvetica').fillColor('#999').text(`  ·  ${date}`);
          doc.fontSize(9).font('Helvetica').fillColor(comment.resolved ? '#999' : '#555').text(comment.text);
          if (comment.resolved) {
            doc.fontSize(8).fillColor('#22c55e').text('✓ Resolved');
          }
          doc.moveDown(0.4);
        });
      }
    }

    doc.end();
  } catch (err) {
    console.error('PDF generation failed:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'PDF generation failed. Try again or contact support.' });
    }
  }
});

// Download all creatives as zip
app.get('/api/projects/:projectId/download-all', (req, res) => {
  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const safeName = project.name.replace(/[^a-zA-Z0-9_\- ]/g, '_');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}_creatives.zip"`);

  const archive = archiver('zip', { zlib: { level: 5 } });
  archive.on('error', (err) => {
    console.error('Archive error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Download failed' });
  });
  archive.pipe(res);

  project.creatives.forEach(creative => {
    const filePath = path.join(UPLOADS_DIR, creative.filePath.replace('/uploads/', ''));
    if (fs.existsSync(filePath)) {
      archive.file(filePath, { name: creative.title ? `${creative.title}${path.extname(creative.originalName)}` : creative.originalName });
    }
  });

  archive.finalize();
});

// Download single creative file
app.get('/api/projects/:projectId/creatives/:creativeId/download', (req, res) => {
  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const creative = project.creatives.find(c => c.id === req.params.creativeId);
  if (!creative) return res.status(404).json({ error: 'Creative not found' });

  const filePath = path.join(UPLOADS_DIR, creative.filePath.replace('/uploads/', ''));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  res.download(filePath, creative.originalName);
});

// Update project (archive/unarchive, rename)
app.patch('/api/projects/:projectId', requireAdmin, (req, res) => {
  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { name, clientName, archived } = req.body;
  if (name !== undefined) project.name = name.trim();
  if (clientName !== undefined) project.clientName = clientName.trim();
  if (archived !== undefined) project.archived = !!archived;

  writeProjects(projects);
  res.json(project);
});

// Delete a project
app.delete('/api/projects/:projectId', requireAdmin, (req, res) => {
  const projects = readProjects();
  const idx = projects.findIndex(p => p.id === req.params.projectId);
  if (idx === -1) return res.status(404).json({ error: 'Project not found' });

  // Remove uploaded files
  const uploadDir = path.join(UPLOADS_DIR, req.params.projectId);
  if (fs.existsSync(uploadDir)) {
    fs.rmSync(uploadDir, { recursive: true, force: true });
  }

  projects.splice(idx, 1);
  writeProjects(projects);
  res.json({ success: true });
});

// Upload creatives to a project
app.post('/api/projects/:projectId/creatives', requireAdmin, (req, res, next) => {
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

  const { caption, captionAuthor, title, status, imageText } = req.body;
  if (caption !== undefined) {
    const prev = creative.caption || '';
    creative.caption = caption;

    // Track caption changes with author
    if (captionAuthor && caption !== prev) {
      if (!creative.captionData) creative.captionData = { original: prev, history: [] };
      if (!creative.captionData.original && prev) creative.captionData.original = prev;
      creative.captionData.history.push({
        text: prev,
        author: captionAuthor,
        timestamp: new Date().toISOString()
      });
      creative.captionData.lastEditedBy = captionAuthor;
      creative.captionData.lastEditedAt = new Date().toISOString();
    }
  }
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

  // Image text (OCR) — supports original extraction and client edits with history
  if (imageText !== undefined) {
    if (!creative.imageText) creative.imageText = {};

    // Setting the original OCR text (first extraction)
    if (imageText.original !== undefined && !creative.imageText.original) {
      creative.imageText.original = imageText.original;
      creative.imageText.current = imageText.original;
      creative.imageText.history = [];
    }

    // Client editing the text — track who changed what
    if (imageText.current !== undefined && imageText.author) {
      const prev = creative.imageText.current || '';
      if (imageText.current !== prev) {
        if (!creative.imageText.history) creative.imageText.history = [];
        creative.imageText.history.push({
          text: prev,
          author: imageText.author,
          timestamp: new Date().toISOString()
        });
        creative.imageText.current = imageText.current;
        creative.imageText.lastEditedBy = imageText.author;
        creative.imageText.lastEditedAt = new Date().toISOString();
      }
    }
  }

  writeProjects(projects);
  res.json(creative);
});

// Upload new version of a creative
app.post('/api/projects/:projectId/creatives/:creativeId/versions', requireAdmin, (req, res, next) => {
  req.setTimeout(30 * 60 * 1000);
  res.setTimeout(30 * 60 * 1000);
  next();
}, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const creative = project.creatives.find(c => c.id === req.params.creativeId);
  if (!creative) return res.status(404).json({ error: 'Creative not found' });

  // Initialize versions array if it doesn't exist
  if (!creative.versions) creative.versions = [];

  // Save current file as a previous version
  creative.versions.push({
    versionNumber: creative.versions.length + 1,
    fileName: creative.fileName,
    filePath: creative.filePath,
    originalName: creative.originalName,
    fileSize: creative.fileSize,
    mimeType: creative.mimeType,
    mediaType: creative.mediaType,
    uploadedAt: creative.uploadedAt
  });

  // Update creative with new file
  const ext = path.extname(req.file.originalname).toLowerCase();
  const isVideo = ['.mp4', '.mov', '.avi', '.webm', '.mkv', '.m4v', '.wmv'].includes(ext);
  const isPdf = ext === '.pdf';

  creative.originalName = req.file.originalname;
  creative.fileName = req.file.filename;
  creative.filePath = `/uploads/${req.params.projectId}/${req.file.filename}`;
  creative.fileSize = req.file.size;
  creative.mimeType = req.file.mimetype;
  creative.mediaType = isVideo ? 'video' : isPdf ? 'pdf' : 'image';
  creative.uploadedAt = new Date().toISOString();
  creative.status = 'pending'; // Reset status for new version

  writeProjects(projects);
  res.json(creative);
});

// Delete a creative
app.delete('/api/projects/:projectId/creatives/:creativeId', requireAdmin, (req, res) => {
  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const idx = project.creatives.findIndex(c => c.id === req.params.creativeId);
  if (idx === -1) return res.status(404).json({ error: 'Creative not found' });

  const creative = project.creatives[idx];
  // Remove the file
  const filePath = path.join(UPLOADS_DIR, creative.filePath.replace('/uploads/', ''));
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

  // Support pin annotations (optional x/y as percentages)
  if (req.body.pinX !== undefined && req.body.pinY !== undefined) {
    comment.pinX = parseFloat(req.body.pinX);
    comment.pinY = parseFloat(req.body.pinY);
  }

  creative.comments.push(comment);
  writeProjects(projects);
  res.status(201).json(comment);
});

// Resolve/unresolve a comment
app.patch('/api/projects/:projectId/creatives/:creativeId/comments/:commentId', (req, res) => {
  const projects = readProjects();
  const project = projects.find(p => p.id === req.params.projectId);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const creative = project.creatives.find(c => c.id === req.params.creativeId);
  if (!creative) return res.status(404).json({ error: 'Creative not found' });

  const comment = creative.comments.find(c => c.id === req.params.commentId);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });

  if (req.body.resolved !== undefined) {
    comment.resolved = !!req.body.resolved;
    if (comment.resolved) {
      comment.resolvedAt = new Date().toISOString();
    } else {
      delete comment.resolvedAt;
    }
  }

  writeProjects(projects);
  res.json(comment);
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
