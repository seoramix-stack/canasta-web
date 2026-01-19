// bot.js - v4.0: Smart Melding & Defensive Play
class CanastaBot {
    constructor(seat, difficulty, type = '4p', injectedDna = null) {
        this.seat = seat;
        this.difficulty = difficulty; 

        // Refined DNA for 2P Strategy based on your feedback
        const DNA_2P = {
            DISCARD_WILD_PENALTY: 1819,
            FEED_ENEMY_MELD: 6042.88940353999,
            DISCARD_SINGLE_BONUS: -54,
            MELD_AGGRESSION: 0.8659756084377093,
            PICKUP_THRESHOLD: 2,
            MELD_IF_WINNING_BONUS: -0.089135082250084,
            MELD_IF_LOSING_BONUS: -0.022907882497914256
        };

        const DNA_4P = { 
            DISCARD_WILD_PENALTY: 819,
  FEED_ENEMY_MELD: 5323.386456325889,
  DISCARD_SINGLE_BONUS: -72,
  MELD_AGGRESSION: 1,
  PICKUP_THRESHOLD: 2,
  MELD_IF_WINNING_BONUS: -0.1531545342589467,
  MELD_IF_LOSING_BONUS: 0.17455006475078177
        };

        if (injectedDna) {
            this.dna = injectedDna;
        } else {
            this.dna = (type === '2p') ? DNA_2P : DNA_4P;
        }
    }

    playTurnSync(game) { 
        this.decideDraw(game);
        this.tryMelding(game);
        if (game.players[this.seat].length > 0) {
            let discardIndex = this.pickDiscard(game);
            game.discardFromHand(this.seat, discardIndex);
        }
    }

    async executeTurn(game, broadcastFunc) { 
        const delay = (ms) => new Promise(res => setTimeout(res, ms));

        this.decideDraw(game);
        broadcastFunc(this.seat);
        await delay(800);

        this.tryMelding(game);
        broadcastFunc(this.seat);
        await delay(800);

        if (game.players[this.seat].length > 0) {
            let discardIndex = this.pickDiscard(game);
            game.discardFromHand(this.seat, discardIndex);
            broadcastFunc(this.seat);
        }
    }

    // --- LOGIC ---

    decideDraw(game) {
        let pile = game.discardPile;
        let topCard = pile.length > 0 ? pile[pile.length - 1] : null;
        
        // If nothing to pick up, just draw
        if (!topCard) {
            game.drawFromDeck(this.seat);
            return;
        }

        // --- 1. ANALYZE CAPABILITY (Can I pick it up?) ---
        let hand = game.players[this.seat];
        let myMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
        
        // Check freezing status (Wild or Red 3 in pile)
        let isFrozen = pile.some(c => c.isWild || c.isRed3);
        
        // Count cards in hand
        let naturalMatches = hand.filter(c => c.rank === topCard.rank && !c.isWild).length;
        let wildCount = hand.filter(c => c.isWild).length;

        let canPickup = false;

        // A. Natural Pair (Works even if frozen)
        if (naturalMatches >= 2) canPickup = true;
        
        // B. Existing Meld (Works if not frozen, or frozen + 2 naturals)
        // Note: game.js logic implies table meld allows pickup usually unless specific frozen rules apply. 
        // We will assume table meld + 1 natural is valid if not frozen.
        else if (myMelds[topCard.rank] && !isFrozen && naturalMatches >= 1) canPickup = true;
        
        // C. Mixed (1 Natural + 1 Wild) - Only if NOT frozen
        else if (!isFrozen && naturalMatches >= 1 && wildCount >= 1) canPickup = true;


        // --- 2. ANALYZE DESIRE (Do I WANT to pick it up?) ---
        if (canPickup) {
            let pileValue = pile.reduce((sum, c) => sum + this.getCardValue(c), 0);
            let wantPile = false;

            // Rule 1: Always take JUICY piles (>200 pts)
            if (pileValue > 200) wantPile = true;

            // Rule 2: Take if it matches our "Pickup Threshold" DNA
            // (e.g., if we have lots of matches, we want to build a Canasta)
            else if (naturalMatches >= this.dna.PICKUP_THRESHOLD) wantPile = true;

            // Rule 3: Always take if it helps close a Canasta
            else if (myMelds[topCard.rank] && myMelds[topCard.rank].length >= 4) wantPile = true;

            if (wantPile) {
                let res = game.pickupDiscardPile(this.seat);
                if (res.success) return; // Successfully picked up
            }
        }

        // Fallback
        game.drawFromDeck(this.seat);
    }

    tryMelding(game) {
        // --- CONTEXT AWARENESS ---
        const myMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
        const enemyMelds = (this.seat % 2 === 0) ? game.team2Melds : game.team1Melds;
        
        // Count Enemy Canastas (Danger Check)
        let enemyCanastaCount = 0;
        for (let rank in enemyMelds) {
            if (enemyMelds[rank].length >= 7) enemyCanastaCount++;
        }
        let isPanicMode = (enemyCanastaCount >= 2);

        let hand = game.players[this.seat];
        let madeMeld = true;

        // LOOP: Keep melding until we can't do anything else
        while (madeMeld) {
            madeMeld = false;
            hand = game.players[this.seat]; // Refresh hand

            // 1. Group the hand
            let groups = {};
            let wildIndices = [];
            
            hand.forEach((c, i) => {
                if (c.isWild) {
                    wildIndices.push(i);
                } else {
                    if (!groups[c.rank]) groups[c.rank] = [];
                    groups[c.rank].push(i);
                }
            });

            // --- PHASE 1: THE CLOSER (Priority #1) ---
            // Try to finish Canastas using Naturals OR Wilds
            for (let rank in myMelds) {
                let currentLen = myMelds[rank].length;
                let naturalsIndices = groups[rank] || [];
                
                if (currentLen < 7) {
                    let needed = 7 - currentLen;
                    
                    // A. We have enough Naturals
                    if (naturalsIndices.length >= needed) {
                        let res = game.meldCards(this.seat, naturalsIndices, rank);
                        if (res.success) { madeMeld = true; break; }
                    }
                    // B. We need Wilds to finish it
                    else if ((naturalsIndices.length + wildIndices.length) >= needed) {
                        let missing = needed - naturalsIndices.length;
                        // Use all available naturals + just enough wilds
                        let cardsToPlay = [...naturalsIndices, ...wildIndices.slice(0, missing)];
                        
                        let res = game.meldCards(this.seat, cardsToPlay, rank);
                        if (res.success) { madeMeld = true; break; }
                    }
                }
            }
            if (madeMeld) continue; // Loop again if we closed a Canasta

            // --- PHASE 2: THE STRATEGIST (Regular Melds) ---
            let aggression = isPanicMode ? 1.0 : this.dna.MELD_AGGRESSION;
            
            const myScore = (this.seat % 2 === 0) ? game.cumulativeScores.team1 : game.cumulativeScores.team2;
            const enemyScore = (this.seat % 2 === 0) ? game.cumulativeScores.team2 : game.cumulativeScores.team1;
            
            if (myScore > enemyScore + 1000) aggression += this.dna.MELD_IF_WINNING_BONUS; 
            else if (enemyScore > myScore + 1000) aggression += this.dna.MELD_IF_LOSING_BONUS;

            if (Math.random() > aggression) return; 

            for (let rank in groups) {
                // Meld new triplets
                if (groups[rank].length >= 3) {
                    let res = game.meldCards(this.seat, groups[rank], rank);
                    if (res.success) { madeMeld = true; break; }
                }
                // Add to existing melds
                if (myMelds[rank] && groups[rank].length >= 1) {
                     let res = game.meldCards(this.seat, groups[rank], rank);
                     if (res.success) { madeMeld = true; break; }
                }
            }
        }
    }

    pickDiscard(game) {
        let hand = game.players[this.seat];
        let pile = game.discardPile;
        let pileValue = pile.reduce((sum, c) => sum + this.getCardValue(c), 0);
        
        let nextPlayerSeat = (this.seat + 1) % game.config.PLAYER_COUNT;
        
        let enemyMelds;
        if (game.config.PLAYER_COUNT === 2) {
             enemyMelds = (this.seat === 0) ? game.team2Melds : game.team1Melds;
        } else {
             enemyMelds = (nextPlayerSeat % 2 === 0) ? game.team1Melds : game.team2Melds;
        }

        // Detect if opponent is dangerous (2+ Canastas)
        let enemyCanastaCount = 0;
        for (let rank in enemyMelds) if (enemyMelds[rank].length >= 7) enemyCanastaCount++;
        let isEndGame = (enemyCanastaCount >= 2);

        let candidates = hand.map((card, index) => {
            let score = 0;
            
            // 1. Base Value (High value = keep)
            score += this.getCardValue(card) * 2;
            
            // 2. Penalties
            if (card.isWild) score += this.dna.DISCARD_WILD_PENALTY;
            if (card.isRed3) score += 99999; 

            // 3. Feeding Analysis
            if (enemyMelds[card.rank]) {
                // If endgame or juicy pile, feeding is fatal.
                if (isEndGame || pileValue > 300) {
                     score += (this.dna.FEED_ENEMY_MELD * 5); // Massive penalty
                } else {
                     score += this.dna.FEED_ENEMY_MELD;
                }
            }

            // 4. Pair Protection (Don't discard pairs if we want the pile!)
            let matches = hand.filter(c => c.rank === card.rank).length;
            
            if (matches >= 2) {
                // If pile is juicy, PROTECT PAIRS WITH LIFE
                if (pileValue > 200) score += (this.dna.BREAK_PAIR_PENALTY * 3);
                else score += this.dna.BREAK_PAIR_PENALTY;
            }

            // 5. Junk Bonus (Encourage discarding 4-7)
            if (["4","5","6","7"].includes(card.rank)) {
                score += this.dna.DISCARD_JUNK_BONUS;
            }

            return { index, score, card };
        });

        // Sort: Lowest score is best discard
        candidates.sort((a, b) => {
            if (Math.abs(a.score - b.score) > 1) return a.score - b.score;
            return this.getCardValue(a.card) - this.getCardValue(b.card);
        });

        return candidates[0].index;
    }

    getCardValue(card) {
        if (card.rank === "Joker") return 50;
        if (card.rank === "2" || card.rank === "A") return 20;
        if (["8","9","10","J","Q","K"].includes(card.rank)) return 10;
        return 5; 
    }
}

module.exports = { CanastaBot };