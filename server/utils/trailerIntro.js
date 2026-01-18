/**
 * Trailer-style Intro Generator
 * Creates cinematic movie trailer voiceovers for story introductions
 * Uses ElevenLabs V3 audio tags for dramatic pauses and emotion
 */

import { logger } from './logger.js';

/**
 * Build a cinematic movie trailer-style intro narration
 * Uses ElevenLabs V3 audio tags for dramatic pauses and emotion
 * @param {string} title - Story title
 * @param {string} synopsis - Story synopsis
 * @param {Object} config - Session config with genres, mood, author_style
 * @returns {string} Dramatic intro text with audio tags
 */
export function buildTrailerIntro(title, synopsis, config = {}) {
  // Extract config values with defaults
  const genres = config.genres || {};
  const mood = config.mood || 'exciting';
  const authorStyle = config.author_style || 'none';
  const audience = config.audience || 'general';

  // Find dominant genre (highest weight)
  const genreEntries = Object.entries(genres).filter(([, v]) => v > 0);
  genreEntries.sort((a, b) => b[1] - a[1]);
  const dominantGenre = genreEntries[0]?.[0] || 'fantasy';

  // Era/tone based on author style
  const authorTones = {
    // Horror & Gothic
    lovecraft: { era: 'eldritch', opener: 'In the cosmic abyss of forgotten ages', closer: 'And so... the unspeakable begins.' },
    king: { era: 'modern-horror', opener: 'In a small town where nightmares are real', closer: 'Now... face what lurks in the dark.' },
    poe: { era: 'gothic', opener: 'Within these shadowed halls of madness', closer: 'Thus begins... the descent.' },

    // Epic Fantasy
    tolkien: { era: 'mythic', opener: 'In an age of wonder and peril', closer: 'And so begins... a tale for the ages.' },
    martin: { era: 'gritty-fantasy', opener: 'In a realm where honor is currency and betrayal is cheap', closer: 'When you play the game... you win or you die.' },
    sanderson: { era: 'epic', opener: 'In a world bound by laws of magic', closer: 'The storm is coming... and nothing will be the same.' },
    jordan: { era: 'epic-prophecy', opener: 'The Wheel of Time turns, and ages come and pass', closer: 'The prophecy awakens... and destiny calls.' },
    rothfuss: { era: 'lyrical', opener: 'Listen, and I will tell you a story', closer: 'This is a story you have never heard... until now.' },
    hobb: { era: 'character', opener: 'In a world where bonds shape destiny', closer: 'And so... the journey begins.' },
    gaiman: { era: 'mythic-modern', opener: 'In the spaces between worlds', closer: 'Dreams and reality... are about to collide.' },
    pratchett: { era: 'satirical', opener: 'On a world carried by elephants on a turtle', closer: 'And now... the madness begins.' },

    // Science Fiction
    asimov: { era: 'golden-age', opener: 'Across the vast expanse of the galaxy', closer: 'The future... is now written.' },
    herbert: { era: 'philosophical-sf', opener: 'On the desert planet where spice flows', closer: 'Fear is the mind-killer... but this story is the mind-awakener.' },
    clarke: { era: 'transcendent', opener: 'Beyond the edge of known space', closer: 'The universe... has plans of its own.' },
    dick: { era: 'paranoid', opener: 'In a world where reality bends', closer: 'What is real? You are about to find out.' },
    banks: { era: 'space-opera', opener: 'In the vast playground of post-scarcity civilization', closer: 'The Culture awaits... and so does chaos.' },
    leguin: { era: 'anthropological', opener: 'On a world shaped by different truths', closer: 'The balance shifts... and nothing remains unchanged.' },
    heinlein: { era: 'competent-hero', opener: 'In a future forged by the bold', closer: 'Adventure awaits... for those who dare.' },
    bradbury: { era: 'poetic-sf', opener: 'In a tomorrow painted with wonder and warning', closer: 'The story unfolds... like autumn leaves.' },
    butler: { era: 'survival', opener: 'In a world where adaptation is everything', closer: 'Survival demands... transformation.' },
    vonnegut: { era: 'absurdist', opener: 'So it goes, in this strange world of ours', closer: 'And so... it begins.' },
    orwell: { era: 'dystopian', opener: 'In a world where truth is power', closer: 'Big Brother is watching... and so are you.' },

    // Classic Literature
    austen: { era: 'regency', opener: 'In the elegant drawing rooms of society', closer: 'And so... a most peculiar tale unfolds.' },
    dickens: { era: 'victorian', opener: 'In an age of industry and inequity', closer: 'This is a story of redemption... and of reckoning.' },
    shakespeare: { era: 'elizabethan', opener: 'All the world is but a stage', closer: 'The players are set... let the drama begin.' },
    hemingway: { era: 'sparse', opener: 'The world breaks everyone', closer: 'And now... the story.' },
    fitzgerald: { era: 'jazz-age', opener: 'In an age of glittering excess', closer: 'So we beat on... boats against the current.' },
    dostoevsky: { era: 'psychological', opener: 'In the depths of the human soul', closer: 'The mind reveals... its darkest truths.' },
    tolstoy: { era: 'epic-realism', opener: 'All of life, in all its breadth', closer: 'The human story... continues.' },
    wilde: { era: 'wit', opener: 'In a world obsessed with surfaces', closer: 'The truth... is rarely pure and never simple.' },
    twain: { era: 'american', opener: 'Down by the river where adventure waits', closer: 'The tale begins... like all good tales do.' },

    // Adventure & Mystery
    dumas: { era: 'swashbuckling', opener: 'In an age of swords and honor', closer: 'All for one... and one for glory.' },
    stevenson: { era: 'adventure', opener: 'On the high seas where fortune favors the bold', closer: 'Adventure calls... will you answer?' },
    christie: { era: 'mystery', opener: 'Behind closed doors, secrets wait', closer: 'The game is afoot... let the mystery unfold.' },

    // Sword & Sorcery
    howard: { era: 'barbaric', opener: 'In an age undreamed of', closer: 'By steel and sinew... the saga begins.' },
    moorcock: { era: 'multiverse', opener: 'Across the infinite planes of existence', closer: 'The Eternal Champion... rides again.' },

    // Magical Realism
    marquez: { era: 'magical', opener: 'In a place where magic is mundane', closer: 'A hundred years of solitude... await.' },
    kafka: { era: 'absurd', opener: 'One morning, the impossible became real', closer: 'The transformation... has begun.' },

    // Modernist
    woolf: { era: 'stream', opener: 'In the flowing river of consciousness', closer: 'Time passes... and the story flows on.' },
    faulkner: { era: 'southern', opener: 'The past is never dead', closer: 'It is not even past... and so we begin.' },
    nabokov: { era: 'aesthetic', opener: 'In the elaborate patterns of memory', closer: 'The game of words... begins.' },

    // Default modern style
    none: { era: 'modern', opener: 'Prepare yourself for a journey', closer: 'Your story... begins now.' },
    modern: { era: 'modern', opener: 'Prepare yourself for a journey', closer: 'Your story... begins now.' }
  };

  // Genre-specific emotional tones for V3 audio tags
  const genreTones = {
    horror: { emotion: 'ominous', tension: 'high', tag: '[suspenseful]' },
    fantasy: { emotion: 'wonder', tension: 'building', tag: '[epic]' },
    scifi: { emotion: 'awe', tension: 'building', tag: '[dramatic]' },
    mystery: { emotion: 'intrigue', tension: 'building', tag: '[mysterious]' },
    romance: { emotion: 'warmth', tension: 'gentle', tag: '[heartfelt]' },
    adventure: { emotion: 'excitement', tension: 'building', tag: '[exciting]' },
    humor: { emotion: 'playful', tension: 'light', tag: '[playful]' },
    fairytale: { emotion: 'wonder', tension: 'gentle', tag: '[whimsical]' }
  };

  // Mood-based pacing
  const moodPacing = {
    calm: { pauseLength: '1.5s', intensity: 'gentle' },
    exciting: { pauseLength: '0.8s', intensity: 'dynamic' },
    scary: { pauseLength: '2s', intensity: 'tense' },
    funny: { pauseLength: '0.5s', intensity: 'light' },
    mysterious: { pauseLength: '1.8s', intensity: 'suspenseful' },
    dramatic: { pauseLength: '1.2s', intensity: 'powerful' }
  };

  // Get styling based on config
  const authorTone = authorTones[authorStyle] || authorTones.none;
  const genreTone = genreTones[dominantGenre] || genreTones.fantasy;
  const pacing = moodPacing[mood] || moodPacing.exciting;

  // Build the dramatic intro with V3 audio tags
  let intro = '';

  // Opening - use author's era-appropriate opener or genre default
  if (authorTone.opener) {
    intro += `${genreTone.tag} ${authorTone.opener}. [pause:${pacing.pauseLength}] `;
  }

  // Title announcement with dramatic pause
  if (title) {
    // Clean title of any existing punctuation at end for consistent formatting
    const cleanTitle = title.replace(/[.!?]+$/, '');
    intro += `[dramatic] ${cleanTitle}. [pause:1s] `;
  }

  // Synopsis with appropriate emotion
  if (synopsis) {
    // Split synopsis into sentences for better pacing
    const sentences = synopsis.split(/(?<=[.!?])\s+/).filter(s => s.trim());

    if (sentences.length > 0) {
      // First sentence with building tension
      intro += `${sentences[0]} `;

      // Middle sentences with shorter pauses
      if (sentences.length > 1) {
        intro += `[pause:0.5s] `;
        for (let i = 1; i < sentences.length - 1 && i < 3; i++) {
          intro += `${sentences[i]} `;
        }
      }

      // Last sentence of synopsis if different from first
      if (sentences.length > 1) {
        intro += `[pause:0.8s] ${sentences[sentences.length - 1]} `;
      }
    }
  }

  // Dramatic transition pause
  intro += `[pause:${pacing.pauseLength}] `;

  // Closer - author-style appropriate ending
  intro += `[dramatic] ${authorTone.closer}`;

  // Children's audience: softer tags
  if (audience === 'children') {
    intro = intro.replace(/\[dramatic\]/g, '[gentle]')
                 .replace(/\[ominous\]/g, '[mysterious]')
                 .replace(/\[suspenseful\]/g, '[curious]');
  }

  logger.debug(`[TrailerIntro] Built intro | author: ${authorStyle} | genre: ${dominantGenre} | mood: ${mood} | length: ${intro.length}`);

  return intro;
}

/**
 * Build a simple intro for cases where V3 tags aren't supported
 * @param {string} title - Story title
 * @param {string} synopsis - Story synopsis
 * @returns {string} Simple intro text without tags
 */
export function buildSimpleIntro(title, synopsis) {
  let intro = '';
  if (title) intro += title + '. ';
  if (synopsis) intro += synopsis + '. ';
  intro += 'And now, our story begins.';
  return intro;
}
