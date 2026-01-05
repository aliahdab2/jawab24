# Migration Tracking Fix - Action Plan

## 📋 **Current Status**

- ✅ Deployment in progress (applying migration 003)
- ⚠️ Schema drift check temporarily disabled
- ⚠️ Drizzle doesn't know about existing migrations

---

## 🎯 **Action Plan (Run After Deployment Completes)**

### **Step 1: Fix Migration Tracking**

```bash
# This generates Drizzle metadata from the actual database
./scripts/fix-migration-tracking.sh
```

**What it does:**
- Connects to production database
- Reads actual schema (including `direction` column)
- Generates `migrations/meta/` folder with tracking files
- Creates `_journal.json` and snapshot files

**Expected output:**
```
migrations/
├── 001_initial_schema.sql
├── 002_add_settings_columns.sql
├── 003_add_messages_direction.sql
└── meta/
    ├── _journal.json
    ├── 0000_snapshot.json
    ├── 0001_snapshot.json
    └── 0002_snapshot.json
```

---

### **Step 2: Commit the Metadata**

```bash
git add migrations/meta/
git commit -m "chore(db): add Drizzle metadata for existing migrations"
git push origin main
```

---

### **Step 3: Re-enable Schema Drift Check**

```bash
# This updates pre-deploy-check.sh to re-enable drift detection
./scripts/re-enable-drift-check.sh

# Apply the changes
mv scripts/pre-deploy-check-updated.sh scripts/pre-deploy-check.sh
chmod +x scripts/pre-deploy-check.sh

# Commit
git add scripts/pre-deploy-check.sh
git commit -m "feat(ci): re-enable schema drift check"
git push origin main
```

---

### **Step 4: Test It Works**

```bash
# Make a test schema change
cd backend
# Edit src/db/schema.ts (add a comment or something minor)

# Generate migration
npm run db:generate

# You should see:
# - New migration file created
# - Metadata updated
# - No errors

# Revert the test change
git checkout src/db/schema.ts
rm migrations/00X_*.sql  # Remove test migration
```

---

## ✅ **Going Forward**

### **For ALL Future Schema Changes:**

```bash
# 1. Edit schema
vim backend/src/db/schema.ts

# 2. Generate migration (ALWAYS!)
cd backend
npm run db:generate

# 3. Review the SQL
cat migrations/00X_*.sql

# 4. Test locally
npm run db:migrate

# 5. Commit BOTH schema and migration
git add src/db/schema.ts migrations/
git commit -m "feat(db): your change description"

# 6. Deploy
./scripts/deploy-production.sh -y
```

**The drift check will now:**
- ✅ Pass if you used `npm run db:generate`
- ❌ Fail if you forgot to create a migration
- ✅ Prevent schema drift issues forever!

---

## 🚨 **Important Notes**

1. **Never manually create SQL migrations** - Always use `npm run db:generate`
2. **Always commit the `meta/` folder** - Drizzle needs it for tracking
3. **Don't edit old migrations** - Create new ones to fix issues
4. **Test migrations locally first** - Before deploying to production

---

## 📊 **Verification Checklist**

After completing all steps, verify:

- [ ] `migrations/meta/` folder exists
- [ ] `_journal.json` has entries for all 3 migrations
- [ ] Schema drift check is re-enabled in `pre-deploy-check.sh`
- [ ] Test schema change generates migration correctly
- [ ] Deployment passes all checks including drift detection

---

## 🆘 **If Something Goes Wrong**

### **Drift check still fails:**
```bash
# Regenerate metadata
cd backend
rm -rf migrations/meta
npx drizzle-kit introspect:pg
```

### **Can't connect to database:**
```bash
# Check .env file has DATABASE_URL
cat backend/.env | grep DATABASE_URL

# Or use production URL temporarily
export DATABASE_URL="postgresql://user:pass@host:5432/db"
```

### **Migration conflicts:**
```bash
# Check journal
cat backend/migrations/meta/_journal.json

# Verify all migrations are listed
ls -la backend/migrations/*.sql
```

---

## 📝 **Summary**

**Before:** Manual migrations → Drizzle doesn't track → Drift detection fails
**After:** Drizzle-generated migrations → Tracked in meta/ → Drift detection works ✅

This is the **industry standard** approach used by Prisma, TypeORM, and all modern ORMs!
