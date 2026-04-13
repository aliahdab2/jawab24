#!/usr/bin/env ts-node
/**
 * Migration Validation Script
 *
 * Checks SQL migration files for common issues before deployment:
 * 1. DROP TABLE before DROP CONSTRAINT (FK ordering — the bug that bit us in 0074)
 * 2. ALTER TABLE on tables that don't exist yet
 * 3. Dangerous operations without safety checks
 *
 * Key feature: Tracks tables created across ALL migrations in order,
 * so a table created in 0001 is valid to ALTER in 0002.
 */

import * as fs from 'fs';
import * as path from 'path';

interface ValidationResult {
    file: string;
    errors: string[];
    warnings: string[];
    tablesCreated: string[];
    tablesDropped: string[];
}

const MIGRATIONS_DIR = path.resolve(__dirname, '../migrations');

// Tables present before migration 0000 (initial schema bootstrap)
const INITIAL_SCHEMA_TABLES = [
    'users',
    'pages',
    'posts',
    'comments',
    'settings',
    'ai_cache',
    'logs',
    'messages',
    'instagram_media',
    'instagram_comments',
    'plans',
    'subscriptions',
    'usage',
    'usage_logs',
];

function splitStatements(sql: string): string[] {
    // Drizzle uses "--> statement-breakpoint" as a delimiter between statements.
    // Fall back to splitting on ";" for files that don't use the marker.
    const parts = sql.split(/--> statement-breakpoint/);
    return parts
        .map(s => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean);
}

/**
 * Check that DROP TABLE "X" never appears before an ALTER TABLE ... DROP CONSTRAINT
 * whose name references table X. Constraint names follow Drizzle's convention:
 *   {source_table}_{column}_{ref_table}_{ref_col}_fk
 * so a constraint pointing TO table X will contain "_X_" or end with "_X_id_fk".
 */
function checkFkDropOrder(
    fileName: string,
    statements: string[],
): string[] {
    const errors: string[] = [];

    // Map: tableName (lower) → statement index where it is dropped
    const dropTableAt = new Map<string, number>();
    // List of {constraintName, statementIndex}
    const dropConstraints: { name: string; idx: number }[] = [];

    statements.forEach((stmt, idx) => {
        const dropMatch = stmt.match(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/i);
        if (dropMatch) {
            dropTableAt.set(dropMatch[1].toLowerCase(), idx);
        }

        const constraintMatch = stmt.match(
            /ALTER\s+TABLE\s+.*?DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/i,
        );
        if (constraintMatch) {
            dropConstraints.push({ name: constraintMatch[1].toLowerCase(), idx });
        }
    });

    dropTableAt.forEach((dropIdx, tableName) => {
        for (const { name: constraintName, idx: constraintIdx } of dropConstraints) {
            // Match constraints whose name contains the dropped table name as a segment,
            // e.g. "_templates_" or ending "_templates_id_fk".
            const referencesDroppedTable =
                constraintName.includes(`_${tableName}_`) ||
                constraintName.endsWith(`_${tableName}_id_fk`) ||
                constraintName.endsWith(`_${tableName}s_id_fk`);

            if (referencesDroppedTable && constraintIdx > dropIdx) {
                errors.push(
                    `DROP TABLE "${tableName}" (statement ${dropIdx + 1}) appears BEFORE ` +
                    `ALTER TABLE ... DROP CONSTRAINT "${constraintName}" (statement ${constraintIdx + 1}). ` +
                    `Drop FK constraints first, then the table.`,
                );
            }
        }
    });

    return errors;
}

function extractTableName(stmt: string, pattern: RegExp): string | null {
    const match = stmt.match(pattern);
    return match ? match[1].toLowerCase() : null;
}

function validateMigrationFile(
    filePath: string,
    knownTables: Set<string>,
): ValidationResult {
    const fileName = path.basename(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const statements = splitStatements(content);

    const errors: string[] = [];
    const warnings: string[] = [];
    const tablesCreated: string[] = [];
    const tablesDropped: string[] = [];

    // --- Pass 1: collect tables created/dropped in this file ---
    const createdInFile = new Set<string>();
    for (const stmt of statements) {
        if (/^\s*--/.test(stmt)) continue;

        const created = extractTableName(
            stmt,
            /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?/i,
        );
        if (created) {
            createdInFile.add(created);
            tablesCreated.push(created);
        }

        const dropped = extractTableName(
            stmt,
            /DROP TABLE(?:\s+IF EXISTS)?\s+"?(\w+)"?/i,
        );
        if (dropped) {
            tablesDropped.push(dropped);
        }
    }

    // --- Pass 2: FK ordering check ---
    const fkErrors = checkFkDropOrder(fileName, statements);
    errors.push(...fkErrors);

    // --- Pass 3: ALTER TABLE on unknown tables ---
    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        if (/^\s*--/.test(stmt)) continue;

        if (/ALTER TABLE/i.test(stmt)) {
            const tableName = extractTableName(stmt, /ALTER TABLE\s+"?(\w+)"?/i);
            if (
                tableName &&
                !knownTables.has(tableName) &&
                !createdInFile.has(tableName)
            ) {
                errors.push(
                    `Statement ${i + 1}: ALTER TABLE "${tableName}" — table is unknown. ` +
                    `Add it to INITIAL_SCHEMA_TABLES or ensure it is CREATE'd earlier.`,
                );
            }
        }

        // Dangerous patterns
        if (/DROP TABLE(?!\s+IF\s+EXISTS)/i.test(stmt)) {
            warnings.push(`Statement ${i + 1}: DROP TABLE without IF EXISTS`);
        }
        if (/DROP COLUMN(?!\s+IF\s+EXISTS)/i.test(stmt)) {
            warnings.push(`Statement ${i + 1}: DROP COLUMN without IF EXISTS`);
        }
        if (/TRUNCATE TABLE/i.test(stmt)) {
            warnings.push(`Statement ${i + 1}: TRUNCATE TABLE is destructive`);
        }
        if (/DELETE FROM\s+\w+\s*;?\s*$/i.test(stmt)) {
            warnings.push(`Statement ${i + 1}: DELETE without WHERE clause`);
        }
    }

    return { file: fileName, errors, warnings, tablesCreated, tablesDropped };
}

function validateAllMigrations(): boolean {
    console.log('🔍 Validating migration files...\n');

    if (!fs.existsSync(MIGRATIONS_DIR)) {
        console.log('⚠️  No migrations directory found at', MIGRATIONS_DIR);
        return true;
    }

    const migrationFiles = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();

    if (migrationFiles.length === 0) {
        console.log('ℹ️  No migration files found');
        return true;
    }

    console.log(`📂 Found ${migrationFiles.length} migration file(s)\n`);

    const knownTables = new Set<string>(INITIAL_SCHEMA_TABLES);
    let hasErrors = false;
    let totalWarnings = 0;

    for (const file of migrationFiles) {
        const filePath = path.join(MIGRATIONS_DIR, file);
        const result = validateMigrationFile(filePath, knownTables);

        // Add tables created, remove tables dropped, for subsequent migrations
        for (const t of result.tablesCreated) knownTables.add(t);
        for (const t of result.tablesDropped) knownTables.delete(t);

        if (result.errors.length > 0 || result.warnings.length > 0) {
            console.log(`📄 ${result.file}`);

            for (const error of result.errors) {
                console.log(`   ❌ ERROR: ${error}`);
                hasErrors = true;
            }

            for (const warning of result.warnings) {
                console.log(`   ⚠️  WARNING: ${warning}`);
                totalWarnings++;
            }

            console.log('');
        }
    }

    if (hasErrors) {
        console.log('❌ Migration validation FAILED — fix errors before deploying\n');
        return false;
    }

    if (totalWarnings > 0) {
        console.log(`✅ Migration validation passed with ${totalWarnings} warning(s)\n`);
    } else {
        console.log('✅ All migrations validated successfully\n');
    }
    return true;
}

const isValid = validateAllMigrations();
process.exit(isValid ? 0 : 1);
