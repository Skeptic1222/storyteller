/**
 * StatsBar Component
 * Horizontal bar with real-time metrics display.
 *
 * Shows: Cost | Characters | SFX | Elapsed Time
 */

import { memo } from 'react';
import { DollarSign, Users, Volume2, Timer } from 'lucide-react';

const StatItem = memo(function StatItem({ icon: Icon, label, value, color = 'slate' }) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon className={`w-3 h-3 text-${color}-400`} />
      <span className="text-slate-500 text-[10px] hidden sm:inline">{label}</span>
      <span className={`text-${color}-300 text-xs font-medium`}>{value}</span>
    </div>
  );
});

const StatsBar = memo(function StatsBar({
  cost = 0,
  characters = 0,
  sfxCount = 0,
  elapsedSeconds = 0,
  className = ''
}) {
  // Format cost
  const formatCost = (cents) => {
    if (cents === 0) return '$0.00';
    if (cents < 100) return `$${(cents / 100).toFixed(2)}`;
    return `$${(cents / 100).toFixed(2)}`;
  };

  // Format elapsed time
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  return (
    <div className={`flex items-center justify-around gap-3 px-3 py-2 bg-slate-800/50 rounded-lg border border-slate-700/50 ${className}`}>
      <StatItem
        icon={DollarSign}
        label="Cost"
        value={formatCost(cost)}
        color="emerald"
      />

      <div className="w-px h-4 bg-slate-700" />

      <StatItem
        icon={Users}
        label="Characters"
        value={characters}
        color="blue"
      />

      <div className="w-px h-4 bg-slate-700" />

      <StatItem
        icon={Volume2}
        label="SFX"
        value={sfxCount}
        color="purple"
      />

      <div className="w-px h-4 bg-slate-700" />

      <StatItem
        icon={Timer}
        label="Time"
        value={formatTime(elapsedSeconds)}
        color="golden"
      />
    </div>
  );
});

export default StatsBar;
