/**
 * StoryInfoPanel Component
 * Displays story details including synopsis, setting, characters, themes, and progress.
 * Extracted from Story.jsx for maintainability.
 */

import { BookOpen, Info, MapPin, Users, Feather, Palette, Bookmark } from 'lucide-react';

function StoryInfoPanel({
  isOpen,
  config,
  storyOutline,
  characters,
  authorStyleName,
  session,
  currentScene,
  isCyoaEnabled,
  choiceHistory
}) {
  if (!isOpen) return null;

  return (
    <div
      role="region"
      aria-label="Story details panel"
      className="bg-slate-800/95 border-b border-blue-500/30 p-4 max-h-96 overflow-y-auto"
    >
      <h3 className="text-blue-400 font-medium flex items-center gap-2 mb-3">
        <BookOpen className="w-4 h-4" />
        Story Details
      </h3>

      <div className="space-y-4 text-sm">
        {/* Story Type & Format */}
        <div className="flex flex-wrap gap-2 pb-3 border-b border-slate-700">
          {config.story_type && (
            <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
              config.story_type === 'cyoa' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' :
              'bg-slate-700 text-slate-300'
            }`}>
              {config.story_type === 'cyoa' ? 'Choose Your Own Adventure' : config.story_type}
            </span>
          )}
          {config.story_length && (
            <span className="px-2 py-1 rounded-lg text-xs bg-slate-700 text-slate-300">
              {config.story_length.charAt(0).toUpperCase() + config.story_length.slice(1)} Story
            </span>
          )}
          {config.genre && (
            <span className="px-2 py-1 rounded-lg text-xs bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              {config.genre}
            </span>
          )}
        </div>

        {storyOutline?.synopsis && (
          <div>
            <div className="flex items-center gap-1 text-slate-400 mb-1">
              <Info className="w-3 h-3" />
              <span>Synopsis</span>
            </div>
            <p className="text-slate-200">{storyOutline.synopsis}</p>
          </div>
        )}

        {storyOutline?.setting && (
          <div>
            <div className="flex items-center gap-1 text-slate-400 mb-1">
              <MapPin className="w-3 h-3" />
              <span>Setting</span>
            </div>
            <p className="text-slate-200">
              {typeof storyOutline.setting === 'object'
                ? storyOutline.setting.description || storyOutline.setting.location
                : storyOutline.setting}
            </p>
          </div>
        )}

        {characters.length > 0 && (
          <div>
            <div className="flex items-center gap-1 text-slate-400 mb-1">
              <Users className="w-3 h-3" />
              <span>Characters ({characters.length})</span>
            </div>
            <div className="space-y-1">
              {characters.slice(0, 5).map((char, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-slate-200 font-medium">{char.name}</span>
                  {char.role && <span className="text-slate-500">({char.role})</span>}
                </div>
              ))}
              {characters.length > 5 && (
                <span className="text-slate-500 text-xs">+{characters.length - 5} more</span>
              )}
            </div>
          </div>
        )}

        {authorStyleName && (
          <div>
            <div className="flex items-center gap-1 text-slate-400 mb-1">
              <Feather className="w-3 h-3" />
              <span>Author Style</span>
            </div>
            <p className="text-purple-300">{authorStyleName}</p>
          </div>
        )}

        {config.narrator_style && (
          <div>
            <div className="flex items-center gap-1 text-slate-400 mb-1">
              <Palette className="w-3 h-3" />
              <span>Narration Tone</span>
            </div>
            <p className="text-cyan-300">{config.narrator_style.charAt(0).toUpperCase() + config.narrator_style.slice(1)}</p>
          </div>
        )}

        {storyOutline?.themes?.length > 0 && (
          <div>
            <div className="flex items-center gap-1 text-slate-400 mb-1">
              <Bookmark className="w-3 h-3" />
              <span>Themes</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {storyOutline.themes.map((theme, i) => (
                <span key={i} className="px-2 py-0.5 bg-slate-700 rounded-full text-slate-300 text-xs">
                  {theme}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Story progress info */}
        {session && (
          <div className="pt-3 border-t border-slate-700">
            <div className="flex items-center gap-1 text-slate-400 mb-1">
              <Info className="w-3 h-3" />
              <span>Progress</span>
            </div>
            <p className="text-slate-300">
              {isCyoaEnabled
                ? `Chapter ${(currentScene?.scene_index ?? 0) + 1} | ${choiceHistory.length} choices made`
                : `Scene ${(currentScene?.scene_index ?? 0) + 1}${session.estimated_scenes ? ` of ~${session.estimated_scenes}` : ''}`
              }
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default StoryInfoPanel;
