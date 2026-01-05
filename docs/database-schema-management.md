# Database Schema Management Best Practices

## 🎯 Problem We're Solving

**Issue:** Schema drift - when `schema.ts` (code) doesn't match the actual database structure.

**Symptoms:**
- Production errors: "column does not exist"
- Drizzle errors: "UNDEFINED_VALUE"
- Features work locally but break in production

---

## ✅ Recommended Workflow (Schema-First)

### **1. Making Schema Changes**

```bash
# Step 1: Edit your schema
vim backend/src/db/schema.ts

# Step 2: Generate migration automatically
cd backend
npm run db:generate

# Step 3: Review the generated SQL
cat migrations/00X_*.sql

# Step 4: (Optional) Edit the migration if needed
# - Add data transformations
# - Add indexes
# - Handle edge cases

# Step 5: Test locally
npm run db:migrate

# Step 6: Commit both schema.ts AND migration
git add src/db/schema.ts migrations/
git commit -m "feat(db): add new column"
```

---

### **2. Automated Safety Checks**

Our CI/CD pipeline now includes:

```bash
✅ Step 4: Schema Drift Detection
   - Compares schema.ts with migrations
   - Blocks deployment if drift detected
   - Shows you the missing SQL

✅ Step 5: Migration Validation
   - Ensures migrations are valid SQL
   - Checks for syntax errors

✅ Step 6: Tests
   - Runs all tests including DB tests
```

**If drift is detected:**
```bash
❌ SCHEMA DRIFT DETECTED!

Your schema.ts has changes not in migrations:
- Added column: messages.direction

ACTION REQUIRED:
1. Run: npm run db:generate
2. Review: cat backend/migrations/00X_*.sql
3. Commit the migration file
```

---

## 🛠️ Available Commands

```bash
# Generate migration from schema changes
npm run db:generate

# Apply migrations to database
npm run db:migrate

# Push schema directly (DEV ONLY - dangerous!)
npm run db:push

# Open Drizzle Studio (visual DB editor)
npm run db:studio

# Check for schema drift manually
./scripts/check-schema-drift.sh

# Validate existing migrations
npm run db:validate
```

---

## 📋 Migration Naming Convention

```
backend/migrations/
├── 001_initial_schema.sql
├── 002_add_settings_columns.sql
├── 003_add_messages_direction.sql
└── 004_add_user_preferences.sql
```

**Format:** `XXX_descriptive_name.sql`
- `XXX`: Sequential number (001, 002, 003...)
- `descriptive_name`: What the migration does

---

## 🚨 Common Mistakes to Avoid

### ❌ **DON'T: Edit schema.ts without creating migration**
```typescript
// ❌ BAD: Just adding column to schema
export const users = pgTable('users', {
  newColumn: varchar('new_column'), // Added but no migration!
});
```

### ✅ **DO: Generate migration after schema change**
```bash
# ✅ GOOD: Proper workflow
1. Edit schema.ts
2. npm run db:generate
3. Review migration
4. Commit both files
```

---

### ❌ **DON'T: Use db:push in production**
```bash
# ❌ DANGEROUS: Skips migrations, can lose data
npm run db:push
```

### ✅ **DO: Use db:migrate in production**
```bash
# ✅ SAFE: Uses versioned migrations
npm run db:migrate
```

---

### ❌ **DON'T: Edit old migrations**
```bash
# ❌ BAD: Changing already-applied migration
vim migrations/001_initial_schema.sql  # Already in production!
```

### ✅ **DO: Create new migration to fix issues**
```bash
# ✅ GOOD: Create new migration
npm run db:generate
# Creates: 004_fix_column_type.sql
```

---

## 🔄 Rollback Strategy

### **If deployment fails due to migration:**

```bash
# 1. SSH to server
ssh root@your-server

# 2. Check which migration failed
docker logs jawab24-backend-blue --tail 50

# 3. Rollback the migration (if needed)
docker exec jawab24-postgres psql -U jawab24 -d jawab24 -c "
  -- Your rollback SQL here
  ALTER TABLE messages DROP COLUMN IF EXISTS direction;
"

# 4. Fix the migration locally
# 5. Redeploy
```

---

## 📊 Migration Best Practices

### **1. Make migrations reversible**
```sql
-- ✅ GOOD: Can be rolled back
ALTER TABLE users ADD COLUMN email VARCHAR(255);

-- Add rollback comment
-- ROLLBACK: ALTER TABLE users DROP COLUMN email;
```

### **2. Handle existing data**
```sql
-- ✅ GOOD: Set default for existing rows
ALTER TABLE messages 
  ADD COLUMN direction VARCHAR(10) DEFAULT 'incoming';

-- Update existing records
UPDATE messages SET direction = 'incoming' WHERE direction IS NULL;
```

### **3. Add indexes for performance**
```sql
-- ✅ GOOD: Add index for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_messages_direction 
  ON messages(direction);
```

### **4. Use IF EXISTS/IF NOT EXISTS**
```sql
-- ✅ GOOD: Idempotent (can run multiple times)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255);
DROP TABLE IF EXISTS old_table;
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
```

---

## 🎓 Learning Resources

- **Drizzle ORM Docs:** https://orm.drizzle.team/docs/migrations
- **PostgreSQL ALTER TABLE:** https://www.postgresql.org/docs/current/sql-altertable.html
- **Database Migration Patterns:** https://martinfowler.com/articles/evodb.html

---

## 🆘 Troubleshooting

### **"UNDEFINED_VALUE" Error**
**Cause:** Querying a column that doesn't exist in DB
**Fix:** Run `npm run db:generate` and deploy migration

### **"column does not exist"**
**Cause:** Schema drift
**Fix:** Check `./scripts/check-schema-drift.sh` output

### **Migration fails in production**
**Cause:** SQL syntax error or constraint violation
**Fix:** Test migration locally first with `npm run db:migrate`

---

## ✨ Summary

**Golden Rule:** 
> **Never edit `schema.ts` without running `npm run db:generate`**

**Workflow:**
1. Edit schema.ts
2. Generate migration
3. Review SQL
4. Test locally
5. Commit both files
6. Deploy (CI checks for drift automatically)

This prevents 99% of schema drift issues! 🎉
