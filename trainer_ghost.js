// trainer_ghost.js
const fs = require('fs');
const path = require('path');
const { CanastaBot } = require('./scripts/bot.js'); // Adjust path if bot.js is elsewhere

// 1. Load the recorded human data
const dataPath = path.join(__dirname, 'human_training_data.jsonl');
if (!fs.existsSync(dataPath)) {
    console.error("No training data found at:", dataPath);
    process.exit(1);
}

// Parse the JSONL file into an array of actions
const rawData = fs.readFileSync(dataPath, 'utf8').trim().split('\n');
const humanActions = rawData.map(line => {
    try { return JSON.parse(line); } 
    catch (e) { return null; }
}).filter(Boolean);

console.log(`Loaded ${humanActions.length} recorded human moves.`);

// 2. Helper to reconstruct a mock game state for the bot to evaluate
function buildMockGame(state) {
    // We only need to provide the parts of the game state that the bot's 
    // pickDiscard, decideDraw, and tryMelding functions actually look at.
    return {
        config: { PLAYER_COUNT: 2, MIN_CANASTAS_OUT: 2 }, // Adjust if you recorded 4P games
        players: [
            state.hand.map(rank => ({ rank: rank, isWild: rank === '2' || rank === 'Joker' })),
            [] // Enemy hand (size unknown to bot anyway)
        ],
        discardPile: state.discardPileSize > 0 && state.discardPileTop 
            ? Array(state.discardPileSize - 1).fill({rank: 'unknown'}).concat([{rank: state.discardPileTop, isWild: state.discardPileTop === '2' || state.discardPileTop === 'Joker'}])
            : [],
        team1Melds: state.myMelds || {},
        team2Melds: state.enemyMelds || {},
        cumulativeScores: { team1: state.myScore || 0, team2: state.enemyScore || 0 },
        // Mock functions needed by the bot
        getOpeningReq: function(score) {
            if (score < 0) return 15;
            if (score < 1500) return 50;
            if (score < 3000) return 90;
            return 120;
        }
    };
}

// 3. The Fitness Function: How well does this DNA match the human?
function evaluateDNA(dnaCandidate) {
    let matches = 0;
    let totalEvaluated = 0;

    // Create a bot with this specific DNA
    const bot = new CanastaBot(0, 'hard', '2p', 'standard', dnaCandidate);

    for (const record of humanActions) {
        const mockGame = buildMockGame(record.state);
        
        // --- Test Discard Logic ---
        if (record.action.type === 'discard') {
            totalEvaluated++;
            try {
                // Ask the bot what it would discard
                const botChoiceIndex = bot.pickDiscard(mockGame);
                const botCard = mockGame.players[0][botChoiceIndex];
                
                if (botCard && botCard.rank === record.action.value) {
                    matches++;
                }
            } catch (e) {
                // If the bot crashes on mock data, it scores 0 for this move
            }
        }
        
        // --- Test Pickup Logic ---
        else if (record.action.type === 'pickup') {
             totalEvaluated++;
             // For pickup, we check the evaluateSeatPileWorth function
             // If the human picked it up, the worth should be high (>350 is the bot's threshold)
             const pileWorth = bot.evaluateSeatPileWorth(mockGame, 0);
             if (pileWorth > 350) {
                 matches++;
             }
        }
        
        // (You can add melding evaluation here later based on the extraData)
    }

    return (totalEvaluated > 0) ? (matches / totalEvaluated) * 100 : 0;
}

// 4. Simple Genetic Algorithm / Hill Climber to find the best DNA
function trainGhost() {
    // Start with the default 2P Easy DNA as a baseline
    let currentBestDNA = {
        DISCARD_WILD_PENALTY: 1720,
        FEED_ENEMY_MELD: 9553,
        DISCARD_SINGLE_BONUS: -133,
        MELD_AGGRESSION: 1.17,
        PICKUP_THRESHOLD: 2,
        PICKUP_PATIENCE: 5.2,
        BAIT_AGGRESSION: 2.33,
        BREAK_PAIR_PENALTY: 50,
        DISCARD_JUNK_BONUS: 20
    };

    let bestScore = evaluateDNA(currentBestDNA);
    console.log(`Baseline Agreement Score: ${bestScore.toFixed(2)}%`);

    const GENERATIONS = 5000;
    console.log(`Starting training for ${GENERATIONS} generations...`);

    for (let i = 0; i < GENERATIONS; i++) {
        // Create a mutant DNA by tweaking random values slightly
        const mutantDNA = { ...currentBestDNA };
        const keys = Object.keys(mutantDNA);
        
        // Mutate 1 to 3 random traits
        const mutations = Math.floor(Math.random() * 3) + 1;
        for(let m=0; m<mutations; m++) {
            const randomKey = keys[Math.floor(Math.random() * keys.length)];
            // Shift value by -20% to +20%
            const shift = 1 + ((Math.random() * 0.4) - 0.2); 
            mutantDNA[randomKey] = Number((mutantDNA[randomKey] * shift).toFixed(2));
        }

        const mutantScore = evaluateDNA(mutantDNA);

        // If the mutant matches the human better, keep it
        if (mutantScore > bestScore) {
            bestScore = mutantScore;
            currentBestDNA = mutantDNA;
            console.log(`Gen ${i}: New Best Score! ${bestScore.toFixed(2)}% matches`);
        }
    }

    console.log("\n--- Training Complete ---");
    console.log(`Final Agreement Score: ${bestScore.toFixed(2)}%`);
    console.log("Optimal DNA to play like you:");
    console.log(JSON.stringify(currentBestDNA, null, 2));
    
    // Save the new DNA
    const outputPath = path.join(__dirname, 'ghost-dna.json');
    fs.writeFileSync(outputPath, JSON.stringify(currentBestDNA, null, 2));
    console.log(`\nSaved new DNA to ${outputPath}`);
}

trainGhost();