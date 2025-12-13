# Smart Configuration System

## Overview

AI-driven auto-configuration of all story settings based on natural language "Story Premise" input. Used by both manual configuration (Configure.jsx) and RTC conversation mode.

## Story Premise Input

The "Story Premise" text box (formerly "Special Requests"):
- **Position**: Top of configuration page (primary input)
- **Accepts natural language**: "5 men and 5 women debate which is an alien imposter in a violent horror scifi mystery"

## Auto-Select Features

Each section has an Auto-Select toggle:

| Section | Auto-Select Behavior |
|---------|---------------------|
| Narrator Voice | Match voice gender/style to story tone |
| Voice Style | Select from 4 styles per voice |
| Writing Style | Match prose style to genre |
| Story Mood | Extract emotional tone from premise |
| Genre Sliders | Adjust all sliders based on keywords |
| Story Format | Detect CYOA, linear, episodic |
| Content Intensity | Set gore/romance/violence from context |

## Smart Config Engine

Create `server/services/smartConfig.js`:

```javascript
class SmartConfigEngine {
  async interpretPremise(premiseText) {
    // Returns: { genres, mood, format, intensity, voiceRecommendations }
  }

  async generateConfig(premiseText, currentConfig = {}) {
    // Returns complete config object
  }

  mapGenreKeywords(text) {
    // "horror" -> { horror: 80, tension: 70 }
    // "children" -> { whimsy: 90, horror: 0, romance: 0 }
  }

  recommendNarratorVoice(storyType, characters) {
    // Horror -> NOT warm/gentle, prefer mysterious/dramatic
    // Returns: { voiceId, stylePreset, reasoning }
  }

  async processRTCInput(transcript, sessionContext) {
    // Interpret voice command, update config
  }
}
```

## Voice System (24+ Voices × 4 Styles = 96+ Options)

### Voice Style Presets

| Style | Description | Parameters |
|-------|-------------|------------|
| Warm & Gentle | Soft, bedtime-friendly | `stability: 0.7, style: 0.3, speed: 0.9` |
| Dramatic | Theatrical, intense | `stability: 0.5, style: 0.8, speed: 1.0` |
| Playful | Light, energetic | `stability: 0.6, style: 0.6, speed: 1.1` |
| Mysterious | Dark, suspenseful | `stability: 0.8, style: 0.4, speed: 0.85` |

### Narrator Style Rules

| Story Type | Avoid | Prefer |
|------------|-------|--------|
| Horror | Warm/gentle, playful | Mysterious, dramatic |
| Children's | Mysterious, dramatic | Warm/gentle, playful |
| Romance | Mysterious | Warm/gentle, dramatic |
| Action | Warm/gentle | Dramatic, playful |
| Mystery/Noir | Playful | Mysterious, dramatic |

## Content Intensity Sliders

| Slider | Venice Threshold | Description |
|--------|-----------------|-------------|
| Violence | N/A | General action intensity |
| Gore | **61%** | Graphic violence, blood |
| Romance | **71%** | Intimate content |
| Adult Content | **50%** | Explicit content |
| Profanity | N/A | Language intensity |
| Dark Themes | N/A | Death, loss, existential |

Sliders above threshold show purple highlight and route to Venice.ai.

## API Endpoints

```
POST   /config/smart-interpret     # Interpret premise, return config
POST   /config/smart-apply         # Apply smart config to session
GET    /config/voice-styles        # Get voice style presets
POST   /config/voice-preview       # Generate voice+style preview
GET    /config/auto-select-status  # Get auto-select states
POST   /config/auto-select-toggle  # Toggle auto-select for section
```

## Implementation Priority

1. **High**: Fix ProviderIndicator to reflect slider values
2. **High**: Sync all 24+ ElevenLabs voices to database
3. **High**: Create smartConfig.js engine
4. **Medium**: Rename Special Requests → Story Premise, move to top
5. **Medium**: Add voice style preview buttons
6. **Medium**: Add Auto-Select toggles
7. **Medium**: Add gore/adult content sliders with thresholds
8. **Lower**: Animated slider adjustments
9. **Lower**: Full RTC integration
