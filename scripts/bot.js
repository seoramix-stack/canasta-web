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
    const defaultDna = this.getDefaultFallbackDna(this.type, this.ruleset);

    if (injectedDna) {
        // Use training DNA if provided directly (for the training scripts)
        this.dna = { ...defaultDna, ...injectedDna };
    } else {
        const dnaKey = `${this.type}-${this.ruleset}`; // e.g., "2p-easy"
        
        if (masterDna && masterDna[dnaKey]) {
            // Use the professional DNA learned from 5,000 generations
            this.dna = { ...defaultDna, ...masterDna[dnaKey] };
        } else {
            // FALLBACK: Use your original hardcoded defaults if file is missing
            this.dna = defaultDna;
        }
    }
}

getDefaultFallbackDna(type, ruleset) {
        // Added PICKUP_PATIENCE to defaults
        if (type === '2p') {
            return ruleset === 'easy' ?
                { DISCARD_WILD_PENALTY: 500, FEED_ENEMY_MELD: 1000, DISCARD_SINGLE_BONUS: 50, MELD_AGGRESSION: 1.0, PICKUP_THRESHOLD: 1, BREAK_PAIR_PENALTY: 50, DISCARD_JUNK_BONUS: 20, GO_OUT_THRESHOLD: 0, BAIT_AGGRESSION: 50, PICKUP_PATIENCE: 4, BLACK_3_BONUS: -1000 } :
                { DISCARD_WILD_PENALTY: 1732, FEED_ENEMY_MELD: 2071, DISCARD_SINGLE_BONUS: -93, MELD_AGGRESSION: 0.8, PICKUP_THRESHOLD: 2, BREAK_PAIR_PENALTY: 200, DISCARD_JUNK_BONUS: 10, GO_OUT_THRESHOLD: 0, BAIT_AGGRESSION: 150, PICKUP_PATIENCE: 6, BLACK_3_BONUS: -2000 };
        } else {
            return ruleset === 'easy' ?
                { DISCARD_WILD_PENALTY: 500, FEED_ENEMY_MELD: 1000, DISCARD_SINGLE_BONUS: 50, MELD_AGGRESSION: 1.0, PICKUP_THRESHOLD: 1, BREAK_PAIR_PENALTY: 50, DISCARD_JUNK_BONUS: 20, GO_OUT_THRESHOLD: 1000, BAIT_AGGRESSION: 50, PICKUP_PATIENCE: 4, BLACK_3_BONUS: -1000 } :
                { DISCARD_WILD_PENALTY: 1732, FEED_ENEMY_MELD: 3012, DISCARD_SINGLE_BONUS: -93, MELD_AGGRESSION: 0.7, PICKUP_THRESHOLD: 2, BREAK_PAIR_PENALTY: 200, DISCARD_JUNK_BONUS: 10, GO_OUT_THRESHOLD: 500, BAIT_AGGRESSION: 150, PICKUP_PATIENCE: 7, BLACK_3_BONUS: -2000 };
        }
    }
getCardValue(card) {
        if (!card) return 0;
        const rank = card.rank;
        if (rank === 'Joker') return 50;
        if (rank === '2' || rank === 'A') return 20;
        if (['K', 'Q', 'J', '10', '9', '8'].includes(rank)) return 10;
        if (['7', '6', '5', '4', '3'].includes(rank)) return 5;
        return 0;
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

    async decideDraw(game) {
        const canPickUp = game.canPickupDiscardPile(this.seat);
        
        // If the pile is locked or we can't pick it up, just draw from deck
        if (!canPickUp) {
            game.drawFromDeck(this.seat);
            return;
        }

        // Simulation-driven decision
        const SIMS = 15;
        let deckWins = 0;
        let pileWins = 0;
        const myTeam = (this.seat % 2 === 0) ? 'team1' : 'team2';

        for (let s = 0; s < SIMS; s++) {
            // Scenario A: Draw from Deck
            const deckSim = game.clone();
            this.randomizeUnknownCards(deckSim);
            deckSim.drawFromDeck(this.seat);
            if (this.runFastSimulation(deckSim) === myTeam) deckWins++;

            // Scenario B: Take Pile
            const pileSim = game.clone();
            this.randomizeUnknownCards(pileSim);
            pileSim.pickupDiscardPile(this.seat);
            if (this.runFastSimulation(pileSim) === myTeam) pileWins++;
        }

        // Pick the pile if simulations show it's better or equal (given pile value)
        if (pileWins >= deckWins) {
            game.pickupDiscardPile(this.seat);
        } else {
            game.drawFromDeck(this.seat);
        }
    }
    
    async executeTurn(game) {
        this.updateMemory(game);

        if (game.turnPhase === "draw") {
            await this.decideDraw(game); 
            // Phase usually changes to 'playing' automatically after draw
        } 
        
        if (game.turnPhase === "playing") {
            const shouldMeld = this.simulateMeldDecision(game);
            if (shouldMeld) {
                await this.tryMelding(game); 
            }

            const discardIdx = await this.pickDiscard(game);
            game.discardFromHand(this.seat, discardIdx);
        }

        // CRITICAL: Update memory for the next turn
        this.saveStateSnapshot(game);
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
randomizeUnknownCards(simGame) {
    // 1. Collect all cards that SHOULD be hidden
    let hiddenCards = [...simGame.deck];
    for (let i = 0; i < simGame.config.PLAYER_COUNT; i++) {
        if (i !== this.seat) {
            hiddenCards.push(...simGame.players[i]);
            simGame.players[i] = []; 
        }
    }

    // 2. Shuffle the unknown cards
    for (let i = hiddenCards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [hiddenCards[i], hiddenCards[j]] = [hiddenCards[j], hiddenCards[i]];
    }

    // 3. Redistribute them based on recorded hand sizes
    for (let i = 0; i < simGame.config.PLAYER_COUNT; i++) {
        if (i !== this.seat) {
            const originalSize = this.memory.playersLastHandSize[i] || 11;
            simGame.players[i] = hiddenCards.splice(0, originalSize);
        }
    }
    simGame.deck = hiddenCards; 
}

simulateMeldDecision(game) {
    const SIMS = 20;
    let holdWins = 0;
    let meldWins = 0;
    const myTeam = (this.seat % 2 === 0) ? 'team1' : 'team2';

    for (let s = 0; s < SIMS; s++) {
        // Scenario A: Hold cards (Skip melding this turn)
        const holdSim = game.clone();
        this.randomizeUnknownCards(holdSim);
        // We skip fastMeldAll and go straight to a random discard simulation
        if (this.runFastSimulation(holdSim) === myTeam) holdWins++;

        // Scenario B: Meld cards
        const meldSim = game.clone();
        this.randomizeUnknownCards(meldSim);
        this.fastMeldAll(meldSim, this.seat);
        if (this.runFastSimulation(meldSim) === myTeam) meldWins++;
    }

    console.log(`Meld Decision -> Meld: ${meldWins} vs Hold: ${holdWins}`);
    return meldWins >= holdWins;
}

runFastSimulation(simGame) {
    const MAX_TURNS = 60; 
    let turns = 0;

    while (simGame.turnPhase !== "game_over" && turns < MAX_TURNS) {
        const activeSeat = simGame.currentPlayer;
        
        if (simGame.turnPhase === "draw") {
            simGame.drawFromDeck(activeSeat);
        } else if (simGame.turnPhase === "playing") {
            this.fastMeldAll(simGame, activeSeat);
            
            // Smarter Discard for simulation: 
            // Try to discard the lowest value non-wild card first
            let hand = simGame.players[activeSeat];
            let bestDiscardIdx = 0;
            for(let i=0; i<hand.length; i++) {
                if (!hand[i].isWild) {
                    bestDiscardIdx = i;
                    break;
                }
            }
            simGame.discardFromHand(activeSeat, bestDiscardIdx); 
        }
        turns++;
    }
    
    const scores = simGame.calculateScores();
    return (scores.team1.total > scores.team2.total) ? 'team1' : 'team2';
}

fastMeldAll(simGame, seat) {
    const myMelds = (seat % 2 === 0) ? simGame.team1Melds : simGame.team2Melds;
    
    // --- NEW: Simulation Opening Check ---
    if (Object.keys(myMelds).length === 0) {
        const opened = this.attemptOpening(simGame, seat);
        if (!opened) return; 
    }

    let hand = simGame.players[seat];
    let groups = {};

    // 1. Group cards by rank (ignoring Wilds for now to keep it simple/fast)
    hand.forEach((c) => {
        if (!c.isWild) {
            if (!groups[c.rank]) groups[c.rank] = [];
            groups[c.rank].push(c);
        }
    });
    
    for (let rank in groups) {
        // We must re-find the indices every time because simGame.meldCards 
        // splices the hand, changing where every other card is located.
        const getFreshIndices = (targetRank) => {
            return simGame.players[seat]
                .map((card, index) => (card.rank === targetRank && !card.isWild ? index : -1))
                .filter(idx => idx !== -1);
        };

        if (myMelds[rank]) {
            // Add any matching cards to existing meld
            let indices = getFreshIndices(rank);
            if (indices.length > 0) simGame.meldCards(seat, indices, rank);
        } else if (groups[rank].length >= 3) {
            // Start a new natural meld
            let indices = getFreshIndices(rank);
            if (indices.length >= 3) simGame.meldCards(seat, indices, rank);
        }
    }
}

    updateDna(newDna) {
        this.dna = { ...this.dna, ...newDna };
    }

    
    // --- DECISION LOGIC ---

    pickDiscard(game) {
    let hand = game.players[this.seat];
    let candidates = [];
    const teamMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
    const enemyMelds = (this.seat % 2 === 0) ? game.team2Melds : game.team1Melds;

    for (let i = 0; i < hand.length; i++) {
        const card = hand[i];
        let wins = 0;
        const SIMULATIONS = 30; 

        // --- A. CALCULATE HEURISTIC PENALTY (DNA) ---
        let penalty = 0;

        // Penalty for discarding Wilds
        if (card.isWild) {
            // Only discard wild if the pile is huge (worth freezing)
            if (game.discardPile.length < 5) {
                penalty += this.dna.DISCARD_WILD_PENALTY;
            } else {
                penalty += (this.dna.DISCARD_WILD_PENALTY / 2); // Lesser penalty if freezing a big pile
            }
        }

        // Penalty for feeding enemy melds
        if (enemyMelds[card.rank]) {
            penalty += this.dna.FEED_ENEMY_MELD;
        }

        // Penalty for breaking pairs in hand
        const rankCount = hand.filter(c => c.rank === card.rank).length;
        if (rankCount >= 2 && !card.isWild) {
            penalty += this.dna.BREAK_PAIR_PENALTY;
        }

        // --- B. RUN SIMULATIONS ---
        for (let s = 0; s < SIMULATIONS; s++) {
            const simGame = game.clone();
            this.randomizeUnknownCards(simGame);

            const moveResult = simGame.discardFromHand(this.seat, i);
            if (!moveResult.success) {
                wins = -999; // Illegal move
                break;
            }

            const winner = this.runFastSimulation(simGame);
            const myTeam = (this.seat % 2 === 0) ? 'team1' : 'team2';
            if (winner === myTeam) wins++;
        }

        // --- C. COMBINE WIN RATE + DNA ---
        const winRate = wins / SIMULATIONS;
        const finalScore = (winRate * 1000) - penalty;

        candidates.push({ 
            index: i, 
            score: finalScore, 
            winRate: winRate,
            card: card 
        });
    }

    // Sort by the new hybrid score
    candidates.sort((a, b) => b.score - a.score);
    
    const choice = candidates[0];
    if (!this.silentMode) {
        console.log(`Bot ${this.seat} discarding ${choice.card.rank}. WinRate: ${choice.winRate.toFixed(2)}, Final Score: ${choice.score.toFixed(0)}`);
    }
    return choice.index;
}
    attemptOpening(game, seat) {
    let hand = game.players[seat];
    let groups = {};
    let wildCards = [];

    hand.forEach((c, i) => {
        if (c.isWild) wildCards.push(i);
        else {
            if (!groups[c.rank]) groups[c.rank] = [];
            groups[c.rank].push(i);
        }
    });

    let potentialMelds = [];
    let currentPoints = 0;

    // 1. Find natural sets of 3+ (Exclude 3s for opening)
    for (let rank in groups) {
        if (rank !== "3" && groups[rank].length >= 3) {
            potentialMelds.push({ rank: rank, indices: [...groups[rank]] });
            // Use this.getCardValue(hand[index]) to avoid ReferenceError
            currentPoints += groups[rank].reduce((sum, idx) => sum + this.getCardValue(hand[idx]), 0);
        }
    }

    let teamScore = (seat % 2 === 0) ? game.cumulativeScores.team1 : game.cumulativeScores.team2;
    let req = game.getOpeningReq(teamScore);

    // 2. Use Wild Cards to reach requirement if needed
    if (currentPoints < req) {
        for (let rank in groups) {
            if (rank !== "3" && groups[rank].length === 2 && wildCards.length > 0) {
                let wildIdx = wildCards.pop();
                potentialMelds.push({ rank: rank, indices: [...groups[rank], wildIdx] });
                currentPoints += (2 * this.getCardValue(hand[groups[rank][0]])) + this.getCardValue(hand[wildIdx]);
                if (currentPoints >= req) break;
            }
        }
    }

    if (currentPoints >= req && potentialMelds.length > 0) {
        return game.processOpening(seat, potentialMelds, false).success;
    }
    return false;
}

    tryMelding(game) {
    const myMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
    
    if (Object.keys(myMelds).length === 0) {
        const opened = this.attemptOpening(game, this.seat);
        if (!opened) return; // Stop if we can't open yet
    }

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

        // Simplified Priority 1: Always add to existing melds
        for (let rank in myMelds) {
            if (groups[rank] && groups[rank].length > 0) {
                // Safety: Ensure we don't float illegally (leave at least 2 cards if no canastas)
                const canastaCount = Object.values(myMelds).filter(p => p.length >= 7).length;
                if (canastaCount < game.config.MIN_CANASTAS_OUT && hand.length - groups[rank].length < 2) continue;

                let res = game.meldCards(this.seat, groups[rank], rank);
                if (res.success) { madeMeld = true; break; }
            }
        }
        if (madeMeld) continue;

        // Simplified Priority 2: Create new melds
        for (let rank in groups) {
            let cardsToPlay = [...groups[rank]];
            const canastaCount = Object.values(myMelds).filter(p => p.length >= 7).length;
            
            if (canastaCount < game.config.MIN_CANASTAS_OUT && hand.length - cardsToPlay.length < 2) continue;

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
        return (canastaCount >= game.config.MIN_CANASTAS_OUT);
    }
}

module.exports = { CanastaBot };