/**
 * Genre Voice Profiles
 * Defines default voice settings for different story genres.
 *
 * Used by the voice direction system to set baseline voice parameters
 * that can be further refined by story mood and character analysis.
 *
 * Voice Settings Reference (ElevenLabs V3):
 * - stability (0.0-1.0): Higher = consistent, Lower = expressive/variable
 * - style (0.0-1.0): 0 = neutral delivery, 1 = full style expression
 * - speed (0.25-4.0): Playback speed multiplier (1.0 = normal)
 *
 * Audio Tags Available:
 * - Emotions: [excited], [sad], [angry], [calm], [fearful], [surprised], [whisper], [shouting]
 * - Pauses: [pause:0.5s], [pause:1s], [pause:2s]
 */

/**
 * @typedef {Object} VoiceSettings
 * @property {number} stability - Voice consistency (0.0-1.0)
 * @property {number} style - Style expression intensity (0.0-1.0)
 * @property {number} speed - Speaking speed multiplier
 */

/**
 * @typedef {Object} NarratorProfile
 * @property {number} defaultStability - Baseline stability for narrator
 * @property {number} defaultStyle - Baseline style for narrator
 * @property {string[]} emotionBias - Preferred emotions for this genre
 * @property {'low'|'medium'|'high'} pauseFrequency - How often to insert dramatic pauses
 * @property {number} tempoModifier - Speed adjustment (0.85-1.15)
 * @property {string} deliveryStyle - General delivery description
 */

/**
 * @typedef {Object} CharacterTypeProfile
 * @property {number} stability - Voice stability
 * @property {number} style - Style intensity
 * @property {string[]} emotionBias - Preferred emotions
 * @property {string} deliveryNotes - Direction for this character type
 */

/**
 * @typedef {Object} GenreVoiceProfile
 * @property {NarratorProfile} narrator - Narrator voice settings
 * @property {Object.<string, CharacterTypeProfile>} characters - Character type profiles
 * @property {string[]} ambientMoods - Typical scene moods for this genre
 * @property {Object} dialoguePacing - Pacing rules for dialogue
 */

export const GENRE_VOICE_PROFILES = {
  // ============================================
  // HORROR / THRILLER GENRES
  // ============================================
  horror: {
    narrator: {
      defaultStability: 0.35,
      defaultStyle: 0.8,
      emotionBias: ['fearful', 'whisper', 'calm'],
      pauseFrequency: 'high',
      tempoModifier: 0.85,
      deliveryStyle: 'Measured, unsettling. Build tension through pauses and quieter moments.'
    },
    characters: {
      villain: {
        stability: 0.3,
        style: 0.9,
        emotionBias: ['angry', 'whisper', 'calm'],
        deliveryNotes: 'Menacing calm that occasionally breaks into intensity'
      },
      victim: {
        stability: 0.2,
        style: 0.85,
        emotionBias: ['fearful', 'sad', 'surprised'],
        deliveryNotes: 'Trembling, breathless, desperate'
      },
      monster: {
        stability: 0.25,
        style: 0.95,
        emotionBias: ['angry', 'whisper'],
        deliveryNotes: 'Inhuman, guttural, otherworldly'
      },
      survivor: {
        stability: 0.4,
        style: 0.7,
        emotionBias: ['fearful', 'calm', 'angry'],
        deliveryNotes: 'Determined despite fear, steely resolve'
      }
    },
    ambientMoods: ['tense', 'dread', 'creeping', 'shock', 'paranoid'],
    dialoguePacing: {
      normalPauseBetweenLines: 800,
      tensePauseBetweenLines: 1500,
      jumpScarePause: 200
    }
  },

  thriller: {
    narrator: {
      defaultStability: 0.4,
      defaultStyle: 0.75,
      emotionBias: ['excited', 'calm', 'fearful'],
      pauseFrequency: 'high',
      tempoModifier: 1.05,
      deliveryStyle: 'Propulsive, urgent. Keep the tension high with brisk pacing.'
    },
    characters: {
      protagonist: {
        stability: 0.45,
        style: 0.7,
        emotionBias: ['calm', 'excited', 'angry'],
        deliveryNotes: 'Controlled intensity, professional edge'
      },
      antagonist: {
        stability: 0.35,
        style: 0.85,
        emotionBias: ['calm', 'angry', 'excited'],
        deliveryNotes: 'Calculating, dangerous composure'
      },
      informant: {
        stability: 0.3,
        style: 0.6,
        emotionBias: ['fearful', 'whisper', 'excited'],
        deliveryNotes: 'Nervous, paranoid, hushed'
      }
    },
    ambientMoods: ['suspense', 'chase', 'revelation', 'confrontation'],
    dialoguePacing: {
      normalPauseBetweenLines: 500,
      tensePauseBetweenLines: 1000,
      actionSequencePause: 300
    }
  },

  mystery: {
    narrator: {
      defaultStability: 0.5,
      defaultStyle: 0.65,
      emotionBias: ['calm', 'surprised', 'excited'],
      pauseFrequency: 'medium',
      tempoModifier: 0.95,
      deliveryStyle: 'Contemplative, measured. Let revelations land with weight.'
    },
    characters: {
      detective: {
        stability: 0.55,
        style: 0.6,
        emotionBias: ['calm', 'surprised', 'excited'],
        deliveryNotes: 'Thoughtful, observant, occasionally eureka moments'
      },
      suspect: {
        stability: 0.35,
        style: 0.75,
        emotionBias: ['fearful', 'angry', 'calm'],
        deliveryNotes: 'Guarded, defensive, nervous tells'
      },
      witness: {
        stability: 0.4,
        style: 0.5,
        emotionBias: ['fearful', 'sad', 'calm'],
        deliveryNotes: 'Hesitant, uncertain, sometimes evasive'
      }
    },
    ambientMoods: ['intrigue', 'revelation', 'suspicion', 'discovery'],
    dialoguePacing: {
      normalPauseBetweenLines: 700,
      revelationPause: 1200,
      interrogationPause: 600
    }
  },

  // ============================================
  // ROMANCE / DRAMA GENRES
  // ============================================
  romance: {
    narrator: {
      defaultStability: 0.5,
      defaultStyle: 0.7,
      emotionBias: ['calm', 'excited', 'sad'],
      pauseFrequency: 'medium',
      tempoModifier: 0.95,
      deliveryStyle: 'Warm, intimate. Let emotional moments breathe.'
    },
    characters: {
      protagonist: {
        stability: 0.4,
        style: 0.75,
        emotionBias: ['excited', 'sad', 'calm'],
        deliveryNotes: 'Vulnerable, hopeful, emotionally open'
      },
      loveInterest: {
        stability: 0.45,
        style: 0.8,
        emotionBias: ['calm', 'excited', 'sad'],
        deliveryNotes: 'Charming, sincere, with hidden depths'
      },
      rival: {
        stability: 0.5,
        style: 0.65,
        emotionBias: ['angry', 'sad', 'calm'],
        deliveryNotes: 'Competitive edge, underlying insecurity'
      },
      bestFriend: {
        stability: 0.55,
        style: 0.6,
        emotionBias: ['excited', 'calm', 'sad'],
        deliveryNotes: 'Supportive, occasionally teasing'
      }
    },
    ambientMoods: ['tender', 'longing', 'passionate', 'heartbreak', 'joy'],
    dialoguePacing: {
      normalPauseBetweenLines: 600,
      intimatePause: 1000,
      confessionPause: 1500
    }
  },

  drama: {
    narrator: {
      defaultStability: 0.45,
      defaultStyle: 0.75,
      emotionBias: ['calm', 'sad', 'angry'],
      pauseFrequency: 'medium',
      tempoModifier: 0.9,
      deliveryStyle: 'Resonant, emotionally engaged. Honor the weight of human experience.'
    },
    characters: {
      protagonist: {
        stability: 0.35,
        style: 0.8,
        emotionBias: ['sad', 'angry', 'calm'],
        deliveryNotes: 'Complex emotions, internal struggle visible'
      },
      antagonist: {
        stability: 0.4,
        style: 0.75,
        emotionBias: ['angry', 'calm', 'sad'],
        deliveryNotes: 'Justified in their own mind, tragic dimension'
      },
      mentor: {
        stability: 0.6,
        style: 0.5,
        emotionBias: ['calm', 'sad', 'excited'],
        deliveryNotes: 'Wise, weathered, occasionally regretful'
      }
    },
    ambientMoods: ['melancholy', 'conflict', 'resolution', 'catharsis'],
    dialoguePacing: {
      normalPauseBetweenLines: 700,
      emotionalPause: 1200,
      confrontationPause: 500
    }
  },

  erotica: {
    narrator: {
      defaultStability: 0.35,
      defaultStyle: 0.85,
      emotionBias: ['excited', 'calm', 'whisper'],
      pauseFrequency: 'medium',
      tempoModifier: 0.9,
      deliveryStyle: 'Sensual, intimate. Build anticipation through pacing and breath.'
    },
    characters: {
      protagonist: {
        stability: 0.3,
        style: 0.85,
        emotionBias: ['excited', 'whisper', 'calm'],
        deliveryNotes: 'Breathless, yearning, uninhibited'
      },
      partner: {
        stability: 0.35,
        style: 0.9,
        emotionBias: ['excited', 'calm', 'whisper'],
        deliveryNotes: 'Seductive, confident, responsive'
      }
    },
    ambientMoods: ['anticipation', 'passion', 'tenderness', 'intensity'],
    dialoguePacing: {
      normalPauseBetweenLines: 800,
      intimatePause: 1200,
      buildupPause: 600
    }
  },

  // ============================================
  // FANTASY / SCI-FI GENRES
  // ============================================
  fantasy: {
    narrator: {
      defaultStability: 0.5,
      defaultStyle: 0.6,
      emotionBias: ['excited', 'calm', 'surprised'],
      pauseFrequency: 'medium',
      tempoModifier: 1.0,
      deliveryStyle: 'Epic, wonder-filled. Bring grandeur to world-building moments.'
    },
    characters: {
      hero: {
        stability: 0.5,
        style: 0.7,
        emotionBias: ['excited', 'calm', 'angry'],
        deliveryNotes: 'Noble, determined, growing in confidence'
      },
      wizard: {
        stability: 0.55,
        style: 0.65,
        emotionBias: ['calm', 'excited', 'surprised'],
        deliveryNotes: 'Mysterious, knowledgeable, ancient wisdom'
      },
      villain: {
        stability: 0.35,
        style: 0.85,
        emotionBias: ['angry', 'calm', 'excited'],
        deliveryNotes: 'Grand, theatrical, absolute conviction'
      },
      companion: {
        stability: 0.45,
        style: 0.55,
        emotionBias: ['excited', 'fearful', 'calm'],
        deliveryNotes: 'Loyal, occasionally comic relief'
      },
      creature: {
        stability: 0.3,
        style: 0.9,
        emotionBias: ['angry', 'calm', 'excited'],
        deliveryNotes: 'Otherworldly, alien speech patterns'
      }
    },
    ambientMoods: ['wonder', 'epic', 'mystical', 'peril', 'triumph'],
    dialoguePacing: {
      normalPauseBetweenLines: 600,
      prophecyPause: 1000,
      battleCryPause: 300
    }
  },

  scifi: {
    narrator: {
      defaultStability: 0.55,
      defaultStyle: 0.55,
      emotionBias: ['calm', 'excited', 'surprised'],
      pauseFrequency: 'low',
      tempoModifier: 1.05,
      deliveryStyle: 'Clear, precise. Balance technical exposition with human emotion.'
    },
    characters: {
      scientist: {
        stability: 0.6,
        style: 0.5,
        emotionBias: ['calm', 'excited', 'surprised'],
        deliveryNotes: 'Analytical, prone to wonder at discovery'
      },
      ai: {
        stability: 0.75,
        style: 0.3,
        emotionBias: ['calm'],
        deliveryNotes: 'Measured, precise, hint of emergent emotion'
      },
      captain: {
        stability: 0.55,
        style: 0.65,
        emotionBias: ['calm', 'angry', 'excited'],
        deliveryNotes: 'Authoritative, burden of command'
      },
      alien: {
        stability: 0.35,
        style: 0.8,
        emotionBias: ['calm', 'surprised', 'angry'],
        deliveryNotes: 'Unfamiliar cadence, different values'
      }
    },
    ambientMoods: ['discovery', 'danger', 'awe', 'isolation', 'hope'],
    dialoguePacing: {
      normalPauseBetweenLines: 500,
      technicalExpositionPause: 400,
      revelationPause: 900
    }
  },

  // ============================================
  // ADVENTURE / ACTION GENRES
  // ============================================
  adventure: {
    narrator: {
      defaultStability: 0.5,
      defaultStyle: 0.65,
      emotionBias: ['excited', 'calm', 'surprised'],
      pauseFrequency: 'low',
      tempoModifier: 1.1,
      deliveryStyle: 'Energetic, forward momentum. Keep the excitement high.'
    },
    characters: {
      hero: {
        stability: 0.45,
        style: 0.75,
        emotionBias: ['excited', 'calm', 'angry'],
        deliveryNotes: 'Confident, quippy, rises to challenges'
      },
      sidekick: {
        stability: 0.4,
        style: 0.6,
        emotionBias: ['excited', 'fearful', 'surprised'],
        deliveryNotes: 'Enthusiastic, occasionally overwhelmed'
      },
      villain: {
        stability: 0.45,
        style: 0.8,
        emotionBias: ['angry', 'excited', 'calm'],
        deliveryNotes: 'Theatrical menace, enjoys the game'
      }
    },
    ambientMoods: ['excitement', 'danger', 'discovery', 'triumph'],
    dialoguePacing: {
      normalPauseBetweenLines: 400,
      actionSequencePause: 250,
      cliffhangerPause: 800
    }
  },

  action: {
    narrator: {
      defaultStability: 0.45,
      defaultStyle: 0.7,
      emotionBias: ['excited', 'angry', 'calm'],
      pauseFrequency: 'low',
      tempoModifier: 1.15,
      deliveryStyle: 'Punchy, visceral. Short sentences, high impact.'
    },
    characters: {
      hero: {
        stability: 0.4,
        style: 0.8,
        emotionBias: ['angry', 'calm', 'excited'],
        deliveryNotes: 'Terse, powerful, action speaks louder'
      },
      villain: {
        stability: 0.35,
        style: 0.85,
        emotionBias: ['angry', 'calm', 'excited'],
        deliveryNotes: 'Threatening, physical presence in voice'
      },
      ally: {
        stability: 0.5,
        style: 0.6,
        emotionBias: ['calm', 'excited', 'angry'],
        deliveryNotes: 'Professional, mission-focused'
      }
    },
    ambientMoods: ['intensity', 'confrontation', 'chase', 'aftermath'],
    dialoguePacing: {
      normalPauseBetweenLines: 300,
      combatPause: 200,
      catchBreathPause: 600
    }
  },

  // ============================================
  // COMEDY / LIGHTHEARTED GENRES
  // ============================================
  comedy: {
    narrator: {
      defaultStability: 0.45,
      defaultStyle: 0.7,
      emotionBias: ['excited', 'surprised', 'calm'],
      pauseFrequency: 'medium',
      tempoModifier: 1.05,
      deliveryStyle: 'Playful, timing is everything. Land the jokes with precise beats.'
    },
    characters: {
      protagonist: {
        stability: 0.4,
        style: 0.75,
        emotionBias: ['excited', 'surprised', 'sad'],
        deliveryNotes: 'Expressive, reactive, great comic timing'
      },
      straightMan: {
        stability: 0.6,
        style: 0.4,
        emotionBias: ['calm', 'angry', 'surprised'],
        deliveryNotes: 'Dry, deadpan, exasperated'
      },
      goofball: {
        stability: 0.3,
        style: 0.85,
        emotionBias: ['excited', 'surprised', 'sad'],
        deliveryNotes: 'Over-the-top, physical comedy energy'
      }
    },
    ambientMoods: ['absurd', 'witty', 'slapstick', 'heartwarming'],
    dialoguePacing: {
      normalPauseBetweenLines: 500,
      setupPause: 400,
      punchlinePause: 800,
      callbackPause: 600
    }
  },

  // ============================================
  // LITERARY / HISTORICAL GENRES
  // ============================================
  literary: {
    narrator: {
      defaultStability: 0.55,
      defaultStyle: 0.6,
      emotionBias: ['calm', 'sad', 'excited'],
      pauseFrequency: 'medium',
      tempoModifier: 0.9,
      deliveryStyle: 'Contemplative, nuanced. Honor the prose with thoughtful delivery.'
    },
    characters: {
      protagonist: {
        stability: 0.45,
        style: 0.7,
        emotionBias: ['calm', 'sad', 'excited'],
        deliveryNotes: 'Introspective, layered emotions'
      },
      foil: {
        stability: 0.5,
        style: 0.65,
        emotionBias: ['calm', 'angry', 'sad'],
        deliveryNotes: 'Contrasting worldview, challenging'
      }
    },
    ambientMoods: ['contemplative', 'bittersweet', 'epiphany', 'quiet desperation'],
    dialoguePacing: {
      normalPauseBetweenLines: 800,
      reflectivePause: 1200,
      epiphanyPause: 1500
    }
  },

  historical: {
    narrator: {
      defaultStability: 0.55,
      defaultStyle: 0.55,
      emotionBias: ['calm', 'sad', 'excited'],
      pauseFrequency: 'medium',
      tempoModifier: 0.95,
      deliveryStyle: 'Dignified, period-appropriate gravitas.'
    },
    characters: {
      noble: {
        stability: 0.6,
        style: 0.6,
        emotionBias: ['calm', 'angry', 'sad'],
        deliveryNotes: 'Formal, measured, conscious of station'
      },
      commoner: {
        stability: 0.4,
        style: 0.65,
        emotionBias: ['excited', 'fearful', 'angry'],
        deliveryNotes: 'Earthier, more direct, survival instinct'
      },
      soldier: {
        stability: 0.5,
        style: 0.6,
        emotionBias: ['calm', 'angry', 'fearful'],
        deliveryNotes: 'Disciplined, brotherhood, haunted'
      }
    },
    ambientMoods: ['grandeur', 'upheaval', 'intimacy', 'consequence'],
    dialoguePacing: {
      normalPauseBetweenLines: 700,
      formalAddressPause: 500,
      battlefieldPause: 300
    }
  },

  // ============================================
  // CHILDREN'S / YOUNG ADULT GENRES
  // ============================================
  children: {
    narrator: {
      defaultStability: 0.5,
      defaultStyle: 0.7,
      emotionBias: ['excited', 'surprised', 'calm'],
      pauseFrequency: 'medium',
      tempoModifier: 0.95,
      deliveryStyle: 'Warm, engaging. Clear enunciation, expressive character voices.'
    },
    characters: {
      child: {
        stability: 0.4,
        style: 0.75,
        emotionBias: ['excited', 'surprised', 'sad'],
        deliveryNotes: 'Innocent wonder, unfiltered reactions'
      },
      friend: {
        stability: 0.45,
        style: 0.7,
        emotionBias: ['excited', 'calm', 'fearful'],
        deliveryNotes: 'Supportive, adventurous spirit'
      },
      adult: {
        stability: 0.55,
        style: 0.5,
        emotionBias: ['calm', 'excited', 'surprised'],
        deliveryNotes: 'Warm, patient, occasional sternness'
      },
      creature: {
        stability: 0.35,
        style: 0.85,
        emotionBias: ['excited', 'surprised', 'calm'],
        deliveryNotes: 'Whimsical, distinctive character voice'
      }
    },
    ambientMoods: ['wonder', 'adventure', 'friendship', 'learning'],
    dialoguePacing: {
      normalPauseBetweenLines: 600,
      excitementPause: 400,
      lessonMomentPause: 800
    }
  },

  youngAdult: {
    narrator: {
      defaultStability: 0.45,
      defaultStyle: 0.7,
      emotionBias: ['excited', 'sad', 'angry'],
      pauseFrequency: 'medium',
      tempoModifier: 1.0,
      deliveryStyle: 'Authentic, emotionally honest. Respect the intensity of youth.'
    },
    characters: {
      protagonist: {
        stability: 0.35,
        style: 0.8,
        emotionBias: ['excited', 'angry', 'sad'],
        deliveryNotes: 'Passionate, idealistic, figuring it out'
      },
      bestFriend: {
        stability: 0.4,
        style: 0.7,
        emotionBias: ['excited', 'calm', 'sad'],
        deliveryNotes: 'Loyal, grounding influence'
      },
      mentor: {
        stability: 0.55,
        style: 0.55,
        emotionBias: ['calm', 'sad', 'excited'],
        deliveryNotes: 'Wise but relatable, not preachy'
      },
      rival: {
        stability: 0.4,
        style: 0.75,
        emotionBias: ['angry', 'excited', 'sad'],
        deliveryNotes: 'Competitive, secretly insecure'
      }
    },
    ambientMoods: ['identity', 'rebellion', 'first love', 'coming of age'],
    dialoguePacing: {
      normalPauseBetweenLines: 500,
      emotionalOutburstPause: 300,
      heartToHeartPause: 900
    }
  }
};

/**
 * Get voice profile for a genre
 * @param {string} genre - Genre name (case-insensitive)
 * @returns {GenreVoiceProfile|null} Voice profile or null if genre not found
 */
export function getGenreVoiceProfile(genre) {
  if (!genre) return null;
  const normalizedGenre = genre.toLowerCase().replace(/[^a-z]/g, '');
  return GENRE_VOICE_PROFILES[normalizedGenre] || null;
}

/**
 * Get blended voice profile for multiple genres
 * @param {Object} genres - Genre weights { horror: 60, thriller: 40 }
 * @returns {GenreVoiceProfile} Blended profile weighted by percentages
 */
export function getBlendedVoiceProfile(genres) {
  if (!genres || typeof genres !== 'object') {
    return GENRE_VOICE_PROFILES.drama; // Default fallback
  }

  const entries = Object.entries(genres).filter(([_, weight]) => weight > 0);
  if (entries.length === 0) {
    return GENRE_VOICE_PROFILES.drama;
  }

  // Sort by weight descending, take primary genre
  entries.sort((a, b) => b[1] - a[1]);
  const [primaryGenre, primaryWeight] = entries[0];
  const primaryProfile = getGenreVoiceProfile(primaryGenre);

  if (!primaryProfile || entries.length === 1) {
    return primaryProfile || GENRE_VOICE_PROFILES.drama;
  }

  // Blend with secondary genre if significant weight
  const [secondaryGenre, secondaryWeight] = entries[1];
  if (secondaryWeight < 20) {
    return primaryProfile;
  }

  const secondaryProfile = getGenreVoiceProfile(secondaryGenre);
  if (!secondaryProfile) {
    return primaryProfile;
  }

  // Weighted blend of narrator settings
  const totalWeight = primaryWeight + secondaryWeight;
  const primaryRatio = primaryWeight / totalWeight;
  const secondaryRatio = secondaryWeight / totalWeight;

  return {
    narrator: {
      defaultStability: primaryProfile.narrator.defaultStability * primaryRatio +
                        secondaryProfile.narrator.defaultStability * secondaryRatio,
      defaultStyle: primaryProfile.narrator.defaultStyle * primaryRatio +
                    secondaryProfile.narrator.defaultStyle * secondaryRatio,
      emotionBias: [...new Set([
        ...primaryProfile.narrator.emotionBias,
        ...secondaryProfile.narrator.emotionBias.slice(0, 1)
      ])].slice(0, 4),
      pauseFrequency: primaryProfile.narrator.pauseFrequency,
      tempoModifier: primaryProfile.narrator.tempoModifier * primaryRatio +
                     secondaryProfile.narrator.tempoModifier * secondaryRatio,
      deliveryStyle: primaryProfile.narrator.deliveryStyle
    },
    characters: { ...primaryProfile.characters, ...secondaryProfile.characters },
    ambientMoods: [...new Set([
      ...primaryProfile.ambientMoods,
      ...secondaryProfile.ambientMoods
    ])].slice(0, 6),
    dialoguePacing: primaryProfile.dialoguePacing
  };
}

/**
 * Map a character role to the best matching character type profile
 * @param {string} role - Character role (protagonist, villain, etc.)
 * @param {string} genre - Genre name
 * @returns {CharacterTypeProfile|null} Matching profile or null
 */
export function getCharacterTypeProfile(role, genre) {
  const profile = getGenreVoiceProfile(genre);
  if (!profile || !role) return null;

  const normalizedRole = role.toLowerCase();

  // Direct match
  if (profile.characters[normalizedRole]) {
    return profile.characters[normalizedRole];
  }

  // Role mapping for common variations
  const roleMapping = {
    'main character': 'protagonist',
    'lead': 'protagonist',
    'hero': 'protagonist',
    'heroine': 'protagonist',
    'bad guy': 'villain',
    'antagonist': 'villain',
    'enemy': 'villain',
    'love interest': 'loveInterest',
    'romantic interest': 'loveInterest',
    'partner': 'loveInterest',
    'sidekick': 'sidekick',
    'companion': 'companion',
    'friend': 'bestFriend',
    'best friend': 'bestFriend',
    'mentor': 'mentor',
    'guide': 'mentor',
    'teacher': 'mentor',
    'supporting': 'ally',
    'ally': 'ally'
  };

  const mappedRole = roleMapping[normalizedRole];
  if (mappedRole && profile.characters[mappedRole]) {
    return profile.characters[mappedRole];
  }

  // Fallback to protagonist profile
  return profile.characters.protagonist || profile.characters.hero || null;
}

export default GENRE_VOICE_PROFILES;
