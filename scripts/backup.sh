#!/bin/bash

# Jawab24 Database Backup Script
# Usage: ./scripts/backup.sh

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
BACKUP_DIR="./backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/jawab24_backup_${TIMESTAMP}.sql"

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo -e "${BLUE}[INFO]${NC} Starting database backup..."

# Create backup
docker-compose exec -T postgres pg_dump -U postgres autoreply > "$BACKUP_FILE"

# Compress backup
gzip "$BACKUP_FILE"

echo -e "${GREEN}[SUCCESS]${NC} Backup created: ${BACKUP_FILE}.gz"

# Keep only last 7 backups
echo -e "${BLUE}[INFO]${NC} Cleaning old backups..."
ls -t ${BACKUP_DIR}/*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm

echo -e "${GREEN}[SUCCESS]${NC} Backup complete!"

