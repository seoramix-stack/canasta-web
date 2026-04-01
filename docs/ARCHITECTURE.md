# Canasta Master Club - Codebase Architecture

## Project Overview
**Canasta Master Club** is a web-based multiplayer card game platform built with:
- **Frontend**: HTML5 + CSS + Vanilla JavaScript (PWA-enabled)
- **Backend**: Node.js (Express)
- **Real-time**: WebSocket (Socket.IO)
- **Database**: MongoDB
- **Mobile**: Capacitor (Android/iOS)
- **Payments**: Stripe integration

## Directory Structure

```
canasta-web/
├── www/                      # Frontend (served as static assets)
│   ├── index.html           # Main HTML document with all screens
│   ├── client.js            # Entry point, session init, socket setup
│   ├── state.js             # Global game state management
│   ├── ui.js                # UI navigation & rendering
│   ├── animations.js        # Animation utilities
│   ├── game.js              # Core Canasta game engine
│   ├── deck.js              # Card deck mechanics
│   ├── elo.js               # ELO rating calculations
│   ├── matchmaking.js       # Queue & player matching logic
│   ├── utils.js             # Helper functions
│   ├── style.css            # Stylesheet
│   ├── sw.js                # Service Worker (PWA offline support)
│   ├── manifest.json        # PWA manifest
│   ├── cards/               # Card sprite assets
│   └── *.html               # Static pages (privacy, terms)
├── server.js                # Main backend entry (production server)
├── dev-server.js            # Development server with hot reload
├── routes/
│   └── auth.js              # Authentication endpoints (login/register)
├── models/
│   └── user.js              # MongoDB User schema
├── scripts/
│   ├── bot.js               # CanastaBot AI implementation
│   ├── simulator.js         # Bot training simulator
│   └── scenarios.test.js    # Test scenarios
├── tests/
│   ├── chaos_bot.improved.js # Advanced bot testing
│   └── simrun.js            # Simulation runner
├── android/                 # Capacitor Android project
├── package.json             # Dependencies & scripts
├── capacitor.config.ts      # Capacitor configuration
└── recorder.js              # Human gameplay recording for bot training
```

## Frontend Architecture

### Screen Navigation System
All game screens are defined in `www/index.html` as div containers with IDs matching the pattern `screen-<name>`:

- `screen-landing` - Splash/welcome screen
- `screen-login` - Authentication (login/register)
- `screen-home` - Main menu (Play Online, Train vs Bots, Profile, etc)
- `screen-online` - Online matchmaking options
- `screen-bot` - Bot training mode config
- `screen-queue` - Waiting for match
- `screen-lobby` - Pre-game lobby
- `screen-game` - Active gameplay
- `screen-victory` - Match results
- `screen-profile` - User stats & profile
- `screen-leaderboard` - Global rankings
- `screen-friends` - Friends list & search
- `screen-how-to` - Rules reference
- `screen-private-menu` - Private room options
- `screen-create-room` / `screen-join-room` - Private game setup

Navigation is handled via `UI.navTo(screenId)` function in `www/ui.js`.

### Global State Management
`www/state.js` maintains:
- `state.playerToken` - JWT authentication token
- `state.playerUsername` - Current user
- `state.playerElo` - ELO rating
- `state.socket` - WebSocket connection
- `state.gameId` - Current game session ID
- `state.gameState` - Full game state object
- `state.isPremium` - Subscription status

### Game Engine
`www/game.js` implements the complete Canasta rules:
- Hand management & card states
- Meld validation (natural/wild sequences, sets)
- Scoring system (canasta bonuses, red 3s, etc)
- Draw/discard mechanics
- 2 vs 4 player support

### Socket Events

**Client → Server** (game actions):
- `act_play_card` - Play card to table
- `act_draw_melds` - Draw from discard pile (melded face-up cards)
- `act_discard` - End turn with discard

**Server → Client** (game state updates):
- `game_state_update` - Full game state
- `game_round_end` - Round/match conclusion
- `player_joined` - New player in lobby
- `game_started` - Match begins

## Backend Architecture

### Server Entry Points
- **server.js** - Production server (60+ routes for API)
- **dev-server.js** - Development server with live reload

### Key Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/register` | Create account (hashed password, unique username) |
| POST | `/api/login` | Authenticate & return JWT token |
| GET | `/api/profile` | Fetch user stats/premium status |
| POST | `/api/start-game` | Initiate game (bot/casual/rated) |
| WebSocket | Various | Real-time game events |

### Authentication
- JWT-based tokens stored in `state.playerToken`
- Passwords hashed with bcryptjs
- Token required for API calls & socket connections

### Database Schema
User model (`models/user.js`):
- `username`, `passwordHash` - Credentials
- `eloRating` - Current ELO (default 1200)
- `wins`, `losses` - Win/loss record
- `isPremium` - Subscription status
- `joinedAt` - Account creation date

### Game Matchmaking
`www/matchmaking.js` + server logic:
- **Rated matches**: Players queued by ELO rating, auto-matched quickly
- **Casual matches**: Quick join without rating impact
- **Private rooms**: Invite-only via room code

### Stripe Integration
- Subscription/payment handling in `server.js`
- Premium badge shown in UI if `state.isPremium === true`
- Webhook for subscription status updates

## AI & Training

### Bot Implementation
`scripts/bot.js` - CanastaBot class:
- Evaluates hand value & meld opportunities
- Strategizes draw/discard decisions
- Learns from logged human games

### Training Pipeline
1. **Record human turns** → `recorder.js` logs moves to `human_training_data.jsonl`
2. **Run simulator** → `scripts/simulator.js` tests bots against scenarios
3. **Analyze** → `trainer_ghost.js` extracts patterns from human data

## Key Technologies

- **Express** - REST API framework
- **Socket.IO** - Real-time game updates
- **MongoDB + Mongoose** - Persistent data (users, game stats)
- **Capacitor** - Web → Android/iOS app wrapping
- **Stripe** - Payment processing
- **Service Worker** - PWA offline capability

## Common Development Tasks

### Local Development
```bash
npm install
npm run dev           # Dev server on http://localhost:8080
npm run dev:full      # Full server with dev mode enabled
```

### Production
```bash
npm start             # Runs server.js (uses real Stripe keys, etc)
```

### Building Android App
```bash
npx cap build android
# Then open android/ folder in Android Studio
```

## Important Notes

- **API_BASE**: Hardcoded to production URL in `www/client.js` line 4
- **JWT_SECRET**: Required in production (set via .env)
- **MONGO_URI**: Database connection string in .env
- **Timestamp tracking**: All game states include server time for sync
- **ELO calculation**: Uses `www/elo.js` - K-factor of 32
- **Rate limiting** on all public endpoints (express-rate-limit)

## Common Gotchas

1. **Socket connection timing**: Socket initialized AFTER token validation
2. **Screen rendering**: Hidden screens use `display: none`, shown with `display: block`
3. **Premium features**: Check `state.isPremium` before allowing certain actions
4. **Game state mutations**: Always use socket events, never mutate game state directly on client
5. **Card assets**: Located in www/cards/ (requires proper file structure)
