#!/bin/bash
#
# Jawab24 Database Restore Script
#
# Usage:
#   ./scripts/restore.sh <backup_file.sql.gz>       # Restore from local file
#   ./scripts/restore.sh --from-b2 <remote_filename> # Download from B2 and restore
#   ./scripts/restore.sh --list-b2                   # List available B2 backups

set -euo pipefail

# Configuration
DB_USER="postgres"
DB_NAME="jawab24"
BACKUP_DIR="./backups"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Load B2 credentials if available
if [ -f ./env/backup.env ]; then
    export $(grep -v '^#' ./env/backup.env | grep -v '^$' | xargs)
fi
B2_BUCKET="${B2_BUCKET_NAME:-jawab24-backups}"

# --- B2: List remote backups ---
if [ "${1:-}" = "--list-b2" ]; then
    if [ -z "${B2_APPLICATION_KEY_ID:-}" ] || [ -z "${B2_APPLICATION_KEY:-}" ]; then
        echo -e "${RED}[ERROR]${NC} B2 not configured. Set env/backup.env first."
        exit 1
    fi
    b2 account authorize "$B2_APPLICATION_KEY_ID" "$B2_APPLICATION_KEY" > /dev/null 2>&1
    echo -e "${BLUE}Remote backups in ${B2_BUCKET}:${NC}"
    b2 ls "$B2_BUCKET" | sort -r
    exit 0
fi

# --- B2: Download and restore ---
if [ "${1:-}" = "--from-b2" ]; then
    REMOTE_FILE="${2:-}"
    if [ -z "$REMOTE_FILE" ]; then
        echo -e "${RED}[ERROR]${NC} Specify the remote filename."
        echo "Usage: $0 --from-b2 <remote_filename>"
        echo "Run '$0 --list-b2' to see available backups."
        exit 1
    fi
    if [ -z "${B2_APPLICATION_KEY_ID:-}" ] || [ -z "${B2_APPLICATION_KEY:-}" ]; then
        echo -e "${RED}[ERROR]${NC} B2 not configured. Set env/backup.env first."
        exit 1
    fi

    mkdir -p "$BACKUP_DIR"
    LOCAL_PATH="${BACKUP_DIR}/${REMOTE_FILE}"

    echo -e "${BLUE}[INFO]${NC} Downloading ${REMOTE_FILE} from B2..."
    b2 account authorize "$B2_APPLICATION_KEY_ID" "$B2_APPLICATION_KEY" > /dev/null 2>&1
    b2 file download "b2://${B2_BUCKET}/${REMOTE_FILE}" "$LOCAL_PATH"
    echo -e "${GREEN}[OK]${NC} Downloaded to ${LOCAL_PATH}"

    # Continue to restore the downloaded file
    BACKUP_FILE="$LOCAL_PATH"
else
    # --- Local file restore ---
    BACKUP_FILE="${1:-}"
fi

# Check argument
if [ -z "$BACKUP_FILE" ]; then
    echo -e "${RED}[ERROR]${NC} Please provide a backup file."
    echo ""
    echo "Usage:"
    echo "  $0 <backup_file.sql.gz>         Restore from local file"
    echo "  $0 --from-b2 <remote_filename>  Download from B2 and restore"
    echo "  $0 --list-b2                    List available B2 backups"
    echo ""
    echo "Local backups:"
    ls -lh ${BACKUP_DIR}/jawab24_*.sql.gz 2>/dev/null || echo "  No local backups found."
    exit 1
fi

# Check if file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}[ERROR]${NC} Backup file not found: $BACKUP_FILE"
    exit 1
fi

BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)

echo ""
echo -e "${YELLOW}WARNING: This will OVERWRITE the current '${DB_NAME}' database!${NC}"
echo -e "File: ${BACKUP_FILE} (${BACKUP_SIZE})"
echo ""
read -p "Are you sure? (y/N) " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Restore cancelled."
    exit 0
fi

echo -e "${BLUE}[INFO]${NC} Restoring database from: $BACKUP_FILE"

if [[ "$BACKUP_FILE" == *.gz ]]; then
    gunzip -c "$BACKUP_FILE" | docker compose exec -T postgres psql -U "$DB_USER" "$DB_NAME"
else
    docker compose exec -T postgres psql -U "$DB_USER" "$DB_NAME" < "$BACKUP_FILE"
fi

echo -e "${GREEN}[SUCCESS]${NC} Database restored successfully!"
