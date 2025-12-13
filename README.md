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

## API Endpoints

### REST API
- `POST /api/stories` - Create new story session
- `GET /api/stories/:id` - Get story details
- `POST /api/stories/:id/generate` - Generate next scene

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
