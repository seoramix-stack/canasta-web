// recorder.js - v3: Enhanced for Bot Evolution & Strategy Analysis
const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'human_training_data.jsonl');

function getCardValue(rank) {
    if (rank === 'Joker') return 50;
    if (rank === '2' || rank === 'A') return 20;
    if (['K', 'Q', 'J', '10', '9', '8'].includes(rank)) return 10;
    if (['7', '6', '5', '4', '3'].includes(rank)) return 5;
    return 0;
}

function recordHumanTurn(game, seat, actionType, actionValue, playerName, extraData = {}) {
    try {
        const isBot = playerName.toLowerCase().includes('bot');
        const team1Score = game.cumulativeScores.team1;
        const team2Score = game.cumulativeScores.team2;
        
        const stateSnapshot = {
            turnNumber: game.turnCounter || 0,
            handSize: game.players[seat].length,
            allHandSizes: game.players.map(p => p.length),
            pileSize: game.discardPile.length,
            pileValue: game.discardPile.reduce((sum, c) => sum + getCardValue(c.rank), 0),
            
            // Critical for improving DNA: compare board state
            myMelds: JSON.parse(JSON.stringify((seat % 2 === 0) ? game.team1Melds : game.team2Melds)),
            enemyMelds: JSON.parse(JSON.stringify((seat % 2 === 0) ? game.team2Melds : game.team1Melds)),
            
            // Track if the pile is currently frozen
            isFrozen: (game.discardPile.some(c => c.isWild) || Object.keys(game.team1Melds).length === 0 || Object.keys(game.team2Melds).length === 0),
            
            scoreLead: (seat % 2 === 0) ? (team1Score - team2Score) : (team2Score - team1Score)
        };

        const logEntry = {
            timestamp: Date.now(),
            player: playerName,
            isBot: isBot,
            action: {
                type: actionType, 
                value: actionValue, 
                // Capture bot's internal reasoning if available
                botConfidence: extraData.winRate || null,
                botScore: extraData.score || null
            },
            state: stateSnapshot
        };

        // If it's a "game_over" action, record final stats for DNA weighting
        if (actionType === 'game_over') {
            logEntry.finalStats = game.calculateScores();
        }

        fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + '\n');
    } catch (err) {
        console.error("Error recording turn:", err);
    }
}

module.exports = { recordHumanTurn };