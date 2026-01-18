/**
 * MissionControl Component
 * Main dashboard container combining circular gauges, agent status, activity feed, and stats.
 *
 * Mobile-first design optimized for portrait orientation (390 x 844).
 *
 * Layout:
 * - Main circular gauge (hero element)
 * - 4 mini agent gauges in 2x2 grid
 * - Live activity feed
 * - Stats bar
 */

import { memo, useMemo } from 'react';
import { Pen, Mic, Volume2, Image, Shield } from 'lucide-react';
import CircularGauge from './CircularGauge';
import MiniAgentGauge from './MiniAgentGauge';
import ActivityFeed from './ActivityFeed';
import StatsBar from './StatsBar';

// Agent definitions with icons
const AGENTS = [
  { key: 'writer', name: 'Writer', icon: Pen },
  { key: 'voice', name: 'Voice', icon: Mic },
  { key: 'sfx', name: 'SFX', icon: Volume2 },
  { key: 'cover', name: 'Cover', icon: Image }
];

const MissionControl = memo(function MissionControl({
  // Main progress
  percent = 0,
  phase = '',
  message = '',
  eta = null,

  // Agent statuses: { writer: { status, progress, duration, message }, ... }
  agentStatuses = {},

  // Activity feed items: [{ id, timestamp, status, message }, ...]
  activityItems = [],

  // Stats
  cost = 0,
  characters = 0,
  sfxCount = 0,
  elapsedSeconds = 0,

  className = ''
}) {
  // Format ETA
  const etaDisplay = useMemo(() => {
    if (!eta || eta <= 0) return null;
    const mins = Math.floor(eta / 60);
    const secs = Math.round(eta % 60);
    if (mins > 0) return `~${mins}m ${secs}s`;
    return `~${secs}s`;
  }, [eta]);

  // Main gauge label based on phase
  const gaugeLabel = useMemo(() => {
    if (percent >= 100) return 'Ready!';
    if (phase) return phase;
    if (message) {
      // Extract short version from message
      const shortMessage = message.length > 25
        ? message.substring(0, 22) + '...'
        : message;
      return shortMessage;
    }
    return 'Initializing...';
  }, [percent, phase, message]);

  return (
    <div className={`flex flex-col gap-4 p-4 ${className}`}>
      {/* Main Circular Gauge - Hero Element */}
      <div className="flex justify-center">
        <CircularGauge
          percent={percent}
          size={180}
          strokeWidth={14}
          label={gaugeLabel}
          sublabel={etaDisplay}
          className="drop-shadow-lg"
        />
      </div>

      {/* Agent Status Grid - 2x2 */}
      <div className="grid grid-cols-2 gap-3 px-4">
        {AGENTS.map(agent => {
          const status = agentStatuses[agent.key] || {};
          return (
            <div
              key={agent.key}
              className="flex justify-center p-2 bg-slate-800/30 rounded-lg border border-slate-700/30"
            >
              <MiniAgentGauge
                name={agent.name}
                icon={agent.icon}
                status={status.status || 'pending'}
                progress={status.progress || 0}
                duration={status.duration}
                message={status.message}
                size={56}
              />
            </div>
          );
        })}
      </div>

      {/* Activity Feed */}
      <div className="bg-slate-800/30 rounded-lg border border-slate-700/30 overflow-hidden">
        <ActivityFeed
          items={activityItems}
          maxVisible={5}
        />
      </div>

      {/* Stats Bar */}
      <StatsBar
        cost={cost}
        characters={characters}
        sfxCount={sfxCount}
        elapsedSeconds={elapsedSeconds}
      />
    </div>
  );
});

export default MissionControl;

// Re-export sub-components for flexibility
export { CircularGauge, MiniAgentGauge, ActivityFeed, StatsBar };
