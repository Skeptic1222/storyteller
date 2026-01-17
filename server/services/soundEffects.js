/**
 * ElevenLabs Sound Effects Service
 * Generates ambient sound effects and audio layers for immersive storytelling
 *
 * API: POST https://api.elevenlabs.io/v1/sound-generation
 * Docs: https://elevenlabs.io/docs/capabilities/sound-effects
 */

import axios from 'axios';
import crypto from 'crypto';
import { existsSync, mkdirSync, accessSync, constants } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ELEVENLABS_API_URL = 'https://api.elevenlabs.io/v1';
const SFX_CACHE_DIR = process.env.SFX_CACHE_DIR || join(__dirname, '..', '..', 'public', 'sfx');

// Ensure SFX cache directory exists and is writable
let sfxCacheWritable = false;
try {
  if (!existsSync(SFX_CACHE_DIR)) {
    mkdirSync(SFX_CACHE_DIR, { recursive: true });
    logger.info(`[SFX] Created cache directory: ${SFX_CACHE_DIR}`);
  }
  // Test write access
  accessSync(SFX_CACHE_DIR, constants.W_OK);
  sfxCacheWritable = true;
  logger.info(`[SFX] Cache directory writable: ${SFX_CACHE_DIR}`);
} catch (err) {
  logger.error(`[SFX] Cache directory not writable: ${SFX_CACHE_DIR}`, err.message);
  logger.warn('[SFX] Sound effects will still work but caching will be disabled');
}

/**
 * Ambient sound effect prompts organized by category
 * These are optimized for ElevenLabs SFX API
 * EXPANDED LIBRARY: ~150 effects for rich immersive storytelling
 */
export const AMBIENT_SFX_LIBRARY = {
  // Weather effects (15 effects)
  weather: {
    rain_light: { prompt: 'Light rain falling on leaves, gentle dripping, peaceful atmosphere', duration: 15, loop: true },
    rain_heavy: { prompt: 'Heavy rainfall, thunderstorm approaching, rain on roof', duration: 15, loop: true },
    rain_window: { prompt: 'Rain pattering on window glass, cozy indoor feeling', duration: 12, loop: true },
    rain_tropical: { prompt: 'Heavy tropical monsoon rain, intense downpour', duration: 15, loop: true },
    thunder: { prompt: 'Distant thunder rumbling, ominous storm', duration: 8, loop: false },
    thunder_close: { prompt: 'Close thunder crack, sharp lightning strike', duration: 4, loop: false },
    wind_gentle: { prompt: 'Gentle breeze through trees, rustling leaves', duration: 12, loop: true },
    wind_strong: { prompt: 'Strong howling wind, stormy gusts', duration: 10, loop: true },
    wind_arctic: { prompt: 'Freezing arctic wind, biting cold, ice particles', duration: 12, loop: true },
    wind_desert: { prompt: 'Hot desert wind, sand blowing, dry heat', duration: 12, loop: true },
    snow_falling: { prompt: 'Quiet winter night, soft wind, peaceful silence', duration: 12, loop: true },
    hail: { prompt: 'Hailstorm hitting ground and surfaces, ice pellets', duration: 10, loop: true },
    fog: { prompt: 'Thick fog atmosphere, distant foghorn, muffled sounds', duration: 12, loop: true },
    sunrise: { prompt: 'Dawn breaking, early morning birds, peaceful awakening', duration: 15, loop: true },
    night_clear: { prompt: 'Clear night sky, crickets, distant owls, starlight', duration: 15, loop: true }
  },

  // Location ambiance (30 effects)
  locations: {
    forest_day: { prompt: 'Forest ambiance with birds chirping, leaves rustling, peaceful woodland', duration: 15, loop: true },
    forest_night: { prompt: 'Night forest with crickets, owl hooting, mysterious atmosphere', duration: 15, loop: true },
    forest_rain: { prompt: 'Rainy forest, water dripping from leaves, wet atmosphere', duration: 15, loop: true },
    jungle: { prompt: 'Dense jungle, exotic birds, insects buzzing, humid atmosphere', duration: 15, loop: true },
    swamp: { prompt: 'Murky swamp, bubbling mud, frogs, insects, eerie atmosphere', duration: 15, loop: true },
    castle_interior: { prompt: 'Stone castle interior, echoing footsteps, distant torches crackling', duration: 12, loop: true },
    castle_courtyard: { prompt: 'Castle courtyard, flag flapping, guards patrolling, stone echoes', duration: 12, loop: true },
    tavern: { prompt: 'Busy medieval tavern, crowd murmuring, glasses clinking, fire crackling', duration: 15, loop: true },
    tavern_quiet: { prompt: 'Quiet late night tavern, fire crackling, occasional cough', duration: 12, loop: true },
    cave: { prompt: 'Dripping water in cave, echoing drops, underground atmosphere', duration: 12, loop: true },
    cave_deep: { prompt: 'Deep underground cavern, distant rumbling, ancient darkness', duration: 12, loop: true },
    ocean: { prompt: 'Ocean waves crashing on shore, seagulls, coastal breeze', duration: 15, loop: true },
    ocean_storm: { prompt: 'Stormy ocean, massive waves, thunder, ship creaking', duration: 15, loop: true },
    underwater: { prompt: 'Underwater ambiance, muffled sounds, bubbles, whale calls', duration: 12, loop: true },
    city_medieval: { prompt: 'Medieval city marketplace, crowd chatter, horse hooves, bells', duration: 15, loop: true },
    city_night: { prompt: 'Medieval city at night, distant dogs, guards calling, quiet streets', duration: 12, loop: true },
    dungeon: { prompt: 'Dark dungeon ambiance, chains rattling, dripping water, eerie silence', duration: 12, loop: true },
    prison: { prompt: 'Prison cell block, distant coughs, chains, metal doors', duration: 12, loop: true },
    library: { prompt: 'Quiet library, pages turning, clock ticking, peaceful study', duration: 12, loop: true },
    throne_room: { prompt: 'Grand throne room, echoing stone, distant conversations, regal atmosphere', duration: 12, loop: true },
    temple: { prompt: 'Ancient temple, distant chanting, incense burning, spiritual atmosphere', duration: 12, loop: true },
    graveyard: { prompt: 'Graveyard at night, wind through tombstones, crows, eerie silence', duration: 12, loop: true },
    battlefield: { prompt: 'Aftermath of battle, wind, crows, distant moans, desolation', duration: 12, loop: true },
    ship_deck: { prompt: 'Ship on open sea, creaking wood, waves, flapping sails', duration: 15, loop: true },
    ship_below: { prompt: 'Below deck of ship, creaking timbers, water sloshing', duration: 12, loop: true },
    mine: { prompt: 'Underground mine, pickaxes distant, cart wheels, echoing tunnels', duration: 12, loop: true },
    mountain_peak: { prompt: 'Mountain summit, thin wind, snow, vast silence', duration: 12, loop: true },
    desert_day: { prompt: 'Desert during day, hot wind, distant sand, scorching sun', duration: 12, loop: true },
    desert_night: { prompt: 'Desert at night, cold wind, distant animals, stars', duration: 12, loop: true },
    village: { prompt: 'Peaceful village, chickens, distant conversations, rustic life', duration: 15, loop: true }
  },

  // Action sounds (25 effects)
  actions: {
    footsteps_stone: { prompt: 'Footsteps on stone floor, walking in castle corridor', duration: 5, loop: false },
    footsteps_forest: { prompt: 'Footsteps on forest path, leaves and twigs crunching', duration: 5, loop: false },
    footsteps_running: { prompt: 'Running footsteps, urgent pace, gravel and dirt', duration: 4, loop: false },
    footsteps_snow: { prompt: 'Footsteps crunching through snow, winter walk', duration: 5, loop: false },
    footsteps_water: { prompt: 'Splashing footsteps through shallow water', duration: 4, loop: false },
    footsteps_stealth: { prompt: 'Quiet sneaking footsteps, careful movement', duration: 4, loop: false },
    door_wooden_open: { prompt: 'Heavy wooden door creaking open slowly', duration: 3, loop: false },
    door_wooden_close: { prompt: 'Wooden door closing with solid thud', duration: 2, loop: false },
    door_metal: { prompt: 'Metal gate or prison door clanging shut', duration: 2, loop: false },
    door_secret: { prompt: 'Secret passage opening, stone grinding, hidden mechanism', duration: 4, loop: false },
    horse_gallop: { prompt: 'Horse galloping on road, hooves pounding', duration: 6, loop: false },
    horse_whinny: { prompt: 'Horse neighing and whinnying', duration: 3, loop: false },
    horse_walk: { prompt: 'Horse walking slowly, hooves on cobblestone', duration: 5, loop: false },
    glass_break: { prompt: 'Glass shattering, window breaking, tinkling shards', duration: 2, loop: false },
    lock_pick: { prompt: 'Lock being picked, metal clicking, tension', duration: 4, loop: false },
    chest_open: { prompt: 'Treasure chest opening, rusty hinges, discovery', duration: 3, loop: false },
    book_open: { prompt: 'Old book opening, pages rustling, ancient tome', duration: 2, loop: false },
    scroll_unfurl: { prompt: 'Parchment scroll unrolling, paper crackling', duration: 2, loop: false },
    rope_climb: { prompt: 'Climbing rope, strain, fabric friction, effort', duration: 4, loop: false },
    splash_water: { prompt: 'Splash into water, diving, submersion', duration: 3, loop: false },
    fire_light: { prompt: 'Flint striking, sparks, fire igniting', duration: 2, loop: false },
    torch_grab: { prompt: 'Torch being grabbed from wall sconce, flames', duration: 2, loop: false },
    curtain_pull: { prompt: 'Heavy curtain being pulled aside, fabric whoosh', duration: 2, loop: false },
    lever_pull: { prompt: 'Metal lever being pulled, mechanism activating', duration: 2, loop: false },
    bridge_lower: { prompt: 'Drawbridge lowering, chains rattling, wood creaking', duration: 5, loop: false }
  },

  // Combat sounds (20 effects)
  combat: {
    sword_clash: { prompt: 'Metal swords clashing, combat fighting sounds', duration: 4, loop: false },
    sword_draw: { prompt: 'Sword being drawn from sheath, metal sliding', duration: 2, loop: false },
    sword_sheath: { prompt: 'Sword sliding back into sheath, metal clicking', duration: 2, loop: false },
    sword_swing: { prompt: 'Sword swinging through air, whoosh', duration: 1, loop: false },
    dagger_stab: { prompt: 'Dagger stabbing, quick sharp impact', duration: 1, loop: false },
    arrow_whoosh: { prompt: 'Arrow flying through air, whooshing sound', duration: 2, loop: false },
    arrow_impact: { prompt: 'Arrow hitting target, thunk into wood or flesh', duration: 1, loop: false },
    bow_release: { prompt: 'Bow string releasing, arrow launched', duration: 1, loop: false },
    crossbow: { prompt: 'Crossbow being loaded and fired, mechanical click', duration: 2, loop: false },
    battle_distant: { prompt: 'Distant battle sounds, swords clashing, shouts, war ambiance', duration: 12, loop: true },
    battle_close: { prompt: 'Close combat battle, metal clashing, grunts, chaos', duration: 8, loop: false },
    punch_hit: { prompt: 'Fist fight punch impact, physical combat', duration: 1, loop: false },
    body_fall: { prompt: 'Body falling to ground, thud, defeat', duration: 2, loop: false },
    armor_movement: { prompt: 'Knight in armor moving, metal plates clinking', duration: 3, loop: false },
    armor_impact: { prompt: 'Weapon hitting armor, metal clash, deflection', duration: 1, loop: false },
    shield_bash: { prompt: 'Shield bashing, wood and metal impact', duration: 1, loop: false },
    war_horn: { prompt: 'War horn blowing, battle call, rallying troops', duration: 4, loop: false },
    cavalry_charge: { prompt: 'Cavalry charging, many horses, battle cries', duration: 6, loop: false },
    spear_throw: { prompt: 'Spear being thrown, whoosh through air', duration: 2, loop: false },
    hammer_strike: { prompt: 'War hammer striking, heavy metal impact', duration: 1, loop: false }
  },

  // Magic and supernatural (25 effects)
  magic: {
    spell_cast: { prompt: 'Magical spell being cast, mystical energy, arcane power', duration: 3, loop: false },
    spell_fire: { prompt: 'Fire spell casting, flames roaring, heat wave', duration: 3, loop: false },
    spell_ice: { prompt: 'Ice spell casting, crystallization, freezing cold', duration: 3, loop: false },
    spell_lightning: { prompt: 'Lightning spell, electric crackle, thunder', duration: 3, loop: false },
    spell_heal: { prompt: 'Healing spell, warm energy, gentle chimes, restoration', duration: 4, loop: false },
    spell_shield: { prompt: 'Shield spell activating, energy barrier forming', duration: 3, loop: false },
    magic_ambient: { prompt: 'Magical ambient atmosphere, ethereal humming, mystical energy', duration: 10, loop: true },
    portal_open: { prompt: 'Magical portal opening, swirling energy, dimensional rift', duration: 4, loop: false },
    teleport: { prompt: 'Teleportation spell, whoosh, displacement of air', duration: 2, loop: false },
    ghost_whisper: { prompt: 'Ghostly whispers, supernatural voices, eerie presence', duration: 5, loop: false },
    ghost_moan: { prompt: 'Ghostly moaning, spectral wail, haunting sound', duration: 4, loop: false },
    dragon_roar: { prompt: 'Dragon roaring, monstrous beast sound', duration: 4, loop: false },
    dragon_breath: { prompt: 'Dragon breathing fire, massive flames', duration: 3, loop: false },
    dragon_wings: { prompt: 'Dragon wings flapping, massive creature flying', duration: 4, loop: false },
    fire_magic: { prompt: 'Magical fire burning, flames crackling with power', duration: 4, loop: false },
    summoning: { prompt: 'Summoning ritual, dark energy, otherworldly voices', duration: 5, loop: false },
    curse: { prompt: 'Curse being spoken, dark words, malevolent power', duration: 4, loop: false },
    blessing: { prompt: 'Divine blessing, holy light, angelic tones', duration: 4, loop: false },
    enchant: { prompt: 'Enchantment completing, magical binding, power surge', duration: 3, loop: false },
    dispel: { prompt: 'Magic being dispelled, energy dissipating', duration: 3, loop: false },
    potion_bubble: { prompt: 'Potion bubbling in cauldron, magical brewing', duration: 6, loop: true },
    crystal_hum: { prompt: 'Magical crystal humming, resonating power', duration: 8, loop: true },
    rune_glow: { prompt: 'Runes glowing with power, ancient magic activating', duration: 4, loop: false },
    transformation: { prompt: 'Transformation magic, bones cracking, shape changing', duration: 4, loop: false },
    necromancy: { prompt: 'Necromantic spell, dark whispers, death energy', duration: 5, loop: false }
  },

  // Creatures (20 effects)
  creatures: {
    wolf_howl: { prompt: 'Wolf howling in distance, pack calling, wilderness', duration: 6, loop: false },
    wolf_growl: { prompt: 'Wolf growling threateningly, aggressive stance', duration: 3, loop: false },
    wolf_pack: { prompt: 'Wolf pack approaching, multiple growls, hunting', duration: 6, loop: false },
    spider_skitter: { prompt: 'Giant spider skittering, legs clicking, creepy', duration: 4, loop: false },
    snake_hiss: { prompt: 'Large serpent hissing, threatening, scales sliding', duration: 3, loop: false },
    bat_swarm: { prompt: 'Swarm of bats flying, wings flapping, squeaking', duration: 5, loop: false },
    crow_caw: { prompt: 'Crows cawing, ominous birds, dark omen', duration: 4, loop: false },
    owl_hoot: { prompt: 'Owl hooting in night, wise bird, forest', duration: 3, loop: false },
    bear_roar: { prompt: 'Bear roaring, massive beast, threatening', duration: 4, loop: false },
    troll_stomp: { prompt: 'Troll stomping, heavy footsteps, lumbering giant', duration: 5, loop: false },
    goblin_cackle: { prompt: 'Goblins cackling, mischievous laughter, many voices', duration: 4, loop: false },
    orc_war_cry: { prompt: 'Orcs war cry, brutal shout, barbaric', duration: 3, loop: false },
    undead_groan: { prompt: 'Undead groaning, zombie sounds, shambling', duration: 4, loop: false },
    skeleton_rattle: { prompt: 'Skeleton bones rattling, walking dead', duration: 4, loop: false },
    demon_growl: { prompt: 'Demonic growling, hellish creature, evil', duration: 4, loop: false },
    fairy_giggle: { prompt: 'Fairy giggling, tiny wings, magical bells', duration: 3, loop: false },
    griffin_screech: { prompt: 'Griffin screeching, eagle-lion hybrid, powerful', duration: 4, loop: false },
    phoenix_cry: { prompt: 'Phoenix cry, flames, triumphant rebirth', duration: 4, loop: false },
    kraken_roar: { prompt: 'Sea monster roaring, tentacles thrashing, massive beast', duration: 5, loop: false },
    wyvern_shriek: { prompt: 'Wyvern shrieking, flying reptile, hunting', duration: 4, loop: false }
  },

  // Emotional atmosphere (15 effects)
  atmosphere: {
    tension: { prompt: 'Tense atmosphere, low ominous drone, suspenseful', duration: 12, loop: true },
    tension_building: { prompt: 'Building tension, rising suspense, approaching danger', duration: 10, loop: false },
    peaceful: { prompt: 'Peaceful serene atmosphere, gentle ambient, calm', duration: 15, loop: true },
    scary: { prompt: 'Horror atmosphere, creepy ambient, unsettling sounds', duration: 12, loop: true },
    terrifying: { prompt: 'Terrifying atmosphere, dread, disturbing ambient', duration: 12, loop: true },
    triumphant: { prompt: 'Triumphant fanfare, victory horns, celebratory', duration: 6, loop: false },
    sad: { prompt: 'Melancholic atmosphere, lonely wind, sorrowful ambiance', duration: 12, loop: true },
    mourning: { prompt: 'Mourning atmosphere, funeral bells, grief', duration: 10, loop: true },
    mysterious: { prompt: 'Mysterious atmosphere, enigmatic ambient, curious mood', duration: 12, loop: true },
    romantic: { prompt: 'Romantic atmosphere, soft and tender, heartfelt', duration: 12, loop: true },
    epic: { prompt: 'Epic atmosphere, grand scale, heroic feeling', duration: 12, loop: true },
    dread: { prompt: 'Creeping dread, low drone, something wrong', duration: 12, loop: true },
    wonder: { prompt: 'Sense of wonder, discovery, awe-inspiring', duration: 10, loop: true },
    despair: { prompt: 'Despair and hopelessness, dark emptiness', duration: 12, loop: true },
    revelation: { prompt: 'Moment of revelation, realization, dramatic', duration: 5, loop: false }
  },

  // Science Fiction sounds (20 effects)
  scifi: {
    bridge_ambient: { prompt: 'Spaceship bridge ambient, computer beeps, soft hum, control panels', duration: 15, loop: true },
    engine_hum: { prompt: 'Spaceship engine humming, deep thrumming, power core vibration', duration: 15, loop: true },
    engine_room: { prompt: 'Spaceship engine room ambient, machinery humming, reactor sounds, industrial', duration: 15, loop: true },
    ship_engine_idle: { prompt: 'Spaceship engine idling, low rumble, power systems standby, gentle hum', duration: 15, loop: true },
    airlock_open: { prompt: 'Airlock door opening with hiss, pressurization, mechanical seal release', duration: 4, loop: false },
    airlock_close: { prompt: 'Airlock door sealing shut, pressurization complete, mechanical lock', duration: 3, loop: false },
    computer_beep: { prompt: 'Futuristic computer beeping, data processing, sci-fi interface sounds', duration: 3, loop: false },
    computer_error: { prompt: 'Computer error alarm, warning beeps, system malfunction alert', duration: 4, loop: false },
    computer_boot: { prompt: 'Computer system booting up, power on sequence, initialization sounds', duration: 5, loop: false },
    computer_typing: { prompt: 'Typing on futuristic keyboard, holographic interface, digital keystrokes', duration: 4, loop: false },
    scanner_beep: { prompt: 'Scanner device beeping, sensor sweep, detecting, data readout', duration: 3, loop: false },
    comm_static: { prompt: 'Communication channel static, radio interference, broken transmission', duration: 5, loop: true },
    laser_fire: { prompt: 'Laser weapon firing, energy blast, sci-fi gun shot', duration: 2, loop: false },
    laser_charge: { prompt: 'Laser weapon charging up, energy building, ready to fire', duration: 3, loop: false },
    space_ambient: { prompt: 'Deep space ambient, cosmic hum, vast emptiness, distant stars', duration: 15, loop: true },
    space_station: { prompt: 'Space station interior, life support systems, distant machinery, echoing metal', duration: 15, loop: true },
    alien_ambient: { prompt: 'Alien environment, strange organic sounds, otherworldly atmosphere', duration: 12, loop: true },
    alien_signal: { prompt: 'Mysterious alien signal, unknown transmission, eerie communication', duration: 6, loop: false },
    footsteps_metal: { prompt: 'Footsteps on metal grating, space station corridor, hollow metallic steps', duration: 5, loop: false },
    door_scifi: { prompt: 'Futuristic door sliding open with whoosh, sci-fi automatic door', duration: 2, loop: false },
    hiss_steam: { prompt: 'Steam or gas hissing, pressure release, atmospheric venting', duration: 4, loop: false },
    reactor_hum: { prompt: 'Reactor core humming, power plant ambient, energy generation', duration: 12, loop: true },
    hologram: { prompt: 'Hologram activating, digital shimmer, projection materializing', duration: 3, loop: false },
    hologram_activate: { prompt: 'Holographic display activating, energy shimmer, digital projection appearing', duration: 3, loop: false },
    teleporter: { prompt: 'Teleportation beam, matter transport, energy whoosh', duration: 3, loop: false },
    ship_creaking: { prompt: 'Spaceship hull creaking under pressure, metal stress, structural sounds', duration: 8, loop: true },
    alert_klaxon: { prompt: 'Spaceship alert klaxon, red alert, emergency siren, danger warning', duration: 6, loop: true },
    power_down: { prompt: 'Systems powering down, energy failing, lights dimming, shutdown sequence', duration: 4, loop: false },
    power_up: { prompt: 'Systems powering up, energy surge, lights activating, startup sequence', duration: 4, loop: false }
  },

  // Horror sounds (15 effects)
  horror: {
    heartbeat: { prompt: 'Heartbeat pounding, increasing panic, fear rhythm', duration: 10, loop: true },
    breathing_heavy: { prompt: 'Heavy scared breathing, panic, fear, hiding', duration: 8, loop: true },
    whispers_dark: { prompt: 'Dark whispers in shadows, unintelligible voices, creepy', duration: 10, loop: true },
    scratching: { prompt: 'Scratching sounds on walls, something clawing, unknown threat', duration: 6, loop: false },
    creaking_floor: { prompt: 'Floorboards creaking, old house, something approaching', duration: 5, loop: false },
    door_creak_horror: { prompt: 'Door slowly creaking open by itself, haunted, horror', duration: 4, loop: false },
    sudden_silence: { prompt: 'Sudden eerie silence, absence of sound, tension', duration: 5, loop: false },
    child_laugh: { prompt: 'Creepy child laughter in distance, unsettling, horror', duration: 4, loop: false },
    music_box: { prompt: 'Creepy music box playing slowly, distorted melody, horror', duration: 8, loop: true },
    static_radio: { prompt: 'Radio static, interference, trying to tune in, creepy', duration: 6, loop: true },
    clock_ticking: { prompt: 'Loud clock ticking in silence, time passing, ominous', duration: 10, loop: true },
    chains_dragging: { prompt: 'Chains being dragged across floor, heavy, approaching', duration: 5, loop: false },
    something_wet: { prompt: 'Wet squelching sounds, something organic, disturbing', duration: 4, loop: false },
    wind_howling_horror: { prompt: 'Wind howling through abandoned building, ghostly, eerie', duration: 12, loop: true },
    footsteps_above: { prompt: 'Footsteps on floor above, someone walking, you are alone', duration: 6, loop: false }
  },

  // Nature sounds (20 effects)
  nature: {
    fire_campfire: { prompt: 'Campfire burning, wood crackling, cozy warmth', duration: 12, loop: true },
    fire_large: { prompt: 'Large fire burning, roaring flames, intense heat', duration: 10, loop: true },
    fire_building: { prompt: 'Building on fire, flames spreading, destruction', duration: 12, loop: true },
    fire_torch: { prompt: 'Torch burning, flame crackling, flickering', duration: 8, loop: true },
    water_stream: { prompt: 'Gentle stream flowing, water babbling over rocks', duration: 12, loop: true },
    water_waterfall: { prompt: 'Waterfall cascading, rushing water, powerful flow', duration: 12, loop: true },
    water_river: { prompt: 'Wide river flowing, strong current, peaceful', duration: 12, loop: true },
    water_drip: { prompt: 'Water dripping in cave, single drops, echo', duration: 10, loop: true },
    water_rain_in_forest: { prompt: 'Rain falling in forest, drops on leaves, wet', duration: 12, loop: true },
    birds_morning: { prompt: 'Morning birds singing, dawn chorus, peaceful sunrise', duration: 12, loop: true },
    birds_forest: { prompt: 'Various forest birds, woodland sounds, nature', duration: 12, loop: true },
    birds_crows: { prompt: 'Crows cawing, dark omens, foreboding', duration: 8, loop: true },
    insects_night: { prompt: 'Night insects, crickets, cicadas, summer night', duration: 12, loop: true },
    insects_flies: { prompt: 'Flies buzzing, annoying swarm, heat', duration: 8, loop: true },
    leaves_rustling: { prompt: 'Leaves rustling in wind, autumn atmosphere', duration: 10, loop: true },
    earthquake: { prompt: 'Ground shaking, rumbling, earthquake', duration: 6, loop: false },
    avalanche: { prompt: 'Avalanche roaring, snow and ice crashing', duration: 6, loop: false },
    volcano: { prompt: 'Volcanic activity, lava bubbling, rumbling', duration: 10, loop: true },
    thunder_storm: { prompt: 'Full thunderstorm, multiple lightning, heavy rain', duration: 15, loop: true },
    night_peaceful: { prompt: 'Peaceful night, distant sounds, quiet darkness', duration: 15, loop: true }
  }
};

/**
 * Keywords that map to sound effects
 * Used to detect which SFX to play based on scene text
 */
export const SFX_KEYWORD_MAP = {
  // Weather detection
  'rain': 'weather.rain_light',
  'raining': 'weather.rain_light',
  'downpour': 'weather.rain_heavy',
  'storm': 'weather.rain_heavy',
  'stormy': 'weather.rain_heavy',
  'thunder': 'weather.thunder',
  'lightning': 'weather.thunder',
  'wind': 'weather.wind_gentle',
  'howling wind': 'weather.wind_strong',
  'blizzard': 'weather.wind_strong',
  'snow': 'weather.snow_falling',
  'snowing': 'weather.snow_falling',

  // Location detection
  'forest': 'locations.forest_day',
  'woods': 'locations.forest_day',
  'woodland': 'locations.forest_day',
  'castle': 'locations.castle_interior',
  'fortress': 'locations.castle_interior',
  'tavern': 'locations.tavern',
  'inn': 'locations.tavern',
  'pub': 'locations.tavern',
  'cave': 'locations.cave',
  'cavern': 'locations.cave',
  'ocean': 'locations.ocean',
  'sea': 'locations.ocean',
  'beach': 'locations.ocean',
  'shore': 'locations.ocean',
  'market': 'locations.city_medieval',
  'marketplace': 'locations.city_medieval',
  'city': 'locations.city_medieval',
  'town': 'locations.city_medieval',
  'dungeon': 'locations.dungeon',
  'prison': 'locations.dungeon',
  'cell': 'locations.dungeon',
  'library': 'locations.library',
  'study': 'locations.library',
  'throne': 'locations.throne_room',

  // Action detection
  'walked': 'actions.footsteps_stone',
  'walking': 'actions.footsteps_stone',
  'footsteps': 'actions.footsteps_stone',
  'ran': 'actions.footsteps_running',
  'running': 'actions.footsteps_running',
  'sprinted': 'actions.footsteps_running',
  'door opened': 'actions.door_wooden_open',
  'opened the door': 'actions.door_wooden_open',
  'door closed': 'actions.door_wooden_close',
  'slammed': 'actions.door_wooden_close',
  'horse': 'actions.horse_gallop',
  'galloped': 'actions.horse_gallop',
  'rode': 'actions.horse_gallop',

  // Combat detection
  'sword': 'combat.sword_draw',
  'blade': 'combat.sword_draw',
  'drew his sword': 'combat.sword_draw',
  'drew her sword': 'combat.sword_draw',
  'clashed': 'combat.sword_clash',
  'fought': 'combat.sword_clash',
  'battle': 'combat.battle_distant',
  'combat': 'combat.sword_clash',
  'arrow': 'combat.arrow_whoosh',
  'archer': 'combat.bow_release',
  'bow': 'combat.bow_release',
  'punch': 'combat.punch_hit',
  'struck': 'combat.punch_hit',
  'armor': 'combat.armor_movement',
  'knight': 'combat.armor_movement',

  // Magic detection
  'spell': 'magic.spell_cast',
  'magic': 'magic.magic_ambient',
  'magical': 'magic.magic_ambient',
  'enchanted': 'magic.magic_ambient',
  'portal': 'magic.portal_open',
  'ghost': 'magic.ghost_whisper',
  'spirit': 'magic.ghost_whisper',
  'haunted': 'magic.ghost_whisper',
  'dragon': 'magic.dragon_roar',
  'creature roared': 'magic.dragon_roar',

  // Atmosphere detection
  'tense': 'atmosphere.tension',
  'suspense': 'atmosphere.tension',
  'danger': 'atmosphere.tension',
  'peaceful': 'atmosphere.peaceful',
  'calm': 'atmosphere.peaceful',
  'serene': 'atmosphere.peaceful',
  'scary': 'atmosphere.scary',
  'frightening': 'atmosphere.scary',
  'terrifying': 'atmosphere.scary',
  'horror': 'atmosphere.scary',
  'victory': 'atmosphere.triumphant',
  'triumphant': 'atmosphere.triumphant',
  'won': 'atmosphere.triumphant',
  'sad': 'atmosphere.sad',
  'mourned': 'atmosphere.sad',
  'grief': 'atmosphere.sad',
  'mysterious': 'atmosphere.mysterious',
  'mystery': 'atmosphere.mysterious',
  'strange': 'atmosphere.mysterious',

  // Nature detection
  'campfire': 'nature.fire_campfire',
  'bonfire': 'nature.fire_large',
  'flames': 'nature.fire_large',
  'burning': 'nature.fire_large',
  'stream': 'nature.water_stream',
  'brook': 'nature.water_stream',
  'river': 'nature.water_stream',
  'waterfall': 'nature.water_waterfall',
  'birds': 'nature.birds_morning',
  'dawn': 'nature.birds_morning',
  'sunrise': 'nature.birds_morning',
  'wolves': 'nature.wolves_howling',
  'howled': 'nature.wolves_howling',

  // Sci-Fi detection
  'spaceship': 'scifi.engine_hum',
  'spacecraft': 'scifi.engine_hum',
  'ship': 'scifi.engine_hum',
  'vessel': 'scifi.engine_hum',
  'bridge': 'scifi.bridge_ambient',
  'cockpit': 'scifi.bridge_ambient',
  'console': 'scifi.computer_beep',
  'computer': 'scifi.computer_beep',
  'terminal': 'scifi.computer_beep',
  'screen': 'scifi.computer_beep',
  'display': 'scifi.computer_beep',
  'airlock': 'scifi.airlock_open',
  'hatch': 'scifi.airlock_open',
  'space': 'scifi.space_ambient',
  'cosmos': 'scifi.space_ambient',
  'stars': 'scifi.space_ambient',
  'void': 'scifi.space_ambient',
  'station': 'scifi.space_station',
  'alien': 'scifi.alien_ambient',
  'extraterrestrial': 'scifi.alien_ambient',
  'signal': 'scifi.alien_signal',
  'transmission': 'scifi.alien_signal',
  'laser': 'scifi.laser_fire',
  'blaster': 'scifi.laser_fire',
  'reactor': 'scifi.reactor_hum',
  'engine': 'scifi.engine_hum',
  'engines': 'scifi.engine_hum',
  'hiss': 'scifi.hiss_steam',
  'hissing': 'scifi.hiss_steam',
  'steam': 'scifi.hiss_steam',
  'pressure': 'scifi.hiss_steam',
  'hologram': 'scifi.hologram',
  'holographic': 'scifi.hologram',
  'teleport': 'scifi.teleporter',
  'warp': 'scifi.teleporter',
  'metal corridor': 'scifi.footsteps_metal',
  'metal floor': 'scifi.footsteps_metal',
  'grating': 'scifi.footsteps_metal',
  'hull': 'scifi.ship_creaking',
  'creaking metal': 'scifi.ship_creaking',

  // Horror detection
  'heartbeat': 'horror.heartbeat',
  'heart pounding': 'horror.heartbeat',
  'heart racing': 'horror.heartbeat',
  'breathing': 'horror.breathing_heavy',
  'panting': 'horror.breathing_heavy',
  'whisper': 'horror.whispers_dark',
  'whispers': 'horror.whispers_dark',
  'scratching': 'horror.scratching',
  'clawing': 'horror.scratching',
  'creaking': 'horror.creaking_floor',
  'floorboard': 'horror.creaking_floor',
  'child laugh': 'horror.child_laugh',
  'giggling': 'horror.child_laugh',
  'music box': 'horror.music_box',
  'static': 'horror.static_radio',
  'radio': 'horror.static_radio',
  'clock': 'horror.clock_ticking',
  'ticking': 'horror.clock_ticking',
  'chains': 'horror.chains_dragging',
  'dragging': 'horror.chains_dragging',
  'footsteps above': 'horror.footsteps_above',
  'something above': 'horror.footsteps_above',
  'abandoned': 'horror.wind_howling_horror',
  'derelict': 'horror.wind_howling_horror'
};

export class SoundEffectsService {
  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY;
    this.enabled = !!this.apiKey;

    if (!this.apiKey) {
      logger.warn('ELEVENLABS_API_KEY not configured - Sound Effects will not work');
    }
  }

  /**
   * Generate a sound effect from a text prompt
   * @param {string} prompt - Description of the sound effect
   * @param {object} options - Generation options
   * @returns {Buffer} Audio buffer (MP3)
   */
  async generateSoundEffect(prompt, options = {}) {
    if (!this.enabled) {
      throw new Error('Sound effects not enabled - API key missing');
    }

    const duration = options.duration || 10;
    const loop = options.loop || false;
    const promptInfluence = options.prompt_influence || 0.5;

    // Check cache first
    const cached = await this.checkCache(prompt, duration, loop);
    if (cached) {
      logger.info(`SFX cache hit: ${prompt.substring(0, 40)}...`);
      return cached;
    }

    try {
      logger.info(`[SFX] Generating: "${prompt.substring(0, 50)}..." (${duration}s, loop=${loop})`);

      const response = await axios.post(
        `${ELEVENLABS_API_URL}/sound-generation`,
        {
          text: prompt,
          duration_seconds: duration,
          prompt_influence: promptInfluence,
          ...(loop ? { loop: true } : {})
        },
        {
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json',
            'Accept': 'audio/mpeg'
          },
          responseType: 'arraybuffer',
          timeout: 60000 // 60 second timeout for generation
        }
      );

      const audioBuffer = Buffer.from(response.data);

      // Cache the audio
      await this.cacheAudio(prompt, duration, loop, audioBuffer);

      logger.info(`[SFX] Generated: ${audioBuffer.length} bytes`);
      return audioBuffer;

    } catch (error) {
      logger.error('SFX generation error:', error.response?.data || error.message);

      if (error.response?.status === 401) {
        throw new Error('Invalid ElevenLabs API key');
      }
      if (error.response?.status === 429) {
        throw new Error('ElevenLabs rate limit exceeded for SFX');
      }
      if (error.response?.status === 422) {
        throw new Error(`Invalid SFX prompt: ${prompt}`);
      }

      throw new Error('Failed to generate sound effect');
    }
  }

  /**
   * Get a predefined ambient sound effect
   * @param {string} sfxKey - Key like "weather.rain_light" or "locations.forest_day"
   * @returns {Buffer} Audio buffer
   */
  async getAmbientSound(sfxKey) {
    const [category, effect] = sfxKey.split('.');
    const sfxDef = AMBIENT_SFX_LIBRARY[category]?.[effect];

    if (!sfxDef) {
      throw new Error(`Unknown SFX: ${sfxKey}`);
    }

    return this.generateSoundEffect(sfxDef.prompt, {
      duration: sfxDef.duration,
      loop: sfxDef.loop
    });
  }

  /**
   * Analyze scene text and detect appropriate sound effects
   * @param {string} sceneText - The story scene text
   * @param {object} context - Additional context (mood, genre, setting)
   * @returns {Array} Array of {sfxKey, priority, reason}
   */
  detectSceneSFX(sceneText, context = {}) {
    const loweredText = sceneText.toLowerCase();
    const detected = [];
    const usedCategories = new Set();

    // Sort keywords by length (longer = more specific = higher priority)
    const sortedKeywords = Object.entries(SFX_KEYWORD_MAP)
      .sort((a, b) => b[0].length - a[0].length);

    // Determine max per category based on SFX level
    const sfxLevel = context.sfx_level || 'low';
    const maxPerCategory = { low: 1, medium: 2, high: 3 }[sfxLevel] || 1;
    const categoryCounts = new Map();

    for (const [keyword, sfxKey] of sortedKeywords) {
      if (loweredText.includes(keyword)) {
        const [category] = sfxKey.split('.');
        const currentCount = categoryCounts.get(category) || 0;

        // Allow multiple SFX per category based on level
        if (currentCount < maxPerCategory) {
          detected.push({
            sfxKey,
            keyword,
            priority: keyword.length, // Longer keywords = higher priority
            reason: `Detected "${keyword}" in scene`
          });
          categoryCounts.set(category, currentCount + 1);
          usedCategories.add(category);
        }
      }
    }

    // Add atmospheric SFX based on mood if no atmosphere detected
    if (!usedCategories.has('atmosphere') && context.mood) {
      const moodMap = {
        tense: 'atmosphere.tension',
        suspenseful: 'atmosphere.tension',
        peaceful: 'atmosphere.peaceful',
        calm: 'atmosphere.peaceful',
        scary: 'atmosphere.scary',
        frightening: 'atmosphere.scary',
        mysterious: 'atmosphere.mysterious',
        sad: 'atmosphere.sad',
        melancholy: 'atmosphere.sad',
        joyful: 'atmosphere.peaceful',
        triumphant: 'atmosphere.triumphant'
      };

      if (moodMap[context.mood]) {
        detected.push({
          sfxKey: moodMap[context.mood],
          keyword: context.mood,
          priority: 1,
          reason: `Scene mood: ${context.mood}`
        });
      }
    }

    // Sort by priority (highest first)
    detected.sort((a, b) => b.priority - a.priority);

    // Determine max effects based on SFX level from context
    // low: 4, medium: 8, high: 15 (sfxLevel already defined above)
    const maxEffects = {
      low: 4,
      medium: 8,
      high: 15
    }[sfxLevel] || 4;

    // Return top N most relevant effects based on level
    return detected.slice(0, maxEffects);
  }

  /**
   * Generate all sound effects for a scene
   * @param {string} sceneText - The scene text
   * @param {object} context - Scene context
   * @returns {Array} Array of {sfxKey, audioBuffer, metadata}
   */
  async generateSceneSFX(sceneText, context = {}) {
    if (!this.enabled) {
      return [];
    }

    // P1 FIX: Only generate SFX if explicitly enabled in context
    // This prevents SFX generation when user says "no sound effects"
    if (context?.sfx_enabled !== true) {
      logger.info('[SFX] Skipping - SFX not explicitly enabled in context');
      return [];
    }

    const detected = this.detectSceneSFX(sceneText, context);

    if (detected.length === 0) {
      return [];
    }

    logger.info(`[SFX] Generating ${detected.length} effects for scene`);

    const results = [];
    for (const sfx of detected) {
      try {
        const audioBuffer = await this.getAmbientSound(sfx.sfxKey);
        const [category, effect] = sfx.sfxKey.split('.');
        const sfxDef = AMBIENT_SFX_LIBRARY[category]?.[effect];

        results.push({
          sfxKey: sfx.sfxKey,
          audioBuffer,
          metadata: {
            keyword: sfx.keyword,
            reason: sfx.reason,
            duration: sfxDef?.duration || 10,
            loop: sfxDef?.loop || false
          }
        });

        // Small delay between API calls
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        logger.error(`Failed to generate SFX ${sfx.sfxKey}:`, error.message);
        // Continue with other effects
      }
    }

    return results;
  }

  /**
   * Generate hash for SFX caching
   */
  generateHash(prompt, duration, loop) {
    return crypto
      .createHash('sha256')
      .update(`sfx:${prompt}:${duration}:${loop}`)
      .digest('hex');
  }

  /**
   * Check SFX cache
   */
  async checkCache(prompt, duration, loop) {
    const hash = this.generateHash(prompt, duration, loop);

    try {
      const result = await pool.query(
        'SELECT file_path FROM sfx_cache WHERE prompt_hash = $1',
        [hash]
      );

      if (result.rows.length > 0) {
        const filePath = result.rows[0].file_path;
        if (existsSync(filePath)) {
          await pool.query(
            'UPDATE sfx_cache SET access_count = access_count + 1, last_accessed_at = NOW() WHERE prompt_hash = $1',
            [hash]
          );
          return await readFile(filePath);
        }
      }

      return null;
    } catch (error) {
      logger.error('SFX cache check error:', error);
      return null;
    }
  }

  /**
   * Cache generated SFX to disk and database
   * @param {string} prompt - The SFX prompt
   * @param {number} duration - Duration in seconds
   * @param {boolean} loop - Whether the SFX loops
   * @param {Buffer} audioBuffer - The generated audio data
   */
  async cacheAudio(prompt, duration, loop, audioBuffer) {
    // Skip caching if directory not writable
    if (!sfxCacheWritable) {
      logger.debug(`[SFX] Skipping cache write - directory not writable. Prompt: "${prompt.substring(0, 50)}..."`);
      return;
    }

    const hash = this.generateHash(prompt, duration, loop);
    const filename = `${hash}.mp3`;
    const filePath = join(SFX_CACHE_DIR, filename);

    // Step 1: Write file to disk (async to avoid blocking event loop)
    try {
      await writeFile(filePath, audioBuffer);
      logger.info(`[SFX] Cached audio file: ${filename} (${audioBuffer.length} bytes)`);
    } catch (fileError) {
      logger.error(`[SFX] Failed to write cache file: ${filePath}`, {
        error: fileError.message,
        code: fileError.code,
        prompt: prompt.substring(0, 100)
      });
      // Don't proceed to DB insert if file write failed
      return;
    }

    // Step 2: Insert/update database record
    try {
      await pool.query(`
        INSERT INTO sfx_cache (prompt_hash, prompt_preview, file_path, file_size_bytes, duration_seconds, is_looping)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (prompt_hash) DO UPDATE SET
          access_count = sfx_cache.access_count + 1,
          last_accessed_at = NOW()
      `, [
        hash,
        prompt.substring(0, 200),
        filePath,
        audioBuffer.length,
        duration,
        loop
      ]);
      logger.info(`[SFX] Cached to database: hash=${hash.substring(0, 16)}... prompt="${prompt.substring(0, 50)}..."`);
    } catch (dbError) {
      logger.error(`[SFX] Failed to insert cache record into database`, {
        error: dbError.message,
        hash: hash.substring(0, 16),
        prompt: prompt.substring(0, 100)
      });
      // File was written but DB failed - this is recoverable on next access
    }
  }

  /**
   * Get SFX library for UI
   */
  getLibrary() {
    return AMBIENT_SFX_LIBRARY;
  }

  /**
   * Test SFX generation with a simple prompt
   */
  async testGeneration() {
    try {
      const testPrompt = 'Gentle forest ambiance with birds chirping';
      const audio = await this.generateSoundEffect(testPrompt, { duration: 5 });
      return {
        success: true,
        bytes: audio.length,
        message: 'SFX generation working'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}

export default SoundEffectsService;
