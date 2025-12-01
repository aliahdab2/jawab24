import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const runMigrations = async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not defined');
    }

    console.log('⏳ Connecting to database for migrations...');
    
    const migrationClient = postgres(connectionString, { max: 1 });
    const db = drizzle(migrationClient);

    try {
        // In production (dist), this script is in dist/migrate.js
        // We copy 'drizzle' folder to 'dist/drizzle' or root 'drizzle'
        // Let's assume we copy it to the app root and script runs from dist
        // So ../drizzle from dist/migrate.js is ./drizzle in root?
        // Actually, let's rely on the path we set in Dockerfile.
        // Ideally: /app/backend/drizzle
        
        const migrationsFolder = path.resolve(__dirname, '../../drizzle'); 
        // If running via ts-node: src/../drizzle -> backend/drizzle
        // If running via node dist/migrate.js: dist/../drizzle -> backend/drizzle (if copied there)
        
        // Let's be robust. In Docker we are in /app/backend.
        // Migrations are in /app/backend/drizzle
        // __dirname in dist is /app/backend/dist
        // so ../drizzle is /app/backend/drizzle.
        
        console.log(`📂 Reading migrations from: ${migrationsFolder}`);
        
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

