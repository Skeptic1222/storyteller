/**
 * Multiplayer Session Routes
 * Handles participant management and turn-based gameplay
 */

import { Router } from 'express';
import { MultiplayerService } from '../services/multiplayerService.js';
import { logger } from '../utils/logger.js';
import { wrapRoutes, NotFoundError, ValidationError } from '../middleware/errorHandler.js';

const router = Router();
wrapRoutes(router); // Auto-wrap async handlers for error catching

/**
 * GET /api/multiplayer/:sessionId
 * Get multiplayer session state
 */
router.get('/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const mp = new MultiplayerService(sessionId);
    const state = await mp.getState();

    res.json(state);
  } catch (error) {
    logger.error('Error getting multiplayer state:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/multiplayer/:sessionId/join
 * Join a multiplayer session
 */
router.post('/:sessionId/join', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { display_name, user_id, avatar_url } = req.body;

    if (!display_name) {
      return res.status(400).json({ error: 'display_name is required' });
    }

    const mp = new MultiplayerService(sessionId);
    const participant = await mp.addParticipant(display_name, {
      userId: user_id,
      avatarUrl: avatar_url
    });

    const state = await mp.getState();

    res.status(201).json({
      message: `Welcome, ${display_name}!`,
      participant,
      session: state,
      join_code: mp.generateJoinCode()
    });
  } catch (error) {
    logger.error('Error joining session:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/multiplayer/:sessionId/leave
 * Leave a multiplayer session
 */
router.post('/:sessionId/leave', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { participant_id } = req.body;

    if (!participant_id) {
      return res.status(400).json({ error: 'participant_id is required' });
    }

    const mp = new MultiplayerService(sessionId);
    const result = await mp.removeParticipant(participant_id);

    res.json(result);
  } catch (error) {
    logger.error('Error leaving session:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/multiplayer/:sessionId/turn/advance
 * Advance to next player's turn
 */
router.post('/:sessionId/turn/advance', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const mp = new MultiplayerService(sessionId);
    const nextPlayer = await mp.advanceTurn();

    if (!nextPlayer) {
      return res.status(400).json({ error: 'No players in session' });
    }

    res.json({
      message: `It's now ${nextPlayer.display_name}'s turn!`,
      current_turn: {
        participant_id: nextPlayer.id,
        display_name: nextPlayer.display_name
      }
    });
  } catch (error) {
    logger.error('Error advancing turn:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/multiplayer/:sessionId/turn
 * Get current turn holder
 */
router.get('/:sessionId/turn', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const mp = new MultiplayerService(sessionId);
    const current = await mp.getCurrentTurn();

    if (!current) {
      return res.json({ current_turn: null, message: 'No players yet' });
    }

    res.json({
      current_turn: {
        participant_id: current.id,
        display_name: current.display_name,
        role: current.role
      }
    });
  } catch (error) {
    logger.error('Error getting current turn:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/multiplayer/:sessionId/character/assign
 * Assign a character to a participant
 */
router.post('/:sessionId/character/assign', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { participant_id, character_id } = req.body;

    if (!participant_id || !character_id) {
      return res.status(400).json({ error: 'participant_id and character_id are required' });
    }

    const mp = new MultiplayerService(sessionId);
    const result = await mp.assignCharacter(participant_id, character_id);

    res.json(result);
  } catch (error) {
    logger.error('Error assigning character:', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * GET /api/multiplayer/:sessionId/order
 * Get turn order (starting from current player)
 */
router.get('/:sessionId/order', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const mp = new MultiplayerService(sessionId);
    const order = await mp.getTurnOrder();

    res.json({
      turn_order: order.map((p, index) => ({
        position: index + 1,
        participant_id: p.id,
        display_name: p.display_name,
        is_current: p.current_turn
      }))
    });
  } catch (error) {
    logger.error('Error getting turn order:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/multiplayer/join-code
 * Find session by join code
 */
router.post('/join-code', async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || code.length !== 6) {
      return res.status(400).json({ error: 'Invalid join code' });
    }

    const sessionId = await MultiplayerService.findByJoinCode(code);

    if (!sessionId) {
      return res.status(404).json({ error: 'Session not found or no longer active' });
    }

    res.json({ session_id: sessionId });
  } catch (error) {
    logger.error('Error finding session by code:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/multiplayer/:sessionId/action
 * Record a player action (choice, command, etc.)
 */
router.post('/:sessionId/action', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { participant_id, action_type, details } = req.body;

    if (!participant_id || !action_type) {
      return res.status(400).json({ error: 'participant_id and action_type are required' });
    }

    const mp = new MultiplayerService(sessionId);

    // Check if it's this participant's turn
    const isTurn = await mp.isParticipantTurn(participant_id);
    if (!isTurn) {
      return res.status(403).json({ error: "It's not your turn!" });
    }

    // Record the action
    await mp.recordAction(participant_id, action_type, details);

    // Advance turn after action
    const nextPlayer = await mp.advanceTurn();

    res.json({
      message: 'Action recorded',
      next_turn: nextPlayer ? {
        participant_id: nextPlayer.id,
        display_name: nextPlayer.display_name
      } : null
    });
  } catch (error) {
    logger.error('Error recording action:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
