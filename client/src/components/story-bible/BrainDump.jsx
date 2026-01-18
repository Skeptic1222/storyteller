/**
 * BrainDump - Advanced import tab for Story Bible
 *
 * Features:
 * - Upload multiple documents (PDF, images, text)
 * - Paste multiple content blocks
 * - Advanced "Refine with AI" before extraction
 * - AI Extraction creates: characters, locations, items, factions, lore, AND synopsis
 * - Does NOT auto-create outline/beats (user perfects synopsis first)
 */

import { useState, useRef, useEffect } from 'react';
import {
  FileUp, Upload, Trash2, Plus, Sparkles, Wand2, Loader2, X,
  FileText, Image, File, Send, AlertCircle, Check, ChevronDown, ChevronUp
} from 'lucide-react';
import { apiCall, API_BASE } from '../../config';
import { getStoredToken } from '../../utils/authToken';
import ExtractionProgress from './ExtractionProgress';
import ImportPreview from './ImportPreview';

export default function BrainDump({
  libraryId,
  libraryName,
  socket,
  onExtractionComplete,
  onDataRefresh
}) {
  // Content blocks state - each block can be text or file
  const [contentBlocks, setContentBlocks] = useState([
    { id: Date.now(), type: 'text', content: '', fileName: null }
  ]);

  // Refinement state
  const [refinementPrompt, setRefinementPrompt] = useState('');
  const [isRefining, setIsRefining] = useState(false);
  const [refinementHistory, setRefinementHistory] = useState([]);
  const [showRefinementHistory, setShowRefinementHistory] = useState(false);

  // Extraction state
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionRoomId, setExtractionRoomId] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [extractedLibraryId, setExtractedLibraryId] = useState(null);
  const [isSavingExtracted, setIsSavingExtracted] = useState(false);
  const [error, setError] = useState(null);

  const fileInputRef = useRef(null);
  const activeBlockRef = useRef(null);
  const getAuthHeaders = () => {
    const token = getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  // Add a new content block
  const addContentBlock = (type = 'text') => {
    setContentBlocks(prev => [
      ...prev,
      { id: Date.now(), type, content: '', fileName: null }
    ]);
  };

  // Remove a content block
  const removeContentBlock = (id) => {
    if (contentBlocks.length > 1) {
      setContentBlocks(prev => prev.filter(block => block.id !== id));
    }
  };

  // Update a content block
  const updateContentBlock = (id, updates) => {
    setContentBlocks(prev => prev.map(block =>
      block.id === id ? { ...block, ...updates } : block
    ));
  };

  // Handle file upload for a specific block
  const handleFileUpload = async (blockId, file) => {
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      // For text files, read content directly
      if (file.type === 'text/plain' || file.type === 'text/markdown') {
        const text = await file.text();
        updateContentBlock(blockId, {
          type: 'file',
          content: text,
          fileName: file.name
        });
      } else {
        // For PDFs and images, upload and extract
        const response = await fetch(`${API_BASE}/story-bible/extract-file`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: formData
        });
        const data = await response.json();

        if (data.text) {
          updateContentBlock(blockId, {
            type: 'file',
            content: data.text,
            fileName: file.name
          });
        }
      }
    } catch (error) {
      console.error('Failed to process file:', error);
      setError(`Failed to process ${file.name}: ${error.message}`);
    }
  };

  // Handle file input change
  const handleFileInputChange = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // If we have an active block waiting for a file, use that
    if (activeBlockRef.current) {
      handleFileUpload(activeBlockRef.current, files[0]);
      activeBlockRef.current = null;
    } else {
      // Add new blocks for each file
      files.forEach(file => {
        const newBlockId = Date.now() + Math.random();
        setContentBlocks(prev => [
          ...prev,
          { id: newBlockId, type: 'file', content: '', fileName: file.name }
        ]);
        handleFileUpload(newBlockId, file);
      });
    }

    // Reset file input
    e.target.value = '';
  };

  // Trigger file input for a specific block
  const triggerFileInput = (blockId) => {
    activeBlockRef.current = blockId;
    fileInputRef.current?.click();
  };

  // Combine all content for extraction
  const getCombinedContent = () => {
    return contentBlocks
      .filter(block => block.content.trim())
      .map(block => {
        if (block.fileName) {
          return `--- Content from: ${block.fileName} ---\n${block.content}`;
        }
        return block.content;
      })
      .join('\n\n---\n\n');
  };

  // Refine content with AI before extraction
  const handleRefine = async () => {
    if (!refinementPrompt.trim()) return;

    setIsRefining(true);
    setError(null);

    try {
      const combinedContent = getCombinedContent();

      const res = await apiCall('/story-bible/refine-brain-dump', {
        method: 'POST',
        body: JSON.stringify({
          content: combinedContent,
          instruction: refinementPrompt,
          library_id: libraryId
        })
      });

      if (!res.ok) {
        throw new Error('Failed to refine content');
      }
      const response = await res.json();

      if (response.refined_content) {
        // Replace the first text block with refined content, or add new one
        const firstTextBlock = contentBlocks.find(b => b.type === 'text');
        if (firstTextBlock) {
          updateContentBlock(firstTextBlock.id, { content: response.refined_content });
        } else {
          setContentBlocks([{
            id: Date.now(),
            type: 'text',
            content: response.refined_content,
            fileName: null
          }]);
        }

        // Add to refinement history
        setRefinementHistory(prev => [...prev, {
          prompt: refinementPrompt,
          timestamp: new Date().toISOString()
        }]);
      }

      setRefinementPrompt('');
    } catch (error) {
      console.error('Failed to refine content:', error);
      setError('Failed to refine content. Please try again.');
    } finally {
      setIsRefining(false);
    }
  };

  // Start AI extraction
  const handleStartExtraction = async () => {
    const combinedContent = getCombinedContent();

    if (!combinedContent.trim()) {
      setError('Please add some content before extracting.');
      return;
    }

    setIsExtracting(true);
    setError(null);

    try {
      // Start extraction - this will create a new library with extracted content + synopsis
      const res = await apiCall('/story-bible/extract-advanced', {
        method: 'POST',
        body: JSON.stringify({
          content: combinedContent,
          library_id: libraryId,
          library_name: libraryName,
          generate_synopsis: true // Auto-generate synopsis
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to start extraction');
      }
      const response = await res.json();

      if (response.room_id) {
        // Join socket room to receive progress updates
        if (socket) {
          socket.emit('join-room', response.room_id);
        }
        setExtractionRoomId(response.room_id);
        if (response.library_id) {
          setExtractedLibraryId(response.library_id);
        }
      } else {
        throw new Error('No extraction room ID returned');
      }
    } catch (error) {
      console.error('Failed to start extraction:', error);
      setError('Failed to start extraction. Please try again.');
      setIsExtracting(false);
    }
  };

  // Handle extraction complete
  const handleExtractionComplete = (result) => {
    // Extract the actual data from the result (result.data contains characters, world, etc.)
    const extractedEntities = result.data || result;
    console.log('[BrainDump] Extraction complete, entities:', {
      characters: extractedEntities.characters?.length || 0,
      locations: extractedEntities.locations?.length || 0,
      items: extractedEntities.items?.length || 0,
      factions: extractedEntities.factions?.length || 0,
      lore: extractedEntities.lore?.length || 0
    });
    setExtractedData(extractedEntities);
    setExtractionRoomId(null);
    setIsExtracting(false);
  };

  // Handle extraction error
  const handleExtractionError = (errorMsg) => {
    setError(errorMsg);
    setExtractionRoomId(null);
    setIsExtracting(false);
  };

  // Save extracted data
  const handleSaveExtracted = async (editedData) => {
    setIsSavingExtracted(true);

    try {
      const res = await apiCall('/story-bible/save-extracted', {
        method: 'POST',
        body: JSON.stringify({
          library_id: extractedLibraryId || libraryId,
          data: editedData
        })
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to save extracted data');
      }
      const response = await res.json();

      if (response.success) {
        // Reset state
        setExtractedData(null);
        setContentBlocks([{ id: Date.now(), type: 'text', content: '', fileName: null }]);
        setRefinementHistory([]);

        // Notify parent to refresh data
        if (onDataRefresh) {
          onDataRefresh(extractedLibraryId || libraryId);
        }
        if (onExtractionComplete) {
          onExtractionComplete(response);
        }
      }
    } catch (error) {
      console.error('Failed to save extracted data:', error);
      setError('Failed to save extracted data. Please try again.');
    } finally {
      setIsSavingExtracted(false);
    }
  };

  // Cancel extraction
  const handleCancelExtraction = () => {
    setExtractedData(null);
    setExtractionRoomId(null);
    setIsExtracting(false);
    setExtractedLibraryId(null);
  };

  // Check if we have any content
  const hasContent = contentBlocks.some(block => block.content.trim());

  // Show extraction progress
  if (extractionRoomId) {
    return (
      <div className="space-y-6">
        <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
          <h3 className="text-lg font-medium text-white mb-4 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            AI Extraction in Progress
          </h3>
          <ExtractionProgress
            socket={socket}
            roomId={extractionRoomId}
            onComplete={handleExtractionComplete}
            onError={handleExtractionError}
          />
          <div className="mt-4 flex justify-end">
            <button
              onClick={handleCancelExtraction}
              className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Show import preview/editor
  if (extractedData) {
    return (
      <div className="space-y-6">
        <ImportPreview
          data={extractedData}
          onSave={handleSaveExtracted}
          onCancel={handleCancelExtraction}
          isSaving={isSavingExtracted}
        />
      </div>
    );
  }

  // Main brain dump interface
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-purple-500/20 rounded-xl flex items-center justify-center">
            <Wand2 className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Brain Dump</h2>
            <p className="text-sm text-slate-400">
              Dump all your story ideas, character sheets, and worldbuilding notes here
            </p>
          </div>
        </div>

        <p className="text-slate-400 text-sm mb-4">
          Upload documents, paste content, or write freely. When ready, click "AI Extract" to automatically
          create characters, locations, items, factions, lore, and a synopsis from your content.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2 text-red-300">
            <AlertCircle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Content Blocks */}
      <div className="space-y-4">
        {contentBlocks.map((block, index) => (
          <div key={block.id} className="bg-slate-800/50 rounded-xl border border-slate-700/50 overflow-hidden">
            {/* Block Header */}
            <div className="flex items-center justify-between px-4 py-2 bg-slate-900/50 border-b border-slate-700/50">
              <div className="flex items-center gap-2 text-sm text-slate-400">
                {block.type === 'file' ? (
                  <>
                    <FileText className="w-4 h-4" />
                    <span>{block.fileName || 'Uploaded File'}</span>
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4" />
                    <span>Content Block {index + 1}</span>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => triggerFileInput(block.id)}
                  className="p-1.5 text-slate-400 hover:text-white transition-colors"
                  title="Upload file"
                >
                  <Upload className="w-4 h-4" />
                </button>
                {contentBlocks.length > 1 && (
                  <button
                    onClick={() => removeContentBlock(block.id)}
                    className="p-1.5 text-red-400 hover:text-red-300 transition-colors"
                    title="Remove block"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* Block Content */}
            <textarea
              value={block.content}
              onChange={(e) => updateContentBlock(block.id, { content: e.target.value })}
              placeholder="Paste character sheets, story notes, worldbuilding ideas, or any content..."
              rows={8}
              className="w-full px-4 py-3 bg-transparent text-slate-200 placeholder-slate-500
                       text-sm resize-y focus:outline-none min-h-[150px]"
            />
          </div>
        ))}

        {/* Add Block Button */}
        <div className="flex gap-2">
          <button
            onClick={() => addContentBlock('text')}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700/50 hover:bg-slate-700
                     text-slate-300 rounded-lg text-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Text Block
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700/50 hover:bg-slate-700
                     text-slate-300 rounded-lg text-sm transition-colors"
          >
            <FileUp className="w-4 h-4" />
            Upload Files
          </button>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.pdf,image/*"
          onChange={handleFileInputChange}
          className="hidden"
        />
      </div>

      {/* Refine with AI Section */}
      <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-700/50">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            Refine with AI
          </h3>
          {refinementHistory.length > 0 && (
            <button
              onClick={() => setShowRefinementHistory(!showRefinementHistory)}
              className="text-sm text-slate-400 hover:text-white flex items-center gap-1"
            >
              {showRefinementHistory ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              History ({refinementHistory.length})
            </button>
          )}
        </div>

        <p className="text-slate-400 text-sm mb-4">
          Refine your content before extraction. Ask AI to expand details, add more characters,
          clarify relationships, or improve descriptions.
        </p>

        {showRefinementHistory && refinementHistory.length > 0 && (
          <div className="mb-4 p-3 bg-slate-900/50 rounded-lg max-h-32 overflow-y-auto">
            {refinementHistory.map((item, index) => (
              <div key={index} className="text-xs text-slate-400 mb-1">
                <span className="text-slate-500">{new Date(item.timestamp).toLocaleTimeString()}:</span> {item.prompt}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <input
            type="text"
            value={refinementPrompt}
            onChange={(e) => setRefinementPrompt(e.target.value)}
            placeholder="e.g., 'Add more detail to the villain's backstory' or 'Create relationships between characters'"
            className="flex-1 px-4 py-2.5 bg-slate-900/50 border border-slate-600 rounded-xl
                     text-white placeholder-slate-500 text-sm focus:outline-none focus:border-purple-500"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleRefine();
              }
            }}
            disabled={!hasContent}
          />
          <button
            onClick={handleRefine}
            disabled={isRefining || !refinementPrompt.trim() || !hasContent}
            className="px-4 py-2.5 bg-purple-500 hover:bg-purple-600 disabled:bg-purple-500/50
                     text-white rounded-xl transition-colors flex items-center gap-2"
          >
            {isRefining ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Extract Button */}
      <div className="bg-gradient-to-r from-purple-500/20 to-amber-500/20 rounded-xl p-6 border border-purple-500/30">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-white mb-1">Ready to Extract?</h3>
            <p className="text-sm text-slate-400">
              AI will create characters, locations, items, factions, lore, and a synopsis from your content.
            </p>
          </div>
          <button
            onClick={handleStartExtraction}
            disabled={isExtracting || !hasContent}
            className="flex items-center gap-2 px-6 py-3 bg-purple-500 hover:bg-purple-600
                     disabled:bg-purple-500/50 text-white font-medium rounded-xl transition-colors"
          >
            {isExtracting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Extracting...
              </>
            ) : (
              <>
                <Wand2 className="w-5 h-5" />
                AI Extract
              </>
            )}
          </button>
        </div>
      </div>

      {/* Info Box */}
      <div className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30">
        <h4 className="text-sm font-medium text-slate-300 mb-2">What happens when you extract:</h4>
        <ul className="text-sm text-slate-400 space-y-1">
          <li className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400" />
            Characters, locations, items, factions, and lore are automatically created
          </li>
          <li className="flex items-center gap-2">
            <Check className="w-4 h-4 text-green-400" />
            A synopsis is generated based on your content
          </li>
          <li className="flex items-center gap-2">
            <Check className="w-4 h-4 text-amber-400" />
            You can edit everything before saving
          </li>
          <li className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-slate-500" />
            Outline and chapter beats are NOT auto-generated (do this after perfecting your synopsis)
          </li>
        </ul>
      </div>
    </div>
  );
}
