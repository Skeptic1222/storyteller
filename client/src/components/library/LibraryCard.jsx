/**
 * LibraryCard - Story card component with Grid/List/Gallery view modes
 *
 * Renders story information in different layouts based on viewMode prop.
 * Extracts badge logic to sub-components for cleaner code.
 */

import { useState } from 'react';
import {
  BookOpen,
  ScrollText,
  Star,
  Bookmark,
  Trash2,
  Download,
  CheckCircle,
  PauseCircle,
  PlayCircle,
  Circle,
  GitBranch
} from 'lucide-react';
import GenreBadge from './GenreBadge';
import ContentRatingBadge from './ContentRatingBadge';

// Content categories
const CATEGORIES = {
  all: { label: 'All', color: '#6A8A82' },
  story: { label: 'Stories', icon: BookOpen, color: '#FF6F61' },
  story_bible: { label: 'Story Bible', icon: ScrollText, color: '#C0C0C0' },
  dnd: { label: 'Campaign', color: '#a855f7' }
};

// Get category for a story based on its mode/type
function getStoryCategory(story) {
  if (story.mode === 'dnd' || story.mode === 'campaign') return 'dnd';
  if (story.mode === 'story_bible' || story.story_bible_id) return 'story_bible';
  return 'story';
}

// Get icon for story based on category
function getStoryIcon(story) {
  const cat = getStoryCategory(story);
  if (story.cover_image_url) return null;
  return CATEGORIES[cat]?.icon || BookOpen;
}

// Status icon mapping
function getStatusIcon(status) {
  switch (status) {
    case 'finished': return CheckCircle;
    case 'paused': return PauseCircle;
    case 'narrating': return PlayCircle;
    case 'waiting_choice': return GitBranch;
    default: return Circle;
  }
}

function getStatusColor(status, colors) {
  switch (status) {
    case 'finished': return '#22c55e';
    case 'paused': return '#eab308';
    case 'narrating': return '#3b82f6';
    case 'waiting_choice': return '#a855f7';
    default: return colors.textMuted;
  }
}

// Format date relative to now
function formatDate(dateStr) {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return date.toLocaleDateString();
}

export default function LibraryCard({
  story,
  viewMode,
  colors,
  onStoryClick,
  onFavorite,
  onExport,
  onDelete
}) {
  const [isHovered, setIsHovered] = useState(false);
  const storyCategory = getStoryCategory(story);
  const categoryColor = CATEGORIES[storyCategory]?.color || colors.accent;
  const StatusIcon = getStatusIcon(story.current_status);

  // Common props for all view modes
  const commonProps = {
    story,
    colors,
    storyCategory,
    categoryColor,
    StatusIcon,
    onStoryClick,
    onFavorite,
    onExport,
    onDelete,
    isHovered,
    setIsHovered
  };

  // Render based on view mode
  switch (viewMode) {
    case 'list':
      return <ListCard {...commonProps} />;
    case 'gallery':
      return <GalleryCard {...commonProps} />;
    default:
      return <GridCard {...commonProps} />;
  }
}

/**
 * Grid View Card (Enhanced Default)
 * Full-featured card with cover, synopsis, badges, and controls
 */
function GridCard({
  story,
  colors,
  storyCategory,
  categoryColor,
  StatusIcon,
  onStoryClick,
  onFavorite,
  onExport,
  onDelete,
  isHovered,
  setIsHovered
}) {
  const Icon = getStoryIcon(story);

  return (
    <div
      className="library-card library-card--grid"
      onClick={() => onStoryClick(story)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        background: colors.card,
        borderRadius: '12px',
        padding: '16px',
        cursor: 'pointer',
        transition: 'transform 0.2s, box-shadow 0.2s',
        border: `1px solid ${colors.border}`,
        position: 'relative',
        transform: isHovered ? 'translateY(-4px)' : 'translateY(0)',
        boxShadow: isHovered ? '0 10px 30px rgba(0,0,0,0.3)' : 'none'
      }}
    >
      {/* Top badges row */}
      <div style={{
        position: 'absolute',
        top: '12px',
        right: '12px',
        display: 'flex',
        gap: '6px',
        alignItems: 'center',
        zIndex: 2
      }}>
        <ContentRatingBadge configJson={story.config_json} size="small" />
        <span style={{ color: getStatusColor(story.current_status, colors), display: 'flex' }}>
          <StatusIcon size={16} />
        </span>
      </div>

      {/* Cover image - increased height */}
      <div style={{
        height: '160px',
        background: story.cover_image_url
          ? `url(${story.cover_image_url}) center/cover`
          : `linear-gradient(135deg, ${categoryColor}33, ${categoryColor}11)`,
        borderRadius: '8px',
        marginBottom: '12px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative'
      }}>
        {!story.cover_image_url && Icon && (
          <Icon size={40} color={categoryColor} />
        )}
      </div>

      {/* Title */}
      <h3 style={{
        margin: '0 0 6px 0',
        fontSize: '16px',
        fontWeight: '600',
        color: colors.text,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}>
        {story.title || 'Untitled Story'}
      </h3>

      {/* Synopsis - expands on hover */}
      <p style={{
        fontSize: '13px',
        color: colors.textMuted,
        margin: '0 0 10px 0',
        lineHeight: '1.4',
        display: '-webkit-box',
        WebkitLineClamp: isHovered ? 6 : 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
        minHeight: '36px',
        maxHeight: isHovered ? '120px' : '36px',
        transition: 'max-height 0.3s ease, -webkit-line-clamp 0.3s ease'
      }}>
        {story.synopsis || story.first_scene_preview?.substring(0, 100) || 'No synopsis available'}
      </p>

      {/* Genre badges - show all on hover, otherwise max 4 */}
      {story.themes && story.themes.length > 0 && (
        <div style={{
          display: 'flex',
          gap: '4px',
          marginBottom: '10px',
          flexWrap: 'wrap',
          maxHeight: isHovered ? '88px' : '44px',
          overflow: 'hidden',
          transition: 'max-height 0.3s ease'
        }}>
          {(isHovered ? story.themes : story.themes.slice(0, 4)).map((theme, i) => (
            <GenreBadge key={i} genre={theme} size="small" />
          ))}
          {!isHovered && story.themes.length > 4 && (
            <span style={{
              fontSize: '10px',
              color: colors.textMuted,
              padding: '2px 6px'
            }}>
              +{story.themes.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Progress bar */}
      <div style={{
        background: colors.border,
        borderRadius: '4px',
        height: '4px',
        marginBottom: '10px',
        overflow: 'hidden'
      }}>
        <div style={{
          background: colors.accent,
          height: '100%',
          width: `${story.progress_percent || 0}%`,
          borderRadius: '4px',
          transition: 'width 0.3s'
        }} />
      </div>

      {/* Footer with meta and actions */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <span style={{ fontSize: '11px', color: colors.textMuted }}>
          {story.total_scenes || 0} scenes | {formatDate(story.last_activity_at || story.started_at)}
        </span>

        <div style={{ display: 'flex', gap: '6px' }}>
          <ActionButton
            icon={Star}
            onClick={(e) => onFavorite(story.id, e)}
            active={story.is_favorite}
            activeColor="#FF6F61"
            colors={colors}
            label={story.is_favorite ? 'Remove favorite' : 'Add favorite'}
          />
          {story.bookmark_count > 0 && (
            <span style={{
              fontSize: '11px',
              color: colors.textMuted,
              display: 'flex',
              alignItems: 'center',
              gap: '2px'
            }}>
              <Bookmark size={12} />
              {story.bookmark_count}
            </span>
          )}
          {(story.recording_id || story.current_recording_id) && (
            <ActionButton
              icon={Download}
              onClick={(e) => onExport(story.id, e)}
              colors={colors}
              label="Export"
              color={colors.accent}
            />
          )}
          <ActionButton
            icon={Trash2}
            onClick={(e) => onDelete(story.id, e)}
            colors={colors}
            label="Delete"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * List View Card
 * Horizontal compact layout for information-dense viewing
 */
function ListCard({
  story,
  colors,
  storyCategory,
  categoryColor,
  StatusIcon,
  onStoryClick,
  onFavorite,
  onExport,
  onDelete,
  isHovered,
  setIsHovered
}) {
  const Icon = getStoryIcon(story);

  return (
    <div
      className="library-card library-card--list"
      onClick={() => onStoryClick(story)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        background: colors.card,
        borderRadius: '10px',
        padding: '12px 16px',
        cursor: 'pointer',
        transition: 'background 0.15s',
        border: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        backgroundColor: isHovered ? `${colors.accent}11` : colors.card
      }}
    >
      {/* Cover thumbnail */}
      <div style={{
        width: '60px',
        height: '84px',
        flexShrink: 0,
        background: story.cover_image_url
          ? `url(${story.cover_image_url}) center/cover`
          : `linear-gradient(135deg, ${categoryColor}33, ${categoryColor}11)`,
        borderRadius: '6px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        {!story.cover_image_url && Icon && (
          <Icon size={24} color={categoryColor} />
        )}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
          <h3 style={{
            margin: 0,
            fontSize: '15px',
            fontWeight: '600',
            color: colors.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {story.title || 'Untitled Story'}
          </h3>
          <ContentRatingBadge configJson={story.config_json} size="small" />
        </div>

        {/* Synopsis - single line */}
        <p style={{
          fontSize: '12px',
          color: colors.textMuted,
          margin: '0 0 6px 0',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {story.synopsis || story.first_scene_preview?.substring(0, 100) || 'No synopsis'}
        </p>

        {/* Genre badges - inline */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {story.themes?.slice(0, 3).map((theme, i) => (
            <GenreBadge key={i} genre={theme} size="small" />
          ))}
          {story.themes?.length > 3 && (
            <span style={{ fontSize: '10px', color: colors.textMuted }}>
              +{story.themes.length - 3}
            </span>
          )}
        </div>
      </div>

      {/* Right side - progress and actions */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        flexShrink: 0
      }}>
        {/* Progress */}
        <div style={{ textAlign: 'right', minWidth: '60px' }}>
          <div style={{
            fontSize: '14px',
            fontWeight: '600',
            color: colors.text
          }}>
            {story.progress_percent || 0}%
          </div>
          <div style={{ fontSize: '10px', color: colors.textMuted }}>
            {formatDate(story.last_activity_at || story.started_at)}
          </div>
        </div>

        {/* Status */}
        <span style={{ color: getStatusColor(story.current_status, colors), display: 'flex' }}>
          <StatusIcon size={18} />
        </span>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <ActionButton
            icon={Star}
            onClick={(e) => onFavorite(story.id, e)}
            active={story.is_favorite}
            activeColor="#FF6F61"
            colors={colors}
            size={16}
            label="Favorite"
          />
          {(story.recording_id || story.current_recording_id) && (
            <ActionButton
              icon={Download}
              onClick={(e) => onExport(story.id, e)}
              colors={colors}
              size={16}
              label="Export"
              color={colors.accent}
            />
          )}
          <ActionButton
            icon={Trash2}
            onClick={(e) => onDelete(story.id, e)}
            colors={colors}
            size={16}
            label="Delete"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Gallery View Card
 * Cover-dominant layout with hover overlay for details
 */
function GalleryCard({
  story,
  colors,
  storyCategory,
  categoryColor,
  StatusIcon,
  onStoryClick,
  onFavorite,
  onExport,
  onDelete,
  isHovered,
  setIsHovered
}) {
  const Icon = getStoryIcon(story);

  return (
    <div
      className="library-card library-card--gallery"
      onClick={() => onStoryClick(story)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        position: 'relative',
        borderRadius: '12px',
        overflow: 'hidden',
        cursor: 'pointer',
        aspectRatio: '2/3',
        background: story.cover_image_url
          ? `url(${story.cover_image_url}) center/cover`
          : `linear-gradient(135deg, ${categoryColor}44, ${categoryColor}11)`,
        border: `1px solid ${colors.border}`,
        transition: 'transform 0.2s, box-shadow 0.2s',
        transform: isHovered ? 'scale(1.02)' : 'scale(1)',
        boxShadow: isHovered ? '0 10px 30px rgba(0,0,0,0.4)' : '0 2px 8px rgba(0,0,0,0.2)'
      }}
    >
      {/* Default icon if no cover */}
      {!story.cover_image_url && Icon && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          opacity: 0.5
        }}>
          <Icon size={48} color={categoryColor} />
        </div>
      )}

      {/* Content rating badge (always visible, top-right) */}
      <div style={{
        position: 'absolute',
        top: '10px',
        right: '10px',
        zIndex: 3
      }}>
        <ContentRatingBadge configJson={story.config_json} size="small" />
      </div>

      {/* Favorite star (always visible, top-left) */}
      {story.is_favorite && (
        <div style={{
          position: 'absolute',
          top: '10px',
          left: '10px',
          zIndex: 3,
          color: '#FF6F61'
        }}>
          <Star size={18} fill="#FF6F61" />
        </div>
      )}

      {/* Bottom title bar (always visible) */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '40px 12px 12px 12px',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
        zIndex: 2
      }}>
        <h3 style={{
          margin: 0,
          fontSize: '14px',
          fontWeight: '600',
          color: 'white',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {story.title || 'Untitled Story'}
        </h3>
        <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', marginTop: '2px' }}>
          {story.progress_percent || 0}% | {story.total_scenes || 0} scenes
        </div>
      </div>

      {/* Hover overlay with details */}
      <div style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(0,0,0,0.85)',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        opacity: isHovered ? 1 : 0,
        transition: 'opacity 0.2s',
        zIndex: 4,
        pointerEvents: isHovered ? 'auto' : 'none'
      }}>
        <h3 style={{
          margin: '0 0 8px 0',
          fontSize: '15px',
          fontWeight: '600',
          color: 'white'
        }}>
          {story.title || 'Untitled Story'}
        </h3>

        {/* Synopsis */}
        <p style={{
          fontSize: '12px',
          color: 'rgba(255,255,255,0.8)',
          margin: '0 0 12px 0',
          lineHeight: '1.4',
          flex: 1,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 4,
          WebkitBoxOrient: 'vertical'
        }}>
          {story.synopsis || story.first_scene_preview || 'No synopsis available'}
        </p>

        {/* Genre badges - show all in hover overlay */}
        {story.themes && story.themes.length > 0 && (
          <div style={{
            display: 'flex',
            gap: '4px',
            marginBottom: '12px',
            flexWrap: 'wrap',
            maxHeight: '60px',
            overflow: 'auto'
          }}>
            {story.themes.map((theme, i) => (
              <GenreBadge key={i} genre={theme} size="small" />
            ))}
          </div>
        )}

        {/* Progress bar */}
        <div style={{
          background: 'rgba(255,255,255,0.2)',
          borderRadius: '4px',
          height: '4px',
          marginBottom: '8px',
          overflow: 'hidden'
        }}>
          <div style={{
            background: colors.accent,
            height: '100%',
            width: `${story.progress_percent || 0}%`,
            borderRadius: '4px'
          }} />
        </div>

        {/* Actions */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.6)' }}>
            {formatDate(story.last_activity_at || story.started_at)}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <ActionButton
              icon={Star}
              onClick={(e) => onFavorite(story.id, e)}
              active={story.is_favorite}
              activeColor="#FF6F61"
              colors={{ textMuted: 'rgba(255,255,255,0.6)' }}
              label="Favorite"
            />
            {(story.recording_id || story.current_recording_id) && (
              <ActionButton
                icon={Download}
                onClick={(e) => onExport(story.id, e)}
                colors={{ textMuted: 'rgba(255,255,255,0.6)' }}
                color={colors.accent}
                label="Export"
              />
            )}
            <ActionButton
              icon={Trash2}
              onClick={(e) => onDelete(story.id, e)}
              colors={{ textMuted: 'rgba(255,255,255,0.6)' }}
              label="Delete"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Reusable action button for card footers
 */
function ActionButton({
  icon: Icon,
  onClick,
  active,
  activeColor,
  color,
  colors,
  size = 16,
  label
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        color: active ? activeColor : (color || colors.textMuted),
        cursor: 'pointer',
        padding: '10px',
        minWidth: '44px',
        minHeight: '44px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: active ? 1 : 0.7,
        transition: 'opacity 0.15s, background 0.15s',
        borderRadius: '8px',
        margin: '-6px'
      }}
      className="hover:bg-white/10"
      aria-label={label}
    >
      <Icon size={size} fill={active ? activeColor : 'none'} />
    </button>
  );
}
