// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose'); 
const { CanastaGame } = require('./game'); 
const { CanastaBot } = require('./bot');

const app = express();
app.use(express.json());
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public')); 

// --- 2. MONGODB & DEV MODE CONFIGURATION ---
const MONGO_URI = process.env.MONGO_URI; 
let DEV_MODE = false; // Flag to track if we are testing locally

if (!MONGO_URI) {
    console.log("⚠️  [SYSTEM] MONGO_URI missing. Starting in DEV MODE.");
    console.log("👉  [SYSTEM] Login bypassed: Use ANY username/password.");
    console.log("👉  [SYSTEM] Stats will not be saved.");
    DEV_MODE = true;
} else {
    mongoose.connect(MONGO_URI)
        .then(() => console.log("[DB] Connected to MongoDB"))
        .catch(err => console.error("[DB] Connection Error:", err));
}

// --- 3. USER SCHEMA (Only if NOT in Dev Mode) ---
let User;
if (!DEV_MODE) {
    const userSchema = new mongoose.Schema({
        username: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        token: String,
        stats: {
            wins: { type: Number, default: 0 },
            losses: { type: Number, default: 0 },
            rating: { type: Number, default: 1200 }
        }
    });
    User = mongoose.model('User', userSchema);
}

// --- AUTH ROUTES ---
app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    
    // [DEV MODE BYPASS]
    if (DEV_MODE) {
        const token = 'dev_token_' + Math.random().toString(36).substr(2, 9);
        console.log(`[DEV-AUTH] Register Mock: ${username}`);
        return res.json({ success: true, token: token, username: username });
    }

    if (!username || !password) return res.json({ success: false, message: "Missing fields" });

    try {
        const existing = await User.findOne({ username });
        if (existing) return res.json({ success: false, message: "Username taken" });

        const token = 'user_' + Math.random().toString(36).substr(2, 9);
        const newUser = new User({ username, password, token });
        await newUser.save();

        console.log(`[AUTH] Registered: ${username}`);
        res.json({ success: true, token: token, username: username });
    } catch (e) {
        console.error("Register Error:", e);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    // [DEV MODE BYPASS]
    if (DEV_MODE) {
        const token = 'dev_token_' + Math.random().toString(36).substr(2, 9);
        console.log(`[DEV-AUTH] Login Mock: ${username}`);
        return res.json({ success: true, token: token, username: username });
    }

    try {
        const user = await User.findOne({ username });
        if (user && user.password === password) {
            console.log(`[AUTH] Login: ${username}`);
            res.json({ success: true, token: user.token, username: username });
        } else {
            res.json({ success: false, message: "Invalid credentials" });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// --- GLOBAL STATE ---

const games = {};      
const gameBots = {};   
const playerSessions = {};
let waitingPlayers = []; 

// --- SOCKET CONNECTION ---
io.on('connection', async (socket) => {
    console.log('User connected:', socket.id);
    const token = socket.handshake.auth.token;
    const handshakeUser = socket.handshake.auth.username;
    if (token) {
        if (!playerSessions[token]) {
            playerSessions[token] = {};
        }
        if (handshakeUser) {
            playerSessions[token].username = handshakeUser;
        }
    }

    // --- RECONNECTION LOGIC ---
    const session = playerSessions[token];

    if (session) {
        if (games[session.gameId]) {
            socket.data.gameId = session.gameId;
            socket.data.seat = session.seat;
            await socket.join(session.gameId); 
            console.log(`[Reconnect] Player restored to Game ${session.gameId}`);
            sendUpdate(session.gameId, socket.id, session.seat);
        } else {
            console.log(`[Cleanup] Removing stale session for game ${session.gameId}`);
            delete playerSessions[token];
        }
    }

    // 1. HANDLE JOIN
    socket.on('request_join', async (data) => { 
        const token = socket.handshake.auth.token;
        const currentId = socket.data.gameId || (playerSessions[token] ? playerSessions[token].gameId : null);

        if (currentId) {
             console.log(`[Switch] Force leaving old Game ${currentId} for new ${data.mode} game.`);
             await socket.leave(currentId); 
             if (token && playerSessions[token]) delete playerSessions[token];
             socket.data.gameId = null;
             socket.data.seat = null;
        }

        if (data.mode === 'bot') {
            await startBotGame(socket, data.difficulty || 'medium'); 
        } else {
            joinGlobalGame(socket);
        }
    });

    // 2. GAME ACTIONS
    socket.on('act_ready', (data) => {
        const gameId = socket.data.gameId;
        const game = games[gameId];

        if (!game) return;
        
        if (!game.readySeats) game.readySeats = new Set();
        game.readySeats.add(data.seat);

        if (gameBots[gameId]) {
            Object.keys(gameBots[gameId]).forEach(botSeat => {
                game.readySeats.add(parseInt(botSeat));
            });
        }

        const readyArray = Array.from(game.readySeats);
        io.to(gameId).emit('ready_status', { readySeats: readyArray });

        console.log(`[Ready] Seat ${data.seat} Ready. Total: ${game.readySeats.size}/4`);

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
        const result = game.drawFromDeck(data.seat);
        // CHECK FOR DECK EMPTY GAME OVER
        if (result.success && result.message === "GAME_OVER_DECK_EMPTY") {
            handleRoundEnd(gameId, io); // <--- NEW FLOW
        } else if (result.success) {
            broadcastAll(gameId, data.seat);
        } else {
            socket.emit('error_message', result.message);
        }
    });
    
    socket.on('act_pickup', (data) => {
        const gameId = socket.data.gameId; 
        const game = games[gameId];        
        if (game) { 
            let res = game.pickupDiscardPile(data.seat); 
            res.success ? broadcastAll(gameId, data.seat) : socket.emit('error_message', res.message); 
        }
    });
    
    socket.on('act_meld', (data) => { 
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (game) { 
            let res = game.meldCards(data.seat, data.indices, data.targetRank); 
            if (res.success && res.message === "GAME_OVER") {
                handleRoundEnd(gameId, io); // <--- NEW FLOW
            } else if (res.success) {
                broadcastAll(gameId, data.seat);
            } else {
                socket.emit('error_message', res.message);
            }
        }
    });
    
    socket.on('act_discard', (data) => { 
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (game) { 
            let res = game.discardFromHand(data.seat, data.index); 
            if (res.success && res.message === "GAME_OVER") {
                handleRoundEnd(gameId, io); // <--- NEW FLOW
            } else if (res.success) {
                broadcastAll(gameId, data.seat);
            } else {
                socket.emit('error_message', res.message);
            }
        }
    });
    
    socket.on('act_open_game', (data) => { 
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (game) { 
            let res = game.processOpening(data.seat, data.melds, data.pickup); 
            if (res.success && res.message === "GAME_OVER") {
                handleRoundEnd(gameId, io); // <--- NEW FLOW
            } else if (res.success) {
                broadcastAll(gameId, data.seat);
            } else {
                socket.emit('error_message', res.message);
            }
        }
    });
    
    socket.on('act_next_round', () => {
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (!game) return;

        // We only proceed if we are in 'game_over' but NOT 'match_over' logic
        if (game.turnPhase === "game_over" && !game.isTransitioning) {
            game.isTransitioning = true;
            
            // Just setup the round (scores already handled)
            game.startNextRound(); 
            
            // Reset transition flags
            game.readySeats = new Set();
            if (gameBots[gameId]) {
                game.readySeats.add(0);
                Object.keys(gameBots[gameId]).forEach(b => game.readySeats.add(parseInt(b)));
            } else {
                game.currentPlayer = -1;
            }
            game.isTransitioning = false;
            game.processingTurnFor = null;

            // Broadcast new hands
            io.in(gameId).fetchSockets().then(sockets => {
                sockets.forEach(s => {
                    if (s.data.seat !== undefined) sendUpdate(gameId, s.id, s.data.seat);
                });
                checkBotTurn(gameId);
            });
        }
    });

    // --- TIMEOUT HANDLER ---
    socket.on('act_timeout', async () => {
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (!game) return;

        // Security: Ensure the player claiming timeout is actually the one whose turn it is
        if (game.currentPlayer !== socket.data.seat) return;

        console.log(`[TIMEOUT] Player ${socket.data.seat} ran out of time.`);

        // 1. Determine Winner (Opposing Team)
        // Seat 0 & 2 = Team 1 | Seat 1 & 3 = Team 2
        const loserTeam = (socket.data.seat % 2 === 0) ? "team1" : "team2";
        const winner = (loserTeam === "team1") ? "team2" : "team1";

        // 2. Broadcast Match Over
        io.to(gameId).emit('match_over', {
            winner: winner,
            scores: game.cumulativeScores,
            reason: "timeout"
        });

        // 3. Cleanup
        setTimeout(() => {
            delete games[gameId];
            delete gameBots[gameId];
        }, 5000); // Short delay to allow clients to receive the message
    });

    socket.on('leave_game', async () => { 
        const gameId = socket.data.gameId;
        const token = socket.handshake.auth.token;
        
        // Check if player was in the waiting queue
        const wasInQueue = waitingPlayers.find(s => s.id === socket.id);
        if (wasInQueue) {
            waitingPlayers = waitingPlayers.filter(s => s.id !== socket.id);
            // Notify remaining players
            waitingPlayers.forEach(p => p.emit('queue_update', { count: waitingPlayers.length }));
        }
        
        console.log(`[Leave] User requesting to leave Game ${gameId}`);
        if (token && playerSessions[token]) delete playerSessions[token];
        socket.data.gameId = null;
        socket.data.seat = null;
        
        if (gameId) {
            await socket.leave(gameId); 
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

async function startBotGame(humanSocket, difficulty) {
    const gameId = generateGameId();
    games[gameId] = new CanastaGame();
    games[gameId].resetMatch();
    const userName = humanSocket.handshake.auth.username || "Player";
    games[gameId].names = [userName, "Bot 1", "Bot 2", "Bot 3"];
    gameBots[gameId] = {};

    await humanSocket.join(gameId); 
    humanSocket.data.seat = 0;
    humanSocket.data.gameId = gameId;

    const token = humanSocket.handshake.auth.token;
    if (token) {
        const existingName = playerSessions[token] ? playerSessions[token].username : "Player";
        playerSessions[token] = { gameId: gameId, seat: 0, username: existingName };
    }

    for (let i = 1; i <= 3; i++) gameBots[gameId][i] = new CanastaBot(i, difficulty);

    games[gameId].currentPlayer = 0;
    games[gameId].roundStarter = 0;
    sendUpdate(gameId, humanSocket.id, 0);
}

function joinGlobalGame(socket) {
    if (waitingPlayers.find(s => s.id === socket.id)) return;
    waitingPlayers.push(socket);

    waitingPlayers.forEach(p => {
        p.emit('queue_update', { count: waitingPlayers.length });
    });

    if (waitingPlayers.length === 4) {
        const gameId = generateGameId();
        
        games[gameId] = new CanastaGame();
        games[gameId].resetMatch();
        games[gameId].readySeats = new Set();
        games[gameId].currentPlayer = -1;
        games[gameId].names = ["Player 1", "Player 2", "Player 3", "Player 4"];
        
        waitingPlayers.forEach((p, i) => {
            p.join(gameId); 
            p.data.seat = i;
            p.data.gameId = gameId;

            const pName = p.handshake.auth.username || `Player ${i+1}`;
            games[gameId].names[i] = pName;

            const token = p.handshake.auth.token;
            if (token) {
                 const cachedName = playerSessions[token] ? playerSessions[token].username : null;
                 playerSessions[token] = { 
                     gameId: gameId, 
                     seat: i,
                     username: cachedName 
                 }; 
            }
            sendUpdate(gameId, p.id, i);
        });
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
    const game = games[gameId]; 
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
    const game = games[gameId]; 
    if (!game) return;

    const pile = game.discardPile;
    const topCard = pile.length > 0 ? pile[pile.length-1] : null;
    const prevCard = pile.length > 1 ? pile[pile.length-2] : null;
    const freezingCard = getFreezingCard(game);
    const isFrozen = !!freezingCard;
    const handSizes = game.players.map(p => p.length);
    const names = getPlayerNames(gameId);

    io.sockets.sockets.forEach((s) => {
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
            
            let seat = s.data.seat;
            if (seat !== undefined && game.players[seat]) {
                update.hand = game.players[seat];
            }
            s.emit('update_game', update);
        }
    });

    checkBotTurn(gameId);
}

function checkBotTurn(gameId) {
    const game = games[gameId];
    if (!game || !gameBots[gameId]) return;

    // 1. Safety: Don't let bots play if the game is already over
    if (game.turnPhase === 'game_over') return;

    let curr = game.currentPlayer;
    let bot = gameBots[gameId][curr];

    // Prevent double-submission if bot is already thinking
    if (game.processingTurnFor === curr) return; 

    if (bot) {
        game.processingTurnFor = curr;
        
        // Pass a callback that runs after every bot action (Draw, Meld, Discard)
        bot.executeTurn(game, (updatedSeat) => {
            
            // --- FIX: CHECK IF BOT ENDED THE ROUND ---
            if (game.turnPhase === 'game_over') {
                console.log(`[BOT] Player ${updatedSeat} ended the round.`);
                game.processingTurnFor = null; // Release lock
                handleRoundEnd(gameId, io);    // Trigger Score Calculation & Events
            } else {
                // Normal turn update
                broadcastAll(gameId, updatedSeat); 
            }
        });
    } else {
        game.processingTurnFor = null;
    }
}

function getPlayerNames(gameId) {
    if (games[gameId] && games[gameId].names) {
        return games[gameId].names;
    }
    return ["Bot 1", "Bot 2", "Bot 3", "Bot 4"];
}

// server.js - Helper Function

async function handleRoundEnd(gameId, io) {
    const game = games[gameId];
    if (!game) return;

    // 1. Commit scores and check if match is over
    const result = game.resolveMatchStatus();

    // 2. CASE A: MATCH OVER (5000+ points)
    if (result.isMatchOver) {
        console.log(`[MATCH END] Game ${gameId} won by ${result.winner}`);

        // Update DB Stats (if not dev mode)
        if (!DEV_MODE) {
            const winnerTeam = (result.winner === 'team1') ? 0 : 1;
            const sockets = await io.in(gameId).fetchSockets();
            
            for (const s of sockets) {
                const seat = s.data.seat;
                const token = s.handshake.auth.token;
                if (!token) continue;

                const isTeam1 = (seat === 0 || seat === 2);
                const playerWon = (winnerTeam === 0 && isTeam1) || (winnerTeam === 1 && !isTeam1);

                try {
                    const updateField = playerWon ? "stats.wins" : "stats.losses";
                    await User.updateOne({ token: token }, { $inc: { [updateField]: 1 } });
                } catch (e) { console.error("Stats update failed", e); }
            }
        }

        // Emit MATCH_OVER immediately (Skips Round End Popup)
        io.to(gameId).emit('match_over', {
            winner: result.winner,
            scores: game.cumulativeScores, // Send FINAL cumulative scores
            reason: "score_limit"
        });

        // Cleanup
        setTimeout(() => {
            delete games[gameId];
            delete gameBots[gameId];
        }, 60000);

    } 
    // 3. CASE B: JUST A ROUND END
    else {
        // Emit standard update (Client triggers Round End Popup)
        // We pass the "round" scores via update_game's standard payload
        broadcastAll(gameId); 
    }
}

// Keep-Alive for Render (Optional for Local)
const https = require('https'); 
setInterval(() => {
    // Only ping if NOT in dev mode, to prevent local errors
    if (!DEV_MODE) {
        const url = 'https://la-canasta.onrender.com/'; 
        https.get(url, (res) => {
             // console.log(`[Keep-Alive] Ping sent.`);
        }).on('error', (e) => {
             // console.error(`[Keep-Alive] Error: ${e.message}`);
        });
    }
}, 14 * 60 * 1000); 

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => { 
    console.log(`Server running on port ${PORT}`);
    if (DEV_MODE) console.log("⚠️  DEV MODE ACTIVE: DB Disabled. Use ANY login.");
});