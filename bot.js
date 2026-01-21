// bot.js - v8.0: Fail-Safe Architecture

class CanastaBot {
    constructor(seat, difficulty = 'hard', type = '4p') {
        this.seat = seat;
        this.difficulty = difficulty;
        this.type = type; 
        
        // --- MEMORY ---
        this.seenDiscards = {}; 
        this.partnerSignaled = false; 
    }

    // --- MAIN TURN EXECUTION ---
    async executeTurn(game, broadcastFunc) {
        const delay = (ms) => new Promise(res => setTimeout(res, ms));

        try {
            // 1. PHASE: DRAW
            await this.performDrawPhase(game);
            if (broadcastFunc) broadcastFunc(this.seat);
            await delay(1000);

            // 2. PHASE: MELD (Wrapped in Try/Catch so it doesn't kill the turn)
            try {
                this.performMeldingPhase(game);
                if (broadcastFunc) broadcastFunc(this.seat);
                await delay(800);
            } catch (err) {
                console.error(`[BOT ${this.seat}] Melding Crash (Recovering...):`, err);
            }

            // 3. PHASE: DISCARD (Guaranteed to run)
            this.performDiscardPhase(game, broadcastFunc);
            
        } catch (err) {
            console.error(`[BOT ${this.seat}] FATAL TURN ERROR:`, err);
            // Emergency fallback: If everything failed, try to force a discard to unstick the game
            try {
                 if (game.turnPhase === 'playing') {
                     game.discardFromHand(this.seat, 0); // Discard first card blindly
                     if (broadcastFunc) broadcastFunc(this.seat);
                 }
            } catch (e) { /* Ignore */ }
        }
    }

    // --- PHASE LOGIC ---

    async performDrawPhase(game) {
        let pile = game.discardPile;
        let topCard = pile.length > 0 ? pile[pile.length - 1] : null;
        let wantPile = false;

        // Simple Pickup Logic
        if (topCard) {
            let hand = game.players[this.seat];
            let myMelds = this.getMyMelds(game);
            
            // Check if we can legally take it
            if (this.canTakePile(game, hand, topCard, myMelds)) {
                let pileValue = this.evaluatePile(pile);
                if (pileValue > 50 || (this.difficulty === 'hard' && pile.length > 1)) {
                    wantPile = true;
                }
            }
        }

        if (wantPile) {
            let res = game.pickupDiscardPile(this.seat);
            if (!res.success) game.drawFromDeck(this.seat);
        } else {
            game.drawFromDeck(this.seat);
        }
    }

    performMeldingPhase(game) {
        if (game.turnPhase !== 'playing') return;

        let realDeckSize = this.getRealDeckSize(game);
        let isLastTurn = realDeckSize < 7;
        let hasOpened = Object.keys(this.getMyMelds(game)).length > 0;

        // 1. Panic / Last Turn Mode
        if (isLastTurn || this.checkPanicMode(game)) {
            this.meldMax(game);
            return;
        }

        // 2. Normal Play
        if (!hasOpened) {
            this.attemptToOpen(game);
        } else {
            this.meldMax(game);
        }
    }

    performDiscardPhase(game, broadcastFunc) {
        if (game.turnPhase !== 'playing') return;

        let hand = game.players[this.seat];
        if (!hand || hand.length === 0) return;

        try {
            let discardIndex = this.pickDiscard(game);
            
            let cardToThrow = hand[discardIndex];
            if (cardToThrow) {
                this.observeDiscard(cardToThrow, this.seat, game);
                game.discardFromHand(this.seat, discardIndex);
                if (broadcastFunc) broadcastFunc(this.seat);
            }
        } catch (e) {
            console.error(`[BOT ${this.seat}] Discard Logic Error:`, e);
            // Fallback: Discard index 0
            game.discardFromHand(this.seat, 0);
            if (broadcastFunc) broadcastFunc(this.seat);
        }
    }

    // --- STRATEGY HELPERS ---

    pickDiscard(game) {
        let hand = game.players[this.seat];
        // Calculate Enemy Melds safely
        let enemyMelds = (this.seat % 2 === 0) ? game.team2Melds : game.team1Melds;
        if (!enemyMelds) enemyMelds = {}; // Safety fallack

        let candidates = [];

        hand.forEach((card, index) => {
            let score = 0;

            // 1. Base Value (High value = good to save, so negative score for discard?)
            // Actually, usually we want to discard "safe" cards (score -> high) or "junk" (score -> high)
            // Let's use: Higher Score = Better Candidate to Discard
            
            // Penalty: Do not discard Wilds/Red3s
            if (card.isWild) score -= 5000;
            if (card.isRed3) score -= 9000;

            // Penalty: Do not feed enemy
            if (enemyMelds[card.rank] && !card.isWild) {
                score -= 2000;
            }

            // Bonus: Discard cards we have seen in trash (Rule of 8 / Safe)
            if (this.isCardSafe(card, game)) {
                score += 500;
            }

            // Bonus: Discard High points if safe
            score += this.getCardPointValue(card);

            candidates.push({ index, score });
        });

        // Sort Descending: Highest score is best discard
        candidates.sort((a, b) => b.score - a.score);

        return candidates[0] ? candidates[0].index : 0;
    }

    meldMax(game) {
        let changed = true;
        let attempts = 0;
        // Prevent infinite loops with a hard cap
        while(changed && attempts < 20) {
            changed = false;
            attempts++;
            let hand = game.players[this.seat];
            let myMelds = this.getMyMelds(game);
            
            // Try to add to existing melds
            for (let i = hand.length - 1; i >= 0; i--) {
                let c = hand[i];
                if (myMelds[c.rank]) {
                    let res = game.meldCards(this.seat, [i], c.rank);
                    if (res.success) changed = true;
                }
                else if (c.isWild) {
                    // Try to add Wild to any meld < 7
                    for(let rank in myMelds) {
                        if (myMelds[rank].length < 7) {
                             let res = game.meldCards(this.seat, [i], rank);
                             if (res.success) { changed = true; break; }
                        }
                    }
                }
            }
        }
        this.meldNaturals(game);
    }

    meldNaturals(game) {
        let hand = game.players[this.seat];
        let groups = {};
        hand.forEach((c, i) => {
            if (!c.isWild) {
                if (!groups[c.rank]) groups[c.rank] = [];
                groups[c.rank].push(i);
            }
        });

        for (let rank in groups) {
            if (groups[rank].length >= 3) {
                game.meldCards(this.seat, groups[rank], rank);
            }
        }
    }

    attemptToOpen(game) {
        let hand = game.players[this.seat];
        let groups = {};
        hand.forEach((c, i) => {
            if (!c.isWild) {
                if (!groups[c.rank]) groups[c.rank] = [];
                groups[c.rank].push(i);
            }
        });
        
        let potentialMelds = [];
        let totalPts = 0;

        for (let r in groups) {
            if (groups[r].length >= 3) {
                let indices = groups[r];
                potentialMelds.push({ indices: indices, rank: r });
                indices.forEach(idx => totalPts += this.getCardPointValue(hand[idx]));
            }
        }
        
        let myScore = (this.seat % 2 === 0) ? game.cumulativeScores.team1 : game.cumulativeScores.team2;
        let req = game.getOpeningReq(myScore);
        
        if (totalPts >= req && potentialMelds.length > 0) {
            game.processOpening(this.seat, potentialMelds, false);
        }
    }

    // --- HELPERS ---

    getMyMelds(game) {
        return (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
    }

    getRealDeckSize(game) {
        let visibleDeckCount = game.deck.length;
        let team1R3 = game.team1Red3s || [];
        let team2R3 = game.team2Red3s || [];
        let missingR3 = 4 - (team1R3.length + team2R3.length);
        return Math.max(0, visibleDeckCount - missingR3); 
    }

    checkPanicMode(game) {
        // Safety check for players array
        let pCount = game.players ? game.players.length : 4;
        let oppSeat = (this.seat + 1) % pCount; 
        
        if (!game.players[oppSeat]) return false;

        let oppMelds = (this.seat % 2 !== 0) ? game.team1Melds : game.team2Melds;
        if (!oppMelds) return false;

        let canastaCount = 0;
        for (let rank in oppMelds) {
            if (oppMelds[rank].length >= 7) canastaCount++;
        }
        return (canastaCount >= 2);
    }

    isCardSafe(card, game) {
        if (card.isWild) return true;
        let rank = card.rank;
        
        // Count cards visible everywhere
        let inHand = 0; // Bot assumes it has them
        let tableCount = 0;
        
        if (game.team1Melds[rank]) tableCount += game.team1Melds[rank].length;
        if (game.team2Melds[rank]) tableCount += game.team2Melds[rank].length;
        
        let inTrash = this.seenDiscards[rank] || 0;
        
        // If 7+ are accounted for, it's impossible for enemy to have a clean pair
        return (tableCount + inTrash >= 7);
    }

    getCardPointValue(card) {
        if (card.rank === 'Joker') return 50;
        if (card.rank === '2' || card.rank === 'A') return 20;
        if (['8','9','10','J','Q','K'].includes(card.rank)) return 10;
        return 5; 
    }

    evaluatePile(pile) {
        return pile.reduce((sum, c) => sum + this.getCardPointValue(c), 0);
    }

    canTakePile(game, hand, topCard, myMelds) {
        if (topCard.isWild || topCard.rank === '3') return false;
        if (myMelds[topCard.rank]) return true;
        let naturals = hand.filter(c => c.rank === topCard.rank && !c.isWild).length;
        return (naturals >= 2);
    }
    
    decideGoOutPermission(game) {
        // Default to YES to prevent game stalling if logic is complex
        return true;
    }

    observeDiscard(card, playerSeat, game) {
        if (!card) return;
        if (!this.seenDiscards[card.rank]) this.seenDiscards[card.rank] = 0;
        this.seenDiscards[card.rank]++;
    }
}

module.exports = { CanastaBot };