/**
 * OpenAI Realtime API Service for Storyteller
 * Handles voice conversation for story configuration
 */

import WebSocket from 'ws';
import { logger } from '../utils/logger.js';
import { pool } from '../database/pool.js';
import { AUTHOR_STYLES_LIST } from './authorStyles.js';
import smartConfig from './smartConfig.js';
import { requireSessionOwner } from '../socket/socketAuth.js';
import { completion, parseJsonResponse } from './openai.js';

/**
 * LLM-based conversation config extractor
 * Replaces ALL keyword matching with semantic understanding
 * Uses a single pass to extract all story preferences from conversation
 */
async function extractConfigWithLLM(conversationHistory, sessionId) {
  if (!conversationHistory || conversationHistory.length === 0) {
    logger.warn(`[RTC ${sessionId}] No conversation history for LLM extraction`);
    return null;
  }

  // Format conversation for analysis
  const conversationText = conversationHistory
    .map(m => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n');

  const prompt = `Analyze this story configuration conversation and extract all user preferences.

CONVERSATION:
${conversationText}

Extract ALL of the following from the user's responses (not the AI's questions):

1. GENRE: fantasy, horror, sci-fi, mystery, romance, adventure, comedy, fairy_tale, thriller, or null
2. STORY_TYPE: "narrative" (linear story) or "cyoa" (choose your own adventure/interactive)
3. STORY_FORMAT: picture_book, short_story, novella, novel, or series
4. AUDIENCE: children, general, young_adult, mature, or adult (based on content preferences)
5. LENGTH: short (5-10 min), medium (15-20 min), or long (30+ min)
6. MOOD: scary, exciting, funny, dramatic, calm, mysterious, dark, light, intense, or null
7. VOICE_GENDER: male, female, or null (what narrator gender does the user prefer?)
8. NARRATOR_STYLE: warm, dramatic, playful, mysterious, or null
9. MULTI_VOICE: true (user wants different voices for characters) or false (single narrator)
10. HIDE_SPEECH_TAGS: true (remove "he said", "she asked" when multi-voice) or false
11. SFX_ENABLED: true (user wants sound effects/ambient audio) or false
12. SFX_LEVEL: low (subtle), medium (moderate), or high (immersive) - only if sfx_enabled
13. SPECIFIC_VOICE_NAME: If user mentioned a specific narrator name like "George", "Brian", "Charlotte", "Rachel", "Callum", "Daniel" - otherwise null

Return JSON:
{
  "genre": "...",
  "story_type": "narrative" or "cyoa",
  "cyoa_enabled": true/false,
  "story_format": "...",
  "audience": "...",
  "length": "...",
  "mood": "...",
  "voice_gender": "male"/"female"/null,
  "narrator_style": "...",
  "multi_voice": true/false,
  "hide_speech_tags": true/false,
  "sfx_enabled": true/false,
  "sfx_level": "low"/"medium"/"high"/null,
  "specific_voice_name": "..." or null,
  "reasoning": "Brief explanation of how these were determined"
}

IMPORTANT:
- Only extract preferences the user EXPLICITLY expressed or clearly implied
- Use null for fields with no clear user preference
- Pay attention to context and natural language, not just keywords
- "scary story" implies horror genre AND scary mood
- "bedtime story" implies children audience and calm mood
- "epic adventure" implies long length and exciting mood
- If user says "yes" to multi-voice, set multi_voice: true`;

  try {
    const response = await completion({
      model: 'gpt-5.2-instant', // Fast model for config extraction
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2, // Low temp for consistent extraction
      max_tokens: 500
    });

    const result = parseJsonResponse(response);

    if (result && typeof result === 'object') {
      logger.info(`[RTC ${sessionId}] LLM config extraction successful: ${JSON.stringify(result)}`);
      return result;
    }

    logger.warn(`[RTC ${sessionId}] LLM config extraction returned invalid result`);
    return null;
  } catch (error) {
    logger.error(`[RTC ${sessionId}] LLM config extraction failed:`, error.message);
    return null;
  }
}

// Try the base model name - dated versions may have different capabilities
const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview';

// Build author styles summary for the Story Guide - pick representative authors from each category
const representativeAuthors = ['tolkien', 'howard', 'asimov', 'leguin', 'herbert', 'sanderson', 'martin', 'gaiman', 'pratchett', 'lovecraft', 'king', 'poe', 'shakespeare', 'austen', 'hemingway'];
const authorStylesSummary = AUTHOR_STYLES_LIST
  .filter(a => representativeAuthors.includes(a.id))
  .map(a => `${a.name} (${a.genres.slice(0, 2).join(', ')})`)
  .join(', ');

// Story Guide system instructions
const STORY_GUIDE_INSTRUCTIONS = `You are a friendly British Story Guide helping someone configure their perfect story experience.

CRITICAL: Always speak in English with a British accent. Never switch to other languages.

Your goal is to have a THOROUGH conversation (at least 5-6 exchanges) to understand what kind of story they want. Start by asking about their STORY IDEA first, then help configure all the settings.

=== PHASE 1: STORY IDEA (Start Here!) ===
Begin by asking what story they want to hear. This is the MOST IMPORTANT part!
- "What kind of story would you like? Tell me about the world, characters, or plot you're imagining."
- Help them develop their idea: "That sounds wonderful! Tell me more about [the character/setting/conflict]..."
- Encourage specificity: "Would you like [specific element] or [alternative]?"

Build a complete STORY PREMISE together that captures:
- Main character(s) and their goals
- The setting or world
- The central conflict or adventure
- Any special elements they mention (dragons, magic, spaceships, etc.)

=== PHASE 2: STORY CONFIGURATION ===

REQUIRED QUESTIONS - Ask about ALL of these:

1. STORY TYPE: "Would you like a regular story to listen to, or a choose-your-own-adventure where you make choices that affect the story?"
   (NOTE: Only offer 'narrative' or 'cyoa' story types)

2. GENRE MIX: "What genres should we blend? Fantasy, horror, sci-fi, mystery, romance, adventure, comedy, or fairy tale? We can mix them!"

3. STORY FORMAT & LENGTH:
   - "How long would you like it - a short 5-minute tale, medium 15-minute story, or a longer 30-minute adventure?"
   - "Is this a standalone short story, or part of a longer series?"

4. MOOD & INTENSITY: "What mood should it have - exciting, scary, funny, calm, mysterious, or dramatic?"
   - For mature audiences, ask: "How intense should it be? Family-friendly, or should we push into darker territory with violence or horror?"

5. NARRATOR VOICE (VERY IMPORTANT): "Would you prefer a MALE or FEMALE narrator for your story?"

6. NARRATOR STYLE: "Should the narrator sound warm and soothing, dramatic and theatrical, playful, or mysterious?"

7. MULTI-VOICE NARRATION: "Would you like different voices for different characters? With multi-voice, each character gets their own unique voice - the narrator, the hero, the villain, all sound distinct. Or should one narrator voice all parts?"
   - If they choose multi-voice: "Should I hide the 'he said, she said' speech tags since you'll hear the different voices anyway?"

8. SOUND EFFECTS: "Would you like ambient sound effects - things like footsteps, rain, sword clashes, and atmospheric sounds? I can set them to subtle, moderate, or immersive levels."
   - Options: 'off' (no SFX), 'low' (subtle), 'medium' (moderate), 'high' (immersive)

9. AUTHOR STYLE (OPTIONAL): "Would you like the story written in the style of a famous author? We have classic literature like Shakespeare and Tolkien, sword & sorcery like Robert E. Howard, science fiction masters like Asimov and Herbert, epic fantasy like Sanderson and George R.R. Martin, horror like Lovecraft and Stephen King - or I can write in a modern storytelling style."

AVAILABLE AUTHOR STYLES (mention if asked):
${authorStylesSummary}

VOICE OPTIONS (mention if they ask or seem unsure):
- Male voices: George (deep British, warm), Brian (American storyteller), Callum (gravelly - perfect for horror/dark stories), Daniel (theatrical)
- Female voices: Charlotte (warm British), Rachel (expressive American)
NOTE: You cannot play voice samples during our conversation. If they want to preview voices, tell them: "For voice previews, use Manual Setup in the app where you can listen to each narrator."

=== PHASE 3: VERIFICATION ===

Before creating the story, ALWAYS provide a complete summary and ask for confirmation:

"Let me make sure I have everything right for your story:

📖 STORY: [Summarize their story premise in 1-2 sentences]
🎭 TYPE: [Narrative story / Choose-your-own-adventure]
📚 FORMAT: [Short story / Novella / Novel] - [short/medium/long] length
🎨 GENRE: [Primary genres mentioned]
😊 MOOD: [calm/exciting/scary/funny/mysterious/dramatic]
🎙️ NARRATOR: [MALE/FEMALE] voice - [voice name] - [warm/dramatic/playful/mysterious] style
👥 MULTI-VOICE: [Yes - different voices for characters / No - single narrator]
🔊 SOUND EFFECTS: [Off / Low / Medium / High]
✍️ WRITING STYLE: [Author name or 'modern storytelling']

Does all of this sound right, or would you like to change anything?"

Wait for their confirmation. Only when they confirm, say EXACTLY: "Perfect! Let me create your story now."

=== SURPRISE ME / YOLO MODE ===
If user says "surprise me", "you decide", "random", "dealer's choice", or "YOLO":
- Create an interesting story premise yourself
- Make ALL decisions with variety - pick creative genre combos, mood, length, narrator, multi-voice, SFX level
- Example: "Brilliant! I'll surprise you with a dark fantasy adventure about a cursed knight seeking redemption - medium length, with multi-voice narration so each character sounds unique, immersive sound effects, in the style of George R.R. Martin, with a gravelly male narrator named Callum. Ready?"
- STILL do the full verification summary before proceeding

=== CHOOSE YOUR OWN ADVENTURE NOTES ===
When they choose CYOA/interactive, explain how choices work:
- Say: "With choose-your-own-adventure, you'll make choices using your voice. When options appear, you can say the NUMBER like 'one', 'two', or 'three' - or you can say the KEY WORD from the choice, like 'fight' or 'run' or 'hide'. Either works!"
- Mention: "The first scene will establish the story and characters before you face your first choice."
- Note: "Each choice is designed to be short and easy to say. If you're not sure what to pick, just say 'surprise me' and I'll choose for you!"
- If they ask about going back: "You can tap the history button in the app to revisit previous choices and try a different path."

=== RULES ===
- ALWAYS speak in English. Never use French, Spanish, or other languages.
- Keep responses SHORT (1-2 sentences each) - you're speaking aloud
- Be warm and enthusiastic but thorough
- NEVER rush - ask at least 5 questions before summarizing
- Start with story IDEA first, then move to settings
- ALWAYS include narrator gender (male/female) in your final summary
- ALWAYS do the full verification summary before creating
- Match your energy to their genre (spooky for horror, excited for adventure)
- Never assume bedtime mode unless they say so
- If they ask for a "rough male voice" or "gravelly voice", that's Callum

Remember: Help them develop an exciting story idea first, then configure all the bells and whistles. Get them excited about THEIR story!`;

/**
 * Manages a single realtime conversation session
 */
export class RealtimeConversation {
  constructor(clientSocket, sessionId) {
    this.clientSocket = clientSocket;
    this.sessionId = sessionId;
    this.openaiWs = null;
    this.isConnected = false;
    this.storyConfig = {};
    this.conversationHistory = [];
    this.greetingSent = false;
    this.greetingTimer = null; // Timer for delayed greeting
    this.storyReadyTimer = null; // Timer for story_ready notification
  }

  /**
   * Initialize connection to OpenAI Realtime API
   */
  async connect() {
    return new Promise((resolve, reject) => {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        reject(new Error('OPENAI_API_KEY not configured'));
        return;
      }

      // Log API key prefix for debugging (never log full key!)
      const keyPrefix = apiKey.substring(0, 10) + '...';
      logger.info(`[RTC ${this.sessionId}] Connecting to OpenAI Realtime API with key: ${keyPrefix}`);
      logger.info(`[RTC ${this.sessionId}] URL: ${OPENAI_REALTIME_URL}`);

      this.openaiWs = new WebSocket(OPENAI_REALTIME_URL, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      this.openaiWs.on('open', () => {
        logger.info(`[RTC ${this.sessionId}] Connected to OpenAI`);
        this.isConnected = true;
        this.configureSession();
        resolve();
      });

      this.openaiWs.on('message', (data) => {
        this.handleOpenAIMessage(JSON.parse(data.toString()));
      });

      this.openaiWs.on('error', (error) => {
        logger.error(`[RTC ${this.sessionId}] OpenAI WebSocket error:`, error);
        this.sendToClient({ type: 'error', message: 'Voice service connection error' });
        reject(error);
      });

      this.openaiWs.on('close', () => {
        logger.info(`[RTC ${this.sessionId}] OpenAI connection closed`);
        this.isConnected = false;
      });
    });
  }

  /**
   * Configure the OpenAI session
   */
  configureSession() {
    const config = {
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions: STORY_GUIDE_INSTRUCTIONS,
        voice: 'ash', // Male voice (valid options: alloy, ash, ballad, coral, echo, sage, shimmer, verse, marin, cedar)
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: {
          model: 'whisper-1',
          language: 'en' // Force English transcription
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.6,         // Increased from 0.5 to reduce noise sensitivity
          prefix_padding_ms: 300,
          silence_duration_ms: 700 // Increased from 500 to require longer pauses
        },
        temperature: 0.8,
        max_response_output_tokens: 500
      }
    };

    logger.info(`[RTC ${this.sessionId}] Sending session.update: ${JSON.stringify(config, null, 2)}`);
    this.sendToOpenAI(config);
  }

  /**
   * Handle messages from OpenAI
   */
  handleOpenAIMessage(event) {
    const eventType = event.type;

    // VERBOSE: Log ALL events for debugging (only skip audio delta which is high-frequency)
    if (eventType !== 'response.audio.delta') {
      logger.info(`[RTC ${this.sessionId}] <<< OPENAI EVENT: ${eventType}`);
    }

    switch (eventType) {
      case 'session.created':
        // Log the full session.created event to see default config
        logger.info(`[RTC ${this.sessionId}] SESSION.CREATED full event: ${JSON.stringify(event, null, 2)}`);
        this.sendToClient({
          type: 'rtc_ready',
          message: 'Voice conversation ready'
        });
        break;

      case 'session.updated':
        // Log the full session.updated event
        logger.info(`[RTC ${this.sessionId}] SESSION.UPDATED full event: ${JSON.stringify(event, null, 2)}`);
        // Trigger initial greeting AFTER session is fully configured
        if (!this.greetingSent) {
          this.greetingSent = true;
          // Small delay to ensure session is ready - store timer for cleanup
          this.greetingTimer = setTimeout(() => this.triggerGreeting(), 300);
        }
        break;

      case 'input_audio_buffer.speech_started':
        this.sendToClient({ type: 'user_speaking' });
        break;

      case 'input_audio_buffer.speech_stopped':
        this.sendToClient({ type: 'user_stopped' });
        break;

      case 'conversation.item.input_audio_transcription.completed':
        const userText = event.transcript;
        // NOISE FILTER: Validate transcript before processing
        // User feedback: "RTC reacts to slightest noise and responds as if I made a choice"
        // Require minimum 3 characters and at least one 2+ letter word
        const cleanedText = userText?.trim() || '';
        const isValidTranscript = cleanedText.length >= 3 && /[a-zA-Z]{2,}/.test(cleanedText);

        if (isValidTranscript) {
          logger.info(`[RTC ${this.sessionId}] Valid user transcript: "${cleanedText}"`);
          this.sendToClient({ type: 'user_transcript', text: cleanedText });
          this.conversationHistory.push({ role: 'user', content: cleanedText });
          this.saveConversationTurn('user', cleanedText);
        } else if (cleanedText) {
          logger.info(`[RTC ${this.sessionId}] Ignoring noise/invalid transcript: "${cleanedText}"`);
        }
        break;

      case 'response.audio_transcript.delta':
        this.sendToClient({
          type: 'assistant_transcript_delta',
          delta: event.delta
        });
        break;

      case 'response.audio_transcript.done':
        const assistantText = event.transcript;
        if (assistantText) {
          this.sendToClient({ type: 'assistant_transcript', text: assistantText });
          this.conversationHistory.push({ role: 'assistant', content: assistantText });
          this.saveConversationTurn('assistant', assistantText);

          // Check if ready to start story
          this.checkForStoryStart(assistantText);
        }
        break;

      case 'response.text.delta':
        // Handle text-only response (no audio)
        logger.info(`[RTC ${this.sessionId}] TEXT DELTA: ${event.delta}`);
        this.sendToClient({
          type: 'assistant_transcript_delta',
          delta: event.delta
        });
        break;

      case 'response.text.done':
        // Handle text-only response completion
        const textResponse = event.text;
        logger.info(`[RTC ${this.sessionId}] TEXT DONE: ${textResponse}`);
        if (textResponse) {
          this.sendToClient({ type: 'assistant_transcript', text: textResponse });
          this.conversationHistory.push({ role: 'assistant', content: textResponse });
          this.saveConversationTurn('assistant', textResponse);
          this.checkForStoryStart(textResponse);
        }
        break;

      case 'rate_limits.updated':
        logger.info(`[RTC ${this.sessionId}] RATE LIMITS: ${JSON.stringify(event.rate_limits)}`);
        break;

      case 'response.audio.delta':
        // Forward audio to client
        this.sendToClient({
          type: 'audio',
          audio: event.delta
        });
        break;

      case 'response.audio.done':
        this.sendToClient({ type: 'audio_done' });
        break;

      case 'response.done':
        const resp = event.response || {};
        // Log full response.done event
        logger.info(`[RTC ${this.sessionId}] RESPONSE.DONE full event: ${JSON.stringify(event, null, 2)}`);
        this.sendToClient({ type: 'response_done' });
        break;

      case 'error':
        // Log full error event
        logger.error(`[RTC ${this.sessionId}] ERROR full event: ${JSON.stringify(event, null, 2)}`);
        this.sendToClient({
          type: 'error',
          message: event.error?.message || 'Voice service error'
        });
        break;

      case 'response.created':
        // Log full response.created event
        logger.info(`[RTC ${this.sessionId}] RESPONSE.CREATED full event: ${JSON.stringify(event, null, 2)}`);
        break;

      case 'response.output_item.added':
        logger.info(`[RTC ${this.sessionId}] Output item added: ${JSON.stringify(event.item?.type || 'unknown')}`);
        break;

      case 'conversation.item.created':
        // Log when conversation items are created (including our user message)
        logger.info(`[RTC ${this.sessionId}] CONVERSATION.ITEM.CREATED: ${JSON.stringify(event.item, null, 2)}`);
        break;

      case 'response.content_part.added':
      case 'response.content_part.done':
      case 'response.output_item.done':
      case 'input_audio_buffer.committed':
      case 'input_audio_buffer.cleared':
        // Expected events, no action needed
        break;

      default:
        // Log any unhandled events
        if (eventType) {
          logger.info(`[RTC ${this.sessionId}] Unhandled event: ${eventType}`);
        }
        break;
    }
  }

  /**
   * Check if the assistant indicated story is ready to start
   */
  checkForStoryStart(text) {
    const lower = text.toLowerCase();

    // Look for the specific phrase we told the AI to use
    if (lower.includes('let me create your story') ||
        lower.includes('creating your story') ||
        lower.includes("let's begin your") ||
        lower.includes('starting your story')) {

      logger.info(`[RTC ${this.sessionId}] Story start detected, extracting config...`);

      // Extract story configuration from conversation and WAIT for save to complete
      // Critical fix: saveStoryConfig was not being awaited, causing race condition
      this.extractStoryConfigAndSave().then(() => {
        // Notify client to transition to story AFTER config is saved - store timer for cleanup
        this.storyReadyTimer = setTimeout(() => {
          this.sendToClient({
            type: 'story_ready',
            config: this.storyConfig,
            message: 'Transitioning to your story...'
          });
        }, 2000); // Give audio time to finish
      }).catch(error => {
        logger.error(`[RTC ${this.sessionId}] Failed to extract/save story config:`, error.message);
        this.sendToClient({
          type: 'error',
          message: 'Failed to save story configuration. Please try again.'
        });
      });
    }
  }

  /**
   * Extract config and save to database (async wrapper)
   * Uses LLM-based semantic analysis (primary) with SmartConfig (secondary)
   */
  async extractStoryConfigAndSave() {
    // Step 1: LLM-based extraction - PRIMARY method for all config detection
    // This replaces all keyword-based detection with semantic understanding
    try {
      logger.info(`[RTC ${this.sessionId}] Running LLM-based config extraction...`);
      const llmConfig = await extractConfigWithLLM(this.conversationHistory, this.sessionId);

      if (llmConfig) {
        // Apply LLM results directly to storyConfig
        if (llmConfig.genre) this.storyConfig.genre = llmConfig.genre;
        if (llmConfig.story_type) this.storyConfig.type = llmConfig.story_type;
        if (llmConfig.cyoa_enabled !== undefined) this.storyConfig.cyoa_enabled = llmConfig.cyoa_enabled;
        if (llmConfig.story_format) this.storyConfig.story_format = llmConfig.story_format;
        if (llmConfig.audience) this.storyConfig.audience = llmConfig.audience;
        if (llmConfig.length) this.storyConfig.length = llmConfig.length;
        if (llmConfig.mood) this.storyConfig.mood = llmConfig.mood;
        if (llmConfig.voice_gender) this.storyConfig.voice_gender = llmConfig.voice_gender;
        if (llmConfig.narrator_style) this.storyConfig.narrator_style = llmConfig.narrator_style;
        if (llmConfig.multi_voice !== undefined) this.storyConfig.multi_voice = llmConfig.multi_voice;
        if (llmConfig.hide_speech_tags !== undefined) this.storyConfig.hide_speech_tags = llmConfig.hide_speech_tags;
        if (llmConfig.sfx_enabled !== undefined) {
          this.storyConfig.sfx_enabled = llmConfig.sfx_enabled;
          if (llmConfig.sfx_level) this.storyConfig.sfx_level = llmConfig.sfx_level;
        }
        if (llmConfig.reasoning) {
          this.storyConfig.llm_config_reasoning = llmConfig.reasoning;
        }

        logger.info(`[RTC ${this.sessionId}] LLM config extraction applied successfully`);
      }
    } catch (error) {
      logger.warn(`[RTC ${this.sessionId}] LLM config extraction failed:`, error.message);
    }

    // Step 2: Apply defaults and handle voice assignment (sync operations)
    this.extractStoryConfig();

    // Step 3: SmartConfig AI analysis for additional enrichment (genres, author style, intensity)
    try {
      const userMessages = this.conversationHistory
        .filter(m => m.role === 'user')
        .map(m => m.content)
        .join('. ');

      if (userMessages.length > 20) {
        logger.info(`[RTC ${this.sessionId}] Running SmartConfig AI analysis for enrichment...`);
        const aiResult = await smartConfig.interpretPremise(userMessages, this.storyConfig);

        if (aiResult.success && aiResult.suggestedConfig) {
          const aiConfig = aiResult.suggestedConfig;

          // Only apply AI-detected values if not already set
          if (!this.storyConfig.mood && aiConfig.mood) {
            this.storyConfig.mood = aiConfig.mood;
            logger.info(`[RTC ${this.sessionId}] SmartConfig detected mood: ${aiConfig.mood}`);
          }

          if (!this.storyConfig.author_style && aiConfig.author_style && aiConfig.author_style !== 'none') {
            this.storyConfig.author_style = aiConfig.author_style;
            logger.info(`[RTC ${this.sessionId}] SmartConfig detected author style: ${aiConfig.author_style}`);
          }

          // Merge genres
          if (aiConfig.genres) {
            this.storyConfig.genres = {
              ...aiConfig.genres,
              ...(this.storyConfig.genres || {})
            };
            logger.info(`[RTC ${this.sessionId}] SmartConfig detected genres:`, Object.keys(aiConfig.genres));
          }

          // Merge intensity settings
          if (aiConfig.intensity) {
            this.storyConfig.intensity = {
              ...aiConfig.intensity,
              ...(this.storyConfig.intensity || {})
            };
          }

          // Use AI-recommended narrator style if no explicit preference
          if (!this.storyConfig.narrator_style && aiConfig.narrator_style) {
            this.storyConfig.narrator_style = aiConfig.narrator_style;
            logger.info(`[RTC ${this.sessionId}] SmartConfig recommended narrator style: ${aiConfig.narrator_style}`);
          }

          // Store AI reasoning
          this.storyConfig.smart_config_reasoning = aiResult.reasoning;
        }
      }
    } catch (error) {
      logger.warn(`[RTC ${this.sessionId}] SmartConfig analysis failed:`, error.message);
    }

    await this.saveStoryConfig();
    logger.info(`[RTC ${this.sessionId}] Config saved to database with voice_id: ${this.storyConfig.voice_id}`);
  }

  /**
   * Extract story configuration from conversation history
   * This sync method handles ONLY:
   * - Voice name direct lookup (data mapping)
   * - Character/setting hints (simple regex patterns)
   * - Voice assignment based on LLM results (already populated by extractStoryConfigAndSave)
   * - Setting sensible defaults
   *
   * ALL semantic analysis is done by extractConfigWithLLM() in extractStoryConfigAndSave()
   */
  extractStoryConfig() {
    // Voice mappings (ElevenLabs voice IDs) - pure data lookup
    const voiceNames = {
      'george': { id: 'JBFqnCBsd6RMkjVDRZzb', gender: 'male', style: 'warm' },
      'brian': { id: 'nPczCjzI2devNBz1zQrb', gender: 'male', style: 'dramatic' },
      'callum': { id: 'N2lVS1w4EtoT3dr4eOWO', gender: 'male', style: 'mysterious' },
      'daniel': { id: 'onwK4e9ZLuTAKqWW03F9', gender: 'male', style: 'dramatic' },
      'charlotte': { id: 'XB0fDUnXU5powFXDhCwa', gender: 'female', style: 'warm' },
      'rachel': { id: '21m00Tcm4TlvDq8ikWAM', gender: 'female', style: 'dramatic' }
    };

    // Default voices by gender and style
    const defaultVoices = {
      male: {
        warm: voiceNames.george,
        dramatic: voiceNames.brian,
        playful: voiceNames.brian,
        mysterious: voiceNames.callum,
        default: voiceNames.george
      },
      female: {
        warm: voiceNames.charlotte,
        dramatic: voiceNames.rachel,
        playful: voiceNames.charlotte,
        mysterious: voiceNames.rachel,
        default: voiceNames.charlotte
      }
    };

    // Get user messages for regex patterns (not for keyword matching)
    const userMessages = this.conversationHistory
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' ')
      .toLowerCase();

    // Check for specific voice name mentioned by user (exact name match, not keyword)
    let voiceFound = false;
    for (const [name, voiceInfo] of Object.entries(voiceNames)) {
      if (userMessages.includes(name)) {
        this.storyConfig.voice_id = voiceInfo.id;
        this.storyConfig.voice_name = name;
        this.storyConfig.voice_gender = voiceInfo.gender;
        voiceFound = true;
        logger.info(`[RTC ${this.sessionId}] Found specific voice: ${name} (${voiceInfo.gender})`);
        break;
      }
    }

    // If we have gender from LLM but no specific voice, assign default based on gender and style
    if (!voiceFound && this.storyConfig.voice_gender) {
      const gender = this.storyConfig.voice_gender;
      const style = this.storyConfig.narrator_style || 'default';
      const defaultVoice = defaultVoices[gender][style] || defaultVoices[gender].default;

      this.storyConfig.voice_id = defaultVoice.id;
      this.storyConfig.voice_name = Object.keys(voiceNames).find(k => voiceNames[k].id === defaultVoice.id);
      logger.info(`[RTC ${this.sessionId}] Assigned default ${gender} voice: ${this.storyConfig.voice_name} (style: ${style})`);
    }

    // Final fallback - if still no voice, default to George (male, warm)
    if (!this.storyConfig.voice_id) {
      this.storyConfig.voice_id = voiceNames.george.id;
      this.storyConfig.voice_name = 'george';
      this.storyConfig.voice_gender = 'male';
      logger.info(`[RTC ${this.sessionId}] No voice preference detected, defaulting to George (male)`);
    }

    // Set sensible defaults for any fields not populated by LLM
    if (!this.storyConfig.type) this.storyConfig.type = 'narrative';
    if (this.storyConfig.cyoa_enabled === undefined) this.storyConfig.cyoa_enabled = false;
    if (!this.storyConfig.story_format) this.storyConfig.story_format = 'short_story';
    if (!this.storyConfig.audience) this.storyConfig.audience = 'general';
    if (!this.storyConfig.length) this.storyConfig.length = 'medium';
    if (this.storyConfig.multi_voice === undefined) this.storyConfig.multi_voice = false;
    if (this.storyConfig.hide_speech_tags === undefined) this.storyConfig.hide_speech_tags = false;
    if (this.storyConfig.sfx_enabled === undefined) {
      this.storyConfig.sfx_enabled = true;
      this.storyConfig.sfx_level = 'low';
    }

    // Capture user's raw story request for the planner
    const userStoryRequest = this.conversationHistory
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' ');
    this.storyConfig.story_request = userStoryRequest;

    // Extract character hints using regex patterns (simple pattern matching is acceptable)
    const characterPatterns = [
      /\b(conan|aragorn|frodo|gandalf|harry|hermione|sherlock|watson|dracula|frankenstein)\b/gi,
      /\b(dragon|princess|prince|knight|wizard|witch|warrior|pirate|vampire|werewolf|elf|dwarf|orc|goblin|fairy|demon|angel|ghost|zombie|robot|alien|detective|spy|assassin|thief|merchant|king|queen|emperor|empress)\b/gi,
      /\b(brave|young|old|wise|evil|dark|noble|fallen|lost|wandering|mysterious|ancient)\s+(hero|heroine|warrior|mage|knight|prince|princess|king|queen|stranger|traveler)\b/gi
    ];

    const characterHints = [];
    for (const pattern of characterPatterns) {
      const matches = userMessages.match(pattern);
      if (matches) {
        characterHints.push(...matches.map(m => m.toLowerCase()));
      }
    }
    this.storyConfig.character_hints = [...new Set(characterHints)];
    if (characterHints.length > 0) {
      logger.info(`[RTC ${this.sessionId}] Extracted character hints: ${characterHints.join(', ')}`);
    }

    // Extract setting hints using regex patterns
    const settingPatterns = [
      /\b(forest|castle|dungeon|cave|mountain|ocean|sea|desert|city|village|kingdom|realm|space|planet|ship|island|swamp|jungle|arctic|underground|underwater)\b/gi,
      /\b(medieval|futuristic|modern|ancient|victorian|steampunk|cyberpunk|post-apocalyptic|magical|enchanted|haunted|cursed)\b/gi
    ];

    const settingHints = [];
    for (const pattern of settingPatterns) {
      const matches = userMessages.match(pattern);
      if (matches) {
        settingHints.push(...matches.map(m => m.toLowerCase()));
      }
    }
    this.storyConfig.setting_hints = [...new Set(settingHints)];

    logger.info(`[RTC ${this.sessionId}] Extracted config:`, this.storyConfig);
  }

  /**
   * Save story configuration to database
   */
  async saveStoryConfig() {
    try {
      await pool.query(
        `UPDATE story_sessions
         SET config_json = config_json || $1,
             cyoa_enabled = $2,
             last_activity_at = NOW()
         WHERE id = $3`,
        [
          JSON.stringify(this.storyConfig),
          this.storyConfig.type === 'cyoa',
          this.sessionId
        ]
      );
    } catch (error) {
      logger.error(`[RTC ${this.sessionId}] Failed to save config:`, error);
    }
  }

  /**
   * Save conversation turn to database
   */
  async saveConversationTurn(role, content) {
    try {
      await pool.query(`
        INSERT INTO conversation_turns (story_session_id, role, modality, content)
        VALUES ($1, $2, 'voice', $3)
      `, [this.sessionId, role, content]);
    } catch (error) {
      logger.error(`[RTC ${this.sessionId}] Failed to save turn:`, error);
    }
  }

  /**
   * Trigger initial greeting from the AI
   * NOTE: Based on OpenAI community research, text-only triggers are unreliable.
   * The Realtime API works best with actual audio input.
   * For initial greeting, we try response.create with explicit instructions.
   */
  triggerGreeting() {
    logger.info(`[RTC ${this.sessionId}] Triggering initial greeting (audio-first approach)`);

    // Don't send a text conversation item - the Realtime API is unreliable with text-only
    // Instead, directly request a response with instructions to greet the user
    const responseReq = {
      type: 'response.create',
      response: {
        modalities: ['text', 'audio'],
        instructions: 'Speak in English with a British accent. Greet the user warmly and ask what kind of story they would like to hear today. Keep it brief - just one or two sentences. Say something like "Hello! What kind of story shall we create together today?"',
        voice: 'ash' // Male voice
      }
    };

    logger.info(`[RTC ${this.sessionId}] Sending response.create with greeting instructions`);
    this.sendToOpenAI(responseReq);
  }

  /**
   * Handle audio from client
   */
  handleAudio(audioBase64) {
    if (!this.isConnected || !this.openaiWs) return;

    this.sendToOpenAI({
      type: 'input_audio_buffer.append',
      audio: audioBase64
    });
  }

  /**
   * Handle text input from client (fallback)
   * NOTE: Text-only input is unreliable with Realtime API.
   * We include audio modality in response to maximize reliability.
   */
  handleTextInput(text) {
    if (!this.isConnected || !this.openaiWs) return;

    logger.info(`[RTC ${this.sessionId}] Handling text input: ${text}`);

    this.sendToOpenAI({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }]
      }
    });

    // Request response with both modalities for reliability
    this.sendToOpenAI({
      type: 'response.create',
      response: {
        modalities: ['text', 'audio']
      }
    });
  }

  /**
   * Send message to OpenAI
   */
  sendToOpenAI(message) {
    if (this.openaiWs?.readyState === WebSocket.OPEN) {
      // Log non-audio messages being sent
      if (message.type !== 'input_audio_buffer.append') {
        logger.info(`[RTC ${this.sessionId}] >>> SENDING TO OPENAI: ${message.type}`);
      }
      this.openaiWs.send(JSON.stringify(message));
    } else {
      logger.error(`[RTC ${this.sessionId}] Cannot send to OpenAI - WebSocket not open (state: ${this.openaiWs?.readyState})`);
    }
  }

  /**
   * Send message to client
   */
  sendToClient(message) {
    if (this.clientSocket) {
      this.clientSocket.emit('rtc', message);
    }
  }

  /**
   * Close the connection and cleanup resources
   */
  close() {
    logger.info(`[RTC ${this.sessionId}] Closing connection`);

    // Clear any pending timers to prevent callbacks on destroyed instance
    if (this.greetingTimer) {
      clearTimeout(this.greetingTimer);
      this.greetingTimer = null;
    }
    if (this.storyReadyTimer) {
      clearTimeout(this.storyReadyTimer);
      this.storyReadyTimer = null;
    }

    if (this.openaiWs) {
      this.openaiWs.close();
      this.openaiWs = null;
    }
    this.isConnected = false;
  }
}

// Active RTC sessions
const rtcSessions = new Map();

// FAIL LOUD: Size limit for rtcSessions Map to prevent memory exhaustion
const RTC_SESSIONS_LIMIT = {
  max: 100,  // Maximum concurrent RTC sessions
  warn: 80   // Warn threshold (80%)
};

/**
 * Check if we can add a new RTC session
 * FAIL LOUD: Throws error if at capacity
 */
function canAddRtcSession() {
  const size = rtcSessions.size;

  if (size >= RTC_SESSIONS_LIMIT.max) {
    const error = new Error(
      `CAPACITY EXCEEDED: rtcSessions Map is at capacity (${size}/${RTC_SESSIONS_LIMIT.max}). ` +
      `New RTC session REJECTED to prevent memory exhaustion.`
    );
    logger.error('='.repeat(80));
    logger.error(error.message);
    logger.error('='.repeat(80));
    throw error;
  }

  if (size >= RTC_SESSIONS_LIMIT.warn) {
    logger.warn(`WARNING: rtcSessions approaching capacity: ${size}/${RTC_SESSIONS_LIMIT.max}`);
  }

  return true;
}

/**
 * Setup RTC handlers on socket
 */
export function setupRTCHandlers(socket) {
  // Start RTC conversation
  socket.on('rtc-start', async (data) => {
    const { session_id } = data;

    if (!session_id) {
      socket.emit('rtc', { type: 'error', message: 'session_id required' });
      return;
    }

    const user = await requireSessionOwner(socket, session_id);
    if (!user) return;

    // Close existing RTC session if any
    if (rtcSessions.has(socket.id)) {
      rtcSessions.get(socket.id).close();
    }

    try {
      // FAIL LOUD: Check capacity before adding new session
      canAddRtcSession();

      logger.info(`[RTC] Starting conversation for session ${session_id}`);

      const rtc = new RealtimeConversation(socket, session_id);
      rtcSessions.set(socket.id, rtc);

      socket.emit('rtc', { type: 'rtc_connecting' });

      await rtc.connect();

    } catch (error) {
      logger.error('[RTC] Failed to start:', error);
      socket.emit('rtc', { type: 'error', message: 'Failed to start voice conversation' });
    }
  });

  // Handle audio from client
  socket.on('rtc-audio', (data) => {
    const rtc = rtcSessions.get(socket.id);
    if (rtc) {
      rtc.handleAudio(data.audio);
    }
  });

  // Handle text input (fallback)
  socket.on('rtc-text', (data) => {
    const rtc = rtcSessions.get(socket.id);
    if (rtc) {
      rtc.handleTextInput(data.text);
    }
  });

  // Stop RTC conversation
  socket.on('rtc-stop', async (data) => {
    const rtc = rtcSessions.get(socket.id);
    if (rtc) {
      // FIX: Mark the session as abandoned if user cancels before completing
      // This prevents old/partial sessions from appearing in library
      const sessionId = rtc.sessionId;
      logger.info(`[RTC] Stopping session ${sessionId}`);

      try {
        // Check if story has any scenes - if not, mark as abandoned
        const sceneCount = await pool.query(
          'SELECT COUNT(*) as count FROM story_scenes WHERE story_session_id = $1',
          [sessionId]
        );

        if (parseInt(sceneCount.rows[0].count) === 0) {
          // No scenes generated yet - mark as abandoned
          // Valid status values: 'planning', 'narrating', 'paused', 'waiting_choice', 'finished', 'abandoned'
          await pool.query(
            "UPDATE story_sessions SET current_status = 'abandoned', last_activity_at = NOW() WHERE id = $1 AND current_status = 'planning'",
            [sessionId]
          );
          logger.info(`[RTC] Session ${sessionId} marked as abandoned (no scenes)`);
        }
      } catch (error) {
        logger.error(`[RTC] Failed to cleanup session ${sessionId}:`, error);
      }

      rtc.close();
      rtcSessions.delete(socket.id);
    }
  });

  // Cleanup on disconnect
  socket.on('disconnect', async () => {
    const rtc = rtcSessions.get(socket.id);
    if (rtc) {
      // FIX: Mark session as abandoned on disconnect if no scenes
      const sessionId = rtc.sessionId;
      logger.info(`[RTC] Client disconnected, cleaning up session ${sessionId}`);

      try {
        const sceneCount = await pool.query(
          'SELECT COUNT(*) as count FROM story_scenes WHERE story_session_id = $1',
          [sessionId]
        );

        if (parseInt(sceneCount.rows[0].count) === 0) {
          // Valid status values: 'planning', 'narrating', 'paused', 'waiting_choice', 'finished', 'abandoned'
          await pool.query(
            "UPDATE story_sessions SET current_status = 'abandoned', last_activity_at = NOW() WHERE id = $1 AND current_status = 'planning'",
            [sessionId]
          );
          logger.info(`[RTC] Session ${sessionId} marked as abandoned on disconnect`);
        }
      } catch (error) {
        logger.error(`[RTC] Failed to cleanup session ${sessionId} on disconnect:`, error);
      }

      rtc.close();
      rtcSessions.delete(socket.id);
    }
  });
}

export default { RealtimeConversation, setupRTCHandlers };
