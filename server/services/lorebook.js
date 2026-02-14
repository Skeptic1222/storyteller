/**
 * Lorebook Service
 * Dynamic context injection based on keyword triggers (inspired by NovelAI)
 * From research insights: structured knowledge base that auto-triggers on keywords
 */

import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';

export class LorebookService {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.entries = [];
    this.keywordIndex = new Map(); // keyword -> entry IDs for fast lookup
  }

  /**
   * Load lorebook entries and build keyword index
   */
  async loadEntries() {
    // DB LIMIT PROTECTION: Limit lore entries to 200 max
    // Explicit columns for performance
    const result = await pool.query(`
      SELECT id, story_session_id, entry_type, title, content, tags, importance,
             parent_location_id, created_at
      FROM lore_entries
      WHERE story_session_id = $1
      ORDER BY importance DESC
      LIMIT 200
    `, [this.sessionId]);

    this.entries = result.rows;
    this.buildKeywordIndex();

    logger.info(`Lorebook loaded: ${this.entries.length} entries for session ${this.sessionId}`);
    return this.entries;
  }

  /**
   * Build keyword index for fast lookup
   */
  buildKeywordIndex() {
    this.keywordIndex.clear();

    for (const entry of this.entries) {
      // Extract keywords from entry
      const keywords = this.extractKeywords(entry);

      for (const keyword of keywords) {
        const normalized = keyword.toLowerCase();
        if (!this.keywordIndex.has(normalized)) {
          this.keywordIndex.set(normalized, []);
        }
        this.keywordIndex.get(normalized).push(entry.id);
      }
    }
  }

  /**
   * Extract keywords from a lore entry
   */
  extractKeywords(entry) {
    const keywords = [];

    // Title words (high priority)
    if (entry.title) {
      keywords.push(...entry.title.split(/\s+/).filter(w => w.length > 2));
    }

    // Explicit tags if available
    if (entry.tags && Array.isArray(entry.tags)) {
      keywords.push(...entry.tags);
    }

    // Extract key terms from content (names, places, etc.)
    if (entry.content) {
      // Find capitalized words (likely proper nouns)
      const properNouns = entry.content.match(/\b[A-Z][a-z]{2,}\b/g) || [];
      keywords.push(...properNouns);
    }

    return [...new Set(keywords)]; // Deduplicate
  }

  /**
   * Find triggered entries based on text content
   * Returns entries that should be injected into context
   */
  findTriggeredEntries(text, maxEntries = 5) {
    if (!this.entries.length) return [];

    const triggered = new Map(); // entry ID -> match score
    const words = text.toLowerCase().split(/\s+/);

    // Check each word against keyword index
    for (const word of words) {
      // Exact match
      if (this.keywordIndex.has(word)) {
        for (const entryId of this.keywordIndex.get(word)) {
          triggered.set(entryId, (triggered.get(entryId) || 0) + 2);
        }
      }

      // Partial match (for longer keywords)
      for (const [keyword, entryIds] of this.keywordIndex) {
        if (keyword.length > 4 && (word.includes(keyword) || keyword.includes(word))) {
          for (const entryId of entryIds) {
            triggered.set(entryId, (triggered.get(entryId) || 0) + 1);
          }
        }
      }
    }

    // Sort by score and importance, return top entries
    const sortedEntries = [...triggered.entries()]
      .map(([id, score]) => {
        const entry = this.entries.find(e => e.id === id);
        return { entry, score: score + (entry?.importance || 0) / 10 };
      })
      .filter(e => e.entry)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxEntries)
      .map(e => e.entry);

    return sortedEntries;
  }

  /**
   * Generate context injection from triggered entries
   */
  generateContextInjection(triggeredEntries) {
    if (!triggeredEntries.length) return '';

    const sections = triggeredEntries.map(entry => {
      return `[${entry.entry_type?.toUpperCase() || 'LORE'}] ${entry.title}:\n${entry.content}`;
    });

    return `\n--- RELEVANT LORE ---\n${sections.join('\n\n')}\n--- END LORE ---\n`;
  }

  /**
   * Add a new lorebook entry
   */
  async addEntry(entry) {
    const { title, content, entryType = 'general', importance = 50, tags = [] } = entry;

    const result = await pool.query(`
      INSERT INTO lore_entries (story_session_id, entry_type, title, content, importance, tags)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [this.sessionId, entryType, title, content, importance, tags]);

    const newEntry = result.rows[0];
    this.entries.push(newEntry);
    this.buildKeywordIndex();

    logger.info(`Lorebook entry added: ${title}`);
    return newEntry;
  }

  /**
   * Update an existing entry
   */
  async updateEntry(entryId, updates) {
    const setClause = [];
    const values = [];
    let paramIndex = 1;

    if (updates.title !== undefined) {
      setClause.push(`title = $${paramIndex++}`);
      values.push(updates.title);
    }
    if (updates.content !== undefined) {
      setClause.push(`content = $${paramIndex++}`);
      values.push(updates.content);
    }
    if (updates.importance !== undefined) {
      setClause.push(`importance = $${paramIndex++}`);
      values.push(updates.importance);
    }
    if (updates.tags !== undefined) {
      setClause.push(`tags = $${paramIndex++}`);
      values.push(updates.tags);
    }

    if (setClause.length === 0) return null;

    values.push(entryId);
    const result = await pool.query(`
      UPDATE lore_entries
      SET ${setClause.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `, values);

    if (result.rows.length > 0) {
      const updated = result.rows[0];
      const index = this.entries.findIndex(e => e.id === entryId);
      if (index >= 0) {
        this.entries[index] = updated;
        this.buildKeywordIndex();
      }
      return updated;
    }

    return null;
  }

  /**
   * Remove an entry
   */
  async removeEntry(entryId) {
    await pool.query('DELETE FROM lore_entries WHERE id = $1', [entryId]);
    this.entries = this.entries.filter(e => e.id !== entryId);
    this.buildKeywordIndex();
    logger.info(`Lorebook entry removed: ${entryId}`);
  }

  /**
   * Get all entries of a specific type
   */
  getEntriesByType(entryType) {
    return this.entries.filter(e => e.entry_type === entryType);
  }

  /**
   * Auto-generate lore entries from story content
   */
  async generateEntriesFromText(text, context = {}) {
    // This would use GPT to extract lore from scene text
    // Placeholder for now - could be implemented similar to extractStoryFacts
    logger.info('Auto-generating lorebook entries from text');
    return [];
  }

  /**
   * Search entries by content
   */
  searchEntries(query) {
    const lowered = query.toLowerCase();
    return this.entries.filter(e =>
      e.title?.toLowerCase().includes(lowered) ||
      e.content?.toLowerCase().includes(lowered) ||
      (e.tags && e.tags.some(t => t.toLowerCase().includes(lowered)))
    );
  }

  /**
   * Export lorebook as JSON (for backup/sharing)
   */
  export() {
    return {
      session_id: this.sessionId,
      entries: this.entries.map(e => ({
        title: e.title,
        content: e.content,
        entry_type: e.entry_type,
        importance: e.importance,
        tags: e.tags
      })),
      exported_at: new Date().toISOString()
    };
  }

  /**
   * Import lorebook from JSON
   */
  async import(data) {
    if (!data.entries || !Array.isArray(data.entries)) {
      throw new Error('Invalid lorebook data');
    }

    const imported = [];
    for (const entry of data.entries) {
      const newEntry = await this.addEntry({
        title: entry.title,
        content: entry.content,
        entryType: entry.entry_type || 'imported',
        importance: entry.importance || 50,
        tags: entry.tags || []
      });
      imported.push(newEntry);
    }

    logger.info(`Imported ${imported.length} lorebook entries`);
    return imported;
  }
}

export default LorebookService;
