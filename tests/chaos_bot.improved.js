// tests/chaos_bot.improved.js
const path = require("path");

function tryRequire(relCandidates) {
  for (const rel of relCandidates) {
    try {
      return require(path.resolve(__dirname, rel));
    } catch (e) {}
  }
  throw new Error(`Cannot require any of: ${relCandidates.join(", ")}`);
}

const { CanastaBot } = tryRequire(["../bot", "./bot", "./bot.js", "../bot.js"]);

function callBaseBotTurn(self, game) {
  const p = CanastaBot.prototype;
  if (typeof p.executeTurn === "function") return p.executeTurn.call(self, game);
  throw new Error("CANASTA_BOT_NO_TURN_METHOD");
}

class ChaosBot extends CanastaBot {
  constructor(seat, difficulty, type, opts = {}) {
    super(seat, difficulty, type);
    this.chaosRate = Number.isFinite(opts.chaosRate)
      ? opts.chaosRate
      : Number(process.env.CHAOS_RATE ?? 0.1);
    this.stats = { chaosMoves: 0, unexpectedSuccess: 0 };
  }

 // This correctly overrides the base bot and handles chaos logic asynchronously
  async executeTurn(game, callback) {
  if (Math.random() < this.chaosRate) {
    this.executeChaosMove(game); // Call the helper at line 60
  } else {
    await super.executeTurn(game);
  }
  if (callback) callback(this.seat);
}

  executeChaosMove(game) {
    this.stats.chaosMoves++;

    const actions = [
      () => game.discardFromHand(this.seat, 99),
      () => game.drawFromDeck(this.seat),
      () => game.meldCards(this.seat, [0], "4"),
      () => game.meldCards(this.seat, [0, 1, 2], "X"),
      () => game.discardFromHand(this.seat, 0),
      () => game.pickupDiscardPile(this.seat),
    ];

    try {
      const res = actions[Math.floor(Math.random() * actions.length)]();
      if (res && res.success === true) this.stats.unexpectedSuccess++;
    } catch (e) {
      // illegal actions may throw, that’s fine
    }
  }
}

module.exports = { ChaosBot };
