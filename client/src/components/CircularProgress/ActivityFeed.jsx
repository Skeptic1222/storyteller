/**
 * ActivityFeed Component
 * Scrolling log of detailed activity during generation
 *
 * Shows real-time what's happening "under the hood" like an installer:
 * - Agent names and actions
 * - ElevenLabs synthesis progress
 * - OpenAI API calls
 * - File operations
 */

import { memo, useEffect, useRef, useMemo } from 'react';
import { Activity, Mic, MessageSquare, Image, Shield, Music, Sparkles } from 'lucide-react';

const CATEGORY_CONFIG = {
  story: { icon: MessageSquare, color: 'text-amber-400', label: 'Story' },
  voice: { icon: Mic, color: 'text-purple-400', label: 'Voice' },
  audio: { icon: Activity, color: 'text-emerald-400', label: 'Audio' },
  image: { icon: Image, color: 'text-cyan-400', label: 'Image' },
  sfx: { icon: Music, color: 'text-blue-400', label: 'SFX' },
  safety: { icon: Shield, color: 'text-rose-400', label: 'Safety' },
  default: { icon: Sparkles, color: 'text-slate-400', label: 'System' }
};

const ActivityLogEntry = memo(function ActivityLogEntry({ entry, isLatest }) {
  const config = CATEGORY_CONFIG[entry.category] || CATEGORY_CONFIG.default;
  const Icon = config.icon;

  // Format timestamp as HH:MM:SS
  const timeFormatted = useMemo(() => {
    const date = new Date(entry.timestamp);
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }, [entry.timestamp]);

  return (
    <div
      className={`
        flex items-start gap-2 py-1.5 px-2 text-xs
        ${isLatest ? 'bg-slate-700/50 rounded' : ''}
        transition-colors duration-300
      `}
    >
      {/* Timestamp */}
      <span className="text-slate-500 font-mono shrink-0 w-16">
        {timeFormatted}
      </span>

      {/* Category icon */}
      <Icon className={`${config.color} w-3.5 h-3.5 shrink-0 mt-0.5`} />

      {/* Message */}
      <span className={`${isLatest ? 'text-slate-200' : 'text-slate-400'} break-words`}>
        {entry.message}
      </span>
    </div>
  );
});

const ActivityFeed = memo(function ActivityFeed({
  logs = [],
  maxVisible = 8,
  autoScroll = true
}) {
  const containerRef = useRef(null);
  const endRef = useRef(null);

  // Auto-scroll to bottom when new entries arrive
  useEffect(() => {
    if (autoScroll && endRef.current) {
      endRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [logs.length, autoScroll]);

  // Get the most recent logs
  const visibleLogs = useMemo(() => {
    return logs.slice(-maxVisible);
  }, [logs, maxVisible]);

  if (logs.length === 0) {
    return (
      <div className="flex items-center justify-center py-4 text-slate-500 text-sm">
        <Activity className="w-4 h-4 mr-2 animate-pulse" />
        Waiting for activity...
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 rounded-lg border border-slate-700/50">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/50">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Activity className="w-3.5 h-3.5" />
          <span className="font-medium uppercase tracking-wider">Activity Log</span>
        </div>
        <span className="text-xs text-slate-500">
          {logs.length} events
        </span>
      </div>

      {/* Log entries */}
      <div
        ref={containerRef}
        className="overflow-y-auto"
        style={{ maxHeight: `${maxVisible * 32}px` }}
      >
        {visibleLogs.map((entry, index) => (
          <ActivityLogEntry
            key={entry.timestamp + index}
            entry={entry}
            isLatest={index === visibleLogs.length - 1}
          />
        ))}
        <div ref={endRef} />
      </div>

      {/* Overflow indicator */}
      {logs.length > maxVisible && (
        <div className="px-3 py-1 text-xs text-slate-500 border-t border-slate-700/50 text-center">
          {logs.length - maxVisible} earlier events hidden
        </div>
      )}
    </div>
  );
});

export default ActivityFeed;
