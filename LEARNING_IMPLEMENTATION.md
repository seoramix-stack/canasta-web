# 🧠 Bot Learning System - Quick Implementation Guide

## ⚡ TL;DR - Exact Code to Add

### 1. Track Decisions in Bot Turn (Per-Turn Hook)

**File:** `scripts/bot.js`  
**Function:** `CanastaBot.executeTurn()`  
**Insert at:** Line 72 (after `this.updateMemory(game)`)

```javascript
async executeTurn(game) {
    this.updateMemory(game);
    
    // ===== ADD THIS BLOCK =====
    // Initialize turn tracking if not exists
    if (!this.turnHistory) this.turnHistory = [];
    
    const turnStart = {
        timestamp: Date.now(),
        seat: this.seat,
        phase: game.turnPhase,
        hand: game.players[this.seat].map(c => c.rank),
        handSize: game.players[this.seat].length,
        opponentHandSizes: game.players.map((p, i) => i !== this.seat ? p.length : null),
        teamScore: (this.seat % 2 === 0) ? game.cumulativeScores.team1 : game.cumulativeScores.team2,
        topDiscard: game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1].rank : null,
        turnHistory: []  // Will store decisions made THIS turn
    };
    
    const currentTurnIndex = this.turnHistory.length;
    // ===== END ADD =====
    
    if (game.turnPhase === "draw") {
        await this.decideDraw(game);
    }
    
    // ... rest of executeTurn() ...
    
    // ===== ADD THIS AT END =====
    if (this.turnHistory[currentTurnIndex]) {
        this.turnHistory[currentTurnIndex].finalScore = 
            (this.seat % 2 === 0) ? game.cumulativeScores.team1 : game.cumulativeScores.team2;
    }
    // ===== END ADD =====
}
```

---

### 2. Capture Draw Decision

**Function:** `CanastaBot.decideDraw()`  
**Insert at:** Before `if (pileWins >= deckWins)...`

```javascript
async decideDraw(game) {
    const canPickUp = game.canPickupDiscardPile(this.seat);
    
    if (!canPickUp) {
        // ===== ADD THIS =====
        if (this.turnHistory) {
            this.turnHistory[this.turnHistory.length - 1].decision_draw = 'deck_only_option';
        }
        // ===== END ADD =====
        
        game.drawFromDeck(this.seat);
        return;
    }

    const SIMS = 15;
    let deckWins = 0;
    let pileWins = 0;
    // ... simulation code ...
    
    // ===== MODIFY THIS =====
    if (pileWins >= deckWins) {
        // ===== ADD THIS =====
        if (this.turnHistory) {
            this.turnHistory[this.turnHistory.length - 1].decision_draw = 'pickup';
            this.turnHistory[this.turnHistory.length - 1].decision_draw_confidence = pileWins / SIMS;
        }
        // ===== END ADD =====
        
        game.pickupDiscardPile(this.seat);
    } else {
        // ===== ADD THIS =====
        if (this.turnHistory) {
            this.turnHistory[this.turnHistory.length - 1].decision_draw = 'deck';
            this.turnHistory[this.turnHistory.length - 1].decision_draw_confidence = deckWins / SIMS;
        }
        // ===== END ADD =====
        
        game.drawFromDeck(this.seat);
    }
}
```

---

### 3. Capture Discard Decision

**Function:** `CanastaBot.pickDiscard()`  
**Modify the return statement:**

```javascript
pickDiscard(game) {
    let hand = game.players[this.seat];
    // ... scoring logic ...
    
    candidates.sort((a, b) => a.score - b.score);
    
    // ===== ADD THIS =====
    const chosenIndex = candidates[0].index;
    const chosenCard = candidates[0].card;
    const chosenScore = candidates[0].score;
    
    // Store decision metadata
    if (this.turnHistory && this.turnHistory.length > 0) {
        this.turnHistory[this.turnHistory.length - 1].decision_discard = {
            cardRank: chosenCard.rank,
            index: chosenIndex,
            score: chosenScore,
            alternatives: candidates.slice(1, 3).map(c => ({ rank: c.card.rank, score: c.score }))
        };
    }
    // ===== END ADD =====
    
    return chosenIndex;
}
```

---

### 4. Trigger Learning at Game End (MAIN HOOK)

**File:** `server.js`  
**Function:** `async function handleRoundEnd(gameId, io)`  
**Insert at:** Line 1340 (right after `const result = game.resolveMatchStatus();`)

```javascript
async function handleRoundEnd(gameId, io) {
    const game = games[gameId];
    if (!game) return;

    // ... cleanup timer code ...

    const result = game.resolveMatchStatus();

    // ===== INSERT ENTIRE BLOCK =====
    // Trigger bot learning
    const botSeats = Object.keys(gameBots[gameId] || {});
    for (const botSeatStr of botSeats) {
        const botSeat = parseInt(botSeatStr);
        const bot = gameBots[gameId][botSeat];
        
        if (bot && typeof bot.learnFromRound === 'function') {
            try {
                const botTeam = botSeat % 2 === 0 ? 'team1' : 'team2';
                const botScore = game.finalScores[botTeam].total;
                const oppTeam = botTeam === 'team1' ? 'team2' : 'team1';
                const oppScore = game.finalScores[oppTeam].total;
                const didWin = botScore > oppScore;
                
                console.log(`[LEARNING] Bot seat ${botSeat}: Bot=${botScore}, Opp=${oppScore}, Win=${didWin}`);
                
                bot.learnFromRound({
                    botScore: botScore,
                    oppScore: oppScore,
                    scoreDiff: botScore - oppScore,
                    didWin: didWin,
                    gameId: gameId,
                    finalScores: game.finalScores,
                    type: bot.type,
                    ruleset: bot.ruleset,
                    difficulty: bot.difficulty
                });
            } catch (err) {
                console.error(`[LEARNING ERROR] Bot ${botSeat}:`, err);
            }
        }
    }
    // ===== END INSERT =====

    // CASE A: MATCH OVER...
    if (result.isMatchOver) {
        // ... existing code ...
    }
}
```

---

### 5. Add Learning Methods to Bot Class

**File:** `scripts/bot.js`  
**Add these new methods to the `CanastaBot` class:**

```javascript
class CanastaBot {
    // ... existing methods ...
    
    // ===== ADD THESE NEW METHODS =====
    
    learnFromRound(roundResult) {
        // Called at end of each round
        const { botScore, oppScore, scoreDiff, didWin, type, ruleset, difficulty } = roundResult;
        
        console.log(`[BOT LEARNING] Round Over - Score Diff: ${scoreDiff}, Won: ${didWin}`);
        
        // If bot lost, adjust DNA
        if (!didWin && scoreDiff < 0) {
            console.log(`[BOT LEARNING] Bot LOST by ${Math.abs(scoreDiff)}. Adjusting DNA...`);
            this.adjustDNAFromLoss(Math.abs(scoreDiff));
        } else if (didWin) {
            console.log(`[BOT LEARNING] Bot WON by ${scoreDiff}. Reinforcing DNA...`);
            this.reinforceDNAFromWin(scoreDiff);
        }
        
        // Log learning event
        this.logLearningEvent({
            type: 'round_end',
            botScore,
            oppScore,
            scoreDiff,
            didWin,
            dnaKeys: Object.keys(this.dna)
        });
        
        // Clear turn history for next round
        this.turnHistory = [];
    }
    
    adjustDNAFromLoss(scoreDiff) {
        // Penalty adjustment (smaller values = more impact)
        const adjustmentFactor = Math.min(0.05, scoreDiff / 500); // 5% max adjustment
        
        // Penalize parameters that contributed to bad discard decisions
        if (this.dna.DISCARD_WILD_PENALTY) {
            this.dna.DISCARD_WILD_PENALTY *= (1 + adjustmentFactor);
        }
        if (this.dna.FEED_ENEMY_MELD) {
            this.dna.FEED_ENEMY_MELD *= (1 + adjustmentFactor);
        }
        
        console.log(`[DNA ADJUSTMENT] Penalties increased: ${this.dna.DISCARD_WILD_PENALTY}`);
    }
    
    reinforceDNAFromWin(scoreDiff) {
        // Positive reinforcement (smaller values = more impact)
        const adjustmentFactor = Math.min(0.02, scoreDiff / 1000); // 2% max increase
        
        // Reinforce aggressive parameters
        if (this.dna.MELD_AGGRESSION) {
            this.dna.MELD_AGGRESSION *= (1 + adjustmentFactor);
        }
        
        console.log(`[DNA REINFORCEMENT] MELD_AGGRESSION increased: ${this.dna.MELD_AGGRESSION}`);
    }
    
    logLearningEvent(event) {
        // Can eventually write to a log file or database
        console.log('[LEARNING LOG]', {
            timestamp: new Date().toISOString(),
            ...event
        });
    }
    
    saveDNA() {
        // Save updated DNA to production-dna.json
        try {
            const dnaPath = path.join(__dirname, 'production-dna.json');
            const dnaKey = `${this.type}-${this.ruleset}`;
            
            let allDNA = {};
            if (fs.existsSync(dnaPath)) {
                allDNA = JSON.parse(fs.readFileSync(dnaPath, 'utf8'));
            }
            
            allDNA[dnaKey] = this.dna;
            fs.writeFileSync(dnaPath, JSON.stringify(allDNA, null, 2));
            
            console.log(`[DNA SAVED] Updated ${dnaKey} in production-dna.json`);
        } catch (err) {
            console.error('[DNA SAVE ERROR]', err);
        }
    }
    
    // ===== END NEW METHODS =====
}
```

---

## 📊 What Gets Captured

### Per-Turn Data
```
{
  timestamp,
  seat,
  phase,
  hand: [rank1, rank2, ...],
  handSize,
  opponentHandSizes: [...],
  teamScore,
  topDiscard,
  
  // Decisions captured
  decision_draw: 'deck' | 'pickup',
  decision_draw_confidence: 0.0-1.0,
  decision_discard: {
    cardRank,
    index,
    score,
    alternatives: [...]
  },
  
  // Result
  finalScore: teamFinalScore
}
```

### End-of-Round Data
```
{
  botScore,
  oppScore,
  scoreDiff,
  didWin,
  type: '2p' | '4p',
  ruleset: 'easy' | 'standard',
  difficulty
}
```

---

## 🔄 Learning Flow

1. **Game Starts** → Bot gets `dna` from `production-dna.json`
2. **Each Turn** → Bot captures decisions & metadata
3. **Round Ends** → `handleRoundEnd()` calls `bot.learnFromRound()`
4. **Learning** → Bot adjusts DNA parameters based on win/loss
5. **Save** → Updated DNA written back to `production-dna.json`
6. **Next Game** → New bot loads updated DNA automatically

---

## ✅ Implementation Checklist

- [ ] Add turn tracking initialization in `executeTurn()`
- [ ] Capture draw decision in `decideDraw()`
- [ ] Capture discard decision in `pickDiscard()`
- [ ] Add learning trigger in `server.js` `handleRoundEnd()`
- [ ] Add `learnFromRound()` method to bot
- [ ] Add `adjustDNAFromLoss()` method to bot
- [ ] Add `reinforceDNAFromWin()` method to bot
- [ ] Add `saveDNA()` method to bot
- [ ] Test: Bot should update `production-dna.json` after losses
- [ ] Verify: New bot instances load updated DNA

---

## 🎯 Success Metrics

After implementation, you should see:
- ✅ Console logs showing "BOT LEARNING" messages
- ✅ Changes to values in `production-dna.json`
- ✅ Bot improving win rate over multiple games
- ✅ Different DNA values for different modes (2p vs 4p, easy vs standard)

---

## 🚀 Next Steps

1. Copy the code above
2. Add to `scripts/bot.js` and `server.js`
3. Run a test game
4. Check console for `[BOT LEARNING]` messages
5. Verify `production-dna.json` has updated values
6. Run multiple games - bot should improve!
