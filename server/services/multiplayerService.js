/**
 * Multiplayer Session Service
 * Manages participants, turns, and collaborative storytelling
 */

import { pool } from '../database/pool.js';
import { logger } from '../utils/logger.js';

export class MultiplayerService {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.session = null;
    this.participants = [];
  }

  /**
   * Load session and participants
   */
  async loadSession() {
    const result = await pool.query(
      'SELECT * FROM story_sessions WHERE id = $1',
      [this.sessionId]
    );

    if (result.rows.length === 0) {
      throw new Error('Session not found');
    }

    this.session = result.rows[0];

    // Load participants
    const participantsResult = await pool.query(`
      SELECT sp.*, c.name as character_name
      FROM session_participants sp
      LEFT JOIN characters c ON sp.character_id = c.id
      WHERE sp.story_session_id = $1 AND sp.is_active = true
      ORDER BY sp.joined_at
    `, [this.sessionId]);

    this.participants = participantsResult.rows;
    return this.session;
  }

  /**
   * Add a participant to the session
   */
  async addParticipant(displayName, options = {}) {
    await this.loadSession();

    const { role = 'player', userId = null, avatarUrl = null, characterId = null } = options;

    // Check if participant limit reached (max 6 players)
    if (this.participants.length >= 6) {
      throw new Error('Session is full (max 6 players)');
    }

    // Check if name is unique in session
    const existing = this.participants.find(
      p => p.display_name.toLowerCase() === displayName.toLowerCase()
    );
    if (existing) {
      throw new Error('A participant with this name already exists');
    }

    // First participant becomes host
    const isFirstParticipant = this.participants.length === 0;
    const participantRole = isFirstParticipant ? 'host' : role;

    const result = await pool.query(`
      INSERT INTO session_participants (
        story_session_id, user_id, display_name, avatar_url, role, character_id, current_turn
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      this.sessionId,
      userId,
      displayName,
      avatarUrl,
      participantRole,
      characterId,
      isFirstParticipant // First participant gets first turn
    ]);

    const participant = result.rows[0];

    // Update session config to enable multiplayer
    const config = this.session.config_json || {};
    config.multiplayer = true;
    config.participants = [...(config.participants || []), { name: displayName, id: participant.id }];

    await pool.query(
      'UPDATE story_sessions SET config_json = $1 WHERE id = $2',
      [JSON.stringify(config), this.sessionId]
    );

    logger.info(`Participant ${displayName} joined session ${this.sessionId}`);

    return participant;
  }

  /**
   * Remove a participant from the session
   */
  async removeParticipant(participantId) {
    await this.loadSession();

    const participant = this.participants.find(p => p.id === participantId);
    if (!participant) {
      throw new Error('Participant not found');
    }

    // Mark as inactive instead of deleting
    await pool.query(
      'UPDATE session_participants SET is_active = false WHERE id = $1',
      [participantId]
    );

    // If it was their turn, advance to next
    if (participant.current_turn) {
      await this.advanceTurn();
    }

    logger.info(`Participant ${participant.display_name} left session ${this.sessionId}`);

    return { removed: true, name: participant.display_name };
  }

  /**
   * Get current turn holder
   */
  async getCurrentTurn() {
    await this.loadSession();

    const current = this.participants.find(p => p.current_turn);
    if (!current) {
      // No one has turn - assign to first participant
      if (this.participants.length > 0) {
        await pool.query(
          'UPDATE session_participants SET current_turn = true WHERE id = $1',
          [this.participants[0].id]
        );
        return this.participants[0];
      }
      return null;
    }

    return current;
  }

  /**
   * Advance turn to next participant (round-robin)
   */
  async advanceTurn() {
    await this.loadSession();

    if (this.participants.length === 0) {
      return null;
    }

    // Find current turn holder
    const currentIndex = this.participants.findIndex(p => p.current_turn);
    const nextIndex = (currentIndex + 1) % this.participants.length;

    // Update turns
    await pool.query(`
      UPDATE session_participants
      SET current_turn = false,
          turns_taken = CASE WHEN id = $1 THEN turns_taken + 1 ELSE turns_taken END
      WHERE story_session_id = $2
    `, [
      currentIndex >= 0 ? this.participants[currentIndex].id : null,
      this.sessionId
    ]);

    await pool.query(`
      UPDATE session_participants
      SET current_turn = true, last_active_at = NOW()
      WHERE id = $1
    `, [this.participants[nextIndex].id]);

    logger.info(`Turn advanced to ${this.participants[nextIndex].display_name}`);

    return this.participants[nextIndex];
  }

  /**
   * Assign a character to a participant
   */
  async assignCharacter(participantId, characterId) {
    await this.loadSession();

    // Verify character belongs to this session
    const charResult = await pool.query(
      'SELECT id, name FROM characters WHERE id = $1 AND story_session_id = $2',
      [characterId, this.sessionId]
    );

    if (charResult.rows.length === 0) {
      throw new Error('Character not found in this session');
    }

    // Check if character is already assigned
    const existing = this.participants.find(p => p.character_id === characterId);
    if (existing && existing.id !== participantId) {
      throw new Error(`Character already assigned to ${existing.display_name}`);
    }

    await pool.query(
      'UPDATE session_participants SET character_id = $1 WHERE id = $2',
      [characterId, participantId]
    );

    return { assigned: true, character: charResult.rows[0] };
  }

  /**
   * Get session state for clients
   */
  async getState() {
    await this.loadSession();

    const currentTurn = await this.getCurrentTurn();

    return {
      session_id: this.sessionId,
      is_multiplayer: this.session.config_json?.multiplayer || false,
      participants: this.participants.map(p => ({
        id: p.id,
        display_name: p.display_name,
        role: p.role,
        character_name: p.character_name,
        current_turn: p.current_turn,
        turns_taken: p.turns_taken,
        is_active: p.is_active
      })),
      current_turn: currentTurn ? {
        participant_id: currentTurn.id,
        display_name: currentTurn.display_name
      } : null,
      total_participants: this.participants.length
    };
  }

  /**
   * Record participant action (for logging and turn management)
   */
  async recordAction(participantId, actionType, details = {}) {
    await pool.query(`
      INSERT INTO conversation_turns (
        story_session_id, role, modality, content
      )
      VALUES ($1, 'user', 'text', $2)
    `, [
      this.sessionId,
      JSON.stringify({
        participant_id: participantId,
        action_type: actionType,
        ...details
      })
    ]);

    // Update last active
    await pool.query(
      'UPDATE session_participants SET last_active_at = NOW() WHERE id = $1',
      [participantId]
    );
  }

  /**
   * Check if it's a specific participant's turn
   */
  async isParticipantTurn(participantId) {
    await this.loadSession();
    const participant = this.participants.find(p => p.id === participantId);
    return participant?.current_turn || false;
  }

  /**
   * Get turn order
   */
  async getTurnOrder() {
    await this.loadSession();

    const currentIndex = this.participants.findIndex(p => p.current_turn);
    if (currentIndex === -1) return this.participants;

    // Reorder so current is first
    return [
      ...this.participants.slice(currentIndex),
      ...this.participants.slice(0, currentIndex)
    ];
  }

  /**
   * Generate join link/code
   */
  generateJoinCode() {
    // Simple 6-character alphanumeric code from session ID
    return this.sessionId.replace(/-/g, '').substring(0, 6).toUpperCase();
  }

  /**
   * Find session by join code
   */
  static async findByJoinCode(code) {
    // This is a simplified approach - in production you'd want a proper join_codes table
    const result = await pool.query(`
      SELECT id FROM story_sessions
      WHERE UPPER(SUBSTRING(REPLACE(id::text, '-', ''), 1, 6)) = $1
      AND current_status NOT IN ('finished', 'abandoned')
    `, [code.toUpperCase()]);

    return result.rows.length > 0 ? result.rows[0].id : null;
  }
}

export default MultiplayerService;
