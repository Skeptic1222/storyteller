/**
 * Story Templates - Pre-built story configurations for quick start
 * Each template includes outline seeds, character templates, and configuration presets
 */

const STORY_TEMPLATES = {
  // ============================================
  // GENTLE YOUTH ADVENTURES
  // ============================================

  'sleepy-forest': {
    id: 'sleepy-forest',
    name: 'The Quiet Forest',
    description: 'A gentle adventure through a magical forest as the animals settle into the evening glow',
    category: 'children',
    audience: 'children',
    ageRange: '3-8',
    estimatedMinutes: 10,
    tags: ['calm', 'animals', 'nature', 'cozy'],
    thumbnail: '/storyteller/images/templates/sleepy-forest.png',

    config: {
      genre: { fantasy: 0.3, adventure: 0.2, humor: 0.3 },
      intensity: { violence: 0, horror: 0, romance: 0, suspense: 0.1 },
      narratorStyle: 'gentle',
      pacing: 'slow',
      targetLength: 'short',
      cyoaEnabled: false,
      bedtimeMode: true
    },

    outlineSeed: {
      setting: 'A magical forest where fireflies light the paths and flowers glow softly in the moonlight',
      theme: 'The importance of rest and checking in with friends',
      protagonist: {
        name: 'Little Owl',
        role: 'A young owl on their first nighttime flight',
        traits: ['curious', 'kind', 'slightly sleepy']
      },
      hook: 'Little Owl must help all the forest animals find their safe nests before the moon reaches the top of the sky',
      plotPoints: [
        'Little Owl wakes up at sunset and stretches their wings',
        'Meets a bunny family who needs help finding their burrow',
        'Helps a tired deer fawn find its mother',
        'Sings a soft song with the crickets',
        'Returns home as all the forest settles into peaceful rest'
      ]
    },

    characterSeeds: [
      { name: 'Mama Owl', role: 'wise_mentor', traits: ['warm', 'patient', 'loving'] },
      { name: 'Bouncy Bunny', role: 'sidekick', traits: ['energetic', 'friendly', 'getting sleepy'] },
      { name: 'Old Turtle', role: 'sage', traits: ['slow', 'wise', 'very sleepy'] }
    ]
  },

  'dream-cloud': {
    id: 'dream-cloud',
    name: 'The Dream Cloud Express',
    description: 'A magical train made of clouds takes children on a journey through the sky of daydreams',
    category: 'children',
    audience: 'children',
    ageRange: '4-10',
    estimatedMinutes: 15,
    tags: ['dreams', 'imagination', 'magical', 'cozy'],

    config: {
      genre: { fantasy: 0.5, adventure: 0.3, humor: 0.2 },
      intensity: { violence: 0, horror: 0, romance: 0, suspense: 0.1 },
      narratorStyle: 'whimsical',
      pacing: 'gentle',
      targetLength: 'medium',
      cyoaEnabled: true,
      bedtimeMode: true
    },

    outlineSeed: {
      setting: 'A train station in the sky where cloud trains depart for different dream destinations',
      theme: 'The power of imagination and peaceful dreams',
      protagonist: {
        name: 'Star',
        role: 'A child who discovers the secret train station on their pillow',
        traits: ['imaginative', 'brave', 'kind-hearted']
      },
      hook: 'When Star drifts into a daydream, they find a golden ticket that takes them to the Dream Cloud Express',
      plotPoints: [
        'Star discovers a glowing ticket under their pillow',
        'Boards the fluffy cloud train with other dreaming children',
        'Visits the Candy Mountain station',
        'Helps a lost dream find its way home',
        'Returns home just as the sun begins to rise'
      ]
    },

    characterSeeds: [
      { name: 'Conductor Moon', role: 'guide', traits: ['gentle', 'mysterious', 'helpful'] },
      { name: 'Pip the Dream Fox', role: 'sidekick', traits: ['playful', 'loyal', 'clever'] }
    ]
  },

  // ============================================
  // FANTASY ADVENTURES
  // ============================================

  'dragon-apprentice': {
    id: 'dragon-apprentice',
    name: 'The Dragon\'s Apprentice',
    description: 'A young villager discovers they can speak to dragons and must prevent a war',
    category: 'fantasy',
    audience: 'family',
    ageRange: '10+',
    estimatedMinutes: 30,
    tags: ['dragons', 'magic', 'coming-of-age', 'adventure'],

    config: {
      genre: { fantasy: 0.6, adventure: 0.3, mystery: 0.1 },
      intensity: { violence: 0.3, horror: 0.1, romance: 0.1, suspense: 0.4 },
      narratorStyle: 'dramatic',
      pacing: 'moderate',
      targetLength: 'long',
      cyoaEnabled: true,
      bedtimeMode: false
    },

    outlineSeed: {
      setting: 'The kingdom of Valdris, where dragons and humans have been enemies for centuries',
      theme: 'Understanding and communication can bridge any divide',
      protagonist: {
        name: 'Kira',
        role: 'A blacksmith\'s daughter who hears dragon thoughts',
        traits: ['determined', 'empathetic', 'clever', 'stubborn']
      },
      hook: 'When Kira accidentally bonds with a wounded dragon, she discovers both species have been manipulated into war',
      plotPoints: [
        'Kira finds an injured dragon in the forbidden mountains',
        'Discovers her ability to understand dragon speech',
        'Learns of a dark wizard manipulating both sides',
        'Must convince both dragon elders and human kings',
        'Faces the manipulator in a climactic confrontation'
      ]
    },

    characterSeeds: [
      { name: 'Pyraxis', role: 'dragon_companion', traits: ['proud', 'wounded', 'wise'] },
      { name: 'Lord Varen', role: 'antagonist', traits: ['manipulative', 'power-hungry', 'cunning'] },
      { name: 'Elder Thornscale', role: 'dragon_elder', traits: ['ancient', 'suspicious', 'honorable'] }
    ]
  },

  'enchanted-library': {
    id: 'enchanted-library',
    name: 'The Enchanted Library',
    description: 'Every book is a portal to another world, but someone is erasing the stories',
    category: 'fantasy',
    audience: 'family',
    ageRange: '8+',
    estimatedMinutes: 25,
    tags: ['books', 'magic', 'mystery', 'adventure'],

    config: {
      genre: { fantasy: 0.5, mystery: 0.3, adventure: 0.2 },
      intensity: { violence: 0.1, horror: 0.2, romance: 0, suspense: 0.4 },
      narratorStyle: 'mysterious',
      pacing: 'moderate',
      targetLength: 'medium',
      cyoaEnabled: true,
      bedtimeMode: false
    },

    outlineSeed: {
      setting: 'An ancient library where stories come alive and books are doorways to their worlds',
      theme: 'Stories have power, and preserving them preserves hope',
      protagonist: {
        name: 'Theo',
        role: 'A new apprentice librarian with the rare gift of story-walking',
        traits: ['bookish', 'curious', 'brave when needed', 'observant']
      },
      hook: 'Books are going blank, their stories disappearing, and only Theo can enter the dying tales to save them',
      plotPoints: [
        'Theo discovers books turning blank throughout the library',
        'Learns to enter stories through intense focus',
        'Meets characters who know their world is fading',
        'Discovers the Eraser - a being who feeds on forgotten tales',
        'Must restore the stories before reality itself unravels'
      ]
    },

    characterSeeds: [
      { name: 'The Librarian', role: 'mentor', traits: ['ancient', 'mysterious', 'kind'] },
      { name: 'The Eraser', role: 'antagonist', traits: ['hungry', 'forgotten', 'tragic'] },
      { name: 'Rose Red', role: 'story_character', traits: ['brave', 'determined', 'fading'] }
    ]
  },

  // ============================================
  // MYSTERY & THRILLER
  // ============================================

  'lighthouse-mystery': {
    id: 'lighthouse-mystery',
    name: 'The Lighthouse Keeper\'s Secret',
    description: 'A coastal town harbors dark secrets, and the lighthouse holds the key',
    category: 'mystery',
    audience: 'adult',
    ageRange: '16+',
    estimatedMinutes: 35,
    tags: ['mystery', 'coastal', 'secrets', 'atmospheric'],

    config: {
      genre: { mystery: 0.5, suspense: 0.3, drama: 0.2 },
      intensity: { violence: 0.3, horror: 0.3, romance: 0.2, suspense: 0.6 },
      narratorStyle: 'noir',
      pacing: 'measured',
      targetLength: 'long',
      cyoaEnabled: true,
      bedtimeMode: false
    },

    outlineSeed: {
      setting: 'Widow\'s Point, a fog-shrouded coastal town where ships have been mysteriously wrecking for decades',
      theme: 'Some secrets protect us, others destroy us',
      protagonist: {
        name: 'Marlowe',
        role: 'A journalist investigating the latest shipwreck',
        traits: ['persistent', 'haunted by past', 'sharp-minded', 'ethical']
      },
      hook: 'The new lighthouse keeper was found dead on his first night, and the logbook entries make no sense',
      plotPoints: [
        'Marlowe arrives to find the town hostile to outsiders',
        'Discovers a pattern in the shipwrecks spanning 50 years',
        'Finds coded messages in the lighthouse logs',
        'Uncovers a smuggling operation with town officials involved',
        'Must survive when the truth makes Marlowe a target'
      ]
    },

    characterSeeds: [
      { name: 'Sheriff Crane', role: 'ambiguous_ally', traits: ['protective', 'secretive', 'conflicted'] },
      { name: 'Old Martha', role: 'information_source', traits: ['eccentric', 'knowing', 'cryptic'] },
      { name: 'The Harbormaster', role: 'antagonist', traits: ['charming', 'ruthless', 'connected'] }
    ]
  },

  // ============================================
  // ADVENTURE
  // ============================================

  'lost-expedition': {
    id: 'lost-expedition',
    name: 'The Lost Expedition',
    description: 'Searching for a legendary explorer\'s final discovery in uncharted territory',
    category: 'adventure',
    audience: 'family',
    ageRange: '12+',
    estimatedMinutes: 30,
    tags: ['exploration', 'survival', 'treasure', 'jungle'],

    config: {
      genre: { adventure: 0.6, mystery: 0.2, action: 0.2 },
      intensity: { violence: 0.3, horror: 0.2, romance: 0.1, suspense: 0.5 },
      narratorStyle: 'adventurous',
      pacing: 'fast',
      targetLength: 'long',
      cyoaEnabled: true,
      bedtimeMode: false
    },

    outlineSeed: {
      setting: 'The uncharted jungles of South America, following the trail of a Victorian explorer',
      theme: 'The greatest discoveries are about who we become, not what we find',
      protagonist: {
        name: 'Dr. Elena Vasquez',
        role: 'An archaeologist following her great-grandmother\'s maps',
        traits: ['brilliant', 'resourceful', 'driven', 'haunted by family legacy']
      },
      hook: 'Elena\'s great-grandmother vanished searching for a lost city - now Elena has found her final journal',
      plotPoints: [
        'Elena deciphers the coded journal revealing a new route',
        'Assembles a team including a rival who wants the discovery',
        'Faces natural dangers and ancient traps',
        'Discovers her great-grandmother\'s fate',
        'Must choose between fame and protecting the discovery'
      ]
    },

    characterSeeds: [
      { name: 'Marcus Chen', role: 'rival_turned_ally', traits: ['competitive', 'skilled', 'hidden depths'] },
      { name: 'Grandmother\'s Ghost', role: 'guide', traits: ['mysterious', 'protective', 'tragic'] },
      { name: 'The Guardian', role: 'protector', traits: ['ancient', 'testing', 'wise'] }
    ]
  },

  // ============================================
  // ROMANCE
  // ============================================

  'starlight-cafe': {
    id: 'starlight-cafe',
    name: 'The Starlight Cafe',
    description: 'Two people with broken hearts find each other at a magical late-night cafe',
    category: 'romance',
    audience: 'adult',
    ageRange: '16+',
    estimatedMinutes: 25,
    tags: ['romance', 'healing', 'magical realism', 'second chances'],

    config: {
      genre: { romance: 0.5, drama: 0.3, fantasy: 0.2 },
      intensity: { violence: 0, horror: 0, romance: 0.6, suspense: 0.2 },
      narratorStyle: 'warm',
      pacing: 'gentle',
      targetLength: 'medium',
      cyoaEnabled: true,
      bedtimeMode: false
    },

    outlineSeed: {
      setting: 'A cafe that only appears at midnight, serving drinks that reveal your heart\'s truth',
      theme: 'Healing begins when we let others see our true selves',
      protagonist: {
        name: 'Jamie',
        role: 'A writer who lost their voice after heartbreak',
        traits: ['creative', 'guarded', 'kind', 'slowly healing']
      },
      hook: 'Jamie stumbles into a cafe that shouldn\'t exist and meets someone who seems to know their unwritten stories',
      plotPoints: [
        'Jamie finds the cafe on their worst night',
        'Meets Alex, a regular who speaks in riddles',
        'Each night reveals more about both their pasts',
        'Learns the cafe appears only for those ready to heal',
        'Must choose to open their heart or stay safe'
      ]
    },

    characterSeeds: [
      { name: 'Alex', role: 'love_interest', traits: ['mysterious', 'understanding', 'also healing'] },
      { name: 'The Barista', role: 'magical_helper', traits: ['knowing', 'gentle', 'otherworldly'] }
    ]
  },

  // ============================================
  // HORROR / THRILLER
  // ============================================

  'hollow-house': {
    id: 'hollow-house',
    name: 'Hollow House',
    description: 'A family inherits a house that remembers every soul who\'s lived there',
    category: 'horror',
    audience: 'adult',
    ageRange: '18+',
    estimatedMinutes: 35,
    tags: ['haunted house', 'psychological', 'family secrets', 'gothic'],

    config: {
      genre: { horror: 0.5, mystery: 0.3, drama: 0.2 },
      intensity: { violence: 0.4, horror: 0.7, romance: 0.1, suspense: 0.8 },
      narratorStyle: 'ominous',
      pacing: 'building',
      targetLength: 'long',
      cyoaEnabled: true,
      bedtimeMode: false
    },

    outlineSeed: {
      setting: 'Hollow House, a Victorian mansion that has been in the family for generations',
      theme: 'We cannot escape our family\'s sins, only choose how to face them',
      protagonist: {
        name: 'Morgan',
        role: 'The last surviving heir, returning to claim the estate',
        traits: ['skeptical', 'troubled past', 'resilient', 'seeking closure']
      },
      hook: 'Morgan returns to sell Hollow House but finds doors that weren\'t there before and rooms that change',
      plotPoints: [
        'Morgan arrives to prepare the house for sale',
        'Begins experiencing visions of the house\'s past',
        'Discovers family members didn\'t die - they were absorbed',
        'Learns they were called back for a reason',
        'Must confront the house\'s hunger or become part of it'
      ]
    },

    characterSeeds: [
      { name: 'The House', role: 'antagonist', traits: ['hungry', 'patient', 'ancient'] },
      { name: 'Great Aunt Vera', role: 'ghost_guide', traits: ['trapped', 'warning', 'loving'] },
      { name: 'Local Historian', role: 'information_source', traits: ['obsessed', 'helpful', 'doomed'] }
    ]
  },

  // ============================================
  // SCI-FI
  // ============================================

  'last-signal': {
    id: 'last-signal',
    name: 'The Last Signal',
    description: 'A deep space station receives a transmission from a ship lost 50 years ago',
    category: 'scifi',
    audience: 'adult',
    ageRange: '14+',
    estimatedMinutes: 30,
    tags: ['space', 'mystery', 'survival', 'first contact'],

    config: {
      genre: { scifi: 0.5, mystery: 0.3, thriller: 0.2 },
      intensity: { violence: 0.3, horror: 0.4, romance: 0.1, suspense: 0.6 },
      narratorStyle: 'tense',
      pacing: 'building',
      targetLength: 'long',
      cyoaEnabled: true,
      bedtimeMode: false
    },

    outlineSeed: {
      setting: 'Deep space station Horizon, at the edge of explored space',
      theme: 'Some mysteries are better left unsolved',
      protagonist: {
        name: 'Commander Yuki Chen',
        role: 'Station commander who lost her father on the missing ship',
        traits: ['competent', 'haunted', 'logical', 'brave']
      },
      hook: 'The Erebus was lost with all hands 50 years ago - so who is sending messages from its coordinates?',
      plotPoints: [
        'Horizon receives an impossible transmission',
        'The message contains Yuki\'s father\'s voice',
        'A rescue mission is launched despite warnings',
        'They find the Erebus intact but changed',
        'Discover what the crew encountered - and what they became'
      ]
    },

    characterSeeds: [
      { name: 'Dr. Okonkwo', role: 'science_officer', traits: ['curious', 'cautious', 'brilliant'] },
      { name: 'Father\'s Voice', role: 'mystery', traits: ['familiar', 'wrong', 'beckoning'] },
      { name: 'The Entity', role: 'unknown', traits: ['vast', 'curious', 'transforming'] }
    ]
  },

  // ============================================
  // COMEDY
  // ============================================

  'accidental-wizard': {
    id: 'accidental-wizard',
    name: 'The Accidental Wizard',
    description: 'An accountant accidentally becomes the most powerful wizard in the realm',
    category: 'comedy',
    audience: 'family',
    ageRange: '10+',
    estimatedMinutes: 25,
    tags: ['comedy', 'fantasy', 'fish-out-of-water', 'magic'],

    config: {
      genre: { comedy: 0.5, fantasy: 0.4, adventure: 0.1 },
      intensity: { violence: 0.1, horror: 0, romance: 0.2, suspense: 0.2 },
      narratorStyle: 'comedic',
      pacing: 'snappy',
      targetLength: 'medium',
      cyoaEnabled: true,
      bedtimeMode: false
    },

    outlineSeed: {
      setting: 'The magical kingdom of Arithmia, where numbers have power',
      theme: 'Sometimes the most unlikely heroes are exactly what we need',
      protagonist: {
        name: 'Gerald Ledger',
        role: 'A meticulous accountant who prefers spreadsheets to swords',
        traits: ['organized', 'anxious', 'surprisingly brave', 'very literal']
      },
      hook: 'Gerald\'s perfect tax calculations accidentally summon him as the prophesied "Number Mage"',
      plotPoints: [
        'Gerald is summoned mid-audit to a magical realm',
        'Discovers his accounting skills translate to powerful magic',
        'Must defeat the Chaos Dragon using math',
        'Accidentally creates an economy in the dragon\'s lair',
        'Realizes he\'d rather stay than return to his cubicle'
      ]
    },

    characterSeeds: [
      { name: 'Princess Valor', role: 'warrior', traits: ['fierce', 'impatient', 'secretly kind'] },
      { name: 'Steve the Dragon', role: 'antagonist', traits: ['chaotic', 'bad at math', 'misunderstood'] },
      { name: 'The Wizard Council', role: 'bumbling_authorities', traits: ['ancient', 'confused', 'bureaucratic'] }
    ]
  }
};

// Template categories for UI organization
const TEMPLATE_CATEGORIES = {
  children: {
    name: 'Gentle & Cozy',
    description: 'Soft, low-intensity stories for younger listeners',
    icon: 'sparkles',
    color: '#6A8A82'
  },
  fantasy: {
    name: 'Fantasy',
    description: 'Magical worlds and epic adventures',
    icon: 'sparkles',
    color: '#f59b42'
  },
  mystery: {
    name: 'Mystery',
    description: 'Puzzles, secrets, and suspense',
    icon: 'search',
    color: '#42a5f5'
  },
  adventure: {
    name: 'Adventure',
    description: 'Thrilling journeys and discoveries',
    icon: 'compass',
    color: '#66bb6a'
  },
  romance: {
    name: 'Romance',
    description: 'Love stories and emotional journeys',
    icon: 'heart',
    color: '#ec407a'
  },
  horror: {
    name: 'Horror',
    description: 'Scary tales and dark mysteries',
    icon: 'ghost',
    color: '#78909c'
  },
  scifi: {
    name: 'Sci-Fi',
    description: 'Space, technology, and the future',
    icon: 'rocket',
    color: '#7c4dff'
  },
  comedy: {
    name: 'Comedy',
    description: 'Funny stories and lighthearted fun',
    icon: 'laugh',
    color: '#ffca28'
  }
};

/**
 * Get all templates
 */
function getAllTemplates() {
  return Object.values(STORY_TEMPLATES);
}

/**
 * Get templates by category
 */
function getTemplatesByCategory(category) {
  return Object.values(STORY_TEMPLATES).filter(t => t.category === category);
}

/**
 * Get templates suitable for calm mode
 */
function getBedtimeTemplates() {
  return Object.values(STORY_TEMPLATES).filter(t => t.config.bedtimeMode);
}

/**
 * Get template by ID
 */
function getTemplateById(id) {
  return STORY_TEMPLATES[id] || null;
}

/**
 * Get templates by audience
 */
function getTemplatesByAudience(audience) {
  return Object.values(STORY_TEMPLATES).filter(t => t.audience === audience);
}

/**
 * Get templates filtered by max intensity
 */
function getTemplatesWithinIntensity(maxViolence = 1, maxHorror = 1, maxRomance = 1) {
  return Object.values(STORY_TEMPLATES).filter(t =>
    t.config.intensity.violence <= maxViolence &&
    t.config.intensity.horror <= maxHorror &&
    t.config.intensity.romance <= maxRomance
  );
}

/**
 * Get random template from category
 */
function getRandomTemplate(category = null) {
  const pool = category
    ? getTemplatesByCategory(category)
    : getAllTemplates();

  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Search templates by tags
 */
function searchTemplatesByTags(tags) {
  const searchTags = Array.isArray(tags) ? tags : [tags];
  return Object.values(STORY_TEMPLATES).filter(t =>
    searchTags.some(tag => t.tags.includes(tag.toLowerCase()))
  );
}

export {
  STORY_TEMPLATES,
  TEMPLATE_CATEGORIES,
  getAllTemplates,
  getTemplatesByCategory,
  getBedtimeTemplates,
  getTemplateById,
  getTemplatesByAudience,
  getTemplatesWithinIntensity,
  getRandomTemplate,
  searchTemplatesByTags
};
