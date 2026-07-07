#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/var/backups/cipher"
mkdir -p $BACKUP_DIR

echo "[BACKUP] Starting: $DATE"

# 1. Database backup with correct credentials
PGPASSWORD="CipherPrivate2024Secure" pg_dump -U cipheruser -h localhost cipherdb > $BACKUP_DIR/db_$DATE.sql
DB_LINES=$(wc -l < $BACKUP_DIR/db_$DATE.sql)
echo "[BACKUP] DB: $DB_LINES lines"

# 2. .env backup
cp /var/www/cipher-private/.env $BACKUP_DIR/env_$DATE.txt

# 3. Code backup
tar -czf $BACKUP_DIR/code_$DATE.tar.gz \
  /var/www/cipher-private/prisma/schema.prisma \
  /var/www/cipher-private/Cipher/server/services/ \
  /var/www/cipher-private/Cipher/server/routes/ \
  /var/www/cipher-private/automation_cron.js \
  /var/www/cipher-private/cc_admin.html \
  /var/www/cipher-private/cc_portal.html \
  2>/dev/null
CODE_SIZE=$(du -sh $BACKUP_DIR/code_$DATE.tar.gz | cut -f1)
echo "[BACKUP] Code: $CODE_SIZE"

# 4. Keep only 7 days
find $BACKUP_DIR -mtime +7 -delete 2>/dev/null

# 5. Notify
node -e "
require('dotenv').config({path:'/var/www/cipher-private/.env'});
const {sendWA}=require('/var/www/cipher-private/Cipher/server/services/whatsapp_notifications');
sendWA('+61413536700','✅ *Daily Backup Complete*\n\n📅 $DATE\n💾 DB: $DB_LINES lines\n📦 Code: $CODE_SIZE\n🔐 .env backed up\n\n_Auto-backup — Cipher Concierge Group_').catch(()=>{});
" 2>/dev/null

echo "[BACKUP] Done: $DATE"
