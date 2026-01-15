/**
 * Story Templates API Routes
 */

import express from 'express';
import {
  getAllTemplates,
  getTemplatesByCategory,
  getBedtimeTemplates,
  getTemplateById,
  getTemplatesByAudience,
  getTemplatesWithinIntensity,
  getRandomTemplate,
  searchTemplatesByTags,
  TEMPLATE_CATEGORIES
} from '../data/storyTemplates.js';
import { logger } from '../utils/logger.js';
import { wrapRoutes, NotFoundError } from '../middleware/errorHandler.js';

const router = express.Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching

/**
 * GET /api/templates
 * Get all templates or filter by query params
 */
router.get('/', (req, res) => {
  try {
    const { category, audience, bedtime, tags } = req.query;

    let templates;

    if (bedtime === 'true') {
      templates = getBedtimeTemplates();
    } else if (category) {
      templates = getTemplatesByCategory(category);
    } else if (audience) {
      templates = getTemplatesByAudience(audience);
    } else if (tags) {
      templates = searchTemplatesByTags(tags.split(','));
    } else {
      templates = getAllTemplates();
    }

    res.json({
      success: true,
      count: templates.length,
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        audience: t.audience,
        ageRange: t.ageRange,
        estimatedMinutes: t.estimatedMinutes,
        tags: t.tags,
        thumbnail: t.thumbnail,
        bedtimeMode: t.config.bedtimeMode,
        cyoaEnabled: t.config.cyoaEnabled
      }))
    });
  } catch (error) {
    logger.error('Error fetching templates:', error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

/**
 * GET /api/templates/categories
 * Get all template categories
 */
router.get('/categories', (req, res) => {
  try {
    res.json({
      success: true,
      categories: TEMPLATE_CATEGORIES
    });
  } catch (error) {
    logger.error('Error fetching categories:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * GET /api/templates/random
 * Get a random template, optionally from a category
 */
router.get('/random', (req, res) => {
  try {
    const { category } = req.query;
    const template = getRandomTemplate(category || null);

    if (!template) {
      return res.status(404).json({ error: 'No templates found' });
    }

    res.json({
      success: true,
      template
    });
  } catch (error) {
    logger.error('Error fetching random template:', error);
    res.status(500).json({ error: 'Failed to fetch random template' });
  }
});

/**
 * GET /api/templates/safe
 * Get templates within safe content limits
 */
router.get('/safe', (req, res) => {
  try {
    const {
      maxViolence = 0.3,
      maxHorror = 0.3,
      maxRomance = 0.3
    } = req.query;

    const templates = getTemplatesWithinIntensity(
      parseFloat(maxViolence),
      parseFloat(maxHorror),
      parseFloat(maxRomance)
    );

    res.json({
      success: true,
      count: templates.length,
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        category: t.category,
        audience: t.audience,
        ageRange: t.ageRange,
        estimatedMinutes: t.estimatedMinutes,
        tags: t.tags,
        bedtimeMode: t.config.bedtimeMode
      }))
    });
  } catch (error) {
    logger.error('Error fetching safe templates:', error);
    res.status(500).json({ error: 'Failed to fetch safe templates' });
  }
});

/**
 * GET /api/templates/:id
 * Get a specific template by ID
 */
router.get('/:id', (req, res) => {
  try {
    const template = getTemplateById(req.params.id);

    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }

    res.json({
      success: true,
      template
    });
  } catch (error) {
    logger.error('Error fetching template:', error);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

export default router;
