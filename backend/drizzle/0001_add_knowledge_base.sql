-- Migration: Add knowledge_base column to pages table
-- Created: 2025-12-19
-- Description: Adds knowledge_base text field for AI context

ALTER TABLE pages ADD COLUMN IF NOT EXISTS knowledge_base TEXT;





