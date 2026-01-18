/**
 * Story Bible Extractor - Multi-Agent Orchestrator v5
 * Coordinates 7-pass extraction with real-time progress updates via Socket.IO
 *
 * Architecture:
 * Pass 0: Chapter Structure Extraction (NEW - extracts explicit chapter/section structure)
 * Pass 1: Document Analysis
 * Pass 2: Entity Extraction (7 parallel agents - Characters, World, Locations, Items, Factions, Lore, Events)
 * Pass 3: Relationship Mapping
 * Pass 4: Gap Analysis
 * Pass 4.5: Deduplication (cross-category)
 * Pass 5: Consolidation
 */

import OpenAI from 'openai';
import { logger } from '../utils/logger.js';
import {
  extractChapterStructure,  // Pass 0 - PHASE 4 FIX
  analyzeDocument,
  extractCharacters,
  extractWorld,
  extractLocations,
  extractLore,
  extractItems,
  extractFactions,
  extractEvents,
  mapRelationships,
  analyzeGaps,
  deduplicateEntities,
  consolidateExtraction
} from './agents/storyBibleExtraction/index.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Main extraction function - orchestrates all agents
 * @param {string} text - The document text to extract from
 * @param {Object} options - Configuration options
 * @param {Function} onProgress - Callback for progress updates (for Socket.IO)
 * @returns {Object} Consolidated extraction results
 */
export async function extractFromDocument(text, options = {}, onProgress = null) {
  const startTime = Date.now();
  const results = {
    passes: [],
    tokens_used: 0,
    timing: {}
  };

  const emit = (event, data) => {
    if (onProgress) {
      onProgress(event, data);
    }
  };

  try {
    emit('extraction:started', {
      document_length: text.length,
      total_passes: 7,  // Updated for Pass 0
      estimated_time: Math.ceil(text.length / 5000) * 15 // rough estimate in seconds
    });

    // ==========================================================================
    // PASS 0: Chapter Structure Extraction (NEW - PHASE 4 FIX)
    // ==========================================================================
    emit('extraction:pass', { pass: 0, name: 'Chapter Structure', status: 'running' });
    logger.info('[StoryBibleExtractor] Starting Pass 0: Chapter Structure Extraction');

    const pass0Start = Date.now();
    const chapterStructure = await extractChapterStructure(text, openai, emit);
    results.timing.pass0 = Date.now() - pass0Start;
    results.tokens_used += chapterStructure.tokens_used || 0;
    results.chapterStructure = chapterStructure;

    emit('extraction:pass', {
      pass: 0,
      name: 'Chapter Structure',
      status: 'complete',
      result: {
        has_structure: chapterStructure.has_explicit_structure,
        structure_type: chapterStructure.structure_type,
        chapters_found: chapterStructure.chapters?.length || 0
      }
    });

    if (chapterStructure.has_explicit_structure) {
      logger.info(`[StoryBibleExtractor] Found explicit chapter structure: ${chapterStructure.total_chapters} chapters (${chapterStructure.structure_type})`);
    } else {
      logger.info('[StoryBibleExtractor] No explicit chapter structure found in document');
    }

    // ==========================================================================
    // PASS 1: Document Analysis
    // ==========================================================================
    emit('extraction:pass', { pass: 1, name: 'Document Analysis', status: 'running' });
    logger.info('[StoryBibleExtractor] Starting Pass 1: Document Analysis');

    const pass1Start = Date.now();
    const documentAnalysis = await analyzeDocument(text, openai);
    results.timing.pass1 = Date.now() - pass1Start;
    results.tokens_used += documentAnalysis.tokens_used || 0;
    results.passes.push({ pass: 1, name: 'Document Analysis', result: documentAnalysis });

    emit('extraction:pass', {
      pass: 1,
      name: 'Document Analysis',
      status: 'complete',
      result: {
        document_type: documentAnalysis.analysis?.document_type,
        estimated_characters: documentAnalysis.analysis?.content_estimates?.characters?.count,
        estimated_locations: documentAnalysis.analysis?.content_estimates?.locations?.count
      }
    });

    // ==========================================================================
    // PASS 2: Parallel Entity Extraction (7 agents)
    // ==========================================================================
    emit('extraction:pass', { pass: 2, name: 'Entity Extraction', status: 'running' });
    logger.info('[StoryBibleExtractor] Starting Pass 2: Parallel Entity Extraction (7 agents)');

    const pass2Start = Date.now();

    // ERROR HANDLING FIX: Use Promise.allSettled instead of Promise.all
    // This ensures one agent failure doesn't cancel all other extractions
    const agentResults = await Promise.allSettled([
      // Character Extractor
      (async () => {
        emit('extraction:agent', { agent: 'CharacterExtractor', status: 'running' });
        const result = await extractCharacters(text, documentAnalysis.analysis, openai);
        const chars = result.characters || [];
        const deceased = chars.filter(c => c.is_deceased).length;
        const animals = chars.filter(c => c.is_animal_companion).length;
        emit('extraction:agent', {
          agent: 'CharacterExtractor',
          status: 'complete',
          count: chars.length,
          deceased,
          animals
        });
        emit('extraction:found', {
          type: 'characters',
          data: chars,
          count: chars.length,
          deceased,
          animals,
          sample: chars.slice(0, 5).map(c => c.name)
        });
        return result;
      })(),

      // World Extractor
      (async () => {
        emit('extraction:agent', { agent: 'WorldExtractor', status: 'running' });
        const result = await extractWorld(text, documentAnalysis.analysis, openai);
        emit('extraction:agent', {
          agent: 'WorldExtractor',
          status: 'complete',
          genre: result.world?.genre
        });
        emit('extraction:found', {
          type: 'world',
          data: result.world,
          name: result.world?.name,
          genre: result.world?.genre
        });
        return result;
      })(),

      // Location Extractor
      (async () => {
        emit('extraction:agent', { agent: 'LocationExtractor', status: 'running' });
        const result = await extractLocations(text, documentAnalysis.analysis, openai);
        const locs = result.locations || [];
        emit('extraction:agent', {
          agent: 'LocationExtractor',
          status: 'complete',
          count: locs.length
        });
        emit('extraction:found', {
          type: 'locations',
          data: locs,
          count: locs.length,
          sample: locs.slice(0, 5).map(l => l.name)
        });
        return result;
      })(),

      // Item Extractor (NEW)
      (async () => {
        emit('extraction:agent', { agent: 'ItemExtractor', status: 'running' });
        const result = await extractItems(text, documentAnalysis.analysis, openai);
        const items = result.items || [];
        emit('extraction:agent', {
          agent: 'ItemExtractor',
          status: 'complete',
          count: items.length
        });
        emit('extraction:found', {
          type: 'items',
          data: items,
          count: items.length,
          sample: items.slice(0, 5).map(i => i.name)
        });
        return result;
      })(),

      // Faction Extractor (NEW)
      (async () => {
        emit('extraction:agent', { agent: 'FactionExtractor', status: 'running' });
        const result = await extractFactions(text, documentAnalysis.analysis, openai);
        const factions = result.factions || [];
        emit('extraction:agent', {
          agent: 'FactionExtractor',
          status: 'complete',
          count: factions.length
        });
        emit('extraction:found', {
          type: 'factions',
          data: factions,
          count: factions.length,
          sample: factions.slice(0, 5).map(f => f.name)
        });
        return result;
      })(),

      // Lore Extractor
      (async () => {
        emit('extraction:agent', { agent: 'LoreExtractor', status: 'running' });
        const result = await extractLore(text, documentAnalysis.analysis, openai);
        const loreItems = result.lore || [];
        emit('extraction:agent', {
          agent: 'LoreExtractor',
          status: 'complete',
          count: loreItems.length
        });
        emit('extraction:found', {
          type: 'lore',
          data: loreItems,
          count: loreItems.length,
          sample: loreItems.slice(0, 5).map(l => l.title)
        });
        return result;
      })(),

      // Event Extractor (planned story moments)
      (async () => {
        emit('extraction:agent', { agent: 'EventExtractor', status: 'running' });
        const result = await extractEvents(text, documentAnalysis.analysis, openai);
        const events = result.events || [];
        const major = events.filter(e => e.importance === 'major').length;
        emit('extraction:agent', {
          agent: 'EventExtractor',
          status: 'complete',
          count: events.length,
          major
        });
        emit('extraction:found', {
          type: 'events',
          data: events,
          count: events.length,
          major,
          sample: events.slice(0, 5).map(e => e.name)
        });
        return result;
      })()
    ]);

    // ERROR HANDLING FIX: Process allSettled results with individual failure handling
    const agentNames = ['CharacterExtractor', 'WorldExtractor', 'LocationExtractor', 'ItemExtractor', 'FactionExtractor', 'LoreExtractor', 'EventExtractor'];
    const processedResults = agentResults.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        // Log the failure but continue with other agents
        const agentName = agentNames[index];
        logger.error(`[StoryBibleExtractor] ${agentName} failed:`, result.reason?.message || result.reason);
        emit('extraction:agent', {
          agent: agentName,
          status: 'failed',
          error: result.reason?.message || 'Unknown error'
        });
        // Return empty default result
        return { tokens_used: 0 };
      }
    });

    const [characterResult, worldResult, locationResult, itemResult, factionResult, loreResult, eventResult] = processedResults;

    // Count successful vs failed extractions
    const successCount = agentResults.filter(r => r.status === 'fulfilled').length;
    const failureCount = agentResults.filter(r => r.status === 'rejected').length;
    if (failureCount > 0) {
      logger.warn(`[StoryBibleExtractor] Pass 2 completed with ${failureCount}/${agentResults.length} agent failures`);
    }

    results.timing.pass2 = Date.now() - pass2Start;
    results.tokens_used += (characterResult.tokens_used || 0) +
                          (worldResult.tokens_used || 0) +
                          (locationResult.tokens_used || 0) +
                          (itemResult.tokens_used || 0) +
                          (factionResult.tokens_used || 0) +
                          (loreResult.tokens_used || 0) +
                          (eventResult.tokens_used || 0);

    const extractedData = {
      characters: characterResult.characters || [],
      world: worldResult.world || {},
      locations: locationResult.locations || [],
      items: itemResult.items || [],
      factions: factionResult.factions || [],
      lore: loreResult.lore || [],
      events: eventResult.events || [],
      extraction_stats: { successCount, failureCount, total: agentResults.length }
    };

    results.passes.push({ pass: 2, name: 'Entity Extraction', result: {
      characters: extractedData.characters.length,
      locations: extractedData.locations.length,
      items: extractedData.items.length,
      factions: extractedData.factions.length,
      lore: extractedData.lore.length,
      events: extractedData.events.length,
      hasWorld: !!extractedData.world?.name
    }});

    emit('extraction:pass', {
      pass: 2,
      name: 'Entity Extraction',
      status: 'complete',
      result: {
        characters: extractedData.characters.length,
        locations: extractedData.locations.length,
        items: extractedData.items.length,
        factions: extractedData.factions.length,
        lore: extractedData.lore.length,
        events: extractedData.events.length
      }
    });

    // ==========================================================================
    // PASS 3: Relationship Mapping
    // ==========================================================================
    emit('extraction:pass', { pass: 3, name: 'Relationship Mapping', status: 'running' });
    logger.info('[StoryBibleExtractor] Starting Pass 3: Relationship Mapping');

    const pass3Start = Date.now();
    const relationshipResult = await mapRelationships(extractedData, text, openai, emit);
    results.timing.pass3 = Date.now() - pass3Start;
    results.tokens_used += relationshipResult.tokens_used || 0;

    // Count all relationship types from enhanced mapper
    const totalRelationships =
      (relationshipResult.relationships?.character_relationships?.length || 0) +
      (relationshipResult.relationships?.character_location_links?.length || 0) +
      (relationshipResult.relationships?.character_lore_links?.length || 0) +
      (relationshipResult.relationships?.character_item_links?.length || 0) +
      (relationshipResult.relationships?.character_faction_links?.length || 0) +
      (relationshipResult.relationships?.location_hierarchy?.length || 0) +
      (relationshipResult.relationships?.location_ownership?.length || 0) +
      (relationshipResult.relationships?.location_lore_links?.length || 0) +
      (relationshipResult.relationships?.lore_connections?.length || 0) +
      (relationshipResult.relationships?.faction_memberships?.length || 0);

    results.passes.push({ pass: 3, name: 'Relationship Mapping', result: { totalRelationships }});

    emit('extraction:pass', {
      pass: 3,
      name: 'Relationship Mapping',
      status: 'complete',
      result: {
        relationships: totalRelationships,
        breakdown: {
          character_relationships: relationshipResult.relationships?.character_relationships?.length || 0,
          character_location_links: relationshipResult.relationships?.character_location_links?.length || 0,
          character_item_links: relationshipResult.relationships?.character_item_links?.length || 0,
          character_faction_links: relationshipResult.relationships?.character_faction_links?.length || 0,
          location_hierarchy: relationshipResult.relationships?.location_hierarchy?.length || 0,
          faction_memberships: relationshipResult.relationships?.faction_memberships?.length || 0
        }
      }
    });
    emit('extraction:found', {
      type: 'relationships',
      count: totalRelationships,
      data: relationshipResult.relationships,
      metadata: relationshipResult.metadata
    });

    // ==========================================================================
    // PASS 4: Gap Analysis
    // ==========================================================================
    emit('extraction:pass', { pass: 4, name: 'Gap Analysis', status: 'running' });
    logger.info('[StoryBibleExtractor] Starting Pass 4: Gap Analysis');

    const pass4Start = Date.now();
    const gapResult = await analyzeGaps(extractedData, relationshipResult.relationships, text, openai);
    results.timing.pass4 = Date.now() - pass4Start;
    results.tokens_used += gapResult.tokens_used || 0;

    results.passes.push({ pass: 4, name: 'Gap Analysis', result: {
      character_inferences: gapResult.inferences?.character_inferences?.length || 0,
      location_inferences: gapResult.inferences?.location_inferences?.length || 0,
      has_synopsis: !!gapResult.inferences?.synopsis_suggestion?.synopsis
    }});

    emit('extraction:pass', {
      pass: 4,
      name: 'Gap Analysis',
      status: 'complete',
      result: {
        inferences: (gapResult.inferences?.character_inferences?.length || 0) +
                   (gapResult.inferences?.location_inferences?.length || 0),
        quality: gapResult.quality_assessment?.completeness_score || 'N/A'
      }
    });

    // ==========================================================================
    // PASS 4.5: Cross-Category Deduplication
    // ==========================================================================
    emit('extraction:pass', { pass: 4.5, name: 'Deduplication', status: 'running' });
    logger.info('[StoryBibleExtractor] Starting Pass 4.5: Cross-Category Deduplication');

    const pass45Start = Date.now();
    const deduplicatedData = await deduplicateEntities(extractedData, openai);
    results.timing.pass45 = Date.now() - pass45Start;

    const corrections = deduplicatedData.deduplication?.corrections || [];

    results.passes.push({ pass: 4.5, name: 'Deduplication', result: {
      duplicates_found: deduplicatedData.deduplication?.duplicates_found || 0,
      corrections_applied: corrections.length
    }});

    emit('extraction:pass', {
      pass: 4.5,
      name: 'Deduplication',
      status: 'complete',
      result: {
        duplicates_found: deduplicatedData.deduplication?.duplicates_found || 0,
        corrections: corrections.map(c => ({
          name: c.name,
          correct_category: c.correct_category,
          removed_from: c.remove_from
        }))
      }
    });

    // Update extractedData with deduplicated data
    const finalExtractedData = {
      characters: deduplicatedData.characters,
      world: deduplicatedData.world,
      locations: deduplicatedData.locations,
      items: deduplicatedData.items,
      factions: deduplicatedData.factions,
      lore: deduplicatedData.lore,
      events: deduplicatedData.events || extractedData.events || []
    };

    // ==========================================================================
    // PASS 5: Consolidation
    // ==========================================================================
    emit('extraction:pass', { pass: 5, name: 'Consolidation', status: 'running' });
    logger.info('[StoryBibleExtractor] Starting Pass 5: Consolidation');

    const pass5Start = Date.now();
    const consolidatedResult = await consolidateExtraction(
      finalExtractedData,
      relationshipResult.relationships,
      gapResult.inferences,
      openai
    );
    results.timing.pass5 = Date.now() - pass5Start;

    // Add new entity types and chapter structure to consolidated data
    consolidatedResult.data = {
      ...consolidatedResult.data,
      items: finalExtractedData.items,
      factions: finalExtractedData.factions,
      events: finalExtractedData.events,
      // PHASE 4 FIX: Include chapter structure for outline generation
      chapterStructure: chapterStructure.has_explicit_structure ? chapterStructure : null,
      metadata: {
        ...consolidatedResult.data?.metadata,
        total_items: finalExtractedData.items.length,
        total_factions: finalExtractedData.factions.length,
        total_events: finalExtractedData.events.length,
        deduplication: deduplicatedData.deduplication,
        has_chapter_structure: chapterStructure.has_explicit_structure || false,
        chapter_count: chapterStructure.total_chapters || 0
      }
    };

    results.passes.push({ pass: 5, name: 'Consolidation', result: consolidatedResult.data?.metadata });

    emit('extraction:pass', {
      pass: 5,
      name: 'Consolidation',
      status: 'complete',
      result: consolidatedResult.data?.metadata
    });

    // ==========================================================================
    // COMPLETE
    // ==========================================================================
    const totalTime = Date.now() - startTime;
    results.timing.total = totalTime;

    logger.info(`[StoryBibleExtractor] Extraction complete in ${totalTime}ms - ${results.tokens_used} tokens used`);
    logger.info(`[StoryBibleExtractor] Final counts: ${consolidatedResult.data?.metadata?.total_characters || 0} characters, ` +
                `${consolidatedResult.data?.metadata?.total_locations || 0} locations, ` +
                `${finalExtractedData.items.length} items, ` +
                `${finalExtractedData.factions.length} factions, ` +
                `${consolidatedResult.data?.metadata?.total_lore || 0} lore, ` +
                `${finalExtractedData.events.length} events`);

    // Include full extracted data in the complete event so client can display it
    emit('extraction:complete', {
      success: true,
      timing: results.timing,
      tokens_used: results.tokens_used,
      summary: consolidatedResult.data?.metadata,
      data: consolidatedResult.data  // Include the actual extracted data
    });

    return {
      success: true,
      data: consolidatedResult.data,
      metadata: {
        passes: results.passes,
        timing: results.timing,
        tokens_used: results.tokens_used
      }
    };

  } catch (error) {
    logger.error('[StoryBibleExtractor] Extraction failed:', error);

    emit('extraction:error', {
      error: error.message,
      pass: results.passes.length + 1
    });

    return {
      success: false,
      error: error.message,
      metadata: {
        passes: results.passes,
        timing: results.timing,
        tokens_used: results.tokens_used
      }
    };
  }
}

/**
 * Simplified extraction for smaller documents
 * Uses single-pass approach for documents under 5000 characters
 */
export async function extractFromDocumentSimple(text, openaiClient) {
  const client = openaiClient || openai;

  if (text.length < 5000) {
    // For very short documents, use simple extraction
    const systemPrompt = `Extract all story elements from this text into structured JSON.
Return: {
  characters: [{ name, role, description, is_alive, is_deceased, species }],
  world: { name, genre, time_period, description },
  locations: [{ name, location_type, description }],
  items: [{ name, item_type, description, current_owner }],
  factions: [{ name, faction_type, description }],
  lore: [{ title, entry_type, content }],
  synopsis: { title, summary }
}`;

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text }
      ],
      temperature: 0.3,
      response_format: { type: 'json_object' }
    });

    return JSON.parse(response.choices[0]?.message?.content || '{}');
  }

  // For larger documents, use full multi-pass system
  return extractFromDocument(text);
}
