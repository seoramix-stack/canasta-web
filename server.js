// server.js
require('dotenv').config(); // Load environment variables
const { CanastaBot } = require('./bot');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { CanastaGame } = require('./game'); 

const app = express();
app.use(express.json()); // Allows parsing JSON bodies
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public')); 

// --- 1. DATABASE CONNECTION (MongoDB) ---
// --- MOCK DATABASE (In-Memory) ---
// This temporarily replaces MongoDB so you can test immediately
const localUsers = {}; 

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.json({ success: false, message: "Missing fields" });

    // Check mock storage
    if (localUsers[username]) {
        return res.json({ success: false, message: "Username taken" });
    }

    // Create new mock user
    const token = 'user_' + Math.random().toString(36).substr(2, 9);
    localUsers[username] = { password: password, token: token };

    console.log(`[AUTH] Mock Register: ${username}`);
    res.json({ success: true, token: token, username: username });
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    const user = localUsers[username];

    // Check mock storage
    if (user && user.password === password) {
        console.log(`[AUTH] Mock Login: ${username}`);
        res.json({ success: true, token: user.token, username: username });
    } else {
        return res.json({ success: false, message: "Invalid credentials" });
    }
});


// --- GLOBAL STATE ---

const games = {};      // Stores game instances: { 'game_id': new CanastaGame() }
const gameBots = {};   // Stores bots per game: { 'game_id': { 1: Bot, 2: Bot... } }
const playerSessions = {};
let waitingPlayers = []; // This can stay global for the "public lobby"

// --- AUTH ROUTES ---
io.on('connection', async (socket) => {
    console.log('User connected:', socket.id);
    const token = socket.handshake.auth.token;
    const handshakeUser = socket.handshake.auth.username;
    if (token) {
        if (!playerSessions[token]) {
            playerSessions[token] = {};
        }
        // Use the name sent from client, or fallback to existing, or "Player"
        if (handshakeUser) {
            playerSessions[token].username = handshakeUser;
        }
    }

    // --- RECONNECTION LOGIC (FIXED) ---
    // 1. Check if we know this token
    const session = playerSessions[token];

    // 2. Check if the game they were in still exists
    if (session && games[session.gameId]) {
        // Restore context
        socket.data.gameId = session.gameId;
        socket.data.seat = session.seat;
        socket.join(session.gameId); // IMPORTANT: Re-join the room

        console.log(`Player reconnected to Game ${session.gameId}, Seat ${session.seat}`);
        
        // Send update
        sendUpdate(session.gameId, socket.id, session.seat);
    }

    // 1. HANDLE JOIN (Merged Logic)
    socket.on('request_join', (data) => {
        // A. Handle "Force New Game" requests
        // If user is already in a game memory but asks for a NEW mode, remove them from the old one.
        if (socket.data.gameId && games[socket.data.gameId]) {
             console.log(`[Switch] User switching from Game ${socket.data.gameId} to new ${data.mode} game.`);
             
             // Leave the old room
             socket.leave(socket.data.gameId);
             
             // Clear the old session from memory
             const token = socket.handshake.auth.token;
             if (token && playerSessions[token]) {
                 delete playerSessions[token];
             }
             
             // Reset socket data
             socket.data.gameId = null;
        }

        // B. Proceed to Join
        if (data.mode === 'bot') {
            startBotGame(socket, data.difficulty || 'medium');
        } else {
            joinGlobalGame(socket);
        }
    });

    // 2. GAME ACTIONS
    socket.on('act_ready', (data) => {
        const gameId = socket.data.gameId;
        const game = games[gameId];

        if (!game) return;
        
        // 1. Mark seat ready
        if (!game.readySeats) game.readySeats = new Set();
        game.readySeats.add(data.seat);

        // Auto-ready Bots (if any)
        if (gameBots[gameId]) {
            Object.keys(gameBots[gameId]).forEach(botSeat => {
                game.readySeats.add(parseInt(botSeat));
            });
        }

        // 2. BROADCAST STATUS (So clients can update lights)
        // Convert Set to Array for sending
        const readyArray = Array.from(game.readySeats);
        io.to(gameId).emit('ready_status', { readySeats: readyArray });

        console.log(`[Ready] Seat ${data.seat} Ready. Total: ${game.readySeats.size}/4`);

        // 3. START GAME if 4/4
        if (game.readySeats.size === 4 && game.currentPlayer === -1) {
             console.log(`[Start] All players ready!`);
             
             if (game.roundStarter === undefined) game.roundStarter = 0;
             game.currentPlayer = game.roundStarter;
             game.turnPhase = 'draw'; 
             game.processingTurnFor = null;
            
             broadcastAll(gameId, game.currentPlayer); 
        }
    });

    socket.on('act_draw', (data) => {
    const gameId = socket.data.gameId;
    const game = games[gameId]; 

    if (!game) return;

    // Execute Logic
    const result = game.drawFromDeck(data.seat);

    if (result.success) {
        broadcastAll(gameId, data.seat); 
    } else {
        // --- NEW: Tell the client WHY it failed ---
        console.log(`[Draw Failed] Seat ${data.seat}: ${result.message}`);
        socket.emit('error_message', result.message);
    }
});
    
    socket.on('act_pickup', (data) => {
    const gameId = socket.data.gameId; // Get the ID attached to this user
    const game = games[gameId];        // Look up the specific game instance

    if (game) { 
        let res = game.pickupDiscardPile(data.seat); 
        // Note: We now pass gameId to broadcastAll so it updates the correct room
        res.success ? broadcastAll(gameId, data.seat) : socket.emit('error_message', res.message); 
    }
});
    
    socket.on('act_meld', (data) => { 
    const gameId = socket.data.gameId;
    const game = games[gameId];

    if (game) { 
        let res = game.meldCards(data.seat, data.indices, data.targetRank); 
        res.success ? broadcastAll(gameId, data.seat) : socket.emit('error_message', res.message); 
    }
});
    
    socket.on('act_discard', (data) => { 
    const gameId = socket.data.gameId;
    const game = games[gameId];

    if (game) { 
        let res = game.discardFromHand(data.seat, data.index); 
        res.success ? broadcastAll(gameId, data.seat) : socket.emit('error_message', res.message); 
    }
});
    
    socket.on('act_open_game', (data) => { 
    const gameId = socket.data.gameId;
    const game = games[gameId];

    if (game) { 
        let res = game.processOpening(data.seat, data.melds, data.pickup); 
        if (res.success) {
            broadcastAll(gameId, data.seat); 
        } else {
            socket.emit('error_message', res.message); 
        }
    }
});
    
    socket.on('act_next_round', () => {
        const gameId = socket.data.gameId;
        const game = games[gameId];

        // [DEBUG] Diagnostic Logs
        if (!game) {
            console.log(`[DEBUG-NEXT] Click ignored: Game ${gameId} not found (Match might be over).`);
            socket.emit('error_message', "Game not found. The match may have ended.");
            return;
        }
        
        console.log(`[DEBUG-NEXT] Request received. Phase: ${game.turnPhase}, Transitioning: ${game.isTransitioning}`);

        // Check game specific flag
        if (game.turnPhase === "game_over" && !game.isTransitioning) {
            game.isTransitioning = true;
            console.log(`[DEBUG-NEXT] Starting next round logic...`);
            
            // Check Match Over
            let matchResult = game.startNextRound(); 

            if (matchResult) {
    console.log(`[DEBUG-NEXT] MATCH ENDED! Winner: Team ${matchResult}`);
    const winnerTeam = (matchResult === 'team1') ? 0 : 1; 

    io.in(gameId).fetchSockets().then(sockets => {
        sockets.forEach(async (s) => {
            const seat = s.data.seat;
            const token = s.handshake.auth.token;
            if (!token) return;

            const isTeam1 = (seat === 0 || seat === 2);
            const playerWon = (winnerTeam === 0 && isTeam1) || (winnerTeam === 1 && !isTeam1);
            
            // MongoDB Update
            try {
                if (playerWon) {
                    await User.updateOne({ token: token }, { $inc: { "stats.wins": 1 } });
                } else {
                    await User.updateOne({ token: token }, { $inc: { "stats.losses": 1 } });
                }
            } catch (e) {
                console.error("Stats update failed", e);
            }
        });
    });       
                
                // 1. Send the Final Data
                io.to(gameId).emit('match_over', { 
                    winner: matchResult, 
                    scores: game.cumulativeScores 
                });
                
                // 2. CLEANUP (DELAYED)
                // Wait 60 seconds before deleting the game from memory.
                // This prevents "Game Not Found" errors if users refresh the victory screen.
                setTimeout(() => {
                    delete games[gameId];
                    delete gameBots[gameId];
                    console.log(`[SERVER] Game ${gameId} cleaned up.`);
                }, 60000); // 1 minute delay
                
            } else {
                console.log(`[DEBUG-NEXT] Resetting for new round...`);
                // Next Round Setup
                game.readySeats = new Set(); 
                game.currentPlayer = -1;     
                game.isTransitioning = false;
                
                // FORCE UNLOCK BOTS (Just in case)
                game.processingTurnFor = null;

                // Re-deal: Iterate only sockets in this room
                io.in(gameId).fetchSockets().then(sockets => {
                    console.log(`[DEBUG-NEXT] Sending new hands to ${sockets.length} players.`);
                    sockets.forEach(s => {
                        if (s.data.seat !== undefined) {
                            sendUpdate(gameId, s.id, s.data.seat);
                        }
                    });
                });
            }
        } else {
            console.log(`[DEBUG-NEXT] Ignored. Conditions not met.`);
            // [OPTIONAL] Force fix if it's stuck
            if (game.turnPhase === "game_over" && game.isTransitioning) {
                 console.log(`[DEBUG-NEXT] FIX: Resetting stuck transition flag.`);
                 game.isTransitioning = false;
            }
        }
    });
// --- NEW HANDLER: LEAVE GAME ---
    socket.on('leave_game', () => {
        const gameId = socket.data.gameId;
        const token = socket.handshake.auth.token;

        console.log(`[Leave] User requesting to leave Game ${gameId}`);

        // 1. Remove from Global Session Memory
        if (token && playerSessions[token]) {
            delete playerSessions[token];
        }

        // 2. Clear Socket Data
        socket.data.gameId = null;
        socket.data.seat = null;
        
        // 3. Leave the Socket Room
        if (gameId) {
            socket.leave(gameId);
            // Also remove from lobby if they were just waiting
            waitingPlayers = waitingPlayers.filter(s => s.id !== socket.id);
        }
    });
    socket.on('disconnect', () => {
        waitingPlayers = waitingPlayers.filter(s => s.id !== socket.id);
    });
});

// --- HELPER FUNCTIONS ---

function generateGameId() {
    return 'game_' + Math.random().toString(36).substr(2, 9);
}

function startBotGame(humanSocket, difficulty) {
    const gameId = generateGameId();
    
    // 1. Create the Game Instance
    games[gameId] = new CanastaGame();
    games[gameId].resetMatch();
    
    // 2. Initialize Bots container for this specific game
    gameBots[gameId] = {};

    // 3. Setup Human
    humanSocket.join(gameId); // Socket.IO room join
    humanSocket.data.seat = 0;
    humanSocket.data.gameId = gameId; // IMPORTANT: Attach ID to socket
    const token = humanSocket.handshake.auth.token;
    if (token) {
        // We check if we already have a username stored for this token
        // If yes, we keep it. If no, we default to "Player".
        const existingName = playerSessions[token] ? playerSessions[token].username : "Player";

        playerSessions[token] = { 
            gameId: gameId, 
            seat: 0, 
            username: existingName // We explicitly pass the name back into the new session
        };
    }

    // 4. Create Bots
    for (let i = 1; i <= 3; i++) {
        gameBots[gameId][i] = new CanastaBot(i, difficulty);
    }

    // 5. Start
    games[gameId].currentPlayer = 0;
    games[gameId].roundStarter = 0;
    console.log(`[DEBUG-INIT] Game ${gameId} Started. Initial Starter: ${games[gameId].roundStarter}, Current: ${games[gameId].currentPlayer}`);
    sendUpdate(gameId, humanSocket.id, 0); // Pass gameId to update function
}

function joinGlobalGame(socket) {
    // 1. Add player to lobby if not already there
    if (waitingPlayers.find(s => s.id === socket.id)) return;
    waitingPlayers.push(socket);

    // 2. Check if we have 4 players to start a match
    if (waitingPlayers.length === 4) {
        const gameId = generateGameId();
        
        // Create the game instance
        games[gameId] = new CanastaGame();
        games[gameId].resetMatch();
        games[gameId].readySeats = new Set();
        games[gameId].currentPlayer = -1;
        
        // Loop through the 4 waiting players and assign them seats
        waitingPlayers.forEach((p, i) => {
            p.join(gameId); // Socket join room
            p.data.seat = i;
            p.data.gameId = gameId;

            const token = p.handshake.auth.token;
            
            // Save session so they can reconnect if they refresh
            if (token) {
                 // We preserve the username if we cached it earlier
                 const cachedName = playerSessions[token] ? playerSessions[token].username : null;
                 playerSessions[token] = { 
                     gameId: gameId, 
                     seat: i,
                     username: cachedName 
                 }; 
            }
            
            sendUpdate(gameId, p.id, i);
        });
        
        // Clear the lobby
        waitingPlayers = []; 
    }
}

function getFreezingCard(game) {
    if (!game.discardPile || game.discardPile.length === 0) return null;
    for (let i = game.discardPile.length - 1; i >= 0; i--) {
        let c = game.discardPile[i];
        if (c.isWild || c.isRed3) return c;
    }
    return null;
}

function sendUpdate(gameId, socketId, seat) {
    const game = games[gameId]; // Look up the specific game
    if (!game) return;

    const pile = game.discardPile;
    const topCard = pile.length > 0 ? pile[pile.length-1] : null;
    const prevCard = pile.length > 1 ? pile[pile.length-2] : null; 
    const names = getPlayerNames(gameId);
    const freezingCard = getFreezingCard(game);
    const isFrozen = !!freezingCard;

    io.to(socketId).emit('deal_hand', { 
        seat: seat, 
        hand: game.players[seat],
        currentPlayer: game.currentPlayer, 
        phase: game.turnPhase,
        topDiscard: topCard,
        previousDiscard: prevCard,
        freezingCard: freezingCard,
        team1Melds: game.team1Melds, 
        team2Melds: game.team2Melds,
        team1Red3s: game.team1Red3s, 
        team2Red3s: game.team2Red3s,
        names: names,
        scores: game.finalScores, 
        cumulativeScores: game.cumulativeScores,
        isFrozen: isFrozen, 
        handSizes: game.players.map(p => p.length),
        deckSize: game.deck.length
    });
}

function broadcastAll(gameId, activeSeat) {
    const game = games[gameId]; // Look up the specific game
    if (!game) return;

    // --- SHARED DATA (Same for everyone) ---
    const pile = game.discardPile;
    const topCard = pile.length > 0 ? pile[pile.length-1] : null;
    const prevCard = pile.length > 1 ? pile[pile.length-2] : null;
    const freezingCard = getFreezingCard(game);
    const isFrozen = !!freezingCard;
    const handSizes = game.players.map(p => p.length);
    const names = getPlayerNames(gameId);

    // --- PER-PLAYER UPDATE ---
    io.sockets.sockets.forEach((s) => {
        // Only update players currently in this specific game
        if (s.data.gameId === gameId) {
            let update = {
                currentPlayer: game.currentPlayer, 
                phase: game.turnPhase,
                topDiscard: topCard,
                previousDiscard: prevCard,
                freezingCard: freezingCard,
                team1Melds: game.team1Melds, 
                team2Melds: game.team2Melds,
                team1Red3s: game.team1Red3s, 
                team2Red3s: game.team2Red3s,
                names: names,
                scores: game.finalScores, 
                cumulativeScores: game.cumulativeScores,
                isFrozen: isFrozen, 
                handSizes: handSizes,
                deckSize: game.deck.length
            };
            
            // Attach PRIVATE hand for this specific player
            let seat = s.data.seat;
            if (seat !== undefined && game.players[seat]) {
                update.hand = game.players[seat];
            }
            
            s.emit('update_game', update);
        }
    });

    // Trigger bot if it's their turn
    checkBotTurn(gameId);
}

function checkBotTurn(gameId) {
    const game = games[gameId];
    
    // Check if this game exists and has bots assigned
    if (!game || !gameBots[gameId]) return;

    let curr = game.currentPlayer;
    let bot = gameBots[gameId][curr];

    // --- NEW LOGIC: PREVENT INFINITE LOOP ---
    // If we are already processing this specific player's turn, STOP.
    if (game.processingTurnFor === curr) return; 

    if (bot) {
        // Lock this turn so we don't trigger it again during intermediate updates
        game.processingTurnFor = curr;

        // Run bot logic
        bot.executeTurn(game, (updatedSeat) => {
            // Callback: Bot finished a step (Draw, Meld, or Discard)
            broadcastAll(gameId, updatedSeat); 
        });
    } else {
        // It's a human's turn, so clear the lock
        game.processingTurnFor = null;
    }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => { 
    console.log(`Server running on port ${PORT}`);
});

async function cacheUsernames(gameId) {
    // This is a helper you can call when a game starts to load names into memory
    // For now, we can modify getPlayerNames to query DB if needed, but that's slow.
    // simpler strategy: Trust the client provided username or fetch on login.
}

// SIMPLIFIED getPlayerNames for now
function getPlayerNames(gameId) {
    const names = ["Bot 1", "Bot 2", "Bot 3", "Bot 4"];
    
    // We can try to look up active sessions
    Object.keys(playerSessions).forEach(token => {
        const session = playerSessions[token];
        if (session.gameId === gameId && session.username) {
             names[session.seat] = session.username;
        }
    });
    return names;
}

// PREVENT SLEEP MODE (Self-Ping)
const https = require('https'); // Use 'http' if running locally, 'https' for Render

setInterval(() => {
    const url = 'https://la-canasta.onrender.com/'; // <--- REPLACE THIS WITH YOUR ACTUAL RENDER URL
    
    https.get(url, (res) => {
        console.log(`[Keep-Alive] Ping sent to ${url}. Status: ${res.statusCode}`);
    }).on('error', (e) => {
        console.error(`[Keep-Alive] Error: ${e.message}`);
    });

}, 14 * 60 * 1000); // 14 minutes in milliseconds