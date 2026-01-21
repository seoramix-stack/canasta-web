// bot.js - Fixed Opening Logic & Red 3 Compatibility

class CanastaBot {
    constructor(seat, difficulty, type = '4p', ruleset = 'standard', injectedDna = null) {
        this.seat = seat;
        this.difficulty = difficulty;
        this.type = type;       // '2p' or '4p'
        this.ruleset = ruleset; // 'standard' or 'easy'

        // --- MEMORY SYSTEM ---
        this.memory = {
            initialized: false,
            lastDiscardPile: [],      
            knownHands: {},           
            playersLastHandSize: {}   
        };

        // --- STRATEGY DEFINITIONS (DNA) ---
        const DNA_DEFAULTS = {
            DISCARD_WILD_PENALTY: 1732,
            FEED_ENEMY_MELD: 2071,
            DISCARD_SINGLE_BONUS: -93,
            MELD_AGGRESSION: 0.91,
            PICKUP_THRESHOLD: 2,
            MELD_IF_WINNING_BONUS: 0.05,
            MELD_IF_LOSING_BONUS: -0.19,
            BREAK_PAIR_PENALTY: 200,
            DISCARD_JUNK_BONUS: 10,
            GO_OUT_THRESHOLD: 100 // Points in hand allowed when partner asks to go out
        };
        this.dna = injectedDna || DNA_DEFAULTS;
    }

    // --- INTERFACE FOR SERVER.JS ---
    async executeTurn(game, callback) {
        this.playTurnSync(game);
        if (callback) callback(this.seat);
        return true;
    }

    // --- MAIN TURN LOGIC ---
    playTurnSync(game) { 
        this.updateMemory(game);
        
        // 1. PHASE 1: DRAW
        // Check if we need to panic (game ending soon)
        let realDeckSize = this.getRealDeckSize(game);
        let isLastTurn = realDeckSize < 7;

        this.decideDraw(game, isLastTurn);

        // 2. PHASE 2: GO OUT PERMISSION
        if (game.config.PLAYER_COUNT === 4) {
            this.handleGoOutPermission(game);
        } else {
            game.goOutPermission = 'granted'; 
        }
        
        // 3. PHASE 3: MELD
        this.executeMeldingStrategy(game, isLastTurn);
        
        // 4. PHASE 4: DISCARD
        // Double check we have cards (we might have floated/gone out in Phase 3)
        if (game.players[this.seat] && game.players[this.seat].length > 0) {
            let discardIndex = this.pickDiscard(game);
            game.discardFromHand(this.seat, discardIndex);
        }

        this.saveStateSnapshot(game);
    }

    // --- STRATEGY: MELDING (THE FIX) ---
    executeMeldingStrategy(game, isLastTurn) {
        let myMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
        let hasOpened = Object.keys(myMelds).length > 0;

        // A. PANIC MODE or LAST TURN: Dump everything
        if (isLastTurn || this.checkPanicMode(game)) {
            this.meldMax(game); 
            return;
        }

        // B. NORMAL PLAY
        // 1. If not opened, we MUST calculate total points of all groups
        if (!hasOpened) {
            this.attemptToOpen(game);
        } else {
            // 2. If opened, just add whatever we can
            this.meldMax(game);
        }
    }

    // --- LOGIC PORTED FROM OLD BOT ---
    attemptToOpen(game) {
        let hand = game.players[this.seat];
        let groups = {};
        
        // Group naturals
        hand.forEach((c, i) => {
            if (c.isWild) return;
            if (!groups[c.rank]) groups[c.rank] = [];
            groups[c.rank].push(i);
        });
        
        // Find valid sets (3+ cards)
        let potentialMelds = [];
        for (let r in groups) {
            if (groups[r].length >= 3) {
                potentialMelds.push({ indices: groups[r], rank: r });
            }
        }
        
        if (potentialMelds.length > 0) {
            let myScore = (this.seat % 2 === 0) ? game.cumulativeScores.team1 : game.cumulativeScores.team2;
            let req = game.getOpeningReq(myScore);
            
            // Sum points of ALL potential melds
            let currentPts = 0;
            potentialMelds.forEach(m => {
                m.indices.forEach(idx => currentPts += this.getCardValue(hand[idx]));
            });
            
            // Only execute if we meet the requirement
            if (currentPts >= req) {
                // Use processOpening to send ALL melds at once
                game.processOpening(this.seat, potentialMelds, false);
            }
        }
    }

    meldMax(game) {
        let changed = true;
        // Keep trying to meld until no more moves are possible
        while(changed) {
            changed = false;
            let hand = game.players[this.seat];
            let myMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
            
            // 1. Try to add single cards to existing melds
            for (let i = hand.length - 1; i >= 0; i--) {
                let c = hand[i];
                // Add natural
                if (myMelds[c.rank]) {
                    let res = game.meldCards(this.seat, [i], c.rank);
                    if (res.success) changed = true;
                }
                // Add wild (if meld exists and < 7 cards)
                else if (c.isWild) {
                    for(let rank in myMelds) {
                        if (myMelds[rank].length < 7) {
                             let res = game.meldCards(this.seat, [i], rank);
                             if (res.success) { changed = true; break; }
                        }
                    }
                }
            }

            // 2. Try to create NEW melds (Naturals only)
            if (!changed) {
                 let groups = {};
                 hand.forEach((c, i) => {
                    if (!c.isWild) {
                        if (!groups[c.rank]) groups[c.rank] = [];
                        groups[c.rank].push(i);
                    }
                 });
                 for (let rank in groups) {
                     if (groups[rank].length >= 3) {
                         let res = game.meldCards(this.seat, groups[rank], rank);
                         if (res.success) { changed = true; break; }
                     }
                 }
            }
        }
    }

    // --- DECISION LOGIC ---

    decideDraw(game, isLastTurn) {
        let pile = game.discardPile;
        let topCard = pile.length > 0 ? pile[pile.length - 1] : null;
        
        if (!topCard) {
            game.drawFromDeck(this.seat);
            return;
        }

        // Logic: Can we pick it up?
        let hand = game.players[this.seat];
        let myMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
        let naturalMatches = hand.filter(c => c.rank === topCard.rank && !c.isWild).length;
        let isFrozen = pile.some(c => c.isWild || c.isRed3); // Frozen for everyone
        // Note: game.js also checks "isFrozen" based on "hasOpened"

        let canPickup = false;
        
        // 1. Pair in hand (Always valid)
        if (naturalMatches >= 2) canPickup = true;
        
        // 2. Meld on table (Only valid if pile not frozen by wild/red3)
        else if (myMelds[topCard.rank] && !isFrozen) canPickup = true;

        if (canPickup) {
            let pileValue = pile.reduce((sum, c) => sum + this.getCardValue(c), 0);
            let wantPile = false;

            if (isLastTurn) wantPile = true;
            else if (pileValue > 250) wantPile = true;
            else if (naturalMatches >= this.dna.PICKUP_THRESHOLD) wantPile = true;

            if (wantPile) {
                let res = game.pickupDiscardPile(this.seat);
                if (res.success) return; 
            }
        }
        game.drawFromDeck(this.seat);
    }

    pickDiscard(game) {
        let hand = game.players[this.seat];
        let nextPlayerSeat = (this.seat + 1) % game.config.PLAYER_COUNT;
        
        let enemyMelds;
        if (game.config.PLAYER_COUNT === 2) {
             enemyMelds = (this.seat === 0) ? game.team2Melds : game.team1Melds;
        } else {
             enemyMelds = (nextPlayerSeat % 2 === 0) ? game.team1Melds : game.team2Melds;
        }

        let candidates = hand.map((card, index) => {
            let score = 0;
            score += this.getCardValue(card) * 2;
            
            if (card.isWild) score += this.dna.DISCARD_WILD_PENALTY;
            if (card.isRed3) score += 99999; // Never discard Red 3 (impossible via game rules usually, but good safety)

            // CRITICAL: Don't feed enemy melds
            if (enemyMelds[card.rank]) {
                score += this.dna.FEED_ENEMY_MELD;
            }

            // Check memory of next player
            const knownHand = this.memory.knownHands[nextPlayerSeat] || [];
            const enemyHasPair = knownHand.filter(c => c.rank === card.rank).length >= 2;
            if (enemyHasPair) score += (this.dna.FEED_ENEMY_MELD * 2);

            return { index, score };
        });

        // Sort by Score (Lower is better to discard) -> Card Value
        candidates.sort((a, b) => a.score - b.score);

        return candidates[0].index;
    }

    // --- HELPERS & MEMORY ---

    handleGoOutPermission(game) {
        const partnerSeat = (this.seat + 2) % 4;
        const partnerHand = game.players[partnerSeat];
        // If partner hand is small, assume they might want to go out. 
        // We calculate permission based on OUR hand points.
        const myHand = game.players[this.seat];
        const myPoints = myHand.reduce((sum, c) => sum + this.getCardValue(c), 0);
        
        // If I have too many points, I deny the request
        game.goOutPermission = (myPoints > this.dna.GO_OUT_THRESHOLD) ? 'denied' : 'granted';
    }

    getRealDeckSize(game) {
        let visibleDeckCount = game.deck.length;
        // Fix: Use correct variable names from game.js
        let team1R3 = game.team1Red3s || [];
        let team2R3 = game.team2Red3s || [];
        
        let visibleR3 = team1R3.length + team2R3.length;
        let missingR3 = 4 - visibleR3;
        
        // Prevent negative
        return Math.max(0, visibleDeckCount - missingR3); 
    }

    checkPanicMode(game) {
        let enemyMelds = (this.seat % 2 === 0) ? game.team2Melds : game.team1Melds;
        let enemyCanastas = 0;
        for (let rank in enemyMelds) {
            if (enemyMelds[rank].length >= 7) enemyCanastas++;
        }
        // If enemy has 2+ Canastas, they can go out anytime. PANIC!
        return (enemyCanastas >= 2);
    }

    getCardValue(card) {
        if (card.rank === "Joker") return 50;
        if (card.rank === "2" || card.rank === "A") return 20;
        if (["8","9","10","J","Q","K"].includes(card.rank)) return 10;
        return 5; 
    }

    updateMemory(game) {
        if (!this.memory.initialized || (game.discardPile.length === 0 && this.memory.lastDiscardPile.length === 0)) {
            this.resetMemory(game);
            return;
        }
        // Simple memory tracking for "Backfill" logic could go here
        this.memory.lastDiscardPile = [...game.discardPile];
    }

    saveStateSnapshot(game) {
        this.memory.initialized = true;
        this.memory.lastDiscardPile = [...game.discardPile]; 
        for (let i = 0; i < game.config.PLAYER_COUNT; i++) {
            this.memory.playersLastHandSize[i] = game.players[i].length;
        }
    }

    resetMemory(game) {
        this.memory = {
            initialized: true,
            lastDiscardPile: [],
            knownHands: {},
            playersLastHandSize: {}
        };
        for (let i = 0; i < game.config.PLAYER_COUNT; i++) {
            this.memory.knownHands[i] = [];
            this.memory.playersLastHandSize[i] = game.players[i].length;
        }
    }
}

module.exports = { CanastaBot };