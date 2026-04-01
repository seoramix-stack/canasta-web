# Canasta Master Club - Matchmaking & Spectator System
## Complete Technical Documentation

**Last Updated:** April 2026  
**Status:** Implementation Guide (MVP Design)  
**Target Audience:** Backend Engineers, Full-Stack Developers, DevOps

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Architecture](#architecture)
3. [User Flows](#user-flows)
4. [API Reference](#api-reference)
5. [Data Models](#data-models)
6. [Feature Implementation Guide](#feature-implementation-guide)
7. [Socket Events](#socket-events)
8. [Risk Assessment & Mitigation](#risk-assessment--mitigation)
9. [Deployment Checklist](#deployment-checklist)

---

## System Overview

### Product Goals

The Canasta Master Club platform aims to achieve **three distinct game modes** at launch:

1. **Ranked Mode** (Competitive, ELO-impacting)
   - Auto-match queue only
   - One official ruleset (Standard: Draw 2, 2 Out)
   - Real-time visibility of ongoing games
   - Spectator-friendly (hand visibility hidden)

2. **Casual Mode** (Social, Non-competitive)
   - Browse visible open tables
   - Create or join multi-table environments
   - No ELO impact
   - Easy access for new players

3. **Spectator Mode** (Engagement)
   - Watch live ranked games
   - See public game state only (no hidden information)
   - Post-game replay viewing
   - Increases platform perceived activity

### Current State vs. Target

| Feature | Current | Target | Effort |
|---------|---------|--------|--------|
| Auto-match queue | ✅ Exists | ✅ Keep | 0 |
| Private rooms | ✅ Exists | ✅ Evolved to casual | 2h |
| Visible table list | ❌ Missing | ✅ New | 3-5h |
| Ranked ruleset lock | ❌ No validation | ✅ Enforced | 1h |
| Spectator mode | ❌ Missing | ✅ New | 6-8h |
| Queue visibility | ⚠️ Hidden | ✅ Shown | 1-2h |

---

## Architecture

### System Topology

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENTS (Web + Android)              │
│  [Player] [Player] [Spectator] [Player] [Spectator]         │
└─────────────────────────┬──────────────────────────────────┘
                          │ Socket.IO (JWT Auth)
                          │
        ┌─────────────────┴──────────────────┐
        │                                    │
    ┌───▼─────────┐          ┌───────────────▼────┐
    │   Server    │          │   MongoDB (Prod)   │
    │ (Express +  │◄────────►│   In-Memory (Dev)  │
    │ Socket.IO)  │          │                    │
    └───┬─────────┘          └────────────────────┘
        │
        ├─ Queue Service (Matchmaking)
        ├─ Game Manager (Run/Track Games)
        ├─ Session Manager (User/Socket Tracking)
        └─ Broadcast Handler (State Distribution)
```

### Component Interaction Flow

**Ranked Match Lifecycle:**
```
Player A                Server                  Player B
   │                      │                        │
   ├─ request_join ────────>
   │                      │
   │                 [Add to queue_4_rated]
   │                      │
   │                      │  <─ queue_update (1/4)
   │                      │─────>
   │                      │
   │                      │  <─ queue_update (2/4)
   │                      │
   │ <──request_join────────
   │                      │
   │                 [Queue = 4, Create Game]
   │                      │
   │  <─ deal_hand ────────
   │                      │
   │  <─ lobby_update ─────  [emit to gameId room]
   │                      │
   ├─ act_ready ─────────>
   │                      │
   │  <─ ready_status ─────
   │                      │
   │  <─ update_game ──────  [Everyone sees hands]
   │                      │
   ├─ act_draw ──────────>
   │                      │
   │  <─ update_game ──────  [Broadcast to gameId room]
   │                      │
```

**Casual Table Lifecycle:**
```
Player A                Server                  Player B
   │                      │                        │
   ├─ request_create ────-->
   │                      │
   │  <─ private_created ──  [Game in lobby mode]
   │                      │
   │  <- lobby_update ─────
   │    (only players in room)
   │                      │
   │ [Share Room Code externally]
   │                      │
   │ <── request_join_private
   │       (Player B joins via code)
   │                      │
   │  <─ joined_success ───
   │                      │
   ├──────────────────────>  <─ lobby_update ─
   │                      │
   ├─ act_host_start ────>
   │    (only host can)   │
   │                      │ [Game starts]
   │  <─ deal_hand ────────
   │                      │
```

---

## User Flows

### Flow 1: Ranked Match (Queue Auto-Match)

```
Login
  ↓
Home Screen
  ↓
"🏆 FIND MATCH" button (screen-online)
  ↓
Select: 2P or 4P
  ↓
connectToGame('rated') event sent
  ↓
Screen transitions → screen-queue
  ↓
Socket: request_join { mode: 'rated', playerCount: 4 }
  ↓
[Server adds to matchmakingQueues['rated_4']]
  ↓
socket.on('queue_update') shows: "Waiting for 3 more..."
  ↓
[After ~30s or when 4th player joins]
  ↓
socket.on('deal_hand') triggers:
  - screen transitions → screen-lobby (ready modal)
  - Shows all 4 player names
  ↓
Player clicks "READY"
  ↓
socket.emit('act_ready', { seat })
  ↓
[Server checks if all ready]
  ↓
socket.on('update_game') triggers:
  - All clients auto-navigate → screen-game
  - Game board renders with hand + melds
  ↓
[Turn-based play: draw → meld → discard]
  ↓
[Round ends]
  ↓
screen-victory shows scores
  ↓
Rematch vote or back to home
```

### Flow 2: Casual Table Browse & Join

```
Login
  ↓
Home Screen
  ↓
"💬 PLAY CASUAL" button (new - screen-online variant)
  ↓
Screen: screen-casual-tables
  ↓
socket.on('tables_list') shows:
  - [Table 1] Created by Alice, 2/4 players, Standard rules
  - [Table 2] Created by Bob, 1/4 players, Easy rules
  ↓
Player clicks "JOIN" on Table 1
  ↓
socket.emit('request_join_private', { gameId })
  ↓
socket.on('joined_private_success') triggers:
  - screen transitions → screen-lobby
  - Shows Alice (seat 0), empty (seat 1), Charlie (seat 2), empty (seat 3)
  ↓
[Wait for 4th player OR creator starts early if everyone ready]
  ↓
Alice (host) clicks "START MATCH"
  ↓
socket.on('deal_hand') triggers:
  - screen transitions → screen-game
  ↓
[Play normally]
```

### Flow 3: Spectate Ranked Game

```
Login
  ↓
Home Screen
  ↓
"👁 WATCH GAMES" button (new - if MVP includes spectate)
  ↓
Screen: screen-ranked-games (shows active ranked matches)
  ↓
socket.on('ranked_games_list') shows:
  - [Game 1] Alice vs Bob (Standard, Round 2/5, Team 1: 2400 pts)
  - [Game 2] Charlie vs Diana (Standard, Round 1/5, Team 1: 1100 pts)
  ↓
Player clicks "WATCH" on Game 1
  ↓
socket.emit('request_spectate', { gameId: 'game_abc123' })
  ↓
Server validation:
  - Game exists? ✓
  - Game is ranked (not private)? ✓
  - Allow spectator? ✓
  ↓
socket.on('spectate_view') returns:
  {
    names: ['Alice', 'Bob', 'Charlie', 'Diana'],
    melds: [[...], [...], [...], [...]],  // Visible stacks only
    hand_counts: [8, 7, 9, 6],            // No specifics!
    topDiscard: { suit: 'hearts', rank: '7' },
    currentPlayer: 1,                      // Bob's turn
    cumulativeScores: { team1: 2400, team2: 1950 },
    phase: 'playing'
  }
  ↓
Screen transitions → screen-spectate
  ↓
Renders: melds, hand counts (closed fists), discard pile, scores
  ↓
Updates every 2-3 seconds via socket events
  ↓
Round ends → can stay and watch next round or go back
```

---

## API Reference

### Socket Events

#### Client → Server

##### **Matchmaking & Queue**

| Event | Data | Response | Purpose |
|-------|------|----------|---------|
| `request_join` | `{ mode: 'rated'\|'casual', playerCount: 2\|4, ruleset: 'standard'\|'easy' }` | `queue_update` or `deal_hand` | Enter matchmaking queue or create backfill game |
| `request_create_private` | `{ gameId: string, playerCount: 2\|4, ruleset: string }` | `private_created` | Create a new casual table |
| `request_join_private` | `{ gameId: string }` | `joined_private_success` | Join existing casual table by code |
| `leave_game` | none | Navigation to home | Disconnect from queue or game |

##### **Casual Rooms**

| Event | Data | Response | Purpose |
|-------|------|----------|---------|
| `get_active_tables` | `{ ruleset?: string, playerCount?: 2\|4 }` | `tables_list` | Fetch list of joinable casual games |
| `request_spectate` | `{ gameId: string }` | `spectate_view` or `error_message` | Request spectator access to game |
| `leave_spectate` | none | Navigation | Exit spectator mode |

##### **Game Actions**

| Event | Data | Response | Purpose |
|-------|------|----------|---------|
| `act_ready` | `{ seat: number }` | `ready_status` | Signal readiness to start |
| `act_host_start` | none (context: socket.data.gameId) | `deal_hand` | Host initiates game start (private room only) |
| `act_draw` | `{ seat: number }` | `update_game` | Draw cards from deck |
| `act_pickup` | `{ seat: number }` | `update_game` | Pick up discard pile |
| `act_meld` | `{ seat: number, indices: number[], targetRank: string }` | `update_game` | Meld cards to table |
| `act_discard` | `{ seat: number, index: number }` | `update_game` | Discard card to end turn |
| `act_next_round` | none | `next_round_ack` | Vote to start next round after game over |
| `act_request_rematch` | none | `rematch_update` | Vote to rematch |

---

#### Server → Client

##### **Queue & Matching**

| Event | Data | Purpose |
|-------|------|---------|
| `queue_update` | `{ count: number, needed: number }` | Update player on queue status |
| `queue_status` | `{ queue_2: number, queue_4: number, avgWaitTime: string }` | Broadcast general queue metrics |
| `deal_hand` | Game state object | Signal game creation, move to screen-game or lobby |
| `lobby_update` | `{ names: string[], hostSeat: number, maxPlayers: number }` | Update lobby player list |

##### **Casual Tables**

| Event | Data | Purpose |
|-------|------|---------|
| `tables_list` | `[{ gameId, createdBy, playersJoined, playersMax, ruleset, createdAt }]` | Send list of active joinable tables |
| `table_updated` | `{ gameId, playersJoined }` | Update: player joined/left table |
| `joined_private_success` | `{ gameId, seat }` | Confirm successful join to private room |
| `private_created` | `{ gameId, seat }` | Confirm room creation, return ID |

##### **Spectator Mode**

| Event | Data | Purpose |
|-------|------|---------|
| `spectate_view` | Public game state (see schema below) | Send game state without hidden information |
| `spectate_updated` | Public game state diff | Update spectator on turn/action |

##### **Game State**

| Event | Data | Purpose |
|-------|------|---------|
| `update_game` | Full game state (hands visible only to that player) | Broadcast after each action |
| `error_message` | `{ message: string }` | Send validation error |
| `ready_status` | `{ readySeats: number[] }` | Show who's ready in lobby |

---

### HTTP Routes

| Method | Path | Auth | Purpose | Response |
|--------|------|------|---------|----------|
| GET | `/api/active-tables` | Optional | List joinable casual games | `{ tables: [...] }` |
| GET | `/api/queue-status` | Optional | Get queue size snapshot | `{ rated_2, rated_4, wait_avg }` |
| GET | `/api/game/:gameId/state` | Optional | Get public game state | `{ state: {...} }` |
| GET | `/api/leaderboard` | Optional | Top 10 players | `{ leaderboard: [...] }` |
| POST | `/api/login` | None | Authenticate user | `{ token, username, stats }` |
| POST | `/api/register` | None | Create account | `{ token, username }` |
| GET | `/api/profile` | JWT | Get user stats | `{ username, stats, isPremium }` |

---

## Data Models

### User Model (MongoDB)

```javascript
{
  _id: ObjectId,
  username: String (unique, lowercase),
  password: String (bcrypt hash),
  eloRating: Number (default: 1200),
  wins: Number (default: 0),
  losses: Number (default: 0),
  isPremium: Boolean (default: false),
  friends: [String], // usernames
  blocked: [String], // usernames
  createdAt: Date,
  updatedAt: Date,
  
  // NEW (for matchmaking visibility)
  currentGameId: String | null,
  isPlaying: Boolean (indexed),
  isLookingForGame: Boolean (indexed),
  lastGameEndedAt: Date
}
```

### Game State Object (In-Memory)

```javascript
games[gameId] = {
  // Core
  gameId: String,
  createdAt: Date,
  lastActivityAt: Date,
  
  // Players
  names: [String, String, String, String],
  playerTokens: { 0: String, 1: String, ... }, // JWT tokens by seat
  
  // Rules
  config: {
    PLAYER_COUNT: 2 | 4,
    HAND_SIZE: 15 | 11,
    DRAW_COUNT: 1 | 2,
    MIN_CANASTAS_OUT: 1 | 2,
    WIN_SCORE: 5000
  },
  
  // Game State
  deck: [Card],
  discardPile: [Card],
  players: [[Card], [Card], [Card], [Card]], // hands by seat
  team1Melds: { '5': [Card], '7': [Card], ... },
  team2Melds: { '3': [Card], 'K': [Card], ... },
  
  // Scoring
  cumulativeScores: { team1: Number, team2: Number },
  finalScores: { team1: { total, breakdown }, team2: {...} },
  
  // Turn Control
  currentPlayer: Number,
  roundStarter: Number,
  turnPhase: 'draw' | 'playing' | 'game_over',
  turnCounter: Number,
  
  // Status
  isRated: Boolean, // true → ranked, false → casual or bot
  isPrivate: Boolean, // true → private room, false → public/queue
  isPublic: Boolean, // true → shows in casual table list
  isLobby: Boolean, // true → waiting for players, false → game active
  matchIsOver: Boolean,
  
  // NEW (for ranked/casual separation)
  rulesetLocked: 'standard' | 'easy', // enforced for ranked
  
  // Spectators
  spectators: Set<socketId>,
  spectatorCount: Number,
  
  // Lobby & Control
  host: String, // socketId of creator
  readySeats: Set<Number>,
  rematchVotes: Set<Number>,
  
  // Timers
  bankTimers: { 0: Number, 1: Number, 2: Number, 3: Number },
  disconnectedPlayers: { 0: Boolean, ... }
}
```

### Spectator View Data (Filtered)

```javascript
// Sent to spectator sockets only
{
  gameId: String,
  names: [String, String, String, String],
  
  // Visible melds only
  team1Melds: { '5': [Card], '7': [Card], ... },
  team2Melds: { '3': [Card], 'K': [Card], ... },
  
  // Counts only (no specifics)
  hand_counts: [Number, Number, Number, Number], // 6, 8, 7, 5
  
  // Discard pile
  topDiscard: Card,
  discard_count: Number,
  
  // Turn info
  currentPlayer: Number,
  turnPhase: 'draw' | 'playing' | 'game_over',
  
  // Scores
  cumulativeScores: { team1: Number, team2: Number },
  phase: String
}
```

### Table List Item

```javascript
{
  gameId: String,
  createdBy: String, // creator username
  playersJoined: Number,
  playersMax: Number,
  ruleset: 'standard' | 'easy',
  createdAt: Date,
  updatedAt: Date
}
```

---

## Feature Implementation Guide

### Phase 1: Casual Table Browsing (Recommended First)

**Objective:** Enable users to see and join open casual tables without coding.

#### Step 1a: Update Game Initialization (Server)

In `server.js`, when creating games via `request_create_private`:

```javascript
// Around line 598 in server.js
games[gameId] = new CanastaGame(config);
games[gameId].isPrivate = true;
games[gameId].isPublic = true;        // NEW: Always show created casual rooms
games[gameId].isLobby = true;
games[gameId].host = socket.id;
games[gameId].createdAt = Date.now(); // NEW: Track creation time
games[gameId].lastActivityAt = Date.now();
games[gameId].rulesetLocked = null;   // NEW: Casual rooms not locked
```

#### Step 1b: Add Socket Handler for Table List (Server)

In `server.js`, inside socket connection handler (after line 351):

```javascript
socket.on('get_active_tables', () => {
  const activeTables = Object.entries(games)
    .filter(([id, g]) => {
      // Only show: public, in lobby (not active), has empty seats
      return g.isPublic && g.isLobby && 
             g.names.some(n => n === null);
    })
    .map(([id, g]) => ({
      gameId: id,
      createdBy: g.names[0] || 'Unknown',
      playersJoined: g.names.filter(n => n !== null).length,
      playersMax: g.config.PLAYER_COUNT,
      ruleset: g.config.DRAW_COUNT === 1 ? 'easy' : 'standard',
      createdAt: g.createdAt
    }));

  socket.emit('tables_list', activeTables);
});
```

**Then broadcast periodically:**

```javascript
// In server.js, after io definition (line 145)
setInterval(() => {
  const activeTables = Object.entries(games)
    .filter(([id, g]) => g.isPublic && g.isLobby && g.names.some(n => n === null))
    .map(([id, g]) => ({...})); // Same mapping as above

  io.emit('tables_list', activeTables);
}, 15000); // Broadcast every 15 seconds
```

#### Step 1c: Add UI Screen (Frontend)

In `www/index.html`, add new screen after `screen-online` (around line 310):

```html
<div id="screen-casual-tables" class="app-screen">
    <div class="screen-header">
        <h2>CASUAL TABLES</h2>
        <div class="back-nav" onclick="navTo('screen-online')">
            <span class="back-text">&lt; BACK</span>
        </div>
    </div>

    <div id="tables-list-container" style="width: 100%; max-width: 500px;">
        <div style="text-align:center; color:#aaa; margin-top:30px;">Loading tables...</div>
    </div>

    <button class="menu-btn secondary" onclick="navTo('screen-create-room')" style="margin-top: 20px;">
        CREATE NEW TABLE
    </button>
</div>
```

#### Step 1d: Update Home Screen Option (Frontend)

In `www/index.html`, update `screen-online` (around line 310):

```html
<div id="screen-online" class="app-screen">
    <h2>PLAY ONLINE</h2>

    <!-- EXISTING: Ranked -->
    <button class="menu-btn primary" onclick="connectToGame('rated')">🏆 FIND MATCH</button>
    <div class="info-text">Ranked matches. Auto-match.</div>

    <hr style="width: 50%; border-color: #555; margin: 15px 0;">

    <!-- NEW: Casual -->
    <div style="color: #bdc3c7; margin-bottom:10px;">CASUAL</div>

    <button class="menu-btn secondary" onclick="navTo('screen-casual-tables')">💬 BROWSE TABLES</button>
    <div class="info-text">Join open casual tables.</div>

    <button class="menu-btn secondary" onclick="navTo('screen-create-room')">🔒 CREATE TABLE</button>

    <br>
    <button class="menu-btn text-only" onclick="navTo('screen-home')">BACK</button>
</div>
```

#### Step 1e: Add Frontend Socket Handler (client.js)

In `www/client.js`, add listener (after line 850):

```javascript
state.socket.on('tables_list', (tables) => {
    const container = document.getElementById('tables-list-container');
    if (!container) return;

    if (tables.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#aaa; margin-top:30px;">No open tables.</div>';
        return;
    }

    container.innerHTML = tables.map(t => `
        <div style="display:flex; justify-content:space-between; padding:10px; 
                    background:rgba(0,0,0,0.3); margin:10px 0; border-radius:5px; 
                    align-items:center;">
            <div>
                <div style="font-weight:bold; color:#f1c40f;">${t.createdBy}'s Table</div>
                <div style="font-size:12px; color:#bdc3c7;">
                    ${t.playersJoined}/${t.playersMax} • ${t.ruleset === 'easy' ? 'Draw 1' : 'Draw 2'}
                </div>
            </div>
            <button class="menu-btn secondary" onclick="joinCasualTable('${t.gameId}')">
                JOIN
            </button>
        </div>
    `).join('');
});
```

#### Step 1f: Add Window Function (client.js)

In `www/client.js`, expose function to HTML:

```javascript
window.joinCasualTable = (gameId) => {
    if (state.socket) {
        state.socket.emit('request_join_private', { gameId: gameId });
    }
};
```

#### Step 1g: Request Table List on Screen Navigate (client.js)

In `www/client.js`, update `navTo` override or add listener:

```javascript
// Listen for navigation to casual tables
const originalNavTo = window.navTo;
window.navTo = (screenId) => {
    originalNavTo(screenId);
    if (screenId === 'screen-casual-tables' && state.socket) {
        state.socket.emit('get_active_tables');
    }
};
```

**Testing:**
1. Open 2 browser windows
2. Window A: Create a casual table (screen-create-room → "CREATE & JOIN")
3. Window B: Go to "BROWSE TABLES" → Should see Window A's table
4. Window B: Click "JOIN" → Should join lobby

---

### Phase 2: Ranked Queue Visibility (Minimal Effort)

**Objective:** Show players real-time queue size and estimated wait.

#### Step 2a: Broadcast Queue Status (Server)

In `server.js`, add after queue interval (around line 268):

```javascript
// Periodically broadcast queue status to all connected clients
setInterval(() => {
  const queueStatus = {
    rated_2: matchmakingQueues['rated_2'].length,
    rated_4: matchmakingQueues['rated_4'].length,
    casual_2: matchmakingQueues['casual_2'].length,
    casual_4: matchmakingQueues['casual_4'].length
  };

  io.emit('queue_status_broadcast', queueStatus);
}, 15000); // Every 15 seconds
```

#### Step 2b: Update Queue Screen Message (Frontend)

In `www/client.js`, enhance `queue_update` handler (around line 807):

```javascript
state.socket.on('queue_update', (data) => {
    const el = document.getElementById('queue-msg');
    if (el) {
        const needed = data.needed - data.count;
        if (needed > 1) {
            el.innerText = `Waiting for ${needed} more player${needed > 1 ? 's' : ''}...`;
        } else if (needed === 1) {
            el.innerText = 'Almost ready! Waiting for 1 more...';
        } else {
            el.innerText = 'Game starting...';
        }
    }
});
```

---

### Phase 3: Spectator Mode (Higher Effort)

**Objective:** Allow watching ongoing ranked games with hidden card info.

#### Step 3a: Create Spectator View Function (Server)

In `server.js`, add function before io.on('connection') (around line 330):

```javascript
function createSpectatView(gameId) {
  const game = games[gameId];
  if (!game) return null;

  return {
    gameId: gameId,
    names: game.names,
    team1Melds: game.team1Melds,
    team2Melds: game.team2Melds,
    hand_counts: game.players.map(hand => hand.length),
    topDiscard: game.discardPile[game.discardPile.length - 1] || null,
    discard_count: game.discardPile.length,
    currentPlayer: game.currentPlayer,
    turnPhase: game.turnPhase,
    cumulativeScores: game.cumulativeScores,
    turnCounter: game.turnCounter || 0,
    phase: game.turnPhase
  };
}
```

#### Step 3b: Add Spectate Request Handler (Server)

In `server.js`, inside socket connection handler:

```javascript
socket.on('request_spectate', (data) => {
  const { gameId } = data;
  const game = games[gameId];

  // Validation
  if (!game) {
    return socket.emit('error_message', 'Game not found.');
  }
  if (game.isPrivate) {
    return socket.emit('error_message', 'Cannot spectate private games.');
  }
  if (!game.isRated) {
    return socket.emit('error_message', 'Can only spectate ranked games.');
  }

  // Add to spectator set
  if (!game.spectators) game.spectators = new Set();
  game.spectators.add(socket.id);
  if (!game.spectatorCount) game.spectatorCount = 0;
  game.spectatorCount++;

  // Join socket to game room (for broadcasts)
  socket.join(gameId);
  socket.data.spectatingGameId = gameId;

  // Send initial state
  const specView = createSpectatView(gameId);
  socket.emit('spectate_view', specView);

  console.log(`[Spectate] ${socket.id} watching game ${gameId}. Total: ${game.spectatorCount}`);
});

socket.on('leave_spectate', () => {
  const gameId = socket.data.spectatingGameId;
  const game = games[gameId];

  if (game && game.spectators) {
    game.spectators.delete(socket.id);
    game.spectatorCount--;
  }

  socket.leave(gameId);
  socket.data.spectatingGameId = null;
});
```

#### Step 3c: Modify sendUpdate to Include Spectators (Server)

In `server.js`, find `sendUpdate()` function (around line 1309) and modify:

```javascript
function sendUpdate(gameId, socketId, seat) {
  // ... existing player view logic ...

  // Then add spectator updates
  const game = games[gameId];
  if (game && game.spectators && game.spectators.size > 0) {
    const specView = createSpectatView(gameId);
    io.to(gameId).emit('spectate_view', specView);
  }
}
```

#### Step 3d: Create Spectator UI Screen (Frontend)

In `www/index.html`, add screen:

```html
<div id="screen-spectate" class="app-screen">
    <div class="screen-header">
        <h2>WATCHING GAME</h2>
        <div class="back-nav" onclick="leaveSpectate()">
            <span class="back-text">&lt; BACK</span>
        </div>
    </div>

    <div id="spectate-info" style="text-align:center; margin-bottom:20px;">
        <div style="color:#bdc3c7; font-size:12px;">
            <span id="spectate-players"></span> • Turn <span id="spectate-turn">1</span>
        </div>
    </div>

    <div id="spectate-board" style="background:rgba(0,0,0,0.4); padding:15px; 
                                      border-radius:5px; margin-bottom:20px;">
        <div style="color:#f1c40f; margin-bottom:10px; font-weight:bold;">MELDS</div>
        <div id="spectate-melds">Team1: <span id="spec-t1-melds">0</span> | Team2: <span id="spec-t2-melds">0</span></div>
    </div>

    <div id="spectate-scores" style="display:flex; gap:20px; justify-content:center;">
        <div style="text-align:center;">
            <div style="color:#bdc3c7; font-size:12px;">TEAM 1</div>
            <div style="font-size:24px; color:#f1c40f;" id="spectate-score-1">--</div>
        </div>
        <div style="text-align:center;">
            <div style="color:#bdc3c7; font-size:12px;">TEAM 2</div>
            <div style="font-size:24px; color:#f1c40f;" id="spectate-score-2">--</div>
        </div>
    </div>
</div>
```

#### Step 3e: Add Spectate Socket Handler (Frontend)

In `www/client.js`, add:

```javascript
state.socket.on('spectate_view', (data) => {
  // Update spectator UI
  const names = data.names.join(', ');
  document.getElementById('spectate-players').innerText = names;
  document.getElementById('spectate-turn').innerText = data.turnCounter;
  
  document.getElementById('spectate-score-1').innerText = data.cumulativeScores.team1;
  document.getElementById('spectate-score-2').innerText = data.cumulativeScores.team2;
  
  const t1Count = Object.keys(data.team1Melds).length;
  const t2Count = Object.keys(data.team2Melds).length;
  document.getElementById('spec-t1-melds').innerText = t1Count;
  document.getElementById('spec-t2-melds').innerText = t2Count;
});

window.leaveSpectate = () => {
  if (state.socket) {
    state.socket.emit('leave_spectate');
  }
  navTo('screen-home');
};
```

#### Step 3f: Add Window Function

In `www/client.js`:

```javascript
window.spectateGame = (gameId) => {
  if (state.socket) {
    state.socket.emit('request_spectate', { gameId: gameId });
    UI.navTo('screen-spectate');
  }
};
```

---

## Risk Assessment & Mitigation

### Risk 1: Cheating via Spectator Mode (HIGH)

**Issue:** Spectator can see all cards if full state is sent.

**Mitigation:**
- ✅ Only send public state (melds, counts, not cards)
- ✅ Restrict to ranked games (not friends' private games)
- ✅ Log spectator access to fraud detection

**Implementation:**
```javascript
// In createSpectatView, DO NOT include:
// - game.players (hand cards)
// - game.team1Red3s / game.team2Red3s (unrevealed bonuses)

// DO include:
// - Meld stacks (already face-up on table)
// - Hand counts (no card specifics)
// - Top discard (visible to everyone)
```

---

### Risk 2: Server Memory Leak (MEDIUM)

**Issue:** Stale games never cleaned up, server RAM grows unbounded.

**Mitigation:**
- Add automated cleanup job
- Track `lastActivityAt`, delete if inactive > 15 minutes and not in progress
- Log cleanup actions

**Implementation:**
```javascript
// In server.js, add scheduled cleanup
setInterval(() => {
  const now = Date.now();
  const timeout = 15 * 60 * 1000; // 15 minutes

  Object.entries(games).forEach(([gameId, game]) => {
    if (!game.matchIsOver && game.lastActivityAt) {
      const staleTime = now - game.lastActivityAt;
      if (staleTime > timeout) {
        console.log(`[Cleanup] Deleting stale game ${gameId}`);
        delete games[gameId];
        if (gameBots[gameId]) delete gameBots[gameId];
      }
    }
  });
}, 5 * 60 * 1000); // Check every 5 minutes
```

---

### Risk 3: Ruleset Bypass (MEDIUM)

**Issue:** Players select 'easy' in UI but queue for ranked (gets ELO impact anyway).

**Mitigation:**
- Force ruleset override for ranked in matchmaking
- Validate on server, not client

**Implementation:**
```javascript
// In matchmaking.js joinGlobalGame():
if (mode === 'rated') {
  // IGNORE client ruleset, force standard
  data.ruleset = 'standard';
  gameConfig.DRAW_COUNT = 2;
  gameConfig.MIN_CANASTAS_OUT = 2;
}
```

---

### Risk 4: Private Room Visibility (LOW)

**Issue:** If private room marked as `isPublic: true` by mistake, appears in table list.

**Mitigation:**
- Code review: Ensure `isPublic` only set for casual rooms via `request_create_private`
- Never set for ranked queue games
- Add server validation

**Implementation:**
```javascript
// In game creation:
if (mode === 'rated') {
  game.isPublic = false; // ENFORCE
  game.isPrivate = FALSE; // Queue games are public internally but not in table list
} else if (requestedId) {
  game.isPublic = true; // Casual rooms only
}
```

---

### Risk 5: Spectator Broadcast Load (MEDIUM)

**Issue:** Sending spectator state to 1000 spectators every 100ms = heavy CPU.

**Mitigation:**
- Broadcast spectator view only on actual state changes, not every tick
- Limit spectators per game or implement fairness
- Cache spectator view, send diffs only

**Implementation:**
```javascript
// In sendUpdate: only broadcast spectator view if state changed
let lastSentSpecView = {};

function sendUpdate(gameId, socketId, seat) {
  // ... player update logic ...
  
  const game = games[gameId];
  if (game && game.spectators && game.spectators.size > 0) {
    const newSpecView = createSpectatView(gameId);
    
    // Only send if different from last
    if (JSON.stringify(newSpecView) !== JSON.stringify(lastSentSpecView[gameId])) {
      io.to(gameId).emit('spectate_view', newSpecView);
      lastSentSpecView[gameId] = newSpecView;
    }
  }
}
```

---

## Deployment Checklist

### Pre-Launch (2-3 Days Before)

- [ ] Database backup created
- [ ] All three phases tested in dev mode
- [ ] Load test: 100+ concurrent queue players
- [ ] Mobile (Android/iOS) tested for spectator networking
- [ ] Feedback collected from beta testers

### Launch Day

- [ ] Add `isPublic`, `rulesetLocked` fields to production database
- [ ] Verify all socket event handlers pass lint (`npm run lint`)
- [ ] Deploy updated `server.js`, `www/client.js`, `www/index.html`
- [ ] Monitor server logs for errors in first 30 minutes
- [ ] Watch queue fill times (should be < 2 min for 4p)

### Post-Launch (First Week)

- [ ] Monitor memory usage (check for leaks every 4 hours)
- [ ] Track spectator count and performance impact
- [ ] Collect user feedback on casual table browsing
- [ ] Watch for ruleset bypass attempts in ranked data
- [ ] Document any bug fixes for next patch

### Success Metrics (Target)

- Queue fill time: < 2 minutes (4-player)
- Casual table creation: < 1 minute
- Spectator latency: < 3 seconds behind live
- Server memory: < 500MB (for 100 concurrent games)
- Error rate: < 0.1%

---

## Appendix: Code Snippets

### Quick Migration: Existing `request_create_private` Handler

**Before:**
```javascript
socket.on('request_create_private', (data) => {
  const gameId = data.gameId.trim();
  if (games[gameId]) return socket.emit('error_message', "Room Name already exists.");
  
  games[gameId] = new CanastaGame(config);
  games[gameId].isPrivate = true;
  games[gameId].isLobby = true;
  // ... rest
});
```

**After:**
```javascript
socket.on('request_create_private', (data) => {
  const gameId = data.gameId.trim();
  if (games[gameId]) return socket.emit('error_message', "Room Name already exists.");
  
  games[gameId] = new CanastaGame(config);
  games[gameId].isPrivate = true;
  games[gameId].isLobby = true;
  
  // ADD THESE LINES:
  games[gameId].isPublic = true;
  games[gameId].createdAt = Date.now();
  games[gameId].lastActivityAt = Date.now();
  games[gameId].rulesetLocked = null;
  games[gameId].spectators = new Set();
  games[gameId].spectatorCount = 0;
  
  // ... rest
});
```

---

## Conclusion

This system enables Canasta Master Club to launch with a compelling multiplayer experience:

1. **Ranked mode** focused and efficient (auto-match only)
2. **Casual mode** social and discoverable (table browsing)
3. **Spectator mode** engaging (watch live games without interference)

The modular design allows phased rollout: Start with Phase 1 (casual tables), validate user engagement, then add spectator mode. The risks are well-understood and systematically mitigated.

**Next Step:** Review design with stakeholders, then proceed with Phase 1 implementation.

