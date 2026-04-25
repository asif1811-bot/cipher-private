'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32; // 256 bits

const getKey = () => {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length < 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-char hex string (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
};

/**
 * Encrypt a file buffer using AES-256-CBC.
 * Returns { encryptedBuffer, iv }
 */
const encryptBuffer = (inputBuffer) => {
  const iv = crypto.randomBytes(16);
  const key = getKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(inputBuffer), cipher.final()]);
  return { encryptedBuffer: encrypted, iv: iv.toString('hex') };
};

/**
 * Decrypt a file buffer.
 */
const decryptBuffer = (encryptedBuffer, ivHex) => {
  const key = getKey();
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
};

/**
 * Encrypt a file on disk and save the encrypted version.
 * Returns the path to the encrypted file and the IV.
 */
const encryptFile = (inputPath, outputDir) => {
  const inputBuffer = fs.readFileSync(inputPath);
  const { encryptedBuffer, iv } = encryptBuffer(inputBuffer);
  const encryptedFilename = crypto.randomBytes(16).toString('hex') + '.enc';
  const encryptedPath = path.join(outputDir, encryptedFilename);
  fs.writeFileSync(encryptedPath, encryptedBuffer);
  return { encryptedPath, iv };
};

/**
 * Decrypt a file from disk into a buffer (for streaming to client).
 */
const decryptFile = (encryptedPath, ivHex) => {
  const encryptedBuffer = fs.readFileSync(encryptedPath);
  return decryptBuffer(encryptedBuffer, ivHex);
};

/**
 * Generate a cryptographically secure 6-digit OTP.
 */
const generateOTP = () => {
  const bytes = crypto.randomBytes(4);
  const num = bytes.readUInt32BE(0) % 1000000;
  return num.toString().padStart(6, '0');
};

/**
 * Hash an OTP for secure storage.
 */
const hashOTP = (otp) => {
  return crypto.createHash('sha256').update(otp + process.env.JWT_SECRET).digest('hex');
};

/**
 * Verify an OTP against its stored hash.
 */
const verifyOTP = (otp, hash) => {
  const computed = hashOTP(otp);
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
};

module.exports = {
  encryptBuffer,
  decryptBuffer,
  encryptFile,
  decryptFile,
  generateOTP,
  hashOTP,
  verifyOTP,
};
