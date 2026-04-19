# Canasta Master Club – Architecture & Lobby Handoff Summary

## 1) Project Overview

**What this app is:**
- A multiplayer online Canasta card game with real-time multiplayer (2 or 4 players), bot training, rated ELO matchmaking, and both public/private ("friendly") game modes.

**Main technologies/frameworks:**
- **Frontend**: HTML5, CSS, vanilla JavaScript (no frameworks—DOM manipulation + Socket.IO client)
- **Backend**: Node.js (Express 5.x), Socket.IO 4.8.1
- **Database**: MongoDB (with Mongoose 9.1.2)
- **Real-time**: Socket.IO for game state sync and multiplayer messaging
- **Mobile**: Capacitor 8.x (Android/iOS wrapper)
- **Auth**: JWT tokens (jsonwebtoken 9.0.3), bcryptjs for password hashing
- **Payments**: Stripe API integration (for premium subscriptions)
- **PWA**: Service Worker + manifest for offline support

**High-level app shape:**
```
┌─────────────────────────────────────────────────────────────┐
│                  Frontend (Single HTML File)                 │
│  [client.js] → [state.js] + [ui.js] + [animations.js]       │
│         ↓                                                      │
│  [game.js] game logic + [deck.js] cards + [elo.js] ratings   │
└────────────────┬────────────────────────────────────────────┘
                 │ Socket.IO (WebSocket)
┌────────────────▼────────────────────────────────────────────┐
│                 Backend (server.js)                           │
│  Express routes + Socket.IO handlers                          │
│  ├─ Auth (/api/register, /api/login) → [routes/auth.js]     │
│  ├─ Game state (games {}, gameBots {}, playerSessions {})    │
│  ├─ Lobby handlers (request_create_private, request_join)    │
│  └─ Matchmaking service [www/matchmaking.js]                │
└────────────────┬────────────────────────────────────────────┘
                 │ Mongoose ORM
┌────────────────▼────────────────────────────────────────────┐
│  MongoDB (User model with stats + friends/blocked lists)     │
└─────────────────────────────────────────────────────────────┘
```

---

## 2) Repo Structure

**Important top-level folders:**

| Folder | Responsibility |
|--------|-----------------|
| **www/** | All frontend code (served as static assets from Express) |
| **server.js** | Main backend entry point (production server with Socket.IO) |
| **dev-server.js** | Development server with hot reload |
| **routes/auth.js** | Login/register API endpoints |
| **models/user.js** | MongoDB User schema (username, password, stats, friends, blocked) |
| **scripts/bot.js** | CanastaBot AI class (decision-making for bot players) |
| **scripts/simulator.js** | Testing/training environment for bots |
| **android/** | Capacitor project (native Android app wrapper) |
| **docs/** | Architecture & rules documentation |

**Most important frontend entry points:**

| File | Purpose |
|------|---------|
| www/index.html | Single-page app, all screens defined as divs (screen-home, screen-lobby, screen-game, etc.) |
| www/client.js | Init, socket setup, event listeners, game flow orchestration |
| www/state.js | Global state object (token, gameId, seat, activeData) |
| www/ui.js | Screen navigation (navTo) + render functions for all UI |
| www/game.js | CanastaGame class—complete game rules engine |
| www/matchmaking.js | Queue management & backfill logic |

---

## 3) Runtime Architecture

**Main entry point(s):**
- **Browser**: Loads www/index.html
- **client.js** IIFE (async) on page load:
  1. Checks localStorage for token
  2. If logged in → calls `initializeSession()` → calls `initSocket(token)`
  3. Creates Socket.IO connection to backend
  4. Sets up all socket event listeners (lines 728–1052 in client.js)

**Routing / Screen Navigation:**
- Manual DOM-based navigation: `UI.navTo('screen-<name>')` hides all `.app-screen` divs, shows target screen
- Common flow: `screen-login` → `screen-home` → `screen-online` or `screen-bot` → `screen-lobby` or `screen-game`
- **Special flow**: Friendly games route is `screen-home` → `screen-online` → `screen-friendly-games` → `screen-create-room`/`screen-join-room` → `screen-lobby`

**Screen/Page Composition:**
- All screens are divs in www/index.html with id `screen-<name>`
- Screen content is rendered via JS functions (e.g., `renderLobbySeats()`, `renderFriendlyGamesList()`)
- Buttons and interactive elements use inline `onclick` handlers calling global functions in www/client.js

**State Management:**
- Central singleton object `state` in www/state.js: holds token, username, gameId, seat, activeData, etc.
- Game state (`state.activeData`) is sent from server as `deal_hand` / `update_game` events
- No Redux/Vuex—state is mutated directly and UI re-renders when socket events arrive

**API / WebSocket / Real-time Communication:**
- **HTTP REST** (for auth/profile): `POST /api/register`, `POST /api/login`, `GET /api/profile`, `GET /api/friendly-games`
- **Socket.IO** (for game): All real-time communication uses Socket.IO
  - **Client→Server** (user actions): `act_meld`, `act_discard`, `act_draw`, `request_join`, `request_create_private`, `act_switch_seat`, `act_host_start`, etc.
  - **Server→Client** (updates): `deal_hand`, `update_game`, `lobby_update`, `friendly_games_list`, `match_over`, `timer_sync`, etc.
  - Socket connection is established in `initSocket(token)` and persists throughout the session

**Where game logic lives:**
- **Client-side prediction**: www/game.js can clone/simulate locally (optional, mostly for bots)
- **Server-authoritative**: server.js contains all true game state in `games[gameId]` object (a CanastaGame instance)
- **Bot logic**: scripts/bot.js implements decision-making; bots run on server in event handlers

**Where shared types/models live:**
- Game config: `{ PLAYER_COUNT, HAND_SIZE, DRAW_COUNT, MIN_CANASTAS_OUT }` defined in www/game.js constructor
- Player session: `playerSessions[token] = { gameId, seat, username }` (server only)
- Card representation: `{ suit, rank, id, isWild, isRed3, deckType }` (defined in www/deck.js)

---

## 4) Canasta Domain Model

**Core Game Concepts in Code:**

| Concept | Implementation |
|---------|-----------------|
| **Players** | Array of seats (0, 1, 2, 3 for 4P; 0, 1 for 2P) in `game.players[]` (hands) and `game.names[]` (display names) |
| **Teams** | 2-player=solo teams (p0 vs p1); 4-player=pairs (p0+p2 vs p1+p3). Melds stored in `game.team1Melds` / `game.team2Melds` |
| **Cards / Deck** | Full double deck (2×52) in `game.deck[]`. Each card: `{suit, rank, id}`. Special flags: `isRed3`, `isWild` (for 2s/Jokers) |
| **Discard pile** | `game.discardPile[]` - face-up stack players can draw from if they have a meld |
| **Melds / Books** | Each team has `teamNMelds = { meldId: [card, card, ...] }`. Must be ≥3 cards, natural or with wilds (following Canasta rules) |
| **Red 3s** | Bonus cards (auto-meld face-up when drawn). Stored separately in `game.team1Red3s` / `game.team2Red3s`. Worth +100 pts each |
| **Turns / Phases** | `game.currentPlayer` (seat index), `game.turnPhase` ("draw" → "meld" → "discard" → next player). Turn order is (currentPlayer + 1) % PLAYER_COUNT |
| **Scoring** | `game.finalScores = { team1: X, team2: Y }`, `game.cumulativeScores` (cumulative across rounds). Win at 5000 pts |
| **Round / Match Lifecycle** | Round ends when someone plays last card ("go out"). Match ends when a team reaches 5000 cumulative score |

**Key Classes/Modules & File Paths:**

| Class/Module | File | Responsibility |
|---|------|---|
| `CanastaGame` | www/game.js | Full game engine (rules, validation, scoring) |
| `CanastaBot` | scripts/bot.js | AI decision-making for bot players |
| `createCanastaDeck()` | www/deck.js | Deck initialization & shuffling |
| `calculateEloChange()` | www/elo.js | ELO rating delta after match |
| `matchmakingService` | www/matchmaking.js | Queue + backfill logic |
| `User` (Mongoose model) | models/user.js | MongoDB user schema (stats, friends, etc.) |

---

## 5) Data Flow

**Typical game action flow (e.g., player melds cards):**

1. **User clicks "Meld" button** in www/index.html
2. **Client handler triggered**: `window.meldSelectedCards()` in www/client.js:457
3. **Client emits Socket.IO**: `state.socket.emit('act_meld', { seat, meldType, cards: [...] })`
4. **Server receives** in server.js:1094: `socket.on('act_meld', (data) => ...)`
5. **Server validates & applies** to `game = games[gameId]`:
   - Calls `game.playCard(...)` to add cards to meld
   - Updates `game.team1Melds` or `game.team2Melds`
   - Records `game.lastActionTime = Date.now()`
6. **Server broadcasts state**: `broadcastAll(gameId)` sends `update_game` to all players
7. **Client receives**: `state.socket.on('update_game', (data) => ...)`
8. **UI re-renders**: `UI.updateUI(data)` updates hand, melds, discard pile

---

## 6) UI Architecture

**Component Organization:**
- **No component framework**—all HTML is in www/index.html as static divs
- Screen components are rendered by functions in www/ui.js that manipulate in-place divs

**Reusable UI Primitives:**
- **Buttons**: `.menu-btn` (primary, secondary, danger, text-only) in www/style.css
- **Cards**: `.card-img` with sprite positioning
- **Modals**: `#ready-modal`, `#score-modal` (visibility toggled via JS)
- **Flexbox layouts**: Favors flexbox for responsive alignment

**Styling Approach:**
- **Pure CSS** (no Tailwind, no CSS-in-JS)
- **CSS custom properties** for colors/fonts (--bg-color, --accent-color, --font-title, etc.)
- **Mobile-first**: Uses `env(safe-area-inset-*)` for notch/island support
- **Animations**: Keyframes for spinning cards, flying animations in www/animations.js

**Layout Patterns:**
- Full-viewport screens (100vh) with overflow:hidden and safe-area padding
- Flexbox for centering & alignment
- Fixed-position overlays for modals/popups
- Responsive gap/margin adjustments for small screens

**Responsive Behavior:**
- Viewport meta: `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no`
- All text sizes, button sizes adjust for mobile
- PWA manifest + service worker for offline

---

## 7) Lobby-Specific Analysis

### **All Lobby-Related Files:**

| File | Lines | What It Does |
|------|-------|--------------|
| www/index.html | 338–441 | Defines `screen-friendly-games`, `screen-create-room`, `screen-join-room`, `screen-lobby` divs with exact HTML structure |
| www/client.js | 1054–1215 | Socket handlers for lobby: `private_created`, `joined_private_success`; functions `doCreateRoom()`, `doJoinPrivate()`, `openFriendlyGamesLobby()` |
| www/ui.js | 957–1115 | `renderLobbySeats(data, mySeat)` (renders 4 seat cards) and `renderFriendlyGamesList(rooms)` (renders waiting/in-progress room lists) |
| server.js | 359–1414 | Socket handlers: `request_create_private` (663–700), `request_join_private` (703–795), `act_switch_seat` (566–589), `act_host_start` (592–610); also `broadcastLobby()`, `getFriendlyGamesList()`, `emitFriendlyGamesList()` |

### **Route & Screen Breakdown:**

**Screen IDs:**
- `screen-friendly-games`: List of active/waiting rooms (refreshable)
- `screen-create-room`: Form to create a new private table
- `screen-join-room`: Manual join by room ID (unused in UI, but exists)
- `screen-lobby`: The actual pre-game lobby where players wait for host to start

**Screen Navigation Flow (Friendly Games):**
```
screen-home (button: "FRIENDLY GAMES")
     ↓
screen-friendly-games (list of rooms + "CREATE NEW" button)
     ├→ [click "CREATE NEW"] → screen-create-room
     │         ↓ [doCreateRoom]
     │    server: request_create_private → games[gameId] created
     │    server: emit private_created → screen-lobby (host view)
     │
     └→ [click "JOIN ROOM"] → server: request_join_private
                        ↓
                    screen-lobby (guest view, different data)
```

### **HTML Structure (Lobby Screen):**

```html
<!-- From www/index.html lines 427–441 -->
<div id="screen-lobby" class="app-screen">
    <h2>LOBBY</h2>
    <div id="lobby-room-id">---</div>                    <!-- Displays table name -->
    
    <div id="lobby-players"></div>                      <!-- RENDERED BY renderLobbySeats() -->
    
    <div id="lobby-host-controls" style="display:none;"><!-- Only visible to host -->
        <button class="menu-btn success" onclick="sendReady()">START MATCH</button>
    </div>
    
    <div id="lobby-wait-msg">Waiting for host...</div>   <!-- Only visible to guests -->
    
    <button class="menu-btn danger" onclick="leaveGame()">LEAVE LOBBY</button>
</div>
```

### **Lobby State Sources:**

**From Server (sent via `lobby_update` event):**
```javascript
{
    names: ["Alice", null, "Bob", null],      // Player names or null for empty seats
    hostSeat: 0,                                // Which seat is the host
    maxPlayers: 4,                              // 2 or 4
    isHost: false                               // Always false (UI checks hostSeat === mySeat)
}
```

**From Client (in `state` object):**
- `state.mySeat` – my seat number (set when I join)
- `state.gameId` – current lobby's gameId

**Players/Rooms Representation:**
- **Room list** (`getFriendlyGamesList()` in server.js) returns:
  ```javascript
  {
      roomId: "friendly_1",
      roomName: "Table 1",
      status: "waiting" | "in-progress",
      playerNames: ["Alice", "Bob"],     // Only non-null names
      seatsUsed: 2,
      maxSeats: 4,
      ruleset: "standard" | "easy",
      creatorName: "Alice",
      createdAt: timestamp
  }
  ```

**Readiness/Invites:**
- No formal "ready" system in lobby (unlike Rated queue, which uses `readySeats` Set)
- Host just clicks "START MATCH" if all seats filled
- No invite system—players search/join via room list or room ID

### **Existing Layout Constraints & Technical Debt:**

1. **Hardcoded seat cards layout**: `renderLobbySeats()` uses inline styles for flexbox grid (45% width, 80px height, 4 slots in 2×2)
2. **No responsive breakpoint for 2-player**: Layout is always 4 seats visually, even in 2P games (2 empty placeholders)
3. **Simple name display**: Just renders text in divs; no avatars, no status indicators (e.g., "ready", "bot")
4. **No visual host indicator**: Only "You are host" logic; no crown/badge in UI
5. **Friendly games list is all-or-nothing**: Every socket gets full broadcast via `io.emit()` (no filtering/pagination)
6. **Room ID display is minimal**: Just shows room name in green bar; no QR code or easy copy-to-clipboard
7. **No seat pre-selection UI**: When joining, first available seat is auto-assigned (no preview of which seat you'll get)
8. **Leave button is global**: Clicking "LEAVE LOBBY" immediately closes connection (no confirmation dialog)

### **Key Dependencies & Data Relationships:**

- **Lobby depends on**: `activeFriendlyPlayers[username]` (server-side tracking of whose in a room)
- **Room creation depends on**: `generateFriendlyTableId()` (incremental room numbering)
- **Host promotion depends on**: `promoteNewHost(gameId)` (if host disconnects, new host elected from room)
- **Lobby broadcast depends on**: `broadcastLobby(gameId)` + `emitFriendlyGamesList()` (both called together)

---

## 8) Dependency Map for Lobby Work

### **MUST READ:**
1. www/index.html (lines 427–441) – Lobby screen HTML skeleton
2. www/client.js (lines 1054–1215) – Lobby socket handlers & UI trigger functions
3. www/ui.js (lines 957–1115) – Render functions (`renderLobbySeats`, `renderFriendlyGamesList`)
4. server.js (lines 650–800) – Server-side lobby logic (`request_create_private`, `request_join_private`, `broadcastLobby`)

### **LIKELY INVOLVED:**
1. www/state.js – May need to add lobby-specific state fields
2. www/style.css (lines 1–150) – Styling for lobby cards/layouts
3. www/animations.js – If you add animated entrance for players joining
4. www/matchmaking.js – Indirectly related (different path: Rated vs Friendly)

### **PROBABLY SAFE TO IGNORE:**
1. scripts/bot.js – AI logic (not relevant to lobby layout)
2. models/user.js – User schema (not touched in lobby flow)
3. routes/auth.js – Authentication (already passed before lobby)
4. android/ – Capacitor config (layout works on Android via wrapper)

---

## 9) Risks & Gotchas

### **Hidden State Dependencies:**
- **`activeFriendlyPlayers` object** (server-side): Tracking who's in which room. If you add UI features (e.g., invite), must sync with this dict.
- **`playerSessions` object** (server-side): Used for reconnect. Lobby changes that affect session management could break reconnect.
- **Host socket ID stored in `game.host`**: If you render host indicator, getting host's real seat requires querying `io.sockets.adapter.rooms.get(gameId)`.

### **Duplicated/Similar Components:**
- **Lobby seats** (`renderLobbySeats`) vs **Friendly games list** (`renderFriendlyGamesList`): Both render room info but serve different purposes. Changes to one may need changes to the other.
- **Two separate "start game" paths**: Rated queue (via matchmaking.js) vs Friendly lobby (via act_host_start). Easy to forget one.

### **Server-Coupled UI Assumptions:**
- **Broadcast timing**: `broadcastLobby()` is called after every join/leave. If you add reactive features (e.g., drag-to-reorder seats), ensure server updates match.
- **Room list auto-refresh**: No auto-refresh socket listener by default; list only updates on manual "REFRESH" button click. If you add real-time room list updates, risk of too-frequent broadcasts.
- **Full room blocking**: Server prevents double-joining same lobby (checks `activeFriendlyPlayers`). UI doesn't warn before click.

### **Fragile CSS/Layout Patterns:**
- **Fixed 4-seat grid**: Hardcoded `width: 45%; height: 80px;` in renderLobbySeats(). Needs media queries for landscape/tablet.
- **Inline styles everywhere**: Not using CSS classes for consistent theming; hard to rebrand.
- **Responsive gaps**: `gap: 10px` in flexbox might be too tight on small phones.

### **Auth/Session Dependencies:**
- **Token required for friendly games**? Yes—`request_join_private` reads socket.handshake.auth.token. No token = can't save session for reconnect.
- **DEV_MODE bypasses some checks**: If you're testing locally, some auth logic is skipped.

### **Mobile/Responsive Pitfalls:**
- **Notch support**: Safe-area-inset padding is set globally, but lobby adds more padding dynamically—could cause double-padding.
- **Portrait vs Landscape**: 2×2 seat grid assumes portrait; landscape will look odd.
- **Touch targets**: Seat cards are 80px tall; on small phones, may be too close to touch accurately.

---

## 10) Recommended Next Step

**Safest approach to start lobby layout work:**

1. **Create a spec/mockup** of the new lobby layout (seat arrangement, info cards, buttons, typography) before coding.

2. **Start by modifying CSS only**:
   - Add new CSS classes (`.lobby-grid`, `.seat-card`, `.lobby-info`, etc.) to www/style.css
   - Keep HTML structure unchanged initially
   - Adjust inline styles in `renderLobbySeats()` to use those classes

3. **Then refactor renderLobbySeats() incrementally**:
   - Build the new DOM structure programmatically (same logic, cleaner HTML output)
   - Test on both 2P and 4P games
   - Verify responsive behavior on phone/tablet

4. **Update friendly games list separately** (if needed):
   - `renderFriendlyGamesList()` is self-contained
   - You can redesign the room cards independently

5. **Test the full flows**:
   - Create new room → join room → lobby shows correct seat assignments
   - Host privileges display correctly
   - Leave/rejoin works without orphaning server state
   - Mobile portrait/landscape

6. **Have a fallback plan**:
   - Keep original `renderLobbySeats()` as a comment backup
   - Test on real Android device before shipping (Capacitor quirks!)

---

## 📦 Lobby Work Starter Pack

### **First 5 files to open:**
1. www/index.html – Lines 427–441 (see the lobby screen structure)
2. www/ui.js – Lines 957–1010 (see renderLobbySeats() function)
3. www/client.js – Lines 1054–1076 (see event handlers that trigger lobby render)
4. server.js – Lines 1515–1535 (see broadcastLobby() that sends data to lobby)
5. www/style.css – Lines 1–150 (see button/layout styling reference)

### **Key architecture facts to remember:**
- ✅ Lobby is a pair of screens: **List (browsing)** + **Lobby (waiting)**
- ✅ Server is authoritative for room state; client just renders what server sends
- ✅ Every player gets the same `lobby_update` event → same UI (except host sees "START" button instead of "Waiting")
- ✅ Room list is broadcast globally to ALL connected sockets every time a room is created/destroyed
- ✅ Friendly games use `game.isPrivate=true, game.isLobby=true` to distinguish from Rated games

### **Likely blast radius of layout-only change:**
- 🎯 **Contained to**: renderLobbySeats() + renderFriendlyGamesList() + associated CSS + www/index.html divs
- 🎯 **No backend changes needed** if you keep the socket event semantics (`lobby_update`, `joined_private_success`, etc.)
- ⚠️ **Possible fallout**: If you add new data fields (e.g., player avatars), must update server to send them in `lobby_update`
- ⚠️ **Possible fallout**: If you change how seats are numbered/mapped, must double-check seat assignment logic
