#!/bin/bash
#
# Jawab24 Database Backup Script
#
# Usage:
#   ./scripts/backup.sh              # Local backup + B2 upload (if configured)
#   ./scripts/backup.sh --local-only # Skip B2 upload
#
# Environment (optional — loaded from env/backup.env if present):
#   B2_APPLICATION_KEY_ID  — Backblaze B2 key ID
#   B2_APPLICATION_KEY     — Backblaze B2 application key
#   B2_BUCKET_NAME         — B2 bucket name (default: jawab24-backups)
#
# Cron example (daily at 3 AM):
#   0 3 * * * cd /var/www/jawab24 && ./scripts/backup.sh >> /var/log/jawab24-backup.log 2>&1

set -euo pipefail

# Configuration
DB_CONTAINER="jawab24-postgres"
DB_USER="postgres"
DB_NAME="jawab24"
BACKUP_DIR="./backups"
LOCAL_RETENTION=7        # Keep last N local backups
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/jawab24_${TIMESTAMP}.sql.gz"
LOCAL_ONLY=false

# Colors (disabled in non-interactive / cron)
if [ -t 1 ]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    BLUE='\033[0;34m'
    YELLOW='\033[1;33m'
    NC='\033[0m'
else
    RED='' GREEN='' BLUE='' YELLOW='' NC=''
fi

# Parse arguments
for arg in "$@"; do
    case $arg in
        --local-only) LOCAL_ONLY=true ;;
    esac
done

# Load B2 credentials if available
if [ -f ./env/backup.env ]; then
    export $(grep -v '^#' ./env/backup.env | grep -v '^$' | xargs)
fi

B2_BUCKET="${B2_BUCKET_NAME:-jawab24-backups}"

log() { echo -e "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

# =============================================
# 1. Create backup directory
# =============================================
mkdir -p "$BACKUP_DIR"

# =============================================
# 2. Dump database
# =============================================
log "${BLUE}Starting database backup...${NC}"

if ! docker compose exec -T postgres pg_dump -U "$DB_USER" "$DB_NAME" 2>/dev/null | gzip > "$BACKUP_FILE"; then
    log "${RED}FAILED: pg_dump failed!${NC}"
    rm -f "$BACKUP_FILE"
    exit 1
fi

# =============================================
# 3. Verify backup integrity
# =============================================
if ! gzip -t "$BACKUP_FILE" 2>/dev/null; then
    log "${RED}FAILED: Backup file is corrupt!${NC}"
    rm -f "$BACKUP_FILE"
    exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
log "${GREEN}Backup created: ${BACKUP_FILE} (${BACKUP_SIZE})${NC}"

# =============================================
# 4. Upload to Backblaze B2 (if configured)
# =============================================
if [ "$LOCAL_ONLY" = true ]; then
    log "${YELLOW}Skipping B2 upload (--local-only)${NC}"
elif [ -z "${B2_APPLICATION_KEY_ID:-}" ] || [ -z "${B2_APPLICATION_KEY:-}" ]; then
    log "${YELLOW}B2 not configured — local backup only. Set env/backup.env to enable offsite backups.${NC}"
else
    log "${BLUE}Uploading to Backblaze B2 (${B2_BUCKET})...${NC}"

    # Authorize if needed (b2 caches auth between runs)
    if ! b2 account authorize "$B2_APPLICATION_KEY_ID" "$B2_APPLICATION_KEY" > /dev/null 2>&1; then
        log "${RED}FAILED: B2 authorization failed! Check credentials in env/backup.env${NC}"
        # Don't exit — local backup succeeded
    else
        REMOTE_NAME="$(basename "$BACKUP_FILE")"
        if b2 file upload "$B2_BUCKET" "$BACKUP_FILE" "$REMOTE_NAME" > /dev/null 2>&1; then
            log "${GREEN}Uploaded to B2: ${B2_BUCKET}/${REMOTE_NAME}${NC}"
        else
            log "${RED}FAILED: B2 upload failed! Local backup is still available.${NC}"
        fi
    fi
fi

# =============================================
# 5. Clean old local backups
# =============================================
log "${BLUE}Cleaning old local backups (keeping last ${LOCAL_RETENTION})...${NC}"
DELETED=$(ls -t ${BACKUP_DIR}/jawab24_*.sql.gz 2>/dev/null | tail -n +$((LOCAL_RETENTION + 1)) | wc -l | tr -d ' ')
ls -t ${BACKUP_DIR}/jawab24_*.sql.gz 2>/dev/null | tail -n +$((LOCAL_RETENTION + 1)) | xargs -r rm

if [ "$DELETED" -gt 0 ] 2>/dev/null; then
    log "Removed ${DELETED} old backup(s)"
fi

# =============================================
# Done
# =============================================
log "${GREEN}Backup complete!${NC}"
