# Storyteller

A mobile-first bedtime storytelling app with AI-generated audio stories featuring multi-voice narration, sound effects, and interactive Choose Your Own Adventure (CYOA) branching.

## Features

- **AI Story Generation**: GPT-powered story creation with customizable genres, themes, and author styles (40+ author voice options including Tolkien, King, Asimov, etc.)
- **Multi-Voice Narration**: Different AI voices for each character using ElevenLabs TTS with emotion-aware prosody
- **Sound Effects**: Context-aware ambient sounds and SFX triggered by story events
- **CYOA Branching**: Interactive story choices that create unique narrative paths
- **Cover Art**: AI-generated book covers with three-tier abstraction system (DALL-E)
- **Voice Input**: Whisper-powered voice commands for story interaction
- **Book-Style Layout**: Floating cover art with text wrap, karaoke word highlighting

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React + Vite, TailwindCSS |
| Backend | Node.js + Express |
| Real-time | Socket.IO |
| Database | PostgreSQL |
| AI/LLM | OpenAI GPT-4/GPT-5.2, Venice.ai (mature content) |
| TTS | ElevenLabs v3 with Audio Tags |
| Voice Input | Whisper service |
| Image Gen | DALL-E 3 |

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- API Keys: OpenAI, ElevenLabs

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/storyteller.git
cd storyteller

# Install dependencies
npm install
cd client && npm install && cd ..

# Configure environment
cp .env.example .env
# Edit .env with your API keys and database credentials

# Create database
createdb storyteller_db

# Run migrations
npm run db:migrate
# Optional: apply incremental SQL migrations in database/migrations
npm run db:migrate:incremental

# Build client
npm run build

# Start server
npm start
```

### Development

```bash
# Start development server with hot reload
npm run dev
```

### Testing

```bash
# Unit test (socket payload validation/sanitization)
node --test server/socket/validation.test.js

# Integration test (API surface + auth/rate-limiting checks)
# Expects API server at TEST_URL (default http://localhost:5100)
node --test server/tests/api.test.js

# Full backend suite (unit + integration)
npm test

# Build verification (frontend production bundle)
npm run build
```

### End-to-End Testing (Playwright)

```bash
# Install Playwright browsers (one-time per machine)
npx playwright install

# Start app for E2E:
# terminal A: npm run dev        # API on http://localhost:5100
# terminal B: npm run client:dev # Vite on http://localhost:5101

# PowerShell example
$env:E2E_BASE_URL="http://localhost:5101/storyteller"

# Windows CMD example
set E2E_BASE_URL=http://localhost:5101/storyteller

npm run test:e2e
```

Notes:
- Playwright discovery is configured in `playwright.config.js` with `testDir: ./test` and `testMatch: **/*.spec.js`.
- Only files under `test/` ending in `.spec.js` are auto-discovered. `test/test-multipass.js` is a manual script and is not auto-run.
- `test/mobile-playback.spec.js` and `test/mobile-smoke.spec.js` skip automatically when `E2E_BASE_URL` is not set.
- For IIS/static server validation, use `E2E_BASE_URL=http://localhost:5100/storyteller`.

## Recent Hardening & Mobile Coverage

- Security hardening includes stricter socket payload validation/sanitization, authenticated library access checks, and API/socket rate limiting.
- Reliability hardening includes fail-loud voice/TTS validation and timing guards to reduce silent degradation.
- Multi-voice generation now fails loud when mature scaffold/hybrid outputs cannot produce recoverable dialogue metadata, instead of silently downgrading to narrator-only.
- Hybrid explicit-content processing now enforces explicit-tag presence/restoration for mature high-intensity requests, preventing silent content loss in merge steps.
- Chapter generation now enforces minimum word-count thresholds after retries and aborts on persistent under-length output.
- Configure defaults/AI/template apply paths now use normalized deep merges for `genres`/`intensity`, preventing nested-config clobbering from shallow merges.
- Audience values are now canonicalized end-to-end (`children|general|mature`), with backend aliases (`adult`, `all_ages`, `family`, `young_adult`) normalized before client apply.
- Mobile accessibility coverage now includes Playwright smoke tests on a touch viewport (390x844), including actionable `Begin Chapter` and role-based checks for discovery controls.

## Project Structure

```
storyteller/
├── client/                 # React frontend (Vite)
│   ├── src/
│   │   ├── pages/         # Main views (Story, Configure, Library)
│   │   ├── components/    # Reusable UI components
│   │   ├── context/       # React contexts (Audio, Socket)
│   │   └── utils/         # Client utilities
│   └── public/            # Static assets
├── server/
│   ├── routes/            # Express routes
│   ├── services/          # Core services
│   │   ├── orchestrator.js    # Main story coordination
│   │   ├── elevenlabs.js      # TTS + multi-voice
│   │   ├── llmProviders.js    # OpenAI/Venice routing
│   │   └── agents/            # AI agents
│   ├── socket/            # Socket.IO handlers
│   └── database/          # Migrations and pool
├── docs/                  # Documentation
└── public/                # Built assets + audio cache
```

## Architecture

### Multi-Voice System (C+E Architecture)

The multi-voice narration uses a bulletproof tag-based system:

1. **Option C**: Scene writer outputs prose with `[CHAR:Name]dialogue[/CHAR]` tags
2. **Option E**: Speaker validation agent assigns voices to characters
3. **FAIL LOUD**: If dialogue metadata is missing, system throws errors (no silent fallbacks)

### LLM Routing

| Provider | Trigger |
|----------|---------|
| OpenAI | Default (95% of content) |
| Venice.ai | Gore ≥61%, Romance ≥71%, Adult ≥50% |
| OpenRouter | Fallback |

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](./CLAUDE.md) | Development guide for AI assistants |
| [docs/CHANGELOG.md](./docs/CHANGELOG.md) | Version history and fixes |
| [docs/FEATURES.md](./docs/FEATURES.md) | Feature documentation |
| [docs/API_REFERENCE.md](./docs/API_REFERENCE.md) | REST + Socket.IO API |
| [docs/MIGRATIONS.md](./docs/MIGRATIONS.md) | Schema bootstrap + incremental migration workflow |
| [docs/LOGGING_STANDARDS.md](./docs/LOGGING_STANDARDS.md) | Debugging guide |
| [docs/KNOWN_ISSUES.md](./docs/KNOWN_ISSUES.md) | Known issues tracker |

## Environment Variables

See [.env.example](./.env.example) for all configuration options.

Key variables:
- `OPENAI_API_KEY` - OpenAI API key
- `ELEVENLABS_API_KEY` - ElevenLabs API key
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Secure session secret
- `JWT_SECRET` - JWT signing secret
- `WHISPER_SERVICE_URL` - Whisper transcription service base URL
- `ALLOWED_ORIGINS` - Comma-separated CORS allowlist
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - OAuth credentials
- `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `PAYPAL_WEBHOOK_ID` - PayPal integration
- `DEV_LOGIN_ENABLED`, `ALLOW_QUERY_TOKEN`, `ALLOW_SOCKET_QUERY_TOKEN` - Local dev-only auth toggles

## API Endpoints

### REST API
- `POST /api/stories/start` - Create new story session
- `GET /api/stories/:id` - Get story details
- `POST /api/stories/:id/generate-outline` - Generate story outline
- `POST /api/stories/:id/continue` - Generate next scene
- `POST /api/stories/:id/choice` - Submit CYOA choice
- `POST /api/stories/:id/generate-audio/:sceneId` - Generate deferred audio for a scene
- `GET /api/library/:storyId` - Requires auth and story ownership/admin access
- `GET /api/library/:storyId/export` - Requires auth and story ownership/admin access

See [docs/API_REFERENCE.md](./docs/API_REFERENCE.md) for the full route list.

### Socket.IO Events
- `join-session` - Join story session room
- `start-story` - Begin story generation
- `continue-story` - Request next scene
- `submit-choice` - Submit CYOA choice

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests
5. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- OpenAI for GPT models
- ElevenLabs for voice synthesis
- Anthropic Claude for development assistance
