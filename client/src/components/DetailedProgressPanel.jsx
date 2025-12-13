/**
 * DetailedProgressPanel Component
 * Displays detailed technical progress information during story generation.
 * Shows real-time logs from agents, validation, voice assignment, etc.
 */

import { useState, useEffect, useRef, memo } from 'react';
import { Terminal, ChevronDown, ChevronUp, Cpu, Mic, Volume2, Image, Shield, Users, Check, X, AlertTriangle } from 'lucide-react';

// Category icon mapping
const CATEGORY_ICONS = {
  voice: Mic,
  gender: Users,
  sfx: Volume2,
  cover: Image,
  qa: Shield,
  safety: Shield,
  validation: Check,
  database: Cpu,
  general: Terminal
};

// Category color mapping
const CATEGORY_COLORS = {
  voice: 'text-purple-400',
  gender: 'text-pink-400',
  sfx: 'text-cyan-400',
  cover: 'text-amber-400',
  qa: 'text-green-400',
  safety: 'text-green-400',
  validation: 'text-golden-400',
  database: 'text-blue-400',
  general: 'text-night-400'
};

/**
 * Individual log entry component
 */
const LogEntry = memo(function LogEntry({ entry }) {
  const Icon = CATEGORY_ICONS[entry.category] || Terminal;
  const colorClass = CATEGORY_COLORS[entry.category] || 'text-night-400';

  // Check if this is a special formatted line (headers, checkmarks, etc.)
  const isHeader = entry.message.includes('===') || entry.message.includes('===');
  const isBox = entry.message.includes('===') || entry.message.includes('---');
  const isCheckmark = entry.message.includes('[CHECK') || entry.message.includes('[check');
  const isPass = entry.message.toLowerCase().includes('pass') || entry.message.includes('PASS');
  const isFail = entry.message.toLowerCase().includes('fail') || entry.message.includes('FAIL');
  const isWarning = entry.message.toLowerCase().includes('warning') || entry.message.includes('WARNING');

  // Format timestamp to just show time
  const formatTime = (timestamp) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return '';
    }
  };

  return (
    <div className={`
      flex items-start gap-2 py-0.5 text-xs font-mono
      ${isHeader ? 'mt-2 mb-1' : ''}
      ${isBox ? 'opacity-50' : ''}
    `}>
      <span className="text-night-600 flex-shrink-0 w-16">
        {formatTime(entry.timestamp)}
      </span>
      <Icon className={`w-3 h-3 mt-0.5 flex-shrink-0 ${colorClass}`} />
      <span className={`
        ${colorClass}
        ${isHeader ? 'font-bold' : ''}
        ${isPass ? 'text-green-400' : ''}
        ${isFail ? 'text-red-400' : ''}
        ${isWarning ? 'text-amber-400' : ''}
      `}>
        {entry.message}
      </span>
    </div>
  );
});

/**
 * Main DetailedProgressPanel component
 */
const DetailedProgressPanel = memo(function DetailedProgressPanel({
  logs = [],
  isExpanded = false,
  onToggleExpand,
  maxHeight = '500px' // Increased from 300px to show more log history
}) {
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollContainerRef = useRef(null);
  const [localExpanded, setLocalExpanded] = useState(isExpanded);

  // Use external expansion control if provided, otherwise use local state
  const expanded = onToggleExpand ? isExpanded : localExpanded;
  const toggleExpand = onToggleExpand || (() => setLocalExpanded(prev => !prev));

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && scrollContainerRef.current && expanded) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll, expanded]);

  // Detect manual scroll to disable auto-scroll
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    // If user scrolled up more than 50px from bottom, disable auto-scroll
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isNearBottom);
  };

  if (logs.length === 0) {
    return null;
  }

  return (
    <div className="bg-night-900/80 rounded-lg border border-night-700 overflow-hidden">
      {/* Header - Clickable to expand/collapse */}
      <button
        onClick={toggleExpand}
        className="w-full flex items-center justify-between px-3 py-2 bg-night-800/50 hover:bg-night-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-green-400" />
          <span className="text-night-200 text-sm font-medium">Technical Progress Log</span>
          <span className="text-night-500 text-xs">({logs.length} entries)</span>
        </div>
        <div className="flex items-center gap-2">
          {autoScroll && expanded && (
            <span className="text-green-400/60 text-xs animate-pulse">Auto-scroll</span>
          )}
          {expanded ? (
            <ChevronUp className="w-4 h-4 text-night-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-night-400" />
          )}
        </div>
      </button>

      {/* Log content - Expanded view */}
      {expanded && (
        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="px-3 py-2 overflow-y-auto bg-night-950/50"
          style={{ maxHeight }}
        >
          {logs.map((entry) => (
            <LogEntry key={entry.id} entry={entry} />
          ))}
        </div>
      )}

      {/* Collapsed preview - Shows last few entries */}
      {!expanded && logs.length > 0 && (
        <div className="px-3 py-1 text-xs font-mono text-night-500 truncate">
          {logs[logs.length - 1]?.message || '...'}
        </div>
      )}
    </div>
  );
});

export default DetailedProgressPanel;
