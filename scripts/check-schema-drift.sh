#!/bin/bash
set -e

echo "🔍 Checking for schema drift..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Generate a snapshot of what the schema SHOULD be
cd backend
echo "📸 Generating schema snapshot from code..."
npx drizzle-kit generate:pg --schema=./src/db/schema.ts --out=./migrations-check 2>&1 | grep -v "Warning" || true

# Check if any new migrations were generated
if [ -d "./migrations-check" ] && [ "$(ls -A ./migrations-check)" ]; then
    NEW_FILES=$(ls -1 ./migrations-check/*.sql 2>/dev/null | wc -l)
    
    if [ "$NEW_FILES" -gt 0 ]; then
        echo ""
        echo -e "${RED}❌ SCHEMA DRIFT DETECTED!${NC}"
        echo ""
        echo -e "${YELLOW}Your schema.ts has changes that are not reflected in migrations:${NC}"
        echo ""
        ls -1 ./migrations-check/*.sql
        echo ""
        echo -e "${YELLOW}Generated SQL:${NC}"
        cat ./migrations-check/*.sql
        echo ""
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        echo -e "${RED}⚠️  ACTION REQUIRED:${NC}"
        echo ""
        echo "1. Review the generated SQL above"
        echo "2. Create a new migration file:"
        echo "   ${GREEN}cp ./migrations-check/*.sql ./migrations/00X_your_migration_name.sql${NC}"
        echo "3. Or use: ${GREEN}npm run db:generate${NC}"
        echo ""
        echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
        
        # Cleanup
        rm -rf ./migrations-check
        
        exit 1
    fi
fi

# Cleanup
rm -rf ./migrations-check

echo -e "${GREEN}✅ No schema drift detected${NC}"
exit 0
