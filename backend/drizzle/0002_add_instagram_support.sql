-- Migration: Add Instagram Support
-- Description: Adds Instagram Business Account integration to existing pages structure

-- 1. Add Instagram fields to pages table
ALTER TABLE pages ADD COLUMN IF NOT EXISTS instagram_account_id VARCHAR(255);
ALTER TABLE pages ADD COLUMN IF NOT EXISTS instagram_username VARCHAR(255);
ALTER TABLE pages ADD COLUMN IF NOT EXISTS instagram_auto_reply_enabled BOOLEAN DEFAULT true;

-- Create index for Instagram account lookup
CREATE INDEX IF NOT EXISTS idx_pages_instagram_account_id ON pages(instagram_account_id);

-- 2. Create Instagram Media table (equivalent to Facebook posts)
CREATE TABLE IF NOT EXISTS instagram_media (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id UUID REFERENCES pages(id) ON DELETE CASCADE,
    instagram_media_id VARCHAR(255) UNIQUE NOT NULL,
    media_type VARCHAR(50), -- 'IMAGE', 'VIDEO', 'CAROUSEL_ALBUM', 'REELS'
    caption TEXT,
    permalink TEXT,
    thumbnail_url TEXT,
    auto_reply_enabled BOOLEAN DEFAULT true,
    created_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for Instagram media
CREATE INDEX IF NOT EXISTS idx_instagram_media_page_id ON instagram_media(page_id);
CREATE INDEX IF NOT EXISTS idx_instagram_media_id ON instagram_media(instagram_media_id);

-- 3. Create Instagram Comments table
CREATE TABLE IF NOT EXISTS instagram_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    media_id UUID REFERENCES instagram_media(id) ON DELETE CASCADE,
    instagram_comment_id VARCHAR(255) UNIQUE NOT NULL,
    message TEXT NOT NULL,
    from_id VARCHAR(255),
    from_username VARCHAR(255),
    replied BOOLEAN DEFAULT false,
    reply_text TEXT,
    reply_method VARCHAR(50), -- 'template', 'ai', 'manual'
    detected_language VARCHAR(10),
    reply_language VARCHAR(10),
    created_time TIMESTAMP,
    replied_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for Instagram comments
CREATE INDEX IF NOT EXISTS idx_instagram_comments_media_id ON instagram_comments(media_id);
CREATE INDEX IF NOT EXISTS idx_instagram_comments_id ON instagram_comments(instagram_comment_id);
CREATE INDEX IF NOT EXISTS idx_instagram_comments_replied ON instagram_comments(replied);

-- 4. Add Instagram DMs support to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS platform VARCHAR(20) DEFAULT 'facebook';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS instagram_message_id VARCHAR(255);

-- Create index for platform filtering
CREATE INDEX IF NOT EXISTS idx_messages_platform ON messages(platform);

