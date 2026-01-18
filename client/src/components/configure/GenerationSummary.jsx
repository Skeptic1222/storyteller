import React from 'react';
import { FileText, Mic, Users, Volume2, ChevronUp } from 'lucide-react';

function GenerationSummary({ config, isExpanded, onToggle, onFeatureToggle }) {
  // Calculate credit estimates based on config
  const getCredits = () => {
    let base = 2; // Story text always costs ~2
    let audio = 0;

    if (config.narration !== false) { // Default is on
      audio += 5;
      if (config.multi_voice) audio += 3;
      if (config.sfx_enabled) {
        audio += config.sfx_level === 'high' ? 3 : config.sfx_level === 'medium' ? 2 : 1;
      }
    }

    return { base, audio, total: base + audio };
  };

  const credits = getCredits();

  const features = [
    {
      id: 'text',
      icon: FileText,
      label: 'Story Text',
      status: 'Always',
      credits: credits.base,
      toggleable: false
    },
    {
      id: 'narration',
      icon: Mic,
      label: 'Narration',
      status: config.narration !== false,
      credits: 5,
      toggleable: true
    },
    {
      id: 'multi_voice',
      icon: Users,
      label: 'Multi-Voice Cast',
      status: config.multi_voice,
      credits: 3,
      toggleable: true,
      disabled: config.narration === false
    },
    {
      id: 'sfx',
      icon: Volume2,
      label: `Sound Effects${config.sfx_level ? ` (${config.sfx_level})` : ''}`,
      status: config.sfx_enabled,
      credits: config.sfx_level === 'high' ? 3 : config.sfx_level === 'medium' ? 2 : 1,
      toggleable: true,
      disabled: config.narration === false
    }
  ];

  if (!isExpanded) return null;

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-xl p-4 mb-4 animate-fadeIn">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-medium text-slate-100 flex items-center gap-2">
          <span>📊</span> Generation Summary
        </h3>
        <button onClick={onToggle} className="text-slate-400 hover:text-slate-200">
          <ChevronUp className="w-5 h-5" />
        </button>
      </div>

      {/* Story info line */}
      <p className="text-slate-400 text-sm mb-4">
        {config.story_format?.replace('_', ' ') || 'Story'} • {config.audience || 'General'} •
        {Object.entries(config.genres || {})
          .filter(([_, v]) => v > 50)
          .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1))
          .join('/')}
      </p>

      {/* Features table */}
      <div className="space-y-2 mb-4">
        {features.map(feature => (
          <div key={feature.id} className={`flex items-center justify-between py-2 px-3 rounded-lg ${
            feature.disabled ? 'bg-slate-900 opacity-50' : 'bg-slate-700'
          }`}>
            <div className="flex items-center gap-3">
              <feature.icon className="w-4 h-4 text-slate-400" />
              <span className="text-slate-200">{feature.label}</span>
            </div>
            <div className="flex items-center gap-4">
              <span className={`text-sm ${feature.status ? 'text-emerald-400' : 'text-slate-500'}`}>
                {feature.status === 'Always' ? 'Always' : feature.status ? '✓ On' : '✗ Off'}
              </span>
              <span className="text-slate-400 text-sm w-16 text-right">
                {feature.status && feature.status !== 'Always' ? `~${feature.credits}` : feature.status === 'Always' ? `~${feature.credits}` : '—'}
              </span>
              {feature.toggleable && !feature.disabled && (
                <button
                  onClick={() => onFeatureToggle(feature.id)}
                  className="text-xs text-golden-400 hover:text-golden-300"
                >
                  {feature.status ? 'Off' : 'On'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="flex justify-between items-center pt-3 border-t border-slate-600">
        <span className="text-slate-300 font-medium">Estimated Total</span>
        <span className="text-golden-400 font-bold">~{credits.total} credits</span>
      </div>

      {/* Text Only shortcut */}
      <button
        onClick={() => {
          onFeatureToggle('narration');
        }}
        className="w-full mt-4 py-2 px-4 bg-slate-700 hover:bg-slate-600 rounded-lg text-slate-300 text-sm flex items-center justify-center gap-2"
      >
        <FileText className="w-4 h-4" />
        {config.narration === false ? 'Enable Audio Features' : 'Text Only (save ~' + credits.audio + ' credits)'}
      </button>

      {/* Tip */}
      <p className="text-slate-500 text-xs mt-3 text-center">
        💡 Disable audio features to reduce credit usage
      </p>
    </div>
  );
}

export default GenerationSummary;
