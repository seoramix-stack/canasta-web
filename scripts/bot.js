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

runFastSimulation(simGame) {
    const MAX_TURNS = 100; // Prevent infinite loops
    let turns = 0;

    while (simGame.turnPhase !== "game_over" && turns < MAX_TURNS) {
        const activeSeat = simGame.currentPlayer;
        
        // Use a very simple version of your existing logic
        // If it's the bot's turn, it tests its move.
        // If it's an 'imaginary' opponent, they play randomly or use simple rules.
        
        if (simGame.turnPhase === "draw") {
            simGame.drawFromDeck(activeSeat);
        } else if (simGame.turnPhase === "playing") {
            // Simple: Meld everything possible, then discard a random card
            this.fastMeldAll(simGame, activeSeat);
            simGame.discardFromHand(activeSeat, 0); 
        }
        turns++;
    }
    
    // Return who won based on finalScores
    const scores = simGame.calculateScores();
    return (scores.team1.total > scores.team2.total) ? 'team1' : 'team2';
}

fastMeldAll(simGame, seat) {
    let hand = simGame.players[seat];
    let groups = {};

    // 1. Group cards by rank (ignoring Wilds for now to keep it simple/fast)
    hand.forEach((c) => {
        if (!c.isWild) {
            if (!groups[c.rank]) groups[c.rank] = [];
            groups[c.rank].push(c);
        }
    });

    const myMelds = (seat % 2 === 0) ? simGame.team1Melds : simGame.team2Melds;
    
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

    // Replace the contents of pickDiscard in bot.js
    pickDiscard(game) {
    let hand = game.players[this.seat];
    let candidates = [];

    // 1. Identify all legal discards
    for (let i = 0; i < hand.length; i++) {
        let wins = 0;
        const SIMULATIONS = 40; // Total simulations per card

        for (let s = 0; s < SIMULATIONS; s++) {
            // A. Create the "Hallucination"
            const simGame = game.clone();
            
            // B. Determinization: Since we don't know the deck/enemy hands, 
            // we shuffle all unknown cards and redistribute them.
            this.randomizeUnknownCards(simGame);

            // C. Test the move
            const moveResult = simGame.discardFromHand(this.seat, i);
            if (!moveResult.success) continue; // Skip illegal moves (like floating without Canastas)

            // D. Run a "Fast Play" until the end of the round
            const winner = this.runFastSimulation(simGame);
            
            // E. Record if our team won
            const myTeam = (this.seat % 2 === 0) ? 'team1' : 'team2';
            if (winner === myTeam) wins++;
        }

        candidates.push({ 
            index: i, 
            winRate: wins / SIMULATIONS, 
            card: hand[i] 
        });
    }

    // 2. Sort by highest win rate instead of lowest "penalty score"
    candidates.sort((a, b) => b.winRate - a.winRate);
    
    console.log(`Bot ${this.seat} chose ${candidates[0].card.rank} with predicted win rate: ${candidates[0].winRate}`);
    return candidates[0].index;
    }

    decideDraw(game) {
    const pile = game.discardPile;
    const topCard = pile.length > 0 ? pile[pile.length - 1] : null;

    // If no pile, we must draw from deck
    if (!topCard) { 
        game.drawFromDeck(this.seat); 
        return; 
    }

    // Check if pickup is even legal according to game rules
    const hand = game.players[this.seat];
    const naturalMatches = hand.filter(c => c.rank === topCard.rank && !c.isWild).length;
    const canPickup = (naturalMatches >= 2); 

    if (!canPickup) {
        game.drawFromDeck(this.seat);
        return;
    }

    // --- SIMULATION STRATEGY ---
    const SIMS = 30;
    let deckWins = 0;
    let pileWins = 0;
    const myTeam = (this.seat % 2 === 0) ? 'team1' : 'team2';

    for (let s = 0; s < SIMS; s++) {
        // Test Deck Draw
        const deckSim = game.clone();
        this.randomizeUnknownCards(deckSim);
        deckSim.drawFromDeck(this.seat);
        if (this.runFastSimulation(deckSim) === myTeam) deckWins++;

        // Test Pile Pickup
        const pileSim = game.clone();
        this.randomizeUnknownCards(pileSim);
        const res = pileSim.pickupDiscardPile(this.seat);
        if (res.success) {
            if (this.runFastSimulation(pileSim) === myTeam) pileWins++;
        }
    }

    if (pileWins > deckWins) {
        console.log(`Bot ${this.seat} simulating Pickup: ${pileWins} wins vs Deck: ${deckWins} wins.`);
        game.pickupDiscardPile(this.seat);
    } else {
        game.drawFromDeck(this.seat);
    }
}

    tryMelding(game) {
        // --- 1. CALCULATE GAME STATE FLAGS ---
        // A. Check Enemy Hand Size (Hoarding Punishment)
        let maxEnemyHand = 0;
        const enemySeats = (this.seat % 2 === 0) ? [1, 3] : [0, 2];
        enemySeats.forEach(seatIdx => {
            if (game.players[seatIdx]) {
                const size = game.players[seatIdx].length;
                if (size > maxEnemyHand) maxEnemyHand = size;
            }
        });

        // B. Define Rush/Panic Multipliers
        const HOARDING_THRESHOLD = 12; 
        let rushMultiplier = 1.0;
        if (maxEnemyHand >= HOARDING_THRESHOLD) {
            rushMultiplier = this.dna.PUNISH_HOARDING_MULTIPLIER || 1.5; 
        }

        let panicFactor = 1.0;
        const enemiesCloseToOut = enemySeats.some(s => game.players[s] && game.players[s].length < 4);
        if (enemiesCloseToOut) {
            panicFactor = this.dna.ENDGAME_PANIC_MULTIPLIER || 1.5; 
        }

        // C. Standard Setup
        const myTeamKey = (this.seat % 2 === 0) ? 'team1' : 'team2';
        const myScore = game.cumulativeScores[myTeamKey];
        const myMelds = (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
        const isOpening = (Object.keys(myMelds).length === 0);

        // --- 2. OPENING CHECK ---
        if (isOpening) {
            const requiredPoints = game.getOpeningReq(myScore);
            let totalOpeningPoints = 0;
            let hand = [...game.players[this.seat]];
            
            let naturalGroups = {};
            let wilds = [];
            hand.forEach(c => { 
                if(!c.isWild) naturalGroups[c.rank] = (naturalGroups[c.rank] || 0) + 1; 
                else wilds.push(c);
            });
            
            for (let r in naturalGroups) {
                let count = naturalGroups[r];
                if (count >= 3) {
                    totalOpeningPoints += count * this.getCardValue({rank: r});
                } else if (count === 2 && wilds.length >= 1) {
                    totalOpeningPoints += (2 * this.getCardValue({rank: r})) + this.getCardValue(wilds[0]);
                    wilds.shift(); 
                }
            }
            if (totalOpeningPoints < requiredPoints) return;
        }

        // --- 3. MAIN MELDING LOOP ---
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
                    
                    // Safety: Don't float if illegal
                    if (canastaCount < game.config.MIN_CANASTAS_OUT) {
                        if (currentHand.length - cardsToPlay.length < 3) continue; 
                    }

                    // CHECK: Does this complete a Canasta?
                    let currentPileLength = myMelds[rank].length;
                    let isCloser = (currentPileLength < 7 && (currentPileLength + cardsToPlay.length) >= 7);
                    
                    // If it's a closer, we ignore patience/holding logic and DO IT.
                    // Otherwise, we implicitly proceed.

                    let res = game.meldCards(this.seat, groups[rank], rank);
                    if (res.success) { madeMeld = true; break; }
                }
            }
            if (madeMeld) continue;

            // Priority 2: Create new melds
            for (let rank in groups) {
                let cardsToPlay = [...groups[rank]];
                let currentHand = game.players[this.seat];
                const canastaCount = Object.values(myMelds).filter(p => p.length >= 7).length;

                // Safety: Don't float if illegal
                if (canastaCount < game.config.MIN_CANASTAS_OUT) {
                    if (currentHand.length - cardsToPlay.length < 3) continue; 
                }

                // Check Patience vs Rush
                let effectivePatience = (this.dna.PICKUP_PATIENCE || 6) / rushMultiplier;
                
                // --- FIX: Corrected Logic Structure ---
                if (cardsToPlay.length >= 3) {
                    // Natural Meld
                    if (hand.length > effectivePatience) {
                        let res = game.meldCards(this.seat, cardsToPlay, rank);
                        if (res.success) { madeMeld = true; break; }
                    }
                } else if (cardsToPlay.length === 2 && wildIndices.length >= 1) {
                    // Mixed Meld (2 Naturals + 1 Wild)
                    if (hand.length > effectivePatience) {
                        cardsToPlay.push(wildIndices[0]);
                        let res = game.meldCards(this.seat, cardsToPlay, rank);
                        if (res.success) { madeMeld = true; break; }
                    }
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