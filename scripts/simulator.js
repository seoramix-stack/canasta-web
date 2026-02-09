const { CanastaBot } = require('./bot.js');
const { GameEngine } = require('./gameLogic.js'); // Assuming your engine is exportable

function runTournament(generations = 100) {
    let results = { botA: 0, botB: 0 };

    for (let i = 0; i < generations; i++) {
        // Force Turbo Mode to ignore 'await wait()'
        const botA = new CanastaBot(0, 'hard', '2p', 'standard', dnaVersionA);
        const botB = new CanastaBot(1, 'hard', '2p', 'standard', dnaVersionB);
        botA.turboMode = true;
        botB.turboMode = true;

        const game = new GameEngine([botA, botB]);
        const winner = game.playUntilEnd(); // Sync version of your game loop
        winner === 0 ? results.botA++ : results.botB++;
    }
    console.table(results);
}