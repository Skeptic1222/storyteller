/**
 * Author Styles Constants
 * Static data for author style selection in Configure page
 */

// Provider threshold constants (must match server-side llmProviders.js)
// These define when Venice.ai is used instead of OpenAI for uncensored content
export const PROVIDER_THRESHOLDS = {
  violence: { value: 61, label: 'Venice.ai', icon: '\uD83D\uDD13' },     // Graphic violence
  gore: { value: 61, label: 'Venice.ai', icon: '\uD83D\uDD13' },
  romance: { value: 71, label: 'Venice.ai', icon: '\uD83D\uDD13' },
  adultContent: { value: 50, label: 'Venice.ai', icon: '\uD83D\uDD13' },
  sensuality: { value: 71, label: 'Venice.ai', icon: '\uD83D\uDD13' },
  explicitness: { value: 71, label: 'Venice.ai', icon: '\uD83D\uDD13' },
  scary: { value: 71, label: 'Venice.ai', icon: '\uD83D\uDD13' },        // Intense horror
  language: { value: 51, label: 'Venice.ai', icon: '\uD83D\uDD13' },     // Heavy profanity
  sexualViolence: { value: 1, label: 'Venice.ai', icon: '\u26A0\uFE0F' } // ANY non-zero triggers Venice
  // Note: bleakness is tonal, not explicit content - no Venice threshold needed
};

// Author styles data organized by category
export const AUTHOR_STYLES_BY_CATEGORY = {
  modern: {
    label: 'Modern Style',
    icon: '\u2728',
    authors: [
      { id: 'none', name: 'Modern Storytelling', genres: ['General'], description: 'Clear, accessible contemporary style' }
    ]
  },
  swordAndSorcery: {
    label: 'Sword & Sorcery',
    icon: '\u2694\uFE0F',
    authors: [
      { id: 'howard', name: 'Robert E. Howard', genres: ['Sword & Sorcery', 'Pulp'], description: 'Raw barbaric vitality, savage action' },
      { id: 'moorcock', name: 'Michael Moorcock', genres: ['Sword & Sorcery', 'New Wave'], description: 'Tragic anti-heroes, multiverse scope' },
      { id: 'decamp', name: 'L. Sprague de Camp', genres: ['Sword & Sorcery', 'Historical'], description: 'Scholarly wit, logical magic' },
      { id: 'carter', name: 'Lin Carter', genres: ['Sword & Sorcery', 'Planetary'], description: 'Romantic adventure, exotic worlds' }
    ]
  },
  sciFi: {
    label: 'Science Fiction',
    icon: '\uD83D\uDE80',
    authors: [
      { id: 'asimov', name: 'Isaac Asimov', genres: ['Sci-Fi', 'Mystery'], description: 'Ideas-driven, logical puzzles' },
      { id: 'herbert', name: 'Frank Herbert', genres: ['Sci-Fi', 'Ecological'], description: 'Political intrigue, mythic scope' },
      { id: 'leguin', name: 'Ursula K. Le Guin', genres: ['Sci-Fi', 'Fantasy'], description: 'Anthropological depth, ethical questions' },
      { id: 'clarke', name: 'Arthur C. Clarke', genres: ['Hard SF', 'Transcendent'], description: 'Scientific wonder, cosmic revelation' },
      { id: 'heinlein', name: 'Robert Heinlein', genres: ['Sci-Fi', 'Libertarian'], description: 'Competent heroes, accessible SF' },
      { id: 'bradbury', name: 'Ray Bradbury', genres: ['Sci-Fi', 'Fantasy'], description: 'Poetic nostalgia, dark undercurrents' },
      { id: 'dick', name: 'Philip K. Dick', genres: ['Paranoid SF', 'Metaphysical'], description: 'Reality-questioning, black humor' },
      { id: 'butler', name: 'Octavia Butler', genres: ['Afrofuturism', 'Feminist SF'], description: 'Power dynamics, survival' },
      { id: 'banks', name: 'Iain M. Banks', genres: ['Space Opera', 'Culture'], description: 'Post-scarcity utopia, AI minds' },
      { id: 'vonnegut', name: 'Kurt Vonnegut', genres: ['Satire', 'Sci-Fi'], description: 'Dark humor, absurdist wisdom' },
      { id: 'orwell', name: 'George Orwell', genres: ['Dystopian', 'Political'], description: 'Crystal-clear prose, dark irony' }
    ]
  },
  epicFantasy: {
    label: 'Epic Fantasy',
    icon: '\uD83C\uDFF0',
    authors: [
      { id: 'tolkien', name: 'J.R.R. Tolkien', genres: ['High Fantasy', 'Epic'], description: 'Mythic world-building, formal prose' },
      { id: 'sanderson', name: 'Brandon Sanderson', genres: ['Epic Fantasy', 'Hard Magic'], description: 'Systematic magic, satisfying payoffs' },
      { id: 'martin', name: 'George R.R. Martin', genres: ['Low Fantasy', 'Political'], description: 'Morally gray, shocking consequences' },
      { id: 'jordan', name: 'Robert Jordan', genres: ['Epic Fantasy', 'Chosen One'], description: 'Vast tapestry, detailed world-building' },
      { id: 'rothfuss', name: 'Patrick Rothfuss', genres: ['Literary Fantasy'], description: 'Lyrical prose, unreliable narrator' },
      { id: 'hobb', name: 'Robin Hobb', genres: ['Character Fantasy'], description: 'Emotional depth, bonded companions' },
      { id: 'donaldson', name: 'Stephen Donaldson', genres: ['Dark Fantasy', 'Anti-Hero'], description: 'Tortured anti-heroes, moral anguish' },
      { id: 'gaiman', name: 'Neil Gaiman', genres: ['Urban Fantasy', 'Mythic'], description: 'Mythic resonance, liminal spaces' },
      { id: 'pratchett', name: 'Terry Pratchett', genres: ['Comic Fantasy', 'Satire'], description: 'Satirical wit, humanity beneath humor' },
      { id: 'rowling', name: 'J.K. Rowling', genres: ['Fantasy', 'YA'], description: 'Whimsical magic, mystery plots' }
    ]
  },
  horror: {
    label: 'Horror & Gothic',
    icon: '\uD83D\uDC7B',
    authors: [
      { id: 'lovecraft', name: 'H.P. Lovecraft', genres: ['Cosmic Horror', 'Weird'], description: 'Cosmic dread, forbidden knowledge' },
      { id: 'king', name: 'Stephen King', genres: ['Horror', 'Thriller'], description: 'Small-town dread, relatable characters' },
      { id: 'poe', name: 'Edgar Allan Poe', genres: ['Gothic', 'Mystery'], description: 'Atmospheric dread, unreliable narrators' },
      { id: 'stevenson', name: 'Robert Louis Stevenson', genres: ['Adventure', 'Gothic'], description: 'Brisk adventure, moral duality' }
    ]
  },
  classicLit: {
    label: 'Classic Literature',
    icon: '\uD83D\uDCDA',
    authors: [
      { id: 'shakespeare', name: 'William Shakespeare', genres: ['Drama', 'Tragedy'], description: 'Poetic dialogue, dramatic irony' },
      { id: 'austen', name: 'Jane Austen', genres: ['Romance', 'Social'], description: 'Witty social commentary, elegant prose' },
      { id: 'dickens', name: 'Charles Dickens', genres: ['Literary', 'Social'], description: 'Rich descriptions, memorable characters' },
      { id: 'hemingway', name: 'Ernest Hemingway', genres: ['Literary', 'War'], description: 'Sparse prose, unspoken depths' },
      { id: 'fitzgerald', name: 'F. Scott Fitzgerald', genres: ['Literary', 'Jazz Age'], description: 'Lyrical prose, American Dream' },
      { id: 'dostoevsky', name: 'Fyodor Dostoevsky', genres: ['Psychological'], description: 'Intense psychology, moral debates' },
      { id: 'tolstoy', name: 'Leo Tolstoy', genres: ['Realist', 'Historical'], description: 'Panoramic scope, moral philosophy' },
      { id: 'wilde', name: 'Oscar Wilde', genres: ['Comedy', 'Gothic'], description: 'Razor wit, paradoxical epigrams' },
      { id: 'twain', name: 'Mark Twain', genres: ['Adventure', 'Satire'], description: 'American wit, social commentary' },
      { id: 'dumas', name: 'Alexandre Dumas', genres: ['Adventure', 'Historical'], description: 'Swashbuckling action, loyalty' }
    ]
  },
  mystery: {
    label: 'Mystery & Detective',
    icon: '\uD83D\uDD0D',
    authors: [
      { id: 'christie', name: 'Agatha Christie', genres: ['Mystery', 'Detective'], description: 'Puzzle plots, clever twists' }
    ]
  },
  magicalRealism: {
    label: 'Magical Realism',
    icon: '\uD83E\uDD8B',
    authors: [
      { id: 'marquez', name: 'Gabriel Garcia Marquez', genres: ['Magical Realism'], description: 'Magic as mundane, sweeping sagas' },
      { id: 'kafka', name: 'Franz Kafka', genres: ['Absurdist', 'Existential'], description: 'Surreal bureaucratic nightmares' }
    ]
  },
  modernist: {
    label: 'Modernist',
    icon: '\uD83C\uDFA8',
    authors: [
      { id: 'woolf', name: 'Virginia Woolf', genres: ['Stream of Consciousness'], description: 'Interior consciousness, lyrical prose' },
      { id: 'faulkner', name: 'William Faulkner', genres: ['Southern Gothic'], description: 'Non-linear time, Southern decay' },
      { id: 'nabokov', name: 'Vladimir Nabokov', genres: ['Literary', 'Metafiction'], description: 'Elaborate wordplay, aesthetic pattern' },
      { id: 'salinger', name: 'J.D. Salinger', genres: ['Coming-of-Age'], description: 'Intimate voice, adolescent alienation' }
    ]
  },
  epic: {
    label: 'Epic & Mythic',
    icon: '\u26A1',
    authors: [
      { id: 'homer', name: 'Homer', genres: ['Epic Poetry', 'Mythic'], description: 'Oral epic tradition, gods and heroes' },
      { id: 'steinbeck', name: 'John Steinbeck', genres: ['Social Realism', 'Epic'], description: 'Earthy compassion, poetic naturalism' }
    ]
  }
};

// Flat list for backward compatibility
export const AUTHOR_STYLES = Object.values(AUTHOR_STYLES_BY_CATEGORY).flatMap(cat => cat.authors);

/**
 * Map of author IDs to display names (for Story.jsx and other display contexts)
 * @example AUTHOR_NAMES['tolkien'] // 'J.R.R. Tolkien'
 */
export const AUTHOR_NAMES = AUTHOR_STYLES.reduce((acc, author) => {
  acc[author.id] = author.name;
  return acc;
}, { modern: 'Modern Style' });

/**
 * Find author by ID
 * @param {string} authorId - Author ID to find
 * @returns {Object|undefined} Author object or undefined
 */
export function findAuthorById(authorId) {
  return AUTHOR_STYLES.find(a => a.id === authorId);
}

/**
 * Get category for an author
 * @param {string} authorId - Author ID
 * @returns {Object|null} Category object with label and icon, or null
 */
export function getAuthorCategory(authorId) {
  for (const [key, category] of Object.entries(AUTHOR_STYLES_BY_CATEGORY)) {
    if (category.authors.some(a => a.id === authorId)) {
      return { key, ...category };
    }
  }
  return null;
}
