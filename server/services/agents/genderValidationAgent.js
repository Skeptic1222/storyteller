/**
 * Gender Validation Agent
 * Bulletproof multi-pass LLM validation for character gender
 *
 * This agent ensures that character gender is correctly identified
 * and matches voice assignment requirements. Mis-gendering is a
 * CRITICAL error that must be prevented at all costs.
 *
 * Architecture:
 * 1. First Pass: Individual character gender analysis
 * 2. Second Pass: Cross-reference with voice descriptions
 * 3. Teacher Pass: Final QC with strict validation
 */

import { pool } from '../../database/pool.js';
import { logger } from '../../utils/logger.js';
import { callLLM } from '../llmProviders.js';

/**
 * First pass: Analyze each character's gender based on all available context
 */
export async function analyzeCharacterGenders(characters, storyContext = {}) {
  // VERBOSE LOGGING: Log first pass start
  logger.info(`[GenderValidation] ============================================================`);
  logger.info(`[GenderValidation] FIRST PASS: CHARACTER GENDER ANALYSIS`);
  logger.info(`[GenderValidation] Story: "${storyContext.title || 'Unknown'}"`);
  logger.info(`[GenderValidation] Characters to analyze: ${characters.length}`);
  characters.forEach((c, i) => {
    logger.info(`[GenderValidation]   ${i + 1}. ${c.name} | Current gender: ${c.gender || 'NOT SET'} | Role: ${c.role || 'N/A'}`);
  });
  logger.info(`[GenderValidation] ============================================================`);

  const characterList = characters.map((c, idx) => {
    return `${idx + 1}. Name: "${c.name}"
   Role: ${c.role || 'unspecified'}
   Description: ${c.description || 'none'}
   Personality: ${c.personality || 'none'}
   Voice Description: ${c.voice_description || 'none'}
   Current Gender: ${c.gender || 'NOT SET'}`;
  }).join('\n\n');

  const prompt = `You are a Gender Analysis Agent for a story narration system.
Your task is to analyze each character and determine their gender for voice casting purposes.

CRITICAL: Mis-gendering a character is an UNACCEPTABLE error. The wrong gender voice will ruin the listening experience.

Story Context:
- Title: ${storyContext.title || 'Unknown'}
- Synopsis: ${storyContext.synopsis || 'None provided'}
- Setting: ${storyContext.setting || 'Unknown'}

Characters to analyze:
${characterList}

For EACH character, analyze:
1. Their name (but DO NOT assume gender from ambiguous names like "Alex", "Jordan", "Robin", or titles like "Commander", "Dr.", "Captain")
2. Their role description (look for gendered words like "queen", "king", "mother", "father", "waitress", "waiter")
3. Their personality description (look for pronouns: he/him/his, she/her/hers, they/them/theirs)
4. Their voice description (look for "female voice", "male voice", "deep voice", "soprano", etc.)

Return JSON with this EXACT format:
{
  "analysis": [
    {
      "character_index": 0,
      "name": "Character Name",
      "gender": "male|female|non-binary|neutral",
      "confidence": "high|medium|low",
      "evidence": ["List of specific evidence found"],
      "warnings": ["Any concerns about this determination"]
    }
  ],
  "summary": {
    "total_analyzed": 5,
    "high_confidence": 3,
    "medium_confidence": 1,
    "low_confidence": 1,
    "needs_review": ["Names of characters needing review"]
  }
}

IMPORTANT RULES:
- If a character has "she/her" pronouns anywhere, they are FEMALE
- If a character has "he/him" pronouns anywhere, they are MALE
- If a character has "they/them" pronouns, they are NON-BINARY
- Roles like "queen", "princess", "mother", "sister", "waitress" indicate FEMALE
- Roles like "king", "prince", "father", "brother", "waiter" indicate MALE
- Titles like "Commander", "Captain", "Dr.", "Professor" do NOT indicate gender
- Names like "Alex", "Jordan", "Taylor", "Morgan", "Casey" are NEUTRAL - look for other evidence
- If uncertain, mark confidence as "low" and add to warnings
- For robots, AI, or non-human characters, use "neutral"`;

  try {
    // Use callLLM with 'coherence' agent_category to route to GPT-5.1 for premium quality
    const response = await callLLM({
      messages: [{ role: 'user', content: prompt }],
      agent_name: 'GenderValidationAgent',
      agent_category: 'coherence',  // Premium tier for critical gender decisions
      temperature: 0.2,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.content);

    // VERBOSE LOGGING: Log first pass results
    logger.info(`[GenderValidation] ============================================================`);
    logger.info(`[GenderValidation] FIRST PASS COMPLETE`);
    logger.info(`[GenderValidation] High confidence: ${result.summary?.high_confidence || 0} | Medium: ${result.summary?.medium_confidence || 0} | Low: ${result.summary?.low_confidence || 0}`);
    if (result.analysis) {
      result.analysis.forEach((a, i) => {
        logger.info(`[GenderValidation]   ${a.name}: ${a.gender?.toUpperCase() || 'UNKNOWN'} (${a.confidence} confidence)`);
        if (a.evidence?.length > 0) {
          logger.info(`[GenderValidation]     Evidence: ${a.evidence.slice(0, 2).join('; ')}`);
        }
        if (a.warnings?.length > 0) {
          logger.warn(`[GenderValidation]     WARNINGS: ${a.warnings.join('; ')}`);
        }
      });
    }
    if (result.summary?.needs_review?.length > 0) {
      logger.warn(`[GenderValidation] NEEDS REVIEW: ${result.summary.needs_review.join(', ')}`);
    }
    logger.info(`[GenderValidation] ============================================================`);

    return result;
  } catch (error) {
    logger.error('[GenderValidation] First Pass failed:', error);
    throw error;
  }
}

/**
 * Second pass: Cross-reference with voice requirements and fix inconsistencies
 */
export async function validateGenderConsistency(characters, firstPassResults, voiceDescriptions = {}) {
  logger.info(`[GenderValidation] Second Pass: Validating consistency`);

  // Find any low confidence or conflicting results
  const needsReview = firstPassResults.analysis.filter(
    a => a.confidence === 'low' || a.warnings?.length > 0
  );

  if (needsReview.length === 0) {
    logger.info(`[GenderValidation] Second Pass: No reviews needed, all high/medium confidence`);
    return {
      validated: true,
      results: firstPassResults.analysis,
      changes: []
    };
  }

  const reviewList = needsReview.map(r => {
    const char = characters[r.character_index];
    return `Character: "${r.name}"
  First Pass Gender: ${r.gender} (${r.confidence})
  Evidence: ${r.evidence.join(', ')}
  Warnings: ${r.warnings?.join(', ') || 'none'}
  Full Description: ${char?.description || 'none'}
  Voice Description: ${char?.voice_description || 'none'}`;
  }).join('\n\n---\n\n');

  const prompt = `You are a Senior Gender Validation Agent reviewing uncertain character gender assignments.

Characters needing review:
${reviewList}

For each character, make a FINAL determination. If you cannot determine gender with confidence, assign "neutral" rather than guessing wrong.

Return JSON:
{
  "reviewed_characters": [
    {
      "name": "Character Name",
      "final_gender": "male|female|non-binary|neutral",
      "reasoning": "Brief explanation of final decision",
      "changed_from": "original gender or null if unchanged"
    }
  ],
  "validation_notes": "Any overall concerns"
}`;

  try {
    // Use callLLM with 'coherence' agent_category to route to GPT-5.1
    const response = await callLLM({
      messages: [{ role: 'user', content: prompt }],
      agent_name: 'GenderValidationAgent',
      agent_category: 'coherence',  // Premium tier for critical gender decisions
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.content);

    // Merge reviewed results back into first pass
    const mergedResults = firstPassResults.analysis.map(original => {
      const reviewed = result.reviewed_characters.find(r => r.name === original.name);
      if (reviewed) {
        return {
          ...original,
          gender: reviewed.final_gender,
          confidence: 'validated',
          validation_note: reviewed.reasoning
        };
      }
      return original;
    });

    logger.info(`[GenderValidation] Second Pass Complete: ${result.reviewed_characters.length} characters reviewed`);

    return {
      validated: true,
      results: mergedResults,
      changes: result.reviewed_characters.filter(r => r.changed_from)
    };
  } catch (error) {
    logger.error('[GenderValidation] Second Pass failed:', error);
    throw error;
  }
}

/**
 * Teacher pass: Final QC by a "strict teacher" agent that looks for any remaining issues
 */
export async function teacherValidateGenders(characters, validatedResults, config = {}) {
  logger.info(`[GenderValidation] Teacher Pass: Final QC`);

  const characterSummary = validatedResults.map((r, idx) => {
    const char = characters[idx];
    return `${r.name}: ${r.gender} (confidence: ${r.confidence})
  - Voice: ${char?.voice_description || 'not specified'}
  - Evidence: ${r.evidence?.slice(0, 2).join(', ') || 'none listed'}`;
  }).join('\n');

  const prompt = `You are a STRICT Quality Control Teacher reviewing gender assignments for voice casting.

Your job is to find ANY errors or inconsistencies that could lead to mis-gendering characters.

Character Assignments:
${characterSummary}

Check for:
1. PRONOUNS: If description says "she" but gender is "male" = CRITICAL ERROR
2. TITLES: "Queen", "Princess" must be female; "King", "Prince" must be male
3. RELATIONSHIPS: "mother", "sister", "aunt" = female; "father", "brother", "uncle" = male
4. VOICE: If voice says "deep baritone" but gender is "female" = POSSIBLE ERROR
5. NEUTRAL OVERUSE: Don't mark human characters as "neutral" unless truly non-binary

Return JSON:
{
  "passed": true|false,
  "critical_errors": [
    {
      "character": "Name",
      "issue": "Description of critical error",
      "current_gender": "current assignment",
      "should_be": "correct gender"
    }
  ],
  "warnings": [
    {
      "character": "Name",
      "concern": "Description of minor concern"
    }
  ],
  "teacher_notes": "Overall assessment"
}

Be VERY strict. It's better to flag a potential issue than miss a mis-gendering error.`;

  try {
    // Use callLLM with 'coherence' agent_category to route to GPT-5.1
    const response = await callLLM({
      messages: [{ role: 'user', content: prompt }],
      agent_name: 'GenderValidationAgent',
      agent_category: 'coherence',  // Premium tier for critical gender decisions
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.content);

    if (result.critical_errors?.length > 0) {
      logger.error(`[GenderValidation] Teacher found ${result.critical_errors.length} CRITICAL errors:`,
        result.critical_errors.map(e => `${e.character}: ${e.issue}`).join('; ')
      );
    }

    logger.info(`[GenderValidation] Teacher Pass Complete: passed=${result.passed}, warnings=${result.warnings?.length || 0}`);

    return result;
  } catch (error) {
    logger.error('[GenderValidation] Teacher Pass failed:', error);
    throw error;
  }
}

/**
 * Apply gender corrections from teacher validation
 */
export async function applyGenderCorrections(sessionId, corrections) {
  logger.info(`[GenderValidation] Applying ${corrections.length} gender corrections`);

  const results = [];

  for (const correction of corrections) {
    try {
      const updateResult = await pool.query(`
        UPDATE characters
        SET gender = $1,
            gender_confidence = 'llm_validated',
            gender_source = 'teacher_agent'
        WHERE story_session_id = $2 AND name = $3
        RETURNING id, name, gender
      `, [correction.should_be, sessionId, correction.character]);

      if (updateResult.rows[0]) {
        results.push({
          character: correction.character,
          old_gender: correction.current_gender,
          new_gender: correction.should_be,
          success: true
        });
        logger.info(`[GenderValidation] Corrected "${correction.character}": ${correction.current_gender} -> ${correction.should_be}`);
      }
    } catch (error) {
      logger.error(`[GenderValidation] Failed to correct "${correction.character}":`, error);
      results.push({
        character: correction.character,
        success: false,
        error: error.message
      });
    }
  }

  return results;
}

/**
 * Main entry point: Full multi-pass gender validation pipeline
 */
export async function validateAllCharacterGenders(sessionId, options = {}) {
  // VERBOSE LOGGING: Log validation pipeline start
  logger.info(`[GenderValidation] ============================================================`);
  logger.info(`[GenderValidation] STARTING FULL GENDER VALIDATION PIPELINE`);
  logger.info(`[GenderValidation] Session: ${sessionId}`);
  logger.info(`[GenderValidation] Options: ${JSON.stringify(options)}`);
  logger.info(`[GenderValidation] This is a BULLETPROOF 3-pass validation system`);
  logger.info(`[GenderValidation]   Pass 1: Individual character gender analysis`);
  logger.info(`[GenderValidation]   Pass 2: Cross-reference with voice requirements`);
  logger.info(`[GenderValidation]   Pass 3: Teacher QC for any remaining issues`);
  logger.info(`[GenderValidation] ============================================================`);

  const startTime = Date.now();
  const validationReport = {
    sessionId,
    timestamp: new Date().toISOString(),
    passes: [],
    corrections: [],
    finalStatus: 'pending'
  };

  try {
    // Load characters from database
    const charactersResult = await pool.query(`
      SELECT id, name, role, description, personality, voice_description, gender, gender_confidence, gender_source
      FROM characters
      WHERE story_session_id = $1
    `, [sessionId]);

    const characters = charactersResult.rows;

    if (characters.length === 0) {
      logger.warn(`[GenderValidation] No characters found for session ${sessionId}`);
      validationReport.finalStatus = 'no_characters';
      return validationReport;
    }

    // Load story context
    const sessionResult = await pool.query(`
      SELECT title, synopsis, config_json FROM story_sessions WHERE id = $1
    `, [sessionId]);
    const storyContext = sessionResult.rows[0] || {};

    // === PASS 1: Individual character analysis ===
    logger.info(`[GenderValidation] === PASS 1: Analyzing ${characters.length} characters ===`);
    const firstPassResults = await analyzeCharacterGenders(characters, storyContext);
    validationReport.passes.push({
      pass: 1,
      name: 'Character Analysis',
      results: firstPassResults.summary
    });

    // === PASS 2: Consistency validation ===
    logger.info(`[GenderValidation] === PASS 2: Validating consistency ===`);
    const secondPassResults = await validateGenderConsistency(characters, firstPassResults);
    validationReport.passes.push({
      pass: 2,
      name: 'Consistency Validation',
      changes: secondPassResults.changes.length
    });

    // === PASS 3: Teacher QC ===
    logger.info(`[GenderValidation] === PASS 3: Teacher QC ===`);
    const teacherResults = await teacherValidateGenders(characters, secondPassResults.results);
    validationReport.passes.push({
      pass: 3,
      name: 'Teacher QC',
      passed: teacherResults.passed,
      criticalErrors: teacherResults.critical_errors?.length || 0,
      warnings: teacherResults.warnings?.length || 0
    });

    // === Apply corrections if teacher found errors ===
    if (teacherResults.critical_errors?.length > 0 && !options.dryRun) {
      logger.info(`[GenderValidation] Applying ${teacherResults.critical_errors.length} corrections from teacher`);
      const correctionResults = await applyGenderCorrections(sessionId, teacherResults.critical_errors);
      validationReport.corrections = correctionResults;
    }

    // === Update all characters with validated genders ===
    if (!options.dryRun) {
      for (const result of secondPassResults.results) {
        const char = characters[result.character_index];
        if (char && result.gender && result.gender !== char.gender) {
          await pool.query(`
            UPDATE characters
            SET gender = $1,
                gender_confidence = $2,
                gender_source = 'llm_validation'
            WHERE id = $3
          `, [result.gender, result.confidence, char.id]);
        }
      }
    }

    // Final status
    validationReport.finalStatus = teacherResults.passed ? 'validated' : 'corrected';
    validationReport.duration_ms = Date.now() - startTime;

    // VERBOSE LOGGING: Log validation pipeline completion
    logger.info(`[GenderValidation] ============================================================`);
    logger.info(`[GenderValidation] GENDER VALIDATION PIPELINE COMPLETE`);
    logger.info(`[GenderValidation] Status: ${validationReport.finalStatus.toUpperCase()}`);
    logger.info(`[GenderValidation] Duration: ${validationReport.duration_ms}ms`);
    logger.info(`[GenderValidation] Passes completed: ${validationReport.passes.length}`);
    validationReport.passes.forEach(p => {
      logger.info(`[GenderValidation]   Pass ${p.pass} (${p.name}): ${p.passed !== undefined ? (p.passed ? 'PASSED' : 'ISSUES FOUND') : 'OK'}`);
    });
    if (validationReport.corrections?.length > 0) {
      logger.info(`[GenderValidation] Corrections applied: ${validationReport.corrections.length}`);
      validationReport.corrections.forEach(c => {
        logger.info(`[GenderValidation]   ${c.character}: ${c.old_gender} -> ${c.new_gender}`);
      });
    }
    logger.info(`[GenderValidation] ============================================================`);

    return validationReport;

  } catch (error) {
    logger.error('[GenderValidation] Pipeline failed:', error);
    validationReport.finalStatus = 'failed';
    validationReport.error = error.message;
    return validationReport;
  }
}

export default {
  analyzeCharacterGenders,
  validateGenderConsistency,
  teacherValidateGenders,
  applyGenderCorrections,
  validateAllCharacterGenders
};
