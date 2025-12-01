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

    // Check if drizzle migrations folder exists
    // In Docker: /app/backend/drizzle (from dist: ../drizzle)
    const migrationsFolder = path.resolve(__dirname, '../drizzle');
    
    if (!fs.existsSync(migrationsFolder)) {
        console.log('ℹ️  No drizzle migrations folder found at:', migrationsFolder);
        console.log('ℹ️  Skipping Drizzle migrations (using SQL migrations from docker-entrypoint-initdb.d)');
        console.log('✅ Migration step completed (no-op)');
        return;
    }

    // Check if folder has any migration files
    const files = fs.readdirSync(migrationsFolder);
    if (files.length === 0) {
        console.log('ℹ️  Drizzle migrations folder is empty');
        console.log('✅ Migration step completed (no-op)');
        return;
    }

    console.log('⏳ Connecting to database for migrations...');
    
    const migrationClient = postgres(connectionString, { max: 1 });
    const db = drizzle(migrationClient);

    try {
        console.log(`📂 Reading migrations from: ${migrationsFolder}`);
        console.log(`📄 Found ${files.length} files`);
        
        await migrate(db, { migrationsFolder });
        console.log('✅ Migrations completed successfully');
    } catch (error) {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    } finally {
        await migrationClient.end();
    }
};

runMigrations();
