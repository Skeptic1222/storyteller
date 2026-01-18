-- Migration 015: Event Ordering and Outline Linking
-- Adds chronological ordering to events and enables linking events to outline chapters

-- Add sort_order field to library_events for user-defined chronological ordering
ALTER TABLE library_events ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Add index for efficient ordering queries
CREATE INDEX IF NOT EXISTS idx_library_events_sort_order ON library_events(library_id, sort_order);

-- Update existing events to have sequential sort_order based on creation date
-- This ensures existing data has proper ordering
WITH ordered_events AS (
  SELECT id, library_id,
         ROW_NUMBER() OVER (PARTITION BY library_id ORDER BY created_at) as new_order
  FROM library_events
)
UPDATE library_events le
SET sort_order = oe.new_order
FROM ordered_events oe
WHERE le.id = oe.id;

-- Add linked_event_ids to chapter_beats for direct event linking
-- This allows each chapter to reference specific events from library_events
ALTER TABLE chapter_beats ADD COLUMN IF NOT EXISTS linked_event_ids UUID[] DEFAULT '{}';

-- Add a junction table for many-to-many relationship between outline chapters and events
-- This provides more flexibility than array storage
CREATE TABLE IF NOT EXISTS outline_chapter_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  synopsis_id UUID NOT NULL REFERENCES library_synopsis(id) ON DELETE CASCADE,
  chapter_number INTEGER NOT NULL,
  event_id UUID NOT NULL REFERENCES library_events(id) ON DELETE CASCADE,
  position_in_chapter INTEGER DEFAULT 0, -- Order within the chapter
  notes TEXT, -- Optional notes about how event appears in this chapter
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(synopsis_id, chapter_number, event_id)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_outline_chapter_events_synopsis ON outline_chapter_events(synopsis_id);
CREATE INDEX IF NOT EXISTS idx_outline_chapter_events_event ON outline_chapter_events(event_id);
CREATE INDEX IF NOT EXISTS idx_outline_chapter_events_chapter ON outline_chapter_events(synopsis_id, chapter_number);

-- Add a field to track which outline entry each event corresponds to (for Park Assault example)
-- This is the reverse lookup - from event to outline chapter
COMMENT ON COLUMN library_events.incorporated_in_chapter IS 'Chapter number where this event appears (1-indexed)';
COMMENT ON COLUMN library_events.is_incorporated IS 'Whether this event has been placed in the story outline';

-- Function to auto-update sort_order when inserting new events
CREATE OR REPLACE FUNCTION set_event_sort_order()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sort_order IS NULL OR NEW.sort_order = 0 THEN
    SELECT COALESCE(MAX(sort_order), 0) + 1 INTO NEW.sort_order
    FROM library_events
    WHERE library_id = NEW.library_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-setting sort_order
DROP TRIGGER IF EXISTS trigger_set_event_sort_order ON library_events;
CREATE TRIGGER trigger_set_event_sort_order
  BEFORE INSERT ON library_events
  FOR EACH ROW
  EXECUTE FUNCTION set_event_sort_order();
