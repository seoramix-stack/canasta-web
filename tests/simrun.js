// simulation_runner.improved.js (v2)

const fs = require('fs');
const path = require('path');
const MAX_CRASH_FILES = Number(process.env.MAX_CRASH_FILES ?? 5);
let crashFilesSaved = 0;
function tryRequire(relCandidates) {
  for (const rel of relCandidates) {
    try {
      return require(path.resolve(__dirname, rel));
    } catch (e) { /* try next */ }
  }
  throw new Error(`Cannot require any of: ${relCandidates.join(', ')}`);
}

const { CanastaGame } = tryRequire(['../game', './game', './game.js', '../game.js']);
const { CanastaBot } = tryRequire(['../bot', './bot', './bot.js', '../bot.js']);
const { ChaosBot } = tryRequire([
  './chaos_bot.improved.js',
  '../tests/chaos_bot.improved.js'
]);

const TOTAL_GAMES = Number(process.env.TOTAL_GAMES ?? 5000);
const MAX_TURNS = Number(process.env.MAX_TURNS ?? 300);
const LOG_INTERVAL = Number(process.env.LOG_INTERVAL ?? 100);
const SAVE_CRASHES = String(process.env.SAVE_CRASHES ?? '1') !== '0';
const BASE_SEED = Number(process.env.SEED ?? 1337);

// Game config
const PLAYER_COUNT = Number(process.env.PLAYER_COUNT ?? 4);
const HAND_SIZE = Number(process.env.HAND_SIZE ?? (PLAYER_COUNT === 2 ? 15 : 11));
const MIN_CANASTAS_OUT = Number(process.env.MIN_CANASTAS_OUT ?? 2);
const DRAW_COUNT = Number(process.env.DRAW_COUNT ?? 2);

// Deterministic RNG for replayability
function makeRng(seed) {
  let x = (seed >>> 0) || 123456789;
  return function rng() {
    x ^= (x << 13) >>> 0;
    x ^= (x >>> 17) >>> 0;
    x ^= (x << 5) >>> 0;
    return (x >>> 0) / 4294967296;
  };
}

async function callBotTurn(bot, game) {
  // Use the new executeTurn method we added to bot.js and ChaosBot
  if (bot && typeof bot.executeTurn === "function") {
    return await bot.executeTurn(game);
  }
  
  // Fallback for older bot versions if necessary
  if (bot && typeof bot.playTurnSync === "function") return bot.playTurnSync(game);
  throw new Error(`BOT_NO_TURN_METHOD seat=${bot?.seat ?? "?"}`);
}

const crashDir = path.resolve(__dirname, 'crash_logs');

let stats = {
  gamesPlayed: 0,
  cleanGames: 0,
  crashes: 0,
  stuckGames: 0,
  team1Wins: 0,
  team2Wins: 0,
  errorsByType: {},
  chaosMoves: 0,
  chaosUnexpectedSuccess: 0
};


console.log(`\n🤖 STARTING BOT SIMULATION: ${TOTAL_GAMES} GAMES 🤖`);
console.log(`--------------------------------------------------`);
console.log(`Config: PLAYER_COUNT=${PLAYER_COUNT} HAND_SIZE=${HAND_SIZE} MIN_CANASTAS_OUT=${MIN_CANASTAS_OUT} DRAW_COUNT=${DRAW_COUNT}`);
console.log(`Test:   MAX_TURNS=${MAX_TURNS} CHAOS_RATE=${process.env.CHAOS_RATE ?? 0.3} SEED=${BASE_SEED} SAVE_CRASHES=${SAVE_CRASHES}`);

const startTime = Date.now();

(async () => {
    try {
        for (let i = 1; i <= TOTAL_GAMES; i++) {
            await runSingleGame(i);

            if (i % LOG_INTERVAL === 0) {
                const progress = Math.round((i / TOTAL_GAMES) * 100);
                process.stdout.write(
                    `\rProgress: ${progress}% (${i}/${TOTAL_GAMES}) | Crashes: ${stats.crashes} | Stuck: ${stats.stuckGames}`
                );
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
        console.log(`   Chaos Moves:  ${stats.chaosMoves}`);

        if (stats.crashes > 0) {
            console.log(`\n❌ ERROR SUMMARY:`);
            console.table(stats.errorsByType);
            console.log(`\nCheck '${crashDir}' for detailed crash snapshots.`);
            process.exit(0); // Exit cleanly so we can see the results
        } else {
            console.log(`\n🎉 NO CRASHES FOUND! LOGIC SEEMS STABLE.`);
        }
    } catch (globalErr) {
        console.error("\n[FATAL RUNNER ERROR]:", globalErr);
    }
})();


// --- CORE SIMULATION LOGIC ---
async function runSingleGame(gameId) {
  const seed = (BASE_SEED + gameId) >>> 0;
  const prevRandom = Math.random;
  Math.random = makeRng(seed);

  const game = new CanastaGame({
    PLAYER_COUNT,
    HAND_SIZE,
    MIN_CANASTAS_OUT,
    DRAW_COUNT
  });
  game.resetMatch();

  const botType = (PLAYER_COUNT === 2) ? '2p' : '4p';

  const bots = Array.from({ length: PLAYER_COUNT }, (_, seat) => {
    const bot = (seat === 0) 
        ? new ChaosBot(seat, 'hard', botType) 
        : new CanastaBot(seat, 'hard', botType);
    
    bot.turboMode = true; // CRITICAL: Runs simulation at max speed
    return bot;
  });

  let turns = 0;
  stats.gamesPlayed++;

  try {
    while (game.turnPhase !== 'game_over') {
    if (turns >= MAX_TURNS) {
        // 1. Log the specific failure for detection
        const myTeamMelds = (game.currentPlayer % 2 === 0) ? game.team1Melds : game.team2Melds;
        const canastas = Object.values(myTeamMelds).filter(p => p.length >= 7).length;
        
        const errorMsg = `STUCK_LOOP: Seat ${game.currentPlayer} has ${game.players[game.currentPlayer].length} cards and ${canastas} Canastas.`;
        
        // 2. Report it to stats so you see it in the summary
        stats.errorsByType[errorMsg] = (stats.errorsByType[errorMsg] || 0) + 1;
        stats.stuckGames++;
        
        // 3. Save the crash log for this specific loop
        handleCrash(new Error(errorMsg), game, gameId, seed);
        
        // 4. BREAK this game to start the next one
        break; 
    }

      const currentPlayer = game.currentPlayer;
      const bot = bots[currentPlayer];

      // Use the async callBotTurn we created earlier
      await callBotTurn(bot, game); 

      validateGameIntegrity(game);
      turns++;
    }

    stats.cleanGames++;

    let s1 = 0, s2 = 0;
    if (game.finalScores) {
      s1 = game.finalScores.team1.total;
      s2 = game.finalScores.team2.total;
    }
    if (s1 > s2) stats.team1Wins++;
    else if (s2 > s1) stats.team2Wins++;

  } catch (err) {
    handleCrash(err, game, gameId, seed);
  } finally {
    Math.random = prevRandom;
  }
}

// --- VALIDATION LOGIC ---
function validateGameIntegrity(game) {
  if (!game || !game.config) throw new Error('INTEGRITY_FAIL_MISSING_GAME_OR_CONFIG');

  if (!Array.isArray(game.players) || game.players.length !== game.config.PLAYER_COUNT) {
    throw new Error(`INTEGRITY_FAIL_PLAYERS_LEN_${game.players?.length}_EXP_${game.config.PLAYER_COUNT}`);
  }

  if (typeof game.currentPlayer !== 'number' || game.currentPlayer < 0 || game.currentPlayer >= game.config.PLAYER_COUNT) {
    throw new Error(`INTEGRITY_FAIL_CURRENT_PLAYER_${game.currentPlayer}`);
  }

  if (!['draw', 'playing', 'game_over'].includes(game.turnPhase)) {
    throw new Error(`INTEGRITY_FAIL_BAD_PHASE_${game.turnPhase}`);
  }

  // Card conservation (deck+discard+hands+melds+red3s)
  let totalCards = 0;
  totalCards += game.deck.length;
  totalCards += game.discardPile.length;
  game.players.forEach(hand => totalCards += hand.length);

  [game.team1Melds, game.team2Melds].forEach(teamMelds => {
    Object.values(teamMelds || {}).forEach(pile => totalCards += pile.length);
  });

  totalCards += game.team1Red3s.length;
  totalCards += game.team2Red3s.length;

  if (totalCards !== 108) {
    throw new Error(`INTEGRITY_FAIL_CARD_COUNT_${totalCards}`);
  }

  if (Number.isNaN(game.cumulativeScores.team1) || Number.isNaN(game.cumulativeScores.team2)) {
    throw new Error('INTEGRITY_FAIL_SCORE_NAN');
  }
}

// --- CRASH HANDLING ---
function handleCrash(err, game, gameId, seed) {
  stats.crashes++;
  const errMsg = err.message || String(err);

  stats.errorsByType[errMsg] = (stats.errorsByType[errMsg] || 0) + 1;
  
  if (!SAVE_CRASHES) return;
  if (crashFilesSaved >= MAX_CRASH_FILES) return;
crashFilesSaved++;

  if (!fs.existsSync(crashDir)) fs.mkdirSync(crashDir, { recursive: true });

  const safeCard = (c) => c ? ({
    rank: c.rank, suit: c.suit,
    isWild: !!c.isWild, isRed3: !!c.isRed3
  }) : null;

  const crashData = {
    error: errMsg,
    stack: err.stack,
    seed,
    gameId,
    turnPhase: game.turnPhase,
    currentPlayer: game.currentPlayer,
    config: game.config,
    deckSize: game.deck.length,
    discardSize: game.discardPile.length,
    topDiscard: game.discardPile.length ? safeCard(game.discardPile[game.discardPile.length - 1]) : null,
    scores: game.cumulativeScores,
    hands: game.players.map(p => p.map(safeCard)),
    team1Red3s: game.team1Red3s.map(safeCard),
    team2Red3s: game.team2Red3s.map(safeCard),
    team1Melds: Object.fromEntries(Object.entries(game.team1Melds || {}).map(([r, pile]) => [r, pile.map(safeCard)])),
    team2Melds: Object.fromEntries(Object.entries(game.team2Melds || {}).map(([r, pile]) => [r, pile.map(safeCard)]))
  };

  const filename = `crash_game_${gameId}_seed_${seed}.json`;
  fs.writeFileSync(path.join(crashDir, filename), JSON.stringify(crashData, null, 2));
}
