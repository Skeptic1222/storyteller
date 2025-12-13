/**
 * useAgentStatus Hook
 * Tracks individual AI agent status via socket events
 */

import { useState, useEffect, useCallback } from 'react';

// Agent definitions matching backend
const AGENT_DEFINITIONS = {
  planner: { name: 'Story Planner', icon: 'FileText' },
  lore: { name: 'Lore Agent', icon: 'Book' },
  writer: { name: 'Scene Writer', icon: 'PenTool' },
  narrator: { name: 'Narrator Agent', icon: 'Mic' },
  safety: { name: 'Safety Agent', icon: 'Shield' },
  sfx: { name: 'SFX Coordinator', icon: 'Volume2' },
  cyoa: { name: 'Choice Manager', icon: 'GitBranch' },
  qa: { name: 'QA Agent', icon: 'CheckCircle' },
  voice: { name: 'Voice Agent', icon: 'Users' },
  cover: { name: 'Cover Artist', icon: 'Image' }
};

const initialAgentState = () => {
  const agents = {};
  for (const [key, def] of Object.entries(AGENT_DEFINITIONS)) {
    agents[key] = {
      agent: key,
      name: def.name,
      icon: def.icon,
      status: 'pending',
      message: '',
      progress: 0,
      duration_ms: 0,
      details: null
    };
  }
  return agents;
};

export function useAgentStatus(socket, sessionId) {
  const [agents, setAgents] = useState(initialAgentState);
  const [overallProgress, setOverallProgress] = useState(0);
  const [activeAgent, setActiveAgent] = useState(null);
  const [history, setHistory] = useState([]);

  // Reset agents
  const resetAgents = useCallback(() => {
    setAgents(initialAgentState());
    setOverallProgress(0);
    setActiveAgent(null);
    setHistory([]);
  }, []);

  useEffect(() => {
    if (!socket) return;

    // Handle individual agent status updates
    const handleAgentStatusUpdate = (data) => {
      const { agent, status, message, progress, duration_ms, details, overallProgress: overall } = data;

      setAgents(prev => ({
        ...prev,
        [agent]: {
          ...prev[agent],
          status,
          message,
          progress: progress ?? prev[agent]?.progress ?? 0,
          duration_ms: duration_ms ?? prev[agent]?.duration_ms ?? 0,
          details: details ?? prev[agent]?.details
        }
      }));

      if (overall !== undefined) {
        setOverallProgress(overall);
      }

      if (status === 'active') {
        setActiveAgent(agent);
      } else if (status === 'complete' || status === 'error') {
        setActiveAgent(prev => prev === agent ? null : prev);
      }

      // Add to history
      setHistory(prev => [...prev, {
        timestamp: Date.now(),
        agent,
        status,
        message
      }]);
    };

    // Handle full agent snapshot
    const handleAgentSnapshot = (data) => {
      const { agents: agentList, overallProgress: overall, activeAgent: active } = data;

      if (agentList) {
        const newAgents = { ...initialAgentState() };
        agentList.forEach(agent => {
          newAgents[agent.agent] = {
            ...newAgents[agent.agent],
            ...agent
          };
        });
        setAgents(newAgents);
      }

      if (overall !== undefined) {
        setOverallProgress(overall);
      }

      if (active !== undefined) {
        setActiveAgent(active);
      }
    };

    // Handle agent reset
    const handleAgentReset = () => {
      resetAgents();
    };

    socket.on('agent-status-update', handleAgentStatusUpdate);
    socket.on('agent-status-snapshot', handleAgentSnapshot);
    socket.on('agent-status-reset', handleAgentReset);

    return () => {
      socket.off('agent-status-update', handleAgentStatusUpdate);
      socket.off('agent-status-snapshot', handleAgentSnapshot);
      socket.off('agent-status-reset', handleAgentReset);
    };
  }, [socket, resetAgents]);

  // Get agents as array sorted by typical execution order
  const agentList = Object.values(agents).sort((a, b) => {
    const order = ['planner', 'lore', 'writer', 'narrator', 'voice', 'sfx', 'cover', 'safety', 'qa', 'cyoa'];
    return order.indexOf(a.agent) - order.indexOf(b.agent);
  });

  // Get counts
  const completedCount = agentList.filter(a => a.status === 'complete').length;
  const activeCount = agentList.filter(a => a.status === 'active').length;
  const errorCount = agentList.filter(a => a.status === 'error').length;

  return {
    agents,
    agentList,
    overallProgress,
    activeAgent,
    history,
    completedCount,
    activeCount,
    errorCount,
    resetAgents,
    AGENT_DEFINITIONS
  };
}

export default useAgentStatus;
