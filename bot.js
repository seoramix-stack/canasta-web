// bot.js - v7.2: Fixed 'executeTurn' Compatibility
class CanastaBot {
    constructor(seat, difficulty, type = '4p', ruleset = 'standard', injectedDna = null) {
        this.seat = seat;
        this.difficulty = difficulty;
        this.type = type;       // '2p' or '4p'
        this.ruleset = ruleset; // 'standard' or 'easy'

        // --- MEMORY SYSTEM INITIALIZATION ---
        this.memory = {
            initialized: false,
            lastDiscardPile: [],      // Snapshot of pile from previous turn
            knownHands: {},           // Maps seatIndex -> Array of Card objects
            playersLastHandSize: {}   // To help detect who picked up in 4P
        };

        // --- STRATEGY DEFINITIONS (DNA) ---
        
        // 1. 2-Player Standard
        const DNA_2P_STD = {
            DISCARD_WILD_PENALTY: 1732,
            FEED_ENEMY_MELD: 2071,
            DISCARD_SINGLE_BONUS: -93,
            MELD_AGGRESSION: 0.91,
            PICKUP_THRESHOLD: 2,
            MELD_IF_WINNING_BONUS: 0.05,
            MELD_IF_LOSING_BONUS: -0.19,
            BREAK_PAIR_PENALTY: 200,
            DISCARD_JUNK_BONUS: 10,
            GO_OUT_THRESHOLD: 0 
        };

        // 2. 4-Player Standard 
        const DNA_4P_STD = { 
            DISCARD_WILD_PENALTY: 1732,
            FEED_ENEMY_MELD: 3012,
            DISCARD_SINGLE_BONUS: -93,
            MELD_AGGRESSION: 0.84,
            PICKUP_THRESHOLD: 2,
            MELD_IF_WINNING_BONUS: 0.05,
            MELD_IF_LOSING_BONUS: -0.19,
            BREAK_PAIR_PENALTY: 200,
            DISCARD_JUNK_BONUS: 10,
            GO_OUT_THRESHOLD: 500 
        };

        // 3. 2-Player Easy 
        const DNA_2P_EASY = {
            DISCARD_WILD_PENALTY: 500,
            FEED_ENEMY_MELD: 1000,
            DISCARD_SINGLE_BONUS: 50,
            MELD_AGGRESSION: 1.2,       
            PICKUP_THRESHOLD: 1,        
            MELD_IF_WINNING_BONUS: 0,
            MELD_IF_LOSING_BONUS: 0,
            BREAK_PAIR_PENALTY: 50,
            DISCARD_JUNK_BONUS: 20,
            GO_OUT_THRESHOLD: 0         
        };

        // 4. 4-Player Easy 
        const DNA_4P_EASY = {
            DISCARD_WILD_PENALTY: 500,
            FEED_ENEMY_MELD: 1000,
            DISCARD_SINGLE_BONUS: 50,
            MELD_AGGRESSION: 1.2,
            PICKUP_THRESHOLD: 1,
            MELD_IF_WINNING_BONUS: 0,
            MELD_IF_LOSING_BONUS: 0,
            BREAK_PAIR_PENALTY: 50,
            DISCARD_JUNK_BONUS: 20,
            GO_OUT_THRESHOLD: 1000      
        };

        // --- SELECT DNA ---
        if (injectedDna) {
            this.dna = injectedDna;
        } else {
            if (type === '2p') {
                if (ruleset === 'easy') this.dna = DNA_2P_EASY;
                else this.dna = DNA_2P_STD;
            } else {
                if (ruleset === 'easy') this.dna = DNA_4P_EASY;
                else this.dna = DNA_4P_STD;
            }
        }
    }

    // --- CRITICAL FIX: The Interface Server.js Expects ---
    async executeTurn(game, callback) {
        // 1. Run the synchronous logic
        this.playTurnSync(game);

        // 2. Trigger the callback (server uses this to broadcast updates)
        if (callback) callback(this.seat);

        // 3. Return true (Promise) to satisfy the .then() in server.js
        return true;
    }

    // --- MAIN LOGIC ---
    playTurnSync(game) { 
        this.updateMemory(game);
        this.decideDraw(game);

        if (game.config.PLAYER_COUNT === 4) {
            const partnerSeat = (this.seat + 2) % 4;
            const partnerHand = game.players[partnerSeat];
            const partnerHandPoints = partnerHand.reduce((sum, c) => sum + this.getCardValue(c), 0);
            game.goOutPermission = (partnerHandPoints > this.dna.GO_OUT_THRESHOLD) ? 'denied' : 'granted';
        } else {
            game.goOutPermission = 'granted'; 
        }
        
        this.tryMelding(game);
        
        if (game.players[this.seat].length > 0) {
            let discardIndex = this.pickDiscard(game);
            game.discardFromHand(this.seat, discardIndex);
        }

        this.saveStateSnapshot(game);
    }

    // --- MEMORY SYSTEM LOGIC ---
    updateMemory(game) {
        if (!this.memory.initialized || (game.discardPile.length === 0 && this.memory.lastDiscardPile.length === 0)) {
            this.resetMemory(game);
            return;
        }

        const currentPile = game.discardPile;
        const lastPile = this.memory.lastDiscardPile;

        if (currentPile.length < lastPile.length) {
            const pickedUpCards = [...lastPile];
            let pickerSeat = -1;

            if (game.config.PLAYER_COUNT === 2) {
                pickerSeat = (this.seat + 1) % 2;
            } else {
                let maxGrowth = -999;
                for (let i = 0; i < game.config.PLAYER_COUNT; i++) {
                    if (i === this.seat) continue;
                    const growth = game.players[i].length - (this.memory.playersLastHandSize[i] || 0);
                    if (growth > maxGrowth) {
                        maxGrowth = growth;
                        pickerSeat = i;
                    }
                }
            }

            if (pickerSeat !== -1) {
                if (!this.memory.knownHands[pickerSeat]) this.memory.knownHands[pickerSeat] = [];
                this.memory.knownHands[pickerSeat].push(...pickedUpCards);
            }
        }

        for (let pIndex = 0; pIndex < game.config.PLAYER_COUNT; pIndex++) {
            if (pIndex === this.seat) continue;
            if (!this.memory.knownHands[pIndex]) continue;

            const enemyMelds = (pIndex % 2 === 0) ? game.team1Melds : game.team2Melds;

            this.memory.knownHands[pIndex] = this.memory.knownHands[pIndex].filter(knownCard => {
                const meld = enemyMelds[knownCard.rank];
                if (!meld) return true; 
                return false; 
            });

            if (game.discardPile.length > 0) {
                 const topCard = game.discardPile[game.discardPile.length - 1];
                 let prevPlayer = (this.seat - 1 + game.config.PLAYER_COUNT) % game.config.PLAYER_COUNT;
                 if (pIndex === prevPlayer) {
                     const matchIdx = this.memory.knownHands[pIndex].findIndex(c => c.rank === topCard.rank);
                     if (matchIdx !== -1) this.memory.knownHands[pIndex].splice(matchIdx, 1);
                 }
            }
        }
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

    // --- DECISION LOGIC ---

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

            const knownHand = this.memory.knownHands[nextPlayerSeat] || [];
            const enemyHasPair = knownHand.filter(c => c.rank === card.rank).length >= 2;
            const enemyHasSingle = knownHand.filter(c => c.rank === card.rank).length >= 1;

            if (enemyHasPair) {
                score += (this.dna.FEED_ENEMY_MELD * 2.5);
            } else if (enemyHasSingle) {
                score += (this.dna.FEED_ENEMY_MELD * 0.8);
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

        // SAFETY CHECK
        if (!candidates || candidates.length === 0) return 0;

        return candidates[0].index;
    }

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
    
    // Partner Communication simulation
    decideGoOutPermission(game) {
        // Logic: Should I let my partner go out?
        const partnerSeat = (this.seat + 2) % 4;
        const myHand = game.players[this.seat];
        const myPoints = myHand.reduce((sum, c) => sum + this.getCardValue(c), 0);
        
        // If I have too many points in hand, I might say NO.
        // But if I have very few, say YES.
        return (myPoints < this.dna.GO_OUT_THRESHOLD);
    }

    getCardValue(card) {
        if (card.rank === "Joker") return 50;
        if (card.rank === "2" || card.rank === "A") return 20;
        if (["8","9","10","J","Q","K"].includes(card.rank)) return 10;
        return 5; 
    }
}

module.exports = { CanastaBot };