/**
 * Story Terminology Utility
 * Provides dynamic labels based on story format and type.
 *
 * - Novel/Novella: "Chapter 1", "Chapter 2" (familiar, expected)
 * - Short Story: "Part 1", "Part 2" (avoids chapter inflation)
 * - Picture Book: "Page 1", "Page 2" (natural for the format)
 * - CYOA: "Scene 1", "Scene 5" (acknowledges non-linear nature)
 */

/**
 * Get terminology labels for a story based on its format and type
 * @param {string} storyFormat - One of: 'picture_book', 'short_story', 'novella', 'novel', 'series'
 * @param {string} storyType - One of: 'linear', 'cyoa', 'campaign'
 * @returns {{ singular: string, plural: string, abbrev: string }}
 */
export function getStoryTerminology(storyFormat, storyType) {
  // CYOA always uses "Scene" regardless of format (non-linear nature)
  if (storyType === 'cyoa') {
    return { singular: 'Scene', plural: 'Scenes', abbrev: 'Sc' };
  }

  // Picture books use "Page"
  if (storyFormat === 'picture_book') {
    return { singular: 'Page', plural: 'Pages', abbrev: 'Pg' };
  }

  // Short stories use "Part" (avoids chapter inflation)
  if (storyFormat === 'short_story' || !storyFormat) {
    return { singular: 'Part', plural: 'Parts', abbrev: 'Pt' };
  }

  // Novella, Novel, Series use "Chapter" (reader expectation)
  return { singular: 'Chapter', plural: 'Chapters', abbrev: 'Ch' };
}

/**
 * Get the label for a specific unit number
 * @param {string} storyFormat
 * @param {string} storyType
 * @param {number} number - 1-based index
 * @param {boolean} abbreviated - Use short form (Ch 1 vs Chapter 1)
 * @returns {string}
 */
export function getUnitLabel(storyFormat, storyType, number, abbreviated = false) {
  const terms = getStoryTerminology(storyFormat, storyType);
  if (abbreviated) {
    return `${terms.abbrev} ${number}`;
  }
  return `${terms.singular} ${number}`;
}

/**
 * Get the "X of Y" progress label
 * @param {string} storyFormat
 * @param {string} storyType
 * @param {number} current - 1-based current index
 * @param {number} total - Total count (optional, shows "~" if estimated)
 * @param {boolean} estimated - Whether total is an estimate
 * @returns {string}
 */
export function getProgressLabel(storyFormat, storyType, current, total, estimated = false) {
  const terms = getStoryTerminology(storyFormat, storyType);
  if (total) {
    return `${terms.singular} ${current} of ${estimated ? '~' : ''}${total}`;
  }
  return `${terms.singular} ${current}`;
}

export default {
  getStoryTerminology,
  getUnitLabel,
  getProgressLabel
};
