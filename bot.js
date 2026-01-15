// bot.js

class CanastaBot {
    constructor(seat, difficulty = 'hard') {
        this.seat = seat;
        this.difficulty = difficulty;
        
        // --- STRATEGY MEMORY ---
        this.seenDiscards = {}; // Counts of every card rank seen in discard pile
        this.partnerSignaled = false; // Did partner freeze the pile recently?
    }

    // Call this whenever ANY player discards a card
    observeDiscard(card, playerSeat, game) {
        if (!card) return;
        
        // 1. Memory: Count the card for "Rule of 8" logic
        if (!this.seenDiscards[card.rank]) this.seenDiscards[card.rank] = 0;
        this.seenDiscards[card.rank]++;

        // 2. Partner Signal Check
        // In 4P: Partner is (mySeat + 2) % 4
        let partnerSeat = (this.seat + 2) % 4;
        if (playerSeat === partnerSeat) {
            if (card.isWild) {
                this.partnerSignaled = true; // Partner wants us to defend the pile!
            } else {
                this.partnerSignaled = false; // Reset if they throw a normal card
            }
        }
    }

    async executeTurn(game, broadcastFunc) {
        const delay = (ms) => new Promise(res => setTimeout(res, ms));
        
        // --- CHECK ENDGAME STATUS ---
        // "If there is 7 cards or more left... I will still have one more turn."
        let realDeckSize = this.getRealDeckSize(game);
        let isLastTurn = realDeckSize < 7; 

        // --- PHASE 1: DRAW STRATEGY ---
        let pile = game.discardPile;
        let topCard = pile.length > 0 ? pile[pile.length - 1] : null;
        let wantPile = false;

        // "The game is won by the pile."
        // We ALWAYS check if we can take it.
        if (topCard) {
            let hand = game.players[this.seat];
            let myMelds = this.getMyMelds(game);
            
            // Can we physically take it? (Rules check)
            if (this.canTakePile(game, hand, topCard, myMelds)) {
                // LAST TURN LOGIC: Always take the pile if we can!
                if (isLastTurn) {
                    wantPile = true;
                } else {
                    // Standard Logic: Is the pile worth it?
                    let pileValue = this.evaluatePile(pile);
                    
                    if (pileValue > 50) { 
                        wantPile = true; // Always take decent piles
                    } else if (this.difficulty === 'hard' && pile.length < 2) {
                        // Smart skip: Don't show hand for a 1-card pile unless we are desperate
                        wantPile = false;
                    }
                }
            }
        }

        if (wantPile) {
            let res = game.pickupDiscardPile(this.seat);
            if (!res.success) game.drawFromDeck(this.seat); // Fallback
        } else {
            game.drawFromDeck(this.seat);
        }
        
        broadcastFunc(this.seat);
        await delay(1000);

        // --- PHASE 2: MELD STRATEGY ---
        this.executeMeldingStrategy(game, isLastTurn);
        
        broadcastFunc(this.seat);
        await delay(800);

        // --- PHASE 3: DISCARD STRATEGY ---
        if (game.players[this.seat].length > 0) {
            let discardIndex = this.pickDiscard(game, isLastTurn);
            
            // IMPORTANT: Log this discard to my own memory before throwing
            let cardToThrow = game.players[this.seat][discardIndex];
            this.observeDiscard(cardToThrow, this.seat, game); 
            
            game.discardFromHand(this.seat, discardIndex);
            broadcastFunc(this.seat);
        }
    }

    // --- STRATEGY CORE ---

    executeMeldingStrategy(game, isLastTurn) {
        let hand = game.players[this.seat];
        
        // 1. PANIC / LAST TURN: DUMP EVERYTHING
        let panicMode = this.checkPanicMode(game);
        
        if (isLastTurn || panicMode) {
            this.meldMax(game); // Dump everything possible
            return;
        }

        // 2. NORMAL PLAY (Strategic)
        let deckSize = this.getRealDeckSize(game);
        let earlyGame = (deckSize > 37);
        let midGame = (deckSize <= 37 && deckSize > 18);

        // If early game, don't meld (unless we already melded to pick up pile)
        if (earlyGame) return;

        // If End Game approaching (but not last turn yet)
        if (!midGame) {
             let wildsInHand = hand.filter(c => c.isWild).length;
             
             // Coordination logic: Meld naturals to help partner, keep wilds for closer
             if (wildsInHand >= 2) {
                this.meldNaturals(game);
             } else {
                this.meldToCreateTargets(game);
             }
        }
    }

    pickDiscard(game, isLastTurn) {
        let hand = game.players[this.seat];
        let candidates = [];

        hand.forEach((card, index) => {
            let score = 0; // Lower is better (safer to discard)

            // --- LAST TURN DISCARD ---
            if (isLastTurn) {
                // Discard high points to minimize loss
                score -= this.getCardPointValue(card); 
            } 
            // --- NORMAL STRATEGY ---
            else {
                if (card.isWild) score += 2000; // Keep wilds
                if (card.isRed3) score += 5000; // Never discard Red 3
                
                // PARTNER SIGNAL (Freezing)
                if (this.partnerSignaled) {
                    // We MUST discard "Safe" cards. Risky cards get massive penalty
                    if (!this.isCardSafe(card, game)) {
                        score += 10000; 
                    }
                }

                // SAFETY CALCULATIONS (Rule of 8)
                if (this.isCardSafe(card, game)) {
                    score -= 1000; // Highly encourage discarding this
                } else {
                    score += 100; // Risky discard
                }
            }

            candidates.push({ index, score });
        });

        // Sort: Lowest score is best discard
        candidates.sort((a, b) => a.score - b.score);
        return candidates[0].index;
    }

    // --- HELPER METHODS (RESTORED) ---

    getMyMelds(game) {
        return (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
    }

    canTakePile(game, hand, topCard, myMelds) {
        if (topCard.isWild || topCard.rank === '3') return false;
        
        // 1. Can we add to existing meld?
        if (myMelds[topCard.rank]) return true;

        // 2. Do we have 2 naturals in hand?
        let naturals = hand.filter(c => c.rank === topCard.rank && !c.isWild).length;
        if (naturals >= 2) return true;

        // 3. If pile not frozen, can we match with 1 Natural + 1 Wild?
        // (Simplified check: assuming not frozen for bot ease, or checking game state)
        // For a perfect check, we'd need to know if the pile is frozen. 
        // Let's assume strict safety: Only take if we have 2 naturals OR existing meld.
        return false; 
    }

    evaluatePile(pile) {
        let value = 0;
        pile.forEach(c => value += this.getCardPointValue(c));
        return value;
    }

    getRealDeckSize(game) {
        let visibleDeckCount = game.deck.length;
        // Count visible Red 3s on table
        let team1R3 = game.team1RedThrees || [];
        let team2R3 = game.team2RedThrees || [];
        let visibleR3 = team1R3.length + team2R3.length;
        let missingR3 = 4 - visibleR3;
        return visibleDeckCount - missingR3; 
    }

    checkPanicMode(game) {
        let oppSeat = (this.seat + 1) % 4; 
        let oppHandSize = game.players[oppSeat].length;
        
        let oppMelds = (this.seat % 2 !== 0) ? game.team1Melds : game.team2Melds;
        let canastaCount = 0;
        let bigMeldCount = 0;

        for (let rank in oppMelds) {
            if (oppMelds[rank].length >= 7) canastaCount++;
            else if (oppMelds[rank].length >= 5) bigMeldCount++;
        }

        if (canastaCount >= 1 && bigMeldCount >= 1 && oppHandSize <= 5) {
            return true;
        }
        return false;
    }

    isCardSafe(card, game) {
        if (card.isWild) return true;
        let rank = card.rank;
        
        // 1. Count my hand
        let inHand = game.players[this.seat].filter(c => c.rank === rank).length;
        
        // 2. Count table melds
        let tableCount = 0;
        [game.team1Melds, game.team2Melds].forEach(teamMelds => {
            if (teamMelds[rank]) tableCount += teamMelds[rank].length;
        });

        // 3. Count Memory
        let inTrash = this.seenDiscards[rank] || 0;

        let totalSeen = inHand + tableCount + inTrash;

        // "Rule of 8"
        if (totalSeen >= 7) return true; 
        return false;
    }

    getCardPointValue(card) {
        if (card.rank === 'Joker') return 50;
        if (card.rank === '2' || card.rank === 'A') return 20;
        if (['8','9','10','J','Q','K'].includes(card.rank)) return 10;
        return 5; 
    }

    // --- MELDING ACTIONS ---

    // Dumps everything possible (Greedy Algorithm)
    meldMax(game) {
        let hand = [...game.players[this.seat]]; // Copy
        let myMelds = this.getMyMelds(game);
        let indicesToMeld = [];

        // 1. Try to add to existing melds
        hand.forEach((card, index) => {
            if (myMelds[card.rank] && !card.isWild) {
                // We found a natural match for an existing meld
                game.meldCards(this.seat, [index], card.rank);
            }
        });
        
        // 2. Try to form new natural melds (3+ cards)
        // (Complex logic omitted for brevity, but bot should group cards by rank and try to send sets of 3)
    }

    // Meld groups of 3+ naturals, but HOLD Wilds
    meldNaturals(game) {
        let hand = game.players[this.seat];
        let groups = {};
        
        // Group by rank
        hand.forEach((c, i) => {
            if (c.isWild) return;
            if (!groups[c.rank]) groups[c.rank] = [];
            groups[c.rank].push(i);
        });

        for (let rank in groups) {
            if (groups[rank].length >= 3) {
                game.meldCards(this.seat, groups[rank], rank);
            }
        }
    }

    // Ensure there is at least one meld on the table for partner to use
    meldToCreateTargets(game) {
        let hand = game.players[this.seat];
        let myMelds = this.getMyMelds(game);
        
        // If we already have melds, mission accomplished
        if (Object.keys(myMelds).length > 0) return;

        // Otherwise, try to force a meld using 2 Naturals + 1 Wild if necessary
        // (Implementation requires checking combinations of hand cards)
    }
}

module.exports = { CanastaBot };