# Storyteller API Reference

## Testing & Hardening Snapshot

- API integration tests run via `node --test server/tests/api.test.js` (or `npm test`) against `TEST_URL` (default `http://localhost:5100`), with optional `TEST_AUTH_TOKEN` for authenticated paths.
- Socket payload hardening is unit-tested via `node --test server/socket/validation.test.js` to verify sanitized event payloads.
- Current automated API coverage includes health, library auth behavior, voices, SFX, config endpoints, validation failures, and basic rate-limiting behavior.

## Authentication (`/api/auth`)
```
POST   /auth/google                # Google OAuth login
GET    /auth/me                    # Get current user (requires auth)
POST   /auth/logout                # Logout (requires auth)
GET    /auth/usage                 # Get usage stats (requires auth)
```

## Story Management (`/api/stories`)
```
POST   /stories/start              # Start new story session
GET    /stories/:id                # Get story details
POST   /stories/:id/configure      # Configure story settings
POST   /stories/:id/converse       # Send conversation message
POST   /stories/:id/conversation   # Add to conversation history
GET    /stories/config/styles      # Get available story styles
POST   /stories/:id/generate-outline  # Generate story outline
POST   /stories/:id/continue       # Generate next scene
POST   /stories/:id/choice         # Submit CYOA choice
GET    /stories/:id/scene/:index   # Get specific scene
POST   /stories/:id/pause          # Pause story
POST   /stories/:id/end            # End story session
POST   /stories/:id/backtrack      # Backtrack to previous choice
POST   /stories/:id/generate-cover # Generate cover image
POST   /stories/:id/update-config  # Update story configuration
GET    /stories/recent/:userId     # Get user's recent stories
```

## Voices (`/api/voices`)
```
GET    /voices                     # List all ElevenLabs voices
GET    /voices/recommended         # Get recommended voices
POST   /voices/sync                # Sync voices from ElevenLabs
POST   /voices/preview             # Generate voice preview
GET    /voices/narrator-styles     # Get narrator style options
GET    /voices/previews            # Get cached previews
POST   /voices/preview-sample      # Generate sample preview
GET    /voices/character-suggestions  # Get voice suggestions for characters
GET    /voices/preferences/:userId # Get user voice preferences
POST   /voices/preferences         # Save voice preference
POST   /voices/match               # Match voice to character
```

## Sound Effects (`/api/sfx`)
```
GET    /sfx/library                # Get SFX library
POST   /sfx/generate               # Generate sound effect
POST   /sfx/ambient                # Generate ambient audio
POST   /sfx/detect                 # Detect SFX opportunities in text
POST   /sfx/preview                # Preview sound effect
GET    /sfx/scene/:sceneId         # Get SFX for scene
GET    /sfx/test                   # Test SFX system
GET    /sfx/status                 # Get SFX coordinator status
```

## Recordings (`/api/recordings`)
```
GET    /recordings/session/:sessionId          # Get session recordings
GET    /recordings/:id                         # Get recording details
GET    /recordings/:id/segments                # Get recording segments
GET    /recordings/:id/segment/:index          # Get specific segment
POST   /recordings/check-path                  # Check recording path
POST   /recordings/check-choice                # Check choice recording
GET    /recordings/session/:sessionId/available-paths  # Get available paths
POST   /recordings/:id/validate                # Validate recording
POST   /recordings/:id/interrupt               # Interrupt recording
GET    /recordings/session/:sessionId/recover  # Recover session recordings
POST   /recordings/:id/resume                  # Resume recording
DELETE /recordings/:id                         # Delete recording
POST   /recordings/:id/play                    # Start playback
POST   /recordings/playback/:id/position       # Update playback position
POST   /recordings/playback/:id/complete       # Complete playback
```

## Library (`/api/library`)
```
GET    /library                        # Get authenticated user's story library
GET    /library/:storyId               # Get story details (owner/admin only)
POST   /library/:storyId/progress      # Update reading progress (owner/admin only)
POST   /library/:storyId/bookmark      # Add bookmark (owner/admin only)
DELETE /library/:storyId/bookmark/:id  # Remove bookmark (owner/admin only)
POST   /library/:storyId/favorite      # Toggle favorite (owner/admin only)
GET    /library/preferences            # Get authenticated user's reader prefs
PUT    /library/preferences            # Update authenticated user's reader prefs
GET    /library/:storyId/export        # Export story (owner/admin only)
DELETE /library/:storyId               # Delete story (owner/admin only)
```

## Lorebook (`/api/lorebook`)
```
GET    /lorebook/:sessionId                # Get lorebook entries
POST   /lorebook/:sessionId/entries        # Create lore entry
PUT    /lorebook/:sessionId/entries/:id    # Update lore entry
DELETE /lorebook/:sessionId/entries/:id    # Delete lore entry
POST   /lorebook/:sessionId/search         # Search lorebook
POST   /lorebook/:sessionId/test-triggers  # Test trigger words
GET    /lorebook/:sessionId/export         # Export lorebook
POST   /lorebook/:sessionId/import         # Import lorebook
GET    /lorebook/:sessionId/by-type/:type  # Get entries by type
```

## Multiplayer (`/api/multiplayer`)
```
GET    /multiplayer/:sessionId             # Get multiplayer session
POST   /multiplayer/:sessionId/join        # Join session
POST   /multiplayer/:sessionId/leave       # Leave session
POST   /multiplayer/:sessionId/turn/advance    # Advance turn
GET    /multiplayer/:sessionId/turn        # Get current turn
POST   /multiplayer/:sessionId/character/assign  # Assign character
GET    /multiplayer/:sessionId/order       # Get turn order
POST   /multiplayer/join-code              # Join by code
POST   /multiplayer/:sessionId/action      # Submit action
```

## Configuration (`/api/config`)
```
GET    /config/defaults            # Get default settings
GET    /config/preferences/:userId # Get user preferences
POST   /config/preferences         # Save preferences
GET    /config/genres              # Get available genres
GET    /config/narrator-styles     # Get narrator styles
GET    /config/agent-prompts       # Get agent prompts (debug)
POST   /config/interpret           # Interpret voice command
```

Notes:
- Canonical audience values returned by config endpoints are `children`, `general`, and `mature`.
- Legacy aliases such as `adult`, `all_ages`, `family`, and `young_adult` are normalized server-side before response payloads are returned.

## PayPal (`/api/paypal`)
```
GET    /paypal/status              # Get PayPal integration status
GET    /paypal/plans               # Get subscription plans
POST   /paypal/create-subscription # Create subscription (requires auth)
POST   /paypal/webhook             # PayPal webhook handler
POST   /paypal/cancel-subscription # Cancel subscription (requires auth)
GET    /paypal/subscription        # Get user subscription (requires auth)
```

## Admin (`/api/admin`)
```
GET    /admin/users                # List all users
GET    /admin/users/:id            # Get user details
PUT    /admin/users/:id/subscription  # Update subscription
POST   /admin/users/:id/bonus      # Add bonus usage
GET    /admin/stats                # Get system statistics
POST   /admin/paypal/sync          # Sync PayPal subscriptions
```

## Health (`/api/health`)
```
GET    /health                     # Basic health check
GET    /health/detailed            # Detailed service status
```

## Socket.IO Events

### Client → Server
```
join-session      # Join a story session { session_id }
leave-session     # Leave current session
voice-input       # Send voice transcript { session_id, transcript, confidence }
continue-story    # Request next scene { session_id, voice_id }
submit-choice     # Submit CYOA choice { session_id, choice_key|choice_id, from_recording?, diverge_at_segment? }
request-scene-audio          # Generate/get scene audio { session_id, scene_id? }
request-picture-book-images  # Generate/get picture-book images { session_id, scene_id }
confirm-ready     # Confirm launch ready event { session_id }
check-ready       # Re-check/re-emit ready state after retries { session_id }
retry-stage       # Retry a launch stage { session_id, stage }
pause-story       # Pause narration { session_id }
resume-story      # Resume narration { session_id }
rtc-start         # Start realtime conversation { session_id }
rtc-audio         # Send audio data { audio: base64 }
rtc-text          # Send text input { text }
rtc-stop          # Stop realtime conversation
```

### Server → Client
```
session-joined    # Confirmation of session join { session_id, status }
error             # Error notification { message }
voice-received    # Voice input acknowledged { transcript, confidence }
generating        # Generation progress { step, percent, message }
scene-generated   # New scene ready { scene, choices, isEnding }
audio-ready       # Audio for scene { audioData, format, sceneIndex }
choice-audio-ready    # Audio for choice text { audioData, choiceKey }
choice-audio-error    # Choice audio failed { choiceKey, error }
choice-accepted   # Choice selection confirmed { choice_key, scene_id }
story-paused      # Story paused confirmation
story-resumed     # Story resumed confirmation
audio-error       # Audio generation failed { error }
rtc               # Realtime conversation events { type, ... }
```
