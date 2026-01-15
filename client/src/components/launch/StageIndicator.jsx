/**
 * StageIndicator Component
 * Displays a single launch stage with status, icon, and retry support
 */
import { memo } from 'react';
import { Check, X, Loader2, RotateCcw } from 'lucide-react';
import { STATUS, STAGE_CONFIG } from '../../constants/launchStages';

const StageIndicator = memo(function StageIndicator({
  stage,
  status,
  details,
  canRetry,
  isRetrying,
  onRetry
}) {
  const config = STAGE_CONFIG[stage];
  if (!config) return null;

  const Icon = config.icon;

  const getStatusIcon = () => {
    if (isRetrying) {
      return <Loader2 className="w-4 h-4 text-golden-400 animate-spin" />;
    }
    switch (status) {
      case STATUS.SUCCESS:
        return <Check className="w-4 h-4 text-green-400" />;
      case STATUS.ERROR:
        return <X className="w-4 h-4 text-red-400" />;
      case STATUS.IN_PROGRESS:
        return <Loader2 className="w-4 h-4 text-golden-400 animate-spin" />;
      default:
        return <div className="w-4 h-4 rounded-full border-2 border-slate-600" />;
    }
  };

  const getStatusClass = () => {
    if (isRetrying) {
      return 'border-golden-400/50 bg-golden-400/10 animate-pulse';
    }
    switch (status) {
      case STATUS.SUCCESS:
        return 'border-green-500/50 bg-green-500/10';
      case STATUS.ERROR:
        return 'border-red-500/50 bg-red-500/10';
      case STATUS.IN_PROGRESS:
        return 'border-golden-400/50 bg-golden-400/10 animate-pulse';
      default:
        return 'border-slate-700 bg-slate-800/50';
    }
  };

  return (
    <div className={`
      flex items-center gap-3 p-3 rounded-lg border transition-all duration-300
      ${getStatusClass()}
    `}>
      <div className={`
        w-8 h-8 rounded-lg flex items-center justify-center
        ${status === STATUS.IN_PROGRESS ? config.bgColor : 'bg-slate-700/50'}
      `}>
        <Icon className={`w-4 h-4 ${
          status === STATUS.IN_PROGRESS ? config.activeColor :
          status === STATUS.SUCCESS ? 'text-green-400' :
          status === STATUS.ERROR ? 'text-red-400' :
          'text-slate-500'
        }`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className={`text-sm font-medium ${
            status === STATUS.SUCCESS ? 'text-green-400' :
            status === STATUS.ERROR ? 'text-red-400' :
            status === STATUS.IN_PROGRESS ? 'text-slate-100' :
            'text-slate-400'
          }`}>
            {config.name}
          </span>
        </div>
        {details?.message && status === STATUS.IN_PROGRESS && (
          <p className="text-xs text-slate-500 truncate mt-0.5">
            {details.message}
          </p>
        )}
        {details?.message && status === STATUS.SUCCESS && (
          <p className="text-xs text-green-400/70 truncate mt-0.5">
            {details.message}
          </p>
        )}
        {details?.message && status === STATUS.ERROR && (
          <p className="text-xs text-red-400/70 truncate mt-0.5">
            {details.message}
          </p>
        )}
      </div>

      <div className="flex-shrink-0 flex items-center gap-2">
        {/* Retry button for failed stages */}
        {status === STATUS.ERROR && canRetry && onRetry && !isRetrying && (
          <button
            onClick={() => onRetry(stage)}
            className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
            title="Retry this step"
          >
            <RotateCcw className="w-3.5 h-3.5 text-slate-300" />
          </button>
        )}
        {getStatusIcon()}
      </div>
    </div>
  );
});

export default StageIndicator;
