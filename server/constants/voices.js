/**
 * Voice ID Constants - Single Source of Truth
 *
 * IMPORTANT: All voice IDs should be imported from this file.
 * Do NOT hardcode voice IDs elsewhere in the codebase.
 *
 * ElevenLabs Voice Library:
 * https://elevenlabs.io/voice-library
 */

// Primary narrator voices
export const VOICE_IDS = {
  // Male narrators
  GEORGE: 'JBFqnCBsd6RMkjVDRZzb',        // Deep, warm male narrator
  CALLUM: 'N2lVS1w4EtoT3dr4eOWO',        // British male, DM/storyteller
  ADAM: 'pNInz6obpgDQGcFmaJgB',          // American male, clear
  BILL: 'pqHfZKP75CvOlQylNhV4',          // Older American male

  // Female narrators
  RACHEL: '21m00Tcm4TlvDq8ikWAM',        // American female, warm
  CHARLOTTE: 'XB0fDUnXU5powFXDhCwa',     // British female, elegant
  SARAH: 'EXAVITQu4vr4xnSDxMaL',         // American female, friendly

  // Character voices (commonly used)
  ARNOLD: 'VR6AewLTigWG4xSOukaG',        // Deep male
  DOMI: 'AZnzlk1XvdvUeBnXmlld',          // Young female
  ELLI: 'MF3mGyEYCl7XYWbV9V6O',          // Female
  JOSH: 'TxGEqnHWrfWFTfGW9XjX',          // Young male
  GLINDA: 'z9fAnlkpzviPz146aGWa',        // Older female, warm
  GRACE: 'oWAxZDx7w5VEj9dCyTzz',         // Young female
  FREYA: 'jsCqWAovK2LkecY7zXl4',         // Nordic female
  GIGI: 'jBpfuIE2acCO8z3wKNLl'           // Young, playful female
};

// Default narrator (George - deep warm voice, great for storytelling)
export const DEFAULT_NARRATOR_VOICE_ID = VOICE_IDS.GEORGE;

// Authority voice (Callum - British, authoritative) - kings, judges, commanders
export const AUTHORITY_VOICE_ID = VOICE_IDS.CALLUM;
// Legacy alias for backward compatibility
export const DM_VOICE_ID = AUTHORITY_VOICE_ID;

// Fallback narrator if primary fails
export const FALLBACK_NARRATOR_VOICE_ID = VOICE_IDS.ADAM;

// Voice settings defaults
export const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.3,
  use_speaker_boost: true
};

// Voice categories for character assignment
export const VOICE_CATEGORIES = {
  male_narrator: [VOICE_IDS.GEORGE, VOICE_IDS.CALLUM, VOICE_IDS.ADAM, VOICE_IDS.BILL],
  female_narrator: [VOICE_IDS.RACHEL, VOICE_IDS.CHARLOTTE, VOICE_IDS.SARAH],
  male_character: [VOICE_IDS.ARNOLD, VOICE_IDS.JOSH],
  female_character: [VOICE_IDS.DOMI, VOICE_IDS.ELLI, VOICE_IDS.GRACE, VOICE_IDS.FREYA, VOICE_IDS.GIGI, VOICE_IDS.GLINDA]
};

export default {
  VOICE_IDS,
  DEFAULT_NARRATOR_VOICE_ID,
  DM_VOICE_ID,
  FALLBACK_NARRATOR_VOICE_ID,
  DEFAULT_VOICE_SETTINGS,
  VOICE_CATEGORIES
};
