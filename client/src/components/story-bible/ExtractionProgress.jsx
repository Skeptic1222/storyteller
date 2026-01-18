/**
 * ExtractionProgress Component
 * LaunchScreen-style progress display for multi-agent document extraction
 * Horizontal progress bar with milestone markers, agent grid, and real-time activity
 */

import { useState, useEffect, useRef, memo, useCallback } from 'react';
import { getStoredToken } from '../../utils/authToken';
import {
  Loader2, CheckCircle2, AlertCircle, Users, Globe, MapPin,
  BookOpen, Link2, Sparkles, FileSearch, Layers, Activity,
  ChevronDown, Clock, Skull, Crown, Swords, Shield,
  Check, X, Sword, Building2
} from 'lucide-react';

// Pass configuration with icons and colors
const PASS_CONFIG = {
  1: { name: 'Document Analysis', shortName: 'Analyze', icon: FileSearch, color: 'blue', description: 'Understanding document structure and identifying content types...' },
  2: { name: 'Entity Extraction', shortName: 'Extract', icon: Layers, color: 'purple', description: '6 AI agents working in parallel to extract characters, world, locations, items, factions, and lore...' },
  3: { name: 'Relationship Mapping', shortName: 'Map', icon: Link2, color: 'amber', description: 'Analyzing connections between characters, location hierarchies, faction memberships, and lore links...' },
  4: { name: 'Gap Analysis', shortName: 'Gaps', icon: Sparkles, color: 'cyan', description: 'Inferring missing details from context clues (gender, age, relationships)...' },
  4.5: { name: 'Deduplication', shortName: 'Dedupe', icon: Layers, color: 'rose', description: 'Identifying cross-category duplicates and resolving conflicts...' },
  5: { name: 'Consolidation', shortName: 'Finalize', icon: CheckCircle2, color: 'green', description: 'Merging duplicates, validating data, and preparing final results...' }
};

// Agent configuration for Pass 2 grid
const AGENT_CONFIG = {
  CharacterExtractor: { name: 'Characters', icon: Users, color: 'blue' },
  WorldExtractor: { name: 'World', icon: Globe, color: 'emerald' },
  LocationExtractor: { name: 'Locations', icon: MapPin, color: 'cyan' },
  ItemExtractor: { name: 'Items', icon: Sword, color: 'orange' },
  FactionExtractor: { name: 'Factions', icon: Building2, color: 'rose' },
  LoreExtractor: { name: 'Lore', icon: BookOpen, color: 'purple' },
  EventExtractor: { name: 'Events', icon: Sparkles, color: 'amber' }
};

// Rotating status messages for each agent (shown while agent is running)
const AGENT_STATUS_MESSAGES = {
  CharacterExtractor: [
    'Identifying named characters...',
    'Analyzing dialogue patterns...',
    'Detecting character relationships...',
    'Extracting personality traits...',
    'Checking for deceased characters...',
    'Analyzing character roles...'
  ],
  WorldExtractor: [
    'Analyzing world setting...',
    'Detecting genre and time period...',
    'Extracting magic systems...',
    'Identifying technology level...',
    'Analyzing cultural elements...'
  ],
  LocationExtractor: [
    'Finding location names...',
    'Building location hierarchy...',
    'Analyzing geography...',
    'Detecting notable landmarks...',
    'Mapping regions and areas...'
  ],
  ItemExtractor: [
    'Searching for weapons...',
    'Finding magical artifacts...',
    'Detecting vehicles...',
    'Identifying important objects...',
    'Analyzing item properties...'
  ],
  FactionExtractor: [
    'Identifying organizations...',
    'Detecting guilds and groups...',
    'Analyzing faction hierarchies...',
    'Finding kingdom allegiances...',
    'Mapping faction relationships...'
  ],
  LoreExtractor: [
    'Extracting historical events...',
    'Finding myths and legends...',
    'Detecting magic rules...',
    'Analyzing cultural customs...',
    'Identifying prophecies...'
  ],
  EventExtractor: [
    'Finding planned story moments...',
    'Detecting confrontations...',
    'Analyzing character revelations...',
    'Identifying chase sequences...',
    'Extracting battle scenes...',
    'Finding emotional beats...'
  ]
};

// Pass-specific status messages (shown while pass is running)
const PASS_STATUS_MESSAGES = {
  1: [
    'Scanning document structure...',
    'Identifying content types...',
    'Estimating entity counts...',
    'Analyzing writing style...'
  ],
  3: [
    'Mapping character connections...',
    'Analyzing family trees...',
    'Detecting romantic relationships...',
    'Finding professional ties...',
    'Identifying location hierarchies...'
  ],
  4: [
    'Inferring missing details...',
    'Analyzing context clues...',
    'Detecting implicit information...',
    'Filling knowledge gaps...'
  ],
  4.5: [
    'Checking for duplicates...',
    'Analyzing cross-category matches...',
    'Resolving naming conflicts...',
    'Merging duplicate entries...'
  ],
  5: [
    'Validating extracted data...',
    'Merging duplicate entries...',
    'Preparing final results...',
    'Generating summary statistics...'
  ]
};

/**
 * Character badge with role indicator and prominent deceased status
 */
const CharacterBadge = memo(function CharacterBadge({ character }) {
  const roleIcons = { protagonist: Crown, antagonist: Swords, supporting: Shield };
  const RoleIcon = roleIcons[character.role];
  const isDeceased = character.is_deceased || character.vital_status_summary?.startsWith('DECEASED');

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs ${
        isDeceased
          ? 'bg-gray-800/80 text-gray-300 border border-red-500/50 ring-1 ring-red-500/30'
          : character.role === 'protagonist'
            ? 'bg-golden-500/20 text-golden-400'
            : character.role === 'antagonist'
              ? 'bg-red-500/20 text-red-400'
              : 'bg-purple-500/10 text-purple-300'
      }`}
      title={character.vital_status_summary || (isDeceased ? 'DECEASED' : 'ALIVE')}
    >
      {isDeceased && <Skull className="w-3 h-3 text-red-400" />}
      {RoleIcon && !isDeceased && <RoleIcon className="w-3 h-3" />}
      <span className="truncate max-w-[80px]">{character.name}</span>
      {isDeceased && <span className="text-red-400 font-bold text-[10px] ml-0.5">†</span>}
    </span>
  );
});

/**
 * Main ExtractionProgress component - LaunchScreen style
 */
export default function ExtractionProgress({ socket, roomId, onComplete, onError }) {
  const [currentPass, setCurrentPass] = useState(0);
  const [passStatuses, setPassStatuses] = useState({});
  const [agents, setAgents] = useState({});
  const [foundEntities, setFoundEntities] = useState({
    characters: [],
    world: null,
    locations: [],
    items: [],
    factions: [],
    lore: [],
    events: [],
    relationships: { count: 0 },
    deduplication: null
  });
  const [error, setError] = useState(null);
  const [isComplete, setIsComplete] = useState(false);
  const [timing, setTiming] = useState(null);
  const [pollingForResults, setPollingForResults] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [documentInfo, setDocumentInfo] = useState(null);
  const [startTime, setStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [currentActivity, setCurrentActivity] = useState({ message: 'Initializing extraction...', type: 'info' });
  const [rotatingMessageIndex, setRotatingMessageIndex] = useState(0);
  const [activeAgentDetail, setActiveAgentDetail] = useState(null);
  const getAuthHeaders = useCallback(() => {
    const token = getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  // Add activity and update current
  const addActivity = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setActivityLog(prev => [...prev.slice(-49), { message, type, timestamp }]);
    setCurrentActivity({ message, type, timestamp });
  };

  // Rotate through status messages while processing
  useEffect(() => {
    if (isComplete || error) return;

    const interval = setInterval(() => {
      setRotatingMessageIndex(prev => prev + 1);
    }, 2500); // Rotate every 2.5 seconds

    return () => clearInterval(interval);
  }, [isComplete, error]);

  // Get the appropriate rotating message based on current state
  const getRotatingMessage = useCallback(() => {
    // If we have an active agent detail from the server, show it
    if (activeAgentDetail) return activeAgentDetail;

    // Get running agents
    const runningAgents = Object.entries(agents)
      .filter(([_, status]) => status === 'running')
      .map(([name]) => name);

    // If agents are running, cycle through their messages
    if (runningAgents.length > 0 && currentPass === 2) {
      const agentIndex = rotatingMessageIndex % runningAgents.length;
      const agentName = runningAgents[agentIndex];
      const messages = AGENT_STATUS_MESSAGES[agentName];
      if (messages) {
        const msgIndex = Math.floor(rotatingMessageIndex / runningAgents.length) % messages.length;
        return messages[msgIndex];
      }
    }

    // Otherwise use pass-specific messages
    const passMessages = PASS_STATUS_MESSAGES[currentPass];
    if (passMessages) {
      return passMessages[rotatingMessageIndex % passMessages.length];
    }

    return currentActivity.message;
  }, [agents, currentPass, rotatingMessageIndex, currentActivity.message, activeAgentDetail]);

  // Timer
  useEffect(() => {
    if (startTime && !isComplete && !error) {
      const interval = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [startTime, isComplete, error]);

  // Polling fallback
  useEffect(() => {
    if (!roomId || isComplete || error) return;
    const pollTimeout = setTimeout(() => {
      if (currentPass === 0 && !isComplete) {
        setPollingForResults(true);
      }
    }, 5000);
    return () => clearTimeout(pollTimeout);
  }, [roomId, currentPass, isComplete, error]);

  useEffect(() => {
    if (!pollingForResults || !roomId || isComplete) return;
    let isCancelled = false;

    const pollInterval = setInterval(async () => {
      if (isCancelled) return;
      try {
        const API_BASE = import.meta.env.VITE_API_BASE || '/storyteller/api';
        const res = await fetch(`${API_BASE}/story-bible/bulk-import-advanced/${roomId}`, {
          headers: getAuthHeaders()
        });
        if (res.ok && !isCancelled) {
          const result = await res.json();
          if (result.success && result.data) {
            isCancelled = true;
            clearInterval(pollInterval);
            setIsComplete(true);
            setCurrentPass(5);
            setPollingForResults(false);
            if (result.data.characters) setFoundEntities(prev => ({ ...prev, characters: result.data.characters }));
            if (result.data.locations) setFoundEntities(prev => ({ ...prev, locations: result.data.locations }));
            if (result.data.items) setFoundEntities(prev => ({ ...prev, items: result.data.items }));
            if (result.data.factions) setFoundEntities(prev => ({ ...prev, factions: result.data.factions }));
            if (result.data.lore) setFoundEntities(prev => ({ ...prev, lore: result.data.lore }));
            if (result.data.world) setFoundEntities(prev => ({ ...prev, world: result.data.world }));
            if (result.data.deduplication) setFoundEntities(prev => ({ ...prev, deduplication: result.data.deduplication }));
            if (onComplete) onComplete(result);
          }
        }
      } catch (err) {
        console.error('[ExtractionProgress] Polling error:', err);
      }
    }, 3000);

    return () => { isCancelled = true; clearInterval(pollInterval); };
  }, [pollingForResults, roomId, isComplete, onComplete]);

  // Socket handlers
  useEffect(() => {
    if (!socket || !roomId) return;

    socket.emit('join-room', roomId);
    setStartTime(Date.now());

    const startTimer = setTimeout(() => {
      socket.emit('start-extraction', roomId);
    }, 100);

    socket.on('extraction:started', (data) => {
      setPollingForResults(false);
      const docSize = data.document_length || data.documentSize;
      if (docSize) {
        setDocumentInfo({ size: docSize, estimatedTokens: Math.round(docSize / 4) });
      }
      addActivity('GPT-4.1 agents analyzing your document...', 'start');
    });

    socket.on('extraction:pass', (data) => {
      setCurrentPass(data.pass);
      setPollingForResults(false);
      setPassStatuses(prev => ({ ...prev, [data.pass]: data.status }));

      const passInfo = PASS_CONFIG[data.pass];
      if (data.status === 'running' && passInfo) {
        addActivity(`Starting ${passInfo.name}...`, 'pass');
      } else if (data.status === 'complete' && passInfo) {
        addActivity(`${passInfo.name} complete`, 'complete');
      }
    });

    socket.on('extraction:agent', (data) => {
      setAgents(prev => ({ ...prev, [data.agent]: data.status }));
      const agentInfo = AGENT_CONFIG[data.agent];
      if (data.status === 'running' && agentInfo) {
        addActivity(`${agentInfo.name} agent searching...`, 'agent');
      } else if (data.status === 'complete' && agentInfo) {
        addActivity(`Found ${data.count || 0} ${agentInfo.name.toLowerCase()}`, 'discovery');
      }
    });

    socket.on('extraction:found', (data) => {
      if (data.type === 'world') {
        setFoundEntities(prev => ({ ...prev, world: data.data || { name: data.name, genre: data.genre } }));
        addActivity(`World: "${data.name}" (${data.genre || 'unknown'})`, 'discovery');
      } else if (data.type === 'characters' && data.data) {
        setFoundEntities(prev => ({ ...prev, characters: data.data }));
        const deceased = data.data.filter(c => c.is_deceased).length;
        addActivity(`Found ${data.data.length} characters${deceased > 0 ? ` (${deceased} deceased)` : ''}`, 'discovery');
      } else if (data.type === 'locations' && data.data) {
        setFoundEntities(prev => ({ ...prev, locations: data.data }));
        addActivity(`Found ${data.data.length} locations`, 'discovery');
      } else if (data.type === 'items' && data.data) {
        setFoundEntities(prev => ({ ...prev, items: data.data }));
        const magical = data.data.filter(i => i.is_magical).length;
        addActivity(`Found ${data.data.length} items${magical > 0 ? ` (${magical} magical)` : ''}`, 'discovery');
      } else if (data.type === 'factions' && data.data) {
        setFoundEntities(prev => ({ ...prev, factions: data.data }));
        addActivity(`Found ${data.data.length} factions/organizations`, 'discovery');
      } else if (data.type === 'lore' && data.data) {
        setFoundEntities(prev => ({ ...prev, lore: data.data }));
        addActivity(`Found ${data.data.length} lore entries`, 'discovery');
      } else if (data.type === 'events' && data.data) {
        setFoundEntities(prev => ({ ...prev, events: data.data }));
        addActivity(`Found ${data.data.length} story events`, 'discovery');
      } else if (data.type === 'relationships') {
        setFoundEntities(prev => ({
          ...prev,
          relationships: {
            count: data.count,
            data: data.data,
            metadata: data.metadata
          }
        }));
        addActivity(`Mapped ${data.count} relationships`, 'discovery');
      } else if (data.type === 'deduplication') {
        setFoundEntities(prev => ({ ...prev, deduplication: data.data }));
        if (data.data?.duplicates_found > 0) {
          addActivity(`Resolved ${data.data.duplicates_found} cross-category duplicates`, 'discovery');
        }
      }
    });

    // Handle detailed agent updates (from relationship mapper passes)
    socket.on('extraction:agent-detail', (data) => {
      if (data.detail) {
        addActivity(data.detail, 'agent');
        // Show this as the active detail for 4 seconds
        setActiveAgentDetail(data.detail);
        setTimeout(() => setActiveAgentDetail(null), 4000);
      }
    });

    socket.on('extraction:complete', (data) => {
      setIsComplete(true);
      setTiming(data.timing);
      addActivity(`Extraction complete in ${(data.timing?.total / 1000).toFixed(1)}s`, 'complete');
      if (onComplete) onComplete(data);
    });

    socket.on('extraction:error', (data) => {
      setError(data.error);
      addActivity(`Error: ${data.error}`, 'error');
      if (onError) onError(data.error);
    });

    return () => {
      clearTimeout(startTimer);
      socket.off('extraction:started');
      socket.off('extraction:pass');
      socket.off('extraction:agent');
      socket.off('extraction:found');
      socket.off('extraction:agent-detail');
      socket.off('extraction:complete');
      socket.off('extraction:error');
      socket.emit('leave-room', roomId);
    };
  }, [socket, roomId, onComplete, onError]);

  // Calculate progress
  const completedPasses = Object.entries(passStatuses).filter(([_, s]) => s === 'complete').length;
  const inProgressPasses = Object.entries(passStatuses).filter(([_, s]) => s === 'running').length;
  const progressPercent = isComplete ? 100 : ((completedPasses + (inProgressPasses * 0.5)) / 5) * 100;

  if (error) {
    return (
      <div className="p-6 bg-red-500/10 border border-red-500/30 rounded-xl">
        <div className="flex items-center gap-3 text-red-400">
          <AlertCircle className="w-6 h-6" />
          <div>
            <h3 className="font-medium">Extraction Failed</h3>
            <p className="text-sm text-red-300/80">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {/* Main Progress Container - Full Width, LaunchScreen style */}
      <div className="bg-gradient-to-b from-slate-800/95 to-slate-900/95 rounded-2xl border border-slate-600 overflow-hidden shadow-2xl">
        {/* Header with animated gradient */}
        <div className="relative px-6 py-4 bg-gradient-to-r from-purple-500/10 via-cyan-500/5 to-purple-500/10 border-b border-slate-700">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-400/5 via-transparent to-transparent" />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                {isComplete ? (
                  <CheckCircle2 className="w-8 h-8 text-green-400" />
                ) : (
                  <>
                    <Layers className="w-8 h-8 text-purple-400" />
                    <div className="absolute inset-0 animate-ping">
                      <Layers className="w-8 h-8 text-purple-400/30" />
                    </div>
                  </>
                )}
              </div>
              <div>
                <h2 className="text-2xl font-bold text-purple-400">
                  {isComplete ? 'Extraction Complete' : 'Extracting Story Bible'}
                </h2>
                <p className="text-slate-400 text-sm">
                  {isComplete
                    ? `Found ${foundEntities.characters.length} characters, ${foundEntities.locations.length} locations, ${foundEntities.items.length} items, ${foundEntities.factions.length} factions, ${foundEntities.lore.length} lore`
                    : 'GPT-4.1 agents analyzing your document'
                  }
                </p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-4xl font-bold text-purple-400">{Math.round(progressPercent)}%</div>
              <div className="text-slate-500 text-xs flex items-center gap-1 justify-end">
                <Clock className="w-3 h-3" />
                {elapsedTime}s elapsed
              </div>
            </div>
          </div>
        </div>

        {/* Full-Width Horizontal Progress Bar with Milestone Markers */}
        <div className="px-4 py-6 border-b border-slate-700/50">
          <div className="relative mx-8 md:mx-12 lg:mx-16">
            {/* Background track */}
            <div className="relative z-0 w-full h-4 bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-400 via-cyan-400 to-purple-500 relative transition-all duration-1000"
                style={{ width: `${progressPercent}%` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer" />
              </div>
            </div>

            {/* Milestone Markers */}
            <div className="absolute inset-0 z-20 flex items-center justify-between">
              {[1, 2, 3, 4, 5].map((pass) => {
                const config = PASS_CONFIG[pass];
                const Icon = config.icon;
                const position = (pass / 5) * 100;
                const status = passStatuses[pass];
                const isDone = status === 'complete';
                const isActive = status === 'running';
                const isRightEdge = position >= 90;
                const labelAlign = isRightEdge ? 'right-0' : 'left-1/2 -translate-x-1/2';

                return (
                  <div
                    key={pass}
                    className="absolute transform -translate-x-1/2"
                    style={{ left: `${position}%` }}
                  >
                    <div className={`
                      w-10 h-10 rounded-full flex items-center justify-center border-3 transition-all duration-500
                      ${isDone
                        ? 'bg-green-500 border-green-400 shadow-lg shadow-green-500/50 scale-110'
                        : isActive
                          ? 'bg-purple-500 border-purple-400 shadow-lg shadow-purple-500/50 animate-pulse scale-110'
                          : 'bg-slate-700 border-slate-600'}
                    `}>
                      {isDone ? (
                        <Check className="w-5 h-5 text-white" />
                      ) : isActive ? (
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      ) : (
                        <Icon className="w-5 h-5 text-slate-400" />
                      )}
                    </div>
                    <div className={`
                      absolute top-12 transform whitespace-nowrap text-xs font-medium
                      ${labelAlign}
                      ${isDone ? 'text-green-400' : isActive ? 'text-purple-400' : 'text-slate-500'}
                    `}>
                      <span className="hidden sm:inline">{config.name}</span>
                      <span className="sm:hidden">{config.shortName}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="h-8" /> {/* Spacer for labels */}
        </div>

        {/* Current Activity Panel */}
        <div className="px-6 py-4 bg-slate-900/50 border-b border-slate-700/50">
          <div className="flex items-start gap-4">
            <div className="relative flex-shrink-0">
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-purple-400/20 to-cyan-500/20 flex items-center justify-center border border-purple-500/30">
                {isComplete ? (
                  <CheckCircle2 className="w-7 h-7 text-green-400" />
                ) : (
                  <Loader2 className="w-7 h-7 text-purple-400 animate-spin" />
                )}
              </div>
              {!isComplete && (
                <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-green-500 animate-pulse border-2 border-slate-900" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-purple-400 font-bold text-lg">
                  {isComplete ? 'Ready for Review' : PASS_CONFIG[currentPass]?.name || 'Initializing...'}
                </span>
                {!isComplete && (
                  <span className="px-2 py-0.5 bg-purple-500/20 text-purple-400 text-xs rounded-full animate-pulse">
                    Active
                  </span>
                )}
              </div>
              {/* Rotating status message with smooth transition */}
              <p className="text-slate-300 text-sm mb-2 transition-all duration-300">
                {isComplete ? 'All extraction passes complete!' : getRotatingMessage()}
              </p>
              {!isComplete && (
                <div className="flex items-center gap-3">
                  <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                    {/* Progress bar based on running agents count */}
                    <div
                      className="h-full bg-gradient-to-r from-purple-400 to-cyan-400 rounded-full transition-all duration-1000"
                      style={{
                        width: currentPass === 2
                          ? `${Math.min(100, (Object.values(agents).filter(s => s === 'complete').length / 6) * 100)}%`
                          : '60%',
                        animation: currentPass === 2 ? 'none' : 'pulse 2s infinite'
                      }}
                    />
                  </div>
                  <Activity className="w-4 h-4 text-purple-400 animate-pulse" />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AI Extraction Agents Grid */}
        <div className="px-6 py-4">
          <h3 className="text-slate-300 font-semibold mb-3 flex items-center gap-2">
            <Users className="w-4 h-4 text-purple-400" />
            AI Extraction Agents
            {currentPass === 2 && (
              <span className="ml-auto text-slate-500 text-xs">
                {Object.values(agents).filter(s => s === 'complete').length}/7 complete
              </span>
            )}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {Object.entries(AGENT_CONFIG).map(([key, config]) => {
              const Icon = config.icon;
              const status = agents[key];
              const isRunning = status === 'running';
              const isDone = status === 'complete';
              const count = key === 'CharacterExtractor' ? foundEntities.characters.length :
                           key === 'LocationExtractor' ? foundEntities.locations.length :
                           key === 'ItemExtractor' ? foundEntities.items.length :
                           key === 'FactionExtractor' ? foundEntities.factions.length :
                           key === 'LoreExtractor' ? foundEntities.lore.length :
                           key === 'EventExtractor' ? foundEntities.events.length :
                           key === 'WorldExtractor' && foundEntities.world ? 1 : 0;

              // Get rotating status for this agent
              const agentMessages = AGENT_STATUS_MESSAGES[key] || [];
              const runningStatus = isRunning && agentMessages.length > 0
                ? agentMessages[rotatingMessageIndex % agentMessages.length]
                : 'Searching...';

              return (
                <div
                  key={key}
                  className={`p-3 rounded-xl border transition-all duration-300 ${
                    isRunning
                      ? 'bg-purple-500/10 border-purple-500/50 ring-2 ring-purple-500/20 scale-105'
                      : isDone
                        ? 'bg-green-500/10 border-green-500/30'
                        : 'bg-slate-800/50 border-slate-700 opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {isRunning ? (
                        <Loader2 className="w-4 h-4 text-purple-400 animate-spin" />
                      ) : isDone ? (
                        <CheckCircle2 className="w-4 h-4 text-green-400" />
                      ) : (
                        <Icon className="w-4 h-4 text-slate-500" />
                      )}
                      <span className={`text-xs font-medium ${
                        isRunning ? 'text-purple-300' :
                        isDone ? 'text-green-300' : 'text-slate-400'
                      }`}>{config.name}</span>
                    </div>
                    {count > 0 && (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${
                        isDone ? 'bg-green-500/20 text-green-400' :
                        isRunning ? 'bg-purple-500/20 text-purple-400 animate-pulse' :
                        'bg-slate-700 text-slate-400'
                      }`}>
                        {count}
                      </span>
                    )}
                  </div>
                  <p className={`text-xs truncate ${
                    isRunning ? 'text-purple-300/70' :
                    isDone ? 'text-green-300/70' : 'text-slate-500'
                  }`}>
                    {isDone ? `✓ ${count} found` : isRunning ? runningStatus : 'Waiting...'}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Extracted Entities Preview */}
        {(foundEntities.characters.length > 0 || foundEntities.locations.length > 0 || foundEntities.items.length > 0 || foundEntities.factions.length > 0 || foundEntities.lore.length > 0) && (
          <div className="px-6 py-4 border-t border-slate-700/50">
            <h3 className="text-slate-300 font-semibold mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-golden-400" />
              Found So Far
            </h3>

            {/* Characters Preview */}
            {foundEntities.characters.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <Users className="w-4 h-4 text-blue-400" />
                  <span className="text-blue-400 text-sm font-medium">
                    {foundEntities.characters.length} Characters
                  </span>
                  {(() => {
                    const deceasedCount = foundEntities.characters.filter(c =>
                      c.is_deceased || c.vital_status_summary?.startsWith('DECEASED')
                    ).length;
                    const aliveCount = foundEntities.characters.length - deceasedCount;
                    return deceasedCount > 0 && (
                      <span className="flex items-center gap-2 ml-2">
                        <span className="px-2 py-0.5 bg-green-500/10 text-green-400 text-xs rounded-full">
                          {aliveCount} alive
                        </span>
                        <span className="px-2 py-0.5 bg-red-500/20 text-red-400 text-xs rounded-full flex items-center gap-1">
                          <Skull className="w-3 h-3" />
                          {deceasedCount} deceased
                        </span>
                      </span>
                    );
                  })()}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {foundEntities.characters.slice(0, 12).map((char, i) => (
                    <CharacterBadge key={i} character={char} />
                  ))}
                  {foundEntities.characters.length > 12 && (
                    <span className="px-2 py-0.5 text-xs text-slate-500">
                      +{foundEntities.characters.length - 12} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Locations Preview */}
            {foundEntities.locations.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <MapPin className="w-4 h-4 text-cyan-400" />
                  <span className="text-cyan-400 text-sm font-medium">
                    {foundEntities.locations.length} Locations
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {foundEntities.locations.slice(0, 8).map((loc, i) => (
                    <span key={i} className="px-2 py-0.5 bg-cyan-500/10 text-cyan-300 rounded-full text-xs">
                      {loc.name}
                    </span>
                  ))}
                  {foundEntities.locations.length > 8 && (
                    <span className="px-2 py-0.5 text-xs text-slate-500">
                      +{foundEntities.locations.length - 8} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Items Preview */}
            {foundEntities.items.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <Sword className="w-4 h-4 text-orange-400" />
                  <span className="text-orange-400 text-sm font-medium">
                    {foundEntities.items.length} Items
                  </span>
                  {(() => {
                    const magicalCount = foundEntities.items.filter(i => i.is_magical).length;
                    return magicalCount > 0 && (
                      <span className="px-2 py-0.5 bg-violet-500/20 text-violet-400 text-xs rounded-full">
                        {magicalCount} magical
                      </span>
                    );
                  })()}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {foundEntities.items.slice(0, 8).map((item, i) => (
                    <span key={i} className={`px-2 py-0.5 rounded-full text-xs ${
                      item.rarity === 'legendary' ? 'bg-yellow-500/20 text-yellow-300' :
                      item.rarity === 'very_rare' ? 'bg-purple-500/20 text-purple-300' :
                      item.rarity === 'rare' ? 'bg-blue-500/20 text-blue-300' :
                      'bg-orange-500/10 text-orange-300'
                    }`}>
                      {item.name}
                    </span>
                  ))}
                  {foundEntities.items.length > 8 && (
                    <span className="px-2 py-0.5 text-xs text-slate-500">
                      +{foundEntities.items.length - 8} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Factions Preview */}
            {foundEntities.factions.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="w-4 h-4 text-rose-400" />
                  <span className="text-rose-400 text-sm font-medium">
                    {foundEntities.factions.length} Factions
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {foundEntities.factions.slice(0, 8).map((faction, i) => (
                    <span key={i} className={`px-2 py-0.5 rounded-full text-xs ${
                      faction.alignment?.includes('good') ? 'bg-green-500/20 text-green-300' :
                      faction.alignment?.includes('evil') ? 'bg-red-500/20 text-red-300' :
                      'bg-rose-500/10 text-rose-300'
                    }`}>
                      {faction.name}
                    </span>
                  ))}
                  {foundEntities.factions.length > 8 && (
                    <span className="px-2 py-0.5 text-xs text-slate-500">
                      +{foundEntities.factions.length - 8} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Lore Preview */}
            {foundEntities.lore.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <BookOpen className="w-4 h-4 text-purple-400" />
                  <span className="text-purple-400 text-sm font-medium">
                    {foundEntities.lore.length} Lore Entries
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {foundEntities.lore.slice(0, 6).map((lore, i) => (
                    <span key={i} className="px-2 py-0.5 bg-purple-500/10 text-purple-300 rounded-full text-xs">
                      {lore.title}
                    </span>
                  ))}
                  {foundEntities.lore.length > 6 && (
                    <span className="px-2 py-0.5 text-xs text-slate-500">
                      +{foundEntities.lore.length - 6} more
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Relationships Preview */}
            {foundEntities.relationships?.count > 0 && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <Link2 className="w-4 h-4 text-amber-400" />
                  <span className="text-amber-400 text-sm font-medium">
                    {foundEntities.relationships.count} Relationships Mapped
                  </span>
                </div>
                {foundEntities.relationships.data && (
                  <div className="flex flex-wrap gap-1.5">
                    {foundEntities.relationships.data.character_relationships?.length > 0 && (
                      <span className="px-2 py-0.5 bg-amber-500/10 text-amber-300 rounded-full text-xs">
                        {foundEntities.relationships.data.character_relationships.length} Character Links
                      </span>
                    )}
                    {foundEntities.relationships.data.character_location_links?.length > 0 && (
                      <span className="px-2 py-0.5 bg-cyan-500/10 text-cyan-300 rounded-full text-xs">
                        {foundEntities.relationships.data.character_location_links.length} Location Links
                      </span>
                    )}
                    {foundEntities.relationships.data.character_lore_links?.length > 0 && (
                      <span className="px-2 py-0.5 bg-purple-500/10 text-purple-300 rounded-full text-xs">
                        {foundEntities.relationships.data.character_lore_links.length} Lore Links
                      </span>
                    )}
                    {foundEntities.relationships.data.faction_memberships?.length > 0 && (
                      <span className="px-2 py-0.5 bg-red-500/10 text-red-300 rounded-full text-xs">
                        {foundEntities.relationships.data.faction_memberships.length} Factions
                      </span>
                    )}
                    {foundEntities.relationships.data.location_hierarchy?.length > 0 && (
                      <span className="px-2 py-0.5 bg-blue-500/10 text-blue-300 rounded-full text-xs">
                        {foundEntities.relationships.data.location_hierarchy.length} Hierarchies
                      </span>
                    )}
                  </div>
                )}
                {foundEntities.relationships.metadata?.relationship_density && (
                  <div className="mt-2 text-xs text-slate-500">
                    Relationship density: <span className="text-amber-400">{foundEntities.relationships.metadata.relationship_density}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Activity Log - Compact inline display */}
        <div className="px-6 py-3 border-t border-slate-700/50">
          <div className="flex items-center gap-3 text-xs">
            <Activity className="w-3 h-3 text-purple-400 animate-pulse flex-shrink-0" />
            <span className="text-slate-500">Latest:</span>
            <span className="text-slate-300 flex-1 truncate">
              {activityLog.length > 0 ? activityLog[activityLog.length - 1].message : 'Initializing...'}
            </span>
          </div>
        </div>

        {/* Document Info & Stats Bar */}
        <div className="px-6 py-3 bg-slate-900/80 border-t border-slate-700/50 flex items-center justify-between text-xs">
          <div className="flex items-center gap-4">
            {documentInfo && (
              <div className="flex items-center gap-1.5">
                <FileSearch className="w-3 h-3 text-blue-400" />
                <span className="text-slate-400">Document:</span>
                <span className="text-blue-400 font-medium">{documentInfo.size.toLocaleString()} chars</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <Users className="w-3 h-3 text-purple-400" />
              <span className="text-slate-400">Entities:</span>
              <span className="text-purple-400 font-medium">
                {foundEntities.characters.length + foundEntities.locations.length + foundEntities.items.length + foundEntities.factions.length + foundEntities.lore.length + (foundEntities.world ? 1 : 0)}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3 h-3 text-slate-500" />
            <span className="text-slate-500">{isComplete ? 'Complete' : 'Processing...'}</span>
          </div>
        </div>
      </div>

      {/* Completion Message */}
      {isComplete && timing && (
        <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-xl">
          <div className="flex items-center gap-3 text-green-400">
            <CheckCircle2 className="w-6 h-6" />
            <div>
              <span className="font-medium">Extraction complete in {(timing.total / 1000).toFixed(1)}s</span>
              <p className="text-green-300/70 text-sm mt-1">
                Ready to review and save to your library
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Shimmer animation */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </div>
  );
}
