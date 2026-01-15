/**
 * Multi-Agent SFX Detection System
 *
 * A collaborative AI system for detecting and validating contextually-appropriate sound effects.
 * Uses 4 specialized agents working in sequence with quality checks.
 *
 * Agent 1: Context Analyzer - Understands genre, setting, world type
 * Agent 2: Scene Detector - Finds sound opportunities in scene text
 * Agent 3: Library Matcher - Maps detected sounds to appropriate library entries
 * Agent 4: Validator - Quality check for appropriateness and timing
 */

import { logger } from '../utils/logger.js';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Expanded SFX Library with genre-specific categories
 * Organized by world type for better context matching
 */
export const GENRE_SFX_LIBRARY = {
  // ============================================
  // SCI-FI / SPACE SOUNDS
  // ============================================
  scifi: {
    // Spacecraft sounds
    ship_engine_idle: { prompt: 'Spaceship engine humming, low frequency rumble, futuristic spacecraft ambient', duration: 15, loop: true },
    ship_engine_thrust: { prompt: 'Spaceship engines firing, rocket thrust, powerful acceleration', duration: 8, loop: false },
    ship_landing: { prompt: 'Spacecraft landing sequence, retro thrusters, touchdown', duration: 6, loop: false },
    ship_takeoff: { prompt: 'Spaceship taking off, engines igniting, liftoff sequence', duration: 8, loop: false },
    airlock_open: { prompt: 'Airlock hissing open, pneumatic door, pressurization release', duration: 3, loop: false },
    airlock_close: { prompt: 'Airlock sealing shut, airtight seal, pressure equalizing', duration: 3, loop: false },
    door_scifi: { prompt: 'Futuristic sliding door whoosh, automatic door opening', duration: 2, loop: false },
    door_heavy: { prompt: 'Heavy blast door opening, mechanical grinding, industrial', duration: 4, loop: false },

    // Computer/Tech sounds
    computer_beep: { prompt: 'Computer terminal beeping, digital interface, sci-fi technology', duration: 2, loop: false },
    computer_typing: { prompt: 'Futuristic keyboard typing, holographic interface interaction', duration: 4, loop: false },
    computer_startup: { prompt: 'Computer system booting up, startup sequence, electronic', duration: 4, loop: false },
    computer_error: { prompt: 'Computer error alarm, warning beep, system malfunction', duration: 3, loop: false },
    hologram_activate: { prompt: 'Hologram activating, digital projection humming, futuristic display', duration: 3, loop: false },
    scanner_beep: { prompt: 'Electronic scanner beeping, security scan, digital sensor', duration: 2, loop: false },
    data_transfer: { prompt: 'Data transfer sound, electronic processing, digital download', duration: 3, loop: false },

    // Weapons
    laser_shot: { prompt: 'Laser gun firing, pew pew, sci-fi blaster shot', duration: 1, loop: false },
    laser_charge: { prompt: 'Laser weapon charging up, energy building, power surge', duration: 3, loop: false },
    plasma_blast: { prompt: 'Plasma weapon firing, energy blast, futuristic weapon', duration: 2, loop: false },
    shield_hit: { prompt: 'Energy shield impact, force field deflection, barrier hit', duration: 2, loop: false },
    shield_activate: { prompt: 'Energy shield activating, force field powering up', duration: 3, loop: false },

    // Ambiance
    space_station: { prompt: 'Space station ambient, mechanical hum, ventilation, distant machinery', duration: 15, loop: true },
    bridge_ambient: { prompt: 'Spaceship bridge ambiance, computer beeps, crew chatter, control systems', duration: 15, loop: true },
    engine_room: { prompt: 'Spaceship engine room, loud machinery, power generators, industrial', duration: 15, loop: true },
    corridor_scifi: { prompt: 'Futuristic corridor ambiance, fluorescent hum, metallic echoes', duration: 12, loop: true },
    medical_bay: { prompt: 'Sci-fi medical bay, life support beeping, medical equipment humming', duration: 12, loop: true },
    cryo_chamber: { prompt: 'Cryogenic chamber ambiance, freezing mist, cold atmosphere', duration: 12, loop: true },
    zero_gravity: { prompt: 'Zero gravity ambiance, floating objects, weightless environment', duration: 12, loop: true },
    spacewalk: { prompt: 'Spacewalk ambiance, breathing in helmet, radio static, isolation', duration: 12, loop: true },
    alien_planet: { prompt: 'Alien planet surface, strange atmosphere, otherworldly ambiance', duration: 15, loop: true },

    // Alerts/Alarms
    red_alert: { prompt: 'Red alert klaxon, emergency alarm, spaceship warning', duration: 6, loop: true },
    yellow_alert: { prompt: 'Yellow alert chime, caution warning, moderate alarm', duration: 4, loop: false },
    hull_breach: { prompt: 'Hull breach alarm, decompression warning, emergency siren', duration: 6, loop: true },
    intruder_alert: { prompt: 'Intruder alert alarm, security breach warning', duration: 5, loop: true },

    // Actions
    footsteps_metal: { prompt: 'Footsteps on metal grating, spaceship corridor walking', duration: 5, loop: false },
    footsteps_mag_boots: { prompt: 'Magnetic boots walking, clunking on metal hull', duration: 5, loop: false },
    elevator_scifi: { prompt: 'Futuristic elevator moving, turbolift, smooth electronic movement', duration: 4, loop: false },
    hatch_open: { prompt: 'Spaceship hatch opening, metal hatch, mechanical', duration: 3, loop: false },
    console_explosion: { prompt: 'Control console exploding, sparks flying, electrical damage', duration: 3, loop: false },
    power_down: { prompt: 'Power systems shutting down, electronics dying, darkness', duration: 4, loop: false },
    power_up: { prompt: 'Power systems restoring, electronics coming online', duration: 4, loop: false },

    // Communication
    comm_static: { prompt: 'Radio communication static, interference, broken transmission', duration: 4, loop: false },
    comm_beep: { prompt: 'Communication device beeping, incoming message alert', duration: 2, loop: false },
    transmission: { prompt: 'Incoming transmission sound, communication channel opening', duration: 3, loop: false },

    // Robots/AI
    robot_servo: { prompt: 'Robot servo motors, mechanical movement, android', duration: 3, loop: false },
    robot_voice: { prompt: 'Robot voice processing, synthesized speech preparing', duration: 2, loop: false },
    ai_thinking: { prompt: 'AI computer processing, electronic thinking, computing', duration: 4, loop: false },
    droid_beep: { prompt: 'Friendly robot beeping, droid communication sounds', duration: 3, loop: false }
  },

  // ============================================
  // CYBERPUNK / DYSTOPIAN
  // ============================================
  cyberpunk: {
    neon_buzz: { prompt: 'Neon lights buzzing, electric hum, urban night', duration: 10, loop: true },
    rain_city: { prompt: 'Rain in cyberpunk city, wet streets, distant traffic', duration: 15, loop: true },
    hover_vehicle: { prompt: 'Hover car passing by, futuristic vehicle, anti-gravity', duration: 4, loop: false },
    implant_activate: { prompt: 'Cybernetic implant activating, neural interface, tech enhancement', duration: 3, loop: false },
    hack_attempt: { prompt: 'Hacking sequence, data intrusion, digital breach attempt', duration: 4, loop: false },
    synth_music: { prompt: 'Synthwave ambient, retro-futuristic atmosphere, electronic', duration: 15, loop: true },
    megacity_ambient: { prompt: 'Megacity street ambiance, crowds, advertisements, urban chaos', duration: 15, loop: true },
    corporate_lobby: { prompt: 'Corporate building lobby, clean and sterile, subtle technology', duration: 12, loop: true },
    underground_club: { prompt: 'Underground nightclub, heavy bass, electronic music muffled', duration: 15, loop: true }
  },

  // ============================================
  // HORROR / SUPERNATURAL
  // ============================================
  horror: {
    heartbeat: { prompt: 'Heartbeat pounding, anxiety, fear building', duration: 8, loop: true },
    breathing_heavy: { prompt: 'Heavy scared breathing, panic, terror', duration: 6, loop: false },
    footsteps_creaky: { prompt: 'Creaky floorboard footsteps, old house, something approaching', duration: 5, loop: false },
    door_creak: { prompt: 'Door creaking open slowly, horror atmosphere, suspense', duration: 4, loop: false },
    whispers: { prompt: 'Creepy whispers, unintelligible voices, supernatural', duration: 6, loop: false },
    scream_distant: { prompt: 'Distant scream, terror, something horrible happening', duration: 3, loop: false },
    scratching: { prompt: 'Scratching sounds from wall, something inside, creepy', duration: 5, loop: false },
    chains_rattling: { prompt: 'Chains rattling in darkness, imprisonment, horror', duration: 4, loop: false },
    clock_ticking: { prompt: 'Ominous clock ticking, time passing, suspense', duration: 10, loop: true },
    static_tv: { prompt: 'TV static, white noise, unsettling', duration: 8, loop: true },
    child_laugh: { prompt: 'Creepy child laughter, distant, supernatural', duration: 3, loop: false },
    music_box: { prompt: 'Creepy music box playing, slowing down, eerie', duration: 6, loop: false },
    flies_buzzing: { prompt: 'Flies buzzing, decay, something dead nearby', duration: 8, loop: true },
    basement_drip: { prompt: 'Water dripping in dark basement, echoey, isolation', duration: 10, loop: true },
    growl_unknown: { prompt: 'Unknown creature growling, something in the dark', duration: 4, loop: false },
    jump_scare: { prompt: 'Sudden loud noise, jump scare, shock', duration: 2, loop: false },
    tension_building: { prompt: 'Horror tension building, dread increasing, about to happen', duration: 10, loop: false },
    paranormal: { prompt: 'Paranormal activity, objects moving, supernatural presence', duration: 6, loop: false }
  },

  // ============================================
  // MODERN / CONTEMPORARY
  // ============================================
  modern: {
    city_traffic: { prompt: 'City traffic sounds, cars passing, urban daytime', duration: 15, loop: true },
    city_night: { prompt: 'City at night, distant sirens, quiet streets, urban', duration: 15, loop: true },
    office_ambient: { prompt: 'Office ambient, keyboard typing, printer, quiet workplace', duration: 12, loop: true },
    cafe_ambient: { prompt: 'Coffee shop ambiance, espresso machine, quiet conversations', duration: 15, loop: true },
    phone_ring: { prompt: 'Modern phone ringing, smartphone ringtone', duration: 4, loop: false },
    phone_vibrate: { prompt: 'Phone vibrating on table, notification', duration: 2, loop: false },
    text_notification: { prompt: 'Text message notification, smartphone ding', duration: 1, loop: false },
    typing_keyboard: { prompt: 'Keyboard typing, computer work, modern office', duration: 5, loop: false },
    car_engine: { prompt: 'Car engine running, idling vehicle', duration: 8, loop: true },
    car_door: { prompt: 'Car door opening and closing, modern vehicle', duration: 2, loop: false },
    subway: { prompt: 'Subway train arriving, underground transit', duration: 8, loop: false },
    airplane_cabin: { prompt: 'Airplane cabin ambient, engine drone, flight', duration: 15, loop: true },
    hospital_ambient: { prompt: 'Hospital ambient, beeping monitors, PA system', duration: 12, loop: true },
    school_bell: { prompt: 'School bell ringing, class change', duration: 3, loop: false },
    construction: { prompt: 'Construction site, machinery, building work', duration: 12, loop: true },
    rain_window_modern: { prompt: 'Rain on modern window, apartment, cozy', duration: 12, loop: true },
    footsteps_concrete: { prompt: 'Footsteps on concrete sidewalk, urban walking', duration: 5, loop: false },
    elevator_modern: { prompt: 'Modern elevator ding and doors, office building', duration: 3, loop: false }
  },

  // ============================================
  // FANTASY / MEDIEVAL (Existing enhanced)
  // ============================================
  fantasy: {
    // Weather
    rain_light: { prompt: 'Light rain falling on leaves, gentle dripping, peaceful atmosphere', duration: 15, loop: true },
    rain_heavy: { prompt: 'Heavy rainfall, thunderstorm approaching, rain on roof', duration: 15, loop: true },
    thunder: { prompt: 'Distant thunder rumbling, ominous storm', duration: 8, loop: false },
    wind_gentle: { prompt: 'Gentle breeze through trees, rustling leaves', duration: 12, loop: true },
    wind_strong: { prompt: 'Strong howling wind, stormy gusts', duration: 10, loop: true },

    // Locations
    forest_day: { prompt: 'Forest ambiance with birds chirping, leaves rustling, peaceful woodland', duration: 15, loop: true },
    forest_night: { prompt: 'Night forest with crickets, owl hooting, mysterious atmosphere', duration: 15, loop: true },
    castle_interior: { prompt: 'Stone castle interior, echoing footsteps, distant torches crackling', duration: 12, loop: true },
    tavern: { prompt: 'Busy medieval tavern, crowd murmuring, glasses clinking, fire crackling', duration: 15, loop: true },
    cave: { prompt: 'Dripping water in cave, echoing drops, underground atmosphere', duration: 12, loop: true },
    dungeon: { prompt: 'Dark dungeon ambiance, chains rattling, dripping water, eerie silence', duration: 12, loop: true },
    village: { prompt: 'Peaceful village, chickens, distant conversations, rustic life', duration: 15, loop: true },
    throne_room: { prompt: 'Grand throne room, echoing stone, distant conversations, regal atmosphere', duration: 12, loop: true },
    temple: { prompt: 'Ancient temple, distant chanting, incense burning, spiritual atmosphere', duration: 12, loop: true },

    // Actions
    footsteps_stone: { prompt: 'Footsteps on stone floor, walking in castle corridor', duration: 5, loop: false },
    footsteps_forest: { prompt: 'Footsteps on forest path, leaves and twigs crunching', duration: 5, loop: false },
    door_wooden_open: { prompt: 'Heavy wooden door creaking open slowly', duration: 3, loop: false },
    door_wooden_close: { prompt: 'Wooden door closing with solid thud', duration: 2, loop: false },
    horse_gallop: { prompt: 'Horse galloping on road, hooves pounding', duration: 6, loop: false },
    chest_open: { prompt: 'Treasure chest opening, rusty hinges, discovery', duration: 3, loop: false },

    // Combat
    sword_clash: { prompt: 'Metal swords clashing, combat fighting sounds', duration: 4, loop: false },
    sword_draw: { prompt: 'Sword being drawn from sheath, metal sliding', duration: 2, loop: false },
    sword_sheath: { prompt: 'Sword sliding back into sheath, metal clicking', duration: 2, loop: false },
    arrow_whoosh: { prompt: 'Arrow flying through air, whooshing sound', duration: 2, loop: false },
    battle_distant: { prompt: 'Distant battle sounds, swords clashing, shouts, war ambiance', duration: 12, loop: true },
    armor_movement: { prompt: 'Knight in armor moving, metal plates clinking', duration: 3, loop: false },

    // Magic
    spell_cast: { prompt: 'Magical spell being cast, mystical energy, arcane power', duration: 3, loop: false },
    spell_fire: { prompt: 'Fire spell casting, flames roaring, heat wave', duration: 3, loop: false },
    spell_ice: { prompt: 'Ice spell casting, crystallization, freezing cold', duration: 3, loop: false },
    magic_ambient: { prompt: 'Magical ambient atmosphere, ethereal humming, mystical energy', duration: 10, loop: true },
    portal_open: { prompt: 'Magical portal opening, swirling energy, dimensional rift', duration: 4, loop: false },
    dragon_roar: { prompt: 'Dragon roaring, monstrous beast sound', duration: 4, loop: false },

    // Creatures
    wolf_howl: { prompt: 'Wolf howling in distance, pack calling, wilderness', duration: 6, loop: false },
    owl_hoot: { prompt: 'Owl hooting in night, wise bird, forest', duration: 3, loop: false },
    crow_caw: { prompt: 'Crows cawing, ominous birds, dark omen', duration: 4, loop: false },

    // Nature
    fire_campfire: { prompt: 'Campfire burning, wood crackling, cozy warmth', duration: 12, loop: true },
    water_stream: { prompt: 'Gentle stream flowing, water babbling over rocks', duration: 12, loop: true },
    birds_morning: { prompt: 'Morning birds singing, dawn chorus, peaceful sunrise', duration: 12, loop: true }
  },

  // ============================================
  // WESTERN
  // ============================================
  western: {
    saloon_ambient: { prompt: 'Old west saloon, piano music, chatter, glasses clinking', duration: 15, loop: true },
    horse_trot: { prompt: 'Horse trotting on dusty trail, old west', duration: 6, loop: false },
    horse_neigh: { prompt: 'Horse neighing, western setting', duration: 3, loop: false },
    gunshot_revolver: { prompt: 'Revolver gunshot, western pistol firing', duration: 2, loop: false },
    gunshot_rifle: { prompt: 'Rifle shot, western long gun', duration: 2, loop: false },
    spurs_walking: { prompt: 'Cowboy spurs jingling while walking, boots on wood', duration: 4, loop: false },
    desert_wind: { prompt: 'Desert wind blowing, tumbleweeds, dry and hot', duration: 12, loop: true },
    town_ambient: { prompt: 'Western town ambient, horses, distant conversation, frontier life', duration: 15, loop: true },
    train_whistle: { prompt: 'Steam train whistle, old western locomotive', duration: 4, loop: false },
    train_moving: { prompt: 'Steam train moving, chugging along tracks, rhythmic', duration: 12, loop: true },
    campfire_western: { prompt: 'Campfire under stars, crackling, coyotes distant', duration: 12, loop: true },
    harmonica: { prompt: 'Lonely harmonica playing, western atmosphere', duration: 8, loop: false }
  },

  // ============================================
  // STEAMPUNK / VICTORIAN
  // ============================================
  steampunk: {
    steam_hiss: { prompt: 'Steam hissing from pipes, pressure release, industrial', duration: 4, loop: false },
    gears_turning: { prompt: 'Large gears turning, clockwork mechanism, mechanical', duration: 8, loop: true },
    airship_engine: { prompt: 'Steampunk airship engine, propellers, steam power', duration: 12, loop: true },
    clockwork: { prompt: 'Clockwork mechanism ticking, intricate gears, precision', duration: 10, loop: true },
    factory_ambient: { prompt: 'Victorian factory ambiance, machines working, industrial', duration: 15, loop: true },
    telegraph: { prompt: 'Telegraph machine clicking, morse code transmission', duration: 4, loop: false },
    goggles_adjust: { prompt: 'Brass goggles being adjusted, leather and metal', duration: 2, loop: false },
    pressure_valve: { prompt: 'Pressure valve releasing, steam burst, mechanical', duration: 3, loop: false },
    victorian_street: { prompt: 'Victorian London street, horse carriages, fog, gaslight', duration: 15, loop: true }
  },

  // ============================================
  // POST-APOCALYPTIC
  // ============================================
  postapoc: {
    wind_wasteland: { prompt: 'Desolate wasteland wind, emptiness, abandoned', duration: 15, loop: true },
    geiger_counter: { prompt: 'Geiger counter clicking, radiation, danger', duration: 6, loop: false },
    ruins_crumble: { prompt: 'Building debris crumbling, ruins collapsing, decay', duration: 4, loop: false },
    radio_static_old: { prompt: 'Old radio static, searching for signal, post-apocalyptic', duration: 6, loop: false },
    distant_explosion: { prompt: 'Distant explosion, war sounds, destruction', duration: 5, loop: false },
    mutant_growl: { prompt: 'Mutated creature growling, irradiated beast, threatening', duration: 4, loop: false },
    bunker_ambient: { prompt: 'Underground bunker ambiance, generator hum, isolation', duration: 12, loop: true },
    scavenging: { prompt: 'Scavenging through debris, searching, survival', duration: 5, loop: false },
    fire_barrel: { prompt: 'Fire burning in barrel, survival camp, warmth', duration: 10, loop: true },
    survivor_camp: { prompt: 'Survivor camp ambient, fire, quiet conversations, vigilance', duration: 15, loop: true }
  },

  // ============================================
  // UNDERWATER / OCEAN
  // ============================================
  underwater: {
    underwater_ambient: { prompt: 'Deep underwater ambiance, muffled sounds, pressure, bubbles', duration: 15, loop: true },
    submarine_interior: { prompt: 'Submarine interior, sonar pings, metal creaking, depth', duration: 12, loop: true },
    sonar_ping: { prompt: 'Sonar ping, submarine detection, underwater signal', duration: 3, loop: false },
    diving_bubbles: { prompt: 'Scuba diving bubbles, breathing underwater', duration: 8, loop: true },
    whale_song: { prompt: 'Whale singing in distance, ocean depth, peaceful', duration: 10, loop: false },
    submarine_alarm: { prompt: 'Submarine emergency alarm, dive alert, pressure warning', duration: 5, loop: true },
    ocean_surface: { prompt: 'Ocean waves on surface, seagulls, coastal', duration: 15, loop: true },
    ship_creaking: { prompt: 'Ship hull creaking, wooden vessel, ocean voyage', duration: 10, loop: true }
  },

  // ============================================
  // UNIVERSAL EMOTIONAL ATMOSPHERE
  // ============================================
  atmosphere: {
    tension: { prompt: 'Tense atmosphere, low ominous drone, suspenseful', duration: 12, loop: true },
    tension_building: { prompt: 'Building tension, rising suspense, approaching danger', duration: 10, loop: false },
    peaceful: { prompt: 'Peaceful serene atmosphere, gentle ambient, calm', duration: 15, loop: true },
    mysterious: { prompt: 'Mysterious atmosphere, enigmatic ambient, curious mood', duration: 12, loop: true },
    triumphant: { prompt: 'Triumphant fanfare, victory, celebratory feeling', duration: 6, loop: false },
    sad: { prompt: 'Melancholic atmosphere, lonely wind, sorrowful ambiance', duration: 12, loop: true },
    epic: { prompt: 'Epic atmosphere, grand scale, heroic feeling', duration: 12, loop: true },
    dread: { prompt: 'Creeping dread, low drone, something wrong', duration: 12, loop: true },
    wonder: { prompt: 'Sense of wonder, discovery, awe-inspiring', duration: 10, loop: true },
    romantic: { prompt: 'Romantic atmosphere, soft and tender, heartfelt', duration: 12, loop: true },
    revelation: { prompt: 'Moment of revelation, realization, dramatic discovery', duration: 5, loop: false }
  }
};

/**
 * Genre detection patterns
 */
const GENRE_PATTERNS = {
  scifi: ['spaceship', 'starship', 'space station', 'hyperdrive', 'warp', 'galaxy', 'alien', 'robot', 'android', 'cyborg', 'laser', 'blaster', 'phaser', 'airlock', 'hull', 'bridge', 'captain', 'crew', 'cockpit', 'thrusters', 'reactor', 'quantum', 'nebula', 'asteroid', 'planet', 'moon', 'colony', 'terraformed', 'cybernetic', 'hologram', 'stasis', 'cryo', 'FTL', 'lightspeed', 'orbit'],
  cyberpunk: ['neon', 'chrome', 'implant', 'augmentation', 'megacorp', 'hacker', 'netrunner', 'cyberspace', 'neural', 'synthetic', 'replicant', 'dystopia', 'underground', 'black market', 'street', 'gang', 'fixer'],
  horror: ['horror', 'terrifying', 'creepy', 'haunted', 'ghost', 'demon', 'possessed', 'nightmare', 'blood', 'death', 'corpse', 'undead', 'zombie', 'monster', 'screaming', 'darkness', 'evil', 'cursed', 'supernatural'],
  fantasy: ['magic', 'wizard', 'witch', 'spell', 'dragon', 'elf', 'dwarf', 'orc', 'castle', 'kingdom', 'sword', 'shield', 'knight', 'quest', 'enchanted', 'mythical', 'tavern', 'potion', 'scroll', 'dungeon', 'throne', 'crown', 'medieval', 'ancient'],
  western: ['cowboy', 'sheriff', 'outlaw', 'saloon', 'frontier', 'ranch', 'cattle', 'revolver', 'holster', 'deputy', 'bounty', 'stagecoach', 'prairie', 'desert', 'dusty'],
  modern: ['phone', 'computer', 'car', 'office', 'apartment', 'city', 'street', 'traffic', 'subway', 'airport', 'hospital', 'school', 'restaurant', 'hotel'],
  steampunk: ['steam', 'clockwork', 'gears', 'brass', 'goggles', 'airship', 'zeppelin', 'victorian', 'automaton', 'dirigible', 'aether'],
  postapoc: ['wasteland', 'ruins', 'radiation', 'mutant', 'survivor', 'bunker', 'scavenge', 'fallout', 'apocalypse', 'collapse'],
  underwater: ['submarine', 'underwater', 'diving', 'ocean depths', 'sea floor', 'aquatic', 'sonar']
};

/**
 * Agent 1: Context Analyzer
 * Analyzes the story context to determine genre, setting, and appropriate sound palette
 */
export async function analyzeStoryContext(storyConfig, sceneText, outline) {
  const prompt = `You are an expert sound designer analyzing a story to determine appropriate sound effects.

STORY CONFIGURATION:
- Title: ${storyConfig.title || 'Unknown'}
- Genre/Style: ${storyConfig.genre || storyConfig.style || 'Unknown'}
- Setting: ${storyConfig.setting || 'Unknown'}
- Premise: ${storyConfig.premise || 'Unknown'}
- Special Requests: ${storyConfig.specialRequests || 'None'}

STORY OUTLINE (if available):
${outline ? JSON.stringify(outline, null, 2).substring(0, 1000) : 'Not available'}

CURRENT SCENE TEXT:
${sceneText.substring(0, 1500)}

Analyze this story and determine:
1. PRIMARY GENRE: What is the main genre/world type? (scifi, cyberpunk, horror, fantasy, western, modern, steampunk, postapoc, underwater)
2. SECONDARY GENRE: Is there a secondary genre influence? (or null)
3. SETTING TYPE: What is the specific setting? (e.g., "spaceship interior", "medieval castle", "modern city", "haunted house")
4. TIME PERIOD: When does this take place? (future, present, past, timeless)
5. MOOD: What is the overall mood? (tense, peaceful, mysterious, scary, epic, sad, romantic)
6. FORBIDDEN SOUNDS: What sounds would be COMPLETELY WRONG for this setting? List specific categories.

Respond ONLY with valid JSON in this exact format:
{
  "primaryGenre": "scifi",
  "secondaryGenre": null,
  "settingType": "spaceship interior",
  "timePeriod": "future",
  "mood": "tense",
  "forbiddenSounds": ["medieval weapons", "horses", "forest animals", "castles", "taverns"],
  "confidence": 0.95,
  "reasoning": "Brief explanation of why"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500
    });

    const content = response.choices[0].message.content.trim();
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    throw new Error('No JSON in response');
  } catch (error) {
    logger.error('[SFX Agent 1] Context analysis failed:', error.message);
    // Fallback: use pattern matching
    return fallbackContextAnalysis(storyConfig, sceneText);
  }
}

/**
 * Fallback context analysis using pattern matching
 */
function fallbackContextAnalysis(storyConfig, sceneText) {
  const combinedText = `${storyConfig.title || ''} ${storyConfig.genre || ''} ${storyConfig.setting || ''} ${storyConfig.premise || ''} ${sceneText}`.toLowerCase();

  let bestGenre = 'modern';
  let bestScore = 0;

  for (const [genre, patterns] of Object.entries(GENRE_PATTERNS)) {
    const score = patterns.filter(p => combinedText.includes(p.toLowerCase())).length;
    if (score > bestScore) {
      bestScore = score;
      bestGenre = genre;
    }
  }

  const forbiddenMap = {
    scifi: ['medieval weapons', 'horses', 'forest animals', 'castles', 'taverns', 'swords'],
    fantasy: ['computers', 'phones', 'cars', 'laser weapons', 'spaceships'],
    modern: ['medieval weapons', 'magic spells', 'dragons', 'castles'],
    horror: [],
    western: ['spaceships', 'computers', 'medieval weapons'],
    cyberpunk: ['medieval weapons', 'horses', 'forest animals'],
    steampunk: ['computers', 'phones', 'cars', 'spaceships'],
    postapoc: ['medieval weapons', 'horses'],
    underwater: ['desert', 'forest', 'fire']
  };

  return {
    primaryGenre: bestGenre,
    secondaryGenre: null,
    settingType: 'unknown',
    timePeriod: bestGenre === 'scifi' || bestGenre === 'cyberpunk' ? 'future' :
                bestGenre === 'fantasy' || bestGenre === 'western' ? 'past' : 'present',
    mood: 'neutral',
    forbiddenSounds: forbiddenMap[bestGenre] || [],
    confidence: 0.5,
    reasoning: 'Fallback pattern matching used'
  };
}

/**
 * SFX Level configurations - imported guidance for different levels
 */
const SFX_LEVEL_PROMPTS = {
  low: {
    targetRange: '4-6',
    guidance: `Identify 4-6 sound effects for this scene focusing on KEY moments only.
Include: 1-2 ambient/background sounds (environment, weather), 2-3 action sounds (footsteps, doors, objects), plus any explicitly mentioned sounds (hissing, beeping, humming).
Focus on the most impactful sound moments.`
  },
  medium: {
    targetRange: '6-10',
    guidance: `Identify 6-10 sound effects for this scene for an IMMERSIVE experience.
Include: 2-3 ambient layers (background, atmosphere, environmental), 3-4 action/movement sounds, 2-3 detail sounds.
Every explicitly mentioned sound MUST have an effect: hissing, humming, beeping, creaking, footsteps, breathing, etc.
Consider: continuous ambient sounds, character actions, environmental details.`
  },
  high: {
    targetRange: '10-18',
    guidance: `Identify 10-18 sound effects for MAXIMUM IMMERSION - this is "LOTS of sounds" mode!
There should almost NEVER be a moment without some sound playing.

REQUIRED CATEGORIES:
1. AMBIENT LAYERS (3-5): constant background sounds that SET THE SCENE
   - Primary ambient: engine hum, forest sounds, city noise, spaceship bridge
   - Secondary ambient: ventilation, distant machinery, weather, crowd murmur
   - Atmospheric tension: if suspenseful, add subtle dread/tension ambiance

2. ACTION SOUNDS (4-8): sounds triggered by CHARACTER ACTIONS and EVENTS
   - Footsteps (ALWAYS include when characters move)
   - Door operations (opening, closing, airlock cycling)
   - Object interactions (picking up, putting down, operating controls)
   - Physical actions (sitting, standing, reaching, gesturing)

3. DESCRIBED SOUNDS (MANDATORY): Any sound explicitly described in the text
   - "The console beeped" = computer_beep
   - "A hiss of escaping air" = airlock_open or steam_hiss
   - "The engine hummed" = ship_engine_idle
   - "A distant rumble" = rumble sound
   - "Static answers him" = comm_static or static_radio (RADIO/COMMUNICATION STATIC)
   - "A thin, dry hiss" = steam_hiss or comm_static (HISSING SOUND)
   - IF THE TEXT SAYS A SOUND, IT MUST HAVE AN SFX

4. ENVIRONMENTAL DETAILS (2-4): subtle background details
   - Equipment sounds: computers processing, life support, cooling fans
   - Structural sounds: metal settling, pressure changes, vibrations
   - Nature/weather: wind, rain, thunder, animals
   - Communication: radio static, interference, transmissions

CRITICAL: Read the text CAREFULLY for any sound description. Words like "whoosh", "hiss", "beep",
"hum", "creak", "thud", "crash", "rumble", "whir", "click", "static", "buzz", "crackle" MUST have corresponding sounds.
Also detect: "X answers" or "X responds" where X is an object (like "static answers") - this IS A SOUND!
Think like a film sound designer - every moment should have AUDIO TEXTURE!`
  }
};

/**
 * =============================================================================
 * LLM-BASED SOUND EXTRACTION AGENTS
 * =============================================================================
 *
 * Uses dedicated AI agents instead of regex for thorough sound detection.
 * Implements a "School Teacher" pattern with multiple passes and validation.
 */

/**
 * Agent: Sound Extraction Specialist (First Pass)
 * Thoroughly analyzes text for ALL sound opportunities - explicit and implied
 */
export async function extractSoundsFirstPass(sceneText, context, sfxLevel = 'medium') {
  const genreLibrary = GENRE_SFX_LIBRARY[context.primaryGenre] || GENRE_SFX_LIBRARY.modern;
  const availableSounds = Object.keys(genreLibrary);
  const atmosphereSounds = Object.keys(GENRE_SFX_LIBRARY.atmosphere);

  const levelTargets = {
    low: { min: 4, max: 6, description: 'key moments only' },
    medium: { min: 6, max: 10, description: 'immersive experience' },
    high: { min: 10, max: 18, description: 'MAXIMUM immersion - lots of sounds' }
  };
  const target = levelTargets[sfxLevel] || levelTargets.medium;

  const prompt = `You are an expert film sound designer analyzing a scene for sound effect opportunities.
Your job is to be THOROUGH and find EVERY possible sound - both explicit and implied.

## SCENE CONTEXT
- Genre: ${context.primaryGenre}${context.secondaryGenre ? ` / ${context.secondaryGenre}` : ''}
- Setting: ${context.settingType}
- Mood: ${context.mood}
- SFX Level: ${sfxLevel.toUpperCase()} (target: ${target.min}-${target.max} sounds for ${target.description})

## AVAILABLE SOUNDS FOR ${context.primaryGenre.toUpperCase()}:
${availableSounds.join(', ')}

## ATMOSPHERE SOUNDS (any genre):
${atmosphereSounds.join(', ')}

## SCENE TEXT TO ANALYZE:
"""
${sceneText}
"""

## YOUR TASK
Find ALL sound opportunities in this scene. Think like a Hollywood sound designer creating a rich soundscape.

### CATEGORY 1: EXPLICIT SOUNDS (MANDATORY - never miss these!)
Look for ANY word that describes a sound:
- Onomatopoeia: whoosh, hiss, beep, buzz, hum, click, clang, thud, crash, bang, etc.
- Sound verbs: "the door hissed", "the console beeped", "footsteps echoed"
- Sound descriptions: "with a soft pneumatic release", "accompanied by a warning tone"

### CATEGORY 2: IMPLIED SOUNDS (from actions)
Actions that MUST have sound even if not explicitly described:
- Character movement: walking, running, sitting, standing → footsteps, chair sounds
- Door operations: opening, closing, entering, exiting → door sounds
- Object interactions: picking up, putting down, pressing buttons → interaction sounds
- Vehicles/machines: operating, starting, stopping → mechanical sounds

### CATEGORY 3: ENVIRONMENTAL/AMBIENT SOUNDS
Background sounds that establish the setting:
- Location ambiance: spaceship bridge, forest, city, dungeon
- Weather: rain, wind, thunder
- Continuous sounds: engine hum, ventilation, crowd murmur

### CATEGORY 4: EMOTIONAL/ATMOSPHERIC SOUNDS
Sounds that enhance the mood:
- Tension: low drones, subtle unease
- Action: energy, urgency
- Peace: calm, serene ambiance
- Horror: dread, creeping fear

For EACH sound found, provide:
1. The EXACT quote or description from the text that triggers this sound
2. Whether it's explicit (described) or implied (from action)
3. The best matching sound from the available list
4. When it should play (beginning, during specific action, continuous, end)

Respond with JSON only:
{
  "sounds": [
    {
      "trigger": "exact quote or description from text",
      "type": "explicit|implied|ambient|atmospheric",
      "soundKey": "exact_key_from_available_list",
      "category": "${context.primaryGenre}|atmosphere",
      "timing": "beginning|middle|end|continuous|on_action",
      "reason": "why this sound fits",
      "importance": "critical|high|medium|low"
    }
  ],
  "analysis": {
    "explicitCount": 0,
    "impliedCount": 0,
    "ambientCount": 0,
    "totalFound": 0
  }
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      max_tokens: 2500
    });

    const content = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      logger.info(`[SFX First Pass] Found ${result.sounds?.length || 0} sounds (explicit: ${result.analysis?.explicitCount || 0}, implied: ${result.analysis?.impliedCount || 0})`);
      return result;
    }
    throw new Error('No JSON in response');
  } catch (error) {
    logger.error('[SFX First Pass] Extraction failed:', error.message);
    return { sounds: [], analysis: { error: error.message } };
  }
}

/**
 * Agent: Sound Extraction Specialist (Second Pass)
 * Reviews with fresh perspective, specifically looking for missed sounds
 */
export async function extractSoundsSecondPass(sceneText, context, firstPassSounds, sfxLevel = 'medium') {
  const genreLibrary = GENRE_SFX_LIBRARY[context.primaryGenre] || GENRE_SFX_LIBRARY.modern;
  const availableSounds = Object.keys(genreLibrary);
  const atmosphereSounds = Object.keys(GENRE_SFX_LIBRARY.atmosphere);

  // Format first pass results for review
  const firstPassSummary = (firstPassSounds.sounds || []).map(s =>
    `- ${s.soundKey}: "${s.trigger}" (${s.type})`
  ).join('\n');

  const prompt = `You are a SENIOR sound designer reviewing a junior designer's work.
Your job is to find sounds they MISSED. Be critical and thorough.

## SCENE CONTEXT
- Genre: ${context.primaryGenre}
- Setting: ${context.settingType}
- Mood: ${context.mood}
- SFX Level: ${sfxLevel.toUpperCase()}

## SCENE TEXT:
"""
${sceneText}
"""

## SOUNDS ALREADY IDENTIFIED (First Pass):
${firstPassSummary || 'None identified yet'}

## AVAILABLE SOUNDS:
${context.primaryGenre}: ${availableSounds.join(', ')}
atmosphere: ${atmosphereSounds.join(', ')}

## YOUR CRITICAL REVIEW TASK

Read the scene CAREFULLY and find sounds the first pass MISSED:

1. **MISSED EXPLICIT SOUNDS**: Are there any sound words (hiss, beep, whoosh, click, etc.) not captured?
   - Read each sentence. Does it mention or describe a sound?

2. **MISSED IMPLIED SOUNDS**: Are there actions without accompanying sounds?
   - Does anyone walk/move? → footsteps needed
   - Are there doors/hatches? → door sounds needed
   - Any button presses or controls? → interface sounds
   - Any machinery operating? → mechanical sounds

3. **MISSING AMBIENT LAYERS**: Is the environment properly established?
   - What's the background sound of this location?
   - Is there continuous environmental audio?

4. **MISSING EMOTIONAL SOUNDS**: Does the mood have sonic support?
   - Tense scene without tension sound?
   - Peaceful scene without calm ambiance?

5. **DUPLICATES OR BETTER MATCHES**: Are any first-pass choices wrong?
   - Wrong sound for the genre?
   - Better alternative available?

BE AGGRESSIVE - if you're unsure whether something needs sound, it probably does.
${sfxLevel === 'high' ? 'This is LOTS MODE - err on the side of MORE sounds!' : ''}

Respond with JSON:
{
  "missedSounds": [
    {
      "trigger": "what was missed - quote or description",
      "type": "explicit|implied|ambient|atmospheric",
      "soundKey": "correct_key_from_list",
      "category": "${context.primaryGenre}|atmosphere",
      "timing": "when it plays",
      "reason": "why this was missed and why it matters",
      "importance": "critical|high|medium"
    }
  ],
  "corrections": [
    {
      "originalSoundKey": "what first pass said",
      "correctedSoundKey": "better choice",
      "reason": "why this is better"
    }
  ],
  "reviewNotes": "Overall assessment of first pass quality"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens: 2000
    });

    const content = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      logger.info(`[SFX Second Pass] Found ${result.missedSounds?.length || 0} missed sounds, ${result.corrections?.length || 0} corrections`);
      return result;
    }
    throw new Error('No JSON in response');
  } catch (error) {
    logger.error('[SFX Second Pass] Review failed:', error.message);
    return { missedSounds: [], corrections: [], reviewNotes: 'Review failed: ' + error.message };
  }
}

/**
 * Agent: Sound Design Teacher (Final Validation)
 * The "School Teacher" that validates the combined work of both passes
 */
export async function teacherValidateSounds(sceneText, context, combinedSounds, sfxLevel = 'medium') {
  const genreLibrary = GENRE_SFX_LIBRARY[context.primaryGenre] || GENRE_SFX_LIBRARY.modern;
  const availableSounds = Object.keys(genreLibrary);

  const levelTargets = {
    low: { min: 4, max: 6 },
    medium: { min: 6, max: 10 },
    high: { min: 10, max: 18 }
  };
  const target = levelTargets[sfxLevel] || levelTargets.medium;

  const soundsSummary = combinedSounds.map((s, i) =>
    `${i + 1}. ${s.soundKey} (${s.category}) - "${s.trigger}" [${s.type}]`
  ).join('\n');

  const prompt = `You are the HEAD SOUND DESIGNER (the "Teacher") doing final quality control.
Review the work of your team and ensure nothing was missed and everything is appropriate.

## SCENE CONTEXT
- Genre: ${context.primaryGenre}
- Setting: ${context.settingType}
- Mood: ${context.mood}
- Forbidden sounds: ${context.forbiddenSounds?.join(', ') || 'none'}
- Target: ${target.min}-${target.max} sounds (level: ${sfxLevel})

## SCENE TEXT:
"""
${sceneText}
"""

## PROPOSED SOUND DESIGN (${combinedSounds.length} sounds):
${soundsSummary}

## AVAILABLE SOUNDS FOR REFERENCE:
${availableSounds.join(', ')}

## YOUR FINAL REVIEW

As the Teacher, you must:

1. **VERIFY COMPLETENESS**: Is every sound-worthy moment covered?
   - Count: Do we have enough sounds for ${sfxLevel} level?
   - Coverage: Any obvious gaps in the soundscape?
   - Explicit sounds: Were ALL described sounds captured?

2. **CHECK APPROPRIATENESS**: Is each sound right for the genre?
   - No medieval sounds in sci-fi
   - No futuristic sounds in fantasy
   - Mood-appropriate choices

3. **VALIDATE QUALITY**: Rate the overall sound design
   - Would this sound good in a film/audiobook?
   - Is the timing logical?
   - Are there redundant sounds?

4. **FINAL ADDITIONS**: If ANYTHING is still missing, add it now.
   This is the LAST CHANCE to catch missing sounds.

Respond with JSON:
{
  "approved": [0, 1, 2],
  "rejected": [
    { "index": 3, "reason": "why rejected" }
  ],
  "finalAdditions": [
    {
      "soundKey": "key_from_list",
      "category": "${context.primaryGenre}|atmosphere",
      "trigger": "what triggers this",
      "timing": "when",
      "reason": "why this MUST be added"
    }
  ],
  "overallScore": 0.0,
  "grade": "A|B|C|D|F",
  "feedback": "Detailed feedback on the sound design quality",
  "missingCritical": false
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 1500
    });

    const content = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      logger.info(`[SFX Teacher] Grade: ${result.grade}, Score: ${result.overallScore}, Additions: ${result.finalAdditions?.length || 0}`);
      return result;
    }
    throw new Error('No JSON in response');
  } catch (error) {
    logger.error('[SFX Teacher] Validation failed:', error.message);
    return {
      approved: combinedSounds.map((_, i) => i),
      rejected: [],
      finalAdditions: [],
      overallScore: 0.5,
      grade: 'C',
      feedback: 'Validation failed, approving all sounds by default'
    };
  }
}

/**
 * Combine and deduplicate sounds from multiple passes
 */
function combineSoundPasses(firstPass, secondPass, context) {
  const combined = [];
  const seenKeys = new Set();

  // Add first pass sounds
  for (const sound of (firstPass.sounds || [])) {
    const key = `${sound.soundKey}-${sound.trigger?.substring(0, 30)}`;
    if (!seenKeys.has(key) && sound.soundKey) {
      combined.push({
        ...sound,
        source: 'first_pass'
      });
      seenKeys.add(key);
    }
  }

  // Add second pass missed sounds
  for (const sound of (secondPass.missedSounds || [])) {
    const key = `${sound.soundKey}-${sound.trigger?.substring(0, 30)}`;
    if (!seenKeys.has(key) && sound.soundKey) {
      combined.push({
        ...sound,
        source: 'second_pass'
      });
      seenKeys.add(key);
    }
  }

  // Apply corrections from second pass
  for (const correction of (secondPass.corrections || [])) {
    const idx = combined.findIndex(s => s.soundKey === correction.originalSoundKey);
    if (idx >= 0) {
      combined[idx].soundKey = correction.correctedSoundKey;
      combined[idx].corrected = true;
      combined[idx].correctionReason = correction.reason;
    }
  }

  logger.info(`[SFX Combine] Combined ${combined.length} sounds from both passes`);
  return combined;
}

/**
 * Genre-aware sound remapping
 * Maps sounds to appropriate library entries based on genre
 */
function remapSoundForGenre(soundKey, category, primaryGenre) {
  const genreRemaps = {
    scifi: {
      'door_creak': 'door_scifi',
      'door_wooden_open': 'door_scifi',
      'footsteps_stone': 'footsteps_metal',
      'footsteps_forest': 'footsteps_metal',
      'breathing_heavy': 'spacewalk',
      'basement_drip': 'cryo_chamber',
    },
    fantasy: {
      'door_scifi': 'door_wooden_open',
      'footsteps_metal': 'footsteps_stone',
      'computer_beep': 'magic_ambient',
      'red_alert': 'battle_distant',
    },
    horror: {
      'door_scifi': 'door_creak',
      'computer_beep': 'static_tv',
    },
    modern: {
      'door_scifi': 'elevator_modern',
      'footsteps_metal': 'footsteps_concrete',
    }
  };

  const remaps = genreRemaps[primaryGenre];
  if (remaps && remaps[soundKey]) {
    return { soundKey: remaps[soundKey], category: primaryGenre };
  }

  return { soundKey, category };
}

/**
 * Agent 2: Scene SFX Detector
 * Analyzes scene text to identify specific sound opportunities
 */
export async function detectSceneSounds(sceneText, context, sfxLevel = 'medium') {
  const genreLibrary = GENRE_SFX_LIBRARY[context.primaryGenre] || GENRE_SFX_LIBRARY.modern;
  const availableSounds = Object.keys(genreLibrary);

  // Get level-specific prompt guidance
  const levelConfig = SFX_LEVEL_PROMPTS[sfxLevel] || SFX_LEVEL_PROMPTS.medium;

  const prompt = `You are an expert sound designer detecting sound effect opportunities in a scene.

STORY CONTEXT:
- Genre: ${context.primaryGenre}${context.secondaryGenre ? ` / ${context.secondaryGenre}` : ''}
- Setting: ${context.settingType}
- Mood: ${context.mood}
- FORBIDDEN (never use): ${context.forbiddenSounds.join(', ')}

SFX LEVEL: ${sfxLevel.toUpperCase()} (target: ${levelConfig.targetRange} effects)

AVAILABLE SOUNDS FOR THIS GENRE (${context.primaryGenre}):
${availableSounds.join(', ')}

ALSO AVAILABLE (atmosphere - any genre):
tension, tension_building, peaceful, mysterious, triumphant, sad, epic, dread, wonder, romantic, revelation

SCENE TEXT TO ANALYZE:
"${sceneText}"

${levelConfig.guidance}

For each sound:
1. Choose from the available sounds listed above
2. Explain exactly WHEN in the scene it should play
3. Give a timing hint (beginning, middle, end, continuous)

CRITICAL RULES:
- Use sounds from the ${context.primaryGenre} genre, atmosphere, or scifi/horror if appropriate
- NEVER suggest sounds that are in the forbidden list
- Every described sound effect in the text MUST have a corresponding SFX
- If a character walks, use the appropriate footsteps for this setting
- Include atmospheric sounds even if not explicitly mentioned
${sfxLevel === 'high' ? '- For LOTS mode: err on the side of MORE sounds - layer multiple ambients, include subtle sounds!' : ''}

Respond ONLY with valid JSON:
{
  "sounds": [
    {
      "soundKey": "exact_key_from_list",
      "category": "${context.primaryGenre}",
      "timing": "beginning",
      "trigger": "Quote or describe the exact moment this plays",
      "reason": "Why this sound fits"
    }
  ],
  "confidence": 0.9
}`;

  // Scale max_tokens based on level - high needs more for 10-18 sounds
  const maxTokens = sfxLevel === 'high' ? 2000 : sfxLevel === 'medium' ? 1500 : 1000;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: sfxLevel === 'high' ? 0.6 : 0.5, // Slightly higher creativity for LOTS mode
      max_tokens: maxTokens
    });

    const content = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      // Validate that sounds actually exist
      result.sounds = result.sounds.filter(s => {
        const lib = GENRE_SFX_LIBRARY[s.category] || GENRE_SFX_LIBRARY.atmosphere;
        return lib && lib[s.soundKey];
      });
      return result;
    }
    throw new Error('No JSON in response');
  } catch (error) {
    logger.error('[SFX Agent 2] Sound detection failed:', error.message);
    return { sounds: [], confidence: 0 };
  }
}

/**
 * Agent 3: Library Matcher
 * Maps detected sounds to actual library entries and prepares for generation
 */
export function matchToLibrary(detectedSounds, context) {
  const results = [];

  for (const sound of detectedSounds.sounds || []) {
    const library = GENRE_SFX_LIBRARY[sound.category] || GENRE_SFX_LIBRARY[context.primaryGenre] || GENRE_SFX_LIBRARY.atmosphere;
    const sfxDef = library[sound.soundKey];

    if (sfxDef) {
      results.push({
        sfxKey: `${sound.category}.${sound.soundKey}`,
        name: sound.soundKey.replace(/_/g, ' '),
        category: sound.category,
        prompt: sfxDef.prompt,
        duration: sfxDef.duration,
        loop: sfxDef.loop,
        timing: sound.timing,
        trigger: sound.trigger,
        reason: sound.reason,
        status: 'pending'
      });
    }
  }

  return results;
}

/**
 * Agent 4: SFX Validator
 * Quality check for appropriateness and consistency
 */
export async function validateSFXList(sfxList, context, sceneText) {
  if (sfxList.length === 0) {
    return { valid: true, sfxList: [], issues: [] };
  }

  const prompt = `You are a quality assurance specialist validating sound effects for a story scene.

STORY CONTEXT:
- Genre: ${context.primaryGenre}
- Setting: ${context.settingType}
- Mood: ${context.mood}
- FORBIDDEN sounds: ${context.forbiddenSounds.join(', ')}

SCENE TEXT:
"${sceneText.substring(0, 1000)}"

PROPOSED SOUND EFFECTS:
${sfxList.map((s, i) => `${i + 1}. ${s.name} (${s.category}) - Timing: ${s.timing}
   Trigger: "${s.trigger}"
   Reason: ${s.reason}`).join('\n\n')}

VALIDATION TASKS:
1. Check each sound is appropriate for the ${context.primaryGenre} genre
2. Verify no forbidden sounds are included
3. Confirm the trigger moments actually exist in the scene text
4. Check for timing conflicts (two sounds at same moment)
5. Rate overall quality and coherence

Respond with JSON:
{
  "approved": [0, 1],  // indices of approved sounds
  "rejected": [
    { "index": 2, "reason": "Why rejected" }
  ],
  "issues": ["Any general issues"],
  "overallScore": 0.85,
  "feedback": "Overall assessment"
}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
      max_tokens: 400
    });

    const content = response.choices[0].message.content.trim();
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const validation = JSON.parse(jsonMatch[0]);

      // Filter to only approved sounds
      const approvedSfx = (validation.approved || []).map(i => sfxList[i]).filter(Boolean);

      return {
        valid: validation.overallScore >= 0.6,
        sfxList: approvedSfx,
        issues: validation.issues || [],
        rejected: validation.rejected || [],
        score: validation.overallScore,
        feedback: validation.feedback
      };
    }
    throw new Error('No JSON in response');
  } catch (error) {
    logger.error('[SFX Agent 4] Validation failed:', error.message);
    // On failure, return original list with warning
    return {
      valid: true,
      sfxList,
      issues: ['Validation skipped due to error'],
      score: 0.5
    };
  }
}

/**
 * Main orchestrator: Run the full multi-agent SFX detection pipeline
 * Uses "School Teacher" pattern with multiple LLM passes and validation
 *
 * @param {string} sceneText - The scene text to analyze
 * @param {object} storyConfig - Story configuration
 * @param {object} outline - Story outline (optional)
 * @param {string} sfxLevel - SFX level: 'low', 'medium', or 'high' (default: 'medium')
 */
export async function detectSFXMultiAgent(sceneText, storyConfig, outline = null, sfxLevel = 'medium') {
  logger.info(`[SFX Multi-Agent] Starting "School Teacher" pipeline (level: ${sfxLevel})`);
  logger.info(`[SFX Multi-Agent] Scene text length: ${sceneText.length} chars`);

  const startTime = Date.now();
  const pipeline = {
    context: null,
    firstPass: null,
    secondPass: null,
    combined: null,
    matched: null,
    teacherReview: null,
    errors: []
  };

  try {
    // =========================================================================
    // STEP 1: Context Analysis
    // =========================================================================
    logger.info('[SFX Pipeline] Step 1/6: Analyzing story context...');
    pipeline.context = await analyzeStoryContext(storyConfig, sceneText, outline);
    logger.info(`[SFX Pipeline] Context: genre=${pipeline.context.primaryGenre}, mood=${pipeline.context.mood}, setting=${pipeline.context.settingType}`);

    // =========================================================================
    // STEP 2: First Pass - Sound Extraction Agent
    // =========================================================================
    logger.info('[SFX Pipeline] Step 2/6: First Pass - Sound Extraction Agent analyzing scene...');
    pipeline.firstPass = await extractSoundsFirstPass(sceneText, pipeline.context, sfxLevel);
    const firstPassCount = pipeline.firstPass.sounds?.length || 0;
    logger.info(`[SFX Pipeline] First Pass found ${firstPassCount} sounds`);

    // =========================================================================
    // STEP 3: Second Pass - Critical Review Agent
    // =========================================================================
    logger.info('[SFX Pipeline] Step 3/6: Second Pass - Senior Designer reviewing for missed sounds...');
    pipeline.secondPass = await extractSoundsSecondPass(sceneText, pipeline.context, pipeline.firstPass, sfxLevel);
    const missedCount = pipeline.secondPass.missedSounds?.length || 0;
    const correctionCount = pipeline.secondPass.corrections?.length || 0;
    logger.info(`[SFX Pipeline] Second Pass found ${missedCount} missed sounds, ${correctionCount} corrections`);

    // =========================================================================
    // STEP 4: Combine and Deduplicate
    // =========================================================================
    logger.info('[SFX Pipeline] Step 4/6: Combining sounds from both passes...');
    pipeline.combined = combineSoundPasses(pipeline.firstPass, pipeline.secondPass, pipeline.context);
    logger.info(`[SFX Pipeline] Combined total: ${pipeline.combined.length} unique sounds`);

    // =========================================================================
    // STEP 5: Match to Library
    // =========================================================================
    logger.info('[SFX Pipeline] Step 5/6: Matching sounds to library entries...');
    pipeline.matched = [];

    for (const sound of pipeline.combined) {
      // Try to find in genre library first
      let library = GENRE_SFX_LIBRARY[sound.category] || GENRE_SFX_LIBRARY[pipeline.context.primaryGenre];
      let sfxDef = library?.[sound.soundKey];

      // Try atmosphere library if not found
      if (!sfxDef) {
        library = GENRE_SFX_LIBRARY.atmosphere;
        sfxDef = library?.[sound.soundKey];
      }

      // Try genre remapping if still not found
      if (!sfxDef) {
        const remapped = remapSoundForGenre(sound.soundKey, sound.category, pipeline.context.primaryGenre);
        library = GENRE_SFX_LIBRARY[remapped.category] || GENRE_SFX_LIBRARY[pipeline.context.primaryGenre];
        sfxDef = library?.[remapped.soundKey];
        if (sfxDef) {
          sound.soundKey = remapped.soundKey;
          sound.category = remapped.category;
        }
      }

      if (sfxDef) {
        pipeline.matched.push({
          sfxKey: `${sound.category}.${sound.soundKey}`,
          name: sound.soundKey.replace(/_/g, ' '),
          category: sound.category,
          prompt: sfxDef.prompt,
          duration: sfxDef.duration,
          loop: sfxDef.loop,
          timing: sound.timing || 'contextual',
          trigger: sound.trigger,
          reason: sound.reason,
          type: sound.type,
          importance: sound.importance,
          source: sound.source,
          status: 'pending'
        });
      } else {
        logger.warn(`[SFX Pipeline] Could not match sound: ${sound.soundKey} (${sound.category})`);
      }
    }
    logger.info(`[SFX Pipeline] Matched ${pipeline.matched.length} of ${pipeline.combined.length} sounds to library`);

    // =========================================================================
    // STEP 6: Teacher Validation (Final QC)
    // =========================================================================
    logger.info('[SFX Pipeline] Step 6/6: Teacher Agent doing final quality control...');
    pipeline.teacherReview = await teacherValidateSounds(sceneText, pipeline.context, pipeline.matched, sfxLevel);
    logger.info(`[SFX Pipeline] Teacher grade: ${pipeline.teacherReview.grade}, score: ${pipeline.teacherReview.overallScore}`);

    // Apply teacher's decisions
    let finalSfxList = [];

    // Add approved sounds
    for (const idx of (pipeline.teacherReview.approved || [])) {
      if (pipeline.matched[idx]) {
        finalSfxList.push(pipeline.matched[idx]);
      }
    }

    // Add teacher's final additions
    for (const addition of (pipeline.teacherReview.finalAdditions || [])) {
      const library = GENRE_SFX_LIBRARY[addition.category] || GENRE_SFX_LIBRARY[pipeline.context.primaryGenre] || GENRE_SFX_LIBRARY.atmosphere;
      const sfxDef = library?.[addition.soundKey];

      if (sfxDef) {
        finalSfxList.push({
          sfxKey: `${addition.category}.${addition.soundKey}`,
          name: addition.soundKey.replace(/_/g, ' '),
          category: addition.category,
          prompt: sfxDef.prompt,
          duration: sfxDef.duration,
          loop: sfxDef.loop,
          timing: addition.timing || 'contextual',
          trigger: addition.trigger,
          reason: addition.reason,
          source: 'teacher_addition',
          status: 'pending'
        });
        logger.info(`[SFX Pipeline] Teacher added: ${addition.soundKey} - "${addition.reason}"`);
      }
    }

    // Log rejections
    for (const rejection of (pipeline.teacherReview.rejected || [])) {
      logger.info(`[SFX Pipeline] Teacher rejected sound #${rejection.index}: ${rejection.reason}`);
    }

    // =========================================================================
    // STEP 7: Guaranteed Ambient Fallback
    // =========================================================================
    // If no sounds were detected, add at least one genre-appropriate ambient sound
    // This ensures stories NEVER have zero SFX
    if (finalSfxList.length === 0) {
      logger.warn('[SFX Pipeline] No sounds detected! Adding guaranteed ambient fallback...');

      // Select genre-appropriate ambient based on context
      const genreFallbacks = {
        scifi: { key: 'space_station', category: 'scifi', name: 'space station ambient' },
        cyberpunk: { key: 'neon_buzz', category: 'cyberpunk', name: 'neon buzz ambient' },
        horror: { key: 'tension_building', category: 'horror', name: 'tension building' },
        fantasy: { key: 'forest_day', category: 'fantasy', name: 'forest ambiance' },
        western: { key: 'desert_wind', category: 'western', name: 'desert wind' },
        modern: { key: 'city_traffic', category: 'modern', name: 'city ambiance' },
        steampunk: { key: 'gears_turning', category: 'steampunk', name: 'clockwork gears' },
        postapoc: { key: 'wind_wasteland', category: 'postapoc', name: 'wasteland wind' },
        underwater: { key: 'underwater_ambient', category: 'underwater', name: 'underwater ambiance' }
      };

      const fallback = genreFallbacks[pipeline.context.primaryGenre] || genreFallbacks.modern;
      const library = GENRE_SFX_LIBRARY[fallback.category];
      const sfxDef = library?.[fallback.key];

      if (sfxDef) {
        finalSfxList.push({
          sfxKey: `${fallback.category}.${fallback.key}`,
          name: fallback.name,
          category: fallback.category,
          prompt: sfxDef.prompt,
          duration: sfxDef.duration,
          loop: sfxDef.loop,
          timing: 'continuous',
          trigger: 'Automatic ambient for scene',
          reason: `Fallback ambient sound for ${pipeline.context.primaryGenre} genre`,
          type: 'ambient',
          importance: 'high',
          source: 'guaranteed_fallback',
          status: 'pending'
        });
        logger.info(`[SFX Pipeline] Added fallback ambient: ${fallback.category}.${fallback.key}`);
      }

      // Also add atmospheric sound based on mood
      const moodFallbacks = {
        tense: 'tension',
        scary: 'dread',
        mysterious: 'mysterious',
        peaceful: 'peaceful',
        epic: 'epic',
        sad: 'sad',
        romantic: 'romantic'
      };

      const moodKey = moodFallbacks[pipeline.context.mood?.toLowerCase()];
      if (moodKey && GENRE_SFX_LIBRARY.atmosphere[moodKey]) {
        const atmosphereDef = GENRE_SFX_LIBRARY.atmosphere[moodKey];
        finalSfxList.push({
          sfxKey: `atmosphere.${moodKey}`,
          name: `${moodKey} atmosphere`,
          category: 'atmosphere',
          prompt: atmosphereDef.prompt,
          duration: atmosphereDef.duration,
          loop: atmosphereDef.loop,
          timing: 'continuous',
          trigger: `Scene mood: ${pipeline.context.mood}`,
          reason: `Atmospheric sound for ${pipeline.context.mood} mood`,
          type: 'atmospheric',
          importance: 'medium',
          source: 'mood_fallback',
          status: 'pending'
        });
        logger.info(`[SFX Pipeline] Added mood atmosphere: atmosphere.${moodKey}`);
      }
    }

    // =========================================================================
    // STEP 8: Enforce Minimum Counts Based on SFX Level
    // =========================================================================
    // If we're below the minimum for the selected level, add more genre-appropriate sounds
    const levelMinimums = {
      low: 4,
      medium: 6,
      high: 10
    };

    const targetMinimum = levelMinimums[sfxLevel] || levelMinimums.medium;

    if (finalSfxList.length < targetMinimum) {
      logger.warn(`[SFX Pipeline] Below target minimum (${finalSfxList.length}/${targetMinimum}) for ${sfxLevel} level - adding supplemental sounds`);

      // Define supplemental sounds for each genre
      const supplementalSounds = {
        scifi: [
          { key: 'ship_engine_idle', category: 'scifi', timing: 'continuous' },
          { key: 'computer_beep', category: 'scifi', timing: 'middle' },
          { key: 'door_whoosh', category: 'scifi', timing: 'on_action' },
          { key: 'comm_static', category: 'scifi', timing: 'beginning' },
          { key: 'hologram_flicker', category: 'scifi', timing: 'middle' },
          { key: 'scanner_pulse', category: 'scifi', timing: 'on_action' }
        ],
        horror: [
          { key: 'creepy_whisper', category: 'horror', timing: 'middle' },
          { key: 'floor_creak', category: 'horror', timing: 'on_action' },
          { key: 'distant_scream', category: 'horror', timing: 'end' },
          { key: 'heartbeat_slow', category: 'horror', timing: 'continuous' },
          { key: 'door_creak', category: 'horror', timing: 'on_action' },
          { key: 'wind_howl', category: 'horror', timing: 'beginning' }
        ],
        fantasy: [
          { key: 'forest_ambient', category: 'fantasy', timing: 'continuous' },
          { key: 'magic_shimmer', category: 'fantasy', timing: 'on_action' },
          { key: 'sword_unsheathe', category: 'fantasy', timing: 'on_action' },
          { key: 'torch_crackle', category: 'fantasy', timing: 'continuous' },
          { key: 'bird_song', category: 'fantasy', timing: 'beginning' },
          { key: 'wind_gentle', category: 'fantasy', timing: 'continuous' }
        ],
        cyberpunk: [
          { key: 'neon_buzz', category: 'cyberpunk', timing: 'continuous' },
          { key: 'rain_on_metal', category: 'cyberpunk', timing: 'continuous' },
          { key: 'crowd_chatter', category: 'cyberpunk', timing: 'beginning' },
          { key: 'drone_flyby', category: 'cyberpunk', timing: 'middle' },
          { key: 'hologram_glitch', category: 'cyberpunk', timing: 'on_action' },
          { key: 'electric_hum', category: 'cyberpunk', timing: 'continuous' }
        ],
        modern: [
          { key: 'city_traffic', category: 'modern', timing: 'continuous' },
          { key: 'footsteps_concrete', category: 'modern', timing: 'on_action' },
          { key: 'phone_notification', category: 'modern', timing: 'on_action' },
          { key: 'door_open', category: 'modern', timing: 'on_action' },
          { key: 'keyboard_typing', category: 'modern', timing: 'continuous' },
          { key: 'car_pass', category: 'modern', timing: 'middle' }
        ]
      };

      // Get existing sfx keys to avoid duplicates
      const existingKeys = new Set(finalSfxList.map(s => s.sfxKey));

      // Get supplemental sounds for this genre (or default to modern)
      const genreSupplements = supplementalSounds[pipeline.context.primaryGenre] ||
                               supplementalSounds.modern;

      // Add sounds until we reach minimum
      for (const supp of genreSupplements) {
        if (finalSfxList.length >= targetMinimum) break;

        const sfxKey = `${supp.category}.${supp.key}`;
        if (existingKeys.has(sfxKey)) continue;

        const library = GENRE_SFX_LIBRARY[supp.category];
        const sfxDef = library?.[supp.key];

        if (sfxDef) {
          finalSfxList.push({
            sfxKey,
            name: supp.key.replace(/_/g, ' '),
            category: supp.category,
            prompt: sfxDef.prompt,
            duration: sfxDef.duration,
            loop: sfxDef.loop,
            timing: supp.timing,
            trigger: 'Supplemental ambient for target count',
            reason: `Added to meet ${sfxLevel} level minimum (${targetMinimum} sounds)`,
            type: sfxDef.loop ? 'ambient' : 'one-shot',
            importance: 'medium',
            source: 'level_enforcement',
            status: 'pending'
          });
          existingKeys.add(sfxKey);
          logger.info(`[SFX Pipeline] Supplemental add: ${sfxKey} (timing: ${supp.timing})`);
        }
      }

      // If still below target, add atmosphere sounds
      if (finalSfxList.length < targetMinimum) {
        const atmosphereSounds = ['tension', 'mysterious', 'epic', 'peaceful'];
        for (const atmoKey of atmosphereSounds) {
          if (finalSfxList.length >= targetMinimum) break;

          const sfxKey = `atmosphere.${atmoKey}`;
          if (existingKeys.has(sfxKey)) continue;

          const atmosphereDef = GENRE_SFX_LIBRARY.atmosphere[atmoKey];
          if (atmosphereDef) {
            finalSfxList.push({
              sfxKey,
              name: `${atmoKey} atmosphere`,
              category: 'atmosphere',
              prompt: atmosphereDef.prompt,
              duration: atmosphereDef.duration,
              loop: atmosphereDef.loop,
              timing: 'continuous',
              trigger: 'Supplemental atmosphere',
              reason: `Added to meet ${sfxLevel} level minimum`,
              type: 'atmospheric',
              importance: 'low',
              source: 'atmosphere_supplement',
              status: 'pending'
            });
            existingKeys.add(sfxKey);
            logger.info(`[SFX Pipeline] Atmosphere supplement: ${sfxKey}`);
          }
        }
      }

      logger.info(`[SFX Pipeline] After enforcement: ${finalSfxList.length} sounds (target: ${targetMinimum})`);
    }

    const elapsed = Date.now() - startTime;
    logger.info(`[SFX Pipeline] ✓ Complete in ${elapsed}ms - Final count: ${finalSfxList.length} sounds`);
    logger.info(`[SFX Pipeline] Grade: ${pipeline.teacherReview.grade} | Feedback: ${pipeline.teacherReview.feedback}`);

    return {
      success: true,
      sfxList: finalSfxList,
      context: {
        genre: pipeline.context.primaryGenre,
        setting: pipeline.context.settingType,
        mood: pipeline.context.mood
      },
      validation: {
        score: pipeline.teacherReview.overallScore,
        grade: pipeline.teacherReview.grade,
        feedback: pipeline.teacherReview.feedback,
        missingCritical: pipeline.teacherReview.missingCritical
      },
      stats: {
        firstPass: firstPassCount,
        secondPassMissed: missedCount,
        secondPassCorrections: correctionCount,
        combined: pipeline.combined.length,
        matched: pipeline.matched.length,
        teacherApproved: pipeline.teacherReview.approved?.length || 0,
        teacherRejected: pipeline.teacherReview.rejected?.length || 0,
        teacherAdded: pipeline.teacherReview.finalAdditions?.length || 0,
        final: finalSfxList.length,
        elapsed
      }
    };

  } catch (error) {
    logger.error('[SFX Pipeline] Pipeline error:', error);
    pipeline.errors.push(error.message);

    // Try to return whatever we have
    if (pipeline.matched && pipeline.matched.length > 0) {
      logger.warn('[SFX Pipeline] Returning matched sounds despite error');
      return {
        success: true,
        sfxList: pipeline.matched,
        errors: pipeline.errors,
        stats: {
          final: pipeline.matched.length,
          elapsed: Date.now() - startTime,
          fallback: true
        }
      };
    }

    if (pipeline.firstPass?.sounds?.length > 0) {
      logger.warn('[SFX Pipeline] Returning first pass sounds as fallback');
      const fallbackList = pipeline.firstPass.sounds.map(s => {
        const library = GENRE_SFX_LIBRARY[s.category] || GENRE_SFX_LIBRARY.atmosphere;
        const sfxDef = library?.[s.soundKey];
        if (!sfxDef) return null;
        return {
          sfxKey: `${s.category}.${s.soundKey}`,
          name: s.soundKey.replace(/_/g, ' '),
          category: s.category,
          prompt: sfxDef.prompt,
          duration: sfxDef.duration,
          loop: sfxDef.loop,
          timing: s.timing,
          trigger: s.trigger,
          reason: s.reason,
          status: 'pending',
          source: 'first_pass_fallback'
        };
      }).filter(Boolean);

      return {
        success: true,
        sfxList: fallbackList,
        errors: pipeline.errors,
        stats: {
          final: fallbackList.length,
          elapsed: Date.now() - startTime,
          fallback: true
        }
      };
    }

    return {
      success: false,
      sfxList: [],
      errors: pipeline.errors,
      stats: { elapsed: Date.now() - startTime }
    };
  }
}

export default {
  analyzeStoryContext,
  detectSceneSounds,
  matchToLibrary,
  validateSFXList,
  extractSoundsFirstPass,
  extractSoundsSecondPass,
  teacherValidateSounds,
  detectSFXMultiAgent,
  GENRE_SFX_LIBRARY
};
