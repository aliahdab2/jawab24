#!/usr/bin/env ts-node
/**
 * Migration Validation Script
 * 
 * Checks SQL migration files for common issues before deployment:
 * 1. ALTER TABLE on tables that might not exist
 * 2. Missing IF NOT EXISTS clauses
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
}

const MIGRATIONS_DIR = path.resolve(__dirname, '../drizzle');

// Tables from the initial schema (before any migrations)
// These are created by drizzle-kit push or initial SQL setup
const INITIAL_SCHEMA_TABLES = [
    'users', 
    'pages', 
    'posts', 
    'comments', 
    'templates', 
    'rules', 
    'settings', 
    'ai_cache', 
    'logs',
    'messages',           // DMs table
    'instagram_media',    // Instagram posts
    'instagram_comments', // Instagram comments
    'plans',              // Pricing plans
    'subscriptions',      // User subscriptions
    'usage',              // Usage tracking
    'usage_logs',         // Usage audit logs
];

// Patterns that indicate potential issues
const DANGEROUS_PATTERNS = [
    { pattern: /DROP TABLE(?!\s+IF EXISTS)/gi, message: 'DROP TABLE without IF EXISTS' },
    { pattern: /DROP COLUMN(?!\s+IF EXISTS)/gi, message: 'DROP COLUMN without IF EXISTS' },
    { pattern: /TRUNCATE TABLE/gi, message: 'TRUNCATE TABLE is destructive' },
    { pattern: /DELETE FROM\s+\w+\s*;/gi, message: 'DELETE without WHERE clause' },
];

function extractTableFromAlter(line: string): string | null {
    const match = line.match(/ALTER TABLE\s+["']?(\w+)["']?/i);
    return match ? match[1].toLowerCase() : null;
}

function extractTableFromCreate(line: string): string | null {
    const match = line.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+["']?(\w+)["']?/i);
    return match ? match[1].toLowerCase() : null;
}

function validateMigrationFile(filePath: string, knownTables: Set<string>): ValidationResult {
    const fileName = path.basename(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    const errors: string[] = [];
    const warnings: string[] = [];
    const tablesCreated: string[] = [];
    
    // Track tables created in this migration (for within-file validation)
    const tablesCreatedInFile = new Set<string>();
    
    // First pass: find all CREATE TABLE statements in this file
    for (const line of lines) {
        if (line.trim().startsWith('--')) continue;
        
        const createdTable = extractTableFromCreate(line);
        if (createdTable) {
            tablesCreatedInFile.add(createdTable);
            tablesCreated.push(createdTable);
        }
    }
    
    // Second pass: validate ALTER TABLE statements
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;
        
        if (line.trim().startsWith('--')) continue;
        
        // Check for ALTER TABLE on unknown tables
        if (/ALTER TABLE/i.test(line)) {
            const tableName = extractTableFromAlter(line);
            if (tableName) {
                const isKnownTable = knownTables.has(tableName);
                const isCreatedInFile = tablesCreatedInFile.has(tableName);
                const isInitialTable = INITIAL_SCHEMA_TABLES.includes(tableName);
                
                if (!isKnownTable && !isCreatedInFile && !isInitialTable) {
                    errors.push(
                        `Line ${lineNum}: ALTER TABLE "${tableName}" - Table doesn't exist. ` +
                        `Either add it to INITIAL_SCHEMA_TABLES or CREATE TABLE IF NOT EXISTS first.`
                    );
                }
            }
        }
        
        // Check for dangerous patterns
        for (const { pattern, message } of DANGEROUS_PATTERNS) {
            // Reset regex lastIndex for global patterns
            pattern.lastIndex = 0;
            if (pattern.test(line)) {
                warnings.push(`Line ${lineNum}: ${message}`);
            }
        }
        
        // Check for CREATE TABLE without IF NOT EXISTS
        if (/CREATE TABLE\s+[^I]/i.test(line) && !/CREATE TABLE IF NOT EXISTS/i.test(line)) {
            warnings.push(`Line ${lineNum}: CREATE TABLE without IF NOT EXISTS - may fail if table exists`);
        }
        
        // Check for CREATE INDEX without IF NOT EXISTS  
        if (/CREATE INDEX\s+[^I]/i.test(line) && !/CREATE INDEX IF NOT EXISTS/i.test(line)) {
            warnings.push(`Line ${lineNum}: CREATE INDEX without IF NOT EXISTS - may fail if index exists`);
        }
    }
    
    return { file: fileName, errors, warnings, tablesCreated };
}

function validateAllMigrations(): boolean {
    console.log('🔍 Validating migration files...\n');
    
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        console.log('⚠️  No migrations directory found');
        return true;
    }
    
    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort(); // Ensures 0001, 0002, 0003 order
    
    if (migrationFiles.length === 0) {
        console.log('ℹ️  No migration files found');
        return true;
    }
    
    console.log(`📂 Found ${migrationFiles.length} migration file(s)\n`);
    
    // Track all known tables across migrations (cumulative)
    const knownTables = new Set<string>(INITIAL_SCHEMA_TABLES);
    
    let hasErrors = false;
    let totalWarnings = 0;
    
    // Process migrations IN ORDER
    for (const file of migrationFiles) {
        const filePath = path.join(MIGRATIONS_DIR, file);
        const result = validateMigrationFile(filePath, knownTables);
        
        // Add tables created in this migration to known tables for subsequent migrations
        for (const table of result.tablesCreated) {
            knownTables.add(table);
        }
        
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
            
            if (result.tablesCreated.length > 0) {
                console.log(`   📊 Tables created: ${result.tablesCreated.join(', ')}`);
            }
            
            console.log('');
        }
    }
    
    console.log(`📊 Total known tables: ${knownTables.size}`);
    console.log('');
    
    if (hasErrors) {
        console.log('❌ Migration validation FAILED - fix errors before deploying\n');
        return false;
    } else if (totalWarnings > 0) {
        console.log(`✅ Migration validation passed with ${totalWarnings} warning(s)\n`);
        return true;
    } else {
        console.log('✅ All migrations validated successfully\n');
        return true;
    }
}

// Run validation
const isValid = validateAllMigrations();
process.exit(isValid ? 0 : 1);

