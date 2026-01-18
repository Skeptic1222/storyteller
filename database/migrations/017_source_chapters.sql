-- Migration 017: Source Chapters Column
-- Stores the explicit chapter structure extracted from source documents
-- Used during outline generation to preserve original document structure

-- Add source_chapters column to library_synopsis
ALTER TABLE library_synopsis
ADD COLUMN IF NOT EXISTS source_chapters JSONB DEFAULT NULL;

-- Add comment explaining the column
COMMENT ON COLUMN library_synopsis.source_chapters IS 'JSON structure containing explicit chapter/section structure extracted from source document. Used to preserve original document organization during outline generation.';

-- Example structure:
-- {
--   "has_explicit_structure": true,
--   "structure_type": "chapters",
--   "chapters": [
--     {
--       "number": 1,
--       "title": "Chapter Title",
--       "subtitle": "Optional subtitle",
--       "summary": "Chapter summary from source",
--       "source_line": "Original header text"
--     }
--   ],
--   "total_chapters": 15,
--   "notes": "Any observations"
-- }
