-- Migration 033: Enforce unique choices per scene
-- Prevents duplicate CYOA options by key/index within a scene.

-- Deduplicate by (scene_id, choice_key): keep selected/latest row
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY scene_id, choice_key
      ORDER BY
        was_selected DESC,
        selected_at DESC NULLS LAST,
        created_at DESC,
        id DESC
    ) AS row_num
  FROM story_choices
  WHERE scene_id IS NOT NULL AND choice_key IS NOT NULL
)
DELETE FROM story_choices sc
USING ranked r
WHERE sc.id = r.id AND r.row_num > 1;

-- Deduplicate by (scene_id, choice_index): keep selected/latest row
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY scene_id, choice_index
      ORDER BY
        was_selected DESC,
        selected_at DESC NULLS LAST,
        created_at DESC,
        id DESC
    ) AS row_num
  FROM story_choices
  WHERE scene_id IS NOT NULL
)
DELETE FROM story_choices sc
USING ranked r
WHERE sc.id = r.id AND r.row_num > 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_story_choices_scene_choice_key'
  ) THEN
    ALTER TABLE story_choices
      ADD CONSTRAINT uq_story_choices_scene_choice_key
      UNIQUE (scene_id, choice_key);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_story_choices_scene_choice_index'
  ) THEN
    ALTER TABLE story_choices
      ADD CONSTRAINT uq_story_choices_scene_choice_index
      UNIQUE (scene_id, choice_index);
  END IF;
END $$;

