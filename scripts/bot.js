// bot.js - v7.1: Memory, Multi-Mode & 4 Distinct Strategies
const fs = require('fs');
const path = require('path');

class CanastaBot {
    constructor(seat, difficulty, type = '4p', ruleset = 'standard', injectedDna = null) {
    this.seat = seat;
    this.difficulty = difficulty;
    this.type = type;       // '2p' or '4p'
    this.ruleset = ruleset; // 'standard' or 'easy'
    this.turboMode = false;
    // --- LEARNING / DEBUG TRACKING ---
    this.turnHistory = [];
    this.turnCounter = 0;
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
    console.log(`✅ Bot Initialized: Mode [${this.type}-${this.ruleset}] using DNA:`, this.dna);
}

getDefaultFallbackDna(type, ruleset) {
    if (type === '2p') {
        return ruleset === 'easy'
            ? {
                DISCARD_WILD_PENALTY: 500,
                FEED_ENEMY_MELD: 1000,
                DISCARD_SINGLE_BONUS: 50,
                MELD_AGGRESSION: 1.0,
                PICKUP_THRESHOLD: 1,
                BREAK_PAIR_PENALTY: 50,
                DISCARD_JUNK_BONUS: 20,
                GO_OUT_THRESHOLD: 0,
                BAIT_AGGRESSION: 50,
                PICKUP_PATIENCE: 4,
                BLACK_3_BONUS: -1000,

                EARLY_PILE_TAKE_THRESHOLD: 140,
                PAIR_BUILDING_BONUS: 220,
                DANGER_ZONE_MELD_BOOST: 650,
                CANASTA_CLOSURE_PRIORITY: 900,
                SAFE_SINGLE_DISCARD_BONUS: 80
            }
            : {
                DISCARD_WILD_PENALTY: 2500,
                FEED_ENEMY_MELD: 4000,
                DISCARD_SINGLE_BONUS: -93,
                MELD_AGGRESSION: 0.8,
                PICKUP_THRESHOLD: 2,
                BREAK_PAIR_PENALTY: 240,
                DISCARD_JUNK_BONUS: 10,
                GO_OUT_THRESHOLD: 0,
                BAIT_AGGRESSION: 120,
                PICKUP_PATIENCE: 6,
                BLACK_3_BONUS: -2000,

                EARLY_PILE_TAKE_THRESHOLD: 180,
                PAIR_BUILDING_BONUS: 260,
                DANGER_ZONE_MELD_BOOST: 850,
                CANASTA_CLOSURE_PRIORITY: 1200,
                SAFE_SINGLE_DISCARD_BONUS: 120
            };
    } else {
        return ruleset === 'easy'
            ? {
                DISCARD_WILD_PENALTY: 500,
                FEED_ENEMY_MELD: 1000,
                DISCARD_SINGLE_BONUS: 50,
                MELD_AGGRESSION: 1.0,
                PICKUP_THRESHOLD: 1,
                BREAK_PAIR_PENALTY: 50,
                DISCARD_JUNK_BONUS: 20,
                GO_OUT_THRESHOLD: 1000,
                BAIT_AGGRESSION: 50,
                PICKUP_PATIENCE: 4,
                BLACK_3_BONUS: -1000,

                EARLY_PILE_TAKE_THRESHOLD: 140,
                PAIR_BUILDING_BONUS: 220,
                DANGER_ZONE_MELD_BOOST: 650,
                CANASTA_CLOSURE_PRIORITY: 900,
                SAFE_SINGLE_DISCARD_BONUS: 80
            }
            : {
                DISCARD_WILD_PENALTY: 1732,
                FEED_ENEMY_MELD: 3012,
                DISCARD_SINGLE_BONUS: -150,
                MELD_AGGRESSION: 0.7,
                PICKUP_THRESHOLD: 2,
                PICKUP_PATIENCE: 7,
                BREAK_PAIR_PENALTY: 200,
                BAIT_AGGRESSION: 150,
                BLACK_3_BONUS: -2000,
                GO_OUT_THRESHOLD: 500,

                EARLY_PILE_TAKE_THRESHOLD: 180,
                PAIR_BUILDING_BONUS: 240,
                DANGER_ZONE_MELD_BOOST: 750,
                CANASTA_CLOSURE_PRIORITY: 1000,
                SAFE_SINGLE_DISCARD_BONUS: 100
            };
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
    getMyTeamMelds(game) {
    return (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
}

getEnemyTeamMelds(game) {
    return (this.seat % 2 === 0) ? game.team2Melds : game.team1Melds;
}

countCanastas(melds) {
    return Object.values(melds).filter(m => m.length >= 7).length;
}

getOpponentLowestHandSize(game) {
    let minSize = 999;
    for (let i = 0; i < game.players.length; i++) {
        if ((i % 2) !== (this.seat % 2)) {
            minSize = Math.min(minSize, game.players[i].length);
        }
    }
    return minSize === 999 ? 99 : minSize;
}

didOpponentMeld(game) {
    const enemyMelds = this.getEnemyTeamMelds(game);
    return Object.keys(enemyMelds).length > 0;
}

didWeMeld(game) {
    const myMelds = this.getMyTeamMelds(game);
    return Object.keys(myMelds).length > 0;
}

justPickedUpThisTurn() {
    if (!this.turnHistory || this.turnHistory.length === 0) return false;
    const currentTurn = this.turnHistory[this.turnHistory.length - 1];
    return currentTurn.decision_draw === 'pickup';
}

getStrategicPhase(game) {
    const drawLeft = game.deck.length;
    const myMelds = this.getMyTeamMelds(game);
    const enemyMelds = this.getEnemyTeamMelds(game);

    const enemyCanastas = this.countCanastas(enemyMelds);
    const oppLowHand = this.getOpponentLowestHandSize(game) <= 4;
    const oppHasMelded = Object.keys(enemyMelds).length > 0;
    const weHaveMelded = Object.keys(myMelds).length > 0;

    // Final emergency: save points / close canastas / go out if possible
    if (drawLeft < 10) return 'save_points';

    // Aggressive race only when opponent is already in strong finishing posture
    if (drawLeft <= 35 && enemyCanastas >= 2) return 'danger';

    // Early pile-control phase
    if (drawLeft > 40 && oppHasMelded && !weHaveMelded) return 'pile_control';

    // Early hidden phase
    if (drawLeft > 40) return 'hidden';

    // If opponent may finish soon because hand is low, become more active
    if (oppLowHand && enemyCanastas >= 1) return 'danger';

    return 'controlled_open';
}

attemptMinimalOpening(game, seat) {
    const hand = game.players[seat];
    const phase = this.getStrategicPhase(game);

    const groups = {};
    const wildCards = [];

    hand.forEach((c, i) => {
        if (c.isWild) wildCards.push(i);
        else {
            if (!groups[c.rank]) groups[c.rank] = [];
            groups[c.rank].push(i);
        }
    });

    const teamScore = (seat % 2 === 0) ? game.cumulativeScores.team1 : game.cumulativeScores.team2;
    const req = game.getOpeningReq(teamScore);

    let options = [];

    for (let rank in groups) {
        if (rank === "3") continue;

        // Best option: pure natural opening
        if (groups[rank].length >= 3) {
            const indices = groups[rank].slice(0, 3);
            const points = indices.reduce((sum, idx) => sum + this.getCardValue(hand[idx]), 0);
            options.push({
                rank,
                indices,
                points,
                usesWild: false
            });
        }

        // Only allow pair + wild opening if NOT in late emergency save mode
        if (groups[rank].length === 2 && wildCards.length > 0 && phase !== 'save_points') {
            const wildIdx = wildCards[0];
            const indices = [...groups[rank], wildIdx];
            const points = indices.reduce((sum, idx) => sum + this.getCardValue(hand[idx]), 0);
            options.push({
                rank,
                indices,
                points,
                usesWild: true
            });
        }
    }

    options.sort((a, b) => {
        if (a.usesWild !== b.usesWild) return a.usesWild ? 1 : -1;
        return a.points - b.points;
    });

    let chosen = [];
    let totalPoints = 0;
    const used = new Set();

    for (const option of options) {
        const overlaps = option.indices.some(idx => used.has(idx));
        if (overlaps) continue;

        chosen.push({ rank: option.rank, indices: option.indices });
        option.indices.forEach(idx => used.add(idx));
        totalPoints += option.points;

        if (totalPoints >= req) break;
    }

    if (totalPoints >= req && chosen.length > 0) {
        return game.processOpening(seat, chosen, false).success;
    }

    return false;
}

meldExistingCardsConservatively(game) {
    const myMelds = this.getMyTeamMelds(game);
    const hand = game.players[this.seat];

    const getFreshIndices = (targetRank) => {
        return game.players[this.seat]
            .map((card, index) => (card.rank === targetRank && !card.isWild ? index : -1))
            .filter(idx => idx !== -1);
    };

    // First priority: close near-canastas
    for (let rank in myMelds) {
        const meldSize = myMelds[rank].length;
        const matching = getFreshIndices(rank);

        if (matching.length === 0) continue;

        if (meldSize >= 5) {
            const needed = 7 - meldSize;
            if (needed > 0 && matching.length >= needed) {
                const res = game.meldCards(this.seat, matching.slice(0, needed), rank);
                if (res.success) return true;
            }
        }
    }

    // Second priority: add only one card to existing melds, but keep pairs in hand
    for (let rank in myMelds) {
        const matching = getFreshIndices(rank);
        if (matching.length >= 2) {
            const res = game.meldCards(this.seat, [matching[0]], rank);
            if (res.success) return true;
        }
    }

    return false;
}

meldAggressively(game) {
    const myMelds = this.getMyTeamMelds(game);

    let madeMeld = true;
    let safetyCounter = 0;
    while (madeMeld && safetyCounter < 50) {
    safetyCounter++;
        madeMeld = false;
        let hand = game.players[this.seat];
        let groups = {};

        hand.forEach((c, i) => {
            if (!c.isWild) {
                if (!groups[c.rank]) groups[c.rank] = [];
                groups[c.rank].push(i);
            }
        });

        for (let rank in myMelds) {
            if (groups[rank] && groups[rank].length > 0) {
                const canastaCount = this.countCanastas(myMelds);
                if (canastaCount < game.config.MIN_CANASTAS_OUT && hand.length - groups[rank].length < 2) continue;

                let res = game.meldCards(this.seat, groups[rank], rank);
                if (res.success) {
                    madeMeld = true;
                    break;
                }
            }
        }
        if (madeMeld) continue;

        for (let rank in groups) {
            let cardsToPlay = [...groups[rank]];
            const canastaCount = this.countCanastas(myMelds);

            if (canastaCount < game.config.MIN_CANASTAS_OUT && hand.length - cardsToPlay.length < 2) continue;

            if (cardsToPlay.length >= 3) {
                let res = game.meldCards(this.seat, cardsToPlay, rank);
                if (res.success) {
                    madeMeld = true;
                    break;
                }
            }
        }
    }
    if (safetyCounter >= 50) {
    console.error(`[BOT SAFETY] Seat ${this.seat} tryMelding stopped after 50 iterations.`);
}
}
    async decideDraw(game) {
    const canPickUp = game.canPickupDiscardPile(this.seat);
    const phase = this.getStrategicPhase(game);

    if (!canPickUp) {
        if (this.turnHistory && this.turnHistory.length > 0) {
            this.turnHistory[this.turnHistory.length - 1].decision_draw = 'deck_only_option';
        }
        game.drawFromDeck(this.seat);
        return;
    }

    const pileWorth = this.evaluateSeatPileWorth(game, this.seat);

    // Hard strategy rules first
    if (phase === 'hidden') {
        // Early game: don't reveal yourself unless the pile is really worth it
        if (pileWorth < this.dna.EARLY_PILE_TAKE_THRESHOLD) {
            if (this.turnHistory && this.turnHistory.length > 0) {
                this.turnHistory[this.turnHistory.length - 1].decision_draw = 'deck_hidden_phase';
            }
            game.drawFromDeck(this.seat);
            return;
        }
    }

    if (phase === 'pile_control') {
        // If opponent already started melding early, be more willing to take a valuable pile
        if (pileWorth >= this.dna.EARLY_PILE_TAKE_THRESHOLD) {
            if (this.turnHistory && this.turnHistory.length > 0) {
                this.turnHistory[this.turnHistory.length - 1].decision_draw = 'pickup_pile_control';
            }
            game.pickupDiscardPile(this.seat);
            return;
        }
    }

    // Simulation fallback
    const SIMS = 15;
    let deckWins = 0;
    let pileWins = 0;
    const myTeam = (this.seat % 2 === 0) ? 'team1' : 'team2';

    for (let s = 0; s < SIMS; s++) {
        const deckSim = game.clone();
        this.randomizeUnknownCards(deckSim);
        deckSim.drawFromDeck(this.seat);
        if (this.runFastSimulation(deckSim) === myTeam) deckWins++;

        const pileSim = game.clone();
        this.randomizeUnknownCards(pileSim);
        pileSim.pickupDiscardPile(this.seat);
        if (this.runFastSimulation(pileSim) === myTeam) pileWins++;
    }

    let takePile = false;

    if (phase === 'danger' || phase === 'save_points') {
        takePile = (pileWins >= deckWins - 1);
    } else {
        takePile = (pileWins >= deckWins);
    }

    if (takePile) {
        if (this.turnHistory && this.turnHistory.length > 0) {
            this.turnHistory[this.turnHistory.length - 1].decision_draw = 'pickup';
            this.turnHistory[this.turnHistory.length - 1].decision_draw_confidence = pileWins / SIMS;
        }
        console.log(`[BOT DRAW] Seat ${this.seat} chose PICKUP | phase=${phase} pileWins=${pileWins} deckWins=${deckWins}`);
        game.pickupDiscardPile(this.seat);
    } else {
        if (this.turnHistory && this.turnHistory.length > 0) {
            this.turnHistory[this.turnHistory.length - 1].decision_draw = 'deck';
            this.turnHistory[this.turnHistory.length - 1].decision_draw_confidence = deckWins / SIMS;
        }
        console.log(`[BOT DRAW] Seat ${this.seat} chose DECK | phase=${phase} deckWins=${deckWins} pileWins=${pileWins}`);
        game.drawFromDeck(this.seat);
    }
}
    
    async executeTurn(game) {
    this.updateMemory(game);

        // ===== LEARNING: START TURN TRACKING =====
    if (!this.turnHistory) this.turnHistory = [];
    if (typeof this.turnCounter !== 'number') this.turnCounter = 0;

    this.turnCounter += 1;

    const turnData = {
        turn: this.turnCounter,
        turnNumber: this.turnCounter,
        seat: this.seat,
        handSize: game.players[this.seat].length,
        topDiscard: game.discardPile.length > 0
            ? game.discardPile[game.discardPile.length - 1].rank
            : null,
        discardPileSize: game.discardPile.length,
        isFrozen: !!game.isFrozen,
        actions: []
    };

    this.turnHistory.push(turnData);

    console.log(`[BOT TURN START] Seat ${this.seat} Turn ${this.turnCounter} HandSize ${turnData.handSize} TopDiscard ${turnData.topDiscard || 'none'}`);
    // ===== END LEARNING =====

    if (game.turnPhase === "draw") {
        await this.decideDraw(game);
    }

    if (game.turnPhase === "playing") {
    const shouldMeld = this.simulateMeldDecision(game);

    if (shouldMeld) {
        await this.tryMelding(game);

        // SAFETY: if melding ended the round or changed phase, stop here
        if (game.turnPhase !== "playing") {
            this.saveStateSnapshot(game);
            return;
        }

        // SAFETY: if bot has no cards left after melding, stop here
        if (!game.players[this.seat] || game.players[this.seat].length === 0) {
            this.saveStateSnapshot(game);
            return;
        }
    }

    const discardIdx = await this.pickDiscard(game);

    // SAFETY: only discard if a valid index was returned
    if (typeof discardIdx === "number" && discardIdx >= 0) {
        game.discardFromHand(this.seat, discardIdx);
    }
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
    const phase = this.getStrategicPhase(game);
    const myMelds = this.getMyTeamMelds(game);
    const alreadyOpened = Object.keys(myMelds).length > 0;
    const pickedUpThisTurn = this.justPickedUpThisTurn();

    if (phase === 'hidden') {
        // Early game: do not expose cards unless the pile was picked up
        return pickedUpThisTurn;
    }

    if (phase === 'pile_control') {
        // Keep hand hidden while building for future pile control
        return pickedUpThisTurn;
    }

    if (phase === 'controlled_open') {
        // Mid game: if already open or we just took pile, allow controlled melding
        return alreadyOpened || pickedUpThisTurn;
    }

    if (phase === 'danger' || phase === 'save_points') {
        // Late game: stop hiding, race to canastas and finish
        return true;
    }

    return false;
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
    if (!hand || hand.length === 0) {
    console.error(`[BOT SAFETY] Seat ${this.seat} pickDiscard called with empty hand.`);
    return -1;
}
    let candidates = [];
    const teamMelds = this.getMyTeamMelds(game);
    const enemyMelds = this.getEnemyTeamMelds(game);
    const phase = this.getStrategicPhase(game);

    for (let i = 0; i < hand.length; i++) {
        const card = hand[i];
        let wins = 0;
        const SIMULATIONS = 30;
        let penalty = 0;

        const rankCount = hand.filter(c => c.rank === card.rank).length;
        const ownMeldSize = teamMelds[card.rank] ? teamMelds[card.rank].length : 0;
        const enemyHasRank = !!enemyMelds[card.rank];

        // Wild discard penalty
        if (card.isWild) {
            if (game.discardPile.length < 5) {
                penalty += this.dna.DISCARD_WILD_PENALTY;
            } else {
                penalty += (this.dna.DISCARD_WILD_PENALTY / 2);
            }
        }

        // Feeding enemy meld
        if (enemyHasRank) {
            penalty += this.dna.FEED_ENEMY_MELD;
            penalty += 400;
        }

        // Keep pairs for future pile pickup
        if (rankCount >= 2 && !card.isWild) {
            penalty += this.dna.BREAK_PAIR_PENALTY;
            if (phase === 'hidden' || phase === 'pile_control') {
                penalty += this.dna.PAIR_BUILDING_BONUS;
            }
        }

        // Protect own meld growth
        if (ownMeldSize > 0) {
            penalty += 150;

            if (phase === 'danger' || phase === 'save_points') {
                penalty += this.dna.DANGER_ZONE_MELD_BOOST;
            }

            if (ownMeldSize >= 5) {
                penalty += this.dna.CANASTA_CLOSURE_PRIORITY;
            }
        }

        // Card value penalties
        if (card.rank === 'A') penalty += 400;
        if (card.rank === 'K') penalty += 250;
        if (card.rank === 'Q') penalty += 180;
        if (card.rank === 'J') penalty += 150;
        if (card.rank === '10') penalty += 120;
        if (card.rank === '9') penalty += 100;

        // Safe singletons are better early if opponent has not shown them
        if ((phase === 'hidden' || phase === 'pile_control') && rankCount === 1 && !enemyHasRank && !card.isWild) {
            penalty -= this.dna.SAFE_SINGLE_DISCARD_BONUS;
        }

        // Run simulations
        for (let s = 0; s < SIMULATIONS; s++) {
            const simGame = game.clone();
            this.randomizeUnknownCards(simGame);

            const moveResult = simGame.discardFromHand(this.seat, i);
            if (!moveResult.success) {
                wins = -999;
                break;
            }

            const winner = this.runFastSimulation(simGame);
            const myTeam = (this.seat % 2 === 0) ? 'team1' : 'team2';
            if (winner === myTeam) wins++;
        }

        const winRate = wins / SIMULATIONS;
        const finalScore = (winRate * 1000) - penalty;

        candidates.push({
            index: i,
            score: finalScore,
            winRate: winRate,
            card: card
        });
    }

    candidates.sort((a, b) => b.score - a.score);
    const choice = candidates[0];

if (!choice) {
    console.error(`[BOT SAFETY] Seat ${this.seat} pickDiscard found no valid candidates.`);
    return -1;
}

    if (this.turnHistory && this.turnHistory.length > 0) {
        const currentTurn = this.turnHistory[this.turnHistory.length - 1];

        currentTurn.decision_discard = {
            cardRank: choice.card.rank,
            index: choice.index,
            score: choice.score,
            phase,
            alternatives: candidates.slice(1, 3).map(c => ({
                rank: c.card.rank,
                score: c.score
            }))
        };
    }

    if (!this.silentMode) {
        console.log(`[BOT DISCARD] Seat ${this.seat} Turn ${this.turnCounter} phase=${phase} chose ${choice.card.rank} | WinRate=${choice.winRate.toFixed(2)} | FinalScore=${choice.score.toFixed(0)}`);
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
    const phase = this.getStrategicPhase(game);
    const myMelds = this.getMyTeamMelds(game);
    const alreadyOpened = Object.keys(myMelds).length > 0;
    const pickedUpThisTurn = this.justPickedUpThisTurn();

    // NOT OPENED YET
    if (!alreadyOpened) {
        if (phase === 'hidden' || phase === 'pile_control') {
            // Early game: only open if we picked up the pile this turn
            if (!pickedUpThisTurn) return;

            const opened = this.attemptMinimalOpening(game, this.seat);
            if (!opened) return;

            this.meldExistingCardsConservatively(game);
            return;
        }

        if (phase === 'controlled_open') {
            const opened = this.attemptMinimalOpening(game, this.seat);
            if (!opened) return;

            this.meldExistingCardsConservatively(game);
            return;
        }

        if (phase === 'danger') {
            // Opponent has 2 canastas and deck <= 35: become aggressive
            const opened = this.attemptMinimalOpening(game, this.seat);
            if (!opened) return;

            this.meldAggressively(game);
            return;
        }

        if (phase === 'save_points') {
            // Deck < 10: avoid wasting wilds on weak opening pairs
            const opened = this.attemptMinimalOpening(game, this.seat);
            if (!opened) return;

            this.meldAggressively(game);
            return;
        }
    }

    // ALREADY OPENED
    if (phase === 'hidden' || phase === 'pile_control' || phase === 'controlled_open') {
        this.meldExistingCardsConservatively(game);
        return;
    }

    if (phase === 'danger' || phase === 'save_points') {
        this.meldAggressively(game);
        return;
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
            learnFromRound(roundResult) {
        const { botScore, oppScore, scoreDiff, didWin } = roundResult;

        console.log('================ BOT LEARNING START ================');
        console.log(`[BOT LEARNING] Seat ${this.seat}`);
        console.log(`[BOT LEARNING] botScore=${botScore} oppScore=${oppScore} scoreDiff=${scoreDiff} didWin=${didWin}`);
        console.log(`[BOT LEARNING] turns recorded=${this.turnHistory ? this.turnHistory.length : 0}`);

        if (!this.turnHistory || this.turnHistory.length === 0) {
            console.log('[BOT LEARNING] No turn history found. Nothing to learn from.');
            console.log('================ BOT LEARNING END =================');
            return;
        }

        const recentTurns = this.turnHistory.slice(-5);

        console.log('[BOT LEARNING] Recent turns used for learning:', recentTurns.map(t => ({
            turnNumber: t.turnNumber,
            handSize: t.handSize,
            draw: t.decision_draw,
            discard: t.decision_discard ? t.decision_discard.cardRank : null
        })));

        if (!didWin && scoreDiff < 0) {
            console.log('[BOT LEARNING] Result = LOSS. Adjusting discard strategy.');
            for (const turn of recentTurns) {
                if (turn.decision_discard) {
                    this.adjustDiscardStrategy(turn, scoreDiff);
                }
            }
        } else if (didWin) {
            console.log('[BOT LEARNING] Result = WIN. Reinforcing successful DNA.');
            this.reinforceDNAFromWin(scoreDiff);
        }

        this.saveDNA();
        this.turnHistory = [];
        this.turnCounter = 0;

        console.log('================ BOT LEARNING END =================');
    }

    adjustDiscardStrategy(turn, scoreDiff) {
    const lossFactor = Math.min(40, Math.abs(scoreDiff) / 25);

    if (!turn.decision_discard) return;

    const phase = turn.decision_discard.phase || 'unknown';

    if (phase === 'hidden' || phase === 'pile_control') {
        this.dna.PAIR_BUILDING_BONUS = Math.min(500, (this.dna.PAIR_BUILDING_BONUS || 220) + 5);
        this.dna.FEED_ENEMY_MELD = Math.min(7000, (this.dna.FEED_ENEMY_MELD || 4000) + lossFactor);
    }

    if (phase === 'danger' || phase === 'save_points') {
        this.dna.DANGER_ZONE_MELD_BOOST = Math.min(1600, (this.dna.DANGER_ZONE_MELD_BOOST || 850) + 10);
        this.dna.CANASTA_CLOSURE_PRIORITY = Math.min(2200, (this.dna.CANASTA_CLOSURE_PRIORITY || 1200) + 15);
    }

    this.dna.DISCARD_WILD_PENALTY = Math.min(6000, (this.dna.DISCARD_WILD_PENALTY || 2500) + 10);
    this.dna.BAIT_AGGRESSION = Math.max(40, (this.dna.BAIT_AGGRESSION || 120) - 1);

    console.log('[DNA ADJUSTMENT]', {
        turnNumber: turn.turnNumber,
        discardedCard: turn.decision_discard.cardRank,
        phase,
        FEED_ENEMY_MELD: this.dna.FEED_ENEMY_MELD,
        DISCARD_WILD_PENALTY: this.dna.DISCARD_WILD_PENALTY,
        PAIR_BUILDING_BONUS: this.dna.PAIR_BUILDING_BONUS,
        DANGER_ZONE_MELD_BOOST: this.dna.DANGER_ZONE_MELD_BOOST,
        CANASTA_CLOSURE_PRIORITY: this.dna.CANASTA_CLOSURE_PRIORITY
    });
}

    reinforceDNAFromWin(scoreDiff) {
    const winFactor = Math.min(20, Math.abs(scoreDiff) / 50);

    this.dna.MELD_AGGRESSION = Math.min(1.5, (this.dna.MELD_AGGRESSION || 0.8) + 0.01);
    this.dna.CANASTA_CLOSURE_PRIORITY = Math.min(2200, (this.dna.CANASTA_CLOSURE_PRIORITY || 1200) + winFactor);
    this.dna.DANGER_ZONE_MELD_BOOST = Math.min(1600, (this.dna.DANGER_ZONE_MELD_BOOST || 850) + 5);

    console.log('[DNA REINFORCEMENT]', {
        MELD_AGGRESSION: this.dna.MELD_AGGRESSION,
        CANASTA_CLOSURE_PRIORITY: this.dna.CANASTA_CLOSURE_PRIORITY,
        DANGER_ZONE_MELD_BOOST: this.dna.DANGER_ZONE_MELD_BOOST
    });
}

    saveDNA() {
        try {
            const dnaPath = path.join(__dirname, 'production-dna.json');
            const dnaKey = `${this.type}-${this.ruleset}`;

            let allDNA = {};
            if (fs.existsSync(dnaPath)) {
                allDNA = JSON.parse(fs.readFileSync(dnaPath, 'utf8'));
            }

            allDNA[dnaKey] = this.dna;
            
            console.log('[DNA SAVE PREVIEW]', {
            dnaKey,
            dna: allDNA[dnaKey]
            });
            fs.writeFileSync(dnaPath, JSON.stringify(allDNA, null, 2));

            console.log(`[DNA SAVED] Updated ${dnaKey} in production-dna.json`);
        } catch (err) {
            console.error('[DNA SAVE ERROR]', err);
        }
    }
}

module.exports = { CanastaBot };