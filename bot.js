// bot.js - v5.0: Smart Melding, Defensive Play & Partner Communication
class CanastaBot {
    constructor(seat, difficulty, type = '4p', injectedDna = null) {
        this.seat = seat;
        this.difficulty = difficulty; 

        // Refined DNA for 2P Strategy
        const DNA_2P = {
            DISCARD_WILD_PENALTY: 1732,
            FEED_ENEMY_MELD: 2071.43,
            DISCARD_SINGLE_BONUS: -93,
            MELD_AGGRESSION: 0.91,
            PICKUP_THRESHOLD: 2,
            MELD_IF_WINNING_BONUS: 0.05,
            MELD_IF_LOSING_BONUS: -0.19
        };

        const DNA_4P = { 
            DISCARD_WILD_PENALTY: 1732,
            FEED_ENEMY_MELD: 3012.50,
            DISCARD_SINGLE_BONUS: -93,
            MELD_AGGRESSION: 0.84,
            PICKUP_THRESHOLD: 2,
            MELD_IF_WINNING_BONUS: 0.05,
            MELD_IF_LOSING_BONUS: -0.19,
            DISCARD_RED3_PENALTY: 1074.55
        };

        if (injectedDna) {
            this.dna = injectedDna;
        } else {
            this.dna = (type === '2p') ? DNA_2P : DNA_4P;
        }
    }

    playTurnSync(game) { 
        this.decideDraw(game);

        // --- PARTNER COMMUNICATION PHASE (Simulation Only) ---
        // In real games, this is async. Here we simulate the "Ask".
        if (game.config.PLAYER_COUNT === 4) {
            const partnerSeat = (this.seat + 2) % 4;
            const partnerHand = game.players[partnerSeat];
            
            // Logic: If partner has LOTS of points (>500), say NO. Otherwise YES.
            const partnerHandPoints = partnerHand.reduce((sum, c) => sum + this.getCardValue(c), 0);
            
            // Set the permission state on the game object directly
            game.goOutPermission = (partnerHandPoints > 500) ? 'denied' : 'granted';
        } else {
            game.goOutPermission = 'granted'; // 2P always allowed
        }
        
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

        // Note: In real async games, the "Ask" is a user event. 
        // We assume bots in async mode don't need to ask each other via UI, 
        // or we default permission to 'granted' unless implemented otherwise.
        game.goOutPermission = 'granted'; 

        this.tryMelding(game);
        broadcastFunc(this.seat);
        await delay(800);

        if (game.players[this.seat].length > 0) {
            let discardIndex = this.pickDiscard(game);
            game.discardFromHand(this.seat, discardIndex);
            broadcastFunc(this.seat);
        }
    }

    // --- NEW: LOGIC FOR REPLYING TO PARTNER ---
    decideGoOutPermission(game) {
        // "Should I let my partner go out?"
        // I am 'this.seat'. My partner is asking.
        
        const myHand = game.players[this.seat];
        const myPoints = myHand.reduce((sum, c) => sum + this.getCardValue(c), 0);
        
        // If I'm holding a lot of points (e.g. > 500), I don't want the round to end yet!
        // I want a chance to meld them.
        if (myPoints > 500) return false; // "NO!"

        return true; // "Yes, go ahead."
    }

    // --- LOGIC ---

    decideDraw(game) {
        let pile = game.discardPile;
        let topCard = pile.length > 0 ? pile[pile.length - 1] : null;
        
        if (!topCard) {
            game.drawFromDeck(this.seat);
            return;
        }

        let hand = game.players[this.seat];
        let myMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
        let isFrozen = pile.some(c => c.isWild || c.isRed3);
        let naturalMatches = hand.filter(c => c.rank === topCard.rank && !c.isWild).length;
        let wildCount = hand.filter(c => c.isWild).length;

        let canPickup = false;
        if (naturalMatches >= 2) canPickup = true;
        else if (myMelds[topCard.rank] && !isFrozen && naturalMatches >= 1) canPickup = true;
        else if (!isFrozen && naturalMatches >= 1 && wildCount >= 1) canPickup = true;

        if (canPickup) {
            let pileValue = pile.reduce((sum, c) => sum + this.getCardValue(c), 0);
            let wantPile = false;

            if (pileValue > 200) wantPile = true;
            else if (naturalMatches >= this.dna.PICKUP_THRESHOLD) wantPile = true;
            else if (myMelds[topCard.rank] && myMelds[topCard.rank].length >= 4) wantPile = true;

            if (wantPile) {
                let res = game.pickupDiscardPile(this.seat);
                if (res.success) return; 
            }
        }
        game.drawFromDeck(this.seat);
    }

    tryMelding(game) {
        const myMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
        const enemyMelds = (this.seat % 2 === 0) ? game.team2Melds : game.team1Melds;
        
        let enemyCanastaCount = 0;
        for (let rank in enemyMelds) {
            if (enemyMelds[rank].length >= 7) enemyCanastaCount++;
        }
        let isPanicMode = (enemyCanastaCount >= 2);

        let hand = game.players[this.seat];
        let madeMeld = true;

        while (madeMeld) {
            madeMeld = false;
            hand = game.players[this.seat]; 

            let groups = {};
            let wildIndices = [];
            hand.forEach((c, i) => {
                if (c.isWild) wildIndices.push(i);
                else {
                    if (!groups[c.rank]) groups[c.rank] = [];
                    groups[c.rank].push(i);
                }
            });

            // 1. Try to Close Canastas
            for (let rank in myMelds) {
                let currentLen = myMelds[rank].length;
                let naturalsIndices = groups[rank] || [];
                
                if (currentLen < 7) {
                    let needed = 7 - currentLen;
                    if (naturalsIndices.length >= needed) {
                        let res = game.meldCards(this.seat, naturalsIndices, rank);
                        if (res.success) { madeMeld = true; break; }
                    }
                    else if ((naturalsIndices.length + wildIndices.length) >= needed) {
                        let missing = needed - naturalsIndices.length;
                        let cardsToPlay = [...naturalsIndices, ...wildIndices.slice(0, missing)];
                        let res = game.meldCards(this.seat, cardsToPlay, rank);
                        if (res.success) { madeMeld = true; break; }
                    }
                }
            }
            if (madeMeld) continue; 

            // 2. Regular Melds
            let aggression = isPanicMode ? 1.0 : this.dna.MELD_AGGRESSION;
            const myScore = (this.seat % 2 === 0) ? game.cumulativeScores.team1 : game.cumulativeScores.team2;
            const enemyScore = (this.seat % 2 === 0) ? game.cumulativeScores.team2 : game.cumulativeScores.team1;
            
            if (myScore > enemyScore + 1000) aggression += this.dna.MELD_IF_WINNING_BONUS; 
            else if (enemyScore > myScore + 1000) aggression += this.dna.MELD_IF_LOSING_BONUS;

            if (Math.random() > aggression) return; 

            for (let rank in groups) {
                if (groups[rank].length >= 3) {
                    let res = game.meldCards(this.seat, groups[rank], rank);
                    if (res.success) { madeMeld = true; break; }
                }
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

        let enemyCanastaCount = 0;
        for (let rank in enemyMelds) if (enemyMelds[rank].length >= 7) enemyCanastaCount++;
        let isEndGame = (enemyCanastaCount >= 2);

        let candidates = hand.map((card, index) => {
            let score = 0;
            score += this.getCardValue(card) * 2;
            if (card.isWild) score += this.dna.DISCARD_WILD_PENALTY;
            if (card.isRed3) score += 99999; 

            if (enemyMelds[card.rank]) {
                if (isEndGame || pileValue > 300) score += (this.dna.FEED_ENEMY_MELD * 5); 
                else score += this.dna.FEED_ENEMY_MELD;
            }

            let matches = hand.filter(c => c.rank === card.rank).length;
            if (matches >= 2) {
                if (pileValue > 200) score += (this.dna.BREAK_PAIR_PENALTY * 3);
                else score += this.dna.BREAK_PAIR_PENALTY;
            }

            if (["4","5","6","7"].includes(card.rank)) score += this.dna.DISCARD_JUNK_BONUS;
            return { index, score, card };
        });

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