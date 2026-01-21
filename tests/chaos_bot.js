// tests/chaos_bot.js
const { CanastaBot } = require('../bot');

class ChaosBot extends CanastaBot {
    constructor(seat, difficulty, type) {
        super(seat, difficulty, type);
        this.chaosRate = 0.1; // 10% chance to do something illegal
    }

    playTurnSync(game) {
        if (Math.random() < this.chaosRate) {
            this.executeChaosMove(game);
        } else {
            // Play normally most of the time so the game actually progresses
            super.playTurnSync(game);
        }
    }

    executeChaosMove(game) {
        const action = Math.floor(Math.random() * 5);
        
        try {
            switch(action) {
                case 0: // ILLEGAL DISCARD
                    // Try to discard a card index that doesn't exist (e.g., 99)
                    game.discardFromHand(this.seat, 99); 
                    break;
                
                case 1: // PLAY OUT OF TURN
                    // Force a draw even if it's not my turn
                    game.drawFromDeck(this.seat); 
                    break;

                case 2: // ILLEGAL MELD (WRONG CARDS)
                    // Try to meld a single card (needs 3)
                    game.meldCards(this.seat, [0], '4'); 
                    break;

                case 3: // ILLEGAL MELD (WRONG RANK)
                    // Try to meld cards as "Joker" rank (invalid rank string)
                    game.meldCards(this.seat, [0, 1, 2], 'Joker'); 
                    break;

                case 4: // DISCARD WHILE DRAWING
                    // Try to discard during the 'draw' phase
                    game.discardFromHand(this.seat, 0); 
                    break;
            }
        } catch (e) {
            // We EXPECT errors here. If the game throws an error, that's GOOD.
            // If the game crashes or state becomes corrupt, that's a BUG.
        }
    }
}

module.exports = { ChaosBot };