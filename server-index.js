'use strict';

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const logger = require('./utils/logger');

const authRoutes = require('./routes/auth');
const requestRoutes = require('./routes/requests');
const documentRoutes = require('./routes/documents');
const otpRoutes = require('./routes/otp');
const adminRoutes = require('./routes/admin');
const applicationRoutes = require('./routes/applications');
const chatRoutes = require('./routes/chat');

const { authenticateSocket } = require('./middleware/auth');
const { handleSocketConnection } = require('./socket/chatHandler');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: process.env.CLIENT_URL || '*',
    credentials: true,
  },
  pingTimeout: 60000,
});

// Ensure upload directory exists
const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Security
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin: process.env.CLIENT_URL || '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/chat', chatRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'operational', service: 'Cipher Private API', timestamp: new Date().toISOString() });
});

// Serve the website for all other routes
const clientHtml = path.join(__dirname, '../client/public/index.html');
app.get('*', (_req, res) => {
  if (fs.existsSync(clientHtml)) {
    res.sendFile(clientHtml);
  } else {
    res.json({ status: 'Cipher Private API is running', docs: '/api/health' });
  }
});

// Error handler
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal error' : err.message });
});

// Socket.IO
io.use(authenticateSocket);
io.on('connection', (socket) => handleSocketConnection(io, socket));

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  logger.info(`Cipher Private running on port ${PORT}`);
});

module.exports = { app, server, io };
