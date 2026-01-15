/**
 * Comprehensive Author Styles Database
 * Based on user research into classical and modern literary voices
 * Each author includes: genres, style guide, and story generation algorithm
 */

export const AUTHOR_STYLES = {
  shakespeare: {
    name: 'William Shakespeare',
    genres: ['Tragedy', 'Comedy', 'Historical Drama'],
    description: 'Poetic dialogue, dramatic irony, tragic heroes',
    style: {
      pov: 'Dialogue-driven, minimal narration',
      pacing: 'Alternating high-action and introspective soliloquies',
      themes: ['Love', 'Ambition', 'Betrayal', 'Fate'],
      language: 'Poetic iambic pentameter, rich metaphors, wit and wordplay',
      tone: 'Varies from comic and bawdy to somber and tragic'
    },
    promptTemplate: `Write in Shakespearean style.
- Use elevated, poetic dialogue with occasional rhyming couplets
- Include soliloquies where characters voice inner conflicts
- Develop dramatic irony where audience knows more than characters
- Mix tragedy with dark comedy and wit
- End with rhyming couplet or brief moral reflection
- Use "thee", "thou", "doth" sparingly for flavor, but keep comprehensible`,
    algorithm: `Start with chorus/prologue to set scene. Introduce characters across social strata with distinct voices.
Use verse for high emotion, prose for comedy. Develop intertwining plots and misunderstandings.
Include soliloquy every few scenes for inner conflict. Build to climactic revelation, duel, or tragic death.
End with restoration of order and moral lesson.`
  },

  austen: {
    name: 'Jane Austen',
    genres: ['Novel of Manners', 'Romance'],
    description: 'Witty social commentary, free indirect discourse, marriage plots',
    style: {
      pov: 'Third-person omniscient with close focus on heroine\'s thoughts',
      pacing: 'Measured - dramatic events punctuate social interactions',
      themes: ['Marriage', 'Social class', 'Reputation', 'Moral character'],
      language: 'Elegant, witty, ironic, polite conversational tone',
      tone: 'Lightly satirical, self-aware, empathetic'
    },
    promptTemplate: `Write in Jane Austen's style.
- Use free indirect discourse to blend narrator with character perspective
- Create witty, sparkling dialogue with subtext
- Gently satirize social norms while remaining empathetic
- Focus on manners, courtship, and small dramas of country life
- Reveal character through dialogue and social observation
- Build to earned happiness through growth and understanding`,
    algorithm: `Introduce young female protagonist in provincial setting with family.
Establish class and marriage pressures. Use drawing-room conversations to introduce love interest and rivals.
Develop misunderstandings from pride, prejudice, or meddling. Reveal heroine's changing feelings through free indirect style.
Include pivotal letter or revelation mid-story. Resolve misunderstandings gradually.
End with poetic justice - virtuous find love, foolish are satirized.`
  },

  dickens: {
    name: 'Charles Dickens',
    genres: ['Literary Fiction', 'Social Realism', 'Historical Fiction'],
    description: 'Rich descriptions, memorable characters, social commentary',
    style: {
      pov: 'Third-person omniscient, often addresses reader directly',
      pacing: 'Chapters end on cliffhangers, balances detailed world-building with melodrama',
      themes: ['Social injustice', 'Poverty vs wealth', 'Redemption through kindness'],
      language: 'Energetic, elaborate prose with long descriptive sentences',
      tone: 'Humorous, satirical, dramatic, sentimental by turns'
    },
    promptTemplate: `Write in Dickensian style.
- Create vivid, atmospheric descriptions of settings (foggy streets, cluttered offices)
- Develop memorable characters with distinctive mannerisms or catchphrases
- Use character names that suggest personality (Scrooge, Pip, Miss Havisham)
- Balance comedy with pathos, satire with sentiment
- Include social commentary on institutions and class
- Build coincidental connections between characters`,
    algorithm: `Open with striking atmospheric scene setting social context.
Introduce vulnerable protagonist (orphan, poor student) facing hardship.
Create broad cast - some benevolent, many grotesque or villainous.
Alternate plotlines across social spheres with dramatic incidents and cliffhangers.
Gradually unveil hidden relationships and coincidences tying fates together.
Build to climactic confrontations exposing crimes and revealing identities.
Reward virtue with marriages and reconciliation, punish/reform villains.
End with narrator's moral reflection.`
  },

  dostoevsky: {
    name: 'Fyodor Dostoevsky',
    genres: ['Psychological Fiction', 'Philosophical Novel'],
    description: 'Intense psychological exploration, moral debates, existential themes',
    style: {
      pov: 'Third person with intrusive narrator, or intense first person',
      pacing: 'Extended philosophical conversations punctuated by sudden action',
      themes: ['Guilt and redemption', 'Faith vs doubt', 'Free will', 'Psychology of crime'],
      language: 'Passionate, feverish prose with abrupt shifts',
      tone: 'Serious, dark humor, claustrophobic psychological pressure'
    },
    promptTemplate: `Write in Dostoevsky's style.
- Delve deeply into characters' inner torment through long internal monologues
- Stage philosophical debates between characters representing opposing viewpoints
- Create claustrophobic settings that amplify psychological pressure
- Explore moral ambiguity and the duality of human nature
- Use vivid dreams, hallucinations, or confessions to reveal psyche
- Build toward cathartic confrontation and possibility of redemption`,
    algorithm: `Present protagonist in state of internal crisis or moral ambiguity.
Introduce eccentric characters representing conflicting moral viewpoints.
Trigger downward spiral through crime or grave mistake.
Use dialogue-heavy chapters for philosophical debates and confessions.
Escalate internal conflict with hallucinations, dreams, soulful monologues.
Build to cathartic confrontation - judgment or profound moral choice.
Conclude with spiritual or moral rebirth, suggesting hope through suffering.`
  },

  tolkien: {
    name: 'J.R.R. Tolkien',
    genres: ['High Fantasy', 'Mythopoeia'],
    description: 'Epic world-building, formal prose, mythic sweep',
    style: {
      pov: 'Third-person omniscient with archaic, elevated tone',
      pacing: 'Unhurried world-building with vivid action sequences',
      themes: ['Good vs evil', 'Corrupting power', 'Fellowship', 'Nature preservation'],
      language: 'Lyrical, descriptive, varies from hobbit-like to heroic',
      tone: 'Earnest, optimistic about good\'s triumph, elegiac for lost eras'
    },
    promptTemplate: `Write in Tolkien's style.
- Establish deep history and mythic context
- Create vivid landscapes with almost naturalist detail
- Use formal, elevated prose for epic moments, humble for hobbits
- Include songs, poems, or historical asides that deepen lore
- Develop diverse fellowship of races with distinct voices
- Balance quiet reflective moments with sudden peril
- Acknowledge sacrifice and loss even in victory`,
    algorithm: `Begin with sense of ancient history and mythic context.
Introduce diverse fellowship on quest of great significance.
Structure journey episodically through distinct regions with unique challenges.
Insert poems, lore, and language relevant to each culture encountered.
Alternate between quiet reflective moments and sudden peril.
Use omniscient narration to foreshadow and show larger scope.
Converge multiple battles of good vs evil at climax.
Resolve with bittersweet ending - victory at great cost, end of an age.`
  },

  tolstoy: {
    name: 'Leo Tolstoy',
    genres: ['Realist Novel', 'Historical Fiction'],
    description: 'Panoramic scope, psychological depth, moral philosophy',
    style: {
      pov: 'Omniscient, entering thoughts of many characters',
      pacing: 'Expansive - quotidian sequences balanced with intense drama',
      themes: ['Search for meaning', 'Family', 'War\'s reality', 'Spiritual redemption'],
      language: 'Clear, precise prose describing complex emotions simply',
      tone: 'Empathetic, moralistic but not judgmental'
    },
    promptTemplate: `Write in Tolstoy's style.
- Use simple, precise language to describe complex emotional states
- Enter multiple characters' perspectives with equal empathy
- Balance intimate family scenes with grand historical events
- Include philosophical reflections on life, death, and meaning
- Contrast aristocratic pretenses with authentic simple life
- Show characters finding peace through family, faith, or simplicity`,
    algorithm: `Begin in social setting revealing major players and relationships.
Present multiple storylines set against broader historical backdrop.
Develop characters through internal monologue and free indirect discourse.
Alternate between intimate personal scenes and grand public events.
Include detailed sensory descriptions grounding in physical reality.
Build to major turning point testing characters' values.
Use crisis to spur spiritual reflection on life's meaning.
Resolve with characters finding inner peace or facing consequences.
End with sense of life's continuity.`
  },

  hemingway: {
    name: 'Ernest Hemingway',
    genres: ['Literary Fiction', 'Modernist Novel'],
    description: 'Iceberg theory - minimal prose with deep subtext',
    style: {
      pov: 'First-person or third-person limited, restrained',
      pacing: 'Scenes unfold in real time with minimal exposition',
      themes: ['Courage and stoicism', 'Love and loss', 'War\'s futility', 'Nature testing man'],
      language: 'Short sentences, common words, minimal adjectives',
      tone: 'Detached, understated, melancholic beneath spare words'
    },
    promptTemplate: `Write in Hemingway's style.
- Use short, declarative sentences with simple words
- Show emotion through action and dialogue, never name feelings directly
- Create tension through what is left unsaid
- Describe physical sensations precisely
- Use dialogue to reveal character without exposition
- Trust reader to infer deeper meaning from surface details
- End shortly after climax without explaining resolution`,
    algorithm: `Open with concrete sensory details, no preamble.
Place characters in setting, let dialogue and action carry exposition.
Drop subtle clues about backstory without explaining.
Move plot moment-to-moment in linear fashion.
Describe impactful events in plain, reportorial manner.
Use understatement - characters say "fine" when clearly in pain.
Build to implicit climax through small gesture or single revealing line.
End shortly after, leaving the unsaid to resonate.`
  },

  orwell: {
    name: 'George Orwell',
    genres: ['Political Fiction', 'Dystopian Fiction', 'Satire'],
    description: 'Crystal-clear prose, political themes, dark irony',
    style: {
      pov: 'Third person, straightforward like journalism',
      pacing: 'Efficient - quick world-building, cause-and-effect plotting',
      themes: ['Abuse of power', 'Propaganda and truth', 'Common man under oppression'],
      language: 'Direct, unadorned, clear as windowpane',
      tone: 'Serious, pessimistic, dry irony'
    },
    promptTemplate: `Write in Orwell's style.
- Use clear, direct prose without ornament
- State disturbing ideas in matter-of-fact language
- Show how propaganda distorts reality and language
- Create tension between individual conscience and oppressive system
- Include dark irony and satirical observation
- Make horror visceral through plainness of description`,
    algorithm: `Begin with strong, unsettling premise stated plainly.
Establish protagonist in repressive environment through concrete details.
Show how the system works through everyday observations.
Introduce conflict as character confronts the Party/system.
Proceed in linear cause-and-effect manner like logical argument.
Demonstrate propaganda and logical contradictions in action.
Build to moral or intellectual capitulation under pressure.
End on sober, ironic note reinforcing the message.`
  },

  steinbeck: {
    name: 'John Steinbeck',
    genres: ['Social Realism', 'American Epic'],
    description: 'Earthy compassion for common people, poetic naturalism',
    style: {
      pov: 'Third-person omniscient with intimate focus on characters',
      pacing: 'Balanced descriptive passages with sharp dialogue and action',
      themes: ['Community and brotherhood', 'Connection to land', 'Social injustice', 'Enduring hope'],
      language: 'Clear, colloquial, reflects working-class speech',
      tone: 'Sympathetic, socially conscious, anger tempered by love'
    },
    promptTemplate: `Write in Steinbeck's style.
- Open with vivid description of environment as character itself
- Use realistic dialect in dialogue
- Show small acts of kindness and solidarity as emotional peaks
- Create characters who are common folk with inherent dignity
- Balance hardship with moments of grace and hope
- Include simple but resonant symbolism`,
    algorithm: `Begin with vivid environmental description setting stage.
Introduce protagonist in everyday labor or struggle.
Use realistic dialogue to reveal character dynamics.
Progress chronologically through journey or toil.
Enhance milestones with contextual interludes.
Emphasize small acts of kindness along the way.
Build to crisis testing unity or values.
End with symbolic, poignant image encapsulating theme.`
  },

  twain: {
    name: 'Mark Twain',
    genres: ['Adventure Fiction', 'Satire', 'Social Commentary'],
    description: 'Vernacular voice, wit, American regionalism',
    style: {
      pov: 'First-person with distinctive colloquial voice',
      pacing: 'Episodic adventures, anecdotes within narrative',
      themes: ['Coming-of-age', 'Conscience vs society', 'Hypocrisy exposed', 'Freedom'],
      language: 'Colloquial American English, dialect, slang',
      tone: 'Comic to sharply satirical, naive narrator delivering social critique'
    },
    promptTemplate: `Write in Mark Twain's style.
- Use colloquial first-person voice with regional dialect
- Let naive narrator observations deliver sharp social satire
- Create episodic adventures with memorable set pieces
- Include humor from misunderstandings and absurd situations
- Satirize hypocrisy, prejudice, and pretension
- Balance comedy with genuine moral insight`,
    algorithm: `Start with narrator introducing themselves in distinctive voice.
Ground in specific locale with colorful regional details.
Launch into adventure or scheme early.
String together memorable episodes, each with humor and satire.
Use dialogue-rich scenes to carry comedy and theme.
Build to semi-serious conflict testing protagonist's growth.
Resolve external plot positively while hero asserts individual spirit.
End with protagonist rejecting society's constraints.`
  },

  dumas: {
    name: 'Alexandre Dumas',
    genres: ['Historical Adventure', 'Swashbuckler'],
    description: 'Dramatic action, loyal friendships, romantic adventure',
    style: {
      pov: 'Third-person omniscient, moving between characters',
      pacing: 'Very brisk - short chapters with cliffhangers',
      themes: ['Friendship and loyalty', 'Justice and revenge', 'Honor vs power'],
      language: 'Energetic, action verbs, snappy dialogue',
      tone: 'Enthusiastic, romantic, adventurous panache'
    },
    promptTemplate: `Write in Alexandre Dumas's style.
- Keep action moving with brisk, energetic prose
- Create charismatic heroes with distinctive personalities
- Include witty banter and memorable one-liners
- Build excitement through duels, escapes, and reversals of fortune
- Celebrate friendship, loyalty, and honor
- End chapters on cliffhangers or dramatic reveals`,
    algorithm: `Introduce charismatic hero in action showcasing character.
Thrust into conflict immediately - misunderstanding or accusation.
Establish villain or antagonistic force quickly.
Proceed at gallop through adventurous episodes.
Each episode resolves one mini-conflict but leads to next.
Use historical events as backdrop lending grander scale.
Cut between hero and villain's machinations for suspense.
Build to final confrontation tying up intrigue webs.
End swiftly after victory with affirmation of honor.`
  },

  poe: {
    name: 'Edgar Allan Poe',
    genres: ['Gothic Horror', 'Mystery', 'Macabre'],
    description: 'Atmospheric dread, unreliable narrators, single effect',
    style: {
      pov: 'First-person unreliable narrator, often paranoid',
      pacing: 'Controlled build of inevitable dread to climactic shock',
      themes: ['Guilty conscience', 'Death and the uncanny', 'Madness', 'Perverseness'],
      language: 'Gothic, ornate, rhythmic with archaic vocabulary',
      tone: 'Dark, eerie, claustrophobic, melancholic beauty'
    },
    promptTemplate: `Write in Edgar Allan Poe's style.
- Use first-person narrator who may be unreliable or obsessed
- Build atmosphere through meticulous sensory description
- Create rhythmic, almost poetic prose
- Focus on single obsessive symbol or idea
- Mirror narrator's anxiety in increasingly urgent prose
- Build to shocking revelation or confession
- Leave reader with lingering eerie image`,
    algorithm: `Set stage with atmospheric hook - narrator's proclamation or dark scene.
Establish single obsessive focus or symbol early.
Use lavish sensory details foreshadowing horror.
Mirror mounting anxiety in prose rhythm and punctuation.
Maintain tight focus with no subplots.
Push narrator to emotional breaking point.
Climax with revelation or eruption of horror.
End immediately with resonant final image or phrase.`
  },

  fitzgerald: {
    name: 'F. Scott Fitzgerald',
    genres: ['Literary Fiction', 'Jazz Age Novel'],
    description: 'Lyrical prose, American Dream critique, glamour and sorrow',
    style: {
      pov: 'First-person observer or close third person',
      pacing: 'Moderate, luxuriates in scene and mood',
      themes: ['American Dream corruption', 'Wealth\'s hollowness', 'Lost innocence', 'Love and longing'],
      language: 'Elegant, lyrical, vivid sensory metaphors',
      tone: 'Romantic yet ironic, yearning tinged with critique'
    },
    promptTemplate: `Write in F. Scott Fitzgerald's style.
- Use lush, poetic imagery especially of light, color, and motion
- Create outsider narrator observing the wealthy
- Build glamorous scenes that hint at underlying decay
- Develop characters with shiny facades hiding emptiness
- Include memorable symbolic images (green light, eyes, etc.)
- Balance romantic yearning with ironic distance`,
    algorithm: `Introduce protagonist as outsider looking in on glamour.
Set early scene epitomizing excitement of desired world.
Use lush imagery to imprint emotional tone.
Gradually peel back illusion showing superficiality.
Build to personal tragedy or shattering realization.
Weave recurring symbols gaining meaning throughout.
Climax emotionally rather than bombastically.
Conclude with reflective, bittersweet denouement.`
  },

  wilde: {
    name: 'Oscar Wilde',
    genres: ['Comedy of Manners', 'Drama', 'Gothic Novel'],
    description: 'Razor wit, paradoxical epigrams, aesthetic philosophy',
    style: {
      pov: 'Varies - dramatic dialogue or lush narrative',
      pacing: 'Brisk in comedies, measured in prose',
      themes: ['Double life and masks', 'Art and beauty', 'Triviality and seriousness', 'Individualism'],
      language: 'Highly polished, quotable paradoxes',
      tone: 'Light satirical to decadent gothic, always urbane'
    },
    promptTemplate: `Write in Oscar Wilde's style.
- Create brilliantly witty dialogue full of paradox and epigram
- Turn conventional wisdom on its head
- Satirize Victorian social norms with airy touch
- Build comedy on mistaken identity or secret identities
- In serious work, explore duplicity and moral decay
- End with epigrammatic flourish`,
    algorithm: `For comedy: Begin with bantering dialogue establishing playful tone.
Introduce comedic conflict built on mistaken/secret identities.
Give each character farcical trait or foible.
Subvert polite social rituals with brilliant inversions.
Complicate misunderstandings to peak of absurdity.
Resolve with identities exposed and happy reconciliation.
End with final volley of wit.

For gothic: Begin with alluring scenario and philosophical foil.
Use extended witty conversations to duel ideas.
Build to confrontation with grotesque truth.
End with poetic justice and irony.`
  },

  vonnegut: {
    name: 'Kurt Vonnegut',
    genres: ['Satire', 'Science Fiction', 'Black Comedy'],
    description: 'Plain-spoken, irreverent, humane beneath absurdist surface',
    style: {
      pov: 'Often first-person, sometimes meta-narrator',
      pacing: 'Quick, punchy - very short chapters',
      themes: ['War\'s destruction', 'Absurdity of civilization', 'Need for kindness', 'Illusion of free will'],
      language: 'Simple declarative sentences, accessible',
      tone: 'Black humor mixed with humanism'
    },
    promptTemplate: `Write in Kurt Vonnegut's style.
- Use simple, matter-of-fact language for absurd events
- Include recurring motifs or catch phrases ("So it goes")
- Break fourth wall with authorial commentary
- Scramble chronology but keep voice clear
- Describe atrocities with dark humor and distance
- Maintain compassion for human foolishness
- End with shrug or gentle laugh at fate`,
    algorithm: `State bizarre premise flatly in opening.
Introduce protagonist and absurd situation casually.
Employ chronological scrambling or digression freely.
Sprinkle authorial commentary and folksy aphorisms.
Use recurring refrains to hammer thematic points.
Maintain comic tone even describing tragedies.
Make climax deliberately anti-climactic.
End with shrug or simple image of survival.`
  },

  kafka: {
    name: 'Franz Kafka',
    genres: ['Absurdist Fiction', 'Existential Fiction'],
    description: 'Surreal bureaucratic nightmares, anxious protagonists',
    style: {
      pov: 'Third-person closely aligned with confused protagonist',
      pacing: 'Moderate to slow, events dragged out by obstacles',
      themes: ['Alienation', 'Faceless bureaucracy', 'Guilt without crime', 'Incomprehensible authority'],
      language: 'Precise, formal, matter-of-fact about absurdities',
      tone: 'Oppressive, surreal, deadpan anxiety'
    },
    promptTemplate: `Write in Kafka's style.
- Present absurd premise as flat fact without explanation
- Show protagonist trying to continue normally despite impossibility
- Create endless bureaucratic obstacles and circular logic
- Use neutral, precise language for bizarre events
- Build sense of escalating frustration and guilt
- Let authority remain inexplicable and unjust
- End ambiguously or bleakly`,
    algorithm: `Begin with disorienting premise stated plainly.
Show protagonist's attempt to continue normally despite absurdity.
Pile on convoluted bureaucratic obstacles.
Keep protagonist rational clashing with illogic everywhere.
Maintain neutral narrative voice throughout.
Build escalating frustration and unearned guilt.
Intensify surreal elements near climax.
End ambiguously or bleakly with protagonist succumbing.`
  },

  rowling: {
    name: 'J.K. Rowling',
    genres: ['Fantasy', 'Young Adult', 'Children\'s Adventure'],
    description: 'Accessible imagination, mystery-driven plots, coming-of-age',
    style: {
      pov: 'Third-person limited, following young protagonist',
      pacing: 'Brisk with cliffhangers, structured around school year',
      themes: ['Power of love and friendship', 'Prejudice', 'Growing up', 'Courage'],
      language: 'Simple, vivid, memorable invented terms',
      tone: 'Light and adventurous, growing darker with maturity'
    },
    promptTemplate: `Write in J.K. Rowling's style.
- Follow young protagonist discovering magical world
- Create whimsical invented terms and memorable names
- Structure around mystery with clues and red herrings
- Balance light-hearted moments with growing danger
- Emphasize friendship, loyalty, and courage
- Include well-plotted twists that recontextualize clues
- End with satisfying resolution and warm denouement`,
    algorithm: `Ground story in ordinary world with hints of magic.
Bring protagonist from mundane to magical through revelatory event.
Use structured timeline (school year) to anchor events.
Unveil magical wonders and mysteries together.
Plant clues and red herrings throughout.
Alternate light chapters with ominous foreshadowing.
Build to climax where hero faces danger to solve mystery.
Include twists that recontextualize earlier clues.
End with warm wrap-up and hint of more adventures.`
  },

  faulkner: {
    name: 'William Faulkner',
    genres: ['Southern Gothic', 'Modernist Literary Fiction'],
    description: 'Stream of consciousness, non-linear time, Southern decay',
    style: {
      pov: 'Multiple narrators, deep stream of consciousness',
      pacing: 'Slow, meditative with sudden vivid clarity',
      themes: ['Burden of history', 'Family tragedy', 'Racial complexity', 'Time and memory'],
      language: 'Long flowing sentences, regional dialect, poetic',
      tone: 'Dark, brooding, haunted by inevitability'
    },
    promptTemplate: `Write in Faulkner's style.
- Begin in middle of scene or thought without clear context
- Use stream of consciousness flowing between past and present
- Create distinct narrative voices for different characters
- Build atmosphere with Gothic sensory imagery
- Reveal crucial information obliquely through fragments
- Let truth emerge from collision of perspectives
- End on evocative image echoing unresolved sorrow`,
    algorithm: `Begin mid-scene immersed in character's consciousness.
Embrace non-linearity, narrating pivotal events from multiple angles.
Use stream of consciousness with complex syntax.
Create sense of place with Gothic, sensory imagery.
Develop interconnected storylines across characters with secrets.
Reveal plot points indirectly through gossip and memory.
Allow truth to emerge from assembled perspectives.
End on resonant image implying unresolved tragedy.`
  },

  marquez: {
    name: 'Gabriel Garcia Marquez',
    genres: ['Magical Realism', 'Literary Fiction'],
    description: 'Magic treated as mundane, sweeping family sagas, fate',
    style: {
      pov: 'Third-person omniscient, mythic and legendary',
      pacing: 'Varies - can summarize decades or linger on moments',
      themes: ['Cyclical fate', 'Solitude', 'Love', 'Memory and legacy'],
      language: 'Lush, flowing, long sentences full of color',
      tone: 'Nostalgic, whimsical yet fatalistic'
    },
    promptTemplate: `Write in Gabriel Garcia Marquez's style.
- Open with memorable, sweeping sentence
- Treat magical events as ordinary facts
- Use long, flowing sentences joining many clauses
- Move fluidly through time, compressing or expanding freely
- Create repeating patterns and motifs across generations
- Include hyperbolic or fantastical elements stated plainly
- End with grand, mythic conclusion`,
    algorithm: `Start with memorable sweeping opening line.
Introduce setting as if recounting legend.
Accept magical events without special emphasis.
Use long flowing sentences for breathless storytelling.
Move through generations or phases fluidly.
Identify repeating motifs suggesting fate's patterns.
Build to culmination of prophecy or cycle.
End with mythic, poetic resonance.`
  },

  salinger: {
    name: 'J.D. Salinger',
    genres: ['Literary Fiction', 'Coming-of-Age'],
    description: 'Intimate confessional voice, adolescent alienation',
    style: {
      pov: 'First-person confessional, candid and quirky',
      pacing: 'Character-driven rambling through encounters',
      themes: ['Adolescent alienation', 'Phoniness of society', 'Innocence and corruption', 'Genuine connection'],
      language: 'Colloquial, idiosyncratic slang, digressions',
      tone: 'Cynical and vulnerable, yearning beneath sarcasm'
    },
    promptTemplate: `Write in J.D. Salinger's style.
- Use first-person voice with distinctive verbal tics
- Address reader directly and conspiratorially
- Let narrator's personality emerge through observations
- Create rambling structure through series of encounters
- Reveal emotional truth beneath cynical surface
- Build to quiet epiphany triggered by innocence
- End softly with understated reflection`,
    algorithm: `Adopt first-person narrator with strong quirky voice.
Address reader casually, establishing conspiratorial tone.
Let narrative be less plot-driven, more encounter-based.
Reveal narrator's state through judgments and digressions.
Maintain honesty - admit lies and contradictions.
Emphasize innocence vs corruption throughout encounters.
Build to quiet emotional release triggered by moment of innocence.
End softly with understated reflection on connection and loss.`
  },

  nabokov: {
    name: 'Vladimir Nabokov',
    genres: ['Literary Fiction', 'Metafiction'],
    description: 'Elaborate wordplay, unreliable narration, aesthetic pattern',
    style: {
      pov: 'First-person erudite, possibly unreliable',
      pacing: 'Slow, savoring scenes and digressions',
      themes: ['Obsession', 'Memory and exile', 'Fiction vs reality', 'Artifice'],
      language: 'Ornate, poetic, multilingual puns, precise',
      tone: 'Ironic, self-aware, dark humor with beauty'
    },
    promptTemplate: `Write in Nabokov's style.
- Create distinctive, cultured narrator's voice
- Use elaborate wordplay, alliteration, and unusual metaphors
- Incorporate hidden patterns or puzzles for attentive readers
- Slow down to luxuriate in sensory descriptions
- Let narrator comment on the act of storytelling
- Contrast beautiful language with dark subject matter
- End with linguistic flourish circling back to beginning`,
    algorithm: `Establish distinctive narrator voice - cultured, verbose.
Make every sentence stylistically heightened with wordplay.
Incorporate hidden patterns, anagrams, literary references.
Structure with intellectual game or hidden puzzle.
Let narrator comment on storytelling itself.
Slow pace to luxuriate in descriptions.
Build tension through contrast of beauty and darkness.
End with poetic resonance and linguistic artistry.`
  },

  homer: {
    name: 'Homer',
    genres: ['Epic Poetry', 'Mythic Quest'],
    description: 'Oral epic tradition, gods and heroes, formal grandeur',
    style: {
      pov: 'Third-person omniscient with divine perspective',
      pacing: 'Alternates swift action with ceremonial pauses',
      themes: ['Fate and gods\' will', 'Glory in battle', 'Hospitality', 'Cunning vs strength'],
      language: 'Formal, epithets, extended similes',
      tone: 'Regal, fate-driven, lamenting yet celebratory'
    },
    promptTemplate: `Write in Homeric epic style.
- Begin with invocation and statement of theme
- Use consistent epithets for characters and objects
- Include extended "Homeric similes" from nature
- Describe battles with individual heroic moments
- Show gods intervening or observing
- Include formal speeches recounting lineage and oaths
- End ceremonially with sense of legend`,
    algorithm: `Open invoking the Muse and stating theme.
Use epithets consistently for characters and objects.
Structure in episodes that could stand alone.
Employ extended similes at dramatic moments.
Use direct address and patronymics in dialogue.
Include gods' intervention or observation.
Detail battles with heroic individual kills.
Deliver long formal speeches in key scenes.
End resolving conflict but resonating into future.`
  },

  christie: {
    name: 'Agatha Christie',
    genres: ['Mystery', 'Detective Fiction'],
    description: 'Puzzle plots, fair play clues, drawing room intrigue',
    style: {
      pov: 'Third-person objective or Watson-like narrator',
      pacing: 'Brisk - crime early, methodical investigation, revelation',
      themes: ['Justice and unmasking evil', 'Appearances deceive', 'Order restored'],
      language: 'Plain, dialogue-driven, focused on facts',
      tone: 'Light, clever, civilized game'
    },
    promptTemplate: `Write in Agatha Christie's style.
- Introduce confined setting and cast of suspects
- Commit murder early with clear facts
- Structure around detective's interviews and observations
- Plant clues fairly but disguise in plain sight
- Include red herrings and misdirection
- Build through elimination of suspects
- Climax with detective's revelation scene explaining all
- End with order restored`,
    algorithm: `Introduce setting and cast succinctly.
Foreshadow tensions and secrets early.
Present crime clearly - who, where, when.
Summon detective who begins questioning.
Structure around interviews revealing clue or suspicion each.
Plant clues fairly, also red herrings.
Include twist mid-way (second murder or alibi break).
Build to dramatic denouement with all assembled.
Detective clarifies timeline, eliminates suspects, reveals culprit.
End with justice served and order restored.`
  },

  king: {
    name: 'Stephen King',
    genres: ['Horror', 'Thriller', 'Dark Fantasy'],
    description: 'Ordinary people facing supernatural evil, small-town America',
    style: {
      pov: 'Third-person limited or first-person, close to characters',
      pacing: 'Slow build with character depth, explosive horror',
      themes: ['Evil in ordinary places', 'Childhood trauma', 'Addiction', 'Power of memory'],
      language: 'Accessible, authentic dialogue, pop culture references',
      tone: 'Familiar and grounded before terror strikes'
    },
    promptTemplate: `Write in Stephen King's style.
- Root story in small-town American setting
- Develop ordinary characters with rich internal lives
- Use authentic regional dialogue and pop culture references
- Build dread slowly through mundane details turning sinister
- Mix supernatural horror with human psychology
- Include childhood fears and memories
- Deliver explosive horror after slow build`,
    algorithm: `Establish small-town setting with familiar American details.
Introduce ordinary protagonist with relatable problems and rich inner life.
Use authentic dialogue with regional flavor.
Begin subtly - mundane details turning slightly wrong.
Build tension through protagonist noticing changes.
Escalate with glimpses of the supernatural.
Deliver intense horror after patient build.
Resolve with survival but acknowledge lasting trauma.`
  },

  stevenson: {
    name: 'Robert Louis Stevenson',
    genres: ['Adventure Fiction', 'Gothic Horror'],
    description: 'Brisk adventure, atmospheric suspense, moral duality',
    style: {
      pov: 'First-person youthful or third-person suspenseful',
      pacing: 'Fast-moving with cliffhangers',
      themes: ['Adventure and discovery', 'Duality of human nature', 'Loyalty and betrayal'],
      language: 'Clear, brisk, colorful period vocabulary',
      tone: 'Exciting, suspenseful, moral undertones'
    },
    promptTemplate: `Write in Robert Louis Stevenson's style.
- Plunge into intriguing situation quickly
- Create atmosphere with telling sensory details
- Keep chapters short and eventful
- Build suspense through foreshadowing and mystery
- Develop memorable characters with distinct voices
- Balance thrilling action with moral weight
- Resolve plot while leaving sense of wonder`,
    algorithm: `Plunge reader into intriguing situation immediately.
Set mood efficiently with key sensory details.
Build suspense through foreshadowing and small mysteries.
Alternate action scenes with quiet moments of tension.
Keep chapters tight and eventful with cliffhangers.
Use dialogue to advance plot and characterize.
Deliver climax confronting central danger.
Resolve promptly with return to normalcy but lingering resonance.`
  },

  woolf: {
    name: 'Virginia Woolf',
    genres: ['Modernist Literary Fiction', 'Stream of Consciousness'],
    description: 'Interior consciousness, lyrical prose, moments of being',
    style: {
      pov: 'Omniscient but flowing between character consciousnesses',
      pacing: 'Slow in action, rich in perception and thought',
      themes: ['Nature of consciousness and time', 'Inner lives of women', 'Connection and isolation', 'Mortality'],
      language: 'Lyrical, long flowing sentences, rich imagery',
      tone: 'Meditative, sometimes melancholic, capturing ephemeral moments'
    },
    promptTemplate: `Write in Virginia Woolf's style.
- Anchor scene in physical reality then flow into interior consciousness
- Move seamlessly between character perspectives
- Use rich sensory description mirroring inner states
- Let thoughts flow with minimal traditional punctuation
- Build around symbolic unifying event or goal
- Capture "moments of being" - sudden profound awareness
- End on resonant emotional note`,
    algorithm: `Begin grounded in physical reality then flow to interior.
Let narrative drift between characters' perspectives seamlessly.
Use sensory description to mirror internal states.
Structure around unifying symbolic event or goal.
Allow thoughts to flow with rhythm and punctuation of consciousness.
Include "moment of being" - sudden transcendent awareness.
Resolve emotional arc rather than plot machinery.
End on resonant image encapsulating ephemeral meaning.`
  },

  // ========== SWORD & SORCERY ==========

  howard: {
    name: 'Robert E. Howard',
    genres: ['Sword & Sorcery', 'Pulp Adventure', 'Dark Fantasy'],
    knownFor: ['Conan the Barbarian', 'Kull', 'Solomon Kane'],
    description: 'Raw barbaric vitality, primal conflicts, savage action',
    style: {
      pov: 'Third-person limited, close to protagonist\'s visceral experience',
      pacing: 'Fast and brutal. Short, punchy scenes building to explosive action',
      themes: ['Barbarism vs civilization', 'Survival of the fittest', 'Ancient evils', 'Freedom through strength'],
      language: 'Muscular prose, vivid action verbs, sensory intensity',
      tone: 'Primal, brooding, savage. Dark and violent with poetic grandeur'
    },
    promptTemplate: `Write in Robert E. Howard's style.
- Use muscular, action-driven prose with vivid verbs
- Create stark conflicts between civilization and barbarism
- Describe combat with visceral, brutal detail
- Include ancient evils and sorcerous threats
- Make heroes fierce, self-reliant, and contemptuous of weakness
- Use short declarative sentences in action, poetic passages for atmosphere
- Include the recurring motif: "Steel against sorcery, might against magic"`,
    algorithm: `Open with immediate danger or atmospheric dread.
Introduce protagonist through action revealing their nature.
Establish threat from ancient evil, corrupt civilization, or rival.
Build through escalating dangers and violent confrontations.
Include moment of supernatural horror or revelation.
Climax with brutal, decisive combat.
End with hero triumphant but world still dark and dangerous.`
  },

  decamp: {
    name: 'L. Sprague de Camp',
    genres: ['Sword & Sorcery', 'Historical Fantasy', 'Science Fantasy'],
    knownFor: ['Conan (pastiche)', 'The Complete Compleat Enchanter'],
    description: 'Scholarly wit, logical magic systems, adventure with irony',
    style: {
      pov: 'Third-person omniscient with wry authorial commentary',
      pacing: 'Measured adventure with comedic timing and intellectual puzzles',
      themes: ['Logic vs superstition', 'Cultural clash', 'Practical heroism', 'Historical authenticity'],
      language: 'Witty, precise, scholarly but accessible',
      tone: 'Ironic and urbane with genuine adventure excitement'
    },
    promptTemplate: `Write in L. Sprague de Camp's style.
- Blend adventure with scholarly wit and ironic observation
- Create magic systems with internal logic and rules
- Include historical or pseudo-historical authenticity
- Let heroes use brains as much as brawn
- Add comedic situations arising from cultural misunderstandings
- Use precise, clear prose with occasional learned asides
- Include the signature: intellectual protagonist navigating fantastical situations`,
    algorithm: `Introduce competent protagonist with practical skills.
Establish fantastical setting with logical underpinnings.
Present problem requiring both wit and action.
Develop through puzzles, negotiations, and strategic thinking.
Include comedic complications from cultural differences.
Build to climax where intelligence solves what strength cannot.
End with wry reflection on lessons learned.`
  },

  carter: {
    name: 'Lin Carter',
    genres: ['Sword & Sorcery', 'Planetary Romance', 'Heroic Fantasy'],
    description: 'Romantic adventure, exotic worlds, homage to pulp masters',
    style: {
      pov: 'Third-person limited, following bold adventurer',
      pacing: 'Swift romantic adventure with episodic structure',
      themes: ['Noble heroism', 'Exotic romance', 'Lost civilizations', 'Cosmic scope'],
      language: 'Lush, romantic, deliberately archaic flavor',
      tone: 'Romantic and wonder-filled with nostalgic pulp sensibility'
    },
    promptTemplate: `Write in Lin Carter's style.
- Create exotic, wonder-filled settings with lost civilizations
- Use lush, romantic prose with archaic flavor
- Include noble heroes driven by honor and love
- Build episodic adventures across strange landscapes
- Reference cosmic scope and ancient mysteries
- Maintain sense of nostalgic wonder
- Include the signature: "A tale of wonder and high adventure"`,
    algorithm: `Open with hero in exotic locale facing initial challenge.
Establish lost civilization or cosmic mystery.
Introduce romantic interest or noble cause.
Progress through episodic adventures and wonders.
Build sense of cosmic significance behind events.
Climax with hero confronting ancient power.
End with romance fulfilled and wonder preserved.`
  },

  moorcock: {
    name: 'Michael Moorcock',
    genres: ['Sword & Sorcery', 'Science Fantasy', 'New Wave'],
    description: 'Tragic anti-heroes, eternal champion, multiverse scope',
    style: {
      pov: 'Third-person limited, deep in tormented protagonist\'s psyche',
      pacing: 'Episodic but driven. Melancholic introspection punctuated by violence',
      themes: ['Eternal struggle', 'Chaos vs Law', 'Doomed heroism', 'Identity across lives'],
      language: 'Poetic and melancholic with sharp action sequences',
      tone: 'Melancholic, psychedelic, philosophically questioning'
    },
    promptTemplate: `Write in Michael Moorcock's style.
- Create tormented anti-heroes cursed by fate or power
- Explore the balance between Chaos and Law
- Include multiverse implications and eternal recurrence
- Use poetic, melancholic prose with philosophical depth
- Make victories pyrrhic and endings bittersweet
- Include the recurring motif: the black sword, the eternal champion
- Blend sword & sorcery with cosmic scope`,
    algorithm: `Introduce doomed hero bearing terrible burden or weapon.
Establish conflict as manifestation of Chaos vs Law.
Reveal connections to eternal struggle across multiverse.
Progress through morally ambiguous choices and battles.
Include dreamlike or psychedelic sequences.
Climax with hero forced to terrible sacrifice.
End with melancholic victory that costs everything.`
  },

  // ========== SCIENCE FICTION ==========

  asimov: {
    name: 'Isaac Asimov',
    genres: ['Science Fiction', 'Mystery', 'Social SF'],
    description: 'Ideas-driven narrative, logical puzzles, humanity\'s future',
    style: {
      pov: 'Third-person objective, sometimes first-person conversational',
      pacing: 'Dialogue-heavy, building through logic and revelation',
      themes: ['Logic and reason', 'Robotics ethics', 'Galactic civilization', 'Human potential'],
      language: 'Clear, unadorned, focused on ideas over description',
      tone: 'Rational, optimistic about human problem-solving'
    },
    promptTemplate: `Write in Isaac Asimov's style.
- Focus on ideas and logical problem-solving
- Use clear, accessible prose without purple passages
- Create puzzles that resolve through reason and deduction
- Explore implications of technology on society
- Include dialogue-heavy scenes where characters work through problems
- Maintain optimism about human/robot potential
- Include the signature: "The solution lay in the logical application of known principles"`,
    algorithm: `Present intellectual puzzle or societal problem.
Introduce competent characters with relevant expertise.
Develop through dialogue and logical deduction.
Layer in scientific or technological concepts clearly.
Build through elimination of false solutions.
Climax with elegant logical resolution.
End with implications for humanity's future.`
  },

  leguin: {
    name: 'Ursula K. Le Guin',
    genres: ['Science Fiction', 'Fantasy', 'Anthropological SF'],
    description: 'Anthropological depth, ethical questioning, beautiful prose',
    style: {
      pov: 'Varies: intimate first-person or distant ethnographic third',
      pacing: 'Measured and contemplative with moments of crisis',
      themes: ['Gender and society', 'Balance and ecology', 'Power and freedom', 'Cultural understanding'],
      language: 'Lyrical yet precise, evocative and thoughtful',
      tone: 'Wise, humane, questioning rather than answering'
    },
    promptTemplate: `Write in Ursula K. Le Guin's style.
- Create fully realized cultures with internal logic and beauty
- Use lyrical, precise prose that evokes rather than explains
- Explore gender, power, and society through alien perspectives
- Ask ethical questions without providing easy answers
- Include deep connection between character and environment
- Balance action with philosophical reflection
- Include the signature: understanding through difference`,
    algorithm: `Establish richly imagined culture or world.
Introduce outsider or questioner who sees freshly.
Develop through cultural immersion and relationships.
Present ethical dilemmas without simple solutions.
Build through quiet revelations and growing understanding.
Climax with choice that tests values.
End with wisdom gained but questions remaining.`
  },

  heinlein: {
    name: 'Robert A. Heinlein',
    genres: ['Science Fiction', 'Libertarian SF', 'Military SF'],
    description: 'Competent heroes, libertarian themes, accessible hard SF',
    style: {
      pov: 'First-person conversational or tight third-person',
      pacing: 'Brisk and plot-driven with expository dialogue',
      themes: ['Individual liberty', 'Competence and self-reliance', 'Duty and honor', 'Social evolution'],
      language: 'Conversational, witty, deceptively simple',
      tone: 'Confident, didactic but entertaining, occasionally provocative'
    },
    promptTemplate: `Write in Robert A. Heinlein's style.
- Create hyper-competent protagonists who excel at everything
- Use conversational, accessible prose with folksy wisdom
- Include expository dialogue that educates while entertaining
- Explore libertarian themes of individual freedom and responsibility
- Make technology feel practical and attainable
- Include provocative social commentary
- Include the signature: "A competent man can do anything"`,
    algorithm: `Introduce capable protagonist facing new challenge.
Establish setting through practical details and technology.
Develop through problems solved by competence and wit.
Include mentor figure dispensing folksy wisdom.
Build stakes through escalating challenges.
Climax with hero applying all skills learned.
End with protagonist more capable and free.`
  },

  herbert: {
    name: 'Frank Herbert',
    genres: ['Science Fiction', 'Ecological SF', 'Political SF'],
    description: 'Ecological complexity, political intrigue, mythic scope',
    style: {
      pov: 'Third-person omniscient, entering multiple characters\' thoughts',
      pacing: 'Slow, dense build with explosive action sequences',
      themes: ['Ecology and adaptation', 'Religion and politics', 'Prescience and fate', 'Human potential'],
      language: 'Dense, layered, with invented terminology and epigraphs',
      tone: 'Portentous, philosophical, sometimes mystical'
    },
    promptTemplate: `Write in Frank Herbert's style.
- Create ecologically and politically complex worlds
- Use dense, layered prose with multiple viewpoints
- Include epigraphs and in-world texts that add depth
- Explore how environment shapes culture and consciousness
- Build political intrigue with wheels within wheels
- Include prescience and the burden of seeing futures
- Include the signature: "The mystery of life isn't a problem to solve, but a reality to experience"`,
    algorithm: `Open with epigraph foreshadowing themes.
Establish complex political and ecological setting.
Introduce protagonist marked by destiny or gift.
Develop through political maneuvering and survival.
Layer in mystical or prescient elements.
Build through escalating stakes and revelations.
Climax with transformation and confrontation.
End with new order established but costs acknowledged.`
  },

  clarke: {
    name: 'Arthur C. Clarke',
    genres: ['Science Fiction', 'Hard SF', 'Transcendent SF'],
    description: 'Scientific wonder, cosmic perspective, transcendence',
    style: {
      pov: 'Third-person objective, sometimes documentary style',
      pacing: 'Measured, building to moments of cosmic revelation',
      themes: ['Scientific discovery', 'Human evolution', 'Cosmic perspective', 'Technology and wonder'],
      language: 'Clear, precise, scientifically grounded',
      tone: 'Awestruck, optimistic, reaching toward transcendence'
    },
    promptTemplate: `Write in Arthur C. Clarke's style.
- Ground story in plausible science and technology
- Build toward moments of cosmic wonder and revelation
- Use clear, precise prose that makes complex ideas accessible
- Include humanity's encounter with the truly alien
- Create sense of vast time scales and cosmic perspective
- Maintain optimism about human potential and destiny
- Include the signature: the sense of wonder at humanity's place in the cosmos`,
    algorithm: `Establish near-future setting with plausible technology.
Introduce mystery or discovery of cosmic significance.
Develop through scientific investigation and exploration.
Build wonder through scale and implication.
Include encounter with truly alien intelligence or artifact.
Climax with revelation that recontextualizes humanity.
End with transcendent possibility opened.`
  },

  bradbury: {
    name: 'Ray Bradbury',
    genres: ['Science Fiction', 'Fantasy', 'Dark Fantasy'],
    description: 'Poetic nostalgia, small-town wonder, dark undercurrents',
    style: {
      pov: 'Varies: often nostalgic first-person or intimate third',
      pacing: 'Lyrical, episodic, building emotional resonance',
      themes: ['Childhood wonder', 'Technology\'s cost', 'Memory and time', 'Small-town America'],
      language: 'Poetic, sensory-rich, metaphor-laden',
      tone: 'Nostalgic, bittersweet, wonder mixed with melancholy'
    },
    promptTemplate: `Write in Ray Bradbury's style.
- Use rich, poetic prose full of metaphor and sensory detail
- Evoke nostalgia for childhood and small-town life
- Include dark undercurrents beneath wonder
- Create emotional resonance through specific, vivid images
- Explore technology's impact on human experience
- Balance wonder with melancholy
- Include the signature: "Something wicked this way comes" - beauty and darkness intertwined`,
    algorithm: `Open with evocative sensory image setting emotional tone.
Establish setting rich with nostalgic detail.
Introduce characters experiencing wonder or dread.
Develop through poetic, episodic scenes.
Build emotional resonance through accumulated imagery.
Include dark turn that threatens innocence.
Climax with confrontation between wonder and darkness.
End with bittersweet preservation of what matters.`
  },

  dick: {
    name: 'Philip K. Dick',
    genres: ['Science Fiction', 'Paranoid SF', 'Metaphysical SF'],
    description: 'Reality-questioning, paranoid protagonists, metaphysical puzzles',
    style: {
      pov: 'Third-person limited, often paranoid and unreliable',
      pacing: 'Frenetic, disorienting, reality shifting underfoot',
      themes: ['What is real?', 'What is human?', 'Entropy and decay', 'Small people vs vast systems'],
      language: 'Colloquial, anxious, black humor',
      tone: 'Paranoid, darkly comic, metaphysically anxious'
    },
    promptTemplate: `Write in Philip K. Dick's style.
- Question the nature of reality at every turn
- Use paranoid, anxious prose with black humor
- Create ordinary protagonists caught in vast conspiracies
- Include reality shifts that destabilize reader and character
- Explore what makes us human amid artificiality
- Mix metaphysical dread with mundane detail
- Include the signature: "The Empire never ended" - reality is not what it seems`,
    algorithm: `Introduce ordinary protagonist in mundane situation.
Establish cracks in reality early.
Develop through escalating paranoia and revelations.
Question what's real with each new scene.
Include moments of black humor amid dread.
Build to metaphysical crisis point.
Climax with revelation that may or may not be true.
End ambiguously, reality still uncertain.`
  },

  butler: {
    name: 'Octavia E. Butler',
    genres: ['Science Fiction', 'Afrofuturism', 'Feminist SF'],
    description: 'Power dynamics, survival, transformation through ordeal',
    style: {
      pov: 'First-person intimate, often from marginalized perspective',
      pacing: 'Deliberate, unflinching, building through endurance',
      themes: ['Power and survival', 'Adaptation and change', 'Community and isolation', 'What we become'],
      language: 'Direct, unflinching, deceptively simple',
      tone: 'Unflinching, compassionate, survival-focused'
    },
    promptTemplate: `Write in Octavia E. Butler's style.
- Use direct, unflinching prose without looking away from hard truths
- Explore power dynamics from marginalized perspectives
- Create protagonists who survive through adaptation
- Examine what we must become to endure
- Include community as survival mechanism
- Don't provide easy answers or comfortable resolutions
- Include the signature: transformation through ordeal, survival at a cost`,
    algorithm: `Introduce protagonist already in difficult circumstances.
Establish power dynamics and survival stakes.
Develop through adaptation and hard choices.
Build relationships that complicate and sustain.
Include moments that challenge reader comfort.
Climax with choice that transforms protagonist.
End with survival achieved but person changed.`
  },

  banks: {
    name: 'Iain M. Banks',
    genres: ['Science Fiction', 'Space Opera', 'Culture Series'],
    description: 'Post-scarcity utopia, AI minds, dark humor, moral complexity',
    style: {
      pov: 'Multiple, often including AI perspectives',
      pacing: 'Expansive with set-pieces, witty dialogue, sudden violence',
      themes: ['Utopia\'s edges', 'AI consciousness', 'Intervention ethics', 'Culture vs barbarism'],
      language: 'Witty, inventive, mixing grandiose with irreverent',
      tone: 'Darkly humorous, morally complex, grandly entertaining'
    },
    promptTemplate: `Write in Iain M. Banks's style.
- Create post-scarcity setting where traditional motivations shift
- Include AI Minds with distinct personalities and dark humor
- Mix grand space opera scope with intimate character moments
- Explore morality of intervention in less advanced cultures
- Use inventive, witty prose with sudden violence
- Include ship names that are sentences unto themselves
- Include the signature: "The Culture - utopia with teeth"`,
    algorithm: `Establish Culture setting with post-scarcity details.
Introduce protagonist facing moral complexity.
Include AI Mind as character with distinct voice.
Develop through mission or situation at Culture's edge.
Build through wit, action, and ethical questioning.
Include sudden violence contrasting with civilization.
Climax with choice that defines what Culture means.
End with ambiguity about whether right thing was done.`
  },

  // ========== EPIC FANTASY ==========

  donaldson: {
    name: 'Stephen R. Donaldson',
    genres: ['Epic Fantasy', 'Anti-Hero Fantasy', 'Dark Fantasy'],
    description: 'Tortured anti-heroes, moral anguish, corrupted saviors',
    style: {
      pov: 'Third-person limited, deep in protagonist\'s self-loathing',
      pacing: 'Slow, anguished build with intense confrontations',
      themes: ['Self-loathing and redemption', 'Belief vs despair', 'Corruption of power', 'Healing through ordeal'],
      language: 'Dense, archaic, emotionally intense',
      tone: 'Anguished, morally tormented, wrestling with despair'
    },
    promptTemplate: `Write in Stephen R. Donaldson's style.
- Create protagonists who loathe themselves and doubt their worth
- Use dense, emotionally intense prose
- Explore moral anguish without easy resolution
- Build worlds where belief itself has power
- Include corruption of the seemingly good
- Make redemption hard-won through suffering
- Include the signature: "He who trusts is the true believer" - faith vs despair`,
    algorithm: `Introduce protagonist already broken or compromised.
Establish fantasy world where belief matters.
Develop through moral anguish and self-doubt.
Build through trials that test to breaking point.
Include corruption of hope or power.
Climax with choice between despair and belief.
End with hard-won redemption at great cost.`
  },

  sanderson: {
    name: 'Brandon Sanderson',
    genres: ['Epic Fantasy', 'Hard Fantasy', 'Cosmere'],
    description: 'Systematic magic, intricate plotting, satisfying payoffs',
    style: {
      pov: 'Multiple third-person limited with clear chapter breaks',
      pacing: 'Methodical build to explosive "Sanderson Avalanche" finale',
      themes: ['Systematic magic', 'Leadership and sacrifice', 'Overcoming trauma', 'Interconnected cosmos'],
      language: 'Clear, accessible, focused on action and magic systems',
      tone: 'Earnest, heroic, building toward earned triumph'
    },
    promptTemplate: `Write in Brandon Sanderson's style.
- Create magic systems with clear rules and limitations
- Build multiple plot threads that converge explosively
- Use clear, accessible prose focused on action
- Include characters overcoming personal trauma through heroism
- Layer in mysteries that pay off satisfyingly
- Build toward the "Sanderson Avalanche" - everything converging
- Include the signature: "Journey before destination"`,
    algorithm: `Establish magic system with clear rules early.
Introduce multiple viewpoint characters with distinct arcs.
Plant mysteries and Chekhov's guns throughout.
Build each thread toward personal growth.
Layer in larger cosmological connections.
Converge all threads in explosive finale.
End with satisfying payoffs and new questions.`
  },

  rothfuss: {
    name: 'Patrick Rothfuss',
    genres: ['Epic Fantasy', 'Literary Fantasy', 'Coming-of-Age'],
    description: 'Lyrical prose, unreliable narrator, legend in the making',
    style: {
      pov: 'First-person framed narrative, self-aware storyteller',
      pacing: 'Leisurely, savoring moments, building legend',
      themes: ['Story and truth', 'Names and power', 'Love and obsession', 'Making of legends'],
      language: 'Lyrical, musical, carefully crafted',
      tone: 'Melancholic nostalgia, aware of its own storytelling'
    },
    promptTemplate: `Write in Patrick Rothfuss's style.
- Use lyrical, musical prose with careful word choice
- Create unreliable narrator aware of their own legend-building
- Explore the gap between story and truth
- Include deep magic tied to names and music
- Build romance with poetic intensity
- Layer meaning through fairy tales and songs within the story
- Include the signature: "Words are pale shadows of forgotten names"`,
    algorithm: `Establish framing device with narrator reflecting.
Build legend through narrator's own telling.
Develop with poetic, musical prose.
Include tales-within-tales adding depth.
Build romance and mystery intertwined.
Include magic tied to language and naming.
End episode with awareness of story's power.`
  },

  hobb: {
    name: 'Robin Hobb',
    genres: ['Epic Fantasy', 'Character-Driven Fantasy'],
    description: 'Intimate character study, emotional depth, bonded companions',
    style: {
      pov: 'First-person intimate, deeply embedded in protagonist',
      pacing: 'Slow, character-focused, building emotional investment',
      themes: ['Bonds between species', 'Duty vs desire', 'Growing up wounded', 'Love in all forms'],
      language: 'Intimate, emotionally precise, richly detailed',
      tone: 'Deeply emotional, often melancholic, ultimately hopeful'
    },
    promptTemplate: `Write in Robin Hobb's style.
- Create deep first-person intimacy with protagonist
- Focus on emotional truth over action
- Develop bonds between human and animal/magical companions
- Explore duty conflicting with personal desire
- Include growing up wounded and finding healing
- Build slow-burn relationships with devastating payoffs
- Include the signature: the Wit bond, connection across species`,
    algorithm: `Establish intimate first-person voice immediately.
Introduce bond with companion (animal or magical).
Develop through emotional challenges and relationships.
Build through quiet moments and small victories.
Include duty demanding sacrifice of personal happiness.
Climax with choice between bond and world.
End with melancholic hope and hard-won peace.`
  },

  martin: {
    name: 'George R.R. Martin',
    genres: ['Epic Fantasy', 'Low Fantasy', 'Political Fantasy'],
    description: 'Morally gray world, shocking deaths, political intrigue',
    style: {
      pov: 'Multiple limited third-person with strict POV discipline',
      pacing: 'Epic scope with multiple threads, patient development',
      themes: ['Power corrupts', 'Actions have consequences', 'No true heroes', 'Winter always comes'],
      language: 'Rich, detailed, medieval flavor without archaism',
      tone: 'Cynical yet humane, brutal yet beautiful'
    },
    promptTemplate: `Write in George R.R. Martin's style.
- Use strict POV discipline, limited to one character per scene
- Create morally gray characters on all sides
- Include political intrigue with multiple factions
- Let actions have real, often fatal consequences
- Build rich world detail especially in food and clothing
- Subvert fantasy tropes - heroes can die
- Include the signature: "When you play the game of thrones, you win or you die"`,
    algorithm: `Establish multiple POV characters across factions.
Build political web of alliances and betrayals.
Develop characters with understandable motivations.
Include shocking consequences for mistakes.
Layer in world-building through sensory detail.
Build toward convergence of multiple plots.
End with some threads resolved, others complicated.`
  },

  jordan: {
    name: 'Robert Jordan',
    genres: ['Epic Fantasy', 'Wheel of Time', 'Chosen One'],
    knownFor: ['The Wheel of Time', 'Conan (novels)'],
    description: 'Vast tapestry, detailed world-building, prophecy fulfilled',
    style: {
      pov: 'Multiple third-person limited, weaving between many characters',
      pacing: 'Expansive, comprehensive, building vast narrative',
      themes: ['Wheel of Time', 'Gender and power', 'Duty and destiny', 'Light vs Shadow'],
      language: 'Detailed, immersive, with distinctive cultural voices',
      tone: 'Epic and immersive, building toward prophesied confrontation'
    },
    promptTemplate: `Write in Robert Jordan's style.
- Create vast, detailed world with distinct cultures
- Weave multiple character threads across nations
- Include detailed descriptions of clothing, customs, settings
- Build prophecy that shapes character destiny
- Explore gender dynamics and different power systems
- Use distinctive speech patterns for different cultures
- Include the signature: "The Wheel weaves as the Wheel wills"`,
    algorithm: `Establish vast world with prophecy hanging over it.
Introduce chosen protagonist unaware of destiny.
Develop multiple companions with distinct cultures.
Build through episodic adventures across lands.
Layer in political and magical conflicts.
Advance toward prophesied confrontation.
End with major step taken, vast journey remaining.`
  },

  gaiman: {
    name: 'Neil Gaiman',
    genres: ['Fantasy', 'Urban Fantasy', 'Mythic Fiction'],
    description: 'Mythic resonance, darkness and wonder, liminal spaces',
    style: {
      pov: 'Varies: intimate first-person or fairy-tale omniscient',
      pacing: 'Dreamlike, building through accumulation of wonder',
      themes: ['Old gods in new world', 'Stories shape reality', 'Liminal spaces', 'Growing up strange'],
      language: 'Deceptively simple, fairy-tale cadence, precise',
      tone: 'Darkly whimsical, mythic, finding wonder in shadows'
    },
    promptTemplate: `Write in Neil Gaiman's style.
- Use deceptively simple prose with fairy-tale resonance
- Blend mythology with contemporary life
- Create liminal spaces where magic bleeds through
- Include darkness as part of wonder, not opposed to it
- Build stories that feel like they were always true
- Use precise, evocative language
- Include the signature: "Stories are the only thing worth dying for"`,
    algorithm: `Establish ordinary world with cracks showing through.
Introduce protagonist drawn to the liminal.
Develop through encounters with myth made real.
Build wonder and darkness equally.
Include stories-within-stories adding resonance.
Climax with mythic confrontation or choice.
End with world unchanged but protagonist transformed.`
  },

  pratchett: {
    name: 'Terry Pratchett',
    genres: ['Comic Fantasy', 'Satirical Fantasy', 'Discworld'],
    description: 'Satirical wit, humanity beneath humor, footnoted asides',
    style: {
      pov: 'Third-person omniscient with authorial commentary',
      pacing: 'Brisk with comedic timing, building to meaningful conclusion',
      themes: ['Humanity and justice', 'Power of belief', 'Death and dignity', 'Small people matter'],
      language: 'Witty, pun-laden, philosophically sharp',
      tone: 'Comic but humane, satirical but compassionate'
    },
    promptTemplate: `Write in Terry Pratchett's style.
- Use wit and wordplay with philosophical depth beneath
- Include footnotes that add comedic or insightful asides
- Satirize human institutions and beliefs lovingly
- Create heroes who are ordinary people doing right thing
- Include DEATH or other personified concepts
- Find humanity in the most unlikely places
- Include the signature: "It's not worth doing something unless someone, somewhere, would much rather you weren't doing it"`,
    algorithm: `Establish Discworld-style setting ripe for satire.
Introduce unlikely hero, often cynical or overlooked.
Develop through farcical situations with real stakes.
Build with accumulating jokes that connect.
Include moments of genuine emotion and wisdom.
Climax with heroism from unexpected source.
End with order restored but something improved.`
  },

  // ========== HORROR & WEIRD FICTION ==========

  lovecraft: {
    name: 'H.P. Lovecraft',
    genres: ['Cosmic Horror', 'Weird Fiction', 'Gothic Horror'],
    description: 'Cosmic dread, forbidden knowledge, human insignificance',
    style: {
      pov: 'First-person scholarly narrator, often traumatized',
      pacing: 'Slow, dread-building, with climactic revelation',
      themes: ['Cosmic indifference', 'Forbidden knowledge', 'Hereditary doom', 'Things beyond comprehension'],
      language: 'Archaic, adjective-heavy, building toward ineffability',
      tone: 'Dread-filled, scholarly, building to cosmic horror'
    },
    promptTemplate: `Write in H.P. Lovecraft's style.
- Use first-person scholarly narrator recounting traumatic events
- Build atmosphere through accumulating dread
- Include forbidden books, ancient cults, non-Euclidean geometry
- Make horror cosmic in scale, beyond human comprehension
- Use archaic vocabulary and complex sentence structure
- Describe the indescribable through negation and implication
- Include the signature: "The most merciful thing in the world is the inability of the human mind to correlate all its contents"`,
    algorithm: `Establish narrator explaining why they must tell this tale.
Build scholarly setting with hints of deeper wrongness.
Develop through investigation uncovering forbidden knowledge.
Accumulate dread through suggestive details.
Include ancient texts, cults, or ancestral doom.
Climax with revelation of cosmic horror beyond description.
End with narrator broken, truth too terrible to bear.`
  }
};

// Export as array for easy iteration
export const AUTHOR_STYLES_LIST = Object.entries(AUTHOR_STYLES).map(([key, value]) => ({
  id: key,
  ...value
}));

// Get author style by ID or name
export function getAuthorStyle(idOrName) {
  if (AUTHOR_STYLES[idOrName]) {
    return AUTHOR_STYLES[idOrName];
  }
  // Search by name
  const entry = Object.entries(AUTHOR_STYLES).find(([_, v]) =>
    v.name.toLowerCase().includes(idOrName.toLowerCase())
  );
  return entry ? entry[1] : null;
}

export default AUTHOR_STYLES;
