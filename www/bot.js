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

getDefaultFallbackDna(type, ruleset) {
        // Added PICKUP_PATIENCE to defaults
        if (type === '2p') {
            return ruleset === 'easy' ? 
                { DISCARD_WILD_PENALTY: 500, FEED_ENEMY_MELD: 1000, DISCARD_SINGLE_BONUS: 50, MELD_AGGRESSION: 1.0, PICKUP_THRESHOLD: 1, BREAK_PAIR_PENALTY: 50, DISCARD_JUNK_BONUS: 20, GO_OUT_THRESHOLD: 0, BAIT_AGGRESSION: 50, PICKUP_PATIENCE: 4 } :
                { DISCARD_WILD_PENALTY: 1732, FEED_ENEMY_MELD: 2071, DISCARD_SINGLE_BONUS: -93, MELD_AGGRESSION: 0.8, PICKUP_THRESHOLD: 2, BREAK_PAIR_PENALTY: 200, DISCARD_JUNK_BONUS: 10, GO_OUT_THRESHOLD: 0, BAIT_AGGRESSION: 150, PICKUP_PATIENCE: 6 };
        } else {
            return ruleset === 'easy' ?
                { DISCARD_WILD_PENALTY: 500, FEED_ENEMY_MELD: 1000, DISCARD_SINGLE_BONUS: 50, MELD_AGGRESSION: 1.0, PICKUP_THRESHOLD: 1, BREAK_PAIR_PENALTY: 50, DISCARD_JUNK_BONUS: 20, GO_OUT_THRESHOLD: 1000, BAIT_AGGRESSION: 50, PICKUP_PATIENCE: 4 } :
                { DISCARD_WILD_PENALTY: 1732, FEED_ENEMY_MELD: 3012, DISCARD_SINGLE_BONUS: -93, MELD_AGGRESSION: 0.7, PICKUP_THRESHOLD: 2, BREAK_PAIR_PENALTY: 200, DISCARD_JUNK_BONUS: 10, GO_OUT_THRESHOLD: 500, BAIT_AGGRESSION: 150, PICKUP_PATIENCE: 7 };
        }
    }
evaluateSeatPileWorth(game, targetSeat) {
        if (game.discardPile.length === 0) return 0;

        let worth = 0;
        const isTeam1 = (targetSeat % 2 === 0);
        const teamMelds = isTeam1 ? game.team1Melds : game.team2Melds;
        
        // 1. Base Face Value
        worth += game.discardPile.reduce((sum, card) => sum + this.getCardValue(card), 0);

        // 2. Canasta Potential Simulation
        const pileRanks = {};
        game.discardPile.forEach(c => { pileRanks[c.rank] = (pileRanks[c.rank] || 0) + 1; });

        for (let rank in pileRanks) {
            const existingMeld = teamMelds[rank] || [];
            const newCount = existingMeld.length + pileRanks[rank];

            // If this pile completes a Canasta for the target seat
            if (newCount >= 7 && existingMeld.length < 7) {
                // Heuristic: Assume 300 for dirty unless pile is purely natural
                const hasWilds = game.discardPile.some(c => c.isWild) || existingMeld.some(c => c.isWild);
                worth += (hasWilds ? 300 : 500);
            }
        }
        return worth;
    }

    // --- MAIN GAME LOOP ---
    async executeTurn(game, callback) {
    try {
        this.updateMemory(game); 
        
        // 1. Pull the dynamic speed (Default to 500ms if not set)
        const baseSpeed = game.botDelayBase || 500; 
        const wait = (ms) => this.turboMode ? Promise.resolve() : new Promise(r => setTimeout(r, ms));

        // Phase 1: Draw
        await wait(baseSpeed); 
        this.decideDraw(game);
        if (callback) callback(this.seat);

        // Phase 2: Partner Check (Slightly faster pause)
        await wait(baseSpeed * 0.5);
        this.handlePartnerCommunication(game);

        // Phase 3: Meld (Wait a full baseSpeed unit)
        await wait(baseSpeed);
        this.tryMelding(game);
        if (callback) callback(this.seat);

        // Phase 4: Discard (Wait a full baseSpeed unit)
        const hand = game.players[this.seat];
        if (hand.length > 0 && game.turnPhase === 'playing') {
            await wait(baseSpeed); 
            let discardIndex = this.pickDiscard(game);
            game.discardFromHand(this.seat, discardIndex);
        }

        this.saveStateSnapshot(game);
        if (callback) callback(this.seat);
    } catch (error) {
        console.error(`[BOT ERROR]`, error);
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
        let nextPlayer = (this.seat + 1) % game.config.PLAYER_COUNT;
        const enemyMelds = (nextPlayer % 2 === 0) ? game.team1Melds : game.team2Melds;
        const myTeamMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;

        // --- NEW SAFETY GATE: Floating Prevention ---
        const canastaCount = Object.values(myTeamMelds).filter(p => p.length >= 7).length;
        const goingOutIsIllegal = canastaCount < game.config.MIN_CANASTAS_OUT;

        // --- NEW DUAL-VALUE CALCULATION ---
        const myWorth = this.evaluateSeatPileWorth(game, this.seat);
        const enemyWorth = this.evaluateSeatPileWorth(game, nextPlayer);

        let candidates = hand.map((card, index) => {
            let score = 0;

            // 1. FLOATING PENALTY: Never discard the last card if we can't go out
            if (hand.length === 1 && goingOutIsIllegal) {
                return { index, score: 999999, card }; // Block this card entirely
            }

            score += this.getCardValue(card) * 2;

            // 2. DYNAMIC WILD LOGIC (Defensive Freeze)
            if (card.isWild) {
                let threatLevel = enemyWorth / 400;
                score += (this.dna.DISCARD_WILD_PENALTY / Math.max(1, threatLevel));
            }

            // 3. DYNAMIC FEEDING LOGIC
            if (enemyMelds[card.rank]) {
                let juicyMultiplier = 1 + (enemyWorth / 200);
                score += (this.dna.FEED_ENEMY_MELD * juicyMultiplier);
            }

            // 4. MEMORY-BASED THREAT
            const knownHand = this.memory.knownHands[nextPlayer] || [];
            const enemyHasPair = knownHand.filter(c => c.rank === card.rank).length >= 2;
            if (enemyHasPair) {
                score += (this.dna.FEED_ENEMY_MELD * 3) + enemyWorth;
            }

            // 5. PHASE C: TRAP / BAIT LOGIC
            let rankCount = hand.filter(c => c.rank === card.rank && !c.isWild).length;
            if (rankCount >= 3 && !enemyMelds[card.rank] && !card.isWild) {
                if (!enemyHasPair) {
                    let baitBonus = this.dna.BAIT_AGGRESSION;
                    if (rankCount === 4) baitBonus *= 1.2;
                    score -= baitBonus;
                }
            }

            // 6. PAIR PRESERVATION
            let matches = hand.filter(c => c.rank === card.rank).length;
            if (matches >= 2) score += this.dna.BREAK_PAIR_PENALTY;
            if (["4", "5", "6", "7"].includes(card.rank)) score += this.dna.DISCARD_JUNK_BONUS;

            return { index, score, card };
        });

        candidates.sort((a, b) => a.score - b.score);
        return candidates[0].index;
    }

    decideDraw(game) {
        let pile = game.discardPile;
        let topCard = pile.length > 0 ? pile[pile.length - 1] : null;
        if (!topCard) { game.drawFromDeck(this.seat); return; }

        let hand = game.players[this.seat];
        let myTeamMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
        let canastas = Object.values(myTeamMelds).filter(p => p.length >= 7).length;

        // Legal check: Can we pick it up?
        let naturalMatches = hand.filter(c => c.rank === topCard.rank && !c.isWild).length;
        let canPickup = (naturalMatches >= 2); 

        if (canPickup) {
            // STABILITY FIX: Predict hand size after Red 3s are moved to table
            if (canastas < game.config.MIN_CANASTAS_OUT) {
                let red3sInPile = pile.filter(c => c.isRed3).length;
                // Predicted = Current + Pile - 2 (used for meld) - Red3s (auto-played)
                let predictedSize = hand.length + pile.length - 2 - red3sInPile;

                if (predictedSize <= 3) {
                    // Force a deck draw to avoid the 1-card trap
                    game.drawFromDeck(this.seat);
                    return;
                }
            }

            let myWorth = this.evaluateSeatPileWorth(game, this.seat);
            if (myWorth > 350 || naturalMatches >= this.dna.PICKUP_THRESHOLD) {
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

                    if (canastaCount < game.config.MIN_CANASTAS_OUT) {
                if (currentHand.length - cardsToPlay.length < 3) {
                    continue; 
                }
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

                if (canastaCount < game.config.MIN_CANASTAS_OUT) {
                if (currentHand.length - cardsToPlay.length < 3) {
                    continue; 
                }
                }
                if (cardsToPlay.length === 2 && wildIndices.length >= 1) {
                    // Only meld the pair + wild if our hand is getting too big 
                    // or if we have very low patience DNA.
                    if (hand.length > (this.dna.PICKUP_PATIENCE || 6)) continue; 
                    
                    cardsToPlay.push(wildIndices[0]);
                }

                if (cardsToPlay.length >= 3) {
                    let res = game.meldCards(this.seat, cardsToPlay, rank);
                    if (res.success) { madeMeld = true; break; }
                }
            }
        }
    }
    decideGoOutPermission(game) {
        // 1. Identify my team (Bot is the partner of the player asking)
        const teamMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
        
        // 2. Count our Canastas
        const canastaCount = Object.values(teamMelds).filter(p => p.length >= 7).length;

        // 3. LOGIC: If we met the requirement, say YES.
        // (You can add fancier logic here later, e.g., if bot has a Red 3 in hand, say NO)
        if (canastaCount >= game.config.MIN_CANASTAS_OUT) {
            return true; // "Yes, you can go out"
        } else {
            return false; // "No, we don't have enough Canastas"
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