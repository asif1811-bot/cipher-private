'use strict';

require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

const uploadDir = process.env.UPLOAD_DIR || './uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'operational', service: 'Cipher Private', timestamp: new Date().toISOString() });
});

app.get('*', (_req, res) => {
  const htmlPath = path.join(__dirname, '../index.html');
  if (fs.existsSync(htmlPath)) {
    res.sendFile(htmlPath);
  } else {
    res.send('<h1 style="font-family:serif;text-align:center;margin-top:20vh;color:#c9a96e">Cipher Private</h1>');
  }
});

app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({ error: err.message });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log('Cipher Private running on port ' + PORT);
});

module.exports = { app, server };
