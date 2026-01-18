/**
 * Slider Messages and Color Gradients
 *
 * Provides dynamic, context-aware feedback for content intensity sliders.
 * Each tier has multiple messages for variety.
 *
 * Colors follow intensity progression:
 * - Green: Safe/Mild
 * - Yellow: Moderate caution
 * - Orange: Strong warning
 * - Red: Intense/Extreme
 * - Dark Red: Maximum intensity
 */

// Message tiers for each slider type
// Each tier has: min, max (inclusive), messages array
export const SLIDER_MESSAGES = {
  violence: [
    { min: 0, max: 9, messages: [
      "Someone might get pushed or fall down",
      "Pillow fights and playground scuffles",
      "Slapstick comedy violence only",
      "Cartoon bonks and pratfalls"
    ]},
    { min: 10, max: 19, messages: [
      "Cartoon violence, nothing graphic",
      "Action movie PG-rated scuffles",
      "Superhero battles without consequences",
      "Adventure-style fisticuffs"
    ]},
    { min: 20, max: 29, messages: [
      "Fist fights, fantasy violence, no blood or gore",
      "Bar brawls and sword clashes",
      "Western-style showdowns",
      "Intense but clean action sequences"
    ]},
    { min: 30, max: 39, messages: [
      "Bloody fights and light gore",
      "Visible wounds and bruises",
      "Combat with real consequences",
      "Violence that leaves marks"
    ]},
    { min: 40, max: 49, messages: [
      "Graphic combat with blood",
      "Detailed injury descriptions",
      "War movie intensity",
      "Unflinching battle scenes"
    ]},
    { min: 50, max: 59, messages: [
      "Breaking bones and painful injuries",
      "Visceral combat descriptions",
      "Saving Private Ryan opening scene",
      "Violence with lasting trauma"
    ]},
    { min: 60, max: 69, messages: [
      "Brutal violence with lasting consequences",
      "Gladiator-level intensity",
      "Detailed suffering and pain",
      "Kill Bill choreographed carnage"
    ]},
    { min: 70, max: 79, messages: [
      "War movie intensity and brutality",
      "Apocalypse Now darkness",
      "Violence that haunts characters",
      "Graphic realism in every blow"
    ]},
    { min: 80, max: 89, messages: [
      "Passion of the Christ intensity",
      "Torture and extreme suffering",
      "Unflinching depictions of agony",
      "Martyrdom-level brutality"
    ]},
    { min: 90, max: 100, messages: [
      "Likely to be banned in all countries",
      "Hostel/Saw levels of graphic violence",
      "Extreme torture porn territory",
      "No limits on depicted suffering"
    ]}
  ],

  gore: [
    { min: 0, max: 9, messages: [
      "Clean as a children's book",
      "No blood, no mess",
      "Wounds heal magically off-screen"
    ]},
    { min: 10, max: 19, messages: [
      "A scrape here, a bruise there",
      "Minor injuries, quickly forgotten",
      "PG-rated boo-boos"
    ]},
    { min: 20, max: 29, messages: [
      "Blood appears but isn't described",
      "Wounds exist but aren't dwelt upon",
      "Action movie blood splatter"
    ]},
    { min: 30, max: 39, messages: [
      "Visible blood and wounds described",
      "Medical drama level detail",
      "Injuries have consequences"
    ]},
    { min: 40, max: 49, messages: [
      "Detailed wound descriptions",
      "Blood pools and stains",
      "The Walking Dead first seasons"
    ]},
    { min: 50, max: 59, messages: [
      "Anatomically detailed injuries",
      "Internal organs may be mentioned",
      "Battlefield surgery realism"
    ]},
    { min: 60, max: 69, messages: [
      "Graphic surgical detail",
      "Body horror elements",
      "Splatter film territory"
    ]},
    { min: 70, max: 79, messages: [
      "Dead Alive/Braindead levels",
      "Fountains of the red stuff",
      "Horror movie practical effects"
    ]},
    { min: 80, max: 89, messages: [
      "Extreme body horror",
      "Lovecraftian flesh descriptions",
      "Medical nightmare fuel"
    ]},
    { min: 90, max: 100, messages: [
      "Cannibal Holocaust territory",
      "Nothing is off-limits",
      "Maximum visceral horror"
    ]}
  ],

  romance: [
    { min: 0, max: 9, messages: [
      "Platonic friendships only",
      "No romantic subplot",
      "Pure adventure focus"
    ]},
    { min: 10, max: 19, messages: [
      "Longing glances across the room",
      "Butterflies and blushing",
      "Hallmark movie tension"
    ]},
    { min: 20, max: 29, messages: [
      "Hand-holding and meaningful looks",
      "First kiss territory",
      "Sweet courtship moments"
    ]},
    { min: 30, max: 39, messages: [
      "Passionate kisses and embraces",
      "Romantic declarations",
      "Pride and Prejudice intensity"
    ]},
    { min: 40, max: 49, messages: [
      "Heated moments and chemistry",
      "Fade to black implied intimacy",
      "The Notebook passion"
    ]},
    { min: 50, max: 59, messages: [
      "Steamy romance novel territory",
      "Morning after scenes",
      "Explicit emotional intimacy"
    ]},
    { min: 60, max: 69, messages: [
      "Bodice-ripper intensity",
      "Passion described in detail",
      "50 Shades mainstream edition"
    ]},
    { min: 70, max: 79, messages: [
      "Explicit romantic encounters",
      "Nothing left to imagination",
      "Adult romance novel standard"
    ]},
    { min: 80, max: 89, messages: [
      "Detailed intimate scenes",
      "Multiple encounters per chapter",
      "Erotica territory"
    ]},
    { min: 90, max: 100, messages: [
      "Pure erotica focus",
      "Graphic intimate content",
      "Maximum sensuality"
    ]}
  ],

  adultContent: [
    { min: 0, max: 9, messages: [
      "Family-friendly content only",
      "Safe for all audiences",
      "Disney Channel approved"
    ]},
    { min: 10, max: 19, messages: [
      "Teen-appropriate themes",
      "Coming-of-age content",
      "YA novel territory"
    ]},
    { min: 20, max: 29, messages: [
      "Mild adult themes",
      "PG-13 movie content",
      "Network TV standards"
    ]},
    { min: 30, max: 39, messages: [
      "Mature themes present",
      "Cable TV drama level",
      "Game of Thrones early seasons"
    ]},
    { min: 40, max: 49, messages: [
      "Adult situations and language",
      "R-rated movie content",
      "Premium cable standards"
    ]},
    { min: 50, max: 59, messages: [
      "Explicit adult content",
      "HBO late-night territory",
      "Mature audiences only"
    ]},
    { min: 60, max: 69, messages: [
      "Very explicit content",
      "NC-17 territory",
      "Adult entertainment standards"
    ]},
    { min: 70, max: 79, messages: [
      "Highly explicit material",
      "Softcore territory",
      "European cinema standards"
    ]},
    { min: 80, max: 89, messages: [
      "Extremely explicit content",
      "Adult industry adjacent",
      "Maximum mature themes"
    ]},
    { min: 90, max: 100, messages: [
      "Hardcore adult content",
      "No restrictions on explicitness",
      "Absolute maximum intensity"
    ]}
  ],

  sensuality: [
    { min: 0, max: 9, messages: [
      "Completely chaste content",
      "No physical descriptions",
      "Focus on personality only"
    ]},
    { min: 10, max: 19, messages: [
      "Characters are attractive",
      "Beauty is noted but not dwelt upon",
      "Tasteful appreciation"
    ]},
    { min: 20, max: 29, messages: [
      "Admiring glances at appearance",
      "Physical attraction acknowledged",
      "Romantic comedy level"
    ]},
    { min: 30, max: 39, messages: [
      "Physical descriptions become detailed",
      "Sensual tension building",
      "Beach read territory"
    ]},
    { min: 40, max: 49, messages: [
      "Bodies are described appreciatively",
      "Touch and closeness emphasized",
      "Steamy but tasteful"
    ]},
    { min: 50, max: 59, messages: [
      "Explicit physical descriptions",
      "Sensory details emphasized",
      "Romance novel standard"
    ]},
    { min: 60, max: 69, messages: [
      "Highly sensual content",
      "Every curve and contour",
      "Erotic tension throughout"
    ]},
    { min: 70, max: 79, messages: [
      "Very explicit physical content",
      "Nothing subtle about desire",
      "Maximum sensory detail"
    ]},
    { min: 80, max: 89, messages: [
      "Extremely sensual focus",
      "Bodies as primary subject",
      "Erotica-level detail"
    ]},
    { min: 90, max: 100, messages: [
      "Pure sensual indulgence",
      "Maximum physical description",
      "No limits on sensuality"
    ]}
  ],

  explicitness: [
    { min: 0, max: 9, messages: [
      "Implied only, nothing shown",
      "Camera always cuts away",
      "Pure imagination territory"
    ]},
    { min: 10, max: 19, messages: [
      "Suggestion and subtext",
      "Tasteful fade to black",
      "Classic Hollywood standards"
    ]},
    { min: 20, max: 29, messages: [
      "Some details emerge",
      "Morning after hints",
      "Network TV pushing limits"
    ]},
    { min: 30, max: 39, messages: [
      "Moderate detail provided",
      "Cable drama standards",
      "Outlander-level scenes"
    ]},
    { min: 40, max: 49, messages: [
      "Explicit but artful",
      "European cinema style",
      "Art house standards"
    ]},
    { min: 50, max: 59, messages: [
      "Detailed explicit content",
      "Nothing left implied",
      "Adult fiction standards"
    ]},
    { min: 60, max: 69, messages: [
      "Very explicit descriptions",
      "Clinical detail possible",
      "Erotica territory"
    ]},
    { min: 70, max: 79, messages: [
      "Highly graphic content",
      "Every detail described",
      "Maximum literary detail"
    ]},
    { min: 80, max: 89, messages: [
      "Extremely graphic scenes",
      "Nothing withheld",
      "Pornographic adjacent"
    ]},
    { min: 90, max: 100, messages: [
      "Maximum graphic detail",
      "Pure explicit content",
      "No limits whatsoever"
    ]}
  ],

  sexualViolence: [
    { min: 0, max: 9, messages: [
      "This topic won't appear",
      "Completely absent from story",
      "Safe space guaranteed"
    ]},
    { min: 10, max: 19, messages: [
      "May be referenced in backstory only",
      "Never depicted, only implied past",
      "Survivor narrative possible"
    ]},
    { min: 20, max: 29, messages: [
      "Non-graphic depictions of groping, or mentions of rape",
      "Threat exists but isn't shown",
      "Law & Order SVU style handling"
    ]},
    { min: 30, max: 39, messages: [
      "Attempted assault may occur",
      "Interrupted or prevented on-page",
      "Tension without completion"
    ]},
    { min: 40, max: 49, messages: [
      "Assault may occur off-page",
      "Aftermath is explored",
      "I Spit on Your Grave buildup"
    ]},
    { min: 50, max: 59, messages: [
      "On-page assault possible",
      "Not gratuitous but present",
      "The Accused level handling"
    ]},
    { min: 60, max: 69, messages: [
      "Detailed assault scenes",
      "Victim perspective possible",
      "Exploitation film territory"
    ]},
    { min: 70, max: 79, messages: [
      "Graphic assault content",
      "Multiple instances possible",
      "Extreme exploitation cinema"
    ]},
    { min: 80, max: 89, messages: [
      "A Serbian Film territory",
      "Extremely graphic content",
      "Torture and assault combined"
    ]},
    { min: 90, max: 100, messages: [
      "Japanese Hentai levels",
      "Maximum graphic assault",
      "No limits on this content"
    ]}
  ],

  scary: [
    { min: 0, max: 9, messages: [
      "Cozy and comforting only",
      "No scares whatsoever",
      "Warm blanket energy"
    ]},
    { min: 10, max: 19, messages: [
      "Mild tension sometimes",
      "Scooby-Doo level spooky",
      "Kid-friendly thrills"
    ]},
    { min: 20, max: 29, messages: [
      "Suspenseful moments",
      "PG-13 horror movie",
      "Goosebumps territory"
    ]},
    { min: 30, max: 39, messages: [
      "Genuine creepy moments",
      "Things go bump in the night",
      "Stranger Things vibes"
    ]},
    { min: 40, max: 49, messages: [
      "Scary scenes that linger",
      "Nightmare fuel possible",
      "The Conjuring level"
    ]},
    { min: 50, max: 59, messages: [
      "Genuinely frightening content",
      "Horror movie standard",
      "Jump scare worthy"
    ]},
    { min: 60, max: 69, messages: [
      "Intense psychological horror",
      "Hereditary-level dread",
      "Disturbing imagery"
    ]},
    { min: 70, max: 79, messages: [
      "Deeply unsettling content",
      "Sleep with lights on",
      "The Exorcist territory"
    ]},
    { min: 80, max: 89, messages: [
      "Extreme horror content",
      "Lovecraftian cosmic dread",
      "Existential terror"
    ]},
    { min: 90, max: 100, messages: [
      "Maximum psychological horror",
      "Trauma-inducing territory",
      "No limits on terror"
    ]}
  ],

  language: [
    { min: 0, max: 9, messages: [
      "Clean as a whistle",
      "G-rated vocabulary",
      "Sunday school approved"
    ]},
    { min: 10, max: 19, messages: [
      "Mild expressions allowed",
      "Darn and heck territory",
      "Family sitcom language"
    ]},
    { min: 20, max: 29, messages: [
      "Occasional mild swearing",
      "PG-rated profanity",
      "Damn and hell appear"
    ]},
    { min: 30, max: 39, messages: [
      "Moderate profanity",
      "Cable TV standards",
      "Sh*t happens occasionally"
    ]},
    { min: 40, max: 49, messages: [
      "Regular strong language",
      "R-rated movie vocabulary",
      "F-bombs are deployed"
    ]},
    { min: 50, max: 59, messages: [
      "Frequent strong language",
      "Tarantino dialogue levels",
      "Every sentence seasoned"
    ]},
    { min: 60, max: 69, messages: [
      "Very colorful vocabulary",
      "Sailor on shore leave",
      "Creative combinations"
    ]},
    { min: 70, max: 79, messages: [
      "Extremely profane content",
      "Wolf of Wall Street levels",
      "Record-breaking f-bombs"
    ]},
    { min: 80, max: 89, messages: [
      "Maximum vulgarity",
      "Nothing is off-limits",
      "Offensive by design"
    ]},
    { min: 90, max: 100, messages: [
      "Pure linguistic assault",
      "Slurs and epithets included",
      "Maximum offensive content"
    ]}
  ],

  // ==================== GENRE SLIDERS ====================
  // Amusing descriptions for genre mix sliders

  fantasy: [
    { min: 0, max: 9, messages: [
      "No magic here, just regular folks",
      "Grounded in boring old reality",
      "Physics still works, sorry"
    ]},
    { min: 10, max: 29, messages: [
      "A sprinkle of magic dust",
      "Maybe a talking animal or two",
      "Slight whiff of enchantment"
    ]},
    { min: 30, max: 49, messages: [
      "Wizards and witches doing their thing",
      "Magic is real and it's spectacular",
      "Pointy hats and spell books included"
    ]},
    { min: 50, max: 69, messages: [
      "Full-on magical shenanigans",
      "Dragons? Elves? Why not both!",
      "Your D&D group would approve"
    ]},
    { min: 70, max: 89, messages: [
      "Epic fantasy world-building engaged",
      "Chosen ones and ancient prophecies",
      "Tolkien's ghost nods approvingly"
    ]},
    { min: 90, max: 100, messages: [
      "MAXIMUM FANTASY OVERDRIVE",
      "Magic systems within magic systems",
      "Brandon Sanderson taking notes"
    ]}
  ],

  adventure: [
    { min: 0, max: 9, messages: [
      "Staying home sounds nice actually",
      "The couch is calling",
      "Adventures are for other people"
    ]},
    { min: 10, max: 29, messages: [
      "A pleasant stroll with mild peril",
      "Maybe leave the village once or twice",
      "Low-key quest vibes"
    ]},
    { min: 30, max: 49, messages: [
      "Quests and treasure hunting ahoy",
      "Maps with X marks the spot",
      "Montage-worthy journey ahead"
    ]},
    { min: 50, max: 69, messages: [
      "Swashbuckling excitement guaranteed",
      "Indiana Jones energy activated",
      "Danger around every corner"
    ]},
    { min: 70, max: 89, messages: [
      "Epic globe-trotting expeditions",
      "Ancient ruins and deadly traps",
      "Fortune and glory, kid"
    ]},
    { min: 90, max: 100, messages: [
      "Non-stop action adventure chaos",
      "Every chapter a cliffhanger",
      "Hold onto your butts"
    ]}
  ],

  mystery: [
    { min: 0, max: 9, messages: [
      "No mysteries here, move along",
      "Everything is exactly as it seems",
      "The butler definitely didn't do it"
    ]},
    { min: 10, max: 29, messages: [
      "Something's a bit... off",
      "Mild intrigue and raised eyebrows",
      "Cozy mystery vibes"
    ]},
    { min: 30, max: 49, messages: [
      "Clues scattered like breadcrumbs",
      "Who dunnit? You'll have to find out",
      "Detective hats recommended"
    ]},
    { min: 50, max: 69, messages: [
      "Red herrings and plot twists galore",
      "Trust no one, suspect everyone",
      "Agatha Christie would be proud"
    ]},
    { min: 70, max: 89, messages: [
      "Mind-bending puzzles and reveals",
      "Nothing is what it seems",
      "Your brain will hurt (in a good way)"
    ]},
    { min: 90, max: 100, messages: [
      "Mystery wrapped in enigma wrapped in WTF",
      "David Lynch complexity achieved",
      "Prepare for your jaw to drop"
    ]}
  ],

  scifi: [
    { min: 0, max: 9, messages: [
      "Just regular old planet Earth",
      "No robots, no aliens, no fun",
      "Technology? What's that?"
    ]},
    { min: 10, max: 29, messages: [
      "Near-future tech vibes",
      "Slightly fancier phones maybe",
      "Sci-fi lite, easy on the science"
    ]},
    { min: 30, max: 49, messages: [
      "Robots, spaceships, and laser guns",
      "The future is now, old man",
      "Pew pew pew!"
    ]},
    { min: 50, max: 69, messages: [
      "Space exploration and alien encounters",
      "To boldly go where no one has gone",
      "Houston, we have a story"
    ]},
    { min: 70, max: 89, messages: [
      "Interstellar civilizations and tech",
      "Hard sci-fi with soft feelings",
      "Asimov and Clarke high-fiving"
    ]},
    { min: 90, max: 100, messages: [
      "Full sci-fi madness unleashed",
      "Dyson spheres and time paradoxes",
      "Your physics professor is crying"
    ]}
  ],

  fairytale: [
    { min: 0, max: 9, messages: [
      "No once upon a times here",
      "Just regular, un-enchanted life",
      "The forest is just trees, probably"
    ]},
    { min: 10, max: 29, messages: [
      "A hint of fairy dust in the air",
      "Might spot a helpful woodland creature",
      "Soft fairy tale vibes"
    ]},
    { min: 30, max: 49, messages: [
      "Once upon a time... it begins",
      "Castles, princes, and glass slippers",
      "Disney would like a word"
    ]},
    { min: 50, max: 69, messages: [
      "Full fairy tale magic activated",
      "Curses, transformations, true love's kiss",
      "Happily ever after guaranteed*"
    ]},
    { min: 70, max: 89, messages: [
      "Brothers Grimm intensity",
      "Dark forests and darker secrets",
      "The original, less sanitized versions"
    ]},
    { min: 90, max: 100, messages: [
      "Maximum fairy tale immersion",
      "Folk tales from the old country",
      "Prepare to be enchanted (literally)"
    ]}
  ],

  humor: [
    { min: 0, max: 9, messages: [
      "Serious business, no laughing",
      "Comedy? In this economy?",
      "Stone-faced narrative ahead"
    ]},
    { min: 10, max: 29, messages: [
      "Occasional chuckle material",
      "A light moment here and there",
      "Mild amusement possible"
    ]},
    { min: 30, max: 49, messages: [
      "Regular laugh breaks included",
      "Witty banter and funny situations",
      "Snort-worthy content ahead"
    ]},
    { min: 50, max: 69, messages: [
      "Comedy central vibes",
      "Joke density increasing",
      "Warning: may cause laughter"
    ]},
    { min: 70, max: 89, messages: [
      "Non-stop comedy goldmine",
      "Terry Pratchett energy activated",
      "Your sides may hurt"
    ]},
    { min: 90, max: 100, messages: [
      "MAXIMUM HILARITY ACHIEVED",
      "Douglas Adams would approve",
      "Comedy tornado incoming"
    ]}
  ],

  horror: [
    { min: 0, max: 9, messages: [
      "Sleep easy tonight",
      "Nothing scary here, pinky promise",
      "Certified nightmare-free"
    ]},
    { min: 10, max: 29, messages: [
      "Mildly spooky, mostly cozy",
      "Goosebumps, but friendly ones",
      "Casper-level scares"
    ]},
    { min: 30, max: 49, messages: [
      "Things that go bump in the night",
      "Legitimate creepy vibes",
      "Maybe leave a light on"
    ]},
    { min: 50, max: 69, messages: [
      "Full horror experience engaged",
      "Don't read this alone at night",
      "Stephen King approves"
    ]},
    { min: 70, max: 89, messages: [
      "Nightmare fuel premium grade",
      "Sleep is overrated anyway",
      "Lovecraft is smiling somewhere"
    ]},
    { min: 90, max: 100, messages: [
      "MAXIMUM TERROR ACHIEVED",
      "Why did you even click this high?",
      "Sweet dreams are made of screams"
    ]}
  ],

  romance: [
    { min: 0, max: 9, messages: [
      "Friends only, no sparks",
      "Romance-free zone established",
      "Strictly platonic vibes"
    ]},
    { min: 10, max: 29, messages: [
      "Butterflies and longing looks",
      "Slow burn potential detected",
      "Will they? Won't they?"
    ]},
    { min: 30, max: 49, messages: [
      "Love is definitely in the air",
      "Romantic subplot fully activated",
      "Hallmark movie energy"
    ]},
    { min: 50, max: 69, messages: [
      "Hearts racing, palms sweating",
      "Serious chemistry happening",
      "Swoon-worthy moments ahead"
    ]},
    { min: 70, max: 89, messages: [
      "Passion levels: volcanic",
      "Romance novel territory",
      "Fans self dramatically"
    ]},
    { min: 90, max: 100, messages: [
      "MAXIMUM ROMANCE OVERDRIVE",
      "Love conquers literally everything",
      "Nicholas Sparks taking notes"
    ]}
  ],

  // ==================== INTENSITY SLIDERS ====================

  bleakness: [
    { min: 0, max: 12, messages: [
      "Pure sunshine and rainbows",
      "Disney princess energy",
      "Guaranteed happy ending",
      "The power of friendship conquers all"
    ]},
    { min: 13, max: 24, messages: [
      "Marvel movie optimism",
      "Heroes always triumph",
      "Dark moments but hope wins",
      "The Avengers will save the day"
    ]},
    { min: 25, max: 37, messages: [
      "Harry Potter bittersweet",
      "Victory comes with sacrifice",
      "Some characters won't make it",
      "Growth through adversity"
    ]},
    { min: 38, max: 49, messages: [
      "Literary fiction realism",
      "Life has both joy and sorrow",
      "No guaranteed happy ending",
      "The Wire-level authenticity"
    ]},
    { min: 50, max: 62, messages: [
      "Game of Thrones darkness",
      "Anyone can die",
      "Pyrrhic victories common",
      "Power corrupts absolutely"
    ]},
    { min: 63, max: 74, messages: [
      "The Walking Dead bleakness",
      "Hope is a rare commodity",
      "Survival is the only goal",
      "Trust no one completely"
    ]},
    { min: 75, max: 87, messages: [
      "Blood Meridian territory",
      "Existential despair reigns",
      "Nihilistic themes throughout",
      "The darkness is the point"
    ]},
    { min: 88, max: 100, messages: [
      "The Road level hopelessness",
      "Cosmic nihilism achieved",
      "Existence is suffering",
      "Thomas Ligotti would approve"
    ]}
  ]
};

// Color gradients that shift based on intensity
// Each entry has a max value - use the first one where value <= max
export const SLIDER_COLORS = {
  violence: [
    { max: 9, gradient: 'from-green-400 to-green-500', label: 'Safe' },
    { max: 19, gradient: 'from-green-400 to-lime-400', label: 'Mild' },
    { max: 29, gradient: 'from-lime-400 to-yellow-400', label: 'Light' },
    { max: 39, gradient: 'from-yellow-400 to-yellow-500', label: 'Moderate' },
    { max: 49, gradient: 'from-yellow-500 to-amber-500', label: 'Notable' },
    { max: 59, gradient: 'from-amber-500 to-orange-500', label: 'Strong' },
    { max: 69, gradient: 'from-orange-500 to-orange-400', label: 'Intense' },
    { max: 79, gradient: 'from-orange-400 to-red-500', label: 'Brutal' },
    { max: 89, gradient: 'from-red-500 to-red-400', label: 'Extreme' },
    { max: 100, gradient: 'from-red-400 to-rose-500', label: 'Maximum' }
  ],

  gore: [
    { max: 9, gradient: 'from-green-400 to-green-500', label: 'Clean' },
    { max: 19, gradient: 'from-green-400 to-lime-400', label: 'Minimal' },
    { max: 29, gradient: 'from-lime-400 to-yellow-400', label: 'Light' },
    { max: 39, gradient: 'from-yellow-400 to-amber-400', label: 'Moderate' },
    { max: 49, gradient: 'from-amber-400 to-orange-400', label: 'Notable' },
    { max: 59, gradient: 'from-orange-400 to-orange-500', label: 'Detailed' },
    { max: 69, gradient: 'from-orange-500 to-red-500', label: 'Graphic' },
    { max: 79, gradient: 'from-red-500 to-red-400', label: 'Visceral' },
    { max: 89, gradient: 'from-red-400 to-rose-500', label: 'Extreme' },
    { max: 100, gradient: 'from-rose-500 to-pink-500', label: 'Maximum' }
  ],

  romance: [
    { max: 9, gradient: 'from-slate-500 to-slate-400', label: 'None' },
    { max: 19, gradient: 'from-pink-400 to-pink-300', label: 'Hint' },
    { max: 29, gradient: 'from-pink-500 to-pink-400', label: 'Sweet' },
    { max: 39, gradient: 'from-rose-400 to-pink-400', label: 'Romantic' },
    { max: 49, gradient: 'from-rose-500 to-rose-400', label: 'Passionate' },
    { max: 59, gradient: 'from-red-400 to-rose-400', label: 'Steamy' },
    { max: 69, gradient: 'from-red-500 to-rose-500', label: 'Heated' },
    { max: 79, gradient: 'from-red-400 to-pink-500', label: 'Explicit' },
    { max: 89, gradient: 'from-rose-500 to-red-400', label: 'Intense' },
    { max: 100, gradient: 'from-pink-500 to-rose-500', label: 'Maximum' }
  ],

  adultContent: [
    { max: 9, gradient: 'from-green-400 to-green-500', label: 'Family' },
    { max: 19, gradient: 'from-green-400 to-lime-400', label: 'Teen' },
    { max: 29, gradient: 'from-lime-400 to-yellow-400', label: 'PG-13' },
    { max: 39, gradient: 'from-yellow-400 to-amber-400', label: 'Mature' },
    { max: 49, gradient: 'from-amber-400 to-orange-400', label: 'R-Rated' },
    { max: 59, gradient: 'from-orange-400 to-orange-500', label: 'Adult' },
    { max: 69, gradient: 'from-orange-500 to-red-500', label: 'NC-17' },
    { max: 79, gradient: 'from-red-500 to-red-400', label: 'Explicit' },
    { max: 89, gradient: 'from-red-400 to-rose-500', label: 'Hardcore' },
    { max: 100, gradient: 'from-rose-500 to-pink-500', label: 'XXX' }
  ],

  sensuality: [
    { max: 9, gradient: 'from-slate-500 to-slate-400', label: 'Chaste' },
    { max: 19, gradient: 'from-pink-400 to-pink-300', label: 'Modest' },
    { max: 29, gradient: 'from-pink-500 to-pink-400', label: 'Tasteful' },
    { max: 39, gradient: 'from-rose-400 to-pink-400', label: 'Sensual' },
    { max: 49, gradient: 'from-rose-500 to-rose-400', label: 'Steamy' },
    { max: 59, gradient: 'from-red-400 to-rose-400', label: 'Explicit' },
    { max: 69, gradient: 'from-red-500 to-rose-500', label: 'Erotic' },
    { max: 79, gradient: 'from-red-400 to-pink-500', label: 'Very Erotic' },
    { max: 89, gradient: 'from-rose-500 to-red-400', label: 'Intense' },
    { max: 100, gradient: 'from-pink-500 to-rose-500', label: 'Maximum' }
  ],

  explicitness: [
    { max: 9, gradient: 'from-slate-500 to-slate-400', label: 'Implied' },
    { max: 19, gradient: 'from-purple-400 to-purple-300', label: 'Subtle' },
    { max: 29, gradient: 'from-violet-400 to-purple-400', label: 'Suggested' },
    { max: 39, gradient: 'from-fuchsia-400 to-violet-400', label: 'Moderate' },
    { max: 49, gradient: 'from-pink-400 to-fuchsia-400', label: 'Detailed' },
    { max: 59, gradient: 'from-rose-400 to-pink-400', label: 'Explicit' },
    { max: 69, gradient: 'from-red-400 to-rose-400', label: 'Graphic' },
    { max: 79, gradient: 'from-red-500 to-red-400', label: 'Very Graphic' },
    { max: 89, gradient: 'from-rose-500 to-red-400', label: 'Extreme' },
    { max: 100, gradient: 'from-pink-500 to-rose-500', label: 'Maximum' }
  ],

  sexualViolence: [
    { max: 9, gradient: 'from-green-400 to-green-500', label: 'None' },
    { max: 19, gradient: 'from-yellow-400 to-green-400', label: 'Referenced' },
    { max: 29, gradient: 'from-amber-400 to-yellow-400', label: 'Implied' },
    { max: 39, gradient: 'from-orange-400 to-amber-400', label: 'Attempted' },
    { max: 49, gradient: 'from-orange-500 to-orange-400', label: 'Off-page' },
    { max: 59, gradient: 'from-red-400 to-orange-400', label: 'On-page' },
    { max: 69, gradient: 'from-red-500 to-red-400', label: 'Detailed' },
    { max: 79, gradient: 'from-red-400 to-rose-500', label: 'Graphic' },
    { max: 89, gradient: 'from-rose-500 to-red-400', label: 'Extreme' },
    { max: 100, gradient: 'from-red-400 to-pink-500', label: 'Maximum' }
  ],

  scary: [
    { max: 9, gradient: 'from-green-400 to-green-500', label: 'Cozy' },
    { max: 19, gradient: 'from-green-400 to-cyan-400', label: 'Mild' },
    { max: 29, gradient: 'from-cyan-400 to-blue-400', label: 'Tense' },
    { max: 39, gradient: 'from-blue-400 to-indigo-400', label: 'Creepy' },
    { max: 49, gradient: 'from-indigo-400 to-purple-400', label: 'Scary' },
    { max: 59, gradient: 'from-purple-400 to-violet-500', label: 'Frightening' },
    { max: 69, gradient: 'from-violet-500 to-fuchsia-500', label: 'Terrifying' },
    { max: 79, gradient: 'from-fuchsia-500 to-pink-500', label: 'Horrifying' },
    { max: 89, gradient: 'from-pink-500 to-red-500', label: 'Nightmarish' },
    { max: 100, gradient: 'from-red-500 to-rose-500', label: 'Traumatic' }
  ],

  language: [
    { max: 9, gradient: 'from-green-400 to-green-500', label: 'Clean' },
    { max: 19, gradient: 'from-green-400 to-lime-400', label: 'Mild' },
    { max: 29, gradient: 'from-lime-400 to-yellow-400', label: 'Some' },
    { max: 39, gradient: 'from-yellow-400 to-amber-400', label: 'Moderate' },
    { max: 49, gradient: 'from-amber-400 to-orange-400', label: 'Strong' },
    { max: 59, gradient: 'from-orange-400 to-orange-500', label: 'Frequent' },
    { max: 69, gradient: 'from-orange-500 to-red-400', label: 'Heavy' },
    { max: 79, gradient: 'from-red-400 to-red-500', label: 'Extreme' },
    { max: 89, gradient: 'from-red-500 to-rose-500', label: 'Maximum' },
    { max: 100, gradient: 'from-rose-500 to-pink-500', label: 'Unrestricted' }
  ],

  bleakness: [
    { max: 12, gradient: 'from-yellow-300 to-yellow-400', label: 'Sunshine' },
    { max: 24, gradient: 'from-amber-400 to-yellow-400', label: 'Hopeful' },
    { max: 37, gradient: 'from-orange-400 to-amber-400', label: 'Bittersweet' },
    { max: 49, gradient: 'from-orange-500 to-orange-400', label: 'Realistic' },
    { max: 62, gradient: 'from-slate-400 to-orange-500', label: 'Dark' },
    { max: 74, gradient: 'from-slate-500 to-slate-400', label: 'Grim' },
    { max: 87, gradient: 'from-purple-500 to-slate-500', label: 'Grimdark' },
    { max: 100, gradient: 'from-violet-500 to-purple-500', label: 'Nihilistic' }
  ],

  // Genre sliders - vivid thematic colors for good contrast on dark backgrounds
  fantasy: [
    { max: 9, gradient: 'from-slate-500 to-slate-400', label: 'None' },
    { max: 29, gradient: 'from-violet-500 to-violet-400', label: 'Touch' },
    { max: 49, gradient: 'from-purple-500 to-violet-400', label: 'Present' },
    { max: 69, gradient: 'from-purple-400 to-fuchsia-400', label: 'Strong' },
    { max: 89, gradient: 'from-fuchsia-400 to-pink-400', label: 'Dominant' },
    { max: 100, gradient: 'from-fuchsia-500 to-purple-400', label: 'Pure' }
  ],

  adventure: [
    { max: 9, gradient: 'from-slate-500 to-slate-400', label: 'None' },
    { max: 29, gradient: 'from-emerald-500 to-emerald-400', label: 'Touch' },
    { max: 49, gradient: 'from-teal-500 to-emerald-400', label: 'Present' },
    { max: 69, gradient: 'from-cyan-500 to-teal-400', label: 'Strong' },
    { max: 89, gradient: 'from-cyan-400 to-emerald-400', label: 'Dominant' },
    { max: 100, gradient: 'from-emerald-400 to-green-400', label: 'Pure' }
  ],

  mystery: [
    { max: 9, gradient: 'from-slate-500 to-slate-400', label: 'None' },
    { max: 29, gradient: 'from-indigo-500 to-indigo-400', label: 'Touch' },
    { max: 49, gradient: 'from-violet-500 to-indigo-400', label: 'Present' },
    { max: 69, gradient: 'from-purple-500 to-violet-400', label: 'Strong' },
    { max: 89, gradient: 'from-purple-400 to-indigo-400', label: 'Dominant' },
    { max: 100, gradient: 'from-indigo-400 to-blue-400', label: 'Pure' }
  ],

  scifi: [
    { max: 9, gradient: 'from-slate-500 to-slate-400', label: 'None' },
    { max: 29, gradient: 'from-cyan-500 to-cyan-400', label: 'Touch' },
    { max: 49, gradient: 'from-sky-500 to-cyan-400', label: 'Present' },
    { max: 69, gradient: 'from-blue-500 to-sky-400', label: 'Strong' },
    { max: 89, gradient: 'from-blue-400 to-cyan-400', label: 'Dominant' },
    { max: 100, gradient: 'from-cyan-400 to-teal-400', label: 'Pure' }
  ],

  fairytale: [
    { max: 9, gradient: 'from-slate-500 to-slate-400', label: 'None' },
    { max: 29, gradient: 'from-pink-400 to-pink-300', label: 'Touch' },
    { max: 49, gradient: 'from-rose-400 to-pink-300', label: 'Present' },
    { max: 69, gradient: 'from-fuchsia-400 to-pink-400', label: 'Strong' },
    { max: 89, gradient: 'from-fuchsia-400 to-rose-400', label: 'Dominant' },
    { max: 100, gradient: 'from-pink-400 to-fuchsia-400', label: 'Pure' }
  ],

  humor: [
    { max: 9, gradient: 'from-slate-500 to-slate-400', label: 'None' },
    { max: 29, gradient: 'from-yellow-400 to-yellow-300', label: 'Touch' },
    { max: 49, gradient: 'from-amber-400 to-yellow-300', label: 'Present' },
    { max: 69, gradient: 'from-orange-400 to-amber-400', label: 'Strong' },
    { max: 89, gradient: 'from-orange-400 to-yellow-400', label: 'Dominant' },
    { max: 100, gradient: 'from-amber-400 to-orange-400', label: 'Pure' }
  ],

  horror: [
    { max: 9, gradient: 'from-slate-500 to-slate-400', label: 'None' },
    { max: 29, gradient: 'from-slate-500 to-purple-500', label: 'Touch' },
    { max: 49, gradient: 'from-purple-500 to-violet-500', label: 'Present' },
    { max: 69, gradient: 'from-violet-500 to-red-500', label: 'Strong' },
    { max: 89, gradient: 'from-red-500 to-rose-500', label: 'Dominant' },
    { max: 100, gradient: 'from-red-500 to-red-400', label: 'Pure' }
  ],

  romance: [
    { max: 9, gradient: 'from-slate-500 to-slate-400', label: 'None' },
    { max: 29, gradient: 'from-pink-500 to-pink-400', label: 'Touch' },
    { max: 49, gradient: 'from-rose-500 to-pink-400', label: 'Present' },
    { max: 69, gradient: 'from-red-500 to-rose-400', label: 'Strong' },
    { max: 89, gradient: 'from-red-400 to-pink-400', label: 'Dominant' },
    { max: 100, gradient: 'from-rose-400 to-red-400', label: 'Pure' }
  ]
};

/**
 * Get the appropriate color gradient for a slider value
 * @param {string} sliderType - The slider type (violence, gore, etc.)
 * @param {number} value - The current slider value (0-100)
 * @returns {object} { gradient, label }
 */
export function getSliderColor(sliderType, value) {
  const colors = SLIDER_COLORS[sliderType];
  if (!colors) return { gradient: 'from-slate-500 to-golden-400', label: '' };

  // Safeguard: ensure value is a valid number (fix for undefined displayValue bug)
  const safeValue = typeof value === 'number' && !isNaN(value) ? value : 0;

  for (const tier of colors) {
    if (safeValue <= tier.max) {
      return tier;
    }
  }
  return colors[colors.length - 1]; // Fallback to max tier
}

/**
 * Get a contextual message for a slider value
 * Returns a random message from the appropriate tier
 * @param {string} sliderType - The slider type (violence, gore, etc.)
 * @param {number} value - The current slider value (0-100)
 * @param {number} seed - Optional seed for consistent random selection
 * @returns {string} The message
 */
export function getSliderMessage(sliderType, value, seed = null) {
  const messages = SLIDER_MESSAGES[sliderType];
  if (!messages) return '';

  // Safeguard: ensure value is a valid number (fix for undefined displayValue bug)
  const safeValue = typeof value === 'number' && !isNaN(value) ? value : 0;

  for (const tier of messages) {
    if (safeValue >= tier.min && safeValue <= tier.max) {
      // Use seed for consistent random if provided, otherwise random
      const index = seed !== null
        ? Math.abs(seed) % tier.messages.length
        : Math.floor(Math.random() * tier.messages.length);
      return tier.messages[index];
    }
  }
  return '';
}

/**
 * Get the current tier label for a slider value
 * @param {string} sliderType - The slider type
 * @param {number} value - The current slider value
 * @returns {string} The tier label
 */
export function getSliderTierLabel(sliderType, value) {
  const color = getSliderColor(sliderType, value);
  return color.label || '';
}
