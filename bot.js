// bot.js

class CanastaBot {
    constructor(seat, difficulty = 'hard') {
        this.seat = seat;
        this.difficulty = difficulty;
        
        this.seenDiscards = {}; 
        this.partnerSignaled = false; 
    }

    observeDiscard(card, playerSeat, game) {
        if (!this.seenDiscards[card.rank]) this.seenDiscards[card.rank] = 0;
        this.seenDiscards[card.rank]++;

        let partnerSeat = (this.seat + 2) % 4; // 4-Player Logic
        if (playerSeat === partnerSeat) {
            this.partnerSignaled = card.isWild;
        }
    }

    async executeTurn(game, broadcastFunc) {
        const delay = (ms) => new Promise(res => setTimeout(res, ms));
        
        // --- CHECK ENDGAME STATUS ---
        // "If there is 7 cards or more left... I will still have one more turn."
        let realDeckSize = this.getRealDeckSize(game);
        let isLastTurn = realDeckSize < 7; 

        // --- PHASE 1: DRAW ---
        let pile = game.discardPile;
        let topCard = pile.length > 0 ? pile[pile.length - 1] : null;
        let wantPile = false;

        if (topCard) {
            let hand = game.players[this.seat];
            let myMelds = this.getMyMelds(game);
            
            if (this.canTakePile(game, hand, topCard, myMelds)) {
                // LAST TURN LOGIC: Always take the pile if we can!
                // Why? It gives us more cards to meld points, and denies the opponent the pile (if game continues).
                if (isLastTurn) {
                    wantPile = true;
                } else {
                    // Standard Logic
                    let pileValue = this.evaluatePile(pile);
                    if (pileValue > 50) wantPile = true; 
                    else if (this.difficulty === 'hard' && pile.length < 2) wantPile = false;
                }
            }
        }

        if (wantPile) {
            let res = game.pickupDiscardPile(this.seat);
            if (!res.success) game.drawFromDeck(this.seat);
        } else {
            game.drawFromDeck(this.seat);
        }
        
        broadcastFunc(this.seat);
        await delay(1000);

        // --- PHASE 2: MELD ---
        // Updated with "Dump Everything" logic for last turn
        this.executeMeldingStrategy(game, isLastTurn);
        
        broadcastFunc(this.seat);
        await delay(800);

        // --- PHASE 3: DISCARD ---
        if (game.players[this.seat].length > 0) {
            let discardIndex = this.pickDiscard(game, isLastTurn);
            
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
        // "Make sure you play all possible cards on the last turn, to don't get minus points."
        let panicMode = this.checkPanicMode(game);
        
        if (isLastTurn || panicMode) {
            // New Helper: Tries to meld every single card possible
            this.meldMax(game); 
            return;
        }

        // 2. NORMAL PLAY (Strategic)
        let deckSize = this.getRealDeckSize(game);
        let earlyGame = (deckSize > 37);
        let midGame = (deckSize <= 37 && deckSize > 18);

        // If early game, don't meld (unless we just picked up pile)
        if (earlyGame) return;

        // If End Game approaching (but not last turn yet)
        if (!midGame) {
             let wildsInHand = hand.filter(c => c.isWild).length;
             // Coordination logic: Meld naturals to help partner, keep wilds for closer
             if (wildsInHand >= 2) this.meldNaturals(game);
             else this.meldToCreateTargets(game);
        }
    }

    pickDiscard(game, isLastTurn) {
        let hand = game.players[this.seat];
        let candidates = [];

        hand.forEach((card, index) => {
            let score = 0; 

            // --- LAST TURN DISCARD ---
            if (isLastTurn) {
                // If it's the last turn, we just want to discard the HIGHEST value card
                // that is useless to us, to minimize the minus points in hand.
                // We don't care about "Safe" discards anymore, because the game is ending.
                score -= this.getCardPointValue(card); 
            } 
            // --- NORMAL STRATEGY ---
            else {
                if (card.isWild) score += 2000;
                if (card.isRed3) score += 5000; 
                
                if (this.partnerSignaled) {
                    if (!this.isCardSafe(card, game)) score += 10000; 
                }

                if (this.isCardSafe(card, game)) score -= 1000; 
                else score += 100;
            }

            candidates.push({ index, score });
        });

        candidates.sort((a, b) => a.score - b.score);
        return candidates[0].index;
    }

    // --- HELPERS ---

    getRealDeckSize(game) {
        // "It is important to consider how many red 3s... add this amount."
        // Example: If 12 cards visible, but only 1 Red Three on table (meaning 3 are in deck),
        // Real Playable Cards = 12 - 3 = 9.
        
        let visibleDeckCount = game.deck.length;
        
        // 1. Count Red 3s on table (Both teams)
        let team1R3 = game.team1RedThrees || []; // Assuming array of Red3s
        let team2R3 = game.team2RedThrees || [];
        let visibleR3 = team1R3.length + team2R3.length;
        
        // 2. Calculate missing Red 3s
        let missingR3 = 4 - visibleR3; // Total 4 in deck
        
        // 3. Subtract missing Red 3s from deck count
        // (Because drawing a Red 3 is free—it immediately draws another card, 
        // so it doesn't count as a "turn's worth" of cards)
        return visibleDeckCount - missingR3; 
    }

    // Simple point lookup for the "Last Turn" discard logic
    getCardPointValue(card) {
        if (card.rank === 'Joker') return 50;
        if (card.rank === '2' || card.rank === 'A') return 20;
        if (['8','9','10','J','Q','K'].includes(card.rank)) return 10;
        return 5; 
    }
    
    // ... (Previous methods: observeDiscard, isCardSafe, checkPanicMode remain the same) ...
}

module.exports = { CanastaBot };