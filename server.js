// server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose'); 
const { CanastaGame } = require('./game'); 
const { CanastaBot } = require('./bot');
const { calculateEloChange } = require('./elo');
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
        isOnline: { type: Boolean, default: false },
        stats: {
            wins: { type: Number, default: 0 },
            losses: { type: Number, default: 0 },
            rating: { type: Number, default: 1200 }
        },
        // NEW: Social Arrays
        friends: [{ type: String }],      // Array of Usernames
        blocked: [{ type: String }]       // Array of Usernames
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
const matchmakingQueues = {
    'rated_2': [],
    'rated_4': [],
    'casual_2': [],
    'casual_4': []
};

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
            // Default to 4 if not specified
            const pCount = data.playerCount || 4;
            await startBotGame(socket, data.difficulty || 'medium', pCount); 
        } else {
            joinGlobalGame(socket, data);
        }
    });

    socket.on('request_create_private', (data) => {
        // 1. Validate Input
        const requestedId = data.gameId.trim();
        const pin = data.pin;
        
        // --- DEFINE pCount HERE ---
        const pCount = data.playerCount || 4; 

        if (!requestedId || !pin) return socket.emit('error_message', "Invalid data.");
        
        if (games[requestedId]) {
            return socket.emit('error_message', "Room name already exists. Choose another.");
        }

        const gameId = requestedId; 
        
        // --- USE pCount HERE ---
        const gameConfig = (pCount === 2) 
            ? { PLAYER_COUNT: 2, HAND_SIZE: 15 } 
            : { PLAYER_COUNT: 4, HAND_SIZE: 11 };

        games[gameId] = new CanastaGame(gameConfig);
        games[gameId].resetMatch();
        games[gameId].isPrivate = true;
        games[gameId].pin = pin;
        games[gameId].host = socket.id;
        games[gameId].readySeats = new Set();
        
        // --- Initialize Name Array ---
        games[gameId].names = Array(pCount).fill("Waiting...");
        games[gameId].names[0] = socket.handshake.auth.username || "Host";
        
        // Join Host
        socket.join(gameId);
        socket.data.gameId = gameId;
        socket.data.seat = 0; 
        
        socket.emit('private_created', { gameId: gameId, pin: pin });
        sendUpdate(gameId, socket.id, 0);
    });

    socket.on('request_join_private', (data) => {
        const { gameId, pin } = data;
        const game = games[gameId];

        if (!game) return socket.emit('error_message', "Game not found.");
        if (game.pin !== pin) return socket.emit('error_message', "Invalid PIN.");
        if (!game.isPrivate) return socket.emit('error_message', "Not a private game.");
        
        // Find empty seat
        let seat = -1;
        const socketsInRoom = io.sockets.adapter.rooms.get(gameId);
        const playerCount = socketsInRoom ? socketsInRoom.size : 0;
        
        // --- UPDATE: Check against Game Configuration ---
        const maxPlayers = game.config.PLAYER_COUNT; // Uses the game's internal config

        if (currentCount >= maxPlayers) {
            return socket.emit('error_message', "Room is full.");
        }

        seat = playerCount; // 0 is taken, so 1, 2, 3...

        // Join
        socket.join(gameId);
        socket.data.gameId = gameId;
        socket.data.seat = seat;
        
        // Update Name
        const pName = socket.handshake.auth.username || `Player ${seat+1}`;
        game.names[seat] = pName;

        // Broadcast to everyone in room
        broadcastAll(gameId);
        socket.emit('joined_private_success', { gameId, seat });
        
        // If full, auto-start logic? Or wait for Host to click start?
        // For now, let's auto-start if 4 join, or rely on Ready button.
    });

    // --- NEW: SOCIAL EVENTS ---

    socket.on('social_search', async (query) => {
        if (DEV_MODE) return;
        // Find users matching query (excluding self and blocked)
        const users = await User.find({ username: { $regex: query, $options: 'i' } }).limit(5);
        socket.emit('social_search_results', users.map(u => u.username));
    });

    socket.on('social_add_friend', async (targetUsername) => {
        if (DEV_MODE) return;
        const myName = socket.handshake.auth.username;
        if (myName === targetUsername) return;

        await User.updateOne({ username: myName }, { $addToSet: { friends: targetUsername } });
        socket.emit('social_update', { message: `Added ${targetUsername}` });
        // Refresh list
        const me = await User.findOne({ username: myName });
        socket.emit('social_list_data', { friends: me.friends, blocked: me.blocked });
    });

    socket.on('social_block_user', async (targetUsername) => {
        if (DEV_MODE) return;
        const myName = socket.handshake.auth.username;
        await User.updateOne({ username: myName }, { 
            $addToSet: { blocked: targetUsername },
            $pull: { friends: targetUsername } // Remove from friends if blocked
        });
        socket.emit('social_update', { message: `Blocked ${targetUsername}` });
        const me = await User.findOne({ username: myName });
        socket.emit('social_list_data', { friends: me.friends, blocked: me.blocked });
    });

    socket.on('social_get_lists', async () => {
        if (DEV_MODE) return;
        const me = await User.findOne({ username: socket.handshake.auth.username });
        if (me) {
            // Fetch friend documents to see 'isOnline' status
            const friendDocs = await User.find({ username: { $in: me.friends } });
            
            // Map to an array of objects: [{ username: "Bob", isOnline: true }, ...]
            const friendData = friendDocs.map(f => ({ 
                username: f.username, 
                isOnline: f.isOnline 
            }));

            // Send full object for friends, keep blocked as strings
            socket.emit('social_list_data', { friends: friendData, blocked: me.blocked });
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
        
        // --- NEW CLEANUP LOGIC ---
        // Loop through all queue keys ('rated_2', 'rated_4', 'casual_2', etc.)
        Object.keys(matchmakingQueues).forEach(key => {
            const q = matchmakingQueues[key];
            const idx = q.findIndex(s => s.id === socket.id);
            if (idx !== -1) {
                q.splice(idx, 1);
                
                // Parse the needed count from the key (e.g. 'rated_4' -> 4)
                const needed = parseInt(key.split('_')[1]);
                
                // Notify remaining players in THAT queue
                q.forEach(p => p.emit('queue_update', { count: q.length, needed: needed }));
            }
        });

        console.log(`[Leave] User requesting to leave Game ${gameId}`);
        
        // Remove from session tracking
        if (token && playerSessions[token]) delete playerSessions[token];
        socket.data.gameId = null;
        socket.data.seat = null;
        
        // Leave the socket room
        if (gameId) {
            await socket.leave(gameId); 
        }
    });
    
    socket.on('disconnect', () => {
        // --- NEW CLEANUP LOGIC ---
        Object.keys(matchmakingQueues).forEach(key => {
            const q = matchmakingQueues[key];
            const idx = q.findIndex(s => s.id === socket.id);
            if (idx !== -1) {
                q.splice(idx, 1);
                // No need to emit update here usually, but you can if you want real-time queue counts for others
            }
        });
    });
});

// --- HELPER FUNCTIONS ---

function generateGameId() {
    return 'game_' + Math.random().toString(36).substr(2, 9);
}

async function startBotGame(humanSocket, difficulty, playerCount = 4) {
    const gameId = generateGameId();
    
    // --- PHASE 3: DYNAMIC CONFIG ---
    // 2-Player Standard: 15 Cards, 2 to Draw (Draw count handled by default config)
    // 4-Player Standard: 11 Cards
    const gameConfig = (playerCount === 2) 
        ? { PLAYER_COUNT: 2, HAND_SIZE: 15 } 
        : { PLAYER_COUNT: 4, HAND_SIZE: 11 };

    games[gameId] = new CanastaGame(gameConfig);
    games[gameId].resetMatch();
    
    const userName = humanSocket.handshake.auth.username || "Player";
    gameBots[gameId] = {};

    // --- SETUP BOTS & NAMES BASED ON COUNT ---
    if (playerCount === 2) {
        // 2P: Human (Seat 0) vs Bot (Seat 1)
        games[gameId].names = [userName, "Bot 1"];
        
        // Spawn 1 Bot at Seat 1
        gameBots[gameId][1] = new CanastaBot(1, difficulty);
        
    } else {
        // 4P: Human (Seat 0) vs Bots (Seats 1, 2, 3)
        games[gameId].names = [userName, "Bot 1", "Bot 2", "Bot 3"];
        
        // Spawn 3 Bots
        for (let i = 1; i <= 3; i++) {
            gameBots[gameId][i] = new CanastaBot(i, difficulty);
        }
    }

    await humanSocket.join(gameId); 
    humanSocket.data.seat = 0;
    humanSocket.data.gameId = gameId;

    const token = humanSocket.handshake.auth.token;
    if (token) {
        const existingName = playerSessions[token] ? playerSessions[token].username : "Player";
        playerSessions[token] = { gameId: gameId, seat: 0, username: existingName };
    }

    games[gameId].currentPlayer = 0;
    games[gameId].roundStarter = 0;
    sendUpdate(gameId, humanSocket.id, 0);
}

function joinGlobalGame(socket, data) {
    // 1. Determine Details
    const pCount = (data && data.playerCount === 2) ? 2 : 4;
    const mode = (data && data.mode === 'rated') ? 'rated' : 'casual';
    
    // 2. Generate Queue Key (e.g. 'rated_4' or 'casual_2')
    const queueKey = `${mode}_${pCount}`;
    const queue = matchmakingQueues[queueKey];

    // 3. Avoid duplicates
    if (queue.find(s => s.id === socket.id)) return;

    // 4. Add to specific queue
    queue.push(socket);

    // 5. Notify players in THIS queue
    queue.forEach(p => {
        p.emit('queue_update', { count: queue.length, needed: pCount });
    });

    // 6. Check if Full
    if (queue.length >= pCount) {
        const players = queue.splice(0, pCount);
        const gameId = generateGameId();
        
        // --- CONFIGURATION ---
        const gameConfig = (pCount === 2) 
            ? { PLAYER_COUNT: 2, HAND_SIZE: 15 } 
            : { PLAYER_COUNT: 4, HAND_SIZE: 11 };

        games[gameId] = new CanastaGame(gameConfig);
        games[gameId].resetMatch();
        
        // --- CRITICAL FIX: Only set isRated for Rated Mode ---
        games[gameId].isRated = (mode === 'rated'); 
        
        games[gameId].readySeats = new Set();
        games[gameId].currentPlayer = -1;
        games[gameId].names = Array(pCount).fill("Player");

        players.forEach((p, i) => {
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
        
        console.log(`[MATCH] Started ${pCount}-Player ${mode.toUpperCase()} Game ${gameId}`);
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
        
        // --- NEW: Add 1s delay only at the START of the turn (Draw Phase) ---
        // This ensures visual pause after the previous player's discard.
        const delay = (game.turnPhase === 'draw') ? 1000 : 0;

        setTimeout(() => {
            // Add .catch to handle errors gracefully
            bot.executeTurn(game, (updatedSeat) => {
                if (game.turnPhase === 'game_over') {
                    console.log(`[BOT] Player ${updatedSeat} ended the round.`);
                    game.processingTurnFor = null; 
                    handleRoundEnd(gameId, io);    
                } else {
                    broadcastAll(gameId, updatedSeat); 
                }
            }).catch(err => {
                console.error(`[BOT ERROR] Seat ${curr} crashed:`, err);
                // CRITICAL FIX: Release the lock so the game doesn't freeze
                game.processingTurnFor = null; 
                
                // Optional: Force a random discard to keep game moving
                // game.discardFromHand(curr, 0);
                // broadcastAll(gameId, curr);
            });
        }, delay);

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

//  Helper Function

async function handleRoundEnd(gameId, io) {
    const game = games[gameId];
    if (!game) return;

    // 1. Commit scores and check if match is over
    const result = game.resolveMatchStatus();

    // 2. CASE A: MATCH OVER (5000+ points)
    if (result.isMatchOver) {
        console.log(`[MATCH END] Game ${gameId} won by ${result.winner}`);

        // --- RATING & STATS UPDATE START ---
        if (!DEV_MODE) {
            try {
                // A. Fetch all sockets to get tokens
                const sockets = await io.in(gameId).fetchSockets();
                const players = {}; // Map seat -> User Document

                // B. Fetch User Docs from DB
                for (const s of sockets) {
                    const seat = s.data.seat;
                    const token = s.handshake.auth.token;
                    if (token) {
                        const userDoc = await User.findOne({ token: token });
                        if (userDoc) players[seat] = userDoc;
                    }
                }

                // C. Ensure we have all 4 players for a fair calculation
                // (If someone disconnected mid-game, we might skip rating or penalize leaver - simple version here)
                if (Object.keys(players).length === 4 && game.isRated) {
                    
                    // 1. Calculate Average Ratings
                    const team1Rating = (players[0].stats.rating + players[2].stats.rating) / 2;
                    const team2Rating = (players[1].stats.rating + players[3].stats.rating) / 2;

                    // 2. Get Scores
                    const s1 = game.cumulativeScores.team1;
                    const s2 = game.cumulativeScores.team2;

                    // 3. Calculate Delta using our new Elo module
                    const delta = calculateEloChange(team1Rating, team2Rating, s1, s2);
                    
                    console.log(`[ELO] T1(${team1Rating}) vs T2(${team2Rating}) | Score ${s1}-${s2} | Delta: ${delta}`);

                    // 4. Apply Updates
                    // Team 1 (Seats 0, 2)
                    players[0].stats.rating += delta;
                    players[2].stats.rating += delta;
                    // Team 2 (Seats 1, 3) gets the opposite
                    players[1].stats.rating -= delta;
                    players[3].stats.rating -= delta;

                    // Update Wins/Losses
                    const winnerTeam = (result.winner === 'team1') ? 0 : 1;
                    [0, 1, 2, 3].forEach(seat => {
                        const isTeam1 = (seat === 0 || seat === 2);
                        const won = (winnerTeam === 0 && isTeam1) || (winnerTeam === 1 && !isTeam1);
                        if (won) players[seat].stats.wins++;
                        else players[seat].stats.losses++;
                    });

                    // 5. Save to DB
                    await Promise.all([
                        players[0].save(), players[1].save(), players[2].save(), players[3].save()
                    ]);
                } else if (!game.isRated) {
                    // Just update wins/losses for unrated/bot games if needed, or skip
                    console.log("Game unrated or missing players, skipping Elo.");
                }

            } catch (e) {
                console.error("Stats/Elo update failed:", e);
            }
        }
        // --- RATING & STATS UPDATE END ---

        // Emit MATCH_OVER immediately
        io.to(gameId).emit('match_over', {
            winner: result.winner,
            scores: game.cumulativeScores,
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