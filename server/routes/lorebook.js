/**
 * Lorebook Routes
 * API for managing story lore entries with keyword triggers
 */

import { Router } from 'express';
import { LorebookService } from '../services/lorebook.js';
import { logger } from '../utils/logger.js';
import { wrapRoutes, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

const router = Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching

/**
 * GET /api/lorebook/:sessionId
 * Get all lorebook entries for a session
 */
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const lorebook = new LorebookService(sessionId);
    const entries = await lorebook.loadEntries();

    res.json({
      session_id: sessionId,
      entries,
      total: entries.length
    });
  } catch (error) {
    logger.error('Error getting lorebook:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/lorebook/:sessionId/entries
 * Add a new lorebook entry
 */
router.post('/:sessionId/entries', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { title, content, entry_type, importance, tags } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'title and content are required' });
    }

    const lorebook = new LorebookService(sessionId);
    await lorebook.loadEntries();

    const entry = await lorebook.addEntry({
      title,
      content,
      entryType: entry_type || 'general',
      importance: importance || 50,
      tags: tags || []
    });

    res.status(201).json({
      message: 'Lorebook entry created',
      entry
    });
  } catch (error) {
    logger.error('Error creating lorebook entry:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PUT /api/lorebook/:sessionId/entries/:entryId
 * Update a lorebook entry
 */
router.put('/:sessionId/entries/:entryId', async (req, res) => {
  try {
    const { sessionId, entryId } = req.params;
    const updates = req.body;

    const lorebook = new LorebookService(sessionId);
    await lorebook.loadEntries();

    const entry = await lorebook.updateEntry(parseInt(entryId), updates);

    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    res.json({
      message: 'Lorebook entry updated',
      entry
    });
  } catch (error) {
    logger.error('Error updating lorebook entry:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/lorebook/:sessionId/entries/:entryId
 * Delete a lorebook entry
 */
router.delete('/:sessionId/entries/:entryId', async (req, res) => {
  try {
    const { sessionId, entryId } = req.params;

    const lorebook = new LorebookService(sessionId);
    await lorebook.loadEntries();
    await lorebook.removeEntry(parseInt(entryId));

    res.json({ message: 'Lorebook entry deleted' });
  } catch (error) {
    logger.error('Error deleting lorebook entry:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/lorebook/:sessionId/search
 * Search lorebook entries
 */
router.post('/:sessionId/search', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'query is required' });
    }

    const lorebook = new LorebookService(sessionId);
    await lorebook.loadEntries();
    const results = lorebook.searchEntries(query);

    res.json({
      query,
      results,
      total: results.length
    });
  } catch (error) {
    logger.error('Error searching lorebook:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/lorebook/:sessionId/test-triggers
 * Test which entries would be triggered by given text
 */
router.post('/:sessionId/test-triggers', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const lorebook = new LorebookService(sessionId);
    await lorebook.loadEntries();

    const triggered = lorebook.findTriggeredEntries(text);
    const injection = lorebook.generateContextInjection(triggered);

    res.json({
      triggered_entries: triggered.map(e => ({
        id: e.id,
        title: e.title,
        entry_type: e.entry_type
      })),
      context_injection: injection,
      total_triggered: triggered.length
    });
  } catch (error) {
    logger.error('Error testing triggers:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/lorebook/:sessionId/export
 * Export lorebook as JSON
 */
router.get('/:sessionId/export', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const lorebook = new LorebookService(sessionId);
    await lorebook.loadEntries();
    const exported = lorebook.export();

    res.json(exported);
  } catch (error) {
    logger.error('Error exporting lorebook:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/lorebook/:sessionId/import
 * Import lorebook from JSON
 */
router.post('/:sessionId/import', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const data = req.body;

    const lorebook = new LorebookService(sessionId);
    await lorebook.loadEntries();
    const imported = await lorebook.import(data);

    res.json({
      message: `Imported ${imported.length} entries`,
      entries: imported
    });
  } catch (error) {
    logger.error('Error importing lorebook:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/lorebook/:sessionId/by-type/:type
 * Get entries by type
 */
router.get('/:sessionId/by-type/:type', async (req, res) => {
  try {
    const { sessionId, type } = req.params;

    const lorebook = new LorebookService(sessionId);
    await lorebook.loadEntries();
    const entries = lorebook.getEntriesByType(type);

    res.json({
      entry_type: type,
      entries,
      total: entries.length
    });
  } catch (error) {
    logger.error('Error getting entries by type:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
