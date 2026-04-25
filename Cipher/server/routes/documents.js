'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');
const { encryptFile, decryptFile } = require('../utils/encryption');
const logger = require('../utils/logger');

const router = express.Router();
const prisma = new PrismaClient();

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const MAX_SIZE_MB = parseInt(process.env.MAX_FILE_SIZE_MB || '50');

// Multer — store to temp before encryption
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(UPLOAD_DIR, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const allowedTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/webp',
  'text/plain',
];

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

router.use(authenticate);

// ── POST /api/documents/upload ───────────────────────────────────────────────
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided' });
  }

  const tempPath = req.file.path;

  try {
    const encryptedDir = path.join(UPLOAD_DIR, 'encrypted', req.user.id);
    if (!fs.existsSync(encryptedDir)) fs.mkdirSync(encryptedDir, { recursive: true });

    // Encrypt the file
    const { encryptedPath, iv } = encryptFile(tempPath, encryptedDir);

    // Remove temp file
    fs.unlinkSync(tempPath);

    const doc = await prisma.document.create({
      data: {
        userId: req.user.id,
        filename: path.basename(encryptedPath),
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        encryptedPath,
        iv,
      },
    });

    logger.info(`Document uploaded and encrypted: ${doc.id} by ${req.user.email}`);

    res.status(201).json({
      id: doc.id,
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      createdAt: doc.createdAt,
      encrypted: true,
    });
  } catch (err) {
    // Cleanup on error
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    logger.error('Upload error', { error: err.message });
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ── GET /api/documents ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const where = req.user.role === 'MEMBER' ? { userId: req.user.id } : {};
    const docs = await prisma.document.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, originalName: true, mimeType: true,
        sizeBytes: true, createdAt: true,
        user: { select: { fullName: true } },
      },
    });
    res.json(docs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

// ── GET /api/documents/:id/download ─────────────────────────────────────────
router.get('/:id/download', async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });

    if (!doc) return res.status(404).json({ error: 'Document not found' });

    if (req.user.role === 'MEMBER' && doc.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    if (!fs.existsSync(doc.encryptedPath)) {
      return res.status(404).json({ error: 'File not found on server' });
    }

    const decrypted = decryptFile(doc.encryptedPath, doc.iv);

    res.set({
      'Content-Type': doc.mimeType,
      'Content-Disposition': `attachment; filename="${doc.originalName}"`,
      'Content-Length': decrypted.length,
      'X-Cipher-Encrypted': 'AES-256-CBC',
    });

    res.send(decrypted);

    logger.info(`Document downloaded: ${doc.id} by ${req.user.email}`);
  } catch (err) {
    logger.error('Download error', { error: err.message });
    res.status(500).json({ error: 'Download failed' });
  }
});

// ── DELETE /api/documents/:id ────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const doc = await prisma.document.findUnique({ where: { id: req.params.id } });

    if (!doc) return res.status(404).json({ error: 'Document not found' });
    if (req.user.role === 'MEMBER' && doc.userId !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Delete encrypted file from disk
    if (fs.existsSync(doc.encryptedPath)) {
      fs.unlinkSync(doc.encryptedPath);
    }

    await prisma.document.delete({ where: { id: req.params.id } });

    logger.info(`Document deleted: ${req.params.id} by ${req.user.email}`);
    res.json({ message: 'Document permanently deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
