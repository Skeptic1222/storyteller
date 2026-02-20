/**
 * Director Styles Service - Phase 4
 *
 * Static data service providing 8 cinematic director personas that control
 * production vision for VAD (Voice Actor Direction) stories. Each director
 * defines SFX philosophy, voice direction, pacing, and production notes
 * tailored to specific story genres.
 *
 * Director controls production vision (scene structure, SFX philosophy,
 * voice direction, sound design). Author Style controls prose voice --
 * these are separate, complementary concerns.
 *
 * @module directorStyles
 *
 * Exports:
 *   DIRECTOR_STYLES        - Map of director key to director object
 *   getDirectorStyle(key)  - Get a director by key (with fallback)
 *   getDirectorForGenres(genres) - Auto-detect best director from genre mix
 *   buildVADGuidance(preferences, directorStyle) - Build VAD guidance string
 *   getAllDirectorsList()   - Return list of {key, name, description, bestFor}
 */

import { logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Director Definitions
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} SoundDesign
 * @property {string} ambience  - How ambient/environmental sound should be layered
 * @property {string} effects   - Philosophy for spot SFX (impacts, foley, stingers)
 * @property {string} music     - Musical direction and scoring approach
 * @property {string} silence   - How silence and negative space should be used
 */

/**
 * @typedef {Object} VoiceActing
 * @property {string} narrator    - Direction for the narrator voice
 * @property {string} dialogue    - How character dialogue should be performed
 * @property {string} emotion     - Emotional range and delivery philosophy
 * @property {string} physicality - Breath, body, and physical vocal qualities
 */

/**
 * @typedef {Object} DirectorStyle
 * @property {string}       name              - Display name
 * @property {string[]}     bestFor           - Genre keywords this director excels at
 * @property {string}       description       - Short one-line description for UI display
 * @property {string}       sfxPhilosophy     - Overall SFX philosophy summary
 * @property {string}       voiceDirection    - Overall voice direction summary
 * @property {string}       pacing            - Pacing guidance for scene rhythm
 * @property {string}       productionNotes   - Additional production-level notes
 * @property {string}       sceneStructure    - How scenes should be structured
 * @property {string[]}     signatureElements - Hallmark techniques to incorporate
 * @property {SoundDesign}  soundDesign       - Detailed sound design breakdown
 * @property {VoiceActing}  voiceActing       - Detailed voice acting breakdown
 */

/**
 * Director styles keyed by slug.
 * Each entry provides production guidance for the orchestrator,
 * SFX coordinator, and voice direction agents.
 *
 * @type {Object.<string, DirectorStyle>}
 */
const DIRECTOR_STYLES = {

  // =========================================================================
  // 1. Alfred Hitchcock
  // =========================================================================
  hitchcock: {
    name: 'Alfred Hitchcock',
    bestFor: ['thriller', 'mystery', 'horror'],
    description: 'Master of suspense. Minimal, surgical sound design with restrained vocal performances that let tension build through what is NOT shown or said.',

    sfxPhilosophy: 'Minimal and surgical. One creaking door is more terrifying than an orchestra of horror stings. Use silence as a weapon -- let the absence of sound build dread. When sound does appear, it should be precise: a clock ticking, a knife scraping, footsteps on gravel. Never wall-to-wall music.',

    voiceDirection: 'Restrained even under duress. Fear manifests as vocal control breaking -- a slight tremor, a too-careful enunciation. Characters speak in measured tones that conceal roiling emotion. Whispers carry more weight than screams.',

    pacing: 'Slow burn escalation. Scenes stretch deliberately, letting the audience squirm. Tension mounts through anticipation, not action. Brief moments of normalcy make the dread sharper. The payoff, when it comes, is swift and devastating.',

    productionNotes: 'The audience should always know more than the characters. Show the bomb under the table, then let the dinner conversation play out. Dramatic irony is the engine of suspense. Avoid jump scares in favor of sustained dread. Every sound cue should be earned -- if a door creaks, it matters.',

    sceneStructure: 'Build through anticipation, not action. Show the bomb under the table, then film the conversation above it. Every scene should have a surface meaning and an underlying tension. Favor single long takes of dialogue over quick cuts.',

    signatureElements: ['dramatic irony', 'voyeuristic framing', 'MacGuffins', 'wrong man scenarios', 'elegant suspense over gore'],

    soundDesign: {
      ambience: 'Sparse and unsettling. A distant clock, the hum of a refrigerator, wind against a window. The environment should feel too quiet -- the absence of expected sound creates unease.',
      effects: 'Surgical precision. A single sharp sound (knife on porcelain, a lock clicking, a phone ringing in an empty house) can carry an entire scene. Every effect is a narrative choice.',
      music: 'Strings-heavy, Bernard Herrmann aesthetic. Stabbing violins for climactic moments, but long stretches of musicless tension. When music enters, it should feel like an intrusion.',
      silence: 'Silence is the primary instrument. Extended silences before key revelations. The longer the quiet, the louder the impact when it breaks. Use silence to make the audience lean in.'
    },

    voiceActing: {
      narrator: 'Measured, almost clinical detachment. The narrator observes with unsettling calm, as if describing horrors from behind glass. Occasional dry wit -- Hitchcock always had a mordant sense of humor.',
      dialogue: 'Characters speak with careful composure that barely masks inner turmoil. Polite conversation laced with threat. What is NOT said matters more than what is. Subtext drives every exchange.',
      emotion: 'Controlled terror. Emotion leaks through cracks in composure -- a trembling hand, a voice pitched slightly too high, an overly casual response to alarming news. Never melodramatic.',
      physicality: 'Tight vocal placement, as if the throat is constricted. Shallow breathing that betrays nervousness. Swallowing before speaking. The body reveals what the words conceal.'
    }
  },

  // =========================================================================
  // 2. Michael Bay
  // =========================================================================
  michaelBay: {
    name: 'Michael Bay',
    bestFor: ['action', 'adventure', 'scifi'],
    description: 'Maximalist spectacle. Layered, overwhelming sound design with urgent, breathless vocal delivery that keeps intensity at eleven.',

    sfxPhilosophy: 'Maximalist and layered. Every explosion needs sub-bass rumble, debris scatter, and aftermath ringing. Vehicle sounds should be visceral -- engine roars, tire screeches, metal impacts. Layer ambient chaos: alarms, crowds screaming, radio chatter. The sound mix IS the excitement.',

    voiceDirection: 'Urgent and breathless. Characters shout over chaos, speak in short clipped sentences during action. Quieter moments are brief -- terse military briefings, cocky one-liners. Emotion comes through intensity, not subtlety.',

    pacing: 'Relentless forward momentum. Peak action within the first 30 seconds. Brief valleys between set pieces exist only to reload tension. Cross-cut between simultaneous action threads. If the audience catches their breath, you have lost them.',

    productionNotes: 'Everything is amplified. Slow-motion hero shots need swelling music. Explosions are punctuation marks, not commas. The sound mix should feel overwhelming in the best way -- immersive chaos that makes the listener feel inside the action. Humor comes through adrenaline-fueled quips, never stopping the momentum.',

    sceneStructure: 'Peak action within the first 30 seconds. Escalate continuously. Rest periods exist only to set up the next set piece. Cross-cut between multiple action threads for momentum.',

    signatureElements: ['slow-motion hero shots', 'golden-hour lighting', 'rapid escalation', 'military aesthetics', 'destruction spectacle'],

    soundDesign: {
      ambience: 'Dense and layered. Multiple simultaneous sound sources: radio chatter, alarms, distant explosions, helicopter rotors, wind. The environment is never quiet -- even "calm" scenes have a low rumble of machinery or traffic.',
      effects: 'Maximalist and visceral. Every impact has weight -- metal crunching, glass shattering in slow motion, bullet ricochets with trailing reverb. Explosions are multi-layered: initial blast, shockwave, debris rain, aftermath ringing.',
      music: 'Epic orchestral with driving percussion. Hans Zimmer meets rock guitar. Music swells for hero moments, drops to bass pulse during approach sequences. The score never lets up -- it IS the emotional throughline.',
      silence: 'Almost never used. When silence does appear (the moment before detonation, the split-second of freefall), it is a sharp intake of breath before the loudest possible payoff.'
    },

    voiceActing: {
      narrator: 'Commanding and kinetic. The narrator speaks with military precision during briefings, then shifts to breathless urgency during action. Think documentary-style authority mixed with rollercoaster energy.',
      dialogue: 'Short, punchy, quotable. Characters bark orders, crack one-liners under fire, and deliver terse emotional beats between explosions. No one speaks in paragraphs -- every line is a bumper sticker.',
      emotion: 'Intensity IS the emotion. Love is declared while running from explosions. Grief is a single shouted name. Joy is a victory whoop. Feelings hit like a truck and move on.',
      physicality: 'Breathless, sweating, shouting over noise. Characters sound like they are physically exerting -- running, ducking, climbing. Vocal cords strained from yelling. Heavy breathing between lines.'
    }
  },

  // =========================================================================
  // 3. Wes Anderson
  // =========================================================================
  wesAnderson: {
    name: 'Wes Anderson',
    bestFor: ['humor', 'literary', 'fairytale'],
    description: 'Precise and whimsical. Curated, diorama-like sound design with deadpan vocal delivery that treats absurdity as perfectly normal.',

    sfxPhilosophy: 'Precise and whimsical. Typewriter clicks, bicycle bells, record player scratches, analog telephones. Every sound is curated, never ambient noise. Diegetic music preferred (characters playing instruments, radios). Sound design should feel like a diorama -- contained and intentional.',

    voiceDirection: 'Deadpan delivery with measured pacing. Characters speak as if reading from a novel -- articulate, slightly formal, emotionally understated. Pauses are architectural. Every line is delivered with the same flat intensity regardless of content.',

    pacing: 'Metronomic and deliberate. Scenes unfold with the precision of a Swiss watch. Conversations have a rhythmic, almost musical cadence. Nothing is rushed. The comedy comes from the contrast between measured delivery and absurd content.',

    productionNotes: 'Symmetry in everything -- narrative structure mirrors visual composition. Introduce characters formally (narrator announces them with titles). Use chapter cards and structural devices. The melancholy is real but wrapped in whimsy. Anachronisms are deliberate -- mix decades freely.',

    sceneStructure: 'Symmetrical composition translated to narrative. Scenes begin and end with formal precision. Introduce characters with title cards (narrator announces them). Parallel storylines that mirror each other structurally.',

    signatureElements: ['narrator interjections', 'chapter titles', 'ensemble casts', 'melancholy beneath humor', 'deliberate anachronisms'],

    soundDesign: {
      ambience: 'Curated and minimal. No random background noise. If you hear a train, it is because a train matters. Environmental sounds are selected props in the diorama, not recorded atmosphere.',
      effects: 'Precise mechanical sounds. Typewriter keys, rotary phone dials, stamp pad impressions, scissors cutting paper, a suitcase latch clicking. Every effect is crisp, close-miked, and intentional -- foley as art direction.',
      music: 'Eclectic vinyl-era selections. 60s French pop, British Invasion, Bowie deep cuts, classical chamber pieces. Diegetic whenever possible (a record player in the scene, a character humming). Original score: gentle plucked strings, glockenspiel, harpsichord.',
      silence: 'Brief, architectural pauses. Silence functions as punctuation between deadpan lines -- a beat of quiet, then the next precisely timed delivery. Never uncomfortable, always compositional.'
    },

    voiceActing: {
      narrator: 'Omniscient, literary, slightly bemused. The narrator speaks in complete, well-constructed sentences as if reading from a published novel. Third-person past tense. Dry wit delivered with zero inflection.',
      dialogue: 'Flat, articulate, formally phrased regardless of emotion. Characters announce their feelings rather than expressing them: "I am very hurt by what you just said." Conversations feel scripted in the best way -- every word chosen.',
      emotion: 'Understated to the point of comedy. Heartbreak is expressed with the same vocal energy as ordering breakfast. The gap between devastating content and deadpan delivery IS the emotional impact.',
      physicality: 'Minimal. Characters sound like they are sitting perfectly still in a well-appointed room. No heavy breathing, no vocal strain. If a character runs, they arrive slightly out of breath but immediately compose themselves.'
    }
  },

  // =========================================================================
  // 4. Quentin Tarantino
  // =========================================================================
  tarantino: {
    name: 'Quentin Tarantino',
    bestFor: ['thriller', 'humor', 'mystery'],
    description: 'Strategic silence then sudden violence. Extended naturalistic dialogue with pop-culture cadence, punctuated by visceral bursts of action.',

    sfxPhilosophy: 'Strategic silence punctuated by sudden violence. Long dialogue scenes should have ZERO background music/SFX -- let the words create tension. When violence erupts, make it visceral and sudden: sharp impacts, glass breaking, ricochets. Use curated music tracks (60s-70s pop/soul) as ironic counterpoint.',

    voiceDirection: 'Extended naturalistic dialogue with pop culture cadence. Characters talk AROUND the point before getting to it. Monologues are performances. Let dialogue breathe -- long pauses, interruptions, talking over each other. Every character has a distinctive verbal tic.',

    pacing: 'Extreme contrast. Scenes of extended, unhurried conversation (5-10 minutes of people just talking) explode into brief, savage violence. The audience never knows when the switch will flip. Non-linear timeline adds structural unpredictability.',

    productionNotes: 'Chapter structure is mandatory. Open in medias res, then jump back. Every character needs a distinctive voice -- verbal tics, favorite phrases, speech rhythms. Pop culture references ground the world in specificity. Violence is sudden, graphic, and often has darkly comic timing. The Mexican standoff is always verbal first.',

    sceneStructure: 'Non-linear timeline. Open in medias res, then jump back. Signature chapter structure. Build tension through conversation, not action -- the Mexican standoff is always verbal first.',

    signatureElements: ['non-linear narrative', 'chapter structure', 'pop culture references', 'verbose dialogue', 'sudden tonal shifts'],

    soundDesign: {
      ambience: 'Conspicuously absent during dialogue scenes. When characters talk, you hear ONLY their voices and immediate physical actions (lighting a cigarette, pouring a drink). The world outside the conversation does not exist.',
      effects: 'Sudden and brutal. Gunshots are loud and startling with no musical buildup. Impacts have wet, physical weight. Glass breaks. Bodies hit floors. The contrast with preceding silence makes every effect feel twice as loud.',
      music: 'Curated needle-drops from 60s-70s funk, soul, surf rock, spaghetti western scores. Music is ironic counterpoint -- upbeat tracks over dark scenes. Never generic scoring. Each track is a specific, recognizable song that recontextualizes the scene.',
      silence: 'The primary tool. Extended dialogue scenes in near-total silence (just voices and foley) create unbearable tension. The audience waits for the explosion. The longer the silence, the more devastating the break.'
    },

    voiceActing: {
      narrator: 'Rarely used -- characters narrate their own stories. When present, the narrator is a character with opinions, not an objective voice. Conversational, profane, opinionated. Speaks directly to the listener.',
      dialogue: 'Naturalistic, verbose, and distinctive per character. People talk the way real people talk -- with tangents, interruptions, repeated words, and opinions about hamburgers. Every character has a recognizable speech pattern that could identify them without attribution.',
      emotion: 'Builds through monologue. Characters process emotion by TALKING -- long speeches that circle around the feeling before arriving at it. Anger escalates through vocabulary and volume. Fear manifests as talking too much or too fast.',
      physicality: 'Full-bodied and theatrical. Characters perform their dialogue -- leaning in, gesturing, standing up to make a point. Eating while talking. Smoking while threatening. The physical business of living continues through every conversation.'
    }
  },

  // =========================================================================
  // 5. Studio Ghibli
  // =========================================================================
  ghibli: {
    name: 'Studio Ghibli',
    bestFor: ['fantasy', 'fairytale', 'ya'],
    description: 'Nature-heavy and gentle. Immersive environmental soundscapes with vocal performances rooted in wonder, sincerity, and emotional restraint.',

    sfxPhilosophy: 'Nature-heavy and gentle. Wind through grass, rain on leaves, insects buzzing, water flowing. Footsteps on different surfaces (wood, stone, earth). Cooking sounds, tea pouring, fabric rustling. Environmental sounds should create a living world. Music: piano, strings, gentle woodwinds.',

    voiceDirection: 'Wonder and restraint. Emotional simplicity -- characters express feelings directly but quietly. Children speak like children (not precocious). Villains are sympathetic and soft-spoken. Joy is expressed through laughter, not exclamation.',

    pacing: 'Contemplative with bursts of kinetic energy. Allow long pauses for atmosphere -- a character watching rain, eating a meal, walking through a forest. These moments are not filler; they are the soul of the story. Action sequences are fluid and dreamlike, never frantic.',

    productionNotes: 'The natural world is a character. Weather, seasons, and landscape should be described with the same care as human characters. Food scenes are mandatory -- show characters cooking and eating with loving detail. There are no pure villains; antagonists have comprehensible motivations. Flying sequences should feel liberating and joyful.',

    sceneStructure: 'Allow contemplative pauses. Not every scene needs conflict -- some exist purely to establish atmosphere (eating a meal, watching clouds). Let landscapes breathe. The journey matters as much as the destination.',

    signatureElements: ['contemplative pauses', 'flight sequences', 'found family', 'environmentalism', 'no pure villains', 'food scenes'],

    soundDesign: {
      ambience: 'Rich, layered natural environments. Birdsong (specific species, not generic), wind in different types of trees, water over rocks, insects at different times of day. Interior ambience is equally detailed: wood settling, a fire crackling, a clock on the wall.',
      effects: 'Organic and warm. Footsteps on varied surfaces (tatami, forest floor, stone steps, puddles). Cooking foley (chopping, sizzling, pouring). Fabric rustling, paper turning, doors sliding. Magical effects are soft -- chimes, gentle whooshes, crystalline tones.',
      music: 'Joe Hisaishi aesthetic. Solo piano melodies that are simple but emotionally devastating. Gentle orchestral swells for wonder. Woodwinds (flute, clarinet) for pastoral scenes. Accordion or harmonica for journey sequences. Music should feel handmade, not produced.',
      silence: 'Contemplative, not tense. Silence in Ghibli is the sound of a character thinking, watching, absorbing the world. A pause before speaking that shows the character choosing their words carefully. Comfortable, lived-in quiet.'
    },

    voiceActing: {
      narrator: 'Warm, grandfatherly/grandmotherly tone. The narrator speaks as if telling a bedtime story -- unhurried, kind, with genuine wonder. May address the listener gently. Pauses to let images form in the mind.',
      dialogue: 'Simple, direct, emotionally honest. Characters say what they mean without artifice. Children sound like real children -- uncertain, curious, sometimes stubborn. Adults are patient and speak to children as equals. No quips or cleverness for its own sake.',
      emotion: 'Quiet intensity. Tears fall without sobbing. Joy is a bright laugh that fades into a contented sigh. Anger is quiet disappointment more often than shouting. The deepest emotions are expressed in the simplest words.',
      physicality: 'Light and natural. Characters sound embodied -- you hear them shift position, take a breath before speaking, hum while working. Running sounds breathless but exhilarated. Eating sounds appreciative. Sleeping sounds peaceful.'
    }
  },

  // =========================================================================
  // 6. Christopher Nolan
  // =========================================================================
  nolan: {
    name: 'Christopher Nolan',
    bestFor: ['scifi', 'thriller'],
    description: 'Layered atmospheric pressure. Dense, cerebral sound design with vocal performances driven by intellectual urgency and tightly controlled emotion.',

    sfxPhilosophy: 'Layered atmospheric dread. Deep bass rumbles (Hans Zimmer aesthetic), ticking clocks, mechanical sounds, space ambience. Music should feel like pressure building -- crescendos that never quite release. Sound design creates cognitive dissonance (conversations over alarm sounds, calm dialogue during visual chaos).',

    voiceDirection: 'Cerebral tension. Characters explain complex ideas clearly but with urgency. Dialogue is exposition that feels natural. Emotional beats are understated -- a crack in the voice, not a breakdown. Whispered intensity over shouting.',

    pacing: 'Multi-threaded and accelerating. Parallel timelines move at different speeds, converging toward a single climactic moment. Each thread accelerates independently. The structural complexity itself creates tension -- the audience works to keep up, and that cognitive engagement IS the suspense.',

    productionNotes: 'Time is always a factor -- literal clocks, deadlines, or the structure of time itself. The science should feel plausible even when speculative. Emotional content is earned through restraint; when a character finally breaks composure, it devastates. The structure of the narrative is itself a puzzle the audience assembles.',

    sceneStructure: 'Parallel timelines converging. Build complexity through interleaving scenes at different time scales. The structure itself is a puzzle the audience assembles. Peak emotional moment coincides with structural convergence.',

    signatureElements: ['time manipulation', 'parallel timelines', 'IMAX-scale scope', 'ticking clock urgency', 'emotional restraint masking deep feeling'],

    soundDesign: {
      ambience: 'Oppressive and mechanical. Deep sub-bass hums that you feel rather than hear. Ticking clocks layered at different tempos. The hiss of oxygen systems, the groan of metal under pressure. Environments sound like they are exerting force on the characters.',
      effects: 'Massive scale rendered with documentary realism. Rocket engines are deafening. Waves are mountains of sound. Gunshots in enclosed spaces ring with painful reverb. Physics-accurate sound (no sound in space vacuum, muffled explosions underwater).',
      music: 'Hans Zimmer aesthetic: pipe organ, massed strings, synthesizer pulses. Music functions as a ticking clock -- rhythmic, insistent, building. Crescendos that approach but never reach resolution. The Shepard tone of ever-ascending tension.',
      silence: 'Terrifying. Silence means vacuum, void, the absence of life support. When sound drops out mid-scene, something has gone catastrophically wrong. Silence in dialogue means a character has realized something devastating.'
    },

    voiceActing: {
      narrator: 'Sparse, used only for structural necessity. When present, clinical and precise -- a physicist explaining the rules. No warmth, no opinion. The narrator is a mechanism, not a character.',
      dialogue: 'Exposition delivered as urgent conversation. Characters explain complex concepts while running out of time. Technical language used naturally. People talk past each other -- everyone has a piece of the puzzle, no one has the whole picture.',
      emotion: 'Deeply buried. Characters intellectualize their feelings. A scientist talks about gravity when they mean love. The emotional payload arrives in a single line after 20 minutes of cerebral dialogue, and it hits like a freight train.',
      physicality: 'Tense and constrained. Characters sound like they are in pressure suits, confined spaces, underwater. Breathing is measured and deliberate. When physicality breaks through (gasping, shouting), the contrast with prior restraint is shattering.'
    }
  },

  // =========================================================================
  // 7. Steven Spielberg
  // =========================================================================
  spielberg: {
    name: 'Steven Spielberg',
    bestFor: ['adventure', 'scifi', 'fantasy'],
    description: 'Sweeping and emotional. Soaring orchestral sound design with vocal performances grounded in sincerity, wonder, and earned sentimentality.',

    sfxPhilosophy: 'Sweeping and emotional. John Williams aesthetic -- soaring orchestral themes, leitmotifs for characters. Sound design serves wonder: alien technology hums, dinosaur roars, magical sparkles. Build to crescendos that match emotional peaks. The music tells you what to feel.',

    voiceDirection: 'Sincerity above all. Characters mean what they say. Heroes discover courage through vulnerability. Wonder expressed through breathless observation ("It\'s... it\'s beautiful"). Children are wise but still children. Villains have conviction.',

    pacing: 'Classic three-act mastery. Patient setup that builds empathy before introducing danger. The middle act escalates methodically. The climax earns every emotional beat through what came before. Denouement is brief but deeply satisfying. Never rushed, never padded.',

    productionNotes: 'The "Spielberg face" -- describe characters reacting to something wondrous BEFORE revealing the wonder itself. Let the audience feel the awe through the character. Father-child relationships are thematic anchors. Ordinary people in extraordinary circumstances. Practical-feeling action over stylized spectacle. Earn every tear.',

    sceneStructure: 'Classic three-act structure executed perfectly. Build empathy before danger. The "Spielberg face" moment -- characters looking at something awe-inspiring before we see it. Earn the emotional climax through patient setup.',

    signatureElements: ['sense of wonder', 'father-child themes', 'ordinary heroes', 'practical effects feel', 'earned sentimentality'],

    soundDesign: {
      ambience: 'Warm and immersive. Suburban neighborhoods at dusk (crickets, sprinklers, distant laughter). Alien environments that feel wondrous rather than threatening. Jungle sounds that are alive and vibrant. The world sounds like a place you want to explore.',
      effects: 'Iconic and larger-than-life. Each major element gets a signature sound (the T-Rex roar, the spaceship hum, the whip crack). Effects serve emotion -- a rumbling footstep means danger, a gentle chime means magic. Sound design tells the story even without dialogue.',
      music: 'John Williams orchestral grandeur. Memorable leitmotifs for characters and concepts. French horns for heroism, strings for emotion, brass for adventure. The score is inseparable from the story -- it IS the emotional experience.',
      silence: 'The calm before wonder. A moment of held breath before the reveal. Characters go quiet, ambient sound fades, and then -- the full orchestra. Silence is the setup for the most powerful emotional moments.'
    },

    voiceActing: {
      narrator: 'Warm, trustworthy, slightly awed by the story being told. The narrator believes in the tale and wants the listener to believe too. Never ironic, never detached. May be a character looking back on events with perspective and tenderness.',
      dialogue: 'Natural, overlapping, lived-in. Characters stammer when nervous, talk over each other in excitement, trail off when overwhelmed. Children speak like real children -- distracted, tangential, suddenly profound. Adults are imperfect but trying.',
      emotion: 'Sincere and unashamed. Characters cry when moved, laugh when delighted, tremble when afraid. Emotional moments are earned through buildup, not manufactured. The sentiment is real because the characters are real. Never cynical.',
      physicality: 'Grounded and human. You hear characters breathing hard after running, their voice shaking with cold or fear, their words catching with emotion. Physical reactions are honest -- gasps, sighs, nervous laughter. Bodies respond before minds.'
    }
  },

  // =========================================================================
  // 8. David Lynch
  // =========================================================================
  lynch: {
    name: 'David Lynch',
    bestFor: ['horror', 'mystery'],
    description: 'Uncanny and ambient. Deeply unsettling sound design with dreamlike vocal cadences that make the familiar feel alien and threatening.',

    sfxPhilosophy: 'Uncanny and ambient. Industrial hums, electrical buzzing, distorted room tone. Sounds should feel slightly WRONG -- familiar but pitch-shifted, reversed, or layered. Angelo Badalamenti aesthetic: smooth jazz that feels threatening. Silence itself should hum.',

    voiceDirection: 'Dreamlike cadence. Characters deliver dialogue with unsettling calm -- even when saying normal things. Pauses stretch uncomfortably. Whispers alternate with sudden loud declarations. Some characters speak in riddles or non-sequiturs that feel meaningful.',

    pacing: 'Hypnotic and disorienting. Scenes run longer than expected, then cut abruptly. Time feels elastic -- a conversation that should take 30 seconds takes 3 minutes. Repetition with variation creates a trance state. The audience loses track of how long they have been in a scene.',

    productionNotes: 'Reality is unreliable. The same scene may play twice with different details. Characters may have doubles or alternate versions. Small-town Americana conceals cosmic darkness. Mundane objects (a lamp, a curtain, a cup of coffee) become charged with inexplicable significance. Dream sequences and waking life are indistinguishable.',

    sceneStructure: 'Dream logic over narrative logic. Scenes connect emotionally, not causally. Reality shifts without warning. Repeat motifs with slight variations (same scene, different context). Mundane scenes become threatening through duration.',

    signatureElements: ['dream logic', 'doppelgangers', 'small-town darkness', 'industrial imagery', 'surreal non-sequiturs', 'red curtains'],

    soundDesign: {
      ambience: 'Ever-present low-frequency hum. Rooms have a tone -- not silence, but a living vibration. Electrical buzzing, fluorescent light flicker, distant industrial machinery. The background sound is always slightly wrong, as if the world itself is malfunctioning.',
      effects: 'Distorted and uncanny. Familiar sounds (a doorbell, a phone ring, footsteps) are subtly altered -- slightly too slow, too reverberant, or layered with an undertone that should not be there. Mechanical sounds feel organic. Organic sounds feel mechanical.',
      music: 'Angelo Badalamenti smooth jazz that drips with menace. 50s doo-wop that sounds like it is playing from the bottom of a well. Ambient drones. Julee Cruise ethereal vocals. The music is beautiful and deeply unsettling simultaneously.',
      silence: 'There is no true silence -- only quieter layers of ambient wrongness. When dialogue stops, the hum becomes louder. "Quiet" scenes are the most disturbing because you can hear the frequency of the room, and it is not a frequency that should exist.'
    },

    voiceActing: {
      narrator: 'Detached and enigmatic. The narrator may not be trustworthy. Speaks in a calm, measured cadence that makes everything sound like a secret being shared. May repeat phrases. May contradict themselves. The narrator is inside the dream.',
      dialogue: 'Unsettlingly deliberate. Characters over-enunciate ordinary words. Pauses between sentences stretch past comfort. Some characters speak in riddles that feel like they should make sense. Others say perfectly normal things in a way that makes them sound like prophecy.',
      emotion: 'Displaced. Characters react to the wrong things -- calm during horror, terrified of a cup of coffee. Emotional responses are authentic but misaligned with context. Laughter that goes on too long. Tears that appear without cause and vanish without acknowledgment.',
      physicality: 'Eerie stillness punctuated by sudden movement. Characters hold unnaturally still while speaking. When they move, it is either languid (dream-slow) or jarringly abrupt. Breath sounds are amplified. Swallowing is audible. The body is present and strange.'
    }
  }
};

// ---------------------------------------------------------------------------
// Public API Functions
// ---------------------------------------------------------------------------

/**
 * Get a single director style by key. Returns a fallback (Spielberg) if
 * the key is provided but not found, or null if no key is given.
 *
 * @param {string} key - Director key (e.g. 'hitchcock', 'ghibli')
 * @returns {DirectorStyle|null} Director data, fallback, or null
 */
export function getDirectorStyle(key) {
  if (!key) return null;

  const normalized = key.toLowerCase().replace(/[\s-]/g, '');
  const director = DIRECTOR_STYLES[normalized];

  if (director) return director;

  // Try a fuzzy match on name
  for (const [dirKey, dir] of Object.entries(DIRECTOR_STYLES)) {
    if (dir.name.toLowerCase().replace(/[\s.]/g, '').includes(normalized)) {
      return dir;
    }
  }

  // Fallback: return Spielberg as the most versatile default
  logger.warn(`[DirectorStyles] Unknown director key "${key}", falling back to Spielberg`);
  return DIRECTOR_STYLES.spielberg;
}

/**
 * Auto-detect the best director for a given genre mix.
 * Accepts either an object of weighted genres ({ fantasy: 70, horror: 50 })
 * or an array of genre strings (['fantasy', 'horror']).
 *
 * Scores each director by how well their bestFor genres overlap with the
 * provided genres, weighted by genre importance.
 *
 * @param {Object|string[]} genres - Genre weights or genre string array
 * @returns {string|null} Best matching director key, or null if no genres provided
 */
export function getDirectorForGenres(genres) {
  if (!genres) return null;

  // Normalize input: accept array of strings or weighted object
  let genreEntries;
  if (Array.isArray(genres)) {
    if (genres.length === 0) return null;
    genreEntries = genres.map(g => [g.toLowerCase(), 1]);
  } else if (typeof genres === 'object') {
    genreEntries = Object.entries(genres).filter(([, weight]) => weight > 0);
    if (genreEntries.length === 0) return null;
    // Normalize keys to lowercase
    genreEntries = genreEntries.map(([g, w]) => [g.toLowerCase(), w]);
  } else {
    return null;
  }

  let bestKey = null;
  let bestScore = -1;

  for (const [directorKey, director] of Object.entries(DIRECTOR_STYLES)) {
    let score = 0;
    for (const [genre, weight] of genreEntries) {
      if (director.bestFor.includes(genre)) {
        score += weight;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestKey = directorKey;
    }
  }

  // Only recommend if there is at least some genre overlap
  return bestScore > 0 ? bestKey : null;
}

/**
 * Build a VAD (Voice Actor Direction) guidance string for injection into
 * scene generation prompts. This replaces the static VAD text block that
 * was previously hardcoded in openai.js, making it director-aware.
 *
 * The output is a formatted multi-line string ready to be concatenated
 * into a system or user prompt.
 *
 * @param {Object} preferences - Story preferences from the config
 * @param {boolean} [preferences.multi_voice] - Whether multi-voice VAD is enabled
 * @param {boolean} [preferences.hide_speech_tags] - Whether to minimize speech attribution
 * @param {DirectorStyle|null} directorStyle - Director style object (from getDirectorStyle)
 * @returns {string} Formatted VAD guidance block, or empty string if VAD is not enabled
 */
export function buildVADGuidance(preferences, directorStyle) {
  if (!preferences?.multi_voice) return '';

  const director = directorStyle || DIRECTOR_STYLES.spielberg;
  const dirName = director.name;

  // Build the speech tag section based on preference
  let speechTagSection;
  if (preferences.hide_speech_tags === true) {
    speechTagSection = `
**CRITICAL: MINIMIZE SPEECH ATTRIBUTION (Hide Speech Tags Mode)**
Since listeners hear DIFFERENT VOICES for each character, excessive "he said/she replied" is redundant.
Replace speech attribution with ACTION BEATS that reveal character:

BAD: "I don't understand," Sarah said sadly.
GOOD: "I don't understand." Sarah's shoulders slumped, her fingers tracing the rim of her empty cup.

BAD: "We need to leave now," Marcus replied urgently.
GOOD: "We need to leave now." Marcus was already gathering his things, eyes darting to the door.

ACTION BEAT TECHNIQUES:
- Physical reactions (crossed arms, stepped back, jaw tightened)
- Environmental interaction (slammed the door, paced the room)
- Internal reactions when POV allows (heart racing, stomach churning)
- Facial expressions (eyes narrowed, lips pressed thin)
- Revealing gestures (fingers drummed, hands clenched)

WHEN ATTRIBUTION IS STILL NEEDED:
- First line in a long exchange (establish who starts)
- Ambiguous situations with 3+ speakers
- Whispers/shouts that change delivery`;
  } else {
    speechTagSection = `
**RICH DELIVERY DESCRIPTORS (Standard VAD Mode)**
Each voice actor needs emotional guidance. Write vivid speech tags that direct performance:

BAD: "I don't know," she said.
GOOD: "I don't know," she whispered, her voice catching on the words.

BAD: "Get out!" he yelled.
GOOD: "Get out!" The words tore from his throat, raw with betrayal.

DELIVERY CUE TECHNIQUES:
- Vocal quality (hoarse, trembling, clipped, lilting)
- Emotional undertone (with barely concealed fury, through gritted teeth)
- Physical influence (breathlessly, after a shaky inhale)
- Subtext hints (the lie smooth on her lips, forcing lightness he didn't feel)`;
  }

  // Director-specific voice acting guidance
  const directorVoiceSection = `

## Production Director: ${dirName}

### Voice Acting Direction
- NARRATOR: ${director.voiceActing.narrator}
- DIALOGUE: ${director.voiceActing.dialogue}
- EMOTION: ${director.voiceActing.emotion}
- PHYSICALITY: ${director.voiceActing.physicality}

### Sound Design Philosophy
- AMBIENCE: ${director.soundDesign.ambience}
- EFFECTS: ${director.soundDesign.effects}
- MUSIC: ${director.soundDesign.music}
- SILENCE: ${director.soundDesign.silence}

### Scene Pacing
${director.pacing}

### Scene Structure
${director.sceneStructure}

### Signature Elements to Incorporate
${director.signatureElements.map(el => `- ${el}`).join('\n')}`;

  // Assemble the complete guidance block
  return `

== VOICE-ACTED AUDIOBOOK WRITING STYLE (${dirName} Direction) ==
This story uses MULTIPLE VOICE ACTORS - each character has their own distinct voice.
Write like you're crafting an audiobook script where listeners HEAR who's speaking.
${speechTagSection}

GENERAL VAD WRITING PRINCIPLES:
1. Dialogue should be SPEAKABLE - read it aloud mentally
2. Vary sentence rhythm - short punchy lines vs. flowing thoughts
3. Give each character a distinct speech pattern (formal/casual, verbose/terse)
4. Use contractions naturally ("I'm" not "I am" for casual speech)
5. Include meaningful pauses through sentence structure
6. Characters should sound like REAL PEOPLE, not prose descriptions of speech
${directorVoiceSection}`;
}

/**
 * Return a simplified list of all directors for UI display.
 * Each entry contains only the fields needed for selection UI.
 *
 * @returns {Array<{key: string, name: string, description: string, bestFor: string[]}>}
 */
export function getAllDirectorsList() {
  return Object.entries(DIRECTOR_STYLES).map(([key, director]) => ({
    key,
    name: director.name,
    description: director.description,
    bestFor: director.bestFor
  }));
}

// ---------------------------------------------------------------------------
// Backward-Compatible Exports (existing consumers)
// ---------------------------------------------------------------------------

/**
 * Get all director styles as an array with keys included.
 * @returns {Array<Object>} Array of { key, name, bestFor, ... }
 */
export function getAllDirectorStyles() {
  return Object.entries(DIRECTOR_STYLES).map(([key, data]) => ({
    key,
    ...data
  }));
}

/**
 * Recommend the best director for a given genre mix.
 * @deprecated Use getDirectorForGenres() instead.
 * @param {Object} genres - Genre weights keyed by slug
 * @returns {string|null} Best matching director key
 */
export function getRecommendedDirector(genres) {
  return getDirectorForGenres(genres);
}

/**
 * Build a formatted prompt section for scene generation (VAD orchestrator).
 * Includes scene structure guidance and signature elements.
 *
 * @param {string} directorKey - Director key
 * @returns {string} Formatted prompt section, or empty string if director not found
 */
export function buildDirectorVADGuidance(directorKey) {
  const director = getDirectorStyle(directorKey);
  if (!director) return '';

  return [
    `## Production Director: ${director.name}`,
    '',
    '### Scene Structure',
    director.sceneStructure,
    '',
    '### Signature Elements to Incorporate',
    director.signatureElements.map(el => `- ${el}`).join('\n'),
    '',
    '### Voice Direction Philosophy',
    director.voiceDirection
  ].join('\n');
}

/**
 * Build a formatted prompt section for the SFX coordinator agent.
 * Focuses on the director's sound design philosophy.
 *
 * @param {string} directorKey - Director key
 * @returns {string} Formatted prompt section, or empty string if director not found
 */
export function buildDirectorSFXGuidance(directorKey) {
  const director = getDirectorStyle(directorKey);
  if (!director) return '';

  return [
    `## SFX Direction (${director.name} Style)`,
    '',
    director.sfxPhilosophy,
    '',
    '### Detailed Sound Design',
    `- Ambience: ${director.soundDesign.ambience}`,
    `- Effects: ${director.soundDesign.effects}`,
    `- Music: ${director.soundDesign.music}`,
    `- Silence: ${director.soundDesign.silence}`,
    '',
    'Signature elements to reflect in sound design:',
    director.signatureElements.map(el => `- ${el}`).join('\n')
  ].join('\n');
}

/**
 * Build a formatted prompt section for the voice director agent.
 * Focuses on vocal delivery, emotional range, and character voice guidance.
 *
 * @param {string} directorKey - Director key
 * @returns {string} Formatted prompt section, or empty string if director not found
 */
export function buildDirectorVoiceGuidance(directorKey) {
  const director = getDirectorStyle(directorKey);
  if (!director) return '';

  return [
    `## Voice Direction (${director.name} Style)`,
    '',
    director.voiceDirection,
    '',
    '### Detailed Voice Acting Guidance',
    `- Narrator: ${director.voiceActing.narrator}`,
    `- Dialogue: ${director.voiceActing.dialogue}`,
    `- Emotion: ${director.voiceActing.emotion}`,
    `- Physicality: ${director.voiceActing.physicality}`,
    '',
    '### Pacing',
    director.pacing,
    '',
    'Scene pacing and structure context:',
    director.sceneStructure
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Module Exports
// ---------------------------------------------------------------------------

export { DIRECTOR_STYLES };
export default DIRECTOR_STYLES;
