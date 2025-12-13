/**
 * Divergence Modal Component
 * Shown when user makes a CYOA choice that doesn't have a recording
 * Offers to continue with live generation (which creates new recording)
 */

import { memo } from 'react';
import { GitBranch, Sparkles, ArrowRight, Disc, RefreshCw } from 'lucide-react';

const DivergenceModal = memo(function DivergenceModal({
  isOpen,
  choiceKey,
  choiceText,
  onContinue,
  onCancel,
  isLoading = false
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative bg-night-800 border border-night-600 rounded-2xl max-w-md w-full shadow-2xl overflow-hidden">
        {/* Header with gradient */}
        <div className="bg-gradient-to-r from-amber-500/20 to-purple-500/20 p-6 border-b border-night-700">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-amber-500/20">
              <GitBranch className="w-6 h-6 text-amber-400" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-night-100">
                New Adventure Path
              </h3>
              <p className="text-night-400 text-sm">
                Creating a new story branch
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Choice info */}
          <div className="p-4 bg-night-900/50 rounded-xl border border-night-700">
            <div className="flex items-start gap-3">
              <span className="flex-shrink-0 w-8 h-8 rounded-full bg-golden-500/20 flex items-center justify-center text-golden-400 font-bold">
                {choiceKey}
              </span>
              <p className="text-night-200 leading-relaxed">
                {choiceText || `Option ${choiceKey}`}
              </p>
            </div>
          </div>

          {/* Explanation */}
          <div className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <Sparkles className="w-5 h-5 text-purple-400 flex-shrink-0 mt-0.5" />
              <p className="text-night-300">
                This choice leads to an <span className="text-purple-400 font-medium">uncharted path</span>.
                A new story will be generated for you.
              </p>
            </div>

            <div className="flex items-start gap-3">
              <Disc className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-night-300">
                Your new adventure will be <span className="text-green-400 font-medium">recorded</span> for
                future listening without any wait.
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 pt-4">
            <button
              onClick={onCancel}
              disabled={isLoading}
              className="flex-1 px-4 py-3 rounded-xl bg-night-700 text-night-300 hover:bg-night-600 hover:text-night-100 transition-colors disabled:opacity-50"
            >
              Go Back
            </button>

            <button
              onClick={() => onContinue(choiceKey)}
              disabled={isLoading}
              className="flex-1 px-4 py-3 rounded-xl bg-gradient-to-r from-golden-500 to-amber-500 text-night-900 font-medium hover:from-golden-400 hover:to-amber-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {isLoading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer note */}
        <div className="px-6 py-3 bg-night-900/50 border-t border-night-700">
          <p className="text-center text-night-500 text-xs">
            Stories are generated using AI and may take a moment to create
          </p>
        </div>
      </div>
    </div>
  );
});

export default DivergenceModal;
