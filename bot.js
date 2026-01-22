// bot.js - v7.1: Memory, Multi-Mode & 4 Distinct Strategies
const fs = require('fs');
const path = require('path');

// Safe loading of production DNA
let PRODUCTION_DNA = null;
const dnaPath = path.join(__dirname, 'production-dna.json');
if (fs.existsSync(dnaPath)) {
    PRODUCTION_DNA = JSON.parse(fs.readFileSync(dnaPath, 'utf8'));
}

class CanastaBot {
    constructor(seat, difficulty, type = '4p', ruleset = 'standard', injectedDna = null) {
    this.seat = seat;
    this.difficulty = difficulty;
    this.type = type;       // '2p' or '4p'
    this.ruleset = ruleset; // 'standard' or 'easy'
    this.turboMode = false;

    // --- 1. MEMORY SYSTEM INITIALIZATION ---
    this.memory = {
        initialized: false,
        lastDiscardPile: [],
        knownHands: {},
        playersLastHandSize: {}
    };

    // --- 2. LOAD EXTERNAL DNA (If available) ---
    let masterDna = null;
    try {
        // Attempt to load the merged DNA file created by your training
        const dnaPath = path.join(__dirname, 'production-dna.json');
        if (fs.existsSync(dnaPath)) {
            masterDna = JSON.parse(fs.readFileSync(dnaPath, 'utf8'));
        }
    } catch (e) {
        console.log("No production-dna.json found, using hardcoded defaults.");
    }

    // --- 3. SELECTION LOGIC ---
    if (injectedDna) {
        // Use training DNA if provided directly (for the training scripts)
        this.dna = injectedDna;
    } else {
        const dnaKey = `${this.type}-${this.ruleset}`; // e.g., "2p-easy"
        
        if (masterDna && masterDna[dnaKey]) {
            // Use the professional DNA learned from 5,000 generations
            this.dna = masterDna[dnaKey];
        } else {
            // FALLBACK: Use your original hardcoded defaults if file is missing
            this.dna = this.getDefaultFallbackDna(this.type, this.ruleset);
        }
    }
}

// Helper to keep the constructor clean
getDefaultFallbackDna(type, ruleset) {
    if (type === '2p') {
        return ruleset === 'easy' ? 
            { DISCARD_WILD_PENALTY: 500, FEED_ENEMY_MELD: 1000, DISCARD_SINGLE_BONUS: 50, MELD_AGGRESSION: 1.2, PICKUP_THRESHOLD: 1, BREAK_PAIR_PENALTY: 50, DISCARD_JUNK_BONUS: 20, GO_OUT_THRESHOLD: 0 } :
            { DISCARD_WILD_PENALTY: 1732, FEED_ENEMY_MELD: 2071, DISCARD_SINGLE_BONUS: -93, MELD_AGGRESSION: 0.91, PICKUP_THRESHOLD: 2, BREAK_PAIR_PENALTY: 200, DISCARD_JUNK_BONUS: 10, GO_OUT_THRESHOLD: 0 };
    } else {
        return ruleset === 'easy' ?
            { DISCARD_WILD_PENALTY: 500, FEED_ENEMY_MELD: 1000, DISCARD_SINGLE_BONUS: 50, MELD_AGGRESSION: 1.2, PICKUP_THRESHOLD: 1, BREAK_PAIR_PENALTY: 50, DISCARD_JUNK_BONUS: 20, GO_OUT_THRESHOLD: 1000 } :
            { DISCARD_WILD_PENALTY: 1732, FEED_ENEMY_MELD: 3012, DISCARD_SINGLE_BONUS: -93, MELD_AGGRESSION: 0.84, PICKUP_THRESHOLD: 2, BREAK_PAIR_PENALTY: 200, DISCARD_JUNK_BONUS: 10, GO_OUT_THRESHOLD: 500 };
    }
}

    // --- MAIN GAME LOOP ---
    async executeTurn(game, callback) {
        try {
            this.updateMemory(game); 
            const wait = (ms) => this.turboMode ? Promise.resolve() : new Promise(r => setTimeout(r, ms));
            // Phase 1: Draw
            await wait(1200); 
            this.decideDraw(game);
            if (callback) callback(this.seat);

            // Phase 2: Partner Check (Fixed to prevent -100 penalty)
            await wait(800);
            this.handlePartnerCommunication(game);

            // Phase 3: Meld (Fixed to prevent illegal 15pt melds)
            await wait(1500);
            this.tryMelding(game);
            if (callback) callback(this.seat);

            // Phase 4: Discard
            const hand = game.players[this.seat];
            if (hand.length > 0 && game.turnPhase === 'playing') {
                await wait(1200);
                let discardIndex = this.pickDiscard(game);
                let res = game.discardFromHand(this.seat, discardIndex);
                
                // CRITICAL: If discard fails, the bot MUST draw next turn or the simulation hangs
                if (!res.success && this.turboMode) {
                    console.warn(`[SIM] Seat ${this.seat} failed discard: ${res.message}. Forcing turn end.`);
                    game.turnPhase = 'draw';
                    game.currentPlayer = (game.currentPlayer + 1) % game.config.PLAYER_COUNT;
                }
            }

            this.saveStateSnapshot(game);
            if (callback) callback(this.seat);

        } catch (error) {
            console.error(`[BOT ERROR] Seat ${this.seat}:`, error);
        }
    }

    // This is the helper that handles 2P vs 4P logic
    handlePartnerCommunication(game) {
    if (game.config.PLAYER_COUNT === 4) {
        const hand = game.players[this.seat];
        const teamMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
        const canastaCount = Object.values(teamMelds).filter(p => p.length >= 7).length;

        // ONLY ask if the bot is actually capable of going out (1 card left)
        // AND already has the required Canastas.
        if (hand.length <= 1 && canastaCount >= game.config.MIN_CANASTAS_OUT) {
            const partnerSeat = (this.seat + 2) % 4;
            const partnerHand = game.players[partnerSeat];
            const partnerHandPoints = partnerHand.reduce((sum, c) => sum + this.getCardValue(c), 0);
            
            game.goOutPermission = (partnerHandPoints > this.dna.GO_OUT_THRESHOLD) ? 'denied' : 'granted';
        } else {
            // If not trying to go out, reset permission to null to avoid penalties
            game.goOutPermission = null;
        }
    } else {
        game.goOutPermission = null; 
    }
}

    // --- MEMORY SYSTEM LOGIC ---

    updateMemory(game) {
        if (!this.memory.initialized || (game.discardPile.length === 0 && this.memory.lastDiscardPile.length === 0)) {
            this.resetMemory(game);
            return;
        }

        // A. Detect Pickups
        const currentPile = game.discardPile;
        const lastPile = this.memory.lastDiscardPile;

        if (currentPile.length < lastPile.length) {
            // Someone picked up the pile!
            const pickedUpCards = [...lastPile];
            let pickerSeat = -1;

            if (game.config.PLAYER_COUNT === 2) {
                pickerSeat = (this.seat + 1) % 2;
            } else {
                // Guess who picked up based on hand size growth
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

        // B. Cleanup Memory (Remove cards played/discarded by enemies)
        for (let pIndex = 0; pIndex < game.config.PLAYER_COUNT; pIndex++) {
            if (pIndex === this.seat) continue;
            if (!this.memory.knownHands[pIndex]) continue;

            const enemyMelds = (pIndex % 2 === 0) ? game.team1Melds : game.team2Melds;

            // 1. Remove Melded Cards
            this.memory.knownHands[pIndex] = this.memory.knownHands[pIndex].filter(knownCard => {
                const meld = enemyMelds[knownCard.rank];
                if (!meld) return true; // Not melded yet
                // Simple heuristic: If meld exists, assume known card was used
                return false; 
            });

            // 2. Remove Discarded Card
            if (game.discardPile.length > 0) {
                 const topCard = game.discardPile[game.discardPile.length - 1];
                 // If previous player was this opponent
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

            // --- STANDARD LOGIC ---
            if (enemyMelds[card.rank]) {
                if (isEndGame || pileValue > 300) score += (this.dna.FEED_ENEMY_MELD * 5); 
                else score += this.dna.FEED_ENEMY_MELD;
            }

            // --- MEMORY LOGIC ---
            // "Do I know for a fact the next player has this card?"
            const knownHand = this.memory.knownHands[nextPlayerSeat] || [];
            const enemyHasPair = knownHand.filter(c => c.rank === card.rank).length >= 2;
            const enemyHasSingle = knownHand.filter(c => c.rank === card.rank).length >= 1;

            if (enemyHasPair) {
                // They have a pair, this gives them a clean canasta/meld!
                score += (this.dna.FEED_ENEMY_MELD * 2.5);
            } else if (enemyHasSingle) {
                // They have one, this gives them a pair (allowing them to pick up).
                score += (this.dna.FEED_ENEMY_MELD * 0.8);
            }

            // --- SELF LOGIC ---
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
        const myTeamKey = (this.seat % 2 === 0) ? 'team1' : 'team2';
        const myScore = game.cumulativeScores[myTeamKey];
        const myMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
        const isOpening = (Object.keys(myMelds).length === 0);

        // --- 1. OPENING REQUIREMENT CHECK (With Wilds) ---
        if (isOpening) {
            const requiredPoints = game.getOpeningReq(myScore);
            let totalOpeningPoints = 0;
            let hand = [...game.players[this.seat]];
            
            let naturalGroups = {};
            let wilds = [];
            hand.forEach(c => { 
                if(!c.isWild) {
                    naturalGroups[c.rank] = (naturalGroups[c.rank] || 0) + 1; 
                } else {
                    wilds.push(c);
                }
            });
            
            // Calculate points from valid potential melds
            for (let r in naturalGroups) {
                let count = naturalGroups[r];
                // Case A: Natural set of 3+
                if (count >= 3) {
                    totalOpeningPoints += count * this.getCardValue({rank: r});
                } 
                // Case B: Natural pair + 1 Wild (minimum 3 cards)
                else if (count === 2 && wilds.length >= 1) {
                    totalOpeningPoints += (2 * this.getCardValue({rank: r})) + this.getCardValue(wilds[0]);
                    wilds.shift(); // Use this wild card
                }
            }

            // If we don't have 50+ points total, STOP.
            if (totalOpeningPoints < requiredPoints) return;
        }

        // --- 2. MAIN MELDING LOOP ---
        let madeMeld = true;
        while (madeMeld) {
            madeMeld = false;
            let hand = game.players[this.seat]; 
            let groups = {};
            let wildIndices = [];

            hand.forEach((c, i) => {
                if (c.isWild) wildIndices.push(i);
                else {
                    if (!groups[c.rank]) groups[c.rank] = [];
                    groups[c.rank].push(i);
                }
            });

            // Priority 1: Add to existing melds
            for (let rank in myMelds) {
                if (groups[rank] && groups[rank].length > 0) {
                    let cardsToPlay = groups[rank];
                    let currentHand = game.players[this.seat];
                    const canastaCount = Object.values(myMelds).filter(p => p.length >= 7).length;

                    // SAFETY: Do not meld down to 1 card if we can't legally discard it
                    if (canastaCount < game.config.MIN_CANASTAS_OUT && (currentHand.length - cardsToPlay.length === 1)) {
                        continue; 
                    }

                    let res = game.meldCards(this.seat, groups[rank], rank);
                    if (res.success) { madeMeld = true; break; }
                }
            }
            if (madeMeld) continue;

            // Priority 2: Create new melds (3+ cards, allows mixing)
            for (let rank in groups) {
                let cardsToPlay = [...groups[rank]];
                let currentHand = game.players[this.seat];
                const teamMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
                const canastaCount = Object.values(teamMelds).filter(p => p.length >= 7).length;

                if (canastaCount < game.config.MIN_CANASTAS_OUT && (currentHand.length - cardsToPlay.length === 1)) {
                continue; // Skip this meld to stay at 2+ cards
                }
                // If it's just a pair, try to use a wild card to make it a meld
                if (cardsToPlay.length === 2 && wildIndices.length >= 1) {
                    cardsToPlay.push(wildIndices[0]);
                }

                if (cardsToPlay.length >= 3) {
                    let res = game.meldCards(this.seat, cardsToPlay, rank);
                    if (res.success) { madeMeld = true; break; }
                }
            }
        }
    }

    getCardValue(card) {
        if (card.rank === "Joker") return 50;
        if (card.rank === "2" || card.rank === "A") return 20;
        if (["8","9","10","J","Q","K"].includes(card.rank)) return 10;
        return 5; 
    }
}

module.exports = { CanastaBot };