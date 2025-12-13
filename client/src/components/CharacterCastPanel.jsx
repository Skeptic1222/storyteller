/**
 * CharacterCastPanel Component
 * Displays character voice assignments in a "Starring" format
 */

import React, { useState } from 'react';
import { Users, ChevronDown, ChevronUp, Mic, User, Star } from 'lucide-react';

function CharacterCastPanel({
  characters = [],
  totalCharacters = 0,
  totalVoices = 0,
  compact = false
}) {
  const [expanded, setExpanded] = useState(false);

  if (characters.length === 0) {
    return null;
  }

  // Separate narrator from characters
  const narrator = characters.find(c => c.isNarrator);
  const characterVoices = characters.filter(c => !c.isNarrator);

  return (
    <div className="cast-panel">
      <button
        className="cast-header"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="cast-icon">
          <Users size={16} />
        </div>
        <div className="cast-summary">
          <div className="cast-title">Voice Cast</div>
          <div className="cast-count">
            {totalVoices} voice{totalVoices > 1 ? 's' : ''} for {totalCharacters} character{totalCharacters > 1 ? 's' : ''}
          </div>
        </div>
        <div className="expand-icon">
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>
      </button>

      {expanded && (
        <div className="cast-details">
          {/* Main Narrator */}
          {narrator && (
            <div className="cast-member narrator">
              <div className="member-icon narrator-icon">
                <Star size={12} />
              </div>
              <div className="member-info">
                <div className="member-role">Narrator</div>
                <div className="member-voice">{narrator.voiceName}</div>
                {narrator.voiceDescription && (
                  <div className="member-desc">{narrator.voiceDescription}</div>
                )}
              </div>
            </div>
          )}

          {/* Character Voices */}
          {characterVoices.map((character, index) => (
            <div key={index} className="cast-member">
              <div className="member-icon">
                <User size={12} />
              </div>
              <div className="member-info">
                <div className="member-role">{character.name}</div>
                <div className="member-voice">{character.voiceName}</div>
                {character.voiceDescription && (
                  <div className="member-desc">{character.voiceDescription}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Compact "Starring" line when not expanded */}
      {!expanded && (
        <div className="starring-line">
          <span className="starring-label">Starring:</span>
          <span className="starring-names">
            {characters.slice(0, 3).map(c => c.voiceName).join(', ')}
            {characters.length > 3 && ` +${characters.length - 3} more`}
          </span>
        </div>
      )}

      <style>{`
        .cast-panel {
          background: rgba(0, 0, 0, 0.4);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 8px;
          overflow: hidden;
        }

        .cast-header {
          display: flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          padding: 12px;
          background: transparent;
          border: none;
          cursor: pointer;
          color: rgba(255, 255, 255, 0.9);
          text-align: left;
          transition: background 0.2s;
        }

        .cast-header:hover {
          background: rgba(255, 255, 255, 0.05);
        }

        .cast-icon {
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(34, 197, 94, 0.2);
          border-radius: 6px;
          color: #4ade80;
        }

        .cast-summary {
          flex: 1;
        }

        .cast-title {
          font-size: 14px;
          font-weight: 500;
        }

        .cast-count {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.5);
          margin-top: 2px;
        }

        .expand-icon {
          color: rgba(255, 255, 255, 0.5);
        }

        .cast-details {
          padding: 0 12px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.05);
          padding-top: 8px;
        }

        .cast-member {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 8px;
          background: rgba(255, 255, 255, 0.02);
          border-radius: 6px;
        }

        .cast-member.narrator {
          background: rgba(234, 179, 8, 0.1);
          border-left: 2px solid #eab308;
        }

        .member-icon {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 50%;
          color: rgba(255, 255, 255, 0.6);
          flex-shrink: 0;
        }

        .member-icon.narrator-icon {
          background: rgba(234, 179, 8, 0.3);
          color: #fbbf24;
        }

        .member-info {
          flex: 1;
          min-width: 0;
        }

        .member-role {
          font-size: 12px;
          font-weight: 500;
          color: rgba(255, 255, 255, 0.9);
        }

        .member-voice {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.6);
          margin-top: 2px;
        }

        .member-desc {
          font-size: 10px;
          color: rgba(255, 255, 255, 0.4);
          margin-top: 2px;
          font-style: italic;
        }

        .starring-line {
          padding: 0 12px 12px;
          font-size: 12px;
          color: rgba(255, 255, 255, 0.6);
        }

        .starring-label {
          color: rgba(255, 255, 255, 0.4);
          margin-right: 6px;
        }

        .starring-names {
          color: rgba(255, 255, 255, 0.8);
        }
      `}</style>
    </div>
  );
}

export default CharacterCastPanel;
