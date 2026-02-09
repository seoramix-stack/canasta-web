// recorder.js - v2: Captures Enemy Hand Size & Pile Data
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'human_training_data.jsonl');

// Helper to calculate card values safely for logging
function getCardValue(rank) {
    if (rank === 'Joker') return 50;
    if (rank === '2' || rank === 'A') return 20;
    if (['K', 'Q', 'J', '10', '9', '8'].includes(rank)) return 10;
    if (['7', '6', '5', '4', '3'].includes(rank)) return 5;
    return 0;
}

function recordHumanTurn(game, seat, actionType, actionValue, playerName, extraData = {}) {
    try {
        // 1. Calculate Pile Value (for Freeze Logic training)
        const pileValue = game.discardPile.reduce((sum, c) => sum + getCardValue(c.rank), 0);

        // 2. Capture ALL player hand sizes (for Hoarding/Panic Logic training)
        const playerHandSizes = game.players.map(p => p.length);

        const stateSnapshot = {
            hand: game.players[seat].map(c => c.rank),
            discardPileTop: game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1].rank : null,
            discardPileSize: game.discardPile.length, // <--- NEW: Needed for accurate reconstruction
            discardPileValue: pileValue,              // <--- NEW: Needed for Freeze Trigger
            playerHandSizes: playerHandSizes,         // <--- NEW: Needed for Hoarding/Panic Triggers
            
            myMelds: JSON.parse(JSON.stringify((seat % 2 === 0) ? game.team1Melds : game.team2Melds)),
            enemyMelds: JSON.parse(JSON.stringify((seat % 2 === 0) ? game.team2Melds : game.team1Melds)),
            scores: game.cumulativeScores,
            turnPhase: game.turnPhase 
        };

        const logEntry = {
            timestamp: Date.now(),
            player: playerName,
            state: stateSnapshot,
            action: {
                type: actionType, 
                value: actionValue, 
                details: extraData
            }
        };

        fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');
        // console.log(`[Recorder] Logged ${actionType} for ${playerName}`); // Optional: Uncomment for debug
    } catch (err) {
        console.error("Error recording turn:", err);
    }
}

module.exports = { recordHumanTurn };