#!/bin/bash
# Fix Migration Tracking - Run after deployment completes
# This syncs Drizzle's metadata with the actual database state

set -e

echo "🔧 Fixing Drizzle Migration Tracking"
echo "===================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

cd backend

echo "1️⃣  Generating Drizzle metadata from current database state..."
echo ""
echo -e "${YELLOW}This will connect to production DB and generate metadata${NC}"
echo -e "${YELLOW}Make sure DATABASE_URL is set in .env${NC}"
echo ""

# Generate metadata from actual database
npx drizzle-kit introspect:pg

echo ""
echo "2️⃣  Reviewing generated files..."
ls -la drizzle/

echo ""
echo "3️⃣  Moving metadata to migrations folder..."
# Drizzle generates to drizzle/ by default, we need it in migrations/
if [ -d "drizzle" ]; then
    # Create meta folder if it doesn't exist
    mkdir -p migrations/meta
    
    # Move snapshot files
    if [ -f "drizzle/meta/_journal.json" ]; then
        cp drizzle/meta/_journal.json migrations/meta/
        echo "   ✅ Copied _journal.json"
    fi
    
    # Move snapshot files
    cp drizzle/meta/*.json migrations/meta/ 2>/dev/null || true
    echo "   ✅ Copied snapshot files"
    
    # Clean up
    rm -rf drizzle
    echo "   ✅ Cleaned up temp folder"
fi

echo ""
echo -e "${GREEN}✅ Migration tracking fixed!${NC}"
echo ""
echo "Next steps:"
echo "1. Review the files in migrations/meta/"
echo "2. Commit the metadata files:"
echo "   git add migrations/meta/"
echo "   git commit -m 'chore(db): add Drizzle metadata for existing migrations'"
echo "3. Re-enable schema drift check in pre-deploy-check.sh"
echo ""
echo "From now on, use: npm run db:generate"
