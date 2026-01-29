// server.js - vBeta 1.0
require('dotenv').config();
const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
const { Server } = require('socket.io');
const https = require('https'); // For keep-alive
const lifecycle = require('./services/gameLifecycle');
// --- LOCAL MODULES ---
const { CanastaGame } = require('./game');
const { CanastaBot } = require('./bot');
const { calculateEloChange } = require('./elo');

// --- CONFIGURATION ---
const JWT_SECRET = process.env.JWT_SECRET;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 3000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET is not defined.");
    process.exit(1);
}

// --- SETUP EXPRESS & DB ---
const app = express();
const server = http.createServer(app);

// Trust Proxy (Required for Rate Limiting on platforms like Render/Heroku)
app.set('trust proxy', 1);

let DEV_MODE = false;
let User;

if (!MONGO_URI) {
    console.log("⚠️  [SYSTEM] MONGO_URI missing. Starting in DEV MODE (No DB).");
    DEV_MODE = true;
} else {
    // Show partial connection string for debug
    console.log("DEBUG: Connection String starts with:", MONGO_URI.substring(0, 25) + "...");
    mongoose.connect(MONGO_URI)
        .then(() => console.log("[DB] Connected to MongoDB"))
        .catch(err => console.error("[DB] Connection Error:", err));
}

if (!DEV_MODE) {
    User = require('./models/user');
}

// --- STRIPE WEBHOOK ---
app.post('/webhook', express.raw({type: 'application/json'}), async (request, response) => {
    const sig = request.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(request.body, sig, endpointSecret);
    } catch (err) {
        console.log(`⚠️  Webhook signature verification failed.`, err.message);
        return response.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const username = session.metadata.username;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        console.log(`💰 WEBHOOK: Payment for ${username}`);

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
                console.log(`✅ DB UPDATE: ${username} is now Premium!`);
            } catch (e) {
                console.error("❌ DB Update Failed:", e);
            }
        }
    }
    response.send();
});

// --- GLOBAL MIDDLEWARE ---
app.use(express.json());
app.use(express.static('public'));

// --- RATE LIMITER ---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: { success: false, message: "Too many attempts, please try again later." }
});

// --- ROUTES ---
const authRoutes = require('./routes/auth');
app.use('/api/register', authLimiter);
app.use('/api/login', authLimiter);
app.use('/api', authRoutes(User, DEV_MODE));

// --- GLOBAL STATE ---
const games = {};
const gameBots = {};
const playerSessions = {}; // Map: token -> { gameId, seat, username, botSpeed }
const disconnectTimers = {}; // Map: `${gameId}_${seat}` -> timeout

// --- SOCKET.IO ---
const io = new Server(server, {
    cors: { origin: true, methods: ["GET", "POST"], credentials: true },
    transports: ['polling', 'websocket']
});

// Wrapper for Matchmaking (it expects 3 args, but lifecycle needs io/games)
const sendUpdateWrapper = (gameId, socketId, seat) => {
    lifecycle.sendUpdate(io, games, gameId, socketId, seat);
};

const matchmakingService = require('./services/matchmaking')(
    games,
    gameBots,
    playerSessions,
    sendUpdateWrapper // Pass the wrapper, not the raw function
);

// --- API ENDPOINTS ---

app.get('/api/profile', async (req, res) => {
    const token = req.headers.authorization;
    if (!token) return res.json({ success: false, message: "No token" });

    if (DEV_MODE) {
        return res.json({
            success: true,
            username: "DevPlayer",
            stats: { rating: 1250, wins: 5, losses: 2 },
            isPremium: true
        });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findOne({ username: decoded.username });
        if (!user) return res.json({ success: false, message: "User not found" });

        res.json({
            success: true,
            username: user.username,
            stats: user.stats,
            isPremium: user.isPremium || false
        });
    } catch (e) {
        console.error("Profile fetch error:", e);
        res.status(401).json({ success: false, message: "Invalid Token" });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    if (DEV_MODE) {
        const mockData = Array.from({ length: 25 }, (_, i) => ({
            username: `Player_${i + 1}`,
            stats: { rating: 2000 - (i * 50), wins: 50 - i, losses: 10 + i }
        }));
        return res.json({ success: true, leaderboard: mockData });
    }

    try {
        const topPlayers = await User.find({})
            .sort({ 'stats.rating': -1 })
            .limit(10)
            .select('username stats.rating stats.wins stats.losses -_id');

        res.json({ success: true, leaderboard: topPlayers });
    } catch (e) {
        console.error("[API] Leaderboard Error:", e);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

app.post('/api/create-checkout-session', async (req, res) => {
    const token = req.headers.authorization;
    let username = getUsernameFromToken(token);

    if (!username) return res.status(401).json({ error: "Session expired." });

    try {
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const baseUrl = `${protocol}://${host}`;

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            metadata: { username: username },
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: { name: 'Canasta Club Premium' },
                    unit_amount: 290,
                    recurring: { interval: 'month' },
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

app.post('/api/create-portal-session', async (req, res) => {
    const token = req.headers.authorization;
    let username = getUsernameFromToken(token);

    if (!username) return res.status(401).json({ error: "Session expired." });
    if (DEV_MODE) return res.status(400).json({ error: "N/A in Dev Mode." });

    try {
        const user = await User.findOne({ username: username });
        if (!user || !user.stripeCustomerId) {
            return res.status(400).json({ error: "No active subscription found." });
        }

        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const returnUrl = `${protocol}://${host}/`;

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: user.stripeCustomerId,
            return_url: returnUrl,
        });

        res.json({ url: portalSession.url });
    } catch (e) {
        console.error("Stripe Portal Error:", e.message);
        res.status(500).json({ error: "Could not create portal session." });
    }
});

io.on('connection', async (socket) => {
    const sendUpdate = (gameId, sId, seat) => lifecycle.sendUpdate(io, games, gameId, sId, seat);
    const broadcastAll = (gameId, seat) => lifecycle.broadcastAll(io, games, gameBots, gameId, seat, checkBotTurn);
    const handleRoundEnd = (gameId) => lifecycle.handleRoundEnd(io, games, gameBots, User, gameId, DEV_MODE);
    const handleForfeit = (gameId, seat) => lifecycle.handleForfeit(io, games, gameBots, User, gameId, seat, DEV_MODE);
    const applyPartnerPenalty = (gameId, seat) => lifecycle.applyPartnerPenalty(io, games, gameId, seat);

    const token = socket.handshake.auth.token;

    // 1. AUTH & SESSION RECOVERY
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            validUser = decoded.username;
            if (!playerSessions[token]) playerSessions[token] = { username: validUser };
            else playerSessions[token].username = validUser;
        } catch (err) {
            // Invalid Token
        }
    }

    // Fallback for username (Dev/Guest)
    if (token && playerSessions[token] && !playerSessions[token].username) {
        playerSessions[token].username = socket.handshake.auth.username;
    }

    const session = playerSessions[token];

    // 2. RECONNECT LOGIC
    if (session && session.gameId && games[session.gameId]) {
        socket.data.gameId = session.gameId;
        socket.data.seat = session.seat;
        await socket.join(session.gameId);
        
        console.log(`[Reconnect] Player restored to Game ${session.gameId}`);
        lifecycle.sendUpdate(session.gameId, socket.id, session.seat);

        // Cancel Forfeit Timer
        const timerKey = `${session.gameId}_${session.seat}`;
        if (disconnectTimers[timerKey]) {
            console.log(`[Reconnect] Timer cancelled for Seat ${session.seat}`);
            clearTimeout(disconnectTimers[timerKey]);
            delete disconnectTimers[timerKey];
            
            if (games[session.gameId].disconnectedPlayers) {
                delete games[session.gameId].disconnectedPlayers[session.seat];
            }
        }
    } else if (session) {
        // Stale session cleanup
        delete playerSessions[token];
    }

    // --- SOCKET EVENT HANDLERS ---

    socket.on('disconnect', () => {
        matchmakingService.removeSocketFromQueue(socket.id);
        const { gameId, seat } = socket.data;

        if (gameId && games[gameId] && !games[gameId].matchIsOver) {
            console.log(`[Game ${gameId}] Player ${seat} disconnected. Starting 60s timer.`);
            if (!games[gameId].disconnectedPlayers) games[gameId].disconnectedPlayers = {};
            games[gameId].disconnectedPlayers[seat] = true;

            const timerKey = `${gameId}_${seat}`;
            disconnectTimers[timerKey] = setTimeout(() => {
                console.log(`[Forfeit] Player ${seat} timeout. Ending Game ${gameId}.`);
                lifecycle.handleForfeit(gameId, seat);
            }, 60000);
        }
    });

    // --- LOBBY & JOINING ---
    socket.on('request_join', async (data) => {
        const token = socket.handshake.auth.token;
        const currentId = socket.data.gameId || (playerSessions[token] ? playerSessions[token].gameId : null);

        if (currentId) {
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
        const requestedId = data.gameId ? data.gameId.trim() : "";
        if (!requestedId || games[requestedId]) {
            return socket.emit('error_message', "Invalid or taken Room Name.");
        }

        const pCount = parseInt(data.playerCount) || 4;
        const config = getGameConfig(pCount, data.ruleset);
        
        createGameInstance(requestedId, config, true); // true = isPrivate
        const game = games[requestedId];
        game.host = socket.id;
        game.names = Array(pCount).fill(null);
        game.names[0] = socket.handshake.auth.username || "Host";

        socket.join(requestedId);
        socket.data.gameId = requestedId;
        socket.data.seat = 0;

        socket.emit('private_created', { gameId: requestedId, seat: 0 });
        broadcastLobby(requestedId);
    });

    socket.on('request_join_private', (data) => {
        const { gameId } = data;
        const game = games[gameId];

        if (!game || !game.isPrivate) return socket.emit('error_message', "Game not found.");
        
        const seat = game.names.findIndex(n => n === null);
        if (seat === -1) return socket.emit('error_message', "Room is full.");

        const pName = socket.handshake.auth.username || `Player ${seat + 1}`;
        game.names[seat] = pName;

        socket.join(gameId);
        socket.data.gameId = gameId;
        socket.data.seat = seat;

        const token = socket.handshake.auth.token;
        if (token) {
            playerSessions[token] = { gameId, seat, username: pName };
        }

        broadcastLobby(gameId);
        lifecycle.broadcastAll(gameId); // Update lobby view
        socket.emit('joined_private_success', { gameId, seat });
    });

    socket.on('act_host_start', () => {
        const { gameId } = socket.data;
        const game = games[gameId];
        if (!game || !game.isLobby || game.host !== socket.id) return;

        if (game.names.filter(n => n !== null).length < game.config.PLAYER_COUNT) {
            return socket.emit('error_message', "Wait for all players!");
        }

        game.resetMatch();
        game.isLobby = false;

        io.sockets.sockets.forEach((s) => {
            if (s.data.gameId === gameId) lifecycle.sendUpdate(gameId, s.id, s.data.seat);
        });
    });

    socket.on('act_switch_seat', (targetSeat) => {
        const { gameId, seat } = socket.data;
        const game = games[gameId];
        if (!game || !game.isLobby) return;
        
        if (targetSeat >= 0 && targetSeat < game.config.PLAYER_COUNT && game.names[targetSeat] === null) {
            game.names[targetSeat] = game.names[seat];
            game.names[seat] = null;
            socket.data.seat = targetSeat;
            
            const token = socket.handshake.auth.token;
            if (token && playerSessions[token]) playerSessions[token].seat = targetSeat;

            socket.emit('seat_changed', { newSeat: targetSeat });
            broadcastLobby(gameId);
        }
    });

    // --- GAMEPLAY ACTIONS ---
    socket.on('act_ready', (data) => {
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (!game) return;

        if (!game.readySeats) game.readySeats = new Set();
        game.readySeats.add(data.seat);

        // Auto-ready bots
        if (gameBots[gameId]) {
            Object.keys(gameBots[gameId]).forEach(bs => game.readySeats.add(parseInt(bs)));
        }

        io.to(gameId).emit('ready_status', { readySeats: Array.from(game.readySeats) });

        if (game.readySeats.size === game.config.PLAYER_COUNT && game.currentPlayer === -1) {
            game.roundStarter = 0;
            game.currentPlayer = 0;
            game.turnPhase = 'draw';
            
            io.sockets.sockets.forEach((s) => {
                if (s.data.gameId === gameId) lifecycle.sendUpdate(gameId, s.id, s.data.seat);
            });
        }
    });

    socket.on('act_draw', ({ seat }) => {
        const game = games[socket.data.gameId];
        if (!game) return;
        
        const res = game.drawFromDeck(seat);
        if (res.success) {
            if (res.message === "GAME_OVER_DECK_EMPTY") lifecycle.handleRoundEnd(socket.data.gameId);
            else lifecycle.broadcastAll(socket.data.gameId, seat);
        } else {
             // Sync if phase mismatch (lag)
             if (res.message === "Wrong phase!" && game.currentPlayer === seat) {
                 lifecycle.sendUpdate(socket.data.gameId, socket.id, seat);
             } else {
                 socket.emit('error_message', res.message);
             }
        }
    });

    socket.on('act_pickup', ({ seat }) => {
        const game = games[socket.data.gameId];
        if (!game) return;
        const res = game.pickupDiscardPile(seat);
        if (res.success) {
            if (res.message === "GAME_OVER") lifecycle.handleRoundEnd(socket.data.gameId);
            else lifecycle.broadcastAll(socket.data.gameId, seat);
        } else {
            socket.emit('error_message', res.message);
        }
    });

    socket.on('act_discard', ({ seat, index }) => {
        const game = games[socket.data.gameId];
        if (!game) return;

        // Partner Permission Checks (4P only)
        if (game.config.PLAYER_COUNT === 4) {
            const hand = game.players[seat];
            const willGoOut = (hand.length === 1); 
            if ((willGoOut && game.goOutPermission === 'denied') || (!willGoOut && game.goOutPermission === 'granted')) {
                applyPartnerPenalty(game, seat, io, socket.data.gameId);
                if (willGoOut) return; // Block going out
            }
        }

        const res = game.discardFromHand(seat, index);
        if (res.success) {
            game.goOutPermission = null;
            if (res.message === "GAME_OVER") lifecycle.handleRoundEnd(socket.data.gameId);
            else lifecycle.broadcastAll(socket.data.gameId, seat);
        } else {
            socket.emit('error_message', res.message);
        }
    });

    socket.on('act_meld', (data) => {
        const game = games[socket.data.gameId];
        if (!game) return;a

        // Partner Permission Check
        if (game.config.PLAYER_COUNT === 4) {
            const willGoOut = (game.players[data.seat].length === data.indices.length);
            if (willGoOut && game.goOutPermission === 'denied') {
                applyPartnerPenalty(game, data.seat, io, socket.data.gameId);
                socket.emit('error_message', "Partner said NO! You cannot go out.");
                lifecycle.broadcastAll(socket.data.gameId);
                return;
            }
        }

        const res = game.meldCards(data.seat, data.indices, data.targetRank);
        if (res.success) {
            if (res.message === "GAME_OVER") lifecycle.handleRoundEnd(socket.data.gameId);
            else lifecycle.broadcastAll(socket.data.gameId, data.seat);
        } else {
            socket.emit('error_message', res.message);
        }
    });

    socket.on('act_open_game', (data) => {
        const game = games[socket.data.gameId];
        if (!game) return;
        const res = game.processOpening(data.seat, data.melds, data.pickup);
        if (res.success) {
            if (res.message === "GAME_OVER") lifecycle.handleRoundEnd(socket.data.gameId);
            else lifecycle.broadcastAll(socket.data.gameId, data.seat);
        } else {
            socket.emit('error_message', res.message);
        }
    });

    socket.on('act_ask_go_out', ({ seat }) => {
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (!game || game.config.PLAYER_COUNT !== 4) return;
        if (game.currentPlayer !== seat || game.turnPhase !== 'playing') return;

        const partnerSeat = (seat + 2) % 4;
        game.goOutPermission = 'pending';

        if (gameBots[gameId] && gameBots[gameId][partnerSeat]) {
            const bot = gameBots[gameId][partnerSeat];
            const decision = bot.decideGoOutPermission(game);
            game.goOutPermission = decision ? 'granted' : 'denied';
            io.to(gameId).emit('ask_result', { seat: partnerSeat, decision });
        } else {
            io.sockets.sockets.forEach((s) => {
                if (s.data.gameId === gameId && s.data.seat === partnerSeat) {
                    s.emit('ask_request', { askingSeat: seat });
                }
            });
        }
    });

    socket.on('act_reply_go_out', ({ seat, decision }) => {
        const game = games[socket.data.gameId];
        if (game && game.goOutPermission === 'pending') {
            game.goOutPermission = decision ? 'granted' : 'denied';
            io.to(socket.data.gameId).emit('ask_result', { seat, decision });
        }
    });

    // --- ROUND/MATCH FLOW ---
    socket.on('act_next_round', () => {
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (!game || game.turnPhase !== "game_over") return;

        if (!game.nextRoundReady) game.nextRoundReady = new Set();
        game.nextRoundReady.add(socket.data.seat);

        if (gameBots[gameId]) {
            Object.keys(gameBots[gameId]).forEach(bs => game.nextRoundReady.add(parseInt(bs)));
        }

        socket.emit('next_round_ack');

        if (game.nextRoundReady.size >= game.config.PLAYER_COUNT) {
            if (game.cleanupTimer) {
                clearTimeout(game.cleanupTimer);
                game.cleanupTimer = null;
            }
            game.startNextRound();
            game.nextRoundReady = new Set();
            lifecycle.broadcastAll(gameId);
        }
    });

    socket.on('act_request_rematch', () => {
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (!game) return;

        if (!game.rematchVotes) game.rematchVotes = new Set();
        game.rematchVotes.add(socket.data.seat);
        
        if (gameBots[gameId]) {
            Object.keys(gameBots[gameId]).forEach(bs => game.rematchVotes.add(parseInt(bs)));
        }

        io.to(gameId).emit('rematch_update', { current: game.rematchVotes.size, needed: game.config.PLAYER_COUNT });

        if (game.rematchVotes.size >= game.config.PLAYER_COUNT) {
            console.log(`[Rematch] Restarting Game ${gameId}`);
            if (game.cleanupTimer) clearTimeout(game.cleanupTimer);
            
            game.matchIsOver = false;
            game.disconnectedPlayers = {};
            game.resetMatch();
            
            // Hard reset timers
            game.bankTimers = {};
            for (let i = 0; i < game.config.PLAYER_COUNT; i++) game.bankTimers[i] = 720;

            game.rematchVotes.clear();
            
            io.sockets.sockets.forEach((s) => {
                if (s.data.gameId === gameId) lifecycle.sendUpdate(gameId, s.id, s.data.seat);
            });
            checkBotTurn(gameId);
        }
    });

    socket.on('act_timeout', () => {
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (!game || game.matchIsOver) return;

        // Security check: ensure actually stale
        const timeSinceAction = Date.now() - game.lastActionTime;
        if (timeSinceAction > 58000) {
            console.log(`[TIMEOUT] Ending Game ${gameId}. Player ${game.currentPlayer} AFK.`);
            lifecycle.handleForfeit(gameId, game.currentPlayer);
        }
    });

    socket.on('leave_game', async () => {
        const gameId = socket.data.gameId;
        matchmakingService.removeSocketFromQueue(socket.id);
        
        const token = socket.handshake.auth.token;
        if (token && playerSessions[token]) delete playerSessions[token];

        socket.data.gameId = null;
        socket.data.seat = null;
        if (gameId) await socket.leave(gameId);
        
        // Handle Lobby Leave
        const game = games[gameId];
        if (game && game.isPrivate && game.isLobby) {
             // Logic to clear seat name handled by next lobby refresh or if host leaves
        }
    });

    // --- SOCIAL & UTILS ---
    socket.on('updateBotSpeed', ({ speed }) => {
        const gameId = socket.data.gameId || (playerSessions[socket.handshake.auth.token]?.gameId);
        if (gameId && games[gameId]) {
            games[gameId].botDelayBase = speed;
        }
        const token = socket.handshake.auth.token;
        if (token && playerSessions[token]) playerSessions[token].botSpeed = speed;
    });

    socket.on('social_search', async (query) => {
        if (!DEV_MODE && query.length > 2) {
            const users = await User.find({ username: { $regex: query, $options: 'i' } }).limit(5);
            socket.emit('social_search_results', users.map(u => u.username));
        }
    });

    socket.on('social_add_friend', async (target) => {
        if (!DEV_MODE) {
            const myName = socket.handshake.auth.username;
            if (myName === target) return;
            await User.updateOne({ username: myName }, { $addToSet: { friends: target } });
            // Refresh logic emitted back
            const me = await User.findOne({ username: myName });
            emitSocialList(socket, me);
        }
    });

    socket.on('social_block_user', async (target) => {
         if (!DEV_MODE) {
            const myName = socket.handshake.auth.username;
            await User.updateOne({ username: myName }, { 
                $addToSet: { blocked: target },
                $pull: { friends: target }
            });
            const me = await User.findOne({ username: myName });
            emitSocialList(socket, me);
         }
    });

    socket.on('social_get_lists', async () => {
        if (!DEV_MODE) {
            const me = await User.findOne({ username: socket.handshake.auth.username });
            if (me) emitSocialList(socket, me);
        }
    });
});

// --- HELPER FUNCTIONS ---

function getGameConfig(pCount, ruleset) {
    const config = (pCount === 2) 
        ? { PLAYER_COUNT: 2, HAND_SIZE: 15 } 
        : { PLAYER_COUNT: 4, HAND_SIZE: 11 };

    if (ruleset === 'easy') {
        config.DRAW_COUNT = 1;
        config.MIN_CANASTAS_OUT = 1;
    } else {
        config.DRAW_COUNT = 2;
        config.MIN_CANASTAS_OUT = 2;
    }
    return config;
}

function createGameInstance(gameId, config, isPrivate = false) {
    games[gameId] = new CanastaGame(config);
    games[gameId].isPrivate = isPrivate;
    games[gameId].isLobby = isPrivate; // Only private starts as lobby
    games[gameId].matchIsOver = false;
    games[gameId].readySeats = new Set();
    
    // Initialize Bank Timers
    games[gameId].bankTimers = {};
    for (let i = 0; i < config.PLAYER_COUNT; i++) games[gameId].bankTimers[i] = 720;
}

async function startBotGame(humanSocket, difficulty, playerCount, ruleset) {
    const gameId = 'game_' + Math.random().toString(36).substr(2, 9);
    const config = getGameConfig(playerCount, ruleset);
    
    createGameInstance(gameId, config);
    games[gameId].resetMatch();
    
    // Set Bot Speed
    const token = humanSocket.handshake.auth.token;
    if (token && playerSessions[token]?.botSpeed) {
        games[gameId].botDelayBase = playerSessions[token].botSpeed;
    } else {
        games[gameId].botDelayBase = 500;
    }

    const userName = humanSocket.handshake.auth.username || "Player";
    games[gameId].names = [userName, "Bot 1", "Bot 2", "Bot 3"].slice(0, playerCount);
    gameBots[gameId] = {};

    const botType = (playerCount === 2) ? '2p' : '4p';
    for (let i = 1; i < playerCount; i++) {
        gameBots[gameId][i] = new CanastaBot(i, difficulty, botType);
    }

    await humanSocket.join(gameId);
    humanSocket.data.seat = 0;
    humanSocket.data.gameId = gameId;

    if (token) {
        playerSessions[token] = { 
            ...playerSessions[token], 
            gameId, seat: 0, username: userName 
        };
    }

    lifecycle.sendUpdate(gameId, humanSocket.id, 0);
}

function broadcastLobby(gameId) {
    const game = games[gameId];
    if (!game) return;
    io.to(gameId).emit('lobby_update', {
        names: game.names,
        hostSeat: 0, 
        maxPlayers: game.config.PLAYER_COUNT
    });
}

function checkBotTurn(gameId) {
    const game = games[gameId];
    if (!game || !gameBots[gameId] || game.turnPhase === 'game_over') return;

    const curr = game.currentPlayer;
    const bot = gameBots[gameId][curr];

    if (bot && game.processingTurnFor !== curr) {
        game.processingTurnFor = curr;
        const baseSpeed = game.botDelayBase || 350;
        const delay = (game.turnPhase === 'draw') ? baseSpeed : Math.floor(baseSpeed / 2);

        setTimeout(() => {
            bot.executeTurn(game, (updatedSeat) => {
                if (game.turnPhase === 'game_over') lifecycle.handleRoundEnd(gameId);
                else lifecycle.broadcastAll(gameId, updatedSeat);
            })
            .then(() => {
                game.processingTurnFor = null;
                checkBotTurn(gameId);
            })
            .catch(err => {
                console.error(`[BOT ERROR]`, err);
                game.processingTurnFor = null;
            });
        }, delay);
    }
}

function getUsernameFromToken(token) {
    if (!token) return null;
    if (playerSessions[token]) return playerSessions[token].username;
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded.username;
    } catch (e) { return null; }
}

async function emitSocialList(socket, userDoc) {
    const friendDocs = await User.find({ username: { $in: userDoc.friends } });
    const friendData = friendDocs.map(f => ({ username: f.username, isOnline: f.isOnline }));
    socket.emit('social_list_data', { friends: friendData, blocked: userDoc.blocked });
}

// --- SERVER INTERVALS ---

// 1. Bank Timers (Every 1s)
setInterval(() => {
    Object.keys(games).forEach(gameId => {
        const game = games[gameId];
        if (game && !game.matchIsOver && !game.isLobby && game.currentPlayer !== -1) {
            const active = game.currentPlayer;
            if (game.bankTimers[active] > 0) {
                game.bankTimers[active]--;
                if (game.bankTimers[active] <= 0) lifecycle.handleForfeit(gameId, active);
            }
            io.to(gameId).emit('timer_sync', { bankTimers: game.bankTimers });
        }
    });
}, 1000);

// 2. Stale Game Cleanup (Every 5 mins)
setInterval(() => {
    const now = Date.now();
    Object.keys(games).forEach(gameId => {
        const game = games[gameId];
        if (!game.lastActive) game.lastActive = now;
        if (now - game.lastActive > 30 * 60 * 1000) {
            delete games[gameId];
            delete gameBots[gameId];
        }
    });
    if (global.gc) global.gc();
}, 5 * 60 * 1000);

// 3. Keep Alive (Render)
if (!DEV_MODE) {
    setInterval(() => {
        https.get('https://la-canasta.onrender.com/', () => {}).on('error', () => {});
    }, 14 * 60 * 1000);
}

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    if (DEV_MODE) console.log("⚠️  DEV MODE ACTIVE");
});