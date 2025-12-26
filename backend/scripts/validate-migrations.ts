#!/usr/bin/env ts-node
/**
 * Migration Validation Script
 * 
 * Checks SQL migration files for common issues before deployment:
 * 1. ALTER TABLE on tables that might not exist
 * 2. Missing IF NOT EXISTS clauses
 * 3. Dangerous operations without safety checks
 */

import * as fs from 'fs';
import * as path from 'path';

interface ValidationResult {
    file: string;
    errors: string[];
    warnings: string[];
}

const MIGRATIONS_DIR = path.resolve(__dirname, '../drizzle');

// Tables that should exist before any migrations (from initial schema)
const CORE_TABLES = ['users', 'pages', 'posts', 'comments', 'templates', 'rules', 'settings', 'ai_cache', 'logs'];

// Patterns that indicate potential issues
const DANGEROUS_PATTERNS = [
    { pattern: /DROP TABLE(?!\s+IF EXISTS)/gi, message: 'DROP TABLE without IF EXISTS' },
    { pattern: /DROP COLUMN(?!\s+IF EXISTS)/gi, message: 'DROP COLUMN without IF EXISTS' },
    { pattern: /TRUNCATE TABLE/gi, message: 'TRUNCATE TABLE is destructive' },
    { pattern: /DELETE FROM \w+ WHERE 1=1/gi, message: 'Mass DELETE detected' },
];

function extractTableFromAlter(line: string): string | null {
    const match = line.match(/ALTER TABLE\s+["']?(\w+)["']?/i);
    return match ? match[1].toLowerCase() : null;
}

function extractTableFromCreate(line: string): string | null {
    const match = line.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+["']?(\w+)["']?/i);
    return match ? match[1].toLowerCase() : null;
}

function validateMigrationFile(filePath: string): ValidationResult {
    const fileName = path.basename(filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    
    const errors: string[] = [];
    const warnings: string[] = [];
    
    // Track tables created in this migration
    const tablesCreatedInMigration = new Set<string>();
    
    // First pass: find all CREATE TABLE statements
    for (const line of lines) {
        if (line.trim().startsWith('--')) continue; // Skip comments
        
        const createdTable = extractTableFromCreate(line);
        if (createdTable) {
            tablesCreatedInMigration.add(createdTable);
        }
    }
    
    // Second pass: validate ALTER TABLE statements
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;
        
        if (line.trim().startsWith('--')) continue; // Skip comments
        
        // Check for ALTER TABLE on non-core tables
        if (/ALTER TABLE/i.test(line)) {
            const tableName = extractTableFromAlter(line);
            if (tableName) {
                const isCoreTable = CORE_TABLES.includes(tableName);
                const isCreatedInMigration = tablesCreatedInMigration.has(tableName);
                
                if (!isCoreTable && !isCreatedInMigration) {
                    errors.push(
                        `Line ${lineNum}: ALTER TABLE "${tableName}" - Table is not a core table and not created in this migration. ` +
                        `Add CREATE TABLE IF NOT EXISTS before ALTER TABLE.`
                    );
                }
            }
        }
        
        // Check for dangerous patterns
        for (const { pattern, message } of DANGEROUS_PATTERNS) {
            if (pattern.test(line)) {
                warnings.push(`Line ${lineNum}: ${message}`);
            }
        }
        
        // Check for CREATE TABLE without IF NOT EXISTS
        if (/CREATE TABLE\s+(?!IF NOT EXISTS)/i.test(line) && !/CREATE TABLE IF NOT EXISTS/i.test(line)) {
            warnings.push(`Line ${lineNum}: CREATE TABLE without IF NOT EXISTS - may fail if table exists`);
        }
        
        // Check for CREATE INDEX without IF NOT EXISTS
        if (/CREATE INDEX\s+(?!IF NOT EXISTS)/i.test(line) && !/CREATE INDEX IF NOT EXISTS/i.test(line)) {
            warnings.push(`Line ${lineNum}: CREATE INDEX without IF NOT EXISTS - may fail if index exists`);
        }
    }
    
    return { file: fileName, errors, warnings };
}

function validateAllMigrations(): boolean {
    console.log('🔍 Validating migration files...\n');
    
    if (!fs.existsSync(MIGRATIONS_DIR)) {
        console.log('⚠️  No migrations directory found');
        return true;
    }
    
    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
        .filter(f => f.endsWith('.sql'))
        .sort();
    
    if (migrationFiles.length === 0) {
        console.log('ℹ️  No migration files found');
        return true;
    }
    
    let hasErrors = false;
    let totalWarnings = 0;
    
    for (const file of migrationFiles) {
        const filePath = path.join(MIGRATIONS_DIR, file);
        const result = validateMigrationFile(filePath);
        
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

