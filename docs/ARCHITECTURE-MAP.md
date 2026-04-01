# Canasta Web - Architecture Map & Repository Guide

**Generated:** April 2026  
**Repository:** /home/mint/projects/canasta-web  
**Tech Stack:** Node.js + Express + Socket.IO + MongoDB + Vanilla JS + Capacitor

---

## 1. System Architecture Overview

### High-Level Stack
```
┌────────────────────────────────────────────────────────────────────────┐
│                          PRESENTATION LAYER                            │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  Web Frontend (www/)                   Mobile (Android)        │  │
│  │  - HTML5 + CSS + Vanilla JS            - Capacitor wrapper     │  │
│  │  - PWA (Service Worker)                - Native bridge         │  │
│  │  - Socket.IO client                    - System bars control   │  │
│  └─────────────────────────────────────────────────────────────────┘  │
└────────────────────┬───────────────────────────────────────────────────┘
                     │ WebSocket + HTTP
┌────────────────────▼───────────────────────────────────────────────────┐
│                        APPLICATION LAYER                               │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Backend Server (server.js)                                       │ │
│  │ - Express HTTP API                                               │ │
│  │ - Socket.IO real-time events                                    │ │
│  │ - JWT authentication                                            │ │
│  │ - Session management                                            │ │
│  │ - Game orchestration                                            │ │
│  │ - Rate limiting & CORS                                          │ │
│  └──────────────────────────────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ Microservices                                                    │ │
│  │ - Authentication (routes/auth.js)                               │ │
│  │ - Matchmaking (www/matchmaking.js)                              │ │
│  │ - Game Engine (www/game.js)                                     │ │
│  │ - AI/Bot Engine (scripts/bot.js)                                │ │
│  │ - ELO Rating (www/elo.js)                                       │ │
│  │ - Data Recording (recorder.js)                                  │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└────────────────────┬───────────────────────────────────────────────────┘
                     │ 
┌────────────────────▼───────────────────────────────────────────────────┐
│                         DATA LAYER                                      │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │ MongoDB (Production) / In-Memory (Development)                  │ │
│  │ - User model (models/user.js)                                   │ │
│  │ - Sessions & tokens                                             │ │
│  │ - Game history & stats                                          │ │
│  │ - Leaderboard data                                              │ │
│  └──────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Directory Structure & Component Map

```
canasta-web/
│
├── 📄 server.js                      ★ Main backend entry point (1600+ lines)
│                                      - Express app initialization
│                                      - Socket.IO setup
│                                      - HTTP route mounting
│                                      - Game state management (games, gameBots, playerSessions)
│                                      - Stripe webhook handling
│
├── 📄 dev-server.js                  → Development server with auto-reload
├── 📄 package.json                   → Dependencies & npm scripts
├── 📄 .env / .env.development        → Environment configuration
│
├── 📁 www/                           ★ Frontend code (HTML5 + Vanilla JS + CSS)
│   ├── 📄 index.html                 ★ Main SPA document (3000+ lines)
│   │                                  - 13+ screen definitions
│   │                                  - CSS classes & layout
│   │                                  - Asset loading
│   │                                  - Stripe integration
│   │
│   ├── 📄 client.js                  ★ Frontend entry point (1000+ lines)
│   │                                  - Session initialization & JWT handling
│   │                                  - Socket.IO client setup
│   │                                  - Event listeners & handlers
│   │                                  - Game action dispatchers
│   │
│   ├── 📄 state.js                   ★ Global state management (25 lines)
│   │                                  - Player token & username
│   │                                  - Socket connection reference
│   │                                  - Game state (current game, seat, selections)
│   │                                  - UI state (screens, timers, animations)
│   │
│   ├── 📄 ui.js                      → UI navigation & rendering (triggers HTML updates)
│   ├── 📄 animations.js              → Card animations & visual effects
│   ├── 📄 utils.js                   → Helper functions (tap detection, etc)
│   │
│   ├── 📄 game.js                    ★ Core game engine (600+ lines)
│   │                                  - CanastaGame class initialization
│   │                                  - Card state management
│   │                                  - Turn logic & action validation
│   │                                  - Scoring & round end conditions
│   │                                  - Meld validation & placement
│   │
│   ├── 📄 deck.js                    → Card deck mechanics (shuffle, create)
│   ├── 📄 elo.js                     → ELO rating calculations
│   ├── 📄 matchmaking.js             ★ Queue & auto-match service
│   │                                  - matchmakingQueues data structure
│   │                                  - 30s timeout backfill logic
│   │                                  - Game creation from queue fills
│   │
│   ├── 📄 style.css                  → Complete stylesheet
│   ├── 📄 sw.js                      → Service Worker (PWA offline support)
│   ├── 📄 manifest.json              → PWA configuration
│   │
│   ├── 📁 cards/                     → Card sprite images (1200+ PNG files)
│   │   ├── BackRed.png, BackBlue.png
│   │   ├── [Suit][Rank].png for each card
│   │
│   ├── 📄 privacy.html               → Privacy policy
│   ├── 📄 terms.html                 → Terms of service
│   ├── 📄 how-to.html                → Game rules reference
│   ├── 📄 robots.txt                 → SEO configuration
│   └── 📄 llms.txt                   → LLM configuration
│
├── 📁 routes/                        ★ HTTP API endpoints
│   └── 📄 auth.js                    → /register, /login, /verify endpoints
│
├── 📁 models/                        ★ Database schemas (MongoDB)
│   └── 📄 user.js                    → User schema (username, password, stats, friends)
│
├── 📁 scripts/                       ★ Utilities & AI training
│   ├── 📄 bot.js                     ★ CanastaBot AI (trainable DNA-based)
│   │                                  - 15+ decision-making functions
│   │                                  - DNA string parameters for strategy
│   │                                  - production-dna.json loading
│   │
│   ├── 📄 simulator.js               → Bot tournament runner
│   ├── 📄 scenarios.test.js          → Single-scenario testing
│   └── 📄 production-dna.json        → Evolved bot DNA (5000 generations)
│
├── 📁 tests/                         ★ Testing & simulation
│   ├── 📄 chaos_bot.improved.js      → Fuzzy testing bot
│   └── 📄 simrun.js                  → Large-scale game simulation
│
├── 📁 android/                       → Capacitor Android project
│   ├── build.gradle, gradlew, etc   → Gradle configuration
│   ├── app/src/main                 → Android app code
│   └── app/build                    → Build outputs
│
├── 📄 recorder.js                    → Human gameplay recording (for AI training)
├── 📄 clear_logs.js                  → Utility to clear training logs
├── 📄 capacitor.config.ts            → Capacitor app configuration
│
└── 📁 docs/                          → Generated documentation
    ├── ARCHITECTURE.md
    ├── DEVELOPMENT.md
    ├── GAME-RULES.md
    └── MATCHMAKING-SPECTATOR-SYSTEM.md
```

---

## 3. Core Component Interactions

### Request Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Client-Side Event (User Action)                                         │
│ Example: Player clicks "FIND MATCH"                                     │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                    connectToGame('rated')
                               │
                    ┌──────────▼───────────┐
                    │ www/client.js        │
                    │ connectToGame()      │
                    │ socket.emit()        │
                    └──────────┬───────────┘
                               │
              request_join { mode: 'rated_4' }
                               │
                    ┌──────────▼──────────────┐
                    │ server.js              │
                    │ io.on('request_join')  │
                    │ socket handler         │
                    └──────────┬──────────────┘
                               │
           ┌────────────────────┼────────────────────┐
           │                    │                    │
    ┌──────▼──────┐  ┌─────────▼────────┐  ┌───────▼──────┐
    │ Add to      │  │ Check if queue   │  │ If 4 ready:  │
    │ queue       │  │ is full for      │  │ create game  │
    │ (matchmak   │  │ this game type   │  │ from queue   │
    │ ing.js)     │  └────────┬────────┘  └───────┬──────┘
    └──────┬──────┘           │                    │
           │                  └────────┬───────────┘
           │                           │
           │           ┌───────────────▼─────────────────┐
           │           │ server.js                       │
           │           │ 1. startBackfillGame() OR       │
           │           │ 2. Emit queue_update event      │
           │           └───────────────┬─────────────────┘
           │                           │
           │       ┌───────────────────┴────────────────┐
           │       │                                    │
    ┌──────▼──────▼──────┐              ┌──────────────▼────────┐
    │ broadcast to all   │              │ Create CanastaGame    │
    │ queue users:       │              │ instance              │
    │ queue_update       │              │ Assign players        │
    └───────┬────────────┘              │ Assign bots if needed │
            │                           └──────────┬────────────┘
            │                                      │
    ┌───────▼────────────┐              ┌─────────▼────────────┐
    │ www/client.js      │              │ server.js            │
    │ socket.on()        │              │ sendUpdate() &       │
    │ queue_update       │              │ broadcastAll()       │
    │ Update UI message  │              │ Emit deal_hand       │
    └────────────────────┘              └─────────┬────────────┘
                                               │
                                        Screen transitions
                                        state.gameState =
                                        game state object
```

---

## 4. Module Dependencies & Data Flow

### Backend Module Dependencies

```
server.js (main orchestrator)
    ├─→ routes/auth.js
    │       └─→ models/user.js (MongoDB schema)
    │
    ├─→ www/game.js (CanastaGame class)
    │       ├─→ www/deck.js (Card creation/shuffling)
    │       └─→ www/elo.js (Scoring calculations)
    │
    ├─→ scripts/bot.js (CanastaBot AI)
    │       └─→ production-dna.json (Strategy parameters)
    │
    ├─→ www/matchmaking.js (Queue management)
    │       ├─→ www/game.js (Game creation)
    │       └─→ scripts/bot.js (Bot instantiation)
    │
    ├─→ recorder.js (Data logging)
    │       └─→ human_training_data.jsonl (Append action logs)
    │
    └─→ Socket.IO handlers (40+ events)
```

### Frontend Module Dependencies

```
client.js (entry point)
    ├─→ state.js (global state imported)
    │       └─→ localStorage API
    │
    ├─→ ui.js (screen navigation)
    │       └─→ state.js (read game state for rendering)
    │
    ├─→ animations.js (visual effects)
    │       └─→ state.js (animation state flags)
    │
    ├─→ index.html (DOM reference)
    │       └─→ style.css (CSS styling)
    │
    ├─→ game.js (local game instance)
    │       └─→ deck.js (card operations)
    │
    └─→ Socket.IO events listener
        └─→ Dispatches to ui.js / state.js mutations
```

---

## 5. Data Model Architecture

### User Document (MongoDB)
```javascript
{
  _id: ObjectId,
  username: String (unique, lowercase),
  password: String (bcrypt hash),
  token: String (JWT),
  isOnline: Boolean,
  isPremium: Boolean,
  stripeCustomerId: String,
  stripeSubscriptionId: String,
  eloRating: Number (default: 1200),
  wins: Number,
  losses: Number,
  friends: [String],
  blocked: [String],
  createdAt: Date,
  updatedAt: Date
}
```

### Game State Object (In-Memory Server)
```javascript
games[gameId] = {
  // Identity
  gameId: String,
  
  // Players
  names: [String, String, String, String],
  playerTokens: { 0: token, 1: token, ... },
  
  // Configuration
  config: {
    PLAYER_COUNT: 2|4,
    HAND_SIZE: 15|11,
    DRAW_COUNT: 1|2,
    MIN_CANASTAS_OUT: 1|2,
    WIN_SCORE: 5000
  },
  
  // Game State
  deck: [Card],
  discardPile: [Card],
  players: [[Card], [Card], [Card], [Card]],
  team1Melds: { rank: [Card, Card, ...] },
  team2Melds: { rank: [Card, Card, ...] },
  
  // Scoring
  cumulativeScores: { team1: Number, team2: Number },
  finalScores: { team1: {...}, team2: {...} },
  
  // Control
  currentPlayer: Number,
  turnPhase: 'draw'|'playing'|'game_over',
  matchIsOver: Boolean,
  disconnectedPlayers: { 0: Boolean, ... }
}
```

### Global Client State (state.js)
```javascript
{
  socket: Socket,                    // Socket.IO connection
  playerToken: String,               // JWT from localStorage
  playerUsername: String,
  isPremium: Boolean,
  gameId: String,                    // Current game ID
  mySeat: Number,                    // My position (0-3)
  gameState: Object,                 // Full game state from server
  selectedIndices: [],               // Selected cards in hand
  stagedMelds: [],                   // Cards staged for melding
  seatTimers: { 0: 720, 1: 720 },   // Seconds per player
  isTransitioning: Boolean,          // Screen navigation flag
  discardAnimationActive: Boolean    // Prevent render conflicts
}
```

---

## 6. Socket Events Architecture

### Key Event Categories

**Authentication & Session**
- `connection` → Socket joins, JWT verified
- `disconnect` → Player leaves, forfeit timer starts
- `reconnect` → Player returns, restore game state

**Queue & Matchmaking**
- `request_join` → Add to queue
- `queue_update` → Broadcast queue count
- `deal_hand` → Game ready, send initial state

**Game Lobby**
- `lobby_update` → Announce players & ready status
- `ready_status` → Track who's ready
- `act_ready` → Player signals ready

**Gameplay**
- `act_draw` → Draw card action
- `act_meld` → Meld cards action
- `act_discard` → Discard card (end turn)
- `act_pickup` → Pick up discard pile
- `update_game` → Broadcast game state post-action

**Round/Match End**
- `timer_sync` → Synchronize turn timers
- `match_over` → Match winner announced
- `ready_status` → Next round ready votes
- `rematch_update` → Rematch voting

---

## 7. Key Business Logic Flows

### Authentication Flow
```
1. User enters username/password → client.js
2. POST /api/register or /api/login → routes/auth.js
3. routes/auth.js:
   - Hash password (bcryptjs)
   - Create/find User in MongoDB
   - Generate JWT token
   - Return token
4. client.js:
   - Save token to localStorage
   - Save state.playerToken
   - Initialize socket with token in handshake
5. server.js socket handler:
   - Verify JWT
   - Create playerSessions entry
   - Confirm authenticated
```

### Matchmaking Flow
```
1. Player clicks "Find Match" → connectToGame('rated')
2. client.js emits: request_join { mode: 'rated_4' }
3. server.js handler:
   - matchmaking.js: Add to matchmakingQueues['rated_4']
   - Emit queue_update to socket
4. Every 5s interval in matchmaking.js:
   - Check if queue has 4 players OR 30s elapsed
   - If ready: Create CanastaGame instance
   - If timeout: Create bots to backfill
   - Call sendUpdate() → broadcast deal_hand
5. All 4 client.js listeners:
   - Listen for deal_hand event
   - Update state.gameState with full game state
   - UI.navTo('screen-game')
6. Gameplay begins
```

### Game Action Flow
```
1. Player action: Click card to discard
2. client.js:
   - handleDiscardClick() handler
   - Validate card selection (UI only)
   - socket.emit('act_discard', { seat, cardIndex })
3. server.js socket handler 'act_discard':
   - Validate game exists & is player's turn
   - Call game.discardFromHand()
   - Success: sendUpdate() to broadcast new state
   - Failure: emit error_message
4. All connected clients (players + spectators):
   - Listen for update_game or deal_hand
   - Mutate state.gameState
   - UI.renderGame() re-renders board
   - animations.js plays card flight animation
5. Turn advances to next player
```

---

## 8. Critical Dependencies (package.json)

| Package | Purpose | Version |
|---------|---------|---------|
| express | HTTP server & routing | ^5.2.1 |
| socket.io | Real-time communication | ^4.8.1 |
| mongoose | MongoDB ORM | ^9.1.2 |
| jsonwebtoken | JWT authentication | ^9.0.3 |
| bcryptjs | Password hashing | ^3.0.3 |
| stripe | Payment processing | (no version) |
| cors | Cross-origin support | ^2.8.6 |
| dotenv | Environment config | ^17.2.3 |
| express-rate-limit | API rate limiting | ^8.2.1 |
| @capacitor/* | Mobile bridge | ^8.0.x |

---

## 9. Environment Configuration

### Production (.env)
```
MONGO_URI=mongodb+srv://[credentials]@[cluster]/canasta
JWT_SECRET=[generated 32-byte secret]
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
PORT=80 or 443 (via reverse proxy)
NODE_ENV=production
DEV_MODE=false
```

### Development (.env.development)
```
DEV_MODE=true              # Skip authentication
JWT_SECRET=dev_secret_key
MONGO_URI=mongodb://127.0.0.1:27017/canasta-dev
STRIPE_SECRET_KEY=sk_test_fake
PORT=8080
NODE_ENV=development
```

---

## 10. File Modification Hot Spots

**Most frequently changed files during active development:**

| File | Purpose | Change Frequency |
|------|---------|------------------|
| server.js | Add socket handlers, game logic hooks | 🔴 Very High |
| www/client.js | Update event listeners, UI handlers | 🔴 Very High |
| www/game.js | Adjust game rules, scoring logic | 🟠 High |
| www/index.html | Add screens, modify layout | 🟠 High |
| www/ui.js | Render updates, navigation logic | 🟠 High |
| scripts/bot.js | Improve AI decision-making | 🟡 Medium |
| routes/auth.js | Auth flow changes | 🟡 Medium |
| www/style.css | UI/UX polish | 🟡 Medium |
| models/user.js | Schema updates (requires migration) | 🟢 Low |
| package.json | Dependency updates | 🟢 Low |

---

## 11. Performance & Scaling Notes

### Current Bottlenecks
- In-memory game storage (loses on server restart)
- No game persistence layer
- Broadcast to all spectators every action (unthrottled)
- No database indexing on game queries

### Scalability Recommendations
1. **Redis Cache** for session data
2. **Database Persistence** for completed games
3. **Game State Snapshots** every 5 turns
4. **Spectator Rate Limiting** (broadcast every 2-3s, not per action)
5. **Horizontal Scaling** via Socket.IO adapter (Redis pub/sub)

---

## 12. Security Considerations

| Component | Security Measure | Status |
|-----------|-----------------|--------|
| Authentication | JWT tokens, bcrypt hashing | ✅ Implemented |
| Authorization | Role-based game access | ✅ Implemented |
| API Rate Limiting | express-rate-limit | ✅ Implemented |
| CORS | Whitelist specific origins | ✅ Implemented |
| Payment | Stripe webhook verification | ✅ Implemented |
| Input Validation | Game action validation | ✅ Implemented |
| SQL Injection | Using Mongoose ORM | ✅ Protected |
| XSS | No innerHTML usage (direct DOM) | ✅ Protected |
| CSRF | Socket.IO auth token | ✅ Protected |

---

## 13. Key Technologies Explained

### Socket.IO Rooms Pattern
```javascript
// Server broadcasts to specific game
io.to(gameId).emit('update_game', gameState);

// Specific player gets their hand
io.to(socketId).emit('deal_hand', handState);

// Broadcast to all connected clients
io.emit('leaderboard_update', topPlayers);
```

### JWT Authentication Flow
```javascript
// Login generates token
const token = jwt.sign({ id, username }, JWT_SECRET, { expiresIn: '7d' });

// Socket handshake includes token
socket = io(SERVER, { auth: { token } });

// Server verifies on connection
const decoded = jwt.verify(token, JWT_SECRET);
```

### Game State Broadcasting Pattern
```javascript
// After action completes
sendUpdate(gameId, socketId, seat);
  ↓
// Sends to individual player:
io.to(socketId).emit('deal_hand', {
  seat: 0,
  hand: [...cards visible to player 0],
  team1Melds, team2Melds, scores, etc
});
  ↓
// Also broadcasts to all in game room:
io.to(gameId).emit('update_game', {
  // Only public data (no hand cards)
  melds, scores, current player, etc
});
```

---

## 14. Testing & Debugging Resources

### Local Testing Commands
```bash
# Start dev server
npm run dev

# Run bot tournament
node tests/simrun.js

# Test single scenario
node scripts/scenarios.test.js

# Clear training logs
node clear_logs.js

# Check health
curl http://localhost:8080/health
```

### Browser Console Debugging
```javascript
// Inspect game state
console.log(state.gameState);

// Send socket event manually
state.socket.emit('act_discard', { seat: 0, cardIndex: 2 });

// Monitor all socket events
state.socket.onAny((event, ...args) => console.log(event, args));

// View token & auth
console.log(state.playerToken);
```

---

## 15. Deployment Architecture

```
                    ┌─────────────────────┐
                    │   Client Browser    │
                    │   (www/ static)     │
                    └──────────┬──────────┘
                               │
                       HTTPS / WSS
                               │
        ┌──────────────────────┴──────────────────────┐
        │                                             │
        │  Reverse Proxy (Nginx/Caddy)               │
        │  - SSL termination                         │
        │  - Load balancing                          │
        │  - Rate limiting                           │
        │                                             │
        └──────────────────────┬──────────────────────┘
                               │
        ┌──────────────────────┴──────────────────────┐
        │                                             │
    ┌───▼────┐                                   ┌───▼────┐
    │ Node.js │         Socket.IO                │ Node.js │
    │Server 1 │◄──Adapter (Redis)───►│Server 2 │
    └───┬────┘                                   └───┬────┘
        │                                            │
        └──────────────┬───────────────────────────┘
                       │
            ┌──────────▼────────────┐
            │   MongoDB Replica     │
            │      Set / Atlas      │
            └───────────────────────┘
```

---

**Last updated:** April 2026  
**Maintained by:** Development Team  
**Status:** Production Ready

