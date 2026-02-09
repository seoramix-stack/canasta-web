// trainer_ghost.js - v2: Updated for Advanced Bot Logic
const fs = require('fs');
const path = require('path');
const { CanastaBot } = require('./scripts/bot.js'); //

// 1. Load the recorded human data
const dataPath = path.join(__dirname, 'human_training_data.jsonl');
if (!fs.existsSync(dataPath)) {
    console.error("No training data found at:", dataPath);
    process.exit(1);
}

// Parse the JSONL file
const rawData = fs.readFileSync(dataPath, 'utf8').trim().split('\n');
const humanActions = rawData.map(line => {
    try { return JSON.parse(line); } 
    catch (e) { return null; }
}).filter(Boolean);

console.log(`Loaded ${humanActions.length} recorded human moves.`);

// 2. Helper to reconstruct a mock game state
function buildMockGame(state) {
    // We mock the game state to support all bot inspections
    const mockState = {
        config: { PLAYER_COUNT: 2, MIN_CANASTAS_OUT: 2 },
        players: [
            state.hand.map(rank => ({ rank: rank, isWild: rank === '2' || rank === 'Joker' })),
            // MOCK ENEMY: We give them 8 cards by default so logic doesn't crash.
            // (If your recorder saved 'enemyHandSize', use that here instead)
            Array(8).fill({ rank: 'unknown' }) 
        ],
        discardPile: state.discardPileSize > 0 && state.discardPileTop 
            ? Array(state.discardPileSize - 1).fill({rank: 'unknown'})
                .concat([{rank: state.discardPileTop, isWild: state.discardPileTop === '2' || state.discardPileTop === 'Joker'}])
            : [],
        team1Melds: JSON.parse(JSON.stringify(state.myMelds || {})),
        team2Melds: JSON.parse(JSON.stringify(state.enemyMelds || {})),
        cumulativeScores: { team1: state.myScore || 0, team2: state.enemyScore || 0 },
        turnPhase: 'playing', // Default to playing phase
        
        // Mock Methods required by Bot
        getOpeningReq: function(score) {
            if (score < 0) return 15;
            if (score < 1500) return 50;
            if (score < 3000) return 90;
            return 120;
        },
        
        // Mock Action: Meld
        meldCards: function(seat, indices, rank) {
            this.wasMeldCalled = true; // Flag for the trainer to check
            return { success: true };
        },

        // Mock Action: Discard
        discardFromHand: function(seat, index) {
            return { success: true };
        }
    };
    return mockState;
}

// 3. The Fitness Function
function evaluateDNA(dnaCandidate) {
    let matches = 0;
    let totalEvaluated = 0;

    const bot = new CanastaBot(0, 'hard', '2p', 'standard', dnaCandidate); //

    for (const record of humanActions) {
        const mockGame = buildMockGame(record.state);
        
        // --- A. Test Discard Logic ---
        if (record.action.type === 'discard') {
            totalEvaluated++;
            try {
                const botChoiceIndex = bot.pickDiscard(mockGame);
                const botCard = mockGame.players[0][botChoiceIndex];
                
                // Did bot pick the exact same rank?
                if (botCard && botCard.rank === record.action.value) {
                    matches++;
                }
            } catch (e) { /* Ignore crash on mock data */ }
        }
        
        // --- B. Test Pickup Logic ---
        else if (record.action.type === 'pickup') {
             totalEvaluated++;
             const pileWorth = bot.evaluateSeatPileWorth(mockGame, 0);
             // If human picked up, bot should value the pile highly
             if (pileWorth > (dnaCandidate.PICKUP_THRESHOLD * 100)) { 
                 matches++;
             }
        }

        // --- C. Test Meld Logic (NEW) ---
        else if (record.action.type === 'meld') {
            totalEvaluated++;
            // We run the bot's tryMelding function
            mockGame.wasMeldCalled = false;
            bot.tryMelding(mockGame);
            
            // If the human melded, the bot should have tried to meld too
            if (mockGame.wasMeldCalled) {
                matches++;
            }
        }
    }

    return (totalEvaluated > 0) ? (matches / totalEvaluated) * 100 : 0;
}

// 4. Genetic Algorithm
function trainGhost() {
    // UPDATED: Now includes your new advanced genes!
    let currentBestDNA = {
        // Standard Weights
        DISCARD_WILD_PENALTY: 1720,
        FEED_ENEMY_MELD: 9553,
        DISCARD_SINGLE_BONUS: -133,
        MELD_AGGRESSION: 1.17,
        PICKUP_THRESHOLD: 2,
        PICKUP_PATIENCE: 5.2,
        BAIT_AGGRESSION: 2.33,
        BREAK_PAIR_PENALTY: 50,
        DISCARD_JUNK_BONUS: 20,
        
        // NEW Dynamic Genes
        ENDGAME_PANIC_MULTIPLIER: 1.5,
        CANASTA_COMPLETION_BONUS: 2000,
        FREEZE_DEFENSE_TRIGGER: 1500,
        PUNISH_HOARDING_MULTIPLIER: 1.5
    };

    let bestScore = evaluateDNA(currentBestDNA);
    console.log(`Baseline Agreement Score: ${bestScore.toFixed(2)}%`);

    const GENERATIONS = 5000;
    console.log(`Starting training for ${GENERATIONS} generations...`);

    for (let i = 0; i < GENERATIONS; i++) {
        const mutantDNA = { ...currentBestDNA };
        const keys = Object.keys(mutantDNA);
        
        const mutations = Math.floor(Math.random() * 3) + 1;
        for(let m=0; m<mutations; m++) {
            const randomKey = keys[Math.floor(Math.random() * keys.length)];
            const shift = 1 + ((Math.random() * 0.4) - 0.2); // +/- 20%
            mutantDNA[randomKey] = Number((mutantDNA[randomKey] * shift).toFixed(2));
        }

        const mutantScore = evaluateDNA(mutantDNA);

        if (mutantScore > bestScore) {
            bestScore = mutantScore;
            currentBestDNA = mutantDNA;
            // Log updates occasionally
            if (i % 1000 === 0) console.log(`Gen ${i}: Best Score ${bestScore.toFixed(2)}%`);
        }
    }

    console.log("\n--- Training Complete ---");
    console.log(`Final Agreement Score: ${bestScore.toFixed(2)}%`);
    
    const outputPath = path.join(__dirname, 'ghost-dna.json');
    fs.writeFileSync(outputPath, JSON.stringify(currentBestDNA, null, 2));
    console.log(`Saved new DNA to ${outputPath}`);
}

trainGhost();