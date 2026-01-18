/**
 * ActivityFeed Component
 * Auto-scrolling log showing real-time AI operations.
 *
 * Features:
 * - Newest at top (reverse chronological)
 * - Active item has pulsing dot indicator
 * - Success items have green checkmark
 * - Timestamps in local time
 * - Max 8 visible items, expandable for full history
 */

import { memo, useState, useEffect, useRef } from 'react';
import { Check, Circle, AlertCircle, ChevronDown } from 'lucide-react';

const STATUS_CONFIG = {
  success: {
    icon: Check,
    iconClass: 'text-emerald-400',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/20'
  },
  active: {
    icon: Circle,
    iconClass: 'text-golden-400 animate-pulse',
    bgClass: 'bg-golden-500/10',
    borderClass: 'border-golden-500/20'
  },
  error: {
    icon: AlertCircle,
    iconClass: 'text-red-400',
    bgClass: 'bg-red-500/10',
    borderClass: 'border-red-500/20'
  },
  info: {
    icon: Circle,
    iconClass: 'text-slate-500',
    bgClass: 'bg-slate-500/5',
    borderClass: 'border-slate-500/10'
  }
};

const ActivityItem = memo(function ActivityItem({ item, isLatest }) {
  const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.info;
  const StatusIcon = config.icon;

  // Format timestamp to local time
  const formatTime = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  return (
    <div
      className={`
        flex items-start gap-2 px-2 py-1.5 rounded-md text-xs
        transition-all duration-300 border
        ${config.bgClass} ${config.borderClass}
        ${isLatest ? 'animate-slide-in' : ''}
      `}
    >
      {/* Status indicator */}
      <div className="flex-shrink-0 mt-0.5">
        <StatusIcon className={`w-3 h-3 ${config.iconClass}`} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <span className="text-slate-300 break-words">{item.message}</span>
      </div>

      {/* Timestamp */}
      <span className="flex-shrink-0 text-slate-500 font-mono text-[10px]">
        {formatTime(item.timestamp)}
      </span>
    </div>
  );
});

const ActivityFeed = memo(function ActivityFeed({
  items = [],
  maxVisible = 6,
  className = ''
}) {
  const [expanded, setExpanded] = useState(false);
  const feedRef = useRef(null);

  // Auto-scroll to top when new items arrive
  useEffect(() => {
    if (feedRef.current && items.length > 0) {
      feedRef.current.scrollTop = 0;
    }
  }, [items.length]);

  // Display items (reversed so newest is first)
  const displayItems = expanded ? items : items.slice(0, maxVisible);
  const hasMore = items.length > maxVisible;

  return (
    <div className={`flex flex-col ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-slate-700/50">
        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">
          Live Activity
        </span>
        {items.length > 0 && (
          <span className="text-[10px] text-slate-500">
            {items.length} event{items.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Feed content */}
      <div
        ref={feedRef}
        className={`
          flex flex-col gap-1 p-2 overflow-y-auto
          ${expanded ? 'max-h-64' : 'max-h-40'}
        `}
        style={{ scrollBehavior: 'smooth' }}
      >
        {displayItems.length === 0 ? (
          <div className="text-center text-slate-500 text-xs py-4">
            Waiting for activity...
          </div>
        ) : (
          displayItems.map((item, index) => (
            <ActivityItem
              key={item.id || `${item.timestamp}-${index}`}
              item={item}
              isLatest={index === 0}
            />
          ))
        )}
      </div>

      {/* Expand/Collapse button */}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center justify-center gap-1 py-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors border-t border-slate-700/50"
        >
          <span>{expanded ? 'Show less' : `Show ${items.length - maxVisible} more`}</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </button>
      )}
    </div>
  );
});

export default ActivityFeed;
