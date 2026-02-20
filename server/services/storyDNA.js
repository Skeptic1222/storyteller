/**
 * Story DNA Service
 * Generates a holistic "Tonal Blueprint" from ALL configuration sliders + premise.
 *
 * Instead of dumping raw JSON like { humor: 70, horror: 50 } to the LLM,
 * this service interprets what that combination MEANS artistically —
 * producing rich guidance like "Shaun of the Dead dark comedy."
 *
 * Runs ONCE at config time (before outline generation), stored in config_json.story_dna.
 * Cost: ~$0.02/story (single GPT-5.2 call).
 */

import { callAgent } from './openai.js';
import { parseJsonResponse } from '../utils/jsonUtils.js';
import { logger } from '../utils/logger.js';
import { getCreativeModel } from './modelSelection.js';

/**
 * Generate Story DNA from configuration preferences
 * @param {object} preferences - Full outline preferences (from buildOutlinePreferences)
 * @param {string} sessionId - Story session ID for usage tracking
 * @returns {object} Story DNA document
 */
export async function generateStoryDNA(preferences, sessionId) {
  const startTime = Date.now();
  logger.info(`[StoryDNA] Generating tonal blueprint for session ${sessionId}`);

  const genres = preferences.genres || {};
  const intensity = preferences.intensity || {};
  const premise = preferences.story_request || preferences.custom_prompt || '';
  const audience = preferences.audience || 'general';
  const authorStyle = preferences.author_style || null;
  const targetLength = preferences.target_length || 'medium';
  const storyFormat = preferences.story_format || 'short_story';
  const tone = preferences.tone || 'calm';

  // Build a readable genre summary
  const activeGenres = Object.entries(genres)
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)
    .map(([genre, level]) => `${genre}: ${level}%`)
    .join(', ');

  // Build intensity summary
  const activeIntensity = Object.entries(intensity)
    .filter(([, v]) => v > 0)
    .map(([type, level]) => `${type}: ${level}%`)
    .join(', ');

  // Calculate target scene count for energy curve
  const sceneCounts = { short: 3, medium: 5, long: 8 };
  const targetScenes = sceneCounts[targetLength] || 5;

  const prompt = `You are a story development consultant. Analyze these creative settings and produce a TONAL BLUEPRINT — a unified artistic vision for a story.

CONFIGURATION:
- Genres: ${activeGenres || 'fantasy: 70, adventure: 50 (defaults)'}
- Mood/Tone: ${tone}
- Intensity settings: ${activeIntensity || 'all defaults (0)'}
- Audience: ${audience}
- Story format: ${storyFormat}
- Target length: ${targetLength} (~${targetScenes} scenes)
${premise ? `- User's premise: "${premise}"` : '- No specific premise (open-ended)'}
${authorStyle ? `- Author style: ${authorStyle}` : ''}

YOUR TASK:
Don't just restate the numbers. INTERPRET them. What does "humor: 70 + horror: 50" FEEL like?
That's dark comedy — Shaun of the Dead, not a scary movie with occasional jokes.
What does "romance: 80 + scifi: 60" feel like? A love story set against a vast cosmos.

Return JSON:
{
  "tonal_blueprint": "2-3 paragraphs describing the story's tonal identity. What genre fusion is this? What's the emotional texture? How do the genres interact — does humor undercut horror, or does horror make humor more cathartic? What's the reader supposed to FEEL?",
  "genre_fusion": "One sentence describing how the genres blend (with a pop culture reference if helpful). e.g., 'The blackly comic nihilism of Fargo meets cosmic horror — ordinary people confronting the incomprehensible, coping through gallows humor.'",
  "intensity_philosophy": "How should violence/romance/mature content FEEL in this specific blend? Not just 'include violence' but 'violence should be sudden and shocking, punctuating long stretches of uneasy calm — never gratuitous, always meaningful.'",
  "pacing_rhythm": "Describe the energy flow. Is this a slow burn to explosion? Relentless from page one? Oscillating between tension and relief?",
  "emotional_palette": ["3-6 specific emotional tones that define this story, e.g., 'gallows humor', 'creeping dread', 'manic energy', 'bittersweet nostalgia'"],
  "forbidden_tones": ["2-4 tones that would BREAK this story's identity, e.g., 'earnest sentimentality' in a noir, 'slapstick' in psychological horror"],
  "scene_energy_curve": [${Array(targetScenes).fill('0.0-1.0').join(', ')}],
  "content_guardrails": "What 'too far' means for this specific blend. Where's the line between effective and gratuitous? What would break immersion for THIS audience?"
}

scene_energy_curve should have exactly ${targetScenes} values (one per scene), each 0.0-1.0, representing the energy/intensity level. Build a satisfying dramatic arc — typically starting moderate, building through rising action, peaking at the climax, then resolving.

Be SPECIFIC and VIVID. Generic advice like "balance humor and tension" is useless. Say HOW to balance them.`;

  try {
    const result = await callAgent('planner', prompt, {
      sessionId,
      response_format: { type: 'json_object' },
      maxTokens: 2000
    });

    const dna = parseJsonResponse(result.content);

    // Validate required fields
    const requiredFields = ['tonal_blueprint', 'genre_fusion', 'emotional_palette', 'scene_energy_curve'];
    for (const field of requiredFields) {
      if (!dna[field]) {
        logger.warn(`[StoryDNA] Missing field: ${field}, generating fallback`);
        dna[field] = field === 'scene_energy_curve'
          ? generateDefaultEnergyCurve(targetScenes)
          : field === 'emotional_palette'
            ? ['engaging', 'dramatic']
            : `Default ${field} — see genre settings`;
      }
    }

    // Ensure energy curve has correct length
    if (!Array.isArray(dna.scene_energy_curve) || dna.scene_energy_curve.length !== targetScenes) {
      logger.warn(`[StoryDNA] Energy curve length mismatch (got ${dna.scene_energy_curve?.length}, need ${targetScenes}), regenerating`);
      dna.scene_energy_curve = generateDefaultEnergyCurve(targetScenes);
    }

    // Ensure energy values are numbers 0-1
    dna.scene_energy_curve = dna.scene_energy_curve.map(v => {
      const num = parseFloat(v);
      return isNaN(num) ? 0.5 : Math.max(0, Math.min(1, num));
    });

    const elapsed = Date.now() - startTime;
    logger.info(`[StoryDNA] Blueprint generated in ${elapsed}ms for session ${sessionId}`);
    logger.info(`[StoryDNA] Genre fusion: "${dna.genre_fusion}"`);
    logger.info(`[StoryDNA] Energy curve: [${dna.scene_energy_curve.join(', ')}]`);
    logger.info(`[StoryDNA] Emotional palette: ${dna.emotional_palette?.join(', ')}`);

    return dna;
  } catch (error) {
    logger.error(`[StoryDNA] Generation failed: ${error.message}`);
    // Return a minimal fallback so story generation isn't blocked
    return generateFallbackDNA(preferences, targetScenes);
  }
}

/**
 * Format Story DNA for injection into the outline prompt
 * @param {object} dna - Story DNA object
 * @returns {string} Formatted prompt section
 */
export function formatDNAForOutline(dna) {
  if (!dna) return '';

  return `
═══════════════════════════════════════════════════════════════
STORY DNA — TONAL BLUEPRINT (Follow this artistic vision)
═══════════════════════════════════════════════════════════════

${dna.tonal_blueprint}

GENRE FUSION: ${dna.genre_fusion}

EMOTIONAL PALETTE: ${dna.emotional_palette?.join(', ') || 'engaging, dramatic'}

FORBIDDEN TONES (these would BREAK the story):
${dna.forbidden_tones?.map(t => `- ${t}`).join('\n') || '- None specified'}

PACING: ${dna.pacing_rhythm || 'Natural dramatic arc'}

CONTENT PHILOSOPHY: ${dna.intensity_philosophy || 'Appropriate for audience'}

GUARDRAILS: ${dna.content_guardrails || 'Keep within audience expectations'}
═══════════════════════════════════════════════════════════════`;
}

/**
 * Format Story DNA for injection into a specific scene prompt
 * @param {object} dna - Story DNA object
 * @param {number} sceneIndex - Current scene index (0-based)
 * @param {number} totalScenes - Total number of scenes
 * @returns {string} Scene-specific DNA guidance
 */
export function formatDNAForScene(dna, sceneIndex, totalScenes) {
  if (!dna) return '';

  const energyCurve = dna.scene_energy_curve || [];
  const sceneEnergy = energyCurve[sceneIndex] ?? 0.5;

  // Describe energy level in human terms
  let energyDescription;
  if (sceneEnergy < 0.2) energyDescription = 'very low energy — quiet, reflective, or ominous calm';
  else if (sceneEnergy < 0.4) energyDescription = 'moderate-low energy — building, simmering, setting up';
  else if (sceneEnergy < 0.6) energyDescription = 'moderate energy — active progression, rising tension';
  else if (sceneEnergy < 0.8) energyDescription = 'high energy — intense action, major reveals, emotional peaks';
  else energyDescription = 'maximum energy — climactic, explosive, cathartic';

  // Position context
  const position = sceneIndex === 0 ? 'OPENING'
    : sceneIndex === totalScenes - 1 ? 'FINALE'
    : sceneIndex < totalScenes / 3 ? 'RISING ACTION'
    : sceneIndex < (2 * totalScenes) / 3 ? 'MIDPOINT/COMPLICATIONS'
    : 'CLIMAX APPROACH';

  return `
★ STORY DNA — Scene ${sceneIndex + 1}/${totalScenes} (${position}) ★
Genre Fusion: ${dna.genre_fusion}
Scene Energy Target: ${sceneEnergy.toFixed(1)} — ${energyDescription}
Emotional Palette: ${dna.emotional_palette?.join(', ')}
${dna.forbidden_tones?.length > 0 ? `AVOID these tones: ${dna.forbidden_tones.join(', ')}` : ''}
${dna.intensity_philosophy ? `Content approach: ${dna.intensity_philosophy}` : ''}`;
}

/**
 * Generate a default energy curve for the given number of scenes
 */
function generateDefaultEnergyCurve(sceneCount) {
  // Classic dramatic arc: setup → rising → climax → resolution
  const curves = {
    3: [0.3, 0.8, 0.5],
    4: [0.3, 0.5, 0.9, 0.4],
    5: [0.3, 0.5, 0.7, 0.9, 0.4],
    6: [0.3, 0.4, 0.6, 0.8, 1.0, 0.4],
    7: [0.3, 0.4, 0.5, 0.7, 0.9, 1.0, 0.3],
    8: [0.3, 0.4, 0.5, 0.6, 0.7, 0.9, 1.0, 0.3]
  };
  return curves[sceneCount] || curves[5];
}

/**
 * Generate fallback DNA when LLM call fails
 */
function generateFallbackDNA(preferences, targetScenes) {
  const genres = preferences.genres || {};
  const primaryGenre = Object.entries(genres)
    .sort(([, a], [, b]) => b - a)[0]?.[0] || 'fantasy';

  return {
    tonal_blueprint: `A ${primaryGenre}-focused story with ${preferences.tone || 'engaging'} tone.`,
    genre_fusion: `A ${primaryGenre} story`,
    intensity_philosophy: 'Match intensity to audience expectations',
    pacing_rhythm: 'Classic dramatic arc with rising tension',
    emotional_palette: ['dramatic', 'engaging'],
    forbidden_tones: [],
    scene_energy_curve: generateDefaultEnergyCurve(targetScenes),
    content_guardrails: `Appropriate for ${preferences.audience || 'general'} audience`
  };
}

export default {
  generateStoryDNA,
  formatDNAForOutline,
  formatDNAForScene
};
