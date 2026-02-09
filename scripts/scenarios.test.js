const { CanastaBot } = require('./bot.js');

const mockGame = {
    players: [
        [{rank: '2', isWild: true}, {rank: '4'}, {rank: '5'}] // Bot Hand
    ],
    discardPile: [{rank: '10'}, {rank: 'J'}],
    team1Melds: {},
    team2Melds: { '4': [{}, {}, {}] }, // Enemy has 4s
    config: { PLAYER_COUNT: 2, MIN_CANASTAS_OUT: 1 },
    botDelayBase: 0
};

const bot = new CanastaBot(0, 'hard', '2p', 'standard');
const decision = bot.pickDiscard(mockGame);

// ASSERTION: The bot should NOT pick index 0 (the wild card)
if (decision === 0) {
    console.error("❌ TEST FAILED: Bot discarded a wild card under threat!");
} else {
    console.log("✅ TEST PASSED: Bot protected the wild card.");
}