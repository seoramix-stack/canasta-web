// simulation_runner.js
// Usage: node simulation_runner.js

const fs = require('fs');
const { CanastaGame } = require('../game');
const { CanastaBot } = require('../bot');
const { ChaosBot } = require('./chaos_bot');

// CONFIGURATION
const TOTAL_GAMES = 1000;  // How many games to simulate
const MAX_TURNS = 300;     // Limit per game to catch infinite loops
const LOG_INTERVAL = 100;  // Log progress every N games
const SAVE_CRASHES = true; // Save crashed game states to JSON files

// STATISTICS
let stats = {
    gamesPlayed: 0,
    cleanGames: 0,
    crashes: 0,
    stuckGames: 0, // Infinite loops
    team1Wins: 0,
    team2Wins: 0,
    errorsByType: {}
};

console.log(`\n🤖 STARTING BOT SIMULATION: ${TOTAL_GAMES} GAMES 🤖`);
console.log(`--------------------------------------------------`);

const startTime = Date.now();

for (let i = 1; i <= TOTAL_GAMES; i++) {
    runSingleGame(i);
    
    if (i % LOG_INTERVAL === 0) {
        const progress = Math.round((i / TOTAL_GAMES) * 100);
        process.stdout.write(`\rProgress: ${progress}% (${i}/${TOTAL_GAMES}) | Crashes: ${stats.crashes}`);
    }
}

const duration = ((Date.now() - startTime) / 1000).toFixed(2);
console.log(`\n\n--------------------------------------------------`);
console.log(`✅ SIMULATION COMPLETE in ${duration}s`);
console.log(`📊 STATS:`);
console.log(`   Games Played: ${stats.gamesPlayed}`);
console.log(`   Clean Games:  ${stats.cleanGames}`);
console.log(`   Crashes:      ${stats.crashes}`);
console.log(`   Stuck/Loop:   ${stats.stuckGames}`);
console.log(`   Win Ratio:    T1: ${stats.team1Wins} - T2: ${stats.team2Wins}`);

if (stats.crashes > 0) {
    console.log(`\n❌ ERROR SUMMARY:`);
    console.table(stats.errorsByType);
    console.log(`\nCheck 'crash_logs/' folder for detailed game states.`);
} else {
    console.log(`\n🎉 NO CRASHES FOUND! LOGIC SEEMS STABLE.`);
}


// --- CORE SIMULATION LOGIC ---

function runSingleGame(gameId) {
    // 1. Setup
    const game = new CanastaGame({ 
        PLAYER_COUNT: 4, 
        HAND_SIZE: 11,
        MIN_CANASTAS_OUT: 1,
        DRAW_COUNT: 1
    });
    game.resetMatch();

    // Initialize 4 Hard Bots
    const bots = [
        new ChaosBot(0, 'hard', '2p'), 
        new CanastaBot(1, 'hard', '2p'), 
        new CanastaBot(2, 'hard', '4p'),
        new CanastaBot(3, 'hard', '4p')
    ];

    let turns = 0;
    stats.gamesPlayed++;

    try {
        // 2. Game Loop
        while (game.turnPhase !== 'game_over') {
            if (turns >= MAX_TURNS) {
                stats.stuckGames++;
                throw new Error("GAME_STUCK_INFINITE_LOOP");
            }

            const currentPlayer = game.currentPlayer;
            const bot = bots[currentPlayer];

            // --- EXECUTE BOT TURN ---
            // We use playTurnSync (from bot.js) to run immediately without async delays
            bot.playTurnSync(game);

            // --- INVARIANT CHECKS (The Bug Hunters) ---
            validateGameIntegrity(game);

            turns++;
        }

        // 3. Post-Game Analysis
        stats.cleanGames++;
        let s1 = 0; 
        let s2 = 0;

        if (game.finalScores) {
            s1 = game.finalScores.team1.total;
            s2 = game.finalScores.team2.total;
        }

        if (s1 > s2) stats.team1Wins++;
        else if (s2 > s1) stats.team2Wins++;
        // If s1 == s2, it's a draw (we can ignore or count separately)

    } catch (err) {
        handleCrash(err, game, gameId);
    }
}

// --- VALIDATION LOGIC ---
// This runs after EVERY move to ensure the game state isn't broken.
function validateGameIntegrity(game) {
    
    // Check 1: Card Conservation Law
    // Total cards in existence must ALWAYS equal 108 (2 Decks x 54 cards)
    let totalCards = 0;
    
    // Deck + Discard
    totalCards += game.deck.length;
    totalCards += game.discardPile.length;
    
    // Hands
    game.players.forEach(hand => totalCards += hand.length);
    
    // Melds (Team 1 & 2)
    [game.team1Melds, game.team2Melds].forEach(teamMelds => {
        Object.values(teamMelds).forEach(pile => totalCards += pile.length);
    });
    
    // Red 3s
    totalCards += game.team1Red3s.length;
    totalCards += game.team2Red3s.length;

    if (totalCards !== 108) {
        throw new Error(`INTEGRITY FAIL: Card count is ${totalCards} (Expected 108)`);
    }

    // Check 2: Score Integrity
    if (Number.isNaN(game.cumulativeScores.team1) || Number.isNaN(game.cumulativeScores.team2)) {
        throw new Error(`INTEGRITY FAIL: Scores became NaN`);
    }

    // Check 3: Hand Size Integrity (Negative cards?)
    game.players.forEach((p, i) => {
        if (p.length < 0) throw new Error(`INTEGRITY FAIL: Player ${i} has negative cards`);
    });
}

// --- CRASH HANDLING ---
function handleCrash(err, game, gameId) {
    stats.crashes++;
    const errMsg = err.message || err.toString();
    
    // Group errors for summary
    if (!stats.errorsByType[errMsg]) stats.errorsByType[errMsg] = 0;
    stats.errorsByType[errMsg]++;

    if (SAVE_CRASHES) {
        if (!fs.existsSync('./crash_logs')) fs.mkdirSync('./crash_logs');
        
        const crashData = {
            error: errMsg,
            stack: err.stack,
            turnPhase: game.turnPhase,
            currentPlayer: game.currentPlayer,
            deckSize: game.deck.length,
            scores: game.cumulativeScores,
            // Dump the hands for debugging
            hands: game.players.map(p => p.map(c => `${c.rank}${c.suit}`)),
            discardPileTop: game.discardPile.length > 0 ? game.discardPile[game.discardPile.length-1] : 'EMPTY'
        };

        fs.writeFileSync(
            `./crash_logs/crash_game_${gameId}.json`, 
            JSON.stringify(crashData, null, 2)
        );
    }
}