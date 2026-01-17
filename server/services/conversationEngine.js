/**
 * Conversation Engine - Full conversational AI for story configuration
 * Handles the interactive flow from greeting to story start
 */

import { completion, parseJsonResponse } from './openai.js';
import { getUtilityModel } from './modelSelection.js';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';
import { AUTHOR_STYLES, AUTHOR_STYLES_LIST, getAuthorStyle } from './authorStyles.js';
import smartConfig from './smartConfig.js';
import { DEFAULT_NARRATOR_VOICE_ID, DM_VOICE_ID, VOICE_IDS } from '../constants/voices.js';

// Narrator style presets with ElevenLabs voice settings
export const NARRATOR_STYLES = {
  warm: { name: 'Warm & Gentle', stability: 0.7, similarity_boost: 0.8, style: 20, speed: 0.9 },
  dramatic: { name: 'Dramatic', stability: 0.3, similarity_boost: 0.85, style: 80, speed: 0.85 },
  playful: { name: 'Playful', stability: 0.5, similarity_boost: 0.75, style: 60, speed: 1.1 },
  mysterious: { name: 'Mysterious', stability: 0.8, similarity_boost: 0.9, style: 30, speed: 0.8 },
  horror: { name: 'Horror', stability: 0.85, similarity_boost: 0.9, style: 25, speed: 0.75 },
  epic: { name: 'Epic', stability: 0.4, similarity_boost: 0.85, style: 70, speed: 0.9 },
  whimsical: { name: 'Whimsical', stability: 0.45, similarity_boost: 0.7, style: 55, speed: 1.15 },
  noir: { name: 'Noir', stability: 0.75, similarity_boost: 0.85, style: 35, speed: 0.85 }
};

// Literary style DNA with prompting strategies
export const LITERARY_STYLES = {
  howard: {
    name: 'Robert E. Howard (Sword & Sorcery)',
    description: 'Fast-paced action, cunning heroes, sinister magic',
    promptTemplate: `Write in the style of Robert E. Howard's sword and sorcery.
      - Fast, energetic prose with vivid action
      - Protagonist uses cunning and physical prowess
      - Magic is rare, dangerous, used by villains
      - Focus on human adversaries (cultists, raiders, schemers)
      - Colorful, roughhewn dialogue`
  },
  lovecraft: {
    name: 'H.P. Lovecraft (Cosmic Horror)',
    description: 'Atmospheric dread, cosmic insignificance, eldritch horrors',
    promptTemplate: `Write in the style of H.P. Lovecraft's cosmic horror.
      - Build atmosphere through meticulous sensory description
      - Archaic, elevated vocabulary (eldritch, cyclopean, squamous)
      - Suggest rather than show horrors directly
      - First-person perspective with psychological deterioration
      - Theme: forbidden knowledge leads to madness`
  },
  tolkien: {
    name: 'J.R.R. Tolkien (Epic Fantasy)',
    description: 'Rich world-building, formal prose, deep history',
    promptTemplate: `Write in the style of J.R.R. Tolkien's epic fantasy.
      - Formal, elevated narrative voice with archaic structures
      - Deep world-building: histories, cultures, landscapes
      - Multiple narrative voices (historian, poet, naturalist)
      - Slow build-up with character depth
      - Sense of events within larger historical narrative`
  },
  king: {
    name: 'Stephen King (Modern Horror)',
    description: 'Small-town America, character-driven horror, building dread',
    promptTemplate: `Write in the style of Stephen King's horror.
      - Focus on ordinary people in extraordinary situations
      - Rich internal monologue and character psychology
      - Build tension slowly before explosive horror
      - Authentic dialogue with regional flavor
      - Mix mundane details with supernatural dread`
  },
  shakespeare: {
    name: 'Shakespearean Drama',
    description: 'Poetic dialogue, tragic heroes, dramatic irony',
    promptTemplate: `Write in a Shakespearean dramatic style.
      - Elevated, poetic dialogue with iambic rhythms
      - Soliloquies revealing character thoughts
      - Dramatic irony and foreshadowing
      - Themes of fate, ambition, love, and betrayal
      - Mix tragedy with dark comedy`
  },
  fairytale: {
    name: 'Classic Fairy Tale',
    description: 'Archetypal characters, moral lessons, magical helpers',
    promptTemplate: `Write in the style of classic fairy tales (Brothers Grimm).
      - Simple, accessible prose with rhythmic patterns
      - Clear hero/villain archetypes
      - Magic and magical helpers
      - Moral clarity: virtue rewarded, wickedness punished
      - "Once upon a time" structure`
  },
  bedtime: {
    name: 'Calm Story',
    description: 'Soothing, gentle, low-intensity narratives',
    promptTemplate: `Write a calming, low-intensity story.
      - Simple, flowing sentences with gentle tone
      - Soothing vocabulary and repetitive phrases
      - Low-stimulation, peaceful themes
      - Calming resolution returning to comfort
      - Target 300-400 words per scene`
  },
  scifi: {
    name: 'Science Fiction',
    description: 'Technology, space, future societies, philosophical themes',
    promptTemplate: `Write science fiction.
      - Explore technology's impact on humanity
      - World-building with scientific plausibility
      - Philosophical themes about identity, consciousness
      - Balance exposition with character development`
  },
  detective: {
    name: 'Detective Noir',
    description: 'Hard-boiled detective, femme fatales, urban grit',
    promptTemplate: `Write in detective noir style.
      - First-person cynical narrator
      - Atmospheric urban settings (rain, shadows)
      - Snappy, world-weary dialogue
      - Moral ambiguity and corruption
      - Slow revelation of mystery`
  },
  romance: {
    name: 'Romance',
    description: 'Emotional depth, relationship tension, happy endings',
    promptTemplate: `Write romantic fiction.
      - Focus on emotional connection between characters
      - Build romantic tension through obstacles
      - Rich internal emotional landscape
      - Satisfying romantic resolution`
  },
  adventure: {
    name: 'Adventure',
    description: 'Action, exploration, exotic locations, heroic deeds',
    promptTemplate: `Write adventure fiction.
      - Fast-paced action sequences
      - Exotic, dangerous locations
      - Clear protagonist with admirable qualities
      - Escalating challenges and narrow escapes`
  },
  comedy: {
    name: 'Comedy',
    description: 'Humor, wit, absurd situations, wordplay',
    promptTemplate: `Write comedic fiction.
      - Witty dialogue and wordplay
      - Absurd situations escalating logically
      - Character quirks and misunderstandings
      - Light, entertaining tone`
  },
  custom: {
    name: 'Custom Style',
    description: 'User-defined style based on description',
    promptTemplate: '{user_style_description}'
  }
};

// Story types
export const STORY_TYPES = {
  narrative: { name: 'Linear Story', description: 'Traditional narrative from beginning to end' },
  cyoa: { name: 'Choose Your Own Adventure', description: 'Interactive with branching choices' },
  campaign: { name: 'Campaign/RPG', description: 'D&D-style collaborative adventure' }
};

// Default voices (deep British/American males as requested)
// Voice IDs imported from constants/voices.js for consistency
export const DEFAULT_VOICES = {
  primary: DEFAULT_NARRATOR_VOICE_ID,  // George - British, warm, narrative
  dramatic: 'onwK4e9ZLuTAKqWW03F9',    // Daniel - British, formal
  american: 'nPczCjzI2devNBz1zQrb',    // Brian - American, resonant
  deep: DM_VOICE_ID                     // Callum - Deep, gravelly (authority figures, villains)
};

// Voice preview samples for different styles
// Using VOICE_IDS from constants/voices.js where applicable
export const VOICE_PREVIEWS = {
  george: {
    id: VOICE_IDS.GEORGE,
    name: 'George',
    description: 'Deep British male, warm and authoritative',
    sampleText: 'In the heart of the ancient forest, where shadows dance with light, our tale begins.',
    bestFor: ['fantasy', 'tolkien', 'bedtime', 'drama']
  },
  brian: {
    id: 'nPczCjzI2devNBz1zQrb',
    name: 'Brian',
    description: 'American resonant male, versatile storyteller',
    sampleText: 'The city never sleeps, and neither do its secrets. Tonight, we uncover the truth.',
    bestFor: ['detective', 'king', 'scifi', 'adventure']
  },
  callum: {
    id: VOICE_IDS.CALLUM,
    name: 'Callum',
    description: 'Deep gravelly voice, perfect for dark tales',
    sampleText: 'They say some doors should never be opened. But curiosity has always been my weakness.',
    bestFor: ['horror', 'lovecraft', 'mystery', 'noir']
  },
  daniel: {
    id: 'onwK4e9ZLuTAKqWW03F9',
    name: 'Daniel',
    description: 'British formal, theatrical delivery',
    sampleText: 'To be or not to be, that is the question that haunts every mortal soul.',
    bestFor: ['shakespeare', 'drama', 'epic', 'romance']
  },
  charlotte: {
    id: 'XB0fDUnXU5powFXDhCwa',
    name: 'Charlotte',
    description: 'Warm female voice, gentle and soothing',
    sampleText: 'Close your eyes, little one, and let me take you on a magical journey.',
    bestFor: ['bedtime', 'fairytale', 'children', 'romance']
  },
  aria: {
    id: '9BWtsMINqrJLrRacOk9x',
    name: 'Aria',
    description: 'Expressive female, playful and dynamic',
    sampleText: 'Oh my goodness, you will not believe what happened next! It was absolutely wild!',
    bestFor: ['comedy', 'adventure', 'playful', 'whimsical']
  }
};

// All available ElevenLabs voices for comprehensive assignment
// Using VOICE_IDS from constants/voices.js where applicable
export const ALL_VOICES = {
  // Male voices
  george: { id: VOICE_IDS.GEORGE, name: 'George', gender: 'male', style: 'warm_british', age: 'adult' },
  brian: { id: 'nPczCjzI2devNBz1zQrb', name: 'Brian', gender: 'male', style: 'american_deep', age: 'adult' },
  callum: { id: VOICE_IDS.CALLUM, name: 'Callum', gender: 'male', style: 'gravelly_dark', age: 'adult' },
  daniel: { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'male', style: 'british_formal', age: 'adult' },
  adam: { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', gender: 'male', style: 'deep_resonant', age: 'adult' },
  antoni: { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', gender: 'male', style: 'warm_elderly', age: 'elderly' },
  josh: { id: 'TxGEqnHWrfWFTfGW9XjX', name: 'Josh', gender: 'male', style: 'soothing_male', age: 'adult' },
  arnold: { id: 'VR6AewLTigWG4xSOukaG', name: 'Arnold', gender: 'male', style: 'authoritative', age: 'adult' },
  sam: { id: 'yoZ06aMxZJJ28mfd3POQ', name: 'Sam', gender: 'neutral', style: 'clear_neutral', age: 'adult' },
  // Female voices
  charlotte: { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', style: 'warm_soothing', age: 'adult' },
  aria: { id: '9BWtsMINqrJLrRacOk9x', name: 'Aria', gender: 'female', style: 'playful_dynamic', age: 'young_adult' },
  rachel: { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female', style: 'calm_warm', age: 'adult' },
  domi: { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', gender: 'female', style: 'confident_strong', age: 'young_adult' },
  bella: { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', gender: 'female', style: 'soft_gentle', age: 'adult' },
  elli: { id: 'MF3mGyEYCl7XYWbV9V6O', name: 'Elli', gender: 'female', style: 'young_energetic', age: 'young_adult' }
};

// NOTE: D&D-specific voice assignments removed (2026-01-15) - DnD mode moved to separate GameMaster project

// Character voice suggestions based on storytelling archetypes
export const CHARACTER_VOICE_SUGGESTIONS = {
  protagonist_male: [ALL_VOICES.brian.id, ALL_VOICES.george.id, ALL_VOICES.josh.id],
  protagonist_female: [ALL_VOICES.domi.id, ALL_VOICES.charlotte.id, ALL_VOICES.aria.id],
  antagonist: [ALL_VOICES.callum.id, ALL_VOICES.daniel.id, ALL_VOICES.arnold.id],
  antagonist_female: [ALL_VOICES.domi.id, ALL_VOICES.charlotte.id, ALL_VOICES.aria.id],
  mentor: [ALL_VOICES.george.id, ALL_VOICES.antoni.id, ALL_VOICES.daniel.id],
  mentor_female: [ALL_VOICES.charlotte.id, ALL_VOICES.domi.id, ALL_VOICES.aria.id],
  sidekick: [ALL_VOICES.aria.id, ALL_VOICES.elli.id, ALL_VOICES.sam.id],
  sidekick_female: [ALL_VOICES.aria.id, ALL_VOICES.elli.id, ALL_VOICES.charlotte.id],
  supporting_male: [ALL_VOICES.brian.id, ALL_VOICES.josh.id, ALL_VOICES.sam.id],
  supporting_female: [ALL_VOICES.aria.id, ALL_VOICES.elli.id, ALL_VOICES.charlotte.id],
  narrator: [ALL_VOICES.george.id, ALL_VOICES.callum.id, ALL_VOICES.daniel.id],
  authority: [ALL_VOICES.callum.id, ALL_VOICES.arnold.id, ALL_VOICES.daniel.id]  // Kings, judges, commanders
};

// Conversation flow steps
const CONVERSATION_STEPS = {
  1: 'story_type',           // narrative, cyoa, campaign
  2: 'multiplayer_check',    // solo or with others (for campaign)
  3: 'participants',         // who's playing (for multiplayer)
  4: 'literary_style',       // author/genre style
  5: 'custom_style_desc',    // if custom, get description
  6: 'narrator_voice',       // which voice to use
  7: 'narrator_style',       // dramatic, playful, etc
  8: 'voice_preview',        // play sample of voice+style
  9: 'story_details',        // genre, characters, setting
  10: 'story_length',        // short, medium, long, epic
  11: 'intensity',           // content intensity level
  12: 'multi_voice',         // use different voices for characters?
  13: 'summary_confirm',     // summarize and confirm
  14: 'story_name',          // suggest name, allow change
  15: 'start'                // begin the story
};

export class ConversationEngine {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.session = null;
    this.conversationHistory = [];
  }

  async loadSession() {
    const result = await pool.query(
      'SELECT * FROM story_sessions WHERE id = $1',
      [this.sessionId]
    );
    this.session = result.rows[0];
    return this.session;
  }

  /**
   * Process user input and return AI response with config updates
   */
  async processInput(input, step, currentConfig) {
    await this.loadSession();

    const systemPrompt = this.buildSystemPrompt(step, currentConfig);

    const messages = [
      { role: 'system', content: systemPrompt },
      ...this.conversationHistory.slice(-8),
      { role: 'user', content: input }
    ];

    try {
      const aiResponse = await completion({
        messages,
        model: getUtilityModel(),
        response_format: { type: 'json_object' },
        max_tokens: 500,
        agent_name: 'conversation_engine',
        sessionId: this.sessionId
      });

      let result;
      try {
        result = parseJsonResponse(aiResponse.content);
      } catch (e) {
        logger.error('Failed to parse conversation response:', e);
        result = {
          response: "I didn't quite understand that. Could you rephrase?",
          config_updates: {},
          next_step: step
        };
      }

      // Use SmartConfig to detect additional settings the AI might miss (sfx_level, multi_narrator, etc.)
      try {
        const smartAnalysis = smartConfig.analyzeKeywords(input.toLowerCase());

        // Merge SmartConfig detected settings into config_updates
        if (smartAnalysis.sfx_level) {
          result.config_updates = result.config_updates || {};
          result.config_updates.sfx_level = smartAnalysis.sfx_level;
          result.config_updates.sfx_enabled = true;
          logger.info(`[ConversationEngine] SmartConfig detected sfx_level: ${smartAnalysis.sfx_level}`);
        }
        if (smartAnalysis.sfx_enabled && !result.config_updates?.sfx_enabled) {
          result.config_updates = result.config_updates || {};
          result.config_updates.sfx_enabled = true;
        }
        if (smartAnalysis.multi_narrator) {
          result.config_updates = result.config_updates || {};
          result.config_updates.multi_narrator = true;
          logger.info('[ConversationEngine] SmartConfig detected multi_narrator request');
        }
        if (smartAnalysis.story_length && !result.config_updates?.story_length) {
          result.config_updates = result.config_updates || {};
          result.config_updates.story_length = smartAnalysis.story_length;
        }
        if (smartAnalysis.bedtime_mode) {
          result.config_updates = result.config_updates || {};
          result.config_updates.bedtime_mode = true;
        }
      } catch (smartErr) {
        logger.warn('[ConversationEngine] SmartConfig analysis failed:', smartErr.message);
      }

      // Store conversation turn
      this.conversationHistory.push({ role: 'user', content: input });
      this.conversationHistory.push({ role: 'assistant', content: result.response });

      // Log to database
      await pool.query(`
        INSERT INTO conversation_turns (story_session_id, role, modality, content)
        VALUES ($1, 'user', 'voice', $2), ($1, 'assistant', 'voice', $3)
      `, [this.sessionId, input, result.response]);

      // Update session config if we have updates
      if (result.config_updates && Object.keys(result.config_updates).length > 0) {
        const existingConfig = this.session?.config_json || {};
        const newConfig = { ...existingConfig, ...result.config_updates };

        await pool.query(
          'UPDATE story_sessions SET config_json = $1, last_activity_at = NOW() WHERE id = $2',
          [JSON.stringify(newConfig), this.sessionId]
        );
      }

      // Determine if ready to start
      if (result.next_step >= 15 || result.start_story) {
        result.start_story = true;
      }

      return result;

    } catch (error) {
      logger.error('Conversation processing error:', error);
      throw error;
    }
  }

  buildSystemPrompt(step, currentConfig) {
    const stepName = CONVERSATION_STEPS[step] || 'story_type';

    return `You are a warm, friendly storyteller helping configure a story through conversation.
This is a versatile storytelling platform - NOT just bedtime stories. You can create ANY kind of story:
- Horror (Stephen King, Lovecraft)
- Epic Fantasy (Tolkien)
- Sword & Sorcery (Robert E. Howard)
- Shakespeare-style drama
- Science Fiction
- Detective Noir
- Romance
- Children's stories
- Calm stories (low-intensity)
- And more!

CURRENT STEP: ${stepName} (step ${step})
CURRENT CONFIG: ${JSON.stringify(currentConfig)}

CONVERSATION GUIDELINES:
- Keep responses SHORT (1-3 sentences) since you're speaking aloud
- Be conversational and warm but efficient
- Extract preferences from natural language
- Play voice samples when selecting voices/styles
- For multiplayer/campaign, ask for participant names

STEP-SPECIFIC INSTRUCTIONS:

Step 1 (story_type): Ask if they want:
- "Regular story" / "narrative" → narrative
- "Choose your own adventure" / "CYOA" / "interactive" → cyoa
- "Campaign" / "D&D" / "RPG" / "adventure with friends" → campaign
Make CYOA and Campaign sound exciting! Mention multiplayer for campaign.

Step 2 (multiplayer_check): For campaign type, ask if playing alone or with others.

Step 3 (participants): If multiplayer, ask for names of each player.

Step 4 (literary_style): Ask what style/author they like. Options:
${Object.entries(LITERARY_STYLES).map(([k, v]) => `- ${v.name}`).join('\n')}
Explain a few options conversationally.

Step 5 (custom_style_desc): If they chose custom, get their description.

Step 6 (narrator_voice): Offer to play different voice samples. Mention:
- Deep British male (George) - great for fantasy/drama
- American resonant (Brian) - great for modern stories
- Deep gravelly (Callum) - great for horror/mystery
Say "I can play samples for you!"

Step 7 (narrator_style): Ask about delivery style:
- Dramatic (theatrical, epic)
- Mysterious (dark, intriguing)
- Playful (fun, whimsical)
- Warm (gentle, soothing)
- Horror (tense, unsettling)
- Epic (grand, sweeping)
Offer to demonstrate each style.

Step 8 (voice_preview): Play the chosen voice+style combination. Ask if they like it.

Step 9 (story_details): Ask about:
- Genre/themes they want
- Any specific characters
- Setting or world
- Mood they're looking for

Step 10 (story_length): Ask how long:
- Short (~5 min, 1-2 scenes)
- Medium (~15 min, 4-6 scenes)
- Long (~30 min, 8-12 scenes)
- Epic (~60+ min, ongoing campaign)

Step 11 (intensity): For horror/mature content, ask about intensity (1-10 scale).
Skip for children's/calm stories.

Step 12 (multi_voice): Ask if they want different voices for different characters.
This is great for dialogue-heavy stories!

Step 13 (summary_confirm): Summarize ALL their choices and ask to confirm:
"So you want a [type] story in the style of [style], with [voice] as narrator in [style] mode,
about [details], running about [length]. Sound good?"

Step 14 (story_name): Suggest a creative name for their story based on their choices.
Let them change it if they want.

Step 15 (start): Say something exciting like "Let's begin!" and set start_story: true

RESPONSE FORMAT (JSON):
{
  "response": "Your spoken response (SHORT!)",
  "config_updates": {
    "storyType": "narrative|cyoa|campaign",
    "literaryStyle": "howard|lovecraft|tolkien|king|etc",
    "voice_id": "elevenlabs_voice_id_string",
    "narratorStyle": "dramatic|playful|mysterious|warm|etc",
    "genre": "fantasy|horror|scifi|etc",
    "setting": "description",
    "characters": ["character descriptions"],
    "mood": "description",
    "length": "short|medium|long|epic",
    "intensity": 1-10,
    "multiVoice": true|false,
    "multiplayer": true|false,
    "participants": [{"name": "Sarah"}, {"name": "John"}],
    "storyName": "The Story Name",
    "customStyleDesc": "user's custom style description"
  },
  "next_step": ${step + 1},
  "action": "play_voice_preview|null",
  "voice_id": "voice_id_if_preview",
  "style_settings": { "stability": 0.5, "style": 50 },
  "ready_to_start": false,
  "start_story": false
}

Only include config_updates for values that were actually extracted from the user's input.
Advance next_step when appropriate based on conversation flow.
If user says "skip" or similar, move to next step.
If user is clearly ready to start, jump to step 13 (summary).`;
  }
}

// Re-export author styles for convenience
export { AUTHOR_STYLES, AUTHOR_STYLES_LIST, getAuthorStyle };

export default ConversationEngine;
