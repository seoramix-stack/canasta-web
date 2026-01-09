// bot.js
class CanastaBot {
    constructor(seat, difficulty) {
        this.seat = seat;
        this.difficulty = difficulty; // 'easy', 'medium', 'hard'
    }

    async executeTurn(game, broadcastFunc) {
        const delay = (ms) => new Promise(res => setTimeout(res, ms));
        
        // 1. DECIDE DRAW
        let pile = game.discardPile;
        let topCard = pile.length > 0 ? pile[pile.length - 1] : null;
        let wantPile = false;

        // CHECK: Can I pick up the pile?
        if (topCard) {
            // Logic: Do I have 2 naturals for this?
            let hand = game.players[this.seat];
            let matches = hand.filter(c => c.rank === topCard.rank && !c.isWild).length;
            
            // Check table state
            let myMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
            let hasTableMeld = myMelds[topCard.rank] && myMelds[topCard.rank].length > 0;
            let isFrozen = pile.some(c => c.isWild) || (pile.length > 0 && pile[0].isRed3); // Simplified frozen check
            let weHaveOpened = Object.keys(myMelds).length > 0;

            // --- LOGIC TREE ---
            if (weHaveOpened) {
                // CASE A: We already opened.
                // If frozen: Need 2 naturals.
                // If NOT frozen: Need 2 naturals OR (1 natural + 1 wild) OR (existing meld on table).
                if (isFrozen) {
                    if (matches >= 2) wantPile = true;
                } else {
                    // Not frozen: easier to pick up
                    if (matches >= 2 || hasTableMeld) wantPile = true;
                    // Smart Bot: Check for 1 natural + 1 wild
                    if (this.difficulty === 'hard' && !wantPile) {
                        let wilds = hand.filter(c => c.isWild).length;
                        if (matches >= 1 && wilds >= 1) wantPile = true;
                    }
                }
            } else {
                // CASE B: We have NOT opened yet.
                // Rule: MUST have 2 naturals to open with pile.
                if (matches >= 2) {
                    // Check points requirement (50, 90, 120)
                    if (this.canOpenWithPile(game, topCard)) {
                        wantPile = true;
                    }
                }
            }
        }

        // EXECUTE DRAW
        if (wantPile) {
            // Try to pickup
            let res = game.pickupDiscardPile(this.seat);
            if (!res.success) {
                // If failed (e.g. logic error), fallback to deck
                game.drawFromDeck(this.seat);
            }
        } else {
            game.drawFromDeck(this.seat);
        }
        
        broadcastFunc(this.seat); 
        await delay(1000); 

        // 2. DECIDE MELD
        this.tryMelding(game);
        broadcastFunc(this.seat);
        await delay(800);

        // 3. DECIDE DISCARD
        // FIX: Only try to discard if we actually have cards!
        // (If we melded everything, we "Went Out" or are "Floating", so no discard is possible)
        if (game.players[this.seat].length > 0) {
            let discardIndex = this.pickSafeDiscard(game);
            game.discardFromHand(this.seat, discardIndex);
            broadcastFunc(this.seat); 
        } else {
            // Hand is empty. 
            // If the game rules require a discard to go out, the game logic handles that check.
            // If we are here with 0 cards, we simply end the function without discarding.
            console.log(`[BOT] Seat ${this.seat} has empty hand (Went Out or Floating). Skipping discard.`);
        }
    }

    // --- NEW: LOGIC TO CHECK POINTS REQUIREMENT ---
    canOpenWithPile(game, topCard) {
        // 1. Get current score to find requirement
        let currentScore = (this.seat % 2 === 0) ? game.team1Score : game.team2Score;
        // Default to 0 if undefined (start of game)
        currentScore = currentScore || 0; 

        let req = 50;
        if (currentScore >= 1500) req = 90;
        if (currentScore >= 3000) req = 120;

        // 2. Calculate points of BEST possible melds using Hand + TopCard
        let hand = game.players[this.seat];
        let mockHand = [...hand, topCard]; // Pretend we picked it up
        
        let points = this.calculateBestHandPoints(mockHand);
        
        return points >= req;
    }

    calculateBestHandPoints(hand) {
        // Simplified Greedy Calculation
        // 1. Group by Rank
        let groups = {};
        let wilds = [];
        let points = 0;

        hand.forEach(c => {
            if (c.isWild) {
                wilds.push(c);
            } else {
                if (!groups[c.rank]) groups[c.rank] = [];
                groups[c.rank].push(c);
            }
        });

        // 2. Form Naturals (Groups of 3+)
        for (let rank in groups) {
            let cards = groups[rank];
            if (cards.length >= 3) {
                // Valid natural meld! Add points.
                cards.forEach(c => points += this.getCardScore(c));
                // Remove from potential use (simple logic: used cards are done)
                groups[rank] = []; 
            }
        }

        // 3. Use Wilds to help pairs become melds
        for (let rank in groups) {
            let cards = groups[rank];
            if (cards.length === 2 && wilds.length > 0) {
                // Use 1 wild to make a meld of 3
                let w = wilds.pop();
                points += this.getCardScore(w);
                cards.forEach(c => points += this.getCardScore(c));
                groups[rank] = []; // done
            }
        }

        // (Note: This logic is conservative. It doesn't count "Top Card Points" 
        // if that card didn't help form a meld. This ensures we only count 
        // points that actually land on the table.)

        return points;
    }

    getCardScore(card) {
        if (card.rank === 'Joker') return 50;
        if (card.rank === '2') return 20;
        if (card.rank === 'A') return 20;
        if (['8','9','10','J','Q','K'].includes(card.rank)) return 10;
        if (['4','5','6','7'].includes(card.rank)) return 5;
        return 5; // Black 3, etc.
    }

    tryMelding(game) {
        let hand = game.players[this.seat];
        let myMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
        
        let groups = {};
        hand.forEach((c, i) => {
            if (c.isWild) return; 
            if (!groups[c.rank]) groups[c.rank] = [];
            groups[c.rank].push(i);
        });

        // 1. Add to existing melds
        for (let rank in myMelds) {
            if (groups[rank] && groups[rank].length > 0) {
                let res = game.meldCards(this.seat, groups[rank], rank);
                if (res.success) return this.tryMelding(game); 
            }
        }

        // 2. Create new melds
        for (let rank in groups) {
            if (groups[rank].length >= 3) {
                let res = game.meldCards(this.seat, groups[rank], rank);
                if (res.success) return this.tryMelding(game);
            }
        }
    }

    pickSafeDiscard(game) {
        let hand = game.players[this.seat];
        let nextPlayerSeat = (this.seat + 1) % 4;
        let enemyMelds = (nextPlayerSeat % 2 === 0) ? game.team1Melds : game.team2Melds;

        let candidates = hand.map((card, index) => {
            let score = 0;
            if (card.isWild) score += 1000;
            if (card.isRed3) score += 2000; 
            if (enemyMelds[card.rank]) score += 500;
            
            // Prefer discarding singles
            let matches = hand.filter(c => c.rank === card.rank).length;
            if (matches === 1) score -= 50; 
            
            return { index, score };
        });

        candidates.sort((a, b) => a.score - b.score);
        return candidates[0].index;
    }
}

module.exports = { CanastaBot };