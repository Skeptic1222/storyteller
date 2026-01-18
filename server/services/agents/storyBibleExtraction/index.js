/**
 * Story Bible Extraction Agents
 * Multi-pass extraction system for comprehensive document analysis
 *
 * Architecture (8 passes):
 * Pass 0: Chapter Structure - extract explicit chapter/section structure
 * Pass 1: Document Analysis - understand structure
 * Pass 2: Entity Extraction (7 parallel agents)
 *   - Characters (including animal companions)
 *   - Locations
 *   - Items (vehicles, weapons, artifacts)
 *   - Factions (organizations, groups)
 *   - Lore (pure knowledge/history)
 *   - Events (planned story moments/scenes)
 *   - World (setting)
 * Pass 3: Relationship Mapping
 * Pass 4: Gap Analysis
 * Pass 4.5: Deduplication (cross-category)
 * Pass 5: Consolidation
 */

// Pass 0: Chapter Structure (runs first)
export { extractChapterStructure, mergeChapterStructureIntoSynopsis } from './chapterStructureAgent.js';

// Pass 1: Document Analysis
export { analyzeDocument } from './documentAnalyzerAgent.js';

// Pass 2: Entity Extraction
export { extractCharacters } from './characterExtractorAgent.js';
export { extractWorld } from './worldExtractorAgent.js';
export { extractLocations } from './locationExtractorAgent.js';
export { extractLore } from './loreExtractorAgent.js';
export { extractItems } from './itemExtractorAgent.js';
export { extractFactions } from './factionExtractorAgent.js';
export { extractEvents } from './eventExtractorAgent.js';

// Pass 3: Relationship Mapping
export { mapRelationships } from './relationshipMapperAgent.js';

// Pass 4: Gap Analysis
export { analyzeGaps } from './gapAnalyzerAgent.js';

// Pass 4.5: Deduplication
export { deduplicateEntities, deduplicateWithinCategory } from './deduplicationAgent.js';

// Pass 5: Consolidation
export { consolidateExtraction } from './consolidatorAgent.js';
