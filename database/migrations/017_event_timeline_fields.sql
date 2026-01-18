-- Migration 017: Add timeline fields to library_events for chronological ordering
-- This fixes the systemic bug where events were sorted by insertion order instead of story timeline

-- Add timeline extraction fields
ALTER TABLE library_events ADD COLUMN IF NOT EXISTS event_year INTEGER;
ALTER TABLE library_events ADD COLUMN IF NOT EXISTS event_date DATE;
ALTER TABLE library_events ADD COLUMN IF NOT EXISTS chronological_position VARCHAR(50);
ALTER TABLE library_events ADD COLUMN IF NOT EXISTS explicit_sequence INTEGER;

-- Create index for efficient timeline queries
CREATE INDEX IF NOT EXISTS idx_library_events_timeline
ON library_events (library_id, event_year, explicit_sequence, sort_order);

-- Update the sort_order trigger to respect timeline data
-- The application code now calculates sort_order based on event_year and explicit_sequence
-- This trigger serves as a fallback for events without timeline data
CREATE OR REPLACE FUNCTION set_library_event_sort_order()
RETURNS TRIGGER AS $$
BEGIN
    -- Only set sort_order if not already provided and no timeline data
    IF NEW.sort_order IS NULL AND NEW.event_year IS NULL AND NEW.explicit_sequence IS NULL THEN
        SELECT COALESCE(MAX(sort_order), -1) + 1 INTO NEW.sort_order
        FROM library_events
        WHERE library_id = NEW.library_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop and recreate trigger to ensure it uses updated function
DROP TRIGGER IF EXISTS trg_set_library_event_sort_order ON library_events;
CREATE TRIGGER trg_set_library_event_sort_order
    BEFORE INSERT ON library_events
    FOR EACH ROW
    EXECUTE FUNCTION set_library_event_sort_order();

-- Add comment explaining the timeline ordering system
COMMENT ON COLUMN library_events.event_year IS 'Year when event occurs in story timeline (e.g., 2028). Used for chronological sorting.';
COMMENT ON COLUMN library_events.event_date IS 'Specific date if mentioned (e.g., 2028-10-14). More precise than event_year.';
COMMENT ON COLUMN library_events.chronological_position IS 'Relative position: first, second, before_X, after_X, etc.';
COMMENT ON COLUMN library_events.explicit_sequence IS 'Explicit numbering from source (e.g., Chapter 3 = 3, Event #5 = 5).';
