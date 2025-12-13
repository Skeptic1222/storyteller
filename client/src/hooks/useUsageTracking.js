/**
 * useUsageTracking Hook
 * Tracks API usage and costs in real-time via socket events
 */

import { useState, useEffect, useCallback } from 'react';

const initialUsageState = {
  elevenlabs: {
    characters: 0,
    requests: 0,
    cost: 0
  },
  openai: {
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    requests: 0,
    cost: 0,
    byModel: {}
  },
  whisper: {
    minutes: 0,
    requests: 0,
    cost: 0
  },
  realtime: {
    audioInputTokens: 0,
    audioOutputTokens: 0,
    textInputTokens: 0,
    textOutputTokens: 0,
    cost: 0
  },
  images: {
    count: 0,
    cost: 0
  },
  total: {
    cost: 0,
    formatted: '$0.0000'
  }
};

export function useUsageTracking(socket, sessionId) {
  const [usage, setUsage] = useState(initialUsageState);
  const [history, setHistory] = useState([]);

  // Reset usage
  const resetUsage = useCallback(() => {
    setUsage(initialUsageState);
    setHistory([]);
  }, []);

  useEffect(() => {
    if (!socket) return;

    // Handle usage updates
    const handleUsageUpdate = (data) => {
      setUsage(prev => ({
        elevenlabs: {
          characters: data.elevenlabs?.characters ?? prev.elevenlabs.characters,
          requests: data.elevenlabs?.requests ?? prev.elevenlabs.requests,
          cost: data.elevenlabs?.cost ?? prev.elevenlabs.cost
        },
        openai: {
          inputTokens: data.openai?.inputTokens ?? prev.openai.inputTokens,
          outputTokens: data.openai?.outputTokens ?? prev.openai.outputTokens,
          cachedTokens: data.openai?.cachedTokens ?? prev.openai.cachedTokens,
          requests: data.openai?.requests ?? prev.openai.requests,
          cost: data.openai?.cost ?? prev.openai.cost,
          byModel: data.openai?.byModel ?? prev.openai.byModel
        },
        whisper: {
          minutes: data.whisper?.minutes ?? prev.whisper.minutes,
          requests: data.whisper?.requests ?? prev.whisper.requests,
          cost: data.whisper?.cost ?? prev.whisper.cost
        },
        realtime: {
          audioInputTokens: data.realtime?.audioInputTokens ?? prev.realtime.audioInputTokens,
          audioOutputTokens: data.realtime?.audioOutputTokens ?? prev.realtime.audioOutputTokens,
          textInputTokens: data.realtime?.textInputTokens ?? prev.realtime.textInputTokens,
          textOutputTokens: data.realtime?.textOutputTokens ?? prev.realtime.textOutputTokens,
          cost: data.realtime?.cost ?? prev.realtime.cost
        },
        images: {
          count: data.images?.count ?? prev.images.count,
          cost: data.images?.cost ?? prev.images.cost
        },
        total: {
          cost: data.total?.cost ?? prev.total.cost,
          formatted: data.total?.formatted ?? prev.total.formatted
        }
      }));

      // Add to history for graphing
      setHistory(prev => [...prev.slice(-50), { // Keep last 50 updates
        timestamp: Date.now(),
        total: data.total?.cost ?? 0,
        elevenlabs: data.elevenlabs?.cost ?? 0,
        openai: data.openai?.cost ?? 0
      }]);
    };

    socket.on('usage-update', handleUsageUpdate);

    return () => {
      socket.off('usage-update', handleUsageUpdate);
    };
  }, [socket]);

  // Format helpers
  const formatCost = (cost) => `$${(cost || 0).toFixed(4)}`;
  const formatTokens = (tokens) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}K`;
    return tokens.toString();
  };
  const formatCharacters = (chars) => {
    if (chars >= 1000) return `${(chars / 1000).toFixed(1)}K`;
    return chars.toString();
  };

  // Calculate totals
  const totalTokens = usage.openai.inputTokens + usage.openai.outputTokens;

  // Get model breakdown as array
  const modelBreakdown = Object.entries(usage.openai.byModel || {}).map(([model, data]) => ({
    model,
    input: data.input,
    output: data.output,
    cached: data.cached,
    cost: data.cost
  }));

  return {
    usage,
    history,
    totalTokens,
    modelBreakdown,
    formatCost,
    formatTokens,
    formatCharacters,
    resetUsage
  };
}

export default useUsageTracking;
