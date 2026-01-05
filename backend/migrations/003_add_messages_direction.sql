-- Add direction column to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS direction VARCHAR(10) DEFAULT 'incoming';

-- Create index on direction for better query performance
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction);

-- Update existing records to have 'incoming' direction (default behavior)
UPDATE messages SET direction = 'incoming' WHERE direction IS NULL;
