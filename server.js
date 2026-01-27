// server.js
require('dotenv').config();
const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const jwt = require('jsonwebtoken'); // Add this
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
     console.error("FATAL ERROR: JWT_SECRET is not defined.");
     process.exit(1);
}
const express = require('express');
// 1. IMPORT RATE LIMITER
const rateLimit = require('express-rate-limit'); 

const app = express();
app.set('trust proxy', 1);
app.post('/webhook', express.raw({type: 'application/json'}), async (request, response) => {
  const sig = request.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // 1. Verify the event came from real Stripe
    event = stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
  } catch (err) {
    console.log(`⚠️  Webhook signature verification failed.`, err.message);
    return response.status(400).send(`Webhook Error: ${err.message}`);
  }

  // 2. Handle the event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    
    // Retrieve the username we saved in Step 1
    const username = session.metadata.username;
    const customerId = session.customer; 
    const subscriptionId = session.subscription;

    console.log(`💰 WEBHOOK RECEIVED: Payment for ${username}`);

    // Check if User model is ready (it's defined later in the file, but available at runtime)
    if (!DEV_MODE && User) {
        try {
            await User.updateOne(
                { username: username }, 
                { 
                    isPremium: true,
                    stripeCustomerId: customerId,
                    stripeSubscriptionId: subscriptionId
                }
            );
            console.log(`✅ DATABASE UPDATED: ${username} is now Premium!`);
        } catch (e) {
            console.error("❌ DB Update Failed:", e);
        }
    }
  }

  // Return a 200 response to acknowledge receipt of the event
  response.send();
});

// --- 2. NOW ACTIVATE NORMAL JSON PARSING ---
app.use(express.json());

// 2. CONFIGURE LIMITER
// Allow max 20 requests per 15 minutes from the same IP
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, 
    message: { success: false, message: "Too many attempts, please try again later." }
});

// 3. APPLY TO AUTH ROUTES
// (Place this before your app.use('/api', ...) or route definitions)
app.use('/api/register', authLimiter);
app.use('/api/login', authLimiter);

const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose'); 
const { CanastaGame } = require('./game'); 
const { CanastaBot } = require('./bot');
const { calculateEloChange } = require('./elo');
app.use(express.json());
const server = http.createServer(app);
const disconnectTimers = {};
const io = new Server(server, {
    cors: {
        origin: ["https://canastamaster.club", 
            "http://canastamaster.club",
            "https://www.canastamaster.club",
            "http://www.canastamaster.club"], // Allow your domain
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['polling', 'websocket'] // Force support for both
});

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
    if (MONGO_URI) {
    // Show the first 25 chars to verify protocol/user, hide the password part
    console.log("DEBUG: Connection String starts with:", MONGO_URI.substring(0, 25) + "...");
}
    mongoose.connect(MONGO_URI)
        .then(() => console.log("[DB] Connected to MongoDB"))
        .catch(err => console.error("[DB] Connection Error:", err));
}

// --- 3. DATABASE MODELS ---
let User;
if (!DEV_MODE) {
    // Import the model from the new file
    User = require('./models/user');
}

// --- 4. ROUTE MOUNTING ---
const authRoutes = require('./routes/auth');
// Mount the routes at '/api', passing in User and the DEV_MODE flag
app.use('/api', authRoutes(User, DEV_MODE));

// --- GLOBAL STATE ---

const games = {};      
const gameBots = {};   
const playerSessions = {};
const matchmakingService = require('./services/matchmaking')(
    games, 
    gameBots, 
    playerSessions, 
    sendUpdate // This function is hoisted, so passing it here is safe
);

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
            stats: user.stats,
            isPremium: user.isPremium || false
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
            .limit(10)                   // Top 10 only
            .select('username stats.rating stats.wins stats.losses -_id'); // Only safe fields

        res.json({ success: true, leaderboard: topPlayers });
    } catch (e) {
        console.error("[API] Leaderboard Error:", e);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// --- SOCKET CONNECTION ---
io.on('connection', async (socket) => {
    // console.log('User connected:', socket.id);
    const token = socket.handshake.auth.token;
    
    let validUser = null;

    // 1. VERIFY JWT
    if (token) {
        try {
            // This throws an error if the token is fake or expired
            const decoded = jwt.verify(token, JWT_SECRET);
            validUser = decoded.username;
            
            // If verified, link or create session
            if (!playerSessions[token]) {
                playerSessions[token] = { username: validUser };
            }
            // Update username in session just in case
            playerSessions[token].username = validUser;
            
        } catch (err) {
            console.log(`[AUTH FAIL] Invalid Token for socket ${socket.id}`);
            // Optional: socket.disconnect() if you want to be strict
        }
    }
    const session = playerSessions[token];
    if (session) {
        if (games[session.gameId]) {
            // ... existing reconnect logic ...

            // CANCEL THE TIMER if they return!
            const timerKey = `${session.gameId}_${session.seat}`;
            if (disconnectTimers[timerKey]) {
                console.log(`[Reconnect] Player ${session.seat} returned! Forfeit cancelled.`);
                clearTimeout(disconnectTimers[timerKey]);
                delete disconnectTimers[timerKey];
                
                // Unmark disconnect status
                if(games[session.gameId].disconnectedPlayers) {
                     delete games[session.gameId].disconnectedPlayers[session.seat];
                }
            }
        }
    }
    // 2. FALLBACK FOR HANDSHAKE USERNAME (If no token or dev mode)
    const handshakeUser = socket.handshake.auth.username;
    if (token && playerSessions[token] && !playerSessions[token].username && handshakeUser) {
        playerSessions[token].username = handshakeUser;
    }

    socket.on('disconnect', () => {
        console.log(`[Disconnect] ${socket.id}`);
        matchmakingService.removeSocketFromQueue(socket.id);

        const gameId = socket.data.gameId;
        const seat = socket.data.seat;

        // 1. Check if user was in an active game
        if (gameId && games[gameId] && !games[gameId].matchIsOver) {
            console.log(`[Game ${gameId}] Player ${seat} disconnected. Starting 60s timer.`);
            
            // 2. Mark in game state (optional, for UI status)
            games[gameId].disconnectedPlayers[seat] = true;

            // 3. Start 60-Second Forfeit Timer
            // We store it by username or seat, using a unique key
            const timerKey = `${gameId}_${seat}`;
            
            disconnectTimers[timerKey] = setTimeout(() => {
                console.log(`[Forfeit] Player ${seat} failed to reconnect. Ending Game ${gameId}.`);
                handleForfeit(gameId, seat); // <--- We will write this function next
            }, 60000); // 1 Minute
        }
    });

    // --- LOBBY ACTIONS ---

    socket.on('act_switch_seat', (targetSeat) => {
        const gameId = socket.data.gameId;
        const game = games[gameId];
        const currentSeat = socket.data.seat;

        if (!game || !game.isLobby) return;
        if (targetSeat < 0 || targetSeat >= game.config.PLAYER_COUNT) return;
        if (game.names[targetSeat] !== null) return; // Seat taken

        // Swap Names
        game.names[targetSeat] = game.names[currentSeat];
        game.names[currentSeat] = null;
        
        // Update Socket Data
        socket.data.seat = targetSeat;
        socket.emit('seat_changed', { newSeat: targetSeat });
        
        // Update Session if exists
        const token = socket.handshake.auth.token;
        if (token && playerSessions[token]) {
            playerSessions[token].seat = targetSeat;
        }

        // If I was host (Seat 0), I am still host logic-wise, 
        // but for simplicity in this code, let's say Seat 0 is always "Admin".
        // If Host moves, we might lose control. 
        // FIX: Keep game.host = socket.id so seat doesn't matter for permissions.

        broadcastLobby(gameId);
    });

    socket.on('act_host_start', () => {
        const gameId = socket.data.gameId;
        const game = games[gameId];
        
        if (!game || !game.isLobby) return;
        if (game.host !== socket.id) return; // Only Host can start

        // Check if all seats have names
        const filledSeats = game.names.filter(n => n !== null).length;
        if (filledSeats < game.config.PLAYER_COUNT) {
            return socket.emit('error_message', "Wait for all players!");
        }

        console.log(`[LOBBY] Host starting Game ${gameId}`);

        // 1. DEAL CARDS NOW
        game.resetMatch(); 
        game.isLobby = false;

        // 2. MOVE EVERYONE TO GAME SCREEN
        io.sockets.sockets.forEach((s) => {
            if (s.data.gameId === gameId) {
                // Ensure socket data matches current lobby seat
                // (In case of race conditions, but switch_seat handles it)
                sendUpdate(gameId, s.id, s.data.seat);
            }
        });
    });

    // Helper function at bottom of server.js
    function broadcastLobby(gameId) {
        const game = games[gameId];
        if (!game) return;
        
        io.to(gameId).emit('lobby_update', {
            names: game.names,
            hostSeat: 0, // Simplified: Seat 0 is visually the "top"
            maxPlayers: game.config.PLAYER_COUNT,
            isHost: false // Client will check their own ID
        });
    }

    // --- RECONNECTION LOGIC ---
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
            const pCount = parseInt(data.playerCount) || 4;
            await startBotGame(socket, data.difficulty || 'medium', pCount, data.ruleset || 'standard'); 
        } else {
            matchmakingService.joinGlobalGame(socket, data);
        }
    });

    socket.on('request_create_private', (data) => {
        // 1. Validate Input (Room Name is the ID)
        const requestedId = data.gameId ? data.gameId.trim() : "";
        const pCount = parseInt(data.playerCount) || 4;
        const ruleset = data.ruleset || 'standard'; 

        if (!requestedId) return socket.emit('error_message', "Please enter a Room Name.");
        
        // 2. Check if Room ID is taken
        if (games[requestedId]) {
            return socket.emit('error_message', "Room Name already exists. Try another.");
        }

        const gameId = requestedId; 
        
        // 3. Determine Base Config
        let config = (pCount === 2) 
            ? { PLAYER_COUNT: 2, HAND_SIZE: 15 } 
            : { PLAYER_COUNT: 4, HAND_SIZE: 11 };

        if (ruleset === 'easy') {
            config.DRAW_COUNT = 1;
            config.MIN_CANASTAS_OUT = 1;
        } else {
            config.DRAW_COUNT = 2;
            config.MIN_CANASTAS_OUT = 2;
        }

        // 4. Initialize Game
        games[gameId] = new CanastaGame(config);
        games[gameId].isPrivate = true;
        games[gameId].isLobby = true;
        games[gameId].host = socket.id;
        games[gameId].readySeats = new Set();
        games[gameId].matchIsOver = false; // Flag to track completion for cleanup
        
        games[gameId].names = Array(pCount).fill(null);
        games[gameId].names[0] = socket.handshake.auth.username || "Host";
        
        // Join Host
        socket.join(gameId);
        socket.data.gameId = gameId;
        socket.data.seat = 0; 
        
        // Send success (Removed PIN from payload)
        socket.emit('private_created', { gameId: gameId, seat: 0 });
        broadcastLobby(gameId);
    });

    socket.on('request_join_private', (data) => {
        const { gameId } = data;
        const game = games[gameId];

        if (!game) return socket.emit('error_message', "Game not found.");
        if (!game.isPrivate) return socket.emit('error_message', "Not a private game.");
        
        // Find the first empty seat (null)
        let seat = game.names.findIndex(n => n === null);
        if (seat === -1) return socket.emit('error_message', "Room is full.");

        // Join
        socket.join(gameId);
        socket.data.gameId = gameId;
        socket.data.seat = seat;
        
        // Update Name
        const pName = socket.handshake.auth.username || `Player ${seat+1}`;
        game.names[seat] = pName;

        const token = socket.handshake.auth.token;
        if (token) {
            // Save the guest's session so the server remembers them
            playerSessions[token] = { 
                gameId: gameId, 
                seat: seat, 
                username: pName 
            };
        }

        // Broadcast to everyone in room
        broadcastLobby(gameId);
        broadcastAll(gameId);
        socket.emit('joined_private_success', { gameId, seat });
        
        // If full, auto-start logic? Or wait for Host to click start?
        // For now, let's auto-start if 4 join, or rely on Ready button.
    });

    // --- NEW: SOCIAL EVENTS ---
    socket.on('updateBotSpeed', ({ speed }) => {
    const token = socket.handshake.auth.token;
    
    // 1. Prioritize the active game the socket is currently in
    let targetGameId = socket.data.gameId;

    // 2. Fallback: Check if the player session has a gameId assigned
    if (!targetGameId && token && playerSessions[token]) {
        targetGameId = playerSessions[token].gameId;
    }

    if (targetGameId && games[targetGameId]) {
        games[targetGameId].botDelayBase = speed;
        console.log(`[BOT SPEED] Game ${targetGameId} updated to ${speed}ms`);
    }

    // 3. Persist for future games
    if (token && playerSessions[token]) {
        playerSessions[token].botSpeed = speed;
    }
});

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
            
             // 1. Force everyone to the game screen (Client listens for 'deal_hand' to switch screens)
             io.sockets.sockets.forEach((s) => {
                 if (s.data.gameId === gameId) {
                     sendUpdate(gameId, s.id, s.data.seat);
                 }
             });
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
            handleRoundEnd(gameId, io);
        } else if (result.success) {
            broadcastAll(gameId, data.seat);
            } else {
            // If the error is "Wrong phase!" but it IS the player's turn and phase IS 'playing',
            // it means they already succeeded in drawing (likely a double click).
            // Instead of showing an error, just re-send the game state to sync them up.
            if (result.message === "Wrong phase!" && 
                game.currentPlayer === data.seat && 
                game.turnPhase === 'playing') {
                
                // Resend state to this socket only
                sendUpdate(gameId, socket.id, data.seat);
        } else {
                // Genuine error
                socket.emit('error_message', result.message);
            }
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

            // ONLY apply partner penalties in 4-player games
        if (game.config.PLAYER_COUNT === 4) {
            // Penalty Check 1: Ignoring "NO"
            if (willGoOut && game.goOutPermission === 'denied') {
                // ... (keep existing penalty logic here)
                return; 
            }

            // Penalty Check 2: Ignoring "YES"
            if (!willGoOut && game.goOutPermission === 'granted') {
                const teamKey = (data.seat % 2 === 0) ? 'team1' : 'team2';
                game.cumulativeScores[teamKey] -= 100;
                // ... (keep existing notification logic here)
            }
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
            if (game.cleanupTimer) {
                clearTimeout(game.cleanupTimer);
                game.cleanupTimer = null;
                console.log(`[System] Cleanup timer cancelled for Game ${gameId}`);
            }
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
    if (!game || game.matchIsOver) return;

    // We trust the client's 60s trigger but add a small 2s buffer 
    // to account for network lag vs the server's lastActionTime.
    const now = Date.now();
    const INACTIVITY_LIMIT = 58000; // 58s buffer (be slightly more lenient than 60s)
    const timeSinceAction = now - game.lastActionTime;

    if (timeSinceAction < INACTIVITY_LIMIT) {
        console.log(`[TIMEOUT DENIED] Security check failed: ${timeSinceAction}ms`);
        return;
    }

    console.log(`[TIMEOUT] Ending Game ${gameId}. Player ${game.currentPlayer} is AFK.`);
    handleForfeit(gameId, game.currentPlayer); 
});

    socket.on('leave_game', async () => { 
        const gameId = socket.data.gameId;
        const token = socket.handshake.auth.token;
        const game = games[gameId];
        
        // 1. Remove from matchmaking queue
        matchmakingService.removeSocketFromQueue(socket.id);

        console.log(`[Leave] User requesting to leave Game ${gameId}`);
        
        // 2. Remove from session tracking
        if (token && playerSessions[token]) delete playerSessions[token];
        socket.data.gameId = null;
        socket.data.seat = null;
        
        // 3. Leave the socket room & Clean up
        if (gameId) {
            await socket.leave(gameId); 
            
            // Handle Lobby Leave
            if (game && game.isPrivate && game.isLobby) {
                const seat = socket.data.seat;
                if (seat !== undefined && seat !== null) {
                    console.log(`[LOBBY] Seat ${seat} freed in Game ${gameId}`);
                    game.names[seat] = null;
                    if (game.readySeats) game.readySeats.delete(seat);
                    broadcastLobby(gameId);
                }
            }

            // Handle Private Match Cleanup
            if (game && game.isPrivate && game.matchIsOver) {
                console.log(`[CLEANUP] Private Match ${gameId} finished and player left. Deleting room.`);
                delete games[gameId];
                if (gameBots[gameId]) delete gameBots[gameId];
            }
        }
    });
    });

// --- HELPER FUNCTIONS ---

function generateGameId() {
    return 'game_' + Math.random().toString(36).substr(2, 9);
}

async function startBotGame(humanSocket, difficulty, playerCount = 4, ruleset = 'standard') {
    const gameId = generateGameId();
    const pCountInt = parseInt(playerCount);
    
    const gameConfig = (playerCount === 2) 
        ? { PLAYER_COUNT: 2, HAND_SIZE: 15 } 
        : { PLAYER_COUNT: 4, HAND_SIZE: 11 };

    if (ruleset === 'easy') {
        gameConfig.DRAW_COUNT = 1;
        gameConfig.MIN_CANASTAS_OUT = 1;
    } else {
        gameConfig.DRAW_COUNT = 2;
        gameConfig.MIN_CANASTAS_OUT = 2;
    }

    games[gameId] = new CanastaGame(gameConfig);
    
    const token = humanSocket.handshake.auth.token;
    
    // FETCH SAVED SPEED
    if (token && playerSessions[token] && playerSessions[token].botSpeed) {
        games[gameId].botDelayBase = playerSessions[token].botSpeed;
    } else {
        games[gameId].botDelayBase = 500; // Better default than 350
    }

    games[gameId].resetMatch();
    
    const userName = humanSocket.handshake.auth.username || "Player";
    gameBots[gameId] = {};

    if (playerCount === 2) {
        games[gameId].names = [userName, "Bot 1"];
        gameBots[gameId][1] = new CanastaBot(1, difficulty, '2p');
    } else {
        games[gameId].names = [userName, "Bot 1", "Bot 2", "Bot 3"];
        for (let i = 1; i <= 3; i++) {
            gameBots[gameId][i] = new CanastaBot(i, difficulty, '4p');
        }
    }

    await humanSocket.join(gameId); 
    humanSocket.data.seat = 0;
    humanSocket.data.gameId = gameId;

    // 3. Update the session using the 'token' variable we already declared above
    if (token) {
        const existingName = playerSessions[token] ? playerSessions[token].username : "Player";
        
        playerSessions[token] = { 
            ...playerSessions[token], // Keep botSpeed
            gameId: gameId, 
            seat: 0, 
            username: existingName 
        };
    }

    games[gameId].currentPlayer = 0;
    games[gameId].roundStarter = 0;
    sendUpdate(gameId, humanSocket.id, 0);
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
    const handBacks = game.players.map(p => p.map(c => c.deckType));
    const nextDeckCard = game.deck.length > 0 ? game.deck[0] : null;
    const nextDeckColor = nextDeckCard ? nextDeckCard.deckType : 'Red';

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
        maxPlayers: game.config.PLAYER_COUNT,
        handBacks: handBacks,
        nextDeckColor: nextDeckColor,
    });
}

function broadcastAll(gameId, activeSeat) {
    const game = games[gameId]; 
    if (!game) return;

    game.lastActive = Date.now();

    const pile = game.discardPile;
    const topCard = pile.length > 0 ? pile[pile.length-1] : null;
    const prevCard = pile.length > 1 ? pile[pile.length-2] : null;
    const freezingCard = getFreezingCard(game);
    const isFrozen = !!freezingCard;
    const handBacks = game.players.map(p => p.map(c => c.deckType));
    const names = getPlayerNames(gameId);
    const nextDeckCard = game.deck.length > 0 ? game.deck[0] : null;
    const nextDeckColor = nextDeckCard ? nextDeckCard.deckType : 'Red';

    io.sockets.sockets.forEach((s) => {
        if (s.data.gameId === gameId) {
            let update = {
                bankTimers: game.bankTimers,
                currentPlayer: game.currentPlayer, 
                handBacks: handBacks,
                nextDeckColor: nextDeckColor,
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
    if (!game || !gameBots[gameId] || game.turnPhase === 'game_over') return;

    let curr = game.currentPlayer;
    let bot = gameBots[gameId][curr];

    if (bot && game.processingTurnFor !== curr) {
        game.processingTurnFor = curr;
        
        // Always grab the freshest speed from the game object
        const baseSpeed = game.botDelayBase || 350;
        const delay = (game.turnPhase === 'draw') ? baseSpeed : Math.floor(baseSpeed / 2);

        setTimeout(() => {
            bot.executeTurn(game, (updatedSeat) => {
                if (game.turnPhase === 'game_over') {
                    handleRoundEnd(gameId, io);    
                } else {
                    broadcastAll(gameId, updatedSeat); 
                }
            })
            .then(() => {
                game.processingTurnFor = null; 
                checkBotTurn(gameId); // Recursively check for next action
            })
            .catch(err => {
                console.error(`[BOT ERROR]`, err);
                game.processingTurnFor = null; 
            });
        }, delay);
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
        game.matchIsOver = true;

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
            lastRoundScores: game.finalScores,
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
// --- MEMORY CLEANUP ---
// Runs every 5 minutes to remove stuck games older than 30 minutes
setInterval(() => {
    const now = Date.now();
    const STALE_TIMEOUT = 30 * 60 * 1000; // 30 minutes
    let deletedCount = 0;

    Object.keys(games).forEach(gameId => {
        const game = games[gameId];
        // If a game has no "lastActive" timestamp, mark it now
        if (!game.lastActive) game.lastActive = now;
        
        // If inactive for 30+ mins, delete it
        if (now - game.lastActive > STALE_TIMEOUT) {
            delete games[gameId];
            if (gameBots[gameId]) delete gameBots[gameId];
            deletedCount++;
        }
    });
    
    if (deletedCount > 0) {
        console.log(`[CLEANUP] Removed ${deletedCount} stale games to free memory.`);
        // Force garbage collection if exposed (optional, requires --expose-gc)
        if (global.gc) global.gc(); 
    }
}, 5 * 60 * 1000); 

// Update timestamp on every move
// (You need to add `games[gameId].lastActive = Date.now()` inside broadcastAll or sendUpdate)
server.listen(PORT, '0.0.0.0', () => { 
    console.log(`Server running on port ${PORT}`);
    if (DEV_MODE) console.log("⚠️  DEV MODE ACTIVE: DB Disabled. Use ANY login.");
});
async function handleForfeit(gameId, loserSeat) {
    const game = games[gameId];
    if (!game) return;

    const playerCount = game.config.PLAYER_COUNT;

    // Identify loser team
    // 2P: Team1 = seat 0, Team2 = seat 1
    // 4P: Team1 = seats 0 & 2, Team2 = seats 1 & 3
    const isTeam1Loser = (playerCount === 4)
        ? (loserSeat === 0 || loserSeat === 2)
        : (loserSeat === 0);

    const winnerTeam = isTeam1Loser ? "team2" : "team1";

    console.log(`[FORFEIT] Game ${gameId} ended. Leaver: Seat ${loserSeat}. Winner: ${winnerTeam}`);
    game.matchIsOver = true;

    // 1) Notify clients immediately
    io.to(gameId).emit('match_over', {
        winner: winnerTeam,
        scores: game.cumulativeScores,
        reason: "forfeit",
        names: game.names
    });

    // 2) ELO CALCULATION (Ranked only)
    if (!DEV_MODE && game.isRated) {
        try {
            const players = {};

            // A. Retrieve user docs for all seats
            for (let i = 0; i < playerCount; i++) {
                const token = (game.playerTokens && game.playerTokens[i]) ? game.playerTokens[i] : null;
                if (!token) continue;
                const user = await User.findOne({ token });
                if (user) players[i] = user;
            }

            // B. Team average ratings (fallback 1200 per missing seat)
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

            // C. Compute a base loss using a "stomp" score, then apply special rules
            // calculateEloChange returns Team1's change.
            const team1Won = !isTeam1Loser;
            const s1 = team1Won ? 5000 : 0;
            const s2 = team1Won ? 0 : 5000;

            const team1Delta = calculateEloChange(team1Rating, team2Rating, s1, s2);

            // Convert to the losing team's "natural" loss (always negative)
            const baseLoss = Math.round(team1Won ? -team1Delta : team1Delta);

            const LEAVER_PENALTY_MULTIPLIER = 1.5; // 50% extra penalty for the quitter
            const updates = {};

            for (let seat = 0; seat < playerCount; seat++) {
                if (!players[seat]) continue;

                // Is this seat on the losing team?
                const onLosingTeam = (playerCount === 2)
                    ? (seat === loserSeat)
                    : ((isTeam1Loser && (seat === 0 || seat === 2)) ||
                       (!isTeam1Loser && (seat === 1 || seat === 3)));

                if (onLosingTeam) {
                    if (seat === loserSeat) {
                        // Rule 1: The inactive/leaving player gets the full penalty
                        const penalty = Math.round(baseLoss * LEAVER_PENALTY_MULTIPLIER); // negative
                        players[seat].stats.rating += penalty;
                        players[seat].stats.losses++;
                        updates[seat] = { delta: penalty, newRating: players[seat].stats.rating };
                    } else if (playerCount === 4) {
                        // Rule 2: In 4P ranked, the partner gets no rating penalty
                        // (and no loss stat)
                        updates[seat] = { delta: 0, newRating: players[seat].stats.rating };
                    } else {
                        // Should never happen in 2P, but keep a safe default
                        players[seat].stats.rating += baseLoss;
                        players[seat].stats.losses++;
                        updates[seat] = { delta: baseLoss, newRating: players[seat].stats.rating };
                    }
                    } else {
                    // Rule 3: Winners gain the standard win amount
                    const winPoints = Math.abs(baseLoss);
                    players[seat].stats.rating += winPoints;
                    players[seat].stats.wins++;
                    updates[seat] = { delta: winPoints, newRating: players[seat].stats.rating };
                }

                await players[seat].save();
            }

            io.to(gameId).emit('rating_update', updates);

        } catch (e) {
            console.error("Forfeit Elo Error:", e);
        }
    }
    
    // 3) Cleanup game from memory
    setTimeout(() => {
        delete games[gameId];
        delete gameBots[gameId];
    }, 10000);
    
}
setInterval(() => {
    Object.keys(games).forEach(gameId => {
        const game = games[gameId];
        if (game && !game.matchIsOver && !game.isLobby && game.currentPlayer !== -1) {
            const activeSeat = game.currentPlayer;
            if (game.bankTimers[activeSeat] > 0) {
                game.bankTimers[activeSeat]--;

                if (game.bankTimers[activeSeat] <= 0) {
                    console.log(`[BANK TIMEOUT] Seat ${activeSeat} ran out of time in Game ${gameId}`);
                    handleForfeit(gameId, activeSeat);
                }
            }
            
            // NEW: Every second, send the current bank timers to everyone in this game room
            io.to(gameId).emit('timer_sync', { bankTimers: game.bankTimers });
        }
    });
}, 1000);

app.post('/api/create-checkout-session', async (req, res) => {
    // 1. IDENTIFY THE USER
    const token = req.headers.authorization;
    let username = null;

    if (token) {
        // Option A: Check active session memory
        if (playerSessions[token]) {
            username = playerSessions[token].username;
        } 
        // Option B: Verify JWT (if server restarted)
        else {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                username = decoded.username;
            } catch (e) {
                console.log("Checkout Auth Failed:", e.message);
            }
        }
    }

    // 2. REJECT IF UNKNOWN (Prevents "Payment for undefined")
    if (!username) {
        return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    // 3. CREATE SESSION
    try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const baseUrl = `${protocol}://${host}`;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            // 4. ATTACH USERNAME TO METADATA (So Webhook can read it)
            metadata: {
                username: username 
            },
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Canasta Club Premium',
                    },
                    unit_amount: 290, 
                    recurring: {
                        interval: 'month', 
                    },
                },
                quantity: 1,
            }],
            mode: 'subscription',
            success_url: `${baseUrl}/?payment=success`,
            cancel_url: `${baseUrl}/?payment=cancelled`,
        });

        res.json({ url: session.url });
    } catch (e) {
        console.error("Stripe Error:", e.message);
        res.status(500).json({ error: e.message });
    }
});