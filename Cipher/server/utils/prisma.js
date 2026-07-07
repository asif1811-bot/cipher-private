// Shared Prisma client singleton — prevents 40+ instances
"use strict";
const { PrismaClient } = require('@prisma/client');

if (!global.__prismaClient) {
  global.__prismaClient = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

module.exports = global.__prismaClient;
