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
// server.js - Add this route

app.get('/api/profile', async (req, res) => {
    // 1. Get token from headers
    const token = req.headers.authorization;
    if (!token) return res.json({ success: false, message: "No token" });

    // 2. Handle Dev Mode
    if (DEV_MODE) {
        return res.json({ 
            success: true, 
            username: "DevPlayer", 
            stats: { rating: 1250, wins: 5, losses: 2 } 
        });
    }

    // 3. Find User in DB
    try {
        const user = await User.findOne({ token: token });
        if (!user) return res.json({ success: false, message: "User not found" });

        // 4. Return Stats
        res.json({ 
            success: true, 
            username: user.username, 
            stats: user.stats 
        });
    } catch (e) {
        console.error("Profile fetch error:", e);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

// --- LEADERBOARD ROUTE ---
app.get('/api/leaderboard', async (req, res) => {
    // 1. Dev Mode Mock Data (for testing without DB)
    if (DEV_MODE) {
        const mockData = Array.from({ length: 25 }, (_, i) => ({
            username: `Player_${i + 1}`,
            stats: { 
                rating: 2000 - (i * 50), 
                wins: 50 - i, 
                losses: 10 + i 
            }
        }));
        return res.json({ success: true, leaderboard: mockData });
    }

    // 2. Production DB Query
    try {
        const topPlayers = await User.find({})
            .sort({ 'stats.rating': -1 }) // Sort Descending by Rating
            .limit(100)                   // Top 100 only
            .select('username stats.rating stats.wins stats.losses -_id'); // Only safe fields

        res.json({ success: true, leaderboard: topPlayers });
    } catch (e) {
        console.error("[API] Leaderboard Error:", e);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

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
        const pCount = data.playerCount || 4; 
        const ruleset = data.ruleset || 'standard'; // <--- Get Ruleset

        if (!requestedId || !pin) return socket.emit('error_message', "Invalid data.");
        
        if (games[requestedId]) {
            return socket.emit('error_message', "Room name already exists. Choose another.");
        }

        const gameId = requestedId; 
        
        // 2. Determine Base Config (Hand Size)
        let config = (pCount === 2) 
            ? { PLAYER_COUNT: 2, HAND_SIZE: 15 } 
            : { PLAYER_COUNT: 4, HAND_SIZE: 11 };

        // 3. Apply Ruleset Overrides
        if (ruleset === 'easy') {
            // Easy Mode: Draw 1, Need 1 Canasta to go out
            config.DRAW_COUNT = 1;
            config.MIN_CANASTAS_OUT = 1;
        } else {
            // Standard Mode: Draw 2, Need 2 Canastas to go out
            config.DRAW_COUNT = 2;
            config.MIN_CANASTAS_OUT = 2;
        }

        // 4. Initialize Game
        games[gameId] = new CanastaGame(config);
        games[gameId].resetMatch();
        games[gameId].isPrivate = true;
        games[gameId].pin = pin;
        games[gameId].host = socket.id;
        games[gameId].readySeats = new Set();
        
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
    socket.on('act_request_rematch', () => {
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (!game) return;

        // 1. Initialize Vote Set
        if (!game.rematchVotes) game.rematchVotes = new Set();
        
        // 2. Register Vote
        game.rematchVotes.add(socket.data.seat);
        
        // 3. Auto-vote for Bots
        if (gameBots[gameId]) {
            Object.keys(gameBots[gameId]).forEach(botSeat => {
                game.rematchVotes.add(parseInt(botSeat));
            });
        }

        const needed = game.config.PLAYER_COUNT;
        
        // 4. Send Status Update
        io.to(gameId).emit('rematch_update', { 
            current: game.rematchVotes.size, 
            needed: needed 
        });

        // 5. Check if Everyone Accepted
        if (game.rematchVotes.size >= needed) {
            console.log(`[Rematch] All players accepted. Restarting Game ${gameId}.`);
            
            // A. Cancel Cleanup Timer
            if (game.cleanupTimer) clearTimeout(game.cleanupTimer);
            
            // B. Reset Game Logic
            game.resetMatch(); 
            game.rematchVotes.clear();
            game.nextRoundReady = new Set();

            // This sends 'deal_hand', which forces the client to switch screens.
            io.sockets.sockets.forEach((s) => {
                if (s.data.gameId === gameId) {
                    sendUpdate(gameId, s.id, s.data.seat);
                }
            });
        }
    });

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

        if (game.readySeats.size === game.config.PLAYER_COUNT && game.currentPlayer === -1) {
             console.log(`[Start] All players ready!`);
             
             if (game.roundStarter === undefined) game.roundStarter = 0;
             game.currentPlayer = game.roundStarter;
             game.turnPhase = 'draw'; 
             game.processingTurnFor = null;
            
             broadcastAll(gameId, game.currentPlayer); 
        }
    });

    socket.on('act_ask_go_out', (data) => {
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (!game) return;

        // Validation
        if (game.config.PLAYER_COUNT !== 4) return socket.emit('error_message', "Only in 4P mode.");
        if (game.currentPlayer !== data.seat) return socket.emit('error_message', "Not your turn.");
        if (game.turnPhase !== 'playing') return socket.emit('error_message', "Draw cards first.");

        // Identify Partner
        const partnerSeat = (data.seat + 2) % 4;
        game.goOutPermission = 'pending';

        // CHECK IF PARTNER IS BOT
        if (gameBots[gameId] && gameBots[gameId][partnerSeat]) {
            // Bot Logic
            const bot = gameBots[gameId][partnerSeat];
            const decision = bot.decideGoOutPermission(game); // TRUE or FALSE
            
            // Auto-reply
            game.goOutPermission = decision ? 'granted' : 'denied';
            
            // Broadcast result immediately
            io.to(gameId).emit('ask_result', { seat: partnerSeat, decision: decision });
        } else {
            // Human Logic: Find partner's socket
            io.sockets.sockets.forEach((s) => {
                if (s.data.gameId === gameId && s.data.seat === partnerSeat) {
                    s.emit('ask_request', { askingSeat: data.seat });
                }
            });
        }
    });

    socket.on('act_reply_go_out', (data) => {
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (!game) return;

        // Ensure it matches the 'pending' state
        if (game.goOutPermission !== 'pending') return;

        game.goOutPermission = data.decision ? 'granted' : 'denied';
        
        // Broadcast result to everyone (so asking player sees it)
        io.to(gameId).emit('ask_result', { seat: data.seat, decision: data.decision });
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
            // --- 1. GO OUT CHECK (Partner Enforcement) ---
            const hand = game.players[data.seat];
            
            // Check if melding these cards results in an empty hand (Floating)
            // (If indices.length == hand.length, you are using all your cards)
            const willGoOut = (hand.length === data.indices.length);

            if (willGoOut && game.goOutPermission === 'denied') {
                // A. Apply 100 point penalty
                const teamKey = (data.seat % 2 === 0) ? 'team1' : 'team2';
                game.cumulativeScores[teamKey] -= 100;

                // B. Notify Everyone
                const name = (game.names && game.names[data.seat]) ? game.names[data.seat] : `Player ${data.seat+1}`;
                io.to(gameId).emit('penalty_notification', { 
                    message: `${name} ignored partner! -100 pts.`
                });

                // C. Block the Move
                socket.emit('error_message', "Partner said NO! You cannot go out.");
                
                // D. Force Update UI (to show score drop immediately)
                broadcastAll(gameId);
                return;
            }
            // ---------------------------------------------

            // 2. Perform Standard Meld
            let res = game.meldCards(data.seat, data.indices, data.targetRank); 
            
            if (res.success && res.message === "GAME_OVER") {
                handleRoundEnd(gameId, io); 
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
            // 1. PRE-CHECK: Is player trying to go out after being denied?
            let hand = game.players[data.seat];
            let willGoOut = (hand.length === 1); // If 1 card and discarding it -> 0 left

                // --- PENALTY CHECK 1: IGNORING "NO" ---
            // You are trying to Go Out, but Partner said NO.
            if (willGoOut && game.goOutPermission === 'denied') {
                const teamKey = (data.seat % 2 === 0) ? 'team1' : 'team2';
                game.cumulativeScores[teamKey] -= 100;

                const name = (game.names && game.names[data.seat]) ? game.names[data.seat] : `Player ${data.seat+1}`;
                io.to(gameId).emit('penalty_notification', { 
                    message: `${name} ignored partner's NO! -100 pts.`
                });
                
                // REJECT THE MOVE: You must keep the card.
                socket.emit('error_message', "Partner said NO! You cannot go out.");
                broadcastAll(gameId); 
                return; 
            }

            // --- PENALTY CHECK 2: IGNORING "YES" (THE MISSING LOGIC) ---
            // You are NOT going out (will have cards left), but Partner said YES.
            if (!willGoOut && game.goOutPermission === 'granted') {
                const teamKey = (data.seat % 2 === 0) ? 'team1' : 'team2';
                game.cumulativeScores[teamKey] -= 100;

                const name = (game.names && game.names[data.seat]) ? game.names[data.seat] : `Player ${data.seat+1}`;
                io.to(gameId).emit('penalty_notification', { 
                    message: `${name} failed to go out! -100 pts.`
                });
                
                // We ALLOW the discard, but apply the penalty.
                // (Because you physically cannot go out, so the game must continue).
            }

            // Normal Execution
            let res = game.discardFromHand(data.seat, data.index); 
            
            // Reset permission state if turn ends
            if (res.success) game.goOutPermission = null; 

            if (res.success && res.message === "GAME_OVER") {
                handleRoundEnd(gameId, io); 
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

        // Only allow if round is actually over
        if (game.turnPhase !== "game_over") return;

        // Initialize set if missing
        if (!game.nextRoundReady) game.nextRoundReady = new Set();
        
        // 1. Register this player's vote
        game.nextRoundReady.add(socket.data.seat);

        // 2. Auto-vote for bots (if any exist)
        if (gameBots[gameId]) {
            Object.keys(gameBots[gameId]).forEach(botSeat => {
                game.nextRoundReady.add(parseInt(botSeat));
            });
        }

        // 3. Ack to the clicker (so their button changes to "Waiting...")
        socket.emit('next_round_ack');

        // 4. Check if ALL players are ready
        const needed = game.config.PLAYER_COUNT;
        if (game.nextRoundReady.size >= needed) {
            console.log(`[Round] All ${needed} players ready. Starting next round.`);
            
            // Start the round
            game.startNextRound(); 
            
            // Clear votes for next time
            game.nextRoundReady = new Set();

            // Broadcast new hands/board to EVERYONE
            // (This automatically moves them from Scoreboard -> Game)
            broadcastAll(gameId);
        } else {
            // Do NOT broadcast yet. 
            // Other players stay on the scoreboard. 
            // This player waits.
             console.log(`[Round] Player ${socket.data.seat} ready. Waiting for others (${game.nextRoundReady.size}/${needed}).`);
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
            if (!games[gameId].playerTokens) games[gameId].playerTokens = {};
    if (token) games[gameId].playerTokens[i] = token;
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
        deckSize: game.deck.length,
        maxPlayers: game.config.PLAYER_COUNT
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
                deckSize: game.deck.length,
                maxPlayers: game.config.PLAYER_COUNT
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
    // 1. FIX: Define 'game' immediately so we don't crash accessing it
    const game = games[gameId];
    if (!game) return;

    // 2. Set the cleanup timer safely now that 'game' is defined
    if (game.cleanupTimer) clearTimeout(game.cleanupTimer);
    
    game.cleanupTimer = setTimeout(() => {
        delete games[gameId];
        delete gameBots[gameId];
    }, 60000);

    // 3. Reset votes for the next round
    game.nextRoundReady = new Set(); 

    // 4. Commit scores and check if match is over
    const result = game.resolveMatchStatus();

    // 5. CASE A: MATCH OVER (5000+ points)
    if (result.isMatchOver) {
        console.log(`[MATCH END] Game ${gameId} won by ${result.winner}`);

        // Prepare Data Holder for Client
        let ratingUpdates = {}; // Will hold { seatIndex: { newRating, delta } }

        // --- RATING & STATS UPDATE START ---
        if (!DEV_MODE) {
            try {
                const players = {};
                const playerCount = game.config.PLAYER_COUNT; 

                // Loop through all EXPECTED seats (0 to N-1)
                for (let i = 0; i < playerCount; i++) {
                    // Retrieve the token we saved at the start of the game
                    const token = (game.playerTokens && game.playerTokens[i]) ? game.playerTokens[i] : null;
                    
                    if (token) {
                        const userDoc = await User.findOne({ token: token });
                        if (userDoc) players[i] = userDoc;
                    }
                }
                
                console.log(`[ELO] Found ${Object.keys(players).length} / ${playerCount} players for rating update.`);
                
                // Check if we found all players in the DB (regardless of if they are online)
                if (Object.keys(players).length === playerCount && game.isRated) {
        
                    // A. Calculate Average Ratings Dynamically
                    let team1Rating, team2Rating;

                    if (playerCount === 2) {
                        // 1v1 Logic
                        team1Rating = players[0].stats.rating;
                        team2Rating = players[1].stats.rating;
                    } else {
                        // 2v2 Logic (Average of partners)
                        team1Rating = (players[0].stats.rating + players[2].stats.rating) / 2;
                        team2Rating = (players[1].stats.rating + players[3].stats.rating) / 2;
                    }

                    // B. Get Scores
                    const s1 = game.cumulativeScores.team1;
                    const s2 = game.cumulativeScores.team2;

                    // C. Calculate Delta
                    const delta = calculateEloChange(team1Rating, team2Rating, s1, s2);
                    
                    // D. Apply Updates & Save
                    const savePromises = [];

                    // Loop only through the ACTUAL seats (0..1 OR 0..3)
                    for (let seat = 0; seat < playerCount; seat++) {
                        const isTeam1 = (seat === 0 || seat === 2);
                        const change = isTeam1 ? delta : -delta;
                        
                        players[seat].stats.rating += change;
                        
                        const winnerTeam = (result.winner === 'team1') ? 0 : 1; // 0=Team1, 1=Team2
                        const won = (winnerTeam === 0 && isTeam1) || (winnerTeam === 1 && !isTeam1);
                        
                        if (won) players[seat].stats.wins++;
                        else players[seat].stats.losses++;

                        // Store for Client
                        ratingUpdates[seat] = {
                            newRating: Math.round(players[seat].stats.rating),
                            delta: change
                        };

                        savePromises.push(players[seat].save());
                    }

                    await Promise.all(savePromises);
                    console.log("[ELO] Ratings updated successfully.");

                } else {
                    console.log("[ELO] Skipped: Not enough players found or not rated.");
                }

            } catch (e) {
                console.error("Stats/Elo update failed:", e);
            }
        }

        // Emit MATCH_OVER immediately
        io.to(gameId).emit('match_over', {
            winner: result.winner,
            scores: game.cumulativeScores,
            reason: "score_limit",
            names: game.names,
            ratings: ratingUpdates
        });

        // Cleanup
        setTimeout(() => {
            delete games[gameId];
            delete gameBots[gameId];
        }, 60000);

    } 
    // 6. CASE B: JUST A ROUND END
    else {
        // ROUND OVER (Not Match Over)
        
        // Ensure finalScores is populated. If logic failed previously, force a calc.
        if (!game.finalScores) {
            console.log("⚠️ [Warning] finalScores missing at round end. Recalculating...");
            game.finalScores = game.calculateScores(); 
        }

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
