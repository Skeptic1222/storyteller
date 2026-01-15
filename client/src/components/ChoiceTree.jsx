import { useState, useMemo, memo } from 'react';
import { ChevronRight, ChevronDown, RotateCcw, MapPin, Circle, CheckCircle } from 'lucide-react';

/**
 * CYOA Choice Tree Visualization
 * Shows the branching paths taken in a Choose Your Own Adventure story
 */
const ChoiceTree = memo(function ChoiceTree({
  choiceHistory = [],
  checkpoints = [],
  currentSceneIndex = 0,
  onBacktrack,
  allowBacktrack = true
}) {
  const [expandedNodes, setExpandedNodes] = useState(new Set([0]));
  const [selectedNode, setSelectedNode] = useState(null);

  // Build tree structure from choice history
  const treeData = useMemo(() => {
    if (choiceHistory.length === 0) {
      return [{
        id: 'start',
        label: 'Story Start',
        sceneIndex: 0,
        isStart: true,
        isCurrent: currentSceneIndex === 0,
        children: []
      }];
    }

    // Create nodes from choices
    const nodes = [{
      id: 'start',
      label: 'Story Start',
      sceneIndex: 0,
      isStart: true,
      isCurrent: false,
      children: []
    }];

    let parentNode = nodes[0];

    choiceHistory.forEach((choice, index) => {
      const node = {
        id: `choice-${index}`,
        label: choice.choiceText || `Choice ${choice.choiceKey}`,
        choiceKey: choice.choiceKey,
        sceneIndex: choice.sceneIndex,
        timestamp: choice.timestamp,
        isChoice: true,
        isCurrent: choice.sceneIndex === currentSceneIndex,
        hasCheckpoint: checkpoints.some(cp => cp.sceneIndex === choice.sceneIndex),
        children: []
      };

      parentNode.children.push(node);
      parentNode = node;
    });

    // Mark the last node's connection to current scene
    if (parentNode && currentSceneIndex > parentNode.sceneIndex) {
      parentNode.children.push({
        id: 'current',
        label: `Chapter ${currentSceneIndex + 1}`,
        sceneIndex: currentSceneIndex,
        isCurrent: true,
        children: []
      });
    }

    return nodes;
  }, [choiceHistory, checkpoints, currentSceneIndex]);

  const toggleNode = (nodeId) => {
    setExpandedNodes(prev => {
      const newSet = new Set(prev);
      if (newSet.has(nodeId)) {
        newSet.delete(nodeId);
      } else {
        newSet.add(nodeId);
      }
      return newSet;
    });
  };

  const handleNodeClick = (node) => {
    setSelectedNode(node.id);
  };

  const handleBacktrack = (node) => {
    if (!allowBacktrack || !onBacktrack) return;

    // Find the checkpoint index for this node
    const checkpointIndex = checkpoints.findIndex(cp => cp.sceneIndex === node.sceneIndex);
    if (checkpointIndex >= 0) {
      onBacktrack(checkpointIndex);
    }
  };

  // Render a single tree node
  const renderNode = (node, depth = 0, isLastChild = true) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expandedNodes.has(depth);
    const isSelected = selectedNode === node.id;

    return (
      <div key={node.id} className="relative">
        {/* Connection line from parent */}
        {depth > 0 && (
          <div className="absolute left-3 -top-3 w-px h-3 bg-slate-600" />
        )}

        {/* Node */}
        <div
          className={`
            flex items-center gap-2 py-2 px-3 rounded-lg cursor-pointer transition-all
            ${node.isCurrent ? 'bg-golden-400/20 border border-golden-400' : ''}
            ${isSelected && !node.isCurrent ? 'bg-slate-700 border border-slate-500' : ''}
            ${!node.isCurrent && !isSelected ? 'hover:bg-slate-800' : ''}
          `}
          style={{ marginLeft: `${depth * 24}px` }}
          onClick={() => handleNodeClick(node)}
        >
          {/* Expand/collapse button */}
          {hasChildren ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleNode(depth); }}
              className="p-0.5 hover:bg-slate-600 rounded"
            >
              {isExpanded ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </button>
          ) : (
            <div className="w-5" /> // Spacer
          )}

          {/* Node icon */}
          {node.isStart ? (
            <MapPin className="w-4 h-4 text-green-400" />
          ) : node.isCurrent ? (
            <Circle className="w-4 h-4 text-golden-400 fill-golden-400" />
          ) : node.hasCheckpoint ? (
            <CheckCircle className="w-4 h-4 text-amber-400" />
          ) : (
            <Circle className="w-4 h-4 text-slate-500" />
          )}

          {/* Node label */}
          <span className={`text-sm flex-1 ${node.isCurrent ? 'text-golden-400 font-medium' : 'text-slate-200'}`}>
            {node.label}
          </span>

          {/* Backtrack button for checkpoints */}
          {node.hasCheckpoint && allowBacktrack && !node.isCurrent && (
            <button
              onClick={(e) => { e.stopPropagation(); handleBacktrack(node); }}
              className="p-1 hover:bg-amber-400/20 rounded text-amber-400"
              title="Go back to this choice"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}

          {/* Current indicator */}
          {node.isCurrent && (
            <span className="text-[10px] text-golden-400 bg-golden-400/20 px-1.5 py-0.5 rounded">
              Now
            </span>
          )}
        </div>

        {/* Children */}
        {hasChildren && isExpanded && (
          <div className="relative">
            {/* Vertical line connecting children */}
            {node.children.length > 1 && (
              <div
                className="absolute left-6 top-0 w-px bg-slate-600"
                style={{
                  height: `calc(100% - 20px)`,
                  marginLeft: `${depth * 24}px`
                }}
              />
            )}
            {node.children.map((child, index) => (
              renderNode(child, depth + 1, index === node.children.length - 1)
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="bg-slate-800/90 rounded-xl p-4 max-h-80 overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-700">
        <h3 className="text-amber-400 font-medium text-sm flex items-center gap-2">
          <MapPin className="w-4 h-4" />
          Your Journey
        </h3>
        <span className="text-slate-500 text-xs">
          {choiceHistory.length} choices made
        </span>
      </div>

      {/* Tree */}
      <div className="space-y-1">
        {treeData.map((node, index) => renderNode(node, 0, index === treeData.length - 1))}
      </div>

      {/* Legend */}
      <div className="mt-4 pt-2 border-t border-slate-700 flex items-center gap-4 text-[10px] text-slate-500">
        <div className="flex items-center gap-1">
          <Circle className="w-3 h-3 text-golden-400 fill-golden-400" />
          <span>Current</span>
        </div>
        <div className="flex items-center gap-1">
          <CheckCircle className="w-3 h-3 text-amber-400" />
          <span>Checkpoint</span>
        </div>
        {allowBacktrack && (
          <div className="flex items-center gap-1">
            <RotateCcw className="w-3 h-3 text-amber-400" />
            <span>Can backtrack</span>
          </div>
        )}
      </div>
    </div>
  );
});

export default ChoiceTree;
