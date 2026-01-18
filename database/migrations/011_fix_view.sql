-- Fix the location_hierarchy view type mismatch
CREATE OR REPLACE VIEW location_hierarchy AS
WITH RECURSIVE location_tree AS (
    SELECT
        id, library_id, world_id, parent_location_id, name, location_type,
        description, 0 as depth, ARRAY[name::varchar] as path
    FROM library_locations
    WHERE parent_location_id IS NULL
    UNION ALL
    SELECT
        l.id, l.library_id, l.world_id, l.parent_location_id, l.name, l.location_type,
        l.description, lt.depth + 1, lt.path || l.name::varchar
    FROM library_locations l
    JOIN location_tree lt ON l.parent_location_id = lt.id
)
SELECT * FROM location_tree;
