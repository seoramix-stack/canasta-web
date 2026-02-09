// recorder.js
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'human_training_data.jsonl');

function recordHumanTurn(game, seat, actionType, actionValue, playerName, extraData = {}) {
    try {
        const stateSnapshot = {
            hand: game.players[seat].map(c => c.rank),
            discardPileTop: game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1].rank : null,
            myMelds: JSON.parse(JSON.stringify((seat % 2 === 0) ? game.team1Melds : game.team2Melds)), // Deep copy to prevent reference issues
            enemyMelds: JSON.parse(JSON.stringify((seat % 2 === 0) ? game.team2Melds : game.team1Melds)),
            scores: game.cumulativeScores,
            turnPhase: game.turnPhase // crucial for knowing IF we can meld
        };

        const logEntry = {
            timestamp: Date.now(),
            player: playerName,
            state: stateSnapshot,
            action: {
                type: actionType, // 'discard', 'pickup', or 'meld'
                value: actionValue, // e.g. '7' (rank melded)
                details: extraData // e.g. { cards: ['7', '7', 'Joker'] }
            }
        };

        fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');
        console.log(`[Recorder] Logged ${actionType} for ${playerName} to ${LOG_FILE}`);
    } catch (err) {
        console.error("Error recording turn:", err);
    }
}

module.exports = { recordHumanTurn };