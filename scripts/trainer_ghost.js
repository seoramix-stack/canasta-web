const fs = require('fs');
const { CanastaBot } = require('./bot.js');

// 1. Load recorded games (see previous response for recording format)
const humanGames = JSON.parse(fs.readFileSync('human_games.json', 'utf8'));

// 2. The Fitness Function: "How much do I look like my creator?"
function getAgreementScore(dnaCandidate) {
    let matches = 0;
    let totalDecisions = 0;
    
    // Create a temporary bot with this DNA
    const bot = new CanastaBot(0, 'hard', '2p', 'standard', dnaCandidate); //

    for (const turn of humanGames) {
        // Reconstruct the exact game state from your log
        const mockGame = reconstructGameState(turn.state);
        
        // Ask bot what IT would do
        const botIndex = bot.pickDiscard(mockGame); //
        const botCard = mockGame.players[0][botIndex];

        // Did it match your move?
        if (botCard.rank === turn.humanMoveRank) {
            matches++;
        }
        totalDecisions++;
    }

    return (matches / totalDecisions) * 100; // Returns % agreement
}

// 3. Simple Hill Climbing to optimize this
let currentBestDNA = loadDefaultDNA(); //
let bestScore = getAgreementScore(currentBestDNA);

console.log(`Initial agreement with human: ${bestScore.toFixed(2)}%`);

// Mutate and test loop
for (let i = 0; i < 5000; i++) {
    const mutantDNA = mutate(currentBestDNA); // Use your existing mutation logic
    const score = getAgreementScore(mutantDNA);

    if (score > bestScore) {
        bestScore = score;
        currentBestDNA = mutantDNA;
        console.log(`New best agreement: ${bestScore.toFixed(2)}%`);
    }
}