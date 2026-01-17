/**
 * Gender Inference Utility
 *
 * Provides enhanced gender inference with confidence scoring
 * for character name analysis and role-based hints.
 *
 * Confidence Levels:
 * - 1.0: Explicit gender in text (he/she/they)
 * - 0.9: Strong name match (common first name)
 * - 0.8: Name ending pattern match
 * - 0.7: Role/title-based inference
 * - 0.6: Context clues (description keywords)
 * - 0.5: Uncertain/neutral
 */

// Female names organized by origin/type
const FEMALE_NAMES = {
  // Western names (most common)
  western: new Set([
    'abigail', 'adelaide', 'adriana', 'agatha', 'agnes', 'alexandra', 'alice', 'alicia',
    'allison', 'amanda', 'amelia', 'amy', 'anastasia', 'andrea', 'angela', 'angelica',
    'anna', 'anne', 'annie', 'april', 'ashley', 'audrey', 'aurora', 'barbara', 'beatrice',
    'becky', 'bella', 'bertha', 'beth', 'betty', 'bianca', 'bonnie', 'brenda', 'bridget',
    'brittany', 'brooke', 'camille', 'candace', 'carmen', 'carol', 'caroline', 'cassandra',
    'catherine', 'cecilia', 'charlotte', 'chelsea', 'cheryl', 'chloe', 'christina', 'christine',
    'cindy', 'claire', 'clara', 'claudia', 'colleen', 'constance', 'cynthia', 'daisy', 'dana',
    'danielle', 'daphne', 'dawn', 'deborah', 'debra', 'delilah', 'denise', 'diana', 'diane',
    'donna', 'dora', 'dorothy', 'edith', 'eileen', 'elaine', 'eleanor', 'elena', 'eliza',
    'elizabeth', 'ella', 'ellen', 'eloise', 'elsie', 'emily', 'emma', 'erica', 'erin',
    'esther', 'ethel', 'eva', 'eve', 'evelyn', 'faith', 'faye', 'felicia', 'fiona', 'florence',
    'frances', 'francesca', 'gabriella', 'gabrielle', 'gail', 'gemma', 'georgia', 'gertrude',
    'gina', 'giselle', 'gladys', 'gloria', 'grace', 'gwendolyn', 'hannah', 'harriet', 'hazel',
    'heather', 'heidi', 'helen', 'helena', 'henrietta', 'hillary', 'holly', 'hope', 'ida',
    'irene', 'iris', 'isabella', 'ivy', 'jacqueline', 'jade', 'jane', 'janet', 'janice',
    'jasmine', 'jean', 'jeanette', 'jennifer', 'jenny', 'jessica', 'jill', 'joan', 'joanna',
    'jocelyn', 'josephine', 'joyce', 'judith', 'judy', 'julia', 'juliana', 'julie', 'juliet',
    'june', 'karen', 'kate', 'katherine', 'kathleen', 'kathryn', 'kathy', 'katie', 'kayla',
    'kelly', 'kendra', 'kimberly', 'kristin', 'kristina', 'laura', 'lauren', 'laurie', 'leah',
    'lena', 'leslie', 'lillian', 'lily', 'linda', 'lisa', 'lois', 'loretta', 'lori', 'lorraine',
    'louise', 'lucia', 'lucille', 'lucy', 'lydia', 'lynn', 'mabel', 'mackenzie', 'madeline',
    'madison', 'maggie', 'margaret', 'maria', 'marian', 'marie', 'marilyn', 'marissa', 'marjorie',
    'marlene', 'martha', 'mary', 'maureen', 'maxine', 'megan', 'melanie', 'melinda', 'melissa',
    'mercedes', 'meredith', 'michelle', 'mildred', 'miranda', 'miriam', 'molly', 'monica', 'morgan',
    'muriel', 'myrtle', 'nancy', 'natalie', 'natasha', 'nellie', 'nicole', 'nina', 'nora',
    'norma', 'olive', 'olivia', 'opal', 'paige', 'pamela', 'patricia', 'patty', 'paula', 'pauline',
    'pearl', 'peggy', 'penelope', 'penny', 'phoebe', 'phyllis', 'polly', 'priscilla', 'rachel',
    'rebecca', 'regina', 'renee', 'rhonda', 'rita', 'roberta', 'robin', 'rose', 'rosemary',
    'roxanne', 'ruby', 'ruth', 'sabrina', 'sally', 'samantha', 'sandra', 'sara', 'sarah',
    'savannah', 'scarlett', 'shannon', 'sharon', 'sheila', 'shelby', 'sherry', 'shirley', 'sierra',
    'simone', 'sofia', 'sonia', 'sophia', 'stacy', 'stella', 'stephanie', 'sue', 'susan',
    'suzanne', 'sylvia', 'tamara', 'tammy', 'tanya', 'tara', 'taylor', 'teresa', 'thelma',
    'theresa', 'tiffany', 'tina', 'tracy', 'ursula', 'valerie', 'vanessa', 'vera', 'veronica',
    'vicki', 'victoria', 'viola', 'violet', 'virginia', 'vivian', 'wanda', 'wendy', 'whitney',
    'wilma', 'winifred', 'yvonne', 'zoe', 'zoey'
  ]),

  // Asian names
  asian: new Set([
    // Japanese
    'aiko', 'akemi', 'akiko', 'ami', 'asuka', 'aya', 'ayaka', 'ayame', 'ayumi', 'chie', 'chieko',
    'chika', 'chiyo', 'emi', 'emiko', 'eri', 'fumiko', 'hana', 'hanako', 'haruka', 'harumi',
    'hikari', 'hikaru', 'hina', 'hinata', 'hiromi', 'hitomi', 'honoka', 'kaede', 'kaori', 'kasumi',
    'kazuko', 'keiko', 'kiko', 'kimiko', 'kiyoko', 'koharu', 'kumiko', 'kyoko', 'mai', 'maki',
    'makiko', 'mami', 'mariko', 'masako', 'mayumi', 'megumi', 'michiko', 'midori', 'miho', 'mika',
    'miki', 'minako', 'minori', 'misaki', 'mitsuko', 'miwa', 'miyako', 'miyuki', 'momoko', 'nana',
    'nanako', 'naoko', 'naomi', 'natsuki', 'natsumi', 'nobuko', 'noriko', 'reiko', 'rika', 'riko',
    'rin', 'rina', 'rio', 'risa', 'sachiko', 'saki', 'sakura', 'satoko', 'sayaka', 'sayuri',
    'setsuko', 'shizuka', 'shizuko', 'sumiko', 'takako', 'tamako', 'tomiko', 'tomoko', 'toshiko',
    'yoko', 'yoshiko', 'yui', 'yuka', 'yukari', 'yuki', 'yukiko', 'yuko', 'yumi', 'yumiko', 'yuri',
    'yuriko',
    // Chinese
    'ai', 'bao', 'chen', 'chun', 'fang', 'feng', 'hong', 'hua', 'hui', 'jia', 'jing', 'juan',
    'lan', 'lei', 'li', 'lian', 'lien', 'ling', 'liu', 'mei', 'meiling', 'min', 'ming', 'na',
    'ning', 'ping', 'qian', 'qing', 'rong', 'shan', 'shu', 'shuang', 'ting', 'wei', 'wen', 'xia',
    'xiang', 'xiao', 'xin', 'xiu', 'yan', 'ying', 'yu', 'yuan', 'yue', 'yun', 'zhen', 'zhi',
    // Korean
    'ahri', 'boyoung', 'chaeyoung', 'dahyun', 'eunbi', 'eunha', 'eunji', 'haeun', 'hana', 'hayeon',
    'heejin', 'hyejin', 'hyeri', 'hyojin', 'jieun', 'jimin', 'jina', 'jiyeon', 'jiyoung', 'minji',
    'minyoung', 'nari', 'seoah', 'seojin', 'seoyeon', 'seoyoung', 'soojin', 'soyeon', 'soyoung',
    'subin', 'sujin', 'sunmi', 'yejin', 'yeonhee', 'yeseul', 'yoona', 'yujin', 'yuna'
  ]),

  // Space/sci-fi themed
  scifi: new Set([
    'andromeda', 'aria', 'artemis', 'athena', 'aurora', 'astra', 'calypso', 'cassiopeia', 'celestia',
    'ceres', 'cybele', 'diana', 'echo', 'electra', 'gaia', 'galatea', 'hera', 'io', 'iris', 'juno',
    'luna', 'lyra', 'maia', 'nebula', 'nyx', 'nova', 'pandora', 'persephone', 'phoebe', 'rhea',
    'selene', 'seraphina', 'stella', 'terra', 'theia', 'titania', 'vega', 'venus', 'vesta', 'zephyra'
  ]),

  // Fantasy themed
  fantasy: new Set([
    'aeris', 'alara', 'aldara', 'alyssa', 'amara', 'ariadne', 'arwen', 'asteria', 'aurelia', 'avalon',
    'brielle', 'calista', 'celeste', 'cordelia', 'dahlia', 'elara', 'elowen', 'ember', 'esmeralda',
    'evangeline', 'fern', 'freya', 'galadriel', 'guinevere', 'hazel', 'illyria', 'isolde', 'ivy',
    'jasira', 'juniper', 'kallista', 'kira', 'layla', 'lilith', 'lorelei', 'lumina', 'lyanna',
    'lyra', 'maelis', 'marigold', 'meadow', 'melisandre', 'mira', 'morgana', 'nadia', 'nerissa',
    'nyssa', 'ophelia', 'petra', 'phoenix', 'raven', 'rhiannon', 'rosalind', 'rowena', 'saffron',
    'sage', 'seraphina', 'serenity', 'shira', 'sienna', 'skye', 'soraya', 'sybil', 'sylvana',
    'taliyah', 'tempest', 'thalia', 'valentina', 'vera', 'vesper', 'viola', 'vivienne', 'willow',
    'winter', 'wren', 'yara', 'zelda', 'zephyr', 'zora'
  ])
};

// Male names organized by origin/type
const MALE_NAMES = {
  // Western names (most common)
  western: new Set([
    'aaron', 'abraham', 'adam', 'adrian', 'alan', 'albert', 'alec', 'alexander', 'alfred', 'allen',
    'anderson', 'andrew', 'anthony', 'antonio', 'archibald', 'arnold', 'arthur', 'austin', 'barry',
    'benjamin', 'bernard', 'bill', 'billy', 'blake', 'bob', 'bobby', 'brad', 'bradley', 'brandon',
    'brendan', 'brent', 'brett', 'brian', 'bruce', 'bryan', 'byron', 'calvin', 'cameron', 'carl',
    'carlos', 'carter', 'casey', 'chad', 'charles', 'charlie', 'chester', 'chris', 'christian',
    'christopher', 'clarence', 'clark', 'claude', 'clayton', 'clifford', 'clint', 'clyde', 'cody',
    'cole', 'colin', 'connor', 'corey', 'craig', 'curtis', 'dale', 'dan', 'daniel', 'danny',
    'darren', 'dave', 'david', 'dean', 'dennis', 'derek', 'derrick', 'desmond', 'devin', 'dick',
    'dominic', 'don', 'donald', 'doug', 'douglas', 'drew', 'duane', 'dustin', 'dwight', 'dylan',
    'earl', 'ed', 'eddie', 'edgar', 'edmund', 'edward', 'edwin', 'eli', 'elijah', 'elliot',
    'elliott', 'elmer', 'emmanuel', 'eric', 'ernest', 'ethan', 'eugene', 'evan', 'everett',
    'felix', 'fernando', 'floyd', 'francis', 'frank', 'franklin', 'fred', 'frederick', 'gabriel',
    'garrett', 'gary', 'gavin', 'gene', 'geoffrey', 'george', 'gerald', 'gilbert', 'glen', 'glenn',
    'gordon', 'graham', 'grant', 'greg', 'gregory', 'guy', 'hal', 'hank', 'harold', 'harrison',
    'harry', 'harvey', 'hayden', 'hector', 'henry', 'herbert', 'herman', 'howard', 'hubert', 'hugh',
    'hugo', 'hunter', 'ian', 'isaac', 'ivan', 'jack', 'jackson', 'jacob', 'jake', 'james', 'jamie',
    'jared', 'jason', 'jay', 'jeff', 'jeffery', 'jeffrey', 'jeremy', 'jerome', 'jerry', 'jesse',
    'jim', 'jimmy', 'joe', 'joel', 'john', 'johnny', 'jon', 'jonathan', 'jordan', 'jose', 'joseph',
    'josh', 'joshua', 'juan', 'julian', 'justin', 'karl', 'keith', 'ken', 'kenneth', 'kenny',
    'kent', 'kevin', 'kirk', 'kurt', 'kyle', 'lance', 'larry', 'lars', 'lawrence', 'lee', 'leo',
    'leon', 'leonard', 'leroy', 'leslie', 'lester', 'lewis', 'liam', 'lloyd', 'logan', 'lonnie',
    'louis', 'lucas', 'luis', 'luke', 'marcus', 'mario', 'mark', 'marshall', 'martin', 'marvin',
    'mason', 'matt', 'matthew', 'maurice', 'max', 'maxwell', 'melvin', 'michael', 'mickey', 'miguel',
    'mike', 'miles', 'mitchell', 'nathan', 'nathaniel', 'neil', 'nelson', 'nicholas', 'nick',
    'noah', 'noel', 'norman', 'oliver', 'omar', 'oscar', 'otto', 'owen', 'patrick', 'paul', 'pedro',
    'perry', 'pete', 'peter', 'phil', 'philip', 'phillip', 'pierre', 'preston', 'quentin', 'rafael',
    'ralph', 'ramon', 'randall', 'randy', 'ray', 'raymond', 'reginald', 'rex', 'ricardo', 'richard',
    'rick', 'ricky', 'riley', 'rob', 'robert', 'roberto', 'robin', 'rod', 'rodney', 'roger',
    'roland', 'ron', 'ronald', 'ross', 'roy', 'ruben', 'russell', 'ryan', 'sam', 'samuel', 'scott',
    'sean', 'sebastian', 'seth', 'shane', 'shaun', 'shawn', 'sidney', 'simon', 'spencer', 'stanley',
    'stephen', 'steve', 'steven', 'stuart', 'ted', 'terrence', 'terry', 'theodore', 'thomas',
    'tim', 'timothy', 'todd', 'tom', 'tommy', 'tony', 'travis', 'trevor', 'troy', 'tyler', 'vernon',
    'victor', 'vincent', 'virgil', 'wade', 'wallace', 'walter', 'warren', 'wayne', 'wendell',
    'wesley', 'willard', 'william', 'willie', 'winston', 'wyatt', 'xavier', 'zachary', 'zack'
  ]),

  // Asian names
  asian: new Set([
    // Japanese
    'akihiko', 'akihiro', 'akio', 'akira', 'arata', 'atsushi', 'daichi', 'daiki', 'daisuke', 'fumio',
    'hajime', 'haruki', 'haruto', 'hayato', 'hideki', 'hideo', 'hikaru', 'hiro', 'hiroki', 'hiroshi',
    'ichiro', 'isamu', 'jiro', 'jun', 'junichi', 'kaito', 'kazuki', 'kazuo', 'ken', 'kenji', 'kenta',
    'koji', 'kosuke', 'makoto', 'masaki', 'masao', 'masashi', 'masato', 'minoru', 'naoki', 'noboru',
    'nobuo', 'osamu', 'ren', 'riku', 'ryo', 'ryota', 'ryuichi', 'satoru', 'satoshi', 'shin', 'shingo',
    'shinji', 'shota', 'shun', 'sora', 'tadashi', 'takashi', 'takeshi', 'takumi', 'taro', 'tatsuo',
    'tetsuya', 'tomohiro', 'toru', 'yoichi', 'yosuke', 'yuki', 'yukio', 'yusuke', 'yuta', 'yuto',
    // Chinese
    'bao', 'bo', 'chang', 'chen', 'cheng', 'de', 'dong', 'feng', 'gang', 'guang', 'guo', 'hai', 'hao',
    'hong', 'hu', 'hua', 'huang', 'hui', 'jian', 'jiang', 'jin', 'jun', 'kai', 'lei', 'liang', 'lin',
    'long', 'ming', 'peng', 'ping', 'qiang', 'qin', 'rong', 'shan', 'sheng', 'tao', 'wei', 'wen',
    'wu', 'xiang', 'xin', 'xiong', 'xu', 'yang', 'yi', 'ying', 'yong', 'yu', 'yuan', 'yun', 'zhe',
    'zheng', 'zhi', 'zhong',
    // Korean
    'beomseok', 'bongsu', 'changmin', 'cheol', 'daehan', 'dongwoo', 'gunho', 'haejin', 'hansol',
    'hyunjin', 'jaehyun', 'jeonghoon', 'jimin', 'jinwoo', 'jiwon', 'joong', 'joonho', 'junhyuk',
    'junsu', 'juwon', 'kyungho', 'minho', 'minsu', 'sangwoo', 'seojun', 'seongmin', 'seunghyun',
    'siwoo', 'sungjin', 'taehyung', 'woojin', 'yoongi', 'youngho', 'yunho'
  ]),

  // Space/sci-fi themed
  scifi: new Set([
    'aether', 'ajax', 'apollo', 'ares', 'argus', 'atlas', 'axel', 'blaze', 'cipher', 'cosmo',
    'cyrus', 'daedalus', 'falcon', 'flux', 'griffin', 'helios', 'hunter', 'ion', 'jett', 'kael',
    'lance', 'laser', 'mars', 'neo', 'orion', 'phoenix', 'probe', 'raven', 'rex', 'rocket',
    'sirius', 'sol', 'sterling', 'storm', 'strider', 'titan', 'vector', 'vex', 'zephyr', 'zero'
  ]),

  // Fantasy themed
  fantasy: new Set([
    'aedan', 'alaric', 'aldric', 'andreas', 'angus', 'arawn', 'archer', 'asher', 'ashton', 'bane',
    'bjorn', 'blade', 'bran', 'briar', 'caden', 'caius', 'callum', 'cassius', 'cedric', 'colt',
    'corbin', 'cyric', 'daemon', 'damon', 'dante', 'darius', 'draco', 'drake', 'eamon', 'elric',
    'fenris', 'finnian', 'flint', 'gareth', 'gavyn', 'gideon', 'griffin', 'hadrian', 'hawk', 'heath',
    'jareth', 'jasper', 'kael', 'kieran', 'lachlan', 'lance', 'leander', 'lorcan', 'lyric', 'magnus',
    'malachi', 'marius', 'matthias', 'merrick', 'nico', 'nolan', 'oberon', 'odin', 'osric', 'percival',
    'phoenix', 'ragnar', 'raven', 'remus', 'ronan', 'rowan', 'ryker', 'sage', 'sawyer', 'silas',
    'slate', 'soren', 'sterling', 'stone', 'thorn', 'torben', 'tristan', 'ulric', 'valerian', 'vaughn',
    'viktor', 'wolf', 'wyatt', 'xavier', 'zander'
  ])
};

// Gender-indicative name endings
const FEMALE_NAME_ENDINGS = [
  'a', 'ia', 'ie', 'ette', 'elle', 'ina', 'ine', 'yn', 'een', 'leen',
  'lyn', 'anna', 'onna', 'issa', 'essa', 'etta', 'ilda', 'ilda'
];

const MALE_NAME_ENDINGS = [
  'o', 'us', 'on', 'an', 'en', 'er', 'ton', 'son', 'ck', 'ard',
  'ald', 'bert', 'fred', 'mund', 'ric', 'rich', 'win', 'vin'
];

// Gender-indicative role/title words
const FEMALE_ROLE_WORDS = new Set([
  'queen', 'princess', 'duchess', 'countess', 'baroness', 'empress', 'goddess',
  'priestess', 'sorceress', 'witch', 'matriarch', 'lady', 'dame', 'madame',
  'mother', 'grandmother', 'aunt', 'sister', 'wife', 'bride', 'maiden',
  'heroine', 'actress', 'waitress', 'hostess', 'stewardess', 'seamstress',
  'she', 'her', 'hers', 'herself', 'woman', 'girl', 'female', 'feminine',
  'daughter', 'niece', 'granddaughter', 'goddess', 'nymph', 'mermaid', 'fairy'
]);

const MALE_ROLE_WORDS = new Set([
  'king', 'prince', 'duke', 'count', 'baron', 'emperor', 'god', 'priest',
  'sorcerer', 'wizard', 'warlock', 'patriarch', 'lord', 'sir', 'master',
  'father', 'grandfather', 'uncle', 'brother', 'husband', 'groom', 'knight',
  'hero', 'actor', 'waiter', 'host', 'steward',
  'he', 'his', 'him', 'himself', 'man', 'boy', 'male', 'masculine',
  'son', 'nephew', 'grandson', 'god', 'titan', 'giant'
]);

// Neutral/ambiguous names
const NEUTRAL_NAMES = new Set([
  'alex', 'angel', 'avery', 'bailey', 'blake', 'cameron', 'carey', 'casey',
  'charlie', 'chris', 'corey', 'dakota', 'drew', 'dylan', 'emerson', 'emery',
  'finley', 'frankie', 'harper', 'hayden', 'hunter', 'jamie', 'jesse', 'jordan',
  'kai', 'kelly', 'kendall', 'kennedy', 'kim', 'lee', 'leslie', 'logan', 'london',
  'madison', 'morgan', 'parker', 'pat', 'peyton', 'quinn', 'reagan', 'reese',
  'riley', 'river', 'robin', 'rowan', 'ryan', 'sage', 'sam', 'sandy', 'sawyer',
  'shawn', 'skyler', 'spencer', 'sydney', 'taylor', 'terry', 'tony', 'tracy'
]);

/**
 * Infer gender from a character name with confidence scoring
 *
 * @param {string} name - Character name
 * @param {Object} options - Additional context for inference
 * @param {string} options.description - Character description
 * @param {string} options.role - Character role/title
 * @param {string} options.context - Additional context text
 * @returns {Object} { gender: 'male'|'female'|'neutral', confidence: 0-1, reason: string }
 */
export function inferGender(name, options = {}) {
  const { description = '', role = '', context = '' } = options;

  // Combine all text for pronoun/keyword search
  const fullText = `${description} ${role} ${context}`.toLowerCase();

  // Check for explicit pronouns (highest confidence)
  const pronounResult = checkPronouns(fullText);
  if (pronounResult.confidence >= 0.9) {
    return pronounResult;
  }

  // Check for role/title words (high confidence)
  const roleResult = checkRoleWords(fullText);
  if (roleResult.confidence >= 0.7) {
    return roleResult;
  }

  // Parse and check name
  if (!name) {
    return { gender: 'neutral', confidence: 0.5, reason: 'no_name' };
  }

  const firstName = extractFirstName(name);

  // Check if name is explicitly neutral/ambiguous
  if (NEUTRAL_NAMES.has(firstName)) {
    return { gender: 'neutral', confidence: 0.6, reason: 'neutral_name' };
  }

  // Check against name databases (high confidence)
  const nameResult = checkNameDatabases(firstName);
  if (nameResult.confidence >= 0.8) {
    return nameResult;
  }

  // Check name ending patterns (medium confidence)
  const endingResult = checkNameEndings(firstName);
  if (endingResult.confidence >= 0.6) {
    return endingResult;
  }

  // Check description keywords (lower confidence)
  const keywordResult = checkKeywords(fullText);
  if (keywordResult.confidence > 0.5) {
    return keywordResult;
  }

  // Default to neutral
  return { gender: 'neutral', confidence: 0.5, reason: 'no_clear_indicators' };
}

/**
 * Extract first name from full name
 */
function extractFirstName(name) {
  // Handle various name formats
  let firstName = name.trim();

  // Remove titles
  firstName = firstName.replace(/^(dr\.|mr\.|mrs\.|ms\.|miss|sir|lady|lord|king|queen|prince|princess)\s+/i, '');

  // Split on space, hyphen, or apostrophe and take first part
  firstName = firstName.split(/[\s\-']/)[0];

  return firstName.toLowerCase();
}

/**
 * Check for explicit pronouns in text
 */
function checkPronouns(text) {
  // Count pronoun occurrences
  const femalePronouns = (text.match(/\b(she|her|hers|herself)\b/g) || []).length;
  const malePronouns = (text.match(/\b(he|him|his|himself)\b/g) || []).length;
  const neutralPronouns = (text.match(/\b(they|them|their|theirs|themselves)\b/g) || []).length;

  const total = femalePronouns + malePronouns + neutralPronouns;

  if (total === 0) {
    return { gender: 'neutral', confidence: 0, reason: 'no_pronouns' };
  }

  // Calculate confidence based on pronoun dominance
  const femaleRatio = femalePronouns / total;
  const maleRatio = malePronouns / total;
  const neutralRatio = neutralPronouns / total;

  if (femaleRatio >= 0.7 && femalePronouns >= 2) {
    return { gender: 'female', confidence: Math.min(0.95, 0.8 + femaleRatio * 0.15), reason: 'female_pronouns' };
  }
  if (maleRatio >= 0.7 && malePronouns >= 2) {
    return { gender: 'male', confidence: Math.min(0.95, 0.8 + maleRatio * 0.15), reason: 'male_pronouns' };
  }
  if (neutralRatio >= 0.7 && neutralPronouns >= 2) {
    return { gender: 'neutral', confidence: Math.min(0.9, 0.7 + neutralRatio * 0.2), reason: 'neutral_pronouns' };
  }

  return { gender: 'neutral', confidence: 0.5, reason: 'mixed_pronouns' };
}

/**
 * Check for gender-indicative role words
 */
function checkRoleWords(text) {
  const words = text.split(/\s+/);

  let femaleScore = 0;
  let maleScore = 0;

  for (const word of words) {
    const cleanWord = word.replace(/[^a-z]/g, '');
    if (FEMALE_ROLE_WORDS.has(cleanWord)) {
      femaleScore += 1;
    }
    if (MALE_ROLE_WORDS.has(cleanWord)) {
      maleScore += 1;
    }
  }

  if (femaleScore > maleScore && femaleScore >= 1) {
    const confidence = Math.min(0.85, 0.6 + (femaleScore - maleScore) * 0.1);
    return { gender: 'female', confidence, reason: 'female_role_words' };
  }
  if (maleScore > femaleScore && maleScore >= 1) {
    const confidence = Math.min(0.85, 0.6 + (maleScore - femaleScore) * 0.1);
    return { gender: 'male', confidence, reason: 'male_role_words' };
  }

  return { gender: 'neutral', confidence: 0, reason: 'no_role_words' };
}

/**
 * Check name against databases
 */
function checkNameDatabases(firstName) {
  // Check all female name sets
  for (const [origin, names] of Object.entries(FEMALE_NAMES)) {
    if (names.has(firstName)) {
      const confidence = origin === 'western' ? 0.92 : 0.88;
      return { gender: 'female', confidence, reason: `female_name_${origin}` };
    }
  }

  // Check all male name sets
  for (const [origin, names] of Object.entries(MALE_NAMES)) {
    if (names.has(firstName)) {
      const confidence = origin === 'western' ? 0.92 : 0.88;
      return { gender: 'male', confidence, reason: `male_name_${origin}` };
    }
  }

  return { gender: 'neutral', confidence: 0, reason: 'name_not_in_database' };
}

/**
 * Check name ending patterns
 */
function checkNameEndings(firstName) {
  // Check female endings
  for (const ending of FEMALE_NAME_ENDINGS) {
    if (firstName.endsWith(ending) && firstName.length > ending.length + 1) {
      return { gender: 'female', confidence: 0.65, reason: `female_ending_${ending}` };
    }
  }

  // Check male endings
  for (const ending of MALE_NAME_ENDINGS) {
    if (firstName.endsWith(ending) && firstName.length > ending.length + 1) {
      return { gender: 'male', confidence: 0.65, reason: `male_ending_${ending}` };
    }
  }

  return { gender: 'neutral', confidence: 0, reason: 'no_ending_match' };
}

/**
 * LLM-based semantic gender analysis from description text
 * Replaces keyword matching with actual semantic understanding
 *
 * Uses GPT-5.2-instant for fast, cheap inference when name/pronoun/role checks fail
 */
let llmGenderCache = new Map();
const LLM_GENDER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function checkKeywordsLLM(text, name = '') {
  if (!text || text.trim().length < 10) {
    return { gender: 'neutral', confidence: 0.5, reason: 'insufficient_text' };
  }

  // Check cache first
  const cacheKey = `${name}:${text.substring(0, 100)}`.toLowerCase();
  const cached = llmGenderCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < LLM_GENDER_CACHE_TTL) {
    return { ...cached.result, reason: cached.result.reason + '_cached' };
  }

  try {
    // Dynamic import to avoid circular dependencies
    const { completion, parseJsonResponse } = await import('../services/openai.js');

    const prompt = `Analyze this character description and determine the likely gender.

CHARACTER NAME: ${name || 'Unknown'}
DESCRIPTION: "${text}"

Based on the description's language, adjectives, and context clues, determine if this character is:
- male
- female
- neutral (ambiguous, non-binary, or unclear)

Return JSON:
{
  "gender": "male" | "female" | "neutral",
  "confidence": 0.5-0.8,
  "reasoning": "brief explanation"
}

IMPORTANT:
- Only return high confidence (0.7+) if description strongly suggests gender
- Default to neutral (0.5) if unclear
- Consider cultural context and avoid stereotypes
- Base analysis on actual descriptive language, not assumptions`;

    const response = await completion({
      model: 'gpt-5.2-instant', // Fast, cheap model for simple classification
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 150
    });

    const result = parseJsonResponse(response);

    if (result && result.gender && ['male', 'female', 'neutral'].includes(result.gender)) {
      const output = {
        gender: result.gender,
        confidence: Math.min(0.75, Math.max(0.5, result.confidence || 0.6)),
        reason: `llm_semantic_analysis: ${result.reasoning || 'analyzed description'}`
      };

      // Cache the result
      llmGenderCache.set(cacheKey, { result: output, timestamp: Date.now() });

      // Cleanup old cache entries periodically
      if (llmGenderCache.size > 100) {
        const now = Date.now();
        for (const [key, value] of llmGenderCache.entries()) {
          if (now - value.timestamp > LLM_GENDER_CACHE_TTL) {
            llmGenderCache.delete(key);
          }
        }
      }

      return output;
    }
  } catch (error) {
    // Log but don't fail - this is a fallback check
    console.warn('[GenderInference] LLM analysis failed, returning neutral:', error.message);
  }

  return { gender: 'neutral', confidence: 0.5, reason: 'llm_analysis_failed' };
}

// Synchronous wrapper that returns neutral if async not awaited
// For backward compatibility with existing sync callers
function checkKeywords(text) {
  // Return neutral synchronously - callers needing LLM should use checkKeywordsLLM
  // This maintains backward compatibility while the async version provides better results
  return { gender: 'neutral', confidence: 0.5, reason: 'sync_fallback_use_async' };
}

/**
 * Batch infer gender for multiple characters
 *
 * @param {Array} characters - Array of { name, description, role } objects
 * @returns {Array} Array with added gender and confidence fields
 */
export function inferGenderBatch(characters) {
  return characters.map(char => ({
    ...char,
    ...inferGender(char.name, {
      description: char.description,
      role: char.role,
      context: char.context
    })
  }));
}

/**
 * Simple gender inference (returns just gender string)
 * For backward compatibility
 */
export function inferGenderSimple(name) {
  const result = inferGender(name);
  return result.gender;
}

/**
 * Get confidence level label
 */
export function getConfidenceLabel(confidence) {
  if (confidence >= 0.9) return 'very_high';
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.65) return 'medium';
  if (confidence >= 0.55) return 'low';
  return 'uncertain';
}

export default {
  inferGender,
  inferGenderBatch,
  inferGenderSimple,
  getConfidenceLabel
};
