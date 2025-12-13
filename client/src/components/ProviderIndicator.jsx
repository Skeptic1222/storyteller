/**
 * ProviderIndicator Component
 * Shows estimated AI provider split based on content intensity settings
 * Helps users understand when Venice.ai (uncensored) vs OpenAI will be used
 *
 * NOTE: This component considers BOTH intensity AND genre sliders to determine
 * Venice.ai routing. Users may adjust either slider to affect the provider split.
 */

import React from 'react';

// Threshold constants (matching server-side llmProviders.js)
const GORE_THRESHOLD = 61;
const ROMANCE_THRESHOLD = 71;  // STEAMY level
const ADULT_CONTENT_THRESHOLD = 50;  // For explicit adult content

function ProviderIndicator({ intensity, audience, genres = {} }) {
  // Only show for mature audience
  if (audience !== 'mature') return null;

  // Get the effective values - consider BOTH intensity and genre settings
  // This ensures users see the indicator update regardless of which slider they adjust
  const effectiveGore = Math.max(intensity?.gore || 0, genres?.horror > 80 ? genres.horror - 20 : 0);
  const effectiveRomance = Math.max(intensity?.romance || 0, genres?.romance || 0);
  const effectiveAdultContent = intensity?.adultContent || 0;

  // Calculate which providers will be used based on settings
  const usesVenice = effectiveGore >= GORE_THRESHOLD ||
                     effectiveRomance >= ROMANCE_THRESHOLD ||
                     effectiveAdultContent >= ADULT_CONTENT_THRESHOLD;
  const goreUsesVenice = effectiveGore >= GORE_THRESHOLD;
  const romanceUsesVenice = effectiveRomance >= ROMANCE_THRESHOLD;
  const adultUsesVenice = effectiveAdultContent >= ADULT_CONTENT_THRESHOLD;

  // Estimate rough percentages based on effective intensity levels
  // Higher intensity = more scenes likely to trigger Venice
  const venicePercent = calculateVenicePercent({
    gore: effectiveGore,
    romance: effectiveRomance,
    adultContent: effectiveAdultContent,
    violence: intensity?.violence || 0
  });
  const openaiPercent = 100 - venicePercent;

  if (!usesVenice) {
    return (
      <div className="flex items-center gap-2 text-xs text-night-500 mt-4 p-3 bg-night-800/50 rounded-lg border border-night-700">
        <span className="text-green-400">●</span>
        <span>All content routed to <span className="text-green-400">OpenAI</span></span>
        <span className="ml-auto text-night-600">Standard AI</span>
      </div>
    );
  }

  return (
    <div className="mt-4 p-3 bg-night-800/50 rounded-lg border border-purple-500/30">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-night-400">Estimated AI Provider Split</span>
        <span className="text-xs text-purple-400">🔓 Uncensored Mode</span>
      </div>

      {/* Provider bar */}
      <div className="h-3 bg-night-700 rounded-full overflow-hidden flex">
        <div
          className="bg-gradient-to-r from-green-500 to-green-600 transition-all"
          style={{ width: `${openaiPercent}%` }}
        />
        <div
          className="bg-gradient-to-r from-purple-500 to-purple-600 transition-all"
          style={{ width: `${venicePercent}%` }}
        />
      </div>

      {/* Labels */}
      <div className="flex justify-between mt-2 text-xs">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-green-500"></span>
          <span className="text-green-400">OpenAI</span>
          <span className="text-night-500">~{openaiPercent}%</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-purple-500"></span>
          <span className="text-purple-400">Venice.ai</span>
          <span className="text-night-500">~{venicePercent}%</span>
        </div>
      </div>

      {/* What triggers Venice */}
      <div className="mt-2 text-xs text-night-500">
        <span className="text-purple-400">Venice.ai</span> handles:{' '}
        {[
          goreUsesVenice && 'graphic violence',
          romanceUsesVenice && 'steamy romance',
          adultUsesVenice && 'adult content'
        ].filter(Boolean).join(', ')}
      </div>
    </div>
  );
}

/**
 * Calculate estimated percentage of content that will use Venice
 * This is a rough estimate based on intensity settings
 */
function calculateVenicePercent(intensity) {
  let veniceWeight = 0;

  // Gore above threshold contributes to Venice usage
  // Higher gore = more combat/horror scenes using Venice
  if ((intensity.gore || 0) >= GORE_THRESHOLD) {
    veniceWeight += Math.min(30, (intensity.gore - GORE_THRESHOLD + 10) * 0.8);
  }

  // Romance above threshold contributes to Venice usage
  // Higher romance = more intimate scenes using Venice
  if ((intensity.romance || 0) >= ROMANCE_THRESHOLD) {
    veniceWeight += Math.min(30, (intensity.romance - ROMANCE_THRESHOLD + 10) * 0.8);
  }

  // Adult content above threshold contributes significantly
  // Higher adult content = more explicit scenes using Venice
  if ((intensity.adultContent || 0) >= ADULT_CONTENT_THRESHOLD) {
    veniceWeight += Math.min(40, (intensity.adultContent - ADULT_CONTENT_THRESHOLD + 10) * 0.8);
  }

  // Violence contributes a bit even under threshold if other content is mature
  if (veniceWeight > 0 && (intensity.violence || 0) > 50) {
    veniceWeight += Math.min(10, (intensity.violence - 50) * 0.2);
  }

  return Math.round(Math.min(70, veniceWeight));  // Cap at 70% - most content is still dialog/description
}

export default ProviderIndicator;
