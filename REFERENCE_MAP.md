# 🗺️ Canasta Bot Learning System - Complete Reference Map

## 📍 5 CRITICAL LOCATIONS

### Location 1️⃣: Bot Turn Execution
| Property | Value |
|----------|-------|
| **File** | `scripts/bot.js` |
| **Class** | `CanastaBot` |
| **Method** | `async executeTurn(game)` |
| **Lines** | 69-120 |
| **When Called** | Every bot turn |
| **By Whom** | `server.js → checkBotTurn()` |
| **What to Insert** | Turn tracking: `turnSnapshot` with hand, phase, actions |
| **Code Pattern** | Create object with decision metadata BEFORE turn executes |

---

### Location 2️⃣: Draw Decision
| Property | Value |
|----------|-------|
| **File** | `scripts/bot.js` |
| **Method** | `async decideDraw(game)` |
| **Lines** | 75-95 |
| **Decision** | Take discard pile or draw from deck? |
| **Uses DNA** | `PICKUP_THRESHOLD`, `PICKUP_PATIENCE` |
| **What to Insert** | Capture `decision_draw` and `decision_draw_confidence` |
| **Example** | `{ decision_draw: 'pickup', confidence: 0.8 }` |

---

### Location 3️⃣: Discard Decision
| Property | Value |
|----------|-------|
| **File** | `scripts/bot.js` |
| **Method** | `pickDiscard(game)` |
| **Lines** | 249-310 |
| **Decision** | Which card to discard? |
| **Uses DNA** | `DISCARD_WILD_PENALTY`, `FEED_ENEMY_MELD`, `BAIT_AGGRESSION` |
| **What to Insert** | Capture `decision_discard` with chosen card and alternatives |
| **Example** | `{ cardRank: 'K', score: -450, alternatives: [{ cardRank: '5', score: -200 }] }` |

---

### Location 4️⃣: Round End / Learning Trigger
| Property | Value |
|----------|-------|
| **File** | `server.js` |
| **Function** | `async function handleRoundEnd(gameId, io)` |
| **Lines** | 1289-1400+ |
| **Exact Insert** | **Line 1340** (after `const result = game.resolveMatchStatus()`) |
| **When Called** | When a round ends (deck empty or player goes out) |
| **What to Insert** | Call `bot.learnFromRound(roundData)` with scores diff |
| **Data Available** | `game.finalScores.team1.total` vs `game.finalScores.team2.total` |

---

### Location 5️⃣: DNA Storage (The Learnable Parameters)
| Property | Value |
|----------|-------|
| **File** | `scripts/production-dna.json` |
| **Structure** | JSON with 4 modes: 2p-easy, 2p-standard, 4p-easy, 4p-standard |
| **Each Mode Has** | 10-15 numerical parameters |
| **Loaded By** | `CanastaBot.constructor()` at Line 25-45 |
| **Updated By** | `bot.saveDNA()` (new method to create) |
| **Persistence** | File is read on bot startup, written after learning |

---

## 🔍 Deep Dive: Game State Structure

### What the Bot Sees in `executeTurn(game)`

```
game {
  ├─ config: {
  │   ├─ PLAYER_COUNT: 4
  │   ├─ MIN_CANASTAS_OUT: 2
  │   ├─ HAND_SIZE: 11
  │   └─ DRAW_COUNT: 2
  │
  ├─ players: [
  │   [card, card, ...],  # Seat 0's hand
  │   [card, card, ...],  # Seat 1's hand
  │   [card, card, ...],  # Seat 2's hand
  │   [card, card, ...]   # Seat 3's hand
  │ ]
  │
  ├─ team1Melds: {
  │   "7": [card, card, card, ...],
  │   "K": [card, card, ...],
  │   ...
  │ }
  │
  ├─ team2Melds: {
  │   "5": [card, card, ...],
  │   "Q": [card, card, card, ...],
  │   ...
  │ }
  │
  ├─ team1Red3s: [card, card, ...]
  ├─ team2Red3s: [card, card, ...]
  │
  ├─ deck: [card, card, ...]  # Remaining cards to draw
  ├─ discardPile: [card, card, ...]  # Cards that have been thrown
  │
  ├─ currentPlayer: 0  # 0-3, whose turn it is
  ├─ turnPhase: 'draw' | 'playing' | 'game_over'
  │
  ├─ cumulativeScores: {
  │   team1: 1500,  # Points from previous rounds
  │   team2: 2100
  │ }
  │
  └─ finalScores: {
      team1: {
        basePoints: 245,
        canastaBonus: 500,
        red3Points: 100,
        deductions: -45,
        goOutBonus: 100,
        total: 900
      },
      team2: {
        basePoints: 180,
        canastaBonus: 300,
        red3Points: -100,
        deductions: -80,
        goOutBonus: 0,
        total: 300
      }
    }
}
```

---

## 🧬 DNA Parameters (What Gets Learned)

### Example: 4p-standard Mode
```json
{
  "4p-standard": {
    "DISCARD_WILD_PENALTY": 1732,       ← Penalty for throwing away wild cards
    "FEED_ENEMY_MELD": 3012,            ← Penalty for helping opponent's melds
    "DISCARD_SINGLE_BONUS": -150,       ← Bonus for throwing unmatched cards
    "MELD_AGGRESSION": 0.7,             ← Multiplier for meld enthusiasm (0.0-1.0+)
    "PICKUP_THRESHOLD": 2,              ← Min natural matches needed to pickup pile
    "PICKUP_PATIENCE": 7,               ← How many turns before feeling safe to pickup
    "BREAK_PAIR_PENALTY": 200,          ← Penalty for throwing cards that match hand
    "BAIT_AGGRESSION": 150,             ← How much to punish discarding bait cards
    "BLACK_3_BONUS": -2000,             ← Penalty for holding/throwing Black 3s
    "GO_OUT_THRESHOLD": 500             ← Score difference needed to go out risk
  }
}
```

**Learning adjusts these by ±5% after losses, ±2% after wins**

---

## 📋 Complete Execution Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. GAME START                                                  │
│    └─> Bot A loads DNA from production-dna.json                │
│    └─> Bot B loads DNA from production-dna.json               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. BOT A TURN (executeTurn)                                    │
│    ├─> Call decideDraw()                                       │
│    │   └─> Capture: { decision_draw: 'deck', confidence: 0.6 }│
│    │                                                            │
│    ├─> Call simulateMeldDecision()                            │
│    │   └─> Capture: { melded: [indices], cards: [...] }      │
│    │                                                            │
│    ├─> Call pickDiscard()                                      │
│    │   └─> Capture: { discarded: 'K', score: -450 }          │
│    │                                                            │
│    └─> Store ALL in: this.turnHistory[index]                  │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. OTHER PLAYERS' TURNS                                         │
│    └─> Same tracking for each bot turn                         │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. ROUND ENDS                                                   │
│    game.turnPhase = 'game_over'                                │
│    game.finalScores = calculateScores()                        │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 5. SERVER: handleRoundEnd() at LINE 1340                       │
│    ├─> Get bot from gameBots[gameId][botSeat]                │
│    ├─> Calculate: botScore vs oppScore                       │
│    ├─> Call bot.learnFromRound({                             │
│    │         botScore, oppScore, scoreDiff, didWin, ...     │
│    │       })                                                │
│    └─> Bot adjusts DNA based on results                      │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 6. BOT LEARNING in learnFromRound()                           │
│    ├─> if (!didWin) {                                         │
│    │     adjustDNAFromLoss(scoreDiff)                       │
│    │     // e.g., DISCARD_WILD_PENALTY *= 1.03            │
│    │   }                                                      │
│    │                                                          │
│    ├─> if (didWin) {                                         │
│    │     reinforceDNAFromWin(scoreDiff)                    │
│    │     // e.g., MELD_AGGRESSION *= 1.01                 │
│    │   }                                                      │
│    │                                                          │
│    └─> saveDNA()                                             │
│         // Write updated DNA to production-dna.json         │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 7. PERSISTENCE                                                  │
│    └─> Next bot instance loads UPDATED DNA from file         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🎯 Key Functions Summary

| Function | File | Lines | Purpose | Calls |
|----------|------|-------|---------|-------|
| `executeTurn()` | bot.js | 69-120 | Main bot turn entry | decideDraw, simulateMeldDecision, pickDiscard |
| `decideDraw()` | bot.js | 75-95 | Choose draw source | game.drawFromDeck / game.pickupDiscardPile |
| `pickDiscard()` | bot.js | 249-310 | Choose card to throw | Uses DNA params |
| `checkBotTurn()` | server.js | 1257-1283 | Server-side turn scheduler | Calls bot.executeTurn() |
| `handleRoundEnd()` | server.js | 1289-1400+ | Round completion handler | **INSERT bot.learnFromRound() here** |
| `calculateScores()` | game.js | 424-480 | Compute final round scores | Called when turnPhase = game_over |
| `learnFromRound()` | bot.js | **NEW** | Learning method | adjustDNAFromLoss / reinforceDNAFromWin |
| `saveDNA()` | bot.js | **NEW** | Persist DNA updates | fs.writeFileSync() |

---

## 🔴 Critical Code Snippets You Must Know

### Where Game Ends in game.js
```javascript
// 4 places set turnPhase = "game_over":
drawFromDeck()      // Lines 157-180: Deck empty
pickupDiscardPile() // Lines 250-280: Hand empty after pickup
meldCards()         // Lines 352-355: Hand empty after meld
discardFromHand()   // Lines 397-403: Hand empty after discard (went out)

// All call:
this.finalScores = this.calculateScores(playerIndex);
```

### Where Bot is Triggered in server.js
```javascript
// Line 1257: checkBotTurn(gameId)
// Checks if current player is a bot
// If yes: await bot.executeTurn(game)
// Then: broadcastAll(gameId)
// Then: checkBotTurn recursively if next player is bot
```

### Where Learning Should Trigger in server.js
```javascript
// Line 1340: After resolveMatchStatus()
// THIS IS WHERE TO INSERT LEARNING CALL
// Have access to:
// - game.finalScores (round scores)
// - game.cumulativeScores (match totals)
// - gameBots[gameId][seat] (all bots)
// - result.isMatchOver (match status)
```

---

## ✅ Verification Checklist

After implementation, verify these work:

- [ ] Console shows `[BOT LEARNING] Round Over...` logs
- [ ] `production-dna.json` DISCARD_WILD_PENALTY changes after bot loses
- [ ] Bot that loses a round gets DNA, bot that wins gets reinforced DNA
- [ ] Different modes (2p vs 4p, easy vs standard) have separate DNA
- [ ] Turn history is captured for each turn
- [ ] roundResult passed to learnFromRound has botScore, oppScore, didWin

---

## 🚀 Start Here

1. **Read** this document completely
2. **Open** `scripts/bot.js` and `server.js` in VS Code
3. **Add** turn tracking to `executeTurn()` (Location 1)
4. **Add** decision capture to `decideDraw()` and `pickDiscard()` (Locations 2-3)
5. **Add** learning trigger to `handleRoundEnd()` (Location 4)
6. **Implement** `learnFromRound()` and `saveDNA()` methods (New Methods)
7. **Test** with a single bot game vs another bot
8. **Monitor** console for `[BOT LEARNING]` messages
9. **Check** `production-dna.json` for changed values
10. **Celebrate** - your bot is learning! 🎉

---

## 📞 Quick Reference: Lines to Edit

| Action | File | Line(s) | What |
|--------|------|---------|------|
| Add turn tracking | bot.js | 72 | Initialize turnSnapshot |
| Capture draw | bot.js | 85-95 | Add decision_draw metadata |
| Capture discard | bot.js | 290-310 | Add decision_discard metadata |
| Trigger learning | server.js | 1340 | Add bot.learnFromRound() call |
| Add learn method | bot.js | After line 467 | Add learnFromRound() function |
| Add save method | bot.js | After learnFromRound | Add saveDNA() function |

---

## 🎓 Understanding the Learning Loop

**Loss Case (Bot loses):**
```
Bot loses by 500 points
  ↓
adjustDNAFromLoss(500)  ← Called in learnFromRound()
  ↓
DISCARD_WILD_PENALTY *= 1.03  (increase penalty)
FEED_ENEMY_MELD *= 1.03       (increase penalty)
  ↓
saveDNA() writes to production-dna.json
  ↓
Next game: New CanastaBot loads file
  ↓
Bot MORE CAREFUL about discarding wilds & helping enemies
  ↓
Bot should play better next time
```

**Win Case (Bot wins):**
```
Bot wins by 800 points
  ↓
reinforceDNAFromWin(800)  ← Called in learnFromRound()
  ↓
MELD_AGGRESSION *= 1.01   (increase slight boost)
  ↓
saveDNA() writes to production-dna.json
  ↓
Next game: Same behavior reinforced
```

---

That's your complete map! 🗺️ Now go implement it! 🚀
