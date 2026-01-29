// services/gameLifecycle.js
const { calculateEloChange } = require('../elo');
/**
 * Sends a specific update to a single player (Private Information)
 */
function sendUpdate(io, games, gameId, socketId, seat) {
    const game = games[gameId];
    if (!game) return;

    const deck = game.deck || [];
    const pile = game.discardPile || [];
    const freezingCard = pile.find(c => c.isWild || c.isRed3) || null;

    io.to(socketId).emit('deal_hand', {
        seat: seat,
        hand: game.players[seat],
        currentPlayer: game.currentPlayer,
        phase: game.turnPhase,
        bankTimers: game.bankTimers,
        topDiscard: pile.length > 0 ? pile[pile.length - 1] : null,
        previousDiscard: pile.length > 1 ? pile[pile.length - 2] : null,
        freezingCard: freezingCard,
        isFrozen: !!freezingCard,
        team1Melds: game.team1Melds,
        team2Melds: game.team2Melds,
        team1Red3s: game.team1Red3s,
        team2Red3s: game.team2Red3s,
        names: game.names || [],
        scores: game.finalScores,
        cumulativeScores: game.cumulativeScores,
        handSizes: game.players.map(p => p.length),
        deckSize: deck.length,
        maxPlayers: game.config.PLAYER_COUNT,
        handBacks: game.players.map(p => p.map(c => c.deckType)),
        nextDeckColor: deck.length > 0 ? deck[0].deckType : 'Red'
    });
}

/**
 * Broadcasts the game state to ALL players in the room.
 * Also triggers Bot checks.
 */
function broadcastAll(io, games, gameBots, gameId, activeSeat, checkBotTurnFn) {
    const game = games[gameId];
    if (!game) return;

    game.lastActive = Date.now();
    const freezingCard = game.discardPile.find(c => c.isWild || c.isRed3);

    io.sockets.sockets.forEach((s) => {
        if (s.data.gameId === gameId) {
            let update = {
                bankTimers: game.bankTimers,
                currentPlayer: game.currentPlayer,
                phase: game.turnPhase,
                topDiscard: game.discardPile.slice(-1)[0] || null,
                previousDiscard: game.discardPile.slice(-2, -1)[0] || null,
                freezingCard: freezingCard,
                isFrozen: !!freezingCard,
                team1Melds: game.team1Melds,
                team2Melds: game.team2Melds,
                team1Red3s: game.team1Red3s,
                team2Red3s: game.team2Red3s,
                names: game.names,
                scores: game.finalScores,
                cumulativeScores: game.cumulativeScores,
                handSizes: game.players.map(p => p.length),
                deckSize: game.deck.length,
                handBacks: game.players.map(p => p.map(c => c.deckType)),
                nextDeckColor: game.deck.length > 0 ? game.deck[0].deckType : 'Red'
            };
            
            // Append private hand data if applicable
            if (s.data.seat !== undefined && game.players[s.data.seat]) {
                update.hand = game.players[s.data.seat];
            }
            s.emit('update_game', update);
        }
    });

    // Recursively check bots using the function passed from server.js
    if (checkBotTurnFn) checkBotTurnFn(gameId);
}

/**
 * Handles the logic when a round (or match) ends naturally via gameplay.
 */
async function handleRoundEnd(io, games, gameBots, User, gameId, DEV_MODE) {
    const game = games[gameId];
    if (!game) return;

    if (game.cleanupTimer) clearTimeout(game.cleanupTimer);
    
    // Auto-cleanup after 60s
    game.cleanupTimer = setTimeout(() => {
        delete games[gameId];
        delete gameBots[gameId];
    }, 60000);

    game.nextRoundReady = new Set();
    
    // Core Game Logic: Check if match is over
    const result = game.resolveMatchStatus();

    if (result.isMatchOver) {
        console.log(`[MATCH END] Game ${gameId} won by ${result.winner}`);
        game.matchIsOver = true;
        let ratingUpdates = {};

        if (!DEV_MODE && game.isRated) {
            ratingUpdates = await processRankedResults(game, User);
        }

        io.to(gameId).emit('match_over', {
            winner: result.winner,
            scores: game.cumulativeScores,
            lastRoundScores: game.finalScores,
            reason: "score_limit",
            names: game.names,
            ratings: ratingUpdates
        });
    } else {
        // Just a round end, not match end
        if (!game.finalScores) game.finalScores = game.calculateScores();
        // We pass null for the bot function to avoid infinite loops on game over
        broadcastAll(io, games, gameBots, gameId, null, null);
    }
}

/**
 * Handles the logic when a player disconnects/quits and timer runs out.
 */
async function handleForfeit(io, games, gameBots, User, gameId, loserSeat, DEV_MODE) {
    const game = games[gameId];
    if (!game) return;

    const playerCount = game.config.PLAYER_COUNT;
    const isTeam1Loser = (playerCount === 4) ? (loserSeat === 0 || loserSeat === 2) : (loserSeat === 0);
    const winnerTeam = isTeam1Loser ? "team2" : "team1";
    
    console.log(`[FORFEIT] Game ${gameId} ended. Leaver: Seat ${loserSeat}`);
    game.matchIsOver = true;

    io.to(gameId).emit('match_over', {
        winner: winnerTeam,
        scores: game.cumulativeScores,
        reason: "forfeit",
        names: game.names
    });

    if (!DEV_MODE && game.isRated) {
        try {
            await processForfeitElo(game, User, loserSeat, isTeam1Loser, io, gameId);
        } catch (e) { console.error("Forfeit Elo Error:", e); }
    }

    if (game.cleanupTimer) clearTimeout(game.cleanupTimer);
    game.cleanupTimer = setTimeout(() => {
        console.log(`[CLEANUP] Deleting Game ${gameId}`);
        delete games[gameId];
        delete gameBots[gameId];
    }, 10000);
}

// --- INTERNAL ELO HELPERS (Not exported directly) ---

async function processRankedResults(game, User) {
    const updates = {};
    try {
        const players = {};
        const playerCount = game.config.PLAYER_COUNT;
        
        // Fetch Users
        for (let i = 0; i < playerCount; i++) {
            const token = (game.playerTokens && game.playerTokens[i]) ? game.playerTokens[i] : null;
            if (token) {
                const userDoc = await User.findOne({ token: token });
                if (userDoc) players[i] = userDoc;
            }
        }
        
        if (Object.keys(players).length === playerCount) {
            // Calculate Ratings
            let team1Rating, team2Rating;
            if (playerCount === 2) {
                team1Rating = players[0].stats.rating;
                team2Rating = players[1].stats.rating;
            } else {
                team1Rating = (players[0].stats.rating + players[2].stats.rating) / 2;
                team2Rating = (players[1].stats.rating + players[3].stats.rating) / 2;
            }

            const s1 = game.cumulativeScores.team1;
            const s2 = game.cumulativeScores.team2;
            const delta = calculateEloChange(team1Rating, team2Rating, s1, s2);
            const savePromises = [];

            // Apply Updates
            for (let seat = 0; seat < playerCount; seat++) {
                const isTeam1 = (seat === 0 || seat === 2);
                const change = isTeam1 ? delta : -delta;
                
                players[seat].stats.rating += change;
                const winnerTeam = (s1 > s2) ? 0 : 1; 
                const won = (winnerTeam === 0 && isTeam1) || (winnerTeam === 1 && !isTeam1);
                
                if (won) players[seat].stats.wins++;
                else players[seat].stats.losses++;

                updates[seat] = {
                    newRating: Math.round(players[seat].stats.rating),
                    delta: change
                };
                savePromises.push(players[seat].save());
            }
            await Promise.all(savePromises);
            console.log("[ELO] Ratings updated.");
        }
    } catch (e) { console.error("Stats/Elo update failed:", e); }
    return updates;
}

async function processForfeitElo(game, User, loserSeat, isTeam1Loser, io, gameId) {
    const playerCount = game.config.PLAYER_COUNT;
    const players = {};
    
    // Fetch Users
    for (let i = 0; i < playerCount; i++) {
        const token = (game.playerTokens && game.playerTokens[i]) ? game.playerTokens[i] : null;
        if (!token) continue;
        const user = await User.findOne({ token });
        if (user) players[i] = user;
    }

    let team1Rating, team2Rating;
    if (playerCount === 2) {
        team1Rating = (players[0]?.stats.rating ?? 1200);
        team2Rating = (players[1]?.stats.rating ?? 1200);
    } else {
        const p0 = (players[0]?.stats.rating ?? 1200);
        const p2 = (players[2]?.stats.rating ?? 1200);
        const p1 = (players[1]?.stats.rating ?? 1200);
        const p3 = (players[3]?.stats.rating ?? 1200);
        team1Rating = (p0 + p2) / 2;
        team2Rating = (p1 + p3) / 2;
    }

    const team1Won = !isTeam1Loser;
    // Calculate theoretical change if it was a stomp (5000 - 0)
    const team1Delta = calculateEloChange(team1Rating, team2Rating, team1Won ? 5000 : 0, team1Won ? 0 : 5000);
    const baseLoss = Math.round(team1Won ? -team1Delta : team1Delta); 
    const LEAVER_PENALTY_MULTIPLIER = 1.5;
    const updates = {};

    for (let seat = 0; seat < playerCount; seat++) {
        if (!players[seat]) continue;
        const onLosingTeam = (playerCount === 2)
            ? (seat === loserSeat)
            : ((isTeam1Loser && (seat === 0 || seat === 2)) || (!isTeam1Loser && (seat === 1 || seat === 3)));

        if (onLosingTeam) {
            if (seat === loserSeat) {
                const penalty = Math.round(baseLoss * LEAVER_PENALTY_MULTIPLIER);
                players[seat].stats.rating += penalty;
                players[seat].stats.losses++;
                updates[seat] = { delta: penalty, newRating: players[seat].stats.rating };
            } else if (playerCount === 4) {
                // Partner isn't punished
                updates[seat] = { delta: 0, newRating: players[seat].stats.rating };
            } else {
                players[seat].stats.rating += baseLoss;
                players[seat].stats.losses++;
                updates[seat] = { delta: baseLoss, newRating: players[seat].stats.rating };
            }
        } else {
            const winPoints = Math.abs(baseLoss);
            players[seat].stats.rating += winPoints;
            players[seat].stats.wins++;
            updates[seat] = { delta: winPoints, newRating: players[seat].stats.rating };
        }
        await players[seat].save();
    }
    io.to(gameId).emit('rating_update', updates);
}

function applyPartnerPenalty(io, games, gameId, seat) {
    const game = games[gameId];
    if (!game) return;

    const teamKey = (seat % 2 === 0) ? 'team1' : 'team2';
    game.cumulativeScores[teamKey] -= 100;
    
    const name = (game.names && game.names[seat]) ? game.names[seat] : `Player ${seat+1}`;
    
    io.to(gameId).emit('penalty_notification', { 
        message: `${name} ignored partner! -100 pts.`
    });
}

module.exports = {
    sendUpdate,
    broadcastAll,
    handleRoundEnd,
    handleForfeit,
    applyPartnerPenalty
};