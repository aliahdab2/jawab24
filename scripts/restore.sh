#!/bin/bash

# Jawab24 Database Restore Script
# Usage: ./scripts/restore.sh <backup_file>

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Check argument
if [ -z "$1" ]; then
    echo -e "${RED}[ERROR]${NC} Please provide a backup file."
    echo "Usage: $0 <backup_file.sql.gz>"
    echo ""
    echo "Available backups:"
    ls -la ./backups/*.sql.gz 2>/dev/null || echo "No backups found."
    exit 1
fi

BACKUP_FILE="$1"

# Check if file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}[ERROR]${NC} Backup file not found: $BACKUP_FILE"
    exit 1
fi

echo -e "${YELLOW}[WARNING]${NC} This will overwrite the current database!"
read -p "Are you sure you want to continue? (y/N) " -n 1 -r
echo

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Restore cancelled."
    exit 0
fi

echo -e "${BLUE}[INFO]${NC} Restoring database from: $BACKUP_FILE"

# Decompress if needed
if [[ "$BACKUP_FILE" == *.gz ]]; then
    echo -e "${BLUE}[INFO]${NC} Decompressing backup..."
    gunzip -c "$BACKUP_FILE" | docker-compose exec -T postgres psql -U postgres autoreply
else
    docker-compose exec -T postgres psql -U postgres autoreply < "$BACKUP_FILE"
fi

echo -e "${GREEN}[SUCCESS]${NC} Database restored successfully!"

