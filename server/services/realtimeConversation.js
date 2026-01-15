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
   (NOTE: Only offer 'narrative' or 'cyoa' - D&D campaigns are configured separately in the app)

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
   * Uses both rule-based extraction AND AI-powered smart config for best results
   */
  async extractStoryConfigAndSave() {
    // Step 1: Rule-based extraction (fast, reliable for explicit mentions)
    this.extractStoryConfig();

    // Step 2: AI-powered analysis for nuanced understanding
    try {
      const userMessages = this.conversationHistory
        .filter(m => m.role === 'user')
        .map(m => m.content)
        .join('. ');

      if (userMessages.length > 20) {
        logger.info(`[RTC ${this.sessionId}] Running SmartConfig AI analysis...`);
        const aiResult = await smartConfig.interpretPremise(userMessages, this.storyConfig);

        if (aiResult.success && aiResult.suggestedConfig) {
          // Merge AI suggestions with rule-based config
          // Rule-based takes priority for explicit mentions (voice, narrator style)
          // AI supplements with inferred settings (mood, genres, author_style)
          const aiConfig = aiResult.suggestedConfig;

          // Only apply AI-detected values if not already set by rules
          if (!this.storyConfig.mood && aiConfig.mood) {
            this.storyConfig.mood = aiConfig.mood;
            logger.info(`[RTC ${this.sessionId}] SmartConfig detected mood: ${aiConfig.mood}`);
          }

          if (!this.storyConfig.author_style && aiConfig.author_style && aiConfig.author_style !== 'none') {
            this.storyConfig.author_style = aiConfig.author_style;
            logger.info(`[RTC ${this.sessionId}] SmartConfig detected author style: ${aiConfig.author_style}`);
          }

          // Merge genres (AI fills in what rule-based might have missed)
          if (aiConfig.genres) {
            this.storyConfig.genres = {
              ...aiConfig.genres,
              ...(this.storyConfig.genres || {})  // Rule-based overrides
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

          // Store AI reasoning for debugging/transparency
          this.storyConfig.smart_config_reasoning = aiResult.reasoning;
        }
      }
    } catch (error) {
      logger.warn(`[RTC ${this.sessionId}] SmartConfig analysis failed, using rule-based only:`, error.message);
    }

    await this.saveStoryConfig();
    logger.info(`[RTC ${this.sessionId}] Config saved to database with voice_id: ${this.storyConfig.voice_id}`);
  }

  /**
   * Extract story configuration from conversation history
   */
  extractStoryConfig() {
    const fullConvo = this.conversationHistory.map(m => m.content).join(' ').toLowerCase();
    // IMPORTANT: For gender detection, only check USER messages to avoid false matches
    // from AI questions like "Would you prefer MALE or FEMALE?"
    const userMessages = this.conversationHistory
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' ')
      .toLowerCase();

    // Extract genre
    const genres = ['fantasy', 'horror', 'sci-fi', 'scifi', 'mystery', 'romance', 'adventure', 'comedy', 'fairy tale', 'thriller'];
    for (const genre of genres) {
      if (fullConvo.includes(genre)) {
        this.storyConfig.genre = genre;
        break;
      }
    }

    // Extract type (only narrative or cyoa - D&D is configured separately in the app)
    if (fullConvo.includes('choose your own') || fullConvo.includes('cyoa') || fullConvo.includes('interactive') || fullConvo.includes('choices')) {
      this.storyConfig.type = 'cyoa';
      this.storyConfig.cyoa_enabled = true;
    } else {
      this.storyConfig.type = 'narrative';
      this.storyConfig.cyoa_enabled = false;
    }

    // Extract story format
    if (fullConvo.includes('picture book') || fullConvo.includes('children') || fullConvo.includes('bedtime')) {
      this.storyConfig.story_format = 'picture_book';
      this.storyConfig.audience = 'children';
    } else if (fullConvo.includes('novel') || fullConvo.includes('long form') || fullConvo.includes('epic length')) {
      this.storyConfig.story_format = 'novel';
    } else if (fullConvo.includes('novella') || fullConvo.includes('novelette')) {
      this.storyConfig.story_format = 'novella';
    } else if (fullConvo.includes('series') || fullConvo.includes('multiple parts') || fullConvo.includes('saga')) {
      this.storyConfig.story_format = 'series';
    } else {
      this.storyConfig.story_format = 'short_story';
    }

    // Extract audience level
    if (fullConvo.includes('mature') || fullConvo.includes('adult') || fullConvo.includes('dark') || fullConvo.includes('violent') || fullConvo.includes('gore')) {
      this.storyConfig.audience = 'mature';
    } else if (fullConvo.includes('family') || fullConvo.includes('kid') || fullConvo.includes('child')) {
      this.storyConfig.audience = 'children';
    } else if (!this.storyConfig.audience) {
      this.storyConfig.audience = 'general';
    }

    // Extract length
    if (fullConvo.includes('short') || fullConvo.includes('quick') || fullConvo.includes('5 minute')) {
      this.storyConfig.length = 'short';
    } else if (fullConvo.includes('long') || fullConvo.includes('30 minute') || fullConvo.includes('epic')) {
      this.storyConfig.length = 'long';
    } else {
      this.storyConfig.length = 'medium';
    }

    // Extract mood
    const moods = ['scary', 'exciting', 'funny', 'dramatic', 'calm', 'mysterious', 'dark', 'light', 'intense'];
    for (const mood of moods) {
      if (fullConvo.includes(mood)) {
        this.storyConfig.mood = mood;
        break;
      }
    }

    // Voice mappings (ElevenLabs voice IDs)
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

    // Extract specific voice name if mentioned (check this FIRST)
    // CRITICAL: Only check USER messages, not fullConvo! The AI mentions voice names
    // like "Charlotte" and "Rachel" in its questions, which would falsely match.
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

    // If no specific voice, extract voice gender preference from USER messages only
    // to avoid matching the AI's question "Would you prefer MALE or FEMALE?"
    if (!voiceFound) {
      // Check for strong male indicators in user messages
      const maleKeywords = [' male', 'male ', 'man ', ' man', 'his voice', ' he ', ' guy', 'gentleman', 'masculine', 'deep voice', 'gravelly', 'rough'];
      const femaleKeywords = ['female', 'woman', 'her voice', 'lady', 'feminine', 'she ', 'soft voice'];

      let maleScore = 0;
      let femaleScore = 0;

      for (const kw of maleKeywords) {
        if (userMessages.includes(kw)) maleScore++;
      }
      for (const kw of femaleKeywords) {
        if (userMessages.includes(kw)) femaleScore++;
      }

      logger.info(`[RTC ${this.sessionId}] Voice gender scores - Male: ${maleScore}, Female: ${femaleScore}`);

      if (maleScore > femaleScore) {
        this.storyConfig.voice_gender = 'male';
        logger.info(`[RTC ${this.sessionId}] Detected male narrator preference from user messages`);
      } else if (femaleScore > maleScore) {
        this.storyConfig.voice_gender = 'female';
        logger.info(`[RTC ${this.sessionId}] Detected female narrator preference from user messages`);
      } else {
        // Default to male if no clear preference (user's preference based on feedback)
        this.storyConfig.voice_gender = 'male';
        logger.info(`[RTC ${this.sessionId}] No clear gender preference, defaulting to male`);
      }
    }

    // Extract narrator style
    if (fullConvo.includes('warm') || fullConvo.includes('gentle') || fullConvo.includes('soothing') || fullConvo.includes('soft')) {
      this.storyConfig.narrator_style = 'warm';
    } else if (fullConvo.includes('dramatic') || fullConvo.includes('theatrical') || fullConvo.includes('epic')) {
      this.storyConfig.narrator_style = 'dramatic';
    } else if (fullConvo.includes('playful') || fullConvo.includes('fun') || fullConvo.includes('whimsical')) {
      this.storyConfig.narrator_style = 'playful';
    } else if (fullConvo.includes('mysterious') || fullConvo.includes('dark') || fullConvo.includes('spooky')) {
      this.storyConfig.narrator_style = 'mysterious';
    }

    // Extract multi-voice narration preference
    // Keywords that indicate wanting multi-voice
    const multiVoiceYes = ['multi-voice', 'multi voice', 'multivoice', 'different voices', 'unique voice',
                           'each character', 'character voices', 'voice act', 'voice-act', 'distinct voices',
                           'separate voices', 'multiple voices', 'yes to multi', 'yes multi'];
    const multiVoiceNo = ['single narrator', 'one narrator', 'one voice', 'same voice', 'no multi',
                          'single voice', 'just one', 'no different'];

    let multiVoiceScore = 0;
    for (const kw of multiVoiceYes) {
      if (fullConvo.includes(kw)) multiVoiceScore++;
    }
    for (const kw of multiVoiceNo) {
      if (fullConvo.includes(kw)) multiVoiceScore--;
    }

    if (multiVoiceScore > 0) {
      this.storyConfig.multi_voice = true;
      logger.info(`[RTC ${this.sessionId}] Multi-voice narration enabled`);

      // Check for hide speech tags preference
      if (fullConvo.includes('hide') && (fullConvo.includes('said') || fullConvo.includes('tag') || fullConvo.includes('speech'))) {
        this.storyConfig.hide_speech_tags = true;
        logger.info(`[RTC ${this.sessionId}] Hide speech tags enabled`);
      } else if (fullConvo.includes('keep') && (fullConvo.includes('said') || fullConvo.includes('tag'))) {
        this.storyConfig.hide_speech_tags = false;
      } else {
        // Default to hiding speech tags when multi-voice is on
        this.storyConfig.hide_speech_tags = true;
      }
    } else if (multiVoiceScore < 0) {
      this.storyConfig.multi_voice = false;
      this.storyConfig.hide_speech_tags = false;
      logger.info(`[RTC ${this.sessionId}] Single narrator mode`);
    } else {
      // Default: multi-voice off unless explicitly requested
      this.storyConfig.multi_voice = false;
      this.storyConfig.hide_speech_tags = false;
    }

    // Extract sound effects preference
    const sfxYes = ['sound effect', 'sound effects', 'sfx', 'ambient', 'atmosphere', 'atmospheric',
                    'footsteps', 'rain sound', 'immersive', 'audio effects', 'background sounds'];
    const sfxNo = ['no sound', 'no sfx', 'no effects', 'quiet', 'just voice', 'voice only', 'no ambient'];

    let sfxScore = 0;
    for (const kw of sfxYes) {
      if (fullConvo.includes(kw)) sfxScore++;
    }
    for (const kw of sfxNo) {
      if (fullConvo.includes(kw)) sfxScore--;
    }

    if (sfxScore > 0) {
      this.storyConfig.sfx_enabled = true;

      // Extract SFX level
      if (fullConvo.includes('immersive') || fullConvo.includes('lots of') || fullConvo.includes('high') || fullConvo.includes('maximum')) {
        this.storyConfig.sfx_level = 'high';
      } else if (fullConvo.includes('moderate') || fullConvo.includes('medium') || fullConvo.includes('some')) {
        this.storyConfig.sfx_level = 'medium';
      } else {
        this.storyConfig.sfx_level = 'low';  // Default to subtle
      }
      logger.info(`[RTC ${this.sessionId}] Sound effects enabled at ${this.storyConfig.sfx_level} level`);
    } else if (sfxScore < 0) {
      this.storyConfig.sfx_enabled = false;
      this.storyConfig.sfx_level = 'off';
      logger.info(`[RTC ${this.sessionId}] Sound effects disabled`);
    } else {
      // Default: SFX enabled at low level
      this.storyConfig.sfx_enabled = true;
      this.storyConfig.sfx_level = 'low';
    }

    // Extract author style (if mentioned)
    const authorKeywords = {
      // Classic Literature
      'shakespeare': 'shakespeare',
      'shakespearean': 'shakespeare',
      'austen': 'austen',
      'jane austen': 'austen',
      'dickens': 'dickens',
      'charles dickens': 'dickens',
      'tolkien': 'tolkien',
      'lord of the rings': 'tolkien',
      'hemingway': 'hemingway',
      'stephen king': 'king',
      'king': 'king',
      'poe': 'poe',
      'edgar allan poe': 'poe',
      'rowling': 'rowling',
      'harry potter': 'rowling',
      'orwell': 'orwell',
      'twain': 'twain',
      'mark twain': 'twain',
      'dostoevsky': 'dostoevsky',
      'tolstoy': 'tolstoy',
      'fitzgerald': 'fitzgerald',
      'great gatsby': 'fitzgerald',
      'wilde': 'wilde',
      'oscar wilde': 'wilde',
      'vonnegut': 'vonnegut',
      'kafka': 'kafka',
      'homer': 'homer',
      'christie': 'christie',
      'agatha christie': 'christie',
      'stevenson': 'stevenson',
      'woolf': 'woolf',
      'marquez': 'marquez',
      'dumas': 'dumas',
      'steinbeck': 'steinbeck',
      'faulkner': 'faulkner',
      'salinger': 'salinger',
      'nabokov': 'nabokov',
      // Sword & Sorcery
      'howard': 'howard',
      'robert e. howard': 'howard',
      'robert howard': 'howard',
      'conan': 'howard',
      'de camp': 'decamp',
      'decamp': 'decamp',
      'l. sprague de camp': 'decamp',
      'sprague de camp': 'decamp',
      'lin carter': 'carter',
      'carter': 'carter',
      'moorcock': 'moorcock',
      'michael moorcock': 'moorcock',
      'elric': 'moorcock',
      'eternal champion': 'moorcock',
      // Science Fiction
      'asimov': 'asimov',
      'isaac asimov': 'asimov',
      'foundation': 'asimov',
      'le guin': 'leguin',
      'leguin': 'leguin',
      'ursula le guin': 'leguin',
      'ursula k. le guin': 'leguin',
      'earthsea': 'leguin',
      'heinlein': 'heinlein',
      'robert heinlein': 'heinlein',
      'herbert': 'herbert',
      'frank herbert': 'herbert',
      'dune': 'herbert',
      'clarke': 'clarke',
      'arthur c. clarke': 'clarke',
      'arthur clarke': 'clarke',
      'bradbury': 'bradbury',
      'ray bradbury': 'bradbury',
      'fahrenheit 451': 'bradbury',
      'martian chronicles': 'bradbury',
      'philip k. dick': 'dick',
      'philip dick': 'dick',
      'pkd': 'dick',
      'butler': 'butler',
      'octavia butler': 'butler',
      'octavia e. butler': 'butler',
      'banks': 'banks',
      'iain banks': 'banks',
      'iain m. banks': 'banks',
      'culture series': 'banks',
      // Epic Fantasy
      'donaldson': 'donaldson',
      'stephen donaldson': 'donaldson',
      'stephen r. donaldson': 'donaldson',
      'thomas covenant': 'donaldson',
      'sanderson': 'sanderson',
      'brandon sanderson': 'sanderson',
      'cosmere': 'sanderson',
      'stormlight': 'sanderson',
      'mistborn': 'sanderson',
      'rothfuss': 'rothfuss',
      'patrick rothfuss': 'rothfuss',
      'name of the wind': 'rothfuss',
      'kingkiller': 'rothfuss',
      'hobb': 'hobb',
      'robin hobb': 'hobb',
      'farseer': 'hobb',
      'assassin': 'hobb',
      'martin': 'martin',
      'george martin': 'martin',
      'george r. r. martin': 'martin',
      'george r.r. martin': 'martin',
      'game of thrones': 'martin',
      'song of ice and fire': 'martin',
      'jordan': 'jordan',
      'robert jordan': 'jordan',
      'wheel of time': 'jordan',
      'gaiman': 'gaiman',
      'neil gaiman': 'gaiman',
      'sandman': 'gaiman',
      'american gods': 'gaiman',
      'pratchett': 'pratchett',
      'terry pratchett': 'pratchett',
      'discworld': 'pratchett',
      // Horror & Weird Fiction
      'lovecraft': 'lovecraft',
      'h.p. lovecraft': 'lovecraft',
      'hp lovecraft': 'lovecraft',
      'cthulhu': 'lovecraft',
      'cosmic horror': 'lovecraft'
    };

    for (const [keyword, styleKey] of Object.entries(authorKeywords)) {
      if (fullConvo.includes(keyword)) {
        this.storyConfig.author_style = styleKey;
        logger.info(`[RTC ${this.sessionId}] Detected author style: ${styleKey}`);
        break;
      }
    }

    // If we have gender but no specific voice, assign default based on gender and style
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

    // CRITICAL: Capture user's raw story request for the planner
    // This ensures specific character requests like "Conan" or "a dragon princess" are passed through
    const userStoryRequest = this.conversationHistory
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' ');
    this.storyConfig.story_request = userStoryRequest;

    // Extract character hints from user messages
    // Look for named characters and character types
    const characterPatterns = [
      // Named characters from famous works
      /\b(conan|aragorn|frodo|gandalf|harry|hermione|sherlock|watson|dracula|frankenstein)\b/gi,
      // Character types
      /\b(dragon|princess|prince|knight|wizard|witch|warrior|pirate|vampire|werewolf|elf|dwarf|orc|goblin|fairy|demon|angel|ghost|zombie|robot|alien|detective|spy|assassin|thief|merchant|king|queen|emperor|empress)\b/gi,
      // Descriptive characters
      /\b(brave|young|old|wise|evil|dark|noble|fallen|lost|wandering|mysterious|ancient)\s+(hero|heroine|warrior|mage|knight|prince|princess|king|queen|stranger|traveler)\b/gi
    ];

    const characterHints = [];
    for (const pattern of characterPatterns) {
      const matches = userMessages.match(pattern);
      if (matches) {
        characterHints.push(...matches.map(m => m.toLowerCase()));
      }
    }

    // Deduplicate and store
    this.storyConfig.character_hints = [...new Set(characterHints)];
    if (characterHints.length > 0) {
      logger.info(`[RTC ${this.sessionId}] Extracted character hints: ${characterHints.join(', ')}`);
    }

    // Extract setting hints
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

    // Note: saveStoryConfig is now called from extractStoryConfigAndSave() async wrapper
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
