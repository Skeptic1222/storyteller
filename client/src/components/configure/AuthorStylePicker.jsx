/**
 * AuthorStylePicker Component
 * Author writing style selection with category-based browsing
 */
import { memo, useState } from 'react';
import { Feather, ChevronDown, ChevronUp } from 'lucide-react';
import {
  AUTHOR_STYLES_BY_CATEGORY,
  AUTHOR_STYLES
} from '../../constants/authorStyles';

// Popular author quick picks
const POPULAR_AUTHORS = [
  { id: 'tolkien', name: 'J.R.R. Tolkien', cat: '🏰' },
  { id: 'king', name: 'Stephen King', cat: '👻' },
  { id: 'howard', name: 'Robert E. Howard', cat: '⚔️' },
  { id: 'asimov', name: 'Isaac Asimov', cat: '🚀' },
  { id: 'sanderson', name: 'Brandon Sanderson', cat: '🏰' },
  { id: 'lovecraft', name: 'H.P. Lovecraft', cat: '👻' },
  { id: 'gaiman', name: 'Neil Gaiman', cat: '🏰' },
  { id: 'leguin', name: 'Ursula K. Le Guin', cat: '🚀' }
];

const AuthorStylePicker = memo(function AuthorStylePicker({
  selectedStyle,
  onStyleChange,
  isAnimating = false,
  autoSelectToggle = null
}) {
  const [showAllAuthors, setShowAllAuthors] = useState(false);

  const selectedAuthor = AUTHOR_STYLES.find(a => a.id === selectedStyle);

  return (
    <section className={`bg-gradient-to-br from-night-800/50 to-night-900/50 rounded-2xl p-4 border transition-all duration-500 ${isAnimating ? 'border-golden-400 ring-2 ring-golden-400/30' : 'border-night-700'}`}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-medium text-night-100 flex items-center gap-2">
          <Feather className="w-5 h-5 text-golden-400" />
          Writing Style
        </h2>
        {autoSelectToggle}
      </div>
      <p className="text-night-400 text-sm mb-4">
        Choose an author's distinctive voice, or use modern storytelling
      </p>

      {/* Currently selected */}
      {selectedStyle && selectedStyle !== 'none' && selectedAuthor && (
        <div className="mb-4 p-3 bg-golden-400/10 rounded-xl border border-golden-400/30">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-golden-400 font-medium">
                {selectedAuthor.name}
              </span>
              <p className="text-night-400 text-xs mt-0.5">
                {selectedAuthor.description}
              </p>
            </div>
            <button
              onClick={() => onStyleChange('none')}
              className="text-night-400 hover:text-night-200 text-xs px-2 py-1 bg-night-700 rounded"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Modern/No Style option - always visible */}
      <button
        onClick={() => onStyleChange('none')}
        className={`w-full p-3 rounded-xl border-2 transition-all text-left mb-4 ${
          selectedStyle === 'none' || !selectedStyle
            ? 'border-golden-400 bg-night-800'
            : 'border-night-700 bg-night-800/50 hover:border-night-500'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">✨</span>
          <div>
            <div className="text-night-100 text-sm font-medium">Modern Storytelling</div>
            <div className="text-night-500 text-xs">Clear, accessible contemporary style</div>
          </div>
        </div>
      </button>

      {/* Category-based author selection */}
      {showAllAuthors ? (
        <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
          {Object.entries(AUTHOR_STYLES_BY_CATEGORY).filter(([key]) => key !== 'modern').map(([categoryKey, category]) => (
            <div key={categoryKey}>
              <h3 className="text-night-300 text-sm font-medium mb-2 flex items-center gap-2 sticky top-0 bg-night-900/90 py-1">
                <span>{category.icon}</span>
                {category.label}
                <span className="text-night-500 text-xs">({category.authors.length})</span>
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {category.authors.map(author => (
                  <button
                    key={author.id}
                    onClick={() => onStyleChange(author.id)}
                    className={`p-2.5 rounded-lg border-2 transition-all text-left ${
                      selectedStyle === author.id
                        ? 'border-golden-400 bg-night-800'
                        : 'border-night-700 bg-night-800/50 hover:border-night-500'
                    }`}
                  >
                    <div className="text-night-100 text-xs font-medium truncate">{author.name}</div>
                    <div className="text-night-500 text-[10px] truncate">{author.description}</div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* Quick picks - popular authors from different categories */
        <div className="space-y-3">
          <p className="text-night-500 text-xs">Popular choices:</p>
          <div className="grid grid-cols-2 gap-2">
            {POPULAR_AUTHORS.map(author => (
              <button
                key={author.id}
                onClick={() => onStyleChange(author.id)}
                className={`p-2.5 rounded-lg border-2 transition-all text-left ${
                  selectedStyle === author.id
                    ? 'border-golden-400 bg-night-800'
                    : 'border-night-700 bg-night-800/50 hover:border-night-500'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{author.cat}</span>
                  <span className="text-night-100 text-xs font-medium truncate">{author.name}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Show more/less button */}
      <button
        onClick={() => setShowAllAuthors(!showAllAuthors)}
        className="w-full mt-4 py-2.5 text-golden-400 hover:text-golden-300 text-sm flex items-center justify-center gap-1 transition-colors bg-night-800/50 rounded-lg border border-night-700"
      >
        {showAllAuthors ? (
          <>Show less <ChevronUp className="w-4 h-4" /></>
        ) : (
          <>Browse all {AUTHOR_STYLES.length} authors by category <ChevronDown className="w-4 h-4" /></>
        )}
      </button>

      {/* Category legend when collapsed */}
      {!showAllAuthors && (
        <div className="mt-3 flex flex-wrap gap-2 justify-center">
          {Object.entries(AUTHOR_STYLES_BY_CATEGORY).filter(([key]) => key !== 'modern').slice(0, 5).map(([key, cat]) => (
            <span key={key} className="text-night-500 text-xs flex items-center gap-1">
              <span>{cat.icon}</span>
              {cat.label}
            </span>
          ))}
          <span className="text-night-600 text-xs">& more...</span>
        </div>
      )}
    </section>
  );
});

export default AuthorStylePicker;
