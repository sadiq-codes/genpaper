-- Migration: Fix citation_links table to allow nullable start_pos and end_pos
-- This addresses the issue where the AI model cannot always provide exact positions

-- Alter the citation_links table to make start_pos and end_pos nullable
ALTER TABLE citation_links 
ALTER COLUMN start_pos DROP NOT NULL,
ALTER COLUMN end_pos DROP NOT NULL; 