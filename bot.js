// bot.js
class CanastaBot {
    constructor(seat, difficulty) {
        this.seat = seat;
        this.difficulty = difficulty; // 'easy', 'medium', 'hard'
    }

    async executeTurn(game, broadcastFunc) {
        const delay = (ms) => new Promise(res => setTimeout(res, ms));
        
        // --- 1. DECIDE DRAW ---
    let pile = game.discardPile;
    let topCard = pile.length > 0 ? pile[pile.length - 1] : null;
    let wantPile = false;

    if (topCard) {
        let hand = game.players[this.seat];
        // Count naturals and wilds
        let matches = hand.filter(c => c.rank === topCard.rank && !c.isWild).length;
        let wilds = hand.filter(c => c.isWild).length;
        
        let myMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
        let hasTableMeld = myMelds[topCard.rank] && myMelds[topCard.rank].length > 0;
        let weHaveOpened = Object.keys(myMelds).length > 0;
        let isFrozen = pile.some(c => c.isWild) || (pile.length > 0 && pile[0].isRed3);

        // --- NEW DIFFICULTY LOGIC ---
        
        // EASY: 30% chance to simply ignore a valid pickup
        if (this.difficulty === 'easy') {
            if (Math.random() > 0.3) { 
                if (matches >= 2) wantPile = true; 
            }
        } 
        
        // MEDIUM: Standard rules (Needs 2 naturals OR a table meld)
        else if (this.difficulty === 'medium') {
            if (weHaveOpened) {
                if (isFrozen) { if (matches >= 2) wantPile = true; }
                else { if (matches >= 2 || hasTableMeld) wantPile = true; }
            } else {
                if (matches >= 2 && this.canOpenWithPile(game, topCard)) wantPile = true;
            }
        } 
        
        // HARD: Aggressive & Smart
        else if (this.difficulty === 'hard') {
            if (weHaveOpened) {
                if (isFrozen) { if (matches >= 2) wantPile = true; }
                else {
                    if (matches >= 2 || hasTableMeld) wantPile = true;
                    // SMART MOVE: Use 1 Natural + 1 Wild to pickup!
                    if (matches >= 1 && wilds >= 1) wantPile = true;
                }
            } else {
                // Hard bots check if the pile helps them open immediately
                if ((matches >= 2 || (matches >= 1 && wilds >= 1)) && this.canOpenWithPile(game, topCard)) {
                    wantPile = true;
                }
            }
        }
    }

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
        if (game.players[this.seat].length > 0) {
            // FIX: Changed 'pickSafeDiscard' to 'pickDiscard' to match the method definition below
            let discardIndex = this.pickDiscard(game); 
            
            game.discardFromHand(this.seat, discardIndex);
            broadcastFunc(this.seat); 
        } else {
            console.log(`[BOT] Seat ${this.seat} has empty hand. Skipping discard.`);
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
        
        // Group cards by rank
        let groups = {};
        hand.forEach((c, i) => {
            if (c.isWild) return; 
            if (!groups[c.rank]) groups[c.rank] = [];
            groups[c.rank].push(i);
        });

        // --- STRATEGY BRANCH ---

        // EASY & MEDIUM: Meld everything immediately (Greedy)
        if (this.difficulty !== 'hard') {
            this.meldAggressively(game, groups, myMelds);
        }

        // HARD: Strategic / Conservative
        else {
            // 1. Prioritize finishing a Canasta (if a pile has 5+ cards, add to it)
            for (let rank in myMelds) {
                if (myMelds[rank].length >= 5 && groups[rank]) {
                     game.meldCards(this.seat, groups[rank], rank);
                }
            }

            // 2. Only meld new sets if we haven't opened yet
            let weHaveOpened = Object.keys(myMelds).length > 0;
            if (!weHaveOpened) {
                this.meldAggressively(game, groups, myMelds);
            } else {
                // If already opened, hold cards back! Only meld big groups (4+)
                for (let rank in groups) {
                    if (groups[rank].length >= 4) { 
                        game.meldCards(this.seat, groups[rank], rank);
                    }
                }
            }
        }
    }

    // Helper for Easy/Medium bots
    meldAggressively(game, groups, myMelds) {
        // Add to existing melds
        for (let rank in myMelds) {
            if (groups[rank] && groups[rank].length > 0) {
                let res = game.meldCards(this.seat, groups[rank], rank);
                if (res.success) return this.tryMelding(game); // Recurse to see if we can do more
            }
        }
        // Create new melds
        for (let rank in groups) {
            if (groups[rank].length >= 3) {
                let res = game.meldCards(this.seat, groups[rank], rank);
                if (res.success) return this.tryMelding(game);
            }
        }
    }

    pickDiscard(game) {
        let hand = game.players[this.seat];
        
        // EASY: 20% Chance to pick a totally random card (blunder)
        if (this.difficulty === 'easy' && Math.random() < 0.2) {
            return Math.floor(Math.random() * hand.length);
        }

        // HARD/MEDIUM: Calculate "Safety Score"
        let nextPlayerSeat = (this.seat + 1) % 4;
        let enemyMelds = (nextPlayerSeat % 2 === 0) ? game.team1Melds : game.team2Melds;

        let candidates = hand.map((card, index) => {
            let score = 0;
            
            // Penalties for discarding valuable cards
            if (card.isWild) score += 1000;
            if (card.isRed3) score += 2000; 
            
            // HUGE Penalty for feeding the enemy a card they have melded
            if (enemyMelds[card.rank]) {
                if (this.difficulty === 'hard') score += 5000; // Hard bot NEVER feeds
                else score += 500; // Medium bot tries not to
            }

            // Bonus for discarding singles (safe to throw)
            let matches = hand.filter(c => c.rank === card.rank).length;
            if (matches === 1) score -= 50; 
            
            // Hard Strategy: Freeze the pile?
            // If enemy has many melds, Hard bot might discard a Wild to freeze the pile
            if (this.difficulty === 'hard' && card.isWild && Object.keys(enemyMelds).length > 2) {
                let wildCount = hand.filter(c => c.isWild).length;
                if (wildCount > 1) score = -1000; // Force this discard to be chosen
            }

            return { index, score };
        });

        // Sort by lowest score (safest discard)
        candidates.sort((a, b) => a.score - b.score);
        return candidates[0].index;
    }
}

module.exports = { CanastaBot };