import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

const runMigrations = async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not defined');
    }

    // In Docker: /app/backend/drizzle
    // Locally: ./drizzle (relative to dist)
    const migrationsFolder = path.resolve(__dirname, '../drizzle');
    
    console.log('🔍 Looking for migrations at:', migrationsFolder);

    if (!fs.existsSync(migrationsFolder)) {
        console.log('⚠️  No drizzle migrations folder found');
        console.log('💡 To generate migrations, run: npm run db:generate');
        console.log('✅ Migration step completed (no migrations to run)');
        return;
    }

    // Check if folder has any SQL migration files
    const files = fs.readdirSync(migrationsFolder).filter(f => f.endsWith('.sql'));
    if (files.length === 0) {
        console.log('ℹ️  Drizzle migrations folder is empty');
        console.log('✅ Migration step completed (no migrations to run)');
        return;
    }

    console.log('⏳ Connecting to database for migrations...');
    console.log(`📂 Found ${files.length} migration file(s)`);
    
    const migrationClient = postgres(connectionString, { max: 1 });
    const db = drizzle(migrationClient);

    try {
        await migrate(db, { migrationsFolder });
        console.log('✅ All migrations applied successfully');
    } catch (error) {
        console.error('❌ Migration failed:', error);
        
        // Provide helpful error messages
        if (error instanceof Error) {
            if (error.message.includes('column') && error.message.includes('does not exist')) {
                console.error('');
                console.error('💡 TIP: This error usually means the database schema is out of sync.');
                console.error('   You may need to manually add the missing column or regenerate migrations.');
            }
            if (error.message.includes('relation') && error.message.includes('does not exist')) {
                console.error('');
                console.error('💡 TIP: This error usually means a table is missing.');
                console.error('   Check that the initial schema SQL has been applied.');
            }
        }
        
        process.exit(1);
    } finally {
        await migrationClient.end();
    }
};

runMigrations().catch((err) => {
    console.error('❌ Unexpected error during migration:', err);
    process.exit(1);
});
