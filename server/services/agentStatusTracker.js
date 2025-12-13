/**
 * Agent Status Tracker Service
 * Tracks individual AI agent status and emits real-time updates via socket
 *
 * Agents tracked:
 * - Planner: Story outline creation
 * - Lore: Consistency checking and world-building
 * - Writer: Scene prose generation
 * - Narrator: TTS optimization and voice assignment
 * - Safety: Content filtering and slider compliance
 * - SFX: Sound effect detection and generation
 * - CYOA: Choice generation
 * - QA: Quality assurance checks
 */

import { logger } from '../utils/logger.js';

// Agent definitions with display info
const AGENT_DEFINITIONS = {
  planner: {
    name: 'Story Planner',
    description: 'Creates story outline and structure',
    icon: 'outline'
  },
  lore: {
    name: 'Lore Agent',
    description: 'Maintains world consistency',
    icon: 'book'
  },
  writer: {
    name: 'Scene Writer',
    description: 'Crafts narrative prose',
    icon: 'pen'
  },
  narrator: {
    name: 'Narrator Agent',
    description: 'Optimizes for speech synthesis',
    icon: 'microphone'
  },
  safety: {
    name: 'Safety Agent',
    description: 'Ensures content guidelines',
    icon: 'shield'
  },
  sfx: {
    name: 'SFX Coordinator',
    description: 'Detects sound opportunities',
    icon: 'volume'
  },
  cyoa: {
    name: 'Choice Manager',
    description: 'Creates branching decisions',
    icon: 'fork'
  },
  qa: {
    name: 'QA Agent',
    description: 'Validates story quality',
    icon: 'check'
  },
  voice: {
    name: 'Voice Agent',
    description: 'Assigns character voices',
    icon: 'users'
  },
  cover: {
    name: 'Cover Artist',
    description: 'Generates story cover art',
    icon: 'image'
  }
};

// Session-level agent tracking (in-memory)
const sessionAgentStatus = new Map();

/**
 * Initialize agent tracking for a session
 */
export function initAgentTracking(sessionId, io = null) {
  const agents = {};

  for (const [key, def] of Object.entries(AGENT_DEFINITIONS)) {
    agents[key] = {
      agent: key,
      name: def.name,
      description: def.description,
      icon: def.icon,
      status: 'pending',
      message: '',
      progress: 0,
      startedAt: null,
      completedAt: null,
      duration_ms: 0,
      details: null
    };
  }

  sessionAgentStatus.set(sessionId, {
    sessionId,
    io,
    agents,
    overallProgress: 0,
    activeAgent: null,
    history: []
  });

  logger.info(`[AgentStatusTracker] Initialized tracking for session ${sessionId}`);
  return sessionAgentStatus.get(sessionId);
}

/**
 * Get or initialize agent tracking for a session
 */
export function getAgentTracking(sessionId) {
  if (!sessionAgentStatus.has(sessionId)) {
    return initAgentTracking(sessionId);
  }
  return sessionAgentStatus.get(sessionId);
}

/**
 * Set the socket.io instance for a session
 */
export function setAgentTrackingIO(sessionId, io) {
  const tracking = getAgentTracking(sessionId);
  tracking.io = io;
}

/**
 * Update agent status and emit to clients
 */
export function updateAgentStatus(sessionId, agentKey, status, message = '', progress = null, details = null) {
  const tracking = getAgentTracking(sessionId);
  const agent = tracking.agents[agentKey];

  if (!agent) {
    logger.warn(`[AgentStatusTracker] Unknown agent: ${agentKey}`);
    return null;
  }

  const previousStatus = agent.status;
  const now = Date.now();

  // Update agent state
  agent.status = status;
  agent.message = message;
  if (progress !== null) {
    agent.progress = progress;
  }
  if (details !== null) {
    agent.details = details;
  }

  // Track timing
  if (status === 'active' && previousStatus !== 'active') {
    agent.startedAt = now;
    tracking.activeAgent = agentKey;
  } else if ((status === 'complete' || status === 'error') && agent.startedAt) {
    agent.completedAt = now;
    agent.duration_ms = now - agent.startedAt;
    if (tracking.activeAgent === agentKey) {
      tracking.activeAgent = null;
    }
  }

  // Auto-set progress for complete/error states
  if (status === 'complete') {
    agent.progress = 100;
  } else if (status === 'error') {
    agent.progress = agent.progress || 0;
  }

  // Calculate overall progress
  tracking.overallProgress = calculateOverallProgress(tracking.agents);

  // Record in history
  tracking.history.push({
    timestamp: now,
    agent: agentKey,
    status,
    message
  });

  // Emit update via socket if available
  if (tracking.io) {
    const update = {
      agent: agentKey,
      name: agent.name,
      icon: agent.icon,
      status: agent.status,
      message: agent.message,
      progress: agent.progress,
      duration_ms: agent.duration_ms,
      details: agent.details,
      overallProgress: tracking.overallProgress
    };

    tracking.io.to(sessionId).emit('agent-status-update', update);
    logger.debug(`[AgentStatusTracker] Emitted update for ${agentKey}: ${status}`);
  }

  logger.info(`[AgentStatusTracker] ${agentKey}: ${status} - ${message} (${agent.progress}%)`);

  return agent;
}

/**
 * Calculate overall progress based on agent states
 */
function calculateOverallProgress(agents) {
  const agentList = Object.values(agents);
  const completedCount = agentList.filter(a => a.status === 'complete').length;
  const activeAgent = agentList.find(a => a.status === 'active');

  // Base progress from completed agents
  let progress = (completedCount / agentList.length) * 100;

  // Add partial progress from active agent
  if (activeAgent) {
    const agentContribution = (1 / agentList.length) * (activeAgent.progress / 100) * 100;
    progress += agentContribution;
  }

  return Math.round(progress);
}

/**
 * Start an agent
 */
export function startAgent(sessionId, agentKey, message = '') {
  const def = AGENT_DEFINITIONS[agentKey];
  const defaultMessage = message || `${def?.name || agentKey} starting...`;
  return updateAgentStatus(sessionId, agentKey, 'active', defaultMessage, 0);
}

/**
 * Update agent progress
 */
export function updateAgentProgress(sessionId, agentKey, progress, message = '') {
  return updateAgentStatus(sessionId, agentKey, 'active', message, progress);
}

/**
 * Complete an agent
 */
export function completeAgent(sessionId, agentKey, message = '', details = null) {
  const def = AGENT_DEFINITIONS[agentKey];
  const defaultMessage = message || `${def?.name || agentKey} complete`;
  return updateAgentStatus(sessionId, agentKey, 'complete', defaultMessage, 100, details);
}

/**
 * Mark agent as errored
 */
export function errorAgent(sessionId, agentKey, message = '', details = null) {
  return updateAgentStatus(sessionId, agentKey, 'error', message, null, details);
}

/**
 * Get all agent statuses for a session
 */
export function getAllAgentStatuses(sessionId) {
  const tracking = getAgentTracking(sessionId);
  return {
    agents: tracking.agents,
    overallProgress: tracking.overallProgress,
    activeAgent: tracking.activeAgent,
    history: tracking.history
  };
}

/**
 * Emit full agent status snapshot to a specific socket
 */
export function emitAgentSnapshot(sessionId, socket) {
  const tracking = getAgentTracking(sessionId);

  const snapshot = {
    agents: Object.values(tracking.agents).map(agent => ({
      agent: agent.agent,
      name: agent.name,
      icon: agent.icon,
      status: agent.status,
      message: agent.message,
      progress: agent.progress,
      duration_ms: agent.duration_ms,
      details: agent.details
    })),
    overallProgress: tracking.overallProgress,
    activeAgent: tracking.activeAgent
  };

  socket.emit('agent-status-snapshot', snapshot);
  logger.info(`[AgentStatusTracker] Emitted snapshot for session ${sessionId}`);
}

/**
 * Reset all agents to pending for a new generation
 */
export function resetAgents(sessionId) {
  const tracking = getAgentTracking(sessionId);

  for (const agent of Object.values(tracking.agents)) {
    agent.status = 'pending';
    agent.message = '';
    agent.progress = 0;
    agent.startedAt = null;
    agent.completedAt = null;
    agent.duration_ms = 0;
    agent.details = null;
  }

  tracking.overallProgress = 0;
  tracking.activeAgent = null;
  tracking.history = [];

  // Emit reset
  if (tracking.io) {
    tracking.io.to(sessionId).emit('agent-status-reset', {
      message: 'Agent tracking reset for new generation'
    });
  }

  logger.info(`[AgentStatusTracker] Reset agents for session ${sessionId}`);
}

/**
 * Clear tracking for a session
 */
export function clearAgentTracking(sessionId) {
  sessionAgentStatus.delete(sessionId);
  logger.info(`[AgentStatusTracker] Cleared tracking for session ${sessionId}`);
}

/**
 * Get agent definitions (for UI display)
 */
export function getAgentDefinitions() {
  return AGENT_DEFINITIONS;
}

export default {
  initAgentTracking,
  getAgentTracking,
  setAgentTrackingIO,
  updateAgentStatus,
  startAgent,
  updateAgentProgress,
  completeAgent,
  errorAgent,
  getAllAgentStatuses,
  emitAgentSnapshot,
  resetAgents,
  clearAgentTracking,
  getAgentDefinitions,
  AGENT_DEFINITIONS
};
