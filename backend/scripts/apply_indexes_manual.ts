import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const run = async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
        throw new Error('DATABASE_URL is not defined');
    }

    const client = postgres(connectionString);
    
    try {
        console.log('🚀 Applying indexes manually...');
        
        // Comments
        console.log('Adidng indexes to comments...');
        await client`CREATE INDEX IF NOT EXISTS "idx_comments_created_at" ON "comments" ("created_at")`;
        await client`CREATE INDEX IF NOT EXISTS "idx_comments_created_time" ON "comments" ("created_time")`;
        
        // Instagram Comments
        console.log('Adding indexes to instagram_comments...');
        await client`CREATE INDEX IF NOT EXISTS "idx_instagram_comments_created_at" ON "instagram_comments" ("created_at")`;
        await client`CREATE INDEX IF NOT EXISTS "idx_instagram_comments_created_time" ON "instagram_comments" ("created_time")`;
        
        // Messages
        console.log('Adding indexes to messages...');
        await client`CREATE INDEX IF NOT EXISTS "idx_messages_replied" ON "messages" ("replied")`;
        await client`CREATE INDEX IF NOT EXISTS "idx_messages_created_at" ON "messages" ("created_at")`;
        await client`CREATE INDEX IF NOT EXISTS "idx_messages_created_time" ON "messages" ("created_time")`;

        console.log('✅ All indexes applied successfully!');
    } catch (err) {
        console.error('❌ Failed to apply indexes:', err);
    } finally {
        await client.end();
    }
};

run();
