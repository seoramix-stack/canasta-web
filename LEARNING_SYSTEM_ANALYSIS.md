# Canasta Bot Learning System - Codebase Analysis

## 📋 EXECUTIVE SUMMARY

This document identifies ALL critical points in the Canasta game codebase where a bot learning system can be integrated. The bot already has decision-making logic and DNA parameters; we just need to add tracking and adaptation hooks.

---

# 1️⃣ GAME LOOP / TURN EXECUTION

## 1.1 Main Turn Executor

**File:** [scripts/bot.js](scripts/bot.js)  
**Function:** `CanastaBot.executeTurn(game)`  
**Lines:** 69-120  
**Purpose:** This is where the bot executes ONE complete turn (draw → meld → discard)

```javascript
async executeTurn(game) {
    this.updateMemory(game);

    if (game.turnPhase === "draw") {
        await this.decideDraw(game); 
        // Phase usually changes to 'playing' automatically after draw
    } 
    
    if (game.turnPhase === "playing") {
        const shouldMeld = this.simulateMeldDecision(game);
        // ... meld logic
        // ... discard logic
    }
}
```

**Why important:** Every bot turn starts and ends here. This is where we can log decisions.

---

## 1.2 Individual Action Executors

### Draw Decision
**Function:** `CanastaBot.decideDraw(game)`  
**Lines:** 75-90  
**What happens:** Bot decides to pickup discard pile or draw from deck

```javascript
async decideDraw(game) {
    const canPickUp = game.canPickupDiscardPile(this.seat);
    
    if (!canPickUp) {
        game.drawFromDeck(this.seat);
        return;
    }
    
    // Simulation-driven decision...
    if (pileWins >= deckWins) {
        game.pickupDiscardPile(this.seat);
    } else {
        game.drawFromDeck(this.seat);
    }
}
```

---

### Meld Decision
**Function:** `CanastaBot.simulateMeldDecision(game)` (in bot.js)  
**What happens:** Bot decides which cards to meld

---

### Discard Decision
**Function:** `CanastaBot.pickDiscard(game)` (in bot.js)  
**What happens:** Bot selects which card to discard based on DNA parameters

```javascript
pickDiscard(game) {
    let hand = game.players[this.seat];
    
    // Score each card based on DNA penalties/bonuses
    const candidates = hand.map((card, index) => {
        let score = 0;
        // Uses DNA params:
        score -= this.dna.DISCARD_WILD_PENALTY;
        score -= this.dna.FEED_ENEMY_MELD;
        // ... more DNA-weighted decisions
        return { index, score, card };
    });
    
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0].index;
}
```

**Why important:** Every decision references `this.dna` - these are the learnable parameters.

---

## 1.3 Server-Side Turn Trigger

**File:** [server.js](server.js)  
**Function:** `async function checkBotTurn(gameId)`  
**Lines:** 1257-1283

```javascript
async function checkBotTurn(gameId) {
    const game = games[gameId];
    if (!game || game.turnPhase === 'game_over') return;

    const bot = gameBots[gameId]?.[game.currentPlayer];
    if (bot) {
        console.log(`[BOT] Starting turn for Seat ${game.currentPlayer}`);
        
        // 1. AWAIT the bot's turn
        await bot.executeTurn(game);

        // 2. Broadcast results
        broadcastAll(gameId);

        // 3. Recursive call for next bot
        if (gameBots[gameId]?.[game.currentPlayer] && game.turnPhase !== 'game_over') {
            const delay = game.botDelayBase || 1500;
            setTimeout(() => checkBotTurn(gameId), delay);
        }
    }
}
```

**Why important:** After each `bot.executeTurn()`, we can capture the game state and decisions.

---

# 2️⃣ BOT DECISION ENTRY POINT

## 2.1 Bot Initialization & DNA Loading

**File:** [scripts/bot.js](scripts/bot.js)  
**Function:** `CanastaBot.constructor()`  
**Lines:** 5-50

```javascript
class CanastaBot {
    constructor(seat, difficulty, type = '4p', ruleset = 'standard', injectedDna = null) {
        this.seat = seat;
        this.difficulty = difficulty;
        this.type = type;           // '2p' or '4p'
        this.ruleset = ruleset;     // 'standard' or 'easy'
        
        // --- DNA LOADING ---
        let masterDna = null;
        try {
            const dnaPath = path.join(__dirname, 'production-dna.json');
            if (fs.existsSync(dnaPath)) {
                masterDna = JSON.parse(fs.readFileSync(dnaPath, 'utf8'));
            }
        } catch (e) {
            console.log("No production-dna.json found, using hardcoded defaults.");
        }

        // --- 3. SELECTION LOGIC ---
        if (injectedDna) {
            this.dna = { ...defaultDna, ...injectedDna };
        } else {
            const dnaKey = `${this.type}-${this.ruleset}`;
            if (masterDna && masterDna[dnaKey]) {
                this.dna = { ...defaultDna, ...masterDna[dnaKey] };
            } else {
                this.dna = defaultDna;
            }
        }
        console.log(`✅ Bot Initialized: Mode [${this.type}-${this.ruleset}] using DNA:`, this.dna);
    }
}
```

**Key insight:** The bot loads DNA from `production-dna.json` at startup. This is what we'll update after learning.

---

## 2.2 DNA Parameters (The Learnable Values)

**File:** [scripts/production-dna.json](scripts/production-dna.json)  
**Structure:** Keys by mode (e.g., "4p-standard", "2p-easy")

```json
{
  "4p-standard": {
    "DISCARD_WILD_PENALTY": 1732,
    "FEED_ENEMY_MELD": 3012,
    "DISCARD_SINGLE_BONUS": -150,
    "MELD_AGGRESSION": 0.7,
    "PICKUP_THRESHOLD": 2,
    "PICKUP_PATIENCE": 7,
    "BREAK_PAIR_PENALTY": 200,
    "BAIT_AGGRESSION": 150,
    "BLACK_3_BONUS": -2000,
    "GO_OUT_THRESHOLD": 500
  },
  "4p-easy": { ... },
  "2p-standard": { ... },
  "2p-easy": { ... }
}
```

**Why important:** These are the parameters the learning system will adjust.

---

## 2.3 Where DNA is Actually Used

**Function:** `CanastaBot.pickDiscard(game)` ← Uses multiple DNA params  
**Function:** `CanastaBot.decideDraw(game)` ← Uses simulation  
**Function:** `CanastaBot.tryMelding(game)` ← Uses MELD_AGGRESSION

**Every decision is weighted by DNA values** - so learning = adjusting these weights.

---

# 3️⃣ GAME END LOGIC

## 3.1 Game Over Conditions

**File:** [www/game.js](www/game.js)  
Game ends in 4 places:

### A. Deck Empty
**Function:** `CanastaGame.drawFromDeck()`  
**Lines:** 157-180

```javascript
drawFromDeck(playerIndex) {
    if (this.deck.length === 0) {
        this.turnPhase = "game_over";
        this.finalScores = this.calculateScores(); 
        return { success: true, message: "GAME_OVER_DECK_EMPTY" }; 
    }
    // ... draw logic
}
```

### B. Player Goes Out (Discard)
**Function:** `CanastaGame.discardFromHand()`  
**Lines:** 374-403

```javascript
discardFromHand(playerIndex, cardIndex) {
    // ... validation ...
    if (hand.length === 1) {
        // Last card - player goes out
        hand.splice(cardIndex, 1);
        this.discardPile.push(card);
        
        this.turnPhase = "game_over"; 
        this.finalScores = this.calculateScores(playerIndex); 
        return { success: true, message: "GAME_OVER" };
    }
    // ... normal discard
}
```

### C. Player Goes Out (Via Pickup)
**Function:** `CanastaGame.pickupDiscardPile()`  
**Lines:** 250-280

```javascript
pickupDiscardPile(playerIndex) {
    // ... pickup logic ...
    if (this.players[playerIndex].length === 0) {
        this.turnPhase = "game_over";
        this.finalScores = this.calculateScores(playerIndex);
        return { success: true, message: "GAME_OVER", method: method };
    }
    // ... normal pickup
}
```

### D. Player Goes Out (Via Meld)
**Function:** `CanastaGame.meldCards()`  
**Lines:** 352-355

```javascript
meldCards(playerIndex, cardIndices, targetRank) {
    // ... meld logic ...
    if (this.players[playerIndex].length === 0) {
        this.turnPhase = "game_over";
        this.finalScores = this.calculateScores(playerIndex); 
        return { success: true, message: "GAME_OVER" };
    }
}
```

---

## 3.2 Match Status Resolution

**File:** [www/game.js](www/game.js)  
**Function:** `CanastaGame.resolveMatchStatus()`  
**Lines:** 91-110

```javascript
resolveMatchStatus() {
    if (this.finalScores && !this.scoresCommitted) {
        this.cumulativeScores.team1 += this.finalScores.team1.total;
        this.cumulativeScores.team2 += this.finalScores.team2.total;
        this.scoresCommitted = true;
    }

    const WIN = this.config.WIN_SCORE; // 5000
    let s1 = this.cumulativeScores.team1;
    let s2 = this.cumulativeScores.team2;

    if (s1 >= WIN || s2 >= WIN) {
        if (s1 > s2) return { isMatchOver: true, winner: 'team1' };
        if (s2 > s1) return { isMatchOver: true, winner: 'team2' };
        return { isMatchOver: true, winner: 'draw' };
    }

    return { isMatchOver: false };
}
```

---

## 3.3 Server-Side Round/Match End Handler

**File:** [server.js](server.js)  
**Function:** `async function handleRoundEnd(gameId, io)`  
**Lines:** 1289-1400+

```javascript
async function handleRoundEnd(gameId, io) {
    const game = games[gameId];
    if (!game) return;

    // ... cleanup timer ...

    const result = game.resolveMatchStatus();

    // CASE A: MATCH OVER (5000+ points)
    if (result.isMatchOver) {
        console.log(`[MATCH END] Game ${gameId} won by ${result.winner}`);
        game.matchIsOver = true;
        
        // --- STATS/RATING UPDATE HAPPENS HERE ---
        // This is where we would ALSO trigger learning
        
        let ratingUpdates = {};
        // ... ELO calculation ...
        
        io.to(gameId).emit('match_over', {
            winner: result.winner,
            scores: game.cumulativeScores,
            lastRoundScores: game.finalScores,
            reason: "score_limit",
            names: game.names,
            ratings: ratingUpdates
        });
    }
    // CASE B: ROUND OVER (but match continues)
    else {
        // ... emit round_over ...
    }
}
```

**Line 1335:** The match winner is determined here  
**Line 1338:** Cumulative scores are finalized  
**✅ THIS IS WHERE WE INSERT LEARNING LOGIC** (see section 7)

---

# 4️⃣ SCORING SYSTEM

## 4.1 Score Calculation

**File:** [www/game.js](www/game.js)  
**Function:** `CanastaGame.calculateScores(winnerSeat = -1, isConcealed = false)`  
**Lines:** 424-480

```javascript
calculateScores(winnerSeat = -1, isConcealed = false) {
    const calcTeam = (melds, red3s, pIndices) => {
        let details = { 
            basePoints: 0, 
            canastaBonus: 0, 
            red3Points: 0, 
            deductions: 0, 
            goOutBonus: 0, 
            total: 0 
        };
        
        let hasMelded = Object.keys(melds).length > 0;

        // 1. BASE POINTS from melds
        for (let rank in melds) {
            let pile = melds[rank];
            details.basePoints += pile.reduce((sum, c) => sum + this.getCardValue(c.rank), 0);
            
            // 2. CANASTA BONUS (500 natural, 300 dirty)
            if (pile.length >= 7) {
                let isNatural = pile.every(c => !c.isWild);
                details.canastaBonus += (isNatural ? 500 : 300);
            }
        }

        // 3. RED 3 BONUS (100 each, 800 for all 4)
        let r3Val = (red3s.length === 4) ? 800 : (red3s.length * 100);
        details.red3Points = hasMelded ? r3Val : -r3Val;

        // 4. HAND DEDUCTIONS (penalty for cards left in hand)
        pIndices.forEach(idx => {
            if (this.players[idx]) {
                let handPoints = this.players[idx].reduce((sum, c) => sum + this.getCardValue(c.rank), 0);
                details.deductions -= handPoints; 
                
                // 5. GO-OUT BONUS
                if (Number(idx) === Number(winnerSeat)) {
                    details.goOutBonus = 100; 
                    if (isConcealed) details.goOutBonus += 100; 
                }
            }
        });

        details.total = details.basePoints + details.canastaBonus + details.red3Points + details.deductions + details.goOutBonus;
        return details;
    };

    // Return both teams
    return {
        team1: calcTeam(this.team1Melds, this.team1Red3s, team1Indices),
        team2: calcTeam(this.team2Melds, this.team2Red3s, team2Indices)
    };
}
```

**What we get:** `finalScores.team1.total` and `finalScores.team2.total`

---

# 5️⃣ STATE OBJECT STRUCTURE

## 5.1 Game State (What Bot Sees)

**File:** [www/game.js](www/game.js)  
**Constructor:** Line 38-65

```javascript
constructor(customConfig = {}) {
    this.config = {
        WIN_SCORE: 5000,
        MIN_CANASTAS_OUT: 2,
        DRAW_COUNT: 2,
        HAND_SIZE: 11,
        PLAYER_COUNT: 4,
    };

    // --- GAME STATE ---
    this.deck = [];                              // Remaining cards in deck
    this.discardPile = [];                       // Cards in discard pile
    this.players = Array(...);                   // [hand0, hand1, hand2, hand3]
    this.team1Melds = {};                        // { "7": [...cards], "K": [...cards] }
    this.team2Melds = {};                        // Same structure
    this.team1Red3s = [];                        // Red 3s on table
    this.team2Red3s = [];                        // Red 3s on table
    
    this.roundStarter = 0;                       // Which player starts
    this.currentPlayer = 0;                      // Whose turn it is (0-3)
    this.turnPhase = "draw";                     // "draw" | "playing" | "game_over"
    
    this.finalScores = null;                     // Set when round ends
    this.cumulativeScores = { team1: 0, team2: 0 };
    this.lastActionTime = Date.now();
}
```

**What bot receives in `executeTurn(game)`:**
- `game.players[this.seat]` → Bot's hand
- `game.discardPile` → Opponent's discard
- `game.team1Melds / game.team2Melds` → All melds on table
- `game.currentPlayer` → Whose turn
- `game.turnPhase` → Current phase
- `game.cumulativeScores` → Team scores so far
- `game.config` → Game rules

---

## 5.2 Bot Memory Structure

**File:** [scripts/bot.js](scripts/bot.js)  
**Constructor:** Line 17-25

```javascript
this.memory = {
    initialized: false,
    lastDiscardPile: [],           // Previous state for tracking discards
    knownHands: {},                // What we know about each opponent's hand
    playersLastHandSize: {}        // Size of each opponent's hand last turn
};
```

---

# 6️⃣ TURN-BY-TURN TRACKING INSERTION POINT

## 6.1 Where to Insert Per-Turn Logging

**File:** [scripts/bot.js](scripts/bot.js)  
**Function:** `CanastaBot.executeTurn(game)`  
**EXACT INSERT POINT:** Right after `this.updateMemory(game)` (line 72)

**Current Code:**
```javascript
async executeTurn(game) {
    this.updateMemory(game);
    
    // ← INSERT TURN TRACKING HERE ←
    
    if (game.turnPhase === "draw") {
        await this.decideDraw(game); 
        // Phase usually changes to 'playing' automatically after draw
    } 
    
    if (game.turnPhase === "playing") {
        const shouldMeld = this.simulateMeldDecision(game);
        // ... meld & discard logic
    }
}
```

**What to capture:**
```javascript
// NEW CODE TO INSERT
const turnSnapshot = {
    timestamp: Date.now(),
    seat: this.seat,
    gameId: game.gameId || 'unknown',
    phase: game.turnPhase,
    hand: game.players[this.seat].map(c => c.rank),
    handSize: game.players[this.seat].length,
    meldedCards: this.lastMeldIndices,          // Store what was melded
    discardedCard: this.lastDiscardIndex,       // Store what was discarded
    drawSource: this.lastDrawSource,            // "deck" or "pile"
    score: game.cumulativeScores,
    // ... more metadata as needed
};

// Store for end-of-game learning
if (!this.turnHistory) this.turnHistory = [];
this.turnHistory.push(turnSnapshot);
```

**Why here:** This captures BEFORE decisions are made, so we can compare decisions vs. outcomes.

---

## 6.2 Additional Decision Capture Points

### In `decideDraw()`:
```javascript
decideDraw(game) {
    const canPickUp = game.canPickupDiscardPile(this.seat);
    
    // ← CAPTURE DECISION
    this.lastDrawSource = !canPickUp ? 'deck' : 
        (pileWins >= deckWins ? 'pile' : 'deck');
    
    // Then execute...
}
```

### In `pickDiscard()`:
```javascript
pickDiscard(game) {
    const candidates = hand.map((card, index) => {
        // ... scoring logic using DNA ...
    });
    candidates.sort((a, b) => a.score - b.score);
    
    // ← CAPTURE DISCARD
    this.lastDiscardIndex = candidates[0].index;
    
    return candidates[0].index;
}
```

---

# 7️⃣ END-OF-GAME LEARNING INSERTION POINT

## 7.1 PRIMARY INSERTION POINT

**File:** [server.js](server.js)  
**Function:** `async function handleRoundEnd(gameId, io)`  
**Lines:** 1335-1345 (Right after `const result = game.resolveMatchStatus()`)  
**EXACT INSERT LOCATION:** Line 1340

**Current Code:**
```javascript
async function handleRoundEnd(gameId, io) {
    const game = games[gameId];
    if (!game) return;

    // ... cleanup timer ...

    const result = game.resolveMatchStatus();

    // ← INSERT LEARNING LOGIC HERE ←

    if (result.isMatchOver) {
        // Match is over
        // ...
    } else {
        // Round over, match continues
        // ...
    }
}
```

---

## 7.2 What to Insert at Line 1340

```javascript
// ============ NEW LEARNING CODE ============
const botSeat = Object.keys(gameBots[gameId] || {})[0];
if (botSeat !== undefined && gameBots[gameId][botSeat]) {
    const bot = gameBots[gameId][botSeat];
    const oppSeat = (parseInt(botSeat) + 1) % game.config.PLAYER_COUNT;
    
    // Get final scores
    const botTeam = parseInt(botSeat) % 2 === 0 ? 'team1' : 'team2';
    const botScore = game.finalScores[botTeam].total;
    const oppScore = game.finalScores[botTeam === 'team1' ? 'team2' : 'team1'].total;
    
    // Did bot win this round?
    const didWin = botScore > oppScore;
    
    // Trigger learning
    if (typeof bot.learnFromRound === 'function') {
        bot.learnFromRound({
            turnHistory: bot.turnHistory,
            botScore: botScore,
            oppScore: oppScore,
            didWin: didWin,
            difficulty: bot.difficulty,
            type: bot.type,
            ruleset: bot.ruleset
        });
    }
}
// ============= END LEARNING CODE ===========
```

---

## 7.3 SECONDARY INSERTION POINT (Match End)

If you want to save DNA updates globally, insert at **Line 1380** (after match complete):

```javascript
// ← After match_over is emitted, save DNA
if (botSeat !== undefined && gameBots[gameId][botSeat]) {
    const bot = gameBots[gameId][botSeat];
    
    if (typeof bot.saveDNA === 'function') {
        bot.saveDNA(); // Write updated DNA to production-dna.json
    }
}
```

---

# 8️⃣ FINAL SUMMARY: EXACT INSERTION POINTS

## WHERE TO ADD PER-TURN TRACKING:

| Location | File | Function | Line | What To Do |
|----------|------|----------|------|-----------|
| **Turn Start** | `scripts/bot.js` | `executeTurn()` | After 72 | Create `turnSnapshot` with hand, phase, actions |
| **Draw Decision** | `scripts/bot.js` | `decideDraw()` | After decision | Capture `this.lastDrawSource` |
| **Discard Choice** | `scripts/bot.js` | `pickDiscard()` | Before return | Capture `this.lastDiscardIndex` |
| **Meld Decision** | `scripts/bot.js` | `simulateMeldDecision()` | After melds chosen | Capture `this.lastMeldIndices` |

---

## WHERE TO ADD END-OF-GAME LEARNING:

| Location | File | Function | Line | What To Do |
|----------|------|----------|------|-----------|
| **Round End** | `server.js` | `handleRoundEnd()` | **Line 1340** (after `resolveMatchStatus()`) | Call `bot.learnFromRound()` with scores & history |
| **Match End** | `server.js` | `handleRoundEnd()` | **Line 1380** (after `match_over` emit) | Call `bot.saveDNA()` to persist changes |

---

# 9️⃣ WHAT THE LEARNING SYSTEM WILL DO

1. **Track Decisions:** Capture bot's draws, melds, discards on each turn
2. **Record Outcomes:** Store final round/match scores
3. **Compare vs. Baseline:** Was the actual decision better or worse than alternatives?
4. **Adjust DNA:** If bot lost, penalize those DNA parameters in future games
5. **Save Updates:** Write new DNA values back to `production-dna.json`

---

# 🔟 KEY FILES REFERENCE

| File | Purpose | Key Functions |
|------|---------|---|
| `scripts/bot.js` | Bot decision logic | `executeTurn()`, `decideDraw()`, `pickDiscard()`, `simulateMeldDecision()` |
| `scripts/production-dna.json` | Learnable parameters | 4 modes: 2p-easy, 2p-standard, 4p-easy, 4p-standard |
| `www/game.js` | Game state & rules | `calculateScores()`, `drawFromDeck()`, `discardFromHand()`, `meldCards()` |
| `server.js` | Turn/match orchestration | `checkBotTurn()`, `handleRoundEnd()` |

---

# CREATE YOUR LEARNING SYSTEM WITH:

1. **In `scripts/bot.js`:** Add `learnFromRound()` and `saveDNA()` methods
2. **In `server.js` line 1340:** Call the learning function after each round
3. **In storage:** Create a persistent log of games to analyze over time

**You have identified exactly where to hook in the learning system!** 🚀
