#!/bin/bash
set -e

echo "🔍 Checking for schema drift..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check for schema drift by running generate and seeing if anything is created
cd backend

echo "📸 Checking for schema drift using drizzle-kit generate..."

# Store list of files before
FILES_BEFORE=$(ls migrations/*.sql 2>/dev/null | sort)

# Run generate (it will use drizzle.config.ts)
timeout 30 npx drizzle-kit generate:pg > /dev/null 2>&1

# Store list of files after
FILES_AFTER=$(ls migrations/*.sql 2>/dev/null | sort)

# Compare
if [ "$FILES_BEFORE" != "$FILES_AFTER" ]; then
    NEW_FILE=$(comm -13 <(echo "$FILES_BEFORE") <(echo "$FILES_AFTER") | head -n 1)
    
    echo ""
    echo -e "${RED}❌ SCHEMA DRIFT DETECTED!${NC}"
    echo ""
    echo -e "${YELLOW}Your schema.ts has changes that are not reflected in migrations.${NC}"
    echo -e "${YELLOW}New migration file generated: $NEW_FILE${NC}"
    echo ""
    echo -e "${YELLOW}Generated SQL:${NC}"
    cat "$NEW_FILE"
    echo ""
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${RED}⚠️  ACTION REQUIRED:${NC}"
    echo ""
    echo "1. Review the generated SQL above"
    echo "2. If it's correct, commit it: git add $NEW_FILE"
    echo "3. If it's incorrect, revert schema.ts changes"
    echo ""
    echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    
    # We leave the file there for the user to see/commit
    exit 1
fi

echo -e "${GREEN}✅ No schema drift detected${NC}"
echo -e "${YELLOW}ℹ️  This compares schema.ts against the migration snapshots only.${NC}"
echo -e "${YELLOW}   It cannot see a production database that was ALTERed by hand${NC}"
echo -e "${YELLOW}   (how settings.timezone came to serve a default no migration set).${NC}"
echo -e "${YELLOW}   Run ./scripts/check-live-column-defaults.sh for that.${NC}"
exit 0

