/**
 * LLM-Based Configuration Analyzer
 *
 * Replaces 10+ fragile keyword-based detection systems with a single
 * LLM analysis pass using Claude to understand user intent, context, and preferences.
 *
 * This addresses P2 priority: Replace keyword detection with LLM-based detection
 * to eliminate fragility from synonym misses, context unawareness, arbitrary multipliers.
 */

import { completion, parseJsonResponse } from './openai.js';
import logger from '../utils/logger.js';
import { AUTHOR_STYLES } from './authorStyles.js';

/**
 * Analyze story premise using LLM instead of keyword matching
 * Returns structured analysis with reasoning for all configuration choices
 */
export async function analyzePremiseLLM(premiseText) {
  if (!premiseText || typeof premiseText !== 'string' || premiseText.trim().length < 3) {
    return null;
  }

  try {
    // Build author style catalog for LLM reference
    const authorCatalog = buildAuthorStyleCatalog();

    const prompt = `You are a story configuration analyzer. Analyze this story premise and extract structured configuration suggestions.

STORY PREMISE:
"${premiseText}"

Analyze the premise and return JSON with the following structure (be precise and provide reasoning):

{
  "genres": {
    "primary": "genre_name (horror|fantasy|scifi|mystery|romance|adventure|humor|fairytale|literary|poetry|ya)",
    "secondary": "optional_secondary_genre or null",
    "reasoning": "Why these genres fit the premise"
  },
  "intensity": {
    "violence": 0-100,
    "gore": 0-100,
    "scary": 0-100,
    "romance": 0-100,
    "adultContent": 0-100,
    "reasoning": "Justify each intensity level based on premise language and context"
  },
  "mood": "calm|exciting|scary|funny|mysterious|dramatic",
  "mood_reasoning": "Why this mood fits",
  "format": "cyoa|episodic|picture_book|short_story|novella|novel",
  "format_reasoning": "Why this format was chosen",
  "story_length": "short|medium|long",
  "audience": "children|young_adult|general|mature",
  "audience_reasoning": "Age appropriateness based on content",
  "character_count": {
    "estimated": number,
    "solo_duo_small_medium_large": "solo|duo|small|medium|large",
    "reasoning": "How many distinct characters are suggested"
  },
  "multi_narrator": true|false,
  "multi_narrator_reasoning": "Is this dialogue-heavy, ensemble cast, or single POV?",
  "sfx_enabled": true|false,
  "sfx_level": "low|medium|high",
  "sfx_reasoning": "Should sound effects be included and at what intensity?",
  "author_style": "author_style_key_from_catalog|null",
  "author_reasoning": "Which writing style best matches this premise",
  "bedtime_mode": true|false,
  "bedtime_reasoning": "Is this appropriate for pre-sleep stories?"
}

AUTHOR STYLE CATALOG (use this to select author_style):
${authorCatalog}

CRITICAL INSTRUCTIONS:
1. Understand INTENT: Don't just match keywords. If premise says "dark romance" understand user wants both darkness AND romance.
2. Context matters: "alien" could be sci-fi OR fantasy-adjacent, understand from context
3. Intensity: If premise is detailed about violent/sexual content, rate intensity high. If vague, rate lower.
4. Format detection: "choices" → CYOA, "episodes" → episodic, "for kids" → picture_book, explicit chapter count → novel/novella
5. Audience: "for kids" → children, "teen protagonist" → young_adult, "explicit content" → mature
6. Character count: Count distinct named characters, estimate if not explicit
7. Multi-narrator: True if "different voices", "ensemble cast", "dialogue heavy", "full cast recording"; False if "single narrator", "first person", "one perspective"
8. SFX: Enable if mentioned explicitly or implied by format (audio drama → high, quiet fairy tale → low/false)
9. Author matching: Look for author names, genre keywords that match author specialties, writing style descriptors
10. Never guess: If unclear, say "low" for any intensity, pick format that fits best, explain reasoning

Return ONLY valid JSON, no markdown, no explanations outside JSON.`;

    const response = await completion({
      model: 'gpt-5.2',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 1500
    });

    const analysis = parseJsonResponse(response);

    if (!analysis) {
      logger.warn('[ConfigAnalyzer] Failed to parse LLM response');
      return null;
    }

    logger.info('[ConfigAnalyzer] LLM analysis complete', {
      premise: premiseText.substring(0, 60),
      genres: analysis.genres,
      intensities: analysis.intensity,
      format: analysis.format,
      author: analysis.author_style
    });

    return analysis;
  } catch (error) {
    logger.error('[ConfigAnalyzer] LLM analysis failed:', error.message);
    return null;
  }
}

/**
 * Build author style catalog for LLM reference
 */
function buildAuthorStyleCatalog() {
  const entries = [];

  for (const [id, author] of Object.entries(AUTHOR_STYLES)) {
    const genres = Array.isArray(author?.genres) ? author.genres.join(', ') : '';
    const knownFor = Array.isArray(author?.knownFor) && author.knownFor.length
      ? `Known for: ${author.knownFor.join('; ')}`
      : '';
    const description = author?.description || '';

    const line = `- ${id}: ${author?.name || id}`;
    const details = [genres, knownFor, description].filter(Boolean).join(' | ');

    entries.push(details ? `${line} (${details})` : line);
  }

  return entries.join('\n');
}

/**
 * Convert LLM analysis to smartConfig format
 * Bridges gap between new LLM analysis and existing config generation logic
 */
export function convertLLMAnalysisToKeywordFormat(llmAnalysis) {
  if (!llmAnalysis) return null;

  return {
    genres: llmAnalysis.genres?.primary
      ? { [llmAnalysis.genres.primary]: 85, ...(llmAnalysis.genres.secondary ? { [llmAnalysis.genres.secondary]: 50 } : {}) }
      : {},
    intensity: {
      violence: llmAnalysis.intensity?.violence || 0,
      gore: llmAnalysis.intensity?.gore || 0,
      scary: llmAnalysis.intensity?.scary || 0,
      romance: llmAnalysis.intensity?.romance || 0,
      adultContent: llmAnalysis.intensity?.adultContent || 0
    },
    mood: llmAnalysis.mood || null,
    format: llmAnalysis.format || null,
    story_length: llmAnalysis.story_length || null,
    bedtime_mode: llmAnalysis.bedtime_mode || false,
    audience: llmAnalysis.audience || 'general',
    multi_narrator: llmAnalysis.multi_narrator || false,
    sfx_enabled: llmAnalysis.sfx_enabled || false,
    sfx_level: llmAnalysis.sfx_level || null,
    character_count: llmAnalysis.character_count ? {
      estimated: llmAnalysis.character_count.estimated || 3,
      category: llmAnalysis.character_count.solo_duo_small_medium_large || 'small'
    } : null,
    author_style: llmAnalysis.author_style || null,
    detectedKeywords: [
      llmAnalysis.genres?.primary,
      llmAnalysis.format,
      llmAnalysis.mood,
      llmAnalysis.audience
    ].filter(Boolean)
  };
}

/**
 * Generate reasoning explanation for user
 * Combines keyword and AI reasoning into readable summary
 */
export function generateReasoningFromLLM(llmAnalysis) {
  if (!llmAnalysis) return 'Unable to analyze premise';

  const lines = [];

  if (llmAnalysis.genres) {
    lines.push(`📚 **Genres**: ${llmAnalysis.genres.primary}${llmAnalysis.genres.secondary ? ` + ${llmAnalysis.genres.secondary}` : ''}`);
    lines.push(`   ${llmAnalysis.genres.reasoning}`);
  }

  if (llmAnalysis.intensity) {
    lines.push(`⚡ **Content Intensity**:`);
    lines.push(`   ${llmAnalysis.intensity.reasoning}`);
  }

  if (llmAnalysis.format) {
    lines.push(`📖 **Story Format**: ${llmAnalysis.format}`);
    lines.push(`   ${llmAnalysis.format_reasoning}`);
  }

  if (llmAnalysis.character_count) {
    lines.push(`👥 **Character Count**: ~${llmAnalysis.character_count.estimated} characters`);
    lines.push(`   ${llmAnalysis.character_count.reasoning}`);
  }

  if (llmAnalysis.multi_narrator !== undefined) {
    lines.push(`🎙️ **Narration**: ${llmAnalysis.multi_narrator ? 'Multiple voices' : 'Single narrator'}`);
    lines.push(`   ${llmAnalysis.multi_narrator_reasoning}`);
  }

  if (llmAnalysis.author_style) {
    lines.push(`✍️ **Writing Style**: ${llmAnalysis.author_style}`);
    lines.push(`   ${llmAnalysis.author_reasoning}`);
  }

  if (llmAnalysis.bedtime_mode) {
    lines.push(`😴 **Bedtime Appropriate**: Yes - ${llmAnalysis.bedtime_reasoning}`);
  }

  return lines.join('\n');
}

export default {
  analyzePremiseLLM,
  convertLLMAnalysisToKeywordFormat,
  generateReasoningFromLLM
};
