require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const http = require('http');
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const Stripe = require('stripe');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
// Game Imports
const { CanastaGame } = require('./www/game.js');
const { CanastaBot } = require('./scripts/bot.js');
const { calculateEloChange } = require('./www/elo.js');
const { recordHumanTurn } = require('./recorder.js');
const app = express();
const server = http.createServer(app);
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_dev_placeholder');

// DEV MODE can now be forced with .env
const FORCE_DEV_MODE = process.env.DEV_MODE === 'true';

// In dev, allow a fallback JWT secret so local testing works
const JWT_SECRET = process.env.JWT_SECRET || 'local-dev-secret';

if (!process.env.JWT_SECRET && !FORCE_DEV_MODE && process.env.MONGO_URI) {
    console.error("FATAL ERROR: JWT_SECRET is not defined.");
    process.exit(1);
}

app.set('trust proxy', 1);
app.post('/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
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

// Enable CORS for API routes (needed for Capacitor Android app)
app.use(cors({
    origin: true, // Allows your mobile app to connect
    credentials: true
}));

app.use(express.json());

// Health check route - Moved up to ensure it's not shadowed by static files
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        readyState: mongoose.connection.readyState,
        devMode: DEV_MODE,
        dbName: mongoose.connection.name || 'none'
    });
});

// Route to download training data (since Render filesystem is hidden)
app.get('/api/admin/download-training-data', (req, res) => {
    const filePath = path.join(__dirname, 'human_training_data.jsonl');
    if (fs.existsSync(filePath)) {
        res.download(filePath);
    } else {
        res.status(404).json({ success: false, message: "File not found. Play a bot game first!" });
    }
});

// 2. CONFIGURE LIMITER
// Allow max 20 requests per 15 minutes from the same IP
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20,
    message: { success: false, message: "Too many attempts, please try again later." }
});

// 3. APPLY TO AUTH ROUTES
app.use('/api/register', authLimiter);
app.use('/api/login', authLimiter);
const disconnectTimers = {};
const io = new Server(server, {
    cors: {
        origin: [
    'https://canastamaster.club',
    'capacitor://localhost',
    'http://localhost',
    'http://localhost:8080',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
    'http://127.0.0.1:4173'
],
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['polling', 'websocket']
});

// 1. Serve 'public' using __dirname (Standard)
app.use(express.static(path.join(__dirname, 'www')));

// 2. Fallback: Serve 'public' from Current Working Directory (Fix for some hosting envs)
app.use(express.static(path.join(process.cwd(), 'www')));

// --- 2. MONGODB & DEV MODE CONFIGURATION ---
const MONGO_URI = process.env.MONGO_URI;
let DEV_MODE = FORCE_DEV_MODE; // explicit override from .env

if (DEV_MODE || !MONGO_URI) {
    DEV_MODE = true;
    console.log("⚠️  [SYSTEM] Starting in DEV MODE.");
    console.log("👉  [SYSTEM] Login bypassed.");
    console.log("👉  [SYSTEM] Stats will not be saved.");
    console.log("👉  [SYSTEM] Local bot games can auto-start.");
} else {
    console.log("[DB] Attempting to connect to MongoDB...");
    mongoose.connect(MONGO_URI, {
        serverSelectionTimeoutMS: 5000 // Fail fast if connection is blocked
    })
        .then(async () => {
            console.log(`[DB] Connected to MongoDB: ${mongoose.connection.name}`);
            try {
                if (User) {
                    console.log("[DB] Starting to reset online statuses...");
                    const result = await Promise.race([
                        User.updateMany({}, { isOnline: false }),
                        new Promise((_, reject) => 
                            setTimeout(() => reject(new Error('Timeout')), 5000)
                        )
                    ]);
                    console.log("[SYSTEM] Reset all user online statuses.");
                }
            } catch (err) {
                console.error("[DB] Error resetting online statuses:", err.message);
            }
        })
        .catch(err => console.error("[DB] Connection Error:", err));
}

// --- 3. DATABASE MODELS ---
let User;
if (!DEV_MODE) {
    User = require('./models/user');
}

// --- 4. ROUTE MOUNTING ---
const authRoutes = require('./routes/auth');
// Mount the routes at '/api', passing in User and the DEV_MODE flag
app.use('/api', authRoutes(User, DEV_MODE));
// --- DEV QUICK LOGIN / LOCAL TEST BOOTSTRAP ---
app.get('/api/dev-bootstrap', (req, res) => {
    if (!DEV_MODE) {
        return res.status(404).json({ success: false, message: 'DEV_MODE is off' });
    }

    const username = normalizeDevUsername(req.query.username);
    const token = createDevToken(username);

    playerSessions[token] = {
        username,
        botSpeed: 500
    };

        const devEntry = getDevPlayerEntry(username);

    res.json({
        success: true,
        token,
        username: devEntry.username,
        stats: normalizeStats(devEntry),
        isPremium: true
    });
});

app.get('/dev-login', (req, res) => {
    if (!DEV_MODE) {
        return res.status(404).send('DEV_MODE is off');
    }

    const username = normalizeDevUsername(req.query.username);
    const difficulty = req.query.difficulty || 'medium';
    const playerCount = parseInt(req.query.playerCount, 10) || 2;
    const ruleset = req.query.ruleset || 'standard';

    res.send(`
<!doctype html>
<html>
<head>
    <meta charset="utf-8" />
    <title>Canasta Dev Login</title>
</head>
<body style="font-family: Arial, sans-serif; padding: 24px;">
    <h2>Logging into local DEV mode...</h2>
    <p>User: <strong>${username}</strong></p>
    <script>
        (async () => {
            const resp = await fetch('/api/dev-bootstrap?username=${encodeURIComponent(username)}');
            const data = await resp.json();

            if (!data.success) {
                document.body.innerHTML += '<p style="color:red;">Dev bootstrap failed.</p>';
                return;
            }

            localStorage.setItem('token', data.token);
            localStorage.setItem('username', data.username);

            // Optional dev flags for your frontend if you want to read them later
            localStorage.setItem('devAutoStart', 'true');
            localStorage.setItem('devDifficulty', '${difficulty}');
            localStorage.setItem('devPlayerCount', '${playerCount}');
            localStorage.setItem('devRuleset', '${ruleset}');

            window.location.href = '/';
        })();
    </script>
</body>
</html>
    `);
});
// --- GLOBAL STATE ---

const games = {};
const gameBots = {};
const playerSessions = {};
const activeFriendlyPlayers = {};
function createDevToken(username = 'DevPlayer') {
    return jwt.sign(
        { username, id: 'dev_id' },
        JWT_SECRET,
        { expiresIn: '7d' }
    );
}

function normalizeDevUsername(value) {
    const cleaned = String(value || 'DevPlayer').trim();
    return cleaned || 'DevPlayer';
}

const devPlayerStats = {};

function normalizeStats(source = {}) {
    source = source || {};
    const stats = source.stats || {};

    const rating = Number.isFinite(Number(stats.rating))
        ? Number(stats.rating)
        : Number.isFinite(Number(source.eloRating))
            ? Number(source.eloRating)
            : 1200;

    const wins = Number.isFinite(Number(stats.wins))
        ? Number(stats.wins)
        : Number.isFinite(Number(source.wins))
            ? Number(source.wins)
            : 0;

    const losses = Number.isFinite(Number(stats.losses))
        ? Number(stats.losses)
        : Number.isFinite(Number(source.losses))
            ? Number(source.losses)
            : 0;

    return {
        rating: Math.round(rating),
        wins: Math.max(0, Math.round(wins)),
        losses: Math.max(0, Math.round(losses))
    };
}

function setRatingRecordStats(record, nextStats = {}) {
    const normalized = normalizeStats({ stats: nextStats });

    record.stats = normalized;

    // Keep old top-level fields in sync while old live users still exist.
    record.eloRating = normalized.rating;
    record.wins = normalized.wins;
    record.losses = normalized.losses;

    if (typeof record.markModified === 'function') {
        record.markModified('stats');
    }

    return normalized;
}

function getDevPlayerEntry(username = 'DevPlayer') {
    const safeUsername = normalizeDevUsername(username);
    const key = safeUsername.toLowerCase();

    if (!devPlayerStats[key]) {
        devPlayerStats[key] = {
            username: safeUsername,
            stats: { rating: 1200, wins: 0, losses: 0 }
        };
    }

    return devPlayerStats[key];
}

function getUsernameFromToken(token) {
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        return decoded?.username ? normalizeDevUsername(decoded.username) : null;
    } catch (err) {
        return null;
    }
}

async function loadRatingPlayersForGame(game, playerCount) {
    const players = {};

    for (let i = 0; i < playerCount; i++) {
        const token = (game.playerTokens && game.playerTokens[i]) ? game.playerTokens[i] : null;
        if (!token) continue;

        if (DEV_MODE) {
            const username = getUsernameFromToken(token) || game.names?.[i] || `DevPlayer${i + 1}`;
            const devEntry = getDevPlayerEntry(username);

            players[i] = {
                username: devEntry.username,
                stats: { ...devEntry.stats },
                save: async function () {
                    const entry = getDevPlayerEntry(this.username);
                    entry.stats = normalizeStats({ stats: this.stats });
                }
            };

            continue;
        }

        if (!User) continue;

        const userDoc = await User.findOne({ token });
        if (userDoc) {
            setRatingRecordStats(userDoc, normalizeStats(userDoc));
            players[i] = userDoc;
        }
    }

    return players;
}

const matchmakingService = require('./www/matchmaking.js')(
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
        const username = getUsernameFromToken(token) || 'DevPlayer';
        const devEntry = getDevPlayerEntry(username);

        return res.json({
            success: true,
            username: devEntry.username,
            stats: normalizeStats(devEntry),
            isPremium: true
        });
    }

    // 3. Find User in DB
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Now find the user by their unique ID or Username from the token
        const user = await User.findOne({ username: decoded.username });
        if (!user) return res.json({ success: false, message: "User not found" });

                // 4. Return Stats
        res.json({
            success: true,
            username: user.username,
            stats: normalizeStats(user),
            isPremium: user.isPremium || false
        });
    } catch (e) {
        console.error("Profile fetch error:", e);
        res.status(401).json({ success: false, message: "Invalid Token" });
    }
});

// --- LEADERBOARD ROUTE ---
app.get('/api/leaderboard', async (req, res) => {
    // 1. Dev Mode: show only real in-memory DevPlayers.
    // No fake Player_1 / Player_2 rows.
    if (DEV_MODE) {
        const leaderboard = Object.values(devPlayerStats || {})
            .map(entry => ({
                username: entry.username,
                stats: normalizeStats(entry)
            }))
            .sort((a, b) => b.stats.rating - a.stats.rating)
            .slice(0, 100);

        return res.json({ success: true, leaderboard });
    }

    // 2. Production DB Query: show only real MongoDB users.
    try {
        const users = await User.find({})
            .select('username stats.rating stats.wins stats.losses eloRating wins losses -_id')
            .lean();

        const leaderboard = users
            .map(user => ({
                username: user.username,
                stats: normalizeStats(user)
            }))
            .filter(player => player.username)
            .sort((a, b) => b.stats.rating - a.stats.rating)
            .slice(0, 100);

        res.json({ success: true, leaderboard });
    } catch (e) {
        console.error("[API] Leaderboard Error:", e);
        res.status(500).json({ success: false, message: "Server Error" });
    }
});

// --- SOCKET CONNECTION ---
app.get('/api/friendly-games', (req, res) => {
    try {
        res.json({
            success: true,
            rooms: getFriendlyGamesList()
        });
    } catch (err) {
        console.error('[API] Friendly Games Error:', err);
        res.status(500).json({ success: false, message: 'Could not load friendly games.' });
    }
});

app.get('/api/rated-games', (req, res) => {
    try {
        res.json({
            success: true,
            rooms: getRatedGamesList()
        });
    } catch (err) {
        console.error('[API] Rated Games Error:', err);
        res.status(500).json({ success: false, message: 'Could not load rated games.' });
    }
});

io.on('connection', async (socket) => {
    // console.log('User connected:', socket.id);
    const token = socket.handshake.auth.token;

    let validUser = null;

    // 1. VERIFY JWT & MANAGE SESSION
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            validUser = decoded.username;

            if (!playerSessions[token]) {
                playerSessions[token] = { username: validUser };
            }
            playerSessions[token].username = validUser;

            // --- UNIFIED RECONNECTION LOGIC ---
const session = playerSessions[token];
if (session && session.gameId) {
    const game = games[session.gameId];

    if (game) {
        // 1. Cancel active-game disconnect timer
        const activeTimerKey = `${session.gameId}_${session.seat}`;
        if (disconnectTimers[activeTimerKey]) {
            console.log(`[Reconnect] Player ${session.seat} returned! Forfeit cancelled.`);
            clearTimeout(disconnectTimers[activeTimerKey]);
            delete disconnectTimers[activeTimerKey];

            if (game.disconnectedPlayers) {
                delete game.disconnectedPlayers[session.seat];
            }
        }

        // 2. Cancel future lobby timer too (safe even if it doesn't exist yet)
        const lobbyTimerKey = `lobby_${session.gameId}_${session.seat}`;
        if (disconnectTimers[lobbyTimerKey]) {
            clearTimeout(disconnectTimers[lobbyTimerKey]);
            delete disconnectTimers[lobbyTimerKey];
        }

        // 3. Restore socket state
        socket.data.gameId = session.gameId;
        socket.data.seat = session.seat;
        await socket.join(session.gameId);

        // 4. IMPORTANT: update active friendly player ownership
        if (session.username) {
            activeFriendlyPlayers[session.username] = {
                gameId: session.gameId,
                seat: session.seat,
                socketId: socket.id,
                joinedAt: Date.now()
            };
        }

        console.log(`[Reconnect] Player restored to Game ${session.gameId}`);

        // 5. If reconnecting to a friendly lobby, send them back to the lobby screen
        if (game.isPrivate && game.isLobby) {
            socket.emit('joined_private_success', {
    gameId: session.gameId,
    roomName: game.roomName || `Table ${session.gameId.split('_')[1] || session.gameId}`,
    seat: session.seat,
    roomType: getRoomType(game),
    isRated: !!game.isRated
});

            broadcastLobby(session.gameId);
            emitAllLobbyLists();
        } else {
            // 6. Otherwise restore active game board
            sendUpdate(session.gameId, socket.id, session.seat);
        }

    } else {
        console.log(`[Cleanup] Removing stale session for game ${session.gameId}`);
        if (session.username) {
            delete activeFriendlyPlayers[session.username];
        }
        delete playerSessions[token];
    }
}

        } catch (err) {
            console.log(`[AUTH FAIL] Invalid Token for socket ${socket.id}`);
        }
    }

    // 2. FALLBACK FOR HANDSHAKE USERNAME (If no token or dev mode)
const handshakeUser = socket.handshake.auth.username;
if (token && playerSessions[token] && !playerSessions[token].username && handshakeUser) {
    playerSessions[token].username = handshakeUser;
}

// 3. DEV MODE AUTO-SESSION + AUTO-START
if (DEV_MODE && !socket.data.gameId) {
    const devUsername = normalizeDevUsername(
        handshakeUser ||
        socket.handshake.query?.username ||
        'DevPlayer'
    );

    // If frontend did not pass a token, create an in-memory dev session
    if (!token) {
        socket.handshake.auth.username = devUsername;
    }

}
    socket.on('disconnect', () => {
    console.log(`[Disconnect] ${socket.id}`);
    matchmakingService.removeSocketFromQueue(socket.id);

    const gameId = socket.data.gameId;
    const seat = socket.data.seat;
    const username =
        socket.handshake.auth.username ||
        (token && playerSessions[token]?.username) ||
        validUser ||
        null;

    if (!gameId || !games[gameId]) return;

    const game = games[gameId];

    // 1. FRIENDLY LOBBY DISCONNECT:
    // keep the seat for a short grace period so refresh/reconnect works
    if (game.isPrivate && game.isLobby) {
        const timerKey = `lobby_${gameId}_${seat}`;

        disconnectTimers[timerKey] = setTimeout(() => {
            const currentGame = games[gameId];
            if (!currentGame) return;

            // If the player reconnected with a new socket, do nothing
            const presence = username ? activeFriendlyPlayers[username] : null;
            if (presence && presence.socketId !== socket.id) {
                return;
            }

            // Remove their seat only if they still own it
            if (
                seat !== undefined &&
                seat !== null &&
                currentGame.names[seat] === username
            ) {
                currentGame.names[seat] = null;
            }
            if (currentGame.playerTokens) currentGame.playerTokens[seat] = null;
            if (currentGame.playerProfiles) currentGame.playerProfiles[seat] = null;
            if (currentGame.readySeats) {
                currentGame.readySeats.delete(seat);
            }

            clearFriendlyPresence(username);

            if (
                token &&
                playerSessions[token] &&
                playerSessions[token].gameId === gameId &&
                playerSessions[token].seat === seat
            ) {
                delete playerSessions[token];
            }

            const remainingPlayers = currentGame.names.filter(n => n !== null).length;

            if (remainingPlayers === 0) {
                console.log(`[LOBBY] Empty friendly room ${gameId} deleted after disconnect timeout.`);
                delete games[gameId];
            } else {
                if (currentGame.host === socket.id) {
                    promoteNewHost(gameId);
                }
                broadcastLobby(gameId);
            }

            emitAllLobbyLists();
        }, 30000); // 30 seconds to reconnect

        return;
    }

    // 2. ACTIVE MATCH DISCONNECT:
    // start the normal forfeit timer
    if (!game.isLobby && !game.matchIsOver) {
        console.log(`[Game ${gameId}] Player ${seat} disconnected. Starting 60s timer.`);

        if (!game.disconnectedPlayers) {
            game.disconnectedPlayers = {};
        }
        game.disconnectedPlayers[seat] = true;

        const timerKey = `${gameId}_${seat}`;

        const pauseExtraMs = isRatedPauseActive(game)
    ? Math.max(0, game.ratedPause.endsAt - Date.now())
    : 0;

disconnectTimers[timerKey] = setTimeout(() => {
    const currentGame = games[gameId];
    if (!currentGame || currentGame.matchIsOver) return;

    console.log(`[Forfeit] Player ${seat} failed to reconnect. Ending Game ${gameId}.`);
    handleForfeit(gameId, seat);
}, pauseExtraMs + DISCONNECT_FORFEIT_MS);
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

        const movingName = game.names[currentSeat];
const movingToken = game.playerTokens ? game.playerTokens[currentSeat] : null;
const movingProfile = game.playerProfiles ? game.playerProfiles[currentSeat] : null;

// Swap Names + rated metadata
game.names[targetSeat] = movingName;
game.names[currentSeat] = null;

if (game.playerTokens) {
    game.playerTokens[targetSeat] = movingToken || null;
    game.playerTokens[currentSeat] = null;
}

if (game.playerProfiles) {
    game.playerProfiles[targetSeat] = movingProfile || null;
    game.playerProfiles[currentSeat] = null;
}

        // Update Socket Data
        socket.data.seat = targetSeat;
        socket.emit('seat_changed', { newSeat: targetSeat });

        // Update Session if exists
        const token = socket.handshake.auth.token;
        if (token && playerSessions[token]) {
            playerSessions[token].seat = targetSeat;
        }
        const username = socket.handshake.auth.username || movingName;
if (username) {
    setFriendlyPresence(username, gameId, targetSeat, socket.id);
}

        broadcastLobby(gameId);
    });

    socket.on('act_host_start', () => {
        const gameId = socket.data.gameId;
        const game = games[gameId];

        if (!game || !game.isLobby) return;
        if (game.host !== socket.id) return;

        // Check if all seats have names
        const filledSeats = game.names.filter(n => n !== null).length;
        if (filledSeats < game.config.PLAYER_COUNT) {
            return socket.emit('error_message', "Wait for all players!");
        }

        console.log(`[LOBBY] Host starting Game ${gameId}`);

        // 1. DEAL CARDS NOW
        game.resetMatch();
        game.ratedPause = null;
        game.isLobby = false;
        emitAllLobbyLists();

        // 2. MOVE EVERYONE TO GAME SCREEN
        io.sockets.sockets.forEach((s) => {
            if (s.data.gameId === gameId) {
                // Ensure socket data matches current lobby seat
                // (In case of race conditions, but switch_seat handles it)
                sendUpdate(gameId, s.id, s.data.seat);
            }
        });
    });

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

    socket.on('request_create_private', async (data) => {
    await createLobbyRoom(socket, data, 'friendly');
});

socket.on('request_join_private', async (data) => {
    await joinLobbyRoom(socket, data, 'friendly');
});

socket.on('request_create_rated', async (data) => {
    await createLobbyRoom(socket, data, 'rated');
});

socket.on('request_join_rated', async (data) => {
    await joinLobbyRoom(socket, data, 'rated');
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

    // --- LIVE TEACHING: Update Bot DNA on the fly ---
    socket.on('admin_update_bot_dna', (data) => {
        const gameId = socket.data.gameId;
        if (gameBots[gameId] && gameBots[gameId][data.seat]) {
            gameBots[gameId][data.seat].updateDna(data.dna);
            console.log(`[Live Teach] Bot ${data.seat} DNA updated.`);
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
            if (game.cleanupTimer) {
                clearTimeout(game.cleanupTimer);
                game.cleanupTimer = null; // Clear the reference
            }
            // 1. Unlock the match state FIRST
            // (If we don't do this, game.resetMatch() might abort thinking the game is still over)
            game.matchIsOver = false;

            // 2. Clear Disconnect Flags
            // (Ensure the server doesn't think the forfeiting player is still gone)
            if (game.disconnectedPlayers) {
                game.disconnectedPlayers = {};
            }
            // 3. Reset Game Logic
            // (Now that matchIsOver is false, this will correctly redeal hands and deck)
            game.resetMatch();
            // 4. Hard Reset Timers for ALL players (0 to N-1)
            game.bankTimers = {};
            for (let i = 0; i < game.config.PLAYER_COUNT; i++) {
                game.bankTimers[i] = 720; // 12 Minutes
            }

            // 5. Initialize Turn Variables (Crucial for Bots)
            game.turnPhase = 'draw';
            game.roundStarter = 0;      // Reset starter to seat 0
            game.currentPlayer = 0;     // Set current turn to seat 0
            game.processingTurnFor = null;
            game.turnCounter = 1;
            game.rematchVotes.clear();
            game.nextRoundReady = new Set();

            // 6. Force Client Navigation (Deal Hand)
            io.sockets.sockets.forEach((s) => {
                if (s.data.gameId === gameId) {
                    sendUpdate(gameId, s.id, s.data.seat);
                }
            });

            // 5. KICKSTART THE BOTS
            // We must manually trigger the bot check, otherwise they sit waiting forever.
            checkBotTurn(gameId);
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
            game.turnCounter = 1;

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
        if (rejectIfRatedPaused(socket, game)) return;

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
            
            try {
                const decision = bot.decideGoOutPermission(game); // TRUE or FALSE

                // Auto-reply
                game.goOutPermission = decision ? 'granted' : 'denied';

                // Broadcast result immediately
                io.to(gameId).emit('ask_result', { seat: partnerSeat, decision: decision });
            } catch (e) {
                console.error("[BOT ERROR] decideGoOutPermission failed:", e);
                game.goOutPermission = 'denied'; // Fallback to deny
                io.to(gameId).emit('ask_result', { seat: partnerSeat, decision: false });
            }
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
        if (rejectIfRatedPaused(socket, game)) return;

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
        if (rejectIfRatedPaused(socket, game)) return;

        const result = game.drawFromDeck(data.seat);

        // CHECK FOR DECK EMPTY GAME OVER
        if (result.success && result.message === "GAME_OVER_DECK_EMPTY") {
            handleRoundEnd(gameId, io);
        } else if (result.success) {
            broadcastAll(gameId, data.seat);
        } else {
            // If the error is "Wrong phase!" but it IS the player's turn...
            if (result.message === "Wrong phase!" &&
                game.currentPlayer === data.seat &&
                game.turnPhase === 'playing') {

                // Resend state to this socket only (Sync fix)
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
            if (rejectIfRatedPaused(socket, game)) return;
            const seat = socket.data.seat;
            if (gameBots[gameId] && seat === 0) {
                const name = game.names ? game.names[seat] : "Unknown";
                console.log(`[Recorder] Attempting to log pickup for ${name}`);
                recordHumanTurn(game, seat, 'pickup', 'pile', name);
            }
            let res = game.pickupDiscardPile(data.seat);
            res.success ? broadcastAll(gameId, data.seat) : socket.emit('error_message', res.message);
        }
    });

    socket.on('act_meld', (data) => {
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (game) {
            if (rejectIfRatedPaused(socket, game)) return;
            const seat = socket.data.seat;
            if (gameBots[gameId] && seat === 0) {
                const name = game.names ? game.names[data.seat] : "Unknown";
                
                // Convert indices to actual card objects so the bot knows WHAT was melded
                // (The game logic does this internally, but we need to do it here to save it)
                const hand = game.players[seat];
                const cardsMelded = data.indices.map(i => hand[i]).filter(c => c !== undefined);

                console.log(`[Recorder] Attempting to log meld for ${name}`);
                // We record the Rank being melded (e.g., "5") and the specific cards used
                recordHumanTurn(
                    game,
                    seat,
                    'meld', 
                    data.targetRank || (cardsMelded.length > 0 ? cardsMelded[0].rank : 'unknown'),
                    name, 
                    { cards: cardsMelded.map(c => c.rank) } // Details = ["5", "5", "5"]
                );
            }
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
                const name = (game.names && game.names[data.seat]) ? game.names[data.seat] : `Player ${data.seat + 1}`;
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
            if (rejectIfRatedPaused(socket, game)) return;
            const seat = socket.data.seat;
            if (gameBots[gameId] && seat === 0) {
                // We need to look up the card RANK before it is removed from hand
                const cardToDiscard = game.players[seat][data.index];
                if (cardToDiscard) {
                    const name = game.names ? game.names[seat] : "Unknown";
                    console.log(`[Recorder] Attempting to log discard for ${name}`);
                    recordHumanTurn(game, seat, 'discard', cardToDiscard.rank, name);
                }
            }
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
            if (res.success) {
                game.goOutPermission = null;

                if (typeof game.turnCounter !== 'number') {
                    game.turnCounter = 1;
                } else {
                    game.turnCounter += 1;
                }

                console.log(`[TURN COUNTER] Game ${gameId} advanced to turn ${game.turnCounter}`);
            }

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
            if (rejectIfRatedPaused(socket, game)) return;
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

        socket.on('act_request_rated_pause', () => {
        const gameId = socket.data.gameId;
        const seat = Number(socket.data.seat);
        const game = games[gameId];

        if (!game) return;
        if (!game.isRated) return;
        if (game.isLobby) return;
        if (game.matchIsOver) return;
        if (game.turnPhase === 'game_over') return;

        const pause = ensureRatedPauseState(game);

        if (pause.active) {
            socket.emit('error_message', 'A rated pause is already active.');
            emitRatedPauseState(gameId);
            return;
        }

        if (pause.usedSeats[seat]) {
            socket.emit('error_message', 'You have already used your 5-minute rated pause this match.');
            return;
        }

        const now = Date.now();

        pause.active = true;
        pause.startedBy = seat;
        pause.startedAt = now;
        pause.endsAt = now + RATED_PAUSE_DURATION_MS;
        pause.readySeats = {};
        pause.usedSeats[seat] = true;

        // Freeze inactivity timing from this moment.
        game.lastActionTime = now;

        console.log(`[RATED PAUSE] Game ${gameId}: Seat ${seat} started a 5-minute pause.`);

        emitRatedPauseState(gameId);
    });

    socket.on('act_ready_during_rated_pause', () => {
        const gameId = socket.data.gameId;
        const seat = Number(socket.data.seat);
        const game = games[gameId];

        if (!game) return;
        if (!game.isRated) return;

        const pause = ensureRatedPauseState(game);
        if (!pause.active) return;

        pause.readySeats[seat] = true;

        console.log(`[RATED PAUSE] Game ${gameId}: Seat ${seat} is ready.`);

        if (allConnectedPlayersReadyForPause(gameId)) {
            endRatedPause(gameId, 'all_ready');
        } else {
            emitRatedPauseState(gameId);
        }
    });

    // --- TIMEOUT HANDLER ---
    socket.on('act_timeout', async () => {
        const gameId = socket.data.gameId;
        const game = games[gameId];
        if (!game || game.matchIsOver) return;
        if (isRatedPauseActive(game)) return;

        // Rated games only. Friendly games keep their current behavior.
if (gameBots[gameId]) return;
if (!game.isRated) return;

// Only the player whose turn it is can trigger their own inactivity timeout.
if (socket.data.seat !== game.currentPlayer) return;

// Client triggers at 120s. Server allows a small 2s buffer for network timing.
const now = Date.now();
const INACTIVITY_LIMIT = 118000; // 118s buffer, slightly more lenient than 120s
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
    const seat = socket.data.seat;
    const token = socket.handshake.auth.token;
    const username =
        socket.handshake.auth.username ||
        (token && playerSessions[token]?.username) ||
        null;
    const game = games[gameId];

    // 1. Remove from matchmaking queue
    matchmakingService.removeSocketFromQueue(socket.id);

    console.log(`[Leave] User requesting to leave Game ${gameId}`);

    // 2. Cancel any disconnect timers for this seat
    const activeTimerKey = `${gameId}_${seat}`;
    const lobbyTimerKey = `lobby_${gameId}_${seat}`;

    if (disconnectTimers[activeTimerKey]) {
        clearTimeout(disconnectTimers[activeTimerKey]);
        delete disconnectTimers[activeTimerKey];
    }

    if (disconnectTimers[lobbyTimerKey]) {
        clearTimeout(disconnectTimers[lobbyTimerKey]);
        delete disconnectTimers[lobbyTimerKey];
    }

    // 3. If leaving an active match, treat it as an immediate forfeit
    if (game && !game.isLobby && !game.matchIsOver) {
        if (game.disconnectedPlayers) {
            delete game.disconnectedPlayers[seat];
        }

        if (token && playerSessions[token]) {
            delete playerSessions[token];
        }

        clearFriendlyPresence(username);

        socket.data.gameId = null;
        socket.data.seat = null;

        if (gameId) {
            await socket.leave(gameId);
        }

        handleForfeit(gameId, seat);
        return;
    }

    // 4. Remove reconnect session and friendly presence
    if (token && playerSessions[token]) {
        delete playerSessions[token];
    }

    clearFriendlyPresence(username);

    socket.data.gameId = null;
    socket.data.seat = null;

    // 5. Leave the socket room
    if (gameId) {
        await socket.leave(gameId);

        // Friendly lobby leave
        if (game && game.isPrivate && game.isLobby) {
            if (
                seat !== undefined &&
                seat !== null &&
                game.names[seat] === username
            ) {
                console.log(`[LOBBY] Seat ${seat} freed in Game ${gameId}`);
                game.names[seat] = null;
            }
            if (game.playerTokens) game.playerTokens[seat] = null;
            if (game.playerProfiles) game.playerProfiles[seat] = null;
            if (game.readySeats) {
                game.readySeats.delete(seat);
            }

            if (game.host === socket.id) {
                promoteNewHost(gameId);
            }

            const remainingPlayers = game.names.filter(n => n !== null).length;

            if (remainingPlayers === 0) {
                console.log(`[LOBBY] Empty friendly room ${gameId} deleted.`);
                delete games[gameId];
            } else {
                broadcastLobby(gameId);
            }

            emitAllLobbyLists();
        }

        // Finished private match cleanup
        if (game && game.isPrivate && game.matchIsOver) {
            console.log(`[CLEANUP] Private Match ${gameId} finished and player left. Deleting room.`);
            delete games[gameId];
            if (gameBots[gameId]) delete gameBots[gameId];
            emitAllLobbyLists();
        }
    }
});
});

// --- HELPER FUNCTIONS ---

function getSocketUsername(socket) {
    return socket?.handshake?.auth?.username || null;
}
function clearFriendlyPresence(username) {
    if (!username) return;
    delete activeFriendlyPlayers[username];
}
function setFriendlyPresence(username, gameId, seat, socketId) {
    if (!username) return;
    activeFriendlyPlayers[username] = {
        gameId,
        seat,
        socketId,
        joinedAt: Date.now()
    };
}
function findSeatByUsername(game, username) {
    if (!game || !Array.isArray(game.names)) return -1;
    return game.names.findIndex(name => name === username);
}
function promoteNewHost(gameId) {
    const game = games[gameId];
    if (!game || !game.isLobby) return;

    const room = io.sockets.adapter.rooms.get(gameId);
    if (!room) return;

    for (const socketId of room) {
        const s = io.sockets.sockets.get(socketId);
        if (!s) continue;
        if (s.data.gameId !== gameId) continue;
        if (s.data.seat === undefined || s.data.seat === null) continue;

        game.host = socketId;
        return;
    }

    game.host = null;
}

function generateGameId() {
    return 'game_' + Math.random().toString(36).substr(2, 9);
}
function getRankForRating(rating) {
    const safeRating = Number.isFinite(Number(rating)) ? Math.round(Number(rating)) : 1200;

    if (safeRating < 1000) return { rankName: 'Beginner', rankClass: 'rank-beginner' };
    if (safeRating < 1200) return { rankName: 'Bronze', rankClass: 'rank-bronze' };
    if (safeRating < 1400) return { rankName: 'Club', rankClass: 'rank-club' };
    if (safeRating < 1600) return { rankName: 'Advanced', rankClass: 'rank-advanced' };
    if (safeRating < 1800) return { rankName: 'Expert', rankClass: 'rank-expert' };
    return { rankName: 'Master', rankClass: 'rank-master' };
}

function buildLobbyProfile(username, rating = 1200) {
    const safeRating = Number.isFinite(Number(rating)) ? Math.round(Number(rating)) : 1200;
    const rank = getRankForRating(safeRating);

    return {
        username,
        rating: safeRating,
        rankName: rank.rankName,
        rankClass: rank.rankClass
    };
}

async function getLobbyProfile(username) {
    if (!username) return null;

        if (DEV_MODE || !User) {
        const devEntry = getDevPlayerEntry(username);
        return buildLobbyProfile(username, normalizeStats(devEntry).rating);
    }

    try {
            const user = await User.findOne({ username })
            .select('username stats.rating eloRating wins losses -_id')
            .lean();

        return buildLobbyProfile(username, normalizeStats(user).rating);
    } catch (err) {
        console.error(`[Lobby] Could not load rating for ${username}:`, err);
        return buildLobbyProfile(username, 1200);
    }
}

function ensureLobbyArrays(game) {
    if (!game) return;
    const maxSeats = game?.config?.PLAYER_COUNT || 4;

    if (!Array.isArray(game.names)) {
        game.names = Array(maxSeats).fill(null);
    }

    if (!Array.isArray(game.playerTokens)) {
        game.playerTokens = Array(maxSeats).fill(null);
    }

    if (!Array.isArray(game.playerProfiles)) {
        game.playerProfiles = Array(maxSeats).fill(null);
    }
}

async function setLobbySeat(game, seat, username, token = null) {
    ensureLobbyArrays(game);
    game.names[seat] = username;
    game.playerTokens[seat] = token || null;
    game.playerProfiles[seat] = await getLobbyProfile(username);
}

function generateTableId(prefix) {
    const usedNumbers = Object.keys(games)
        .filter(id => id.startsWith(`${prefix}_`))
        .map(id => parseInt(id.replace(`${prefix}_`, ''), 10))
        .filter(n => !isNaN(n))
        .sort((a, b) => a - b);

    let nextNumber = 1;

    for (const num of usedNumbers) {
        if (num === nextNumber) {
            nextNumber++;
        } else if (num > nextNumber) {
            break;
        }
    }

    return `${prefix}_${nextNumber}`;
}

function generateFriendlyTableId() {
    return generateTableId('friendly');
}

function generateRatedTableId() {
    return generateTableId('rated');
}

function getFriendlyRuleset(game) {
    if (game.friendlyRuleset) return game.friendlyRuleset;
    return game.config && game.config.DRAW_COUNT === 1 ? 'easy' : 'standard';
}

function getRoomType(game) {
    return game?.isRated ? 'rated' : 'friendly';
}

function getTableAverageRating(game) {
    if (!game || !Array.isArray(game.playerProfiles)) return null;

    const ratings = game.playerProfiles
        .filter(Boolean)
        .map(profile => Number(profile.rating))
        .filter(rating => Number.isFinite(rating));

    if (!ratings.length) return null;
    return Math.round(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length);
}

function getLobbyGamesList(roomType = 'friendly') {
    return Object.entries(games)
        .filter(([roomId, game]) => {
            if (!game || !game.isPrivate || game.matchIsOver) return false;
            return roomType === 'rated' ? !!game.isRated : !!game.isFriendly;
        })
        .map(([roomId, game]) => {
            ensureLobbyArrays(game);

            const playerNames = Array.isArray(game.names) ? game.names.filter(Boolean) : [];
            const playerProfiles = Array.isArray(game.playerProfiles)
                ? game.playerProfiles.filter(Boolean)
                : playerNames.map(name => buildLobbyProfile(name, 1200));
            const maxSeats = game?.config?.PLAYER_COUNT || 4;

            return {
                roomId,
                roomName: game.roomName || `Table ${roomId.split('_')[1] || roomId}`,
                creatorName: game.creatorName || playerNames[0] || 'Unknown',
                status: game.isLobby ? 'waiting' : 'in-progress',
                roomType: getRoomType(game),
                isRated: !!game.isRated,
                playerNames,
                playerProfiles,
                averageRating: getTableAverageRating(game),
                seatsUsed: playerNames.length,
                maxSeats,
                ruleset: getFriendlyRuleset(game),
                createdAt: game.createdAt || Date.now()
            };
        })
        .sort((a, b) => {
            if (a.status !== b.status) {
                return a.status === 'waiting' ? -1 : 1;
            }
            return b.createdAt - a.createdAt;
        });
}

function getFriendlyGamesList() {
    return getLobbyGamesList('friendly');
}

function getRatedGamesList() {
    return getLobbyGamesList('rated');
}

function emitFriendlyGamesList() {
    io.emit('friendly_games_list', getFriendlyGamesList());
}

function emitRatedGamesList() {
    io.emit('rated_games_list', getRatedGamesList());
}

function emitAllLobbyLists() {
    emitFriendlyGamesList();
    emitRatedGamesList();
}

async function createLobbyRoom(socket, data = {}, roomType = 'friendly') {
    const isRated = roomType === 'rated';
    const pCount = parseInt(data.playerCount) || 4;
    const ruleset = data.ruleset || 'standard';
    const gameId = isRated ? generateRatedTableId() : generateFriendlyTableId();
    const tableNumber = gameId.split('_')[1];
    const token = socket.handshake.auth.token;
    const username = socket.handshake.auth.username || (isRated ? 'Player' : 'Host');

    if (
        activeFriendlyPlayers[username] &&
        (
            !games[activeFriendlyPlayers[username].gameId] ||
            games[activeFriendlyPlayers[username].gameId].names[activeFriendlyPlayers[username].seat] !== username
        )
    ) {
        delete activeFriendlyPlayers[username];
    }

    if (activeFriendlyPlayers[username]) {
        return socket.emit('error_message', 'You are already seated in another lobby room.');
    }

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

    games[gameId] = new CanastaGame(config);
    games[gameId].isPrivate = true;
    games[gameId].isFriendly = !isRated;
    games[gameId].isRated = isRated;
    games[gameId].roomType = roomType;
    games[gameId].isLobby = true;
    games[gameId].host = socket.id;
    games[gameId].readySeats = new Set();
    games[gameId].matchIsOver = false;
    games[gameId].turnCounter = 1;

    games[gameId].names = Array(pCount).fill(null);
    games[gameId].playerTokens = Array(pCount).fill(null);
    games[gameId].playerProfiles = Array(pCount).fill(null);
    games[gameId].roomName = `Table ${tableNumber}`;
    games[gameId].creatorName = username;
    games[gameId].friendlyRuleset = ruleset;
    games[gameId].createdAt = Date.now();

    await setLobbySeat(games[gameId], 0, username, token);

    await socket.join(gameId);
    socket.data.gameId = gameId;
    socket.data.seat = 0;

    if (token) {
        playerSessions[token] = {
            gameId,
            seat: 0,
            username
        };
    }

    setFriendlyPresence(username, gameId, 0, socket.id);

    socket.emit('private_created', {
        gameId,
        roomName: games[gameId].roomName,
        seat: 0,
        roomType,
        isRated
    });

    broadcastLobby(gameId);
}

async function joinLobbyRoom(socket, data = {}, expectedRoomType = 'friendly') {
    const { gameId } = data;
    const game = games[gameId];
    const token = socket.handshake.auth.token;
    const username = socket.handshake.auth.username || 'Guest';
    const expectedRated = expectedRoomType === 'rated';

    if (!game) return socket.emit('error_message', 'Game not found.');
    if (!game.isPrivate) return socket.emit('error_message', 'Not a private game.');
    if (!!game.isRated !== expectedRated) {
        return socket.emit('error_message', expectedRated ? 'This is not a rated table.' : 'This is not a friendly table.');
    }
    if (!game.isLobby) return socket.emit('error_message', 'This room is already in progress.');

    ensureLobbyArrays(game);

    if (
        activeFriendlyPlayers[username] &&
        (
            !games[activeFriendlyPlayers[username].gameId] ||
            games[activeFriendlyPlayers[username].gameId].names[activeFriendlyPlayers[username].seat] !== username
        )
    ) {
        delete activeFriendlyPlayers[username];
    }

    const existingSeat = game.names.findIndex(name => name === username);

    if (existingSeat !== -1) {
        await socket.join(gameId);
        socket.data.gameId = gameId;
        socket.data.seat = existingSeat;

        if (token) {
            playerSessions[token] = {
                gameId,
                seat: existingSeat,
                username
            };
        }

        game.playerTokens[existingSeat] = token || game.playerTokens[existingSeat] || null;
        game.playerProfiles[existingSeat] = await getLobbyProfile(username);
        setFriendlyPresence(username, gameId, existingSeat, socket.id);

        broadcastLobby(gameId);
        broadcastAll(gameId);

        return socket.emit('joined_private_success', {
            gameId,
            roomName: game.roomName || `Table ${gameId.split('_')[1] || gameId}`,
            seat: existingSeat,
            roomType: getRoomType(game),
            isRated: !!game.isRated
        });
    }

    const activePresence = activeFriendlyPlayers[username];
    if (activePresence && activePresence.gameId !== gameId) {
        return socket.emit('error_message', 'You are already seated in another lobby room.');
    }

    let seat = game.names.findIndex(n => n === null);
    if (seat === -1) return socket.emit('error_message', 'Room is full.');

    await socket.join(gameId);
    socket.data.gameId = gameId;
    socket.data.seat = seat;
    await setLobbySeat(game, seat, username, token);

    if (token) {
        playerSessions[token] = {
            gameId,
            seat,
            username
        };
    }

    setFriendlyPresence(username, gameId, seat, socket.id);

    broadcastLobby(gameId);
    broadcastAll(gameId);

    socket.emit('joined_private_success', {
        gameId,
        roomName: game.roomName || `Table ${gameId.split('_')[1] || gameId}`,
        seat,
        roomType: getRoomType(game),
        isRated: !!game.isRated
    });
}
function broadcastLobby(gameId) {
    const game = games[gameId];
    if (!game) return;

    ensureLobbyArrays(game);

    let actualHostSeat = 0;

    const room = io.sockets.adapter.rooms.get(gameId);
    if (room) {
        for (const socketId of room) {
            if (socketId === game.host) {
                const hostSocket = io.sockets.sockets.get(socketId);
                if (hostSocket && hostSocket.data.seat !== undefined) {
                    actualHostSeat = hostSocket.data.seat;
                }
                break;
            }
        }
    }

    io.to(gameId).emit('lobby_update', {
        names: game.names,
        playerProfiles: game.playerProfiles,
        hostSeat: actualHostSeat,
        maxPlayers: game.config.PLAYER_COUNT,
        roomType: getRoomType(game),
        isRated: !!game.isRated,
        averageRating: getTableAverageRating(game),
        isHost: false
    });

    emitAllLobbyLists();
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

    const userName = normalizeDevUsername(humanSocket.handshake.auth.username || "Player");
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
    games[gameId].turnCounter = 1; // first turn of the round
    sendUpdate(gameId, humanSocket.id, 0);
}

const RATED_PAUSE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const DISCONNECT_FORFEIT_MS = 60 * 1000; // normal reconnect grace after pause ends

function ensureRatedPauseState(game) {
    if (!game.ratedPause) {
        game.ratedPause = {
            active: false,
            startedBy: null,
            startedAt: null,
            endsAt: null,
            readySeats: {},
            usedSeats: {}
        };
    }

    if (!game.ratedPause.readySeats) game.ratedPause.readySeats = {};
    if (!game.ratedPause.usedSeats) game.ratedPause.usedSeats = {};

    return game.ratedPause;
}

function getSeatDisplayName(game, seat) {
    const seatNum = Number(seat);

    if (game && game.names && game.names[seatNum]) {
        return game.names[seatNum];
    }

    return `Player ${seatNum + 1}`;
}

function getConnectedPauseSeats(gameId) {
    const room = io.sockets.adapter.rooms.get(gameId);
    const seats = new Set();

    if (!room) return [];

    for (const socketId of room) {
        const s = io.sockets.sockets.get(socketId);
        if (!s) continue;
        if (s.data.gameId !== gameId) continue;

        const seat = Number(s.data.seat);
        const game = games[gameId];

        if (
            Number.isInteger(seat) &&
            game &&
            seat >= 0 &&
            seat < game.config.PLAYER_COUNT
        ) {
            seats.add(seat);
        }
    }

    return Array.from(seats);
}

function getRatedPausePayload(gameId) {
    const game = games[gameId];
    if (!game) {
        return { active: false };
    }

    const pause = ensureRatedPauseState(game);

    const readySeats = Object.keys(pause.readySeats || {})
        .map(Number)
        .filter(Number.isInteger);

    const usedSeats = Object.keys(pause.usedSeats || {})
        .map(Number)
        .filter(Number.isInteger);

    const connectedSeats = getConnectedPauseSeats(gameId);

    const secondsLeft = pause.active
        ? Math.max(0, Math.ceil((pause.endsAt - Date.now()) / 1000))
        : 0;

    return {
        active: !!pause.active,
        startedBy: pause.startedBy,
        startedByName:
            pause.startedBy !== null && pause.startedBy !== undefined
                ? getSeatDisplayName(game, pause.startedBy)
                : '',
        secondsLeft,
        readySeats,
        readyPlayers: readySeats.map(seat => ({
            seat,
            name: getSeatDisplayName(game, seat)
        })),
        usedSeats,
        connectedSeats,
        connectedPlayers: connectedSeats.map(seat => ({
            seat,
            name: getSeatDisplayName(game, seat)
        }))
    };
}

function emitRatedPauseState(gameId) {
    io.to(gameId).emit('rated_pause_update', getRatedPausePayload(gameId));
}

function isRatedPauseActive(game) {
    return !!(
        game &&
        game.isRated &&
        game.ratedPause &&
        game.ratedPause.active
    );
}

function allConnectedPlayersReadyForPause(gameId) {
    const game = games[gameId];
    if (!game || !game.ratedPause) return false;

    const connectedSeats = getConnectedPauseSeats(gameId);
    if (!connectedSeats.length) return false;

    return connectedSeats.every(seat => game.ratedPause.readySeats[seat]);
}

function restartDisconnectTimersAfterRatedPause(gameId) {
    const game = games[gameId];
    if (!game || !game.disconnectedPlayers) return;

    Object.keys(game.disconnectedPlayers).forEach(seatKey => {
        const seat = Number(seatKey);
        const timerKey = `${gameId}_${seat}`;

        if (disconnectTimers[timerKey]) {
            clearTimeout(disconnectTimers[timerKey]);
            delete disconnectTimers[timerKey];
        }

        disconnectTimers[timerKey] = setTimeout(() => {
            const currentGame = games[gameId];
            if (!currentGame || currentGame.matchIsOver) return;

            console.log(`[Forfeit] Player ${seat} failed to reconnect after rated pause. Ending Game ${gameId}.`);
            handleForfeit(gameId, seat);
        }, DISCONNECT_FORFEIT_MS);
    });
}

function endRatedPause(gameId, reason = 'ended') {
    const game = games[gameId];
    if (!game || !game.ratedPause || !game.ratedPause.active) return;

    game.ratedPause.active = false;
    game.ratedPause.startedBy = null;
    game.ratedPause.startedAt = null;
    game.ratedPause.endsAt = null;
    game.ratedPause.readySeats = {};

    // Important: prevents the 2-minute inactivity timer from instantly firing after pause.
    game.lastActionTime = Date.now();

    io.to(gameId).emit('rated_pause_update', {
        ...getRatedPausePayload(gameId),
        reason
    });

    restartDisconnectTimersAfterRatedPause(gameId);

    broadcastAll(gameId);
}

function rejectIfRatedPaused(socket, game) {
    if (!isRatedPauseActive(game)) return false;

    socket.emit('error_message', 'The rated game is paused.');
    return true;
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
    const topCard = pile.length > 0 ? pile[pile.length - 1] : null;
    const prevCard = pile.length > 1 ? pile[pile.length - 2] : null;
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
        isFriendly: !!game.isFriendly,
        isRated: !!game.isRated,
        roomType: getRoomType(game),
        bankTimers: game.bankTimers,
        ratedPause: getRatedPausePayload(gameId),
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
    const topCard = pile.length > 0 ? pile[pile.length - 1] : null;
    const prevCard = pile.length > 1 ? pile[pile.length - 2] : null;
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
                isFriendly: !!game.isFriendly,
                isRated: !!game.isRated,
                roomType: getRoomType(game),
                ratedPause: getRatedPausePayload(gameId),
                isFrozen: isFrozen,
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

async function checkBotTurn(gameId) {
    const game = games[gameId];
    if (!game || game.turnPhase === 'game_over') return;

    const bot = gameBots[gameId]?.[game.currentPlayer];
    if (bot) {
        console.log(`[BOT] Starting turn for Seat ${game.currentPlayer}`);
        
        // 1. We must AWAIT the bot's turn so simulations finish
        // before the server tells the clients to update their screens.
        await bot.executeTurn(game);

        // 2. Broadcast the results of the turn to all players
        broadcastAll(gameId);

        // 3. If the next player is also a bot, trigger this again
        if (gameBots[gameId]?.[game.currentPlayer] && game.turnPhase !== 'game_over') {
            const delay = game.botDelayBase || 1500;
            setTimeout(() => checkBotTurn(gameId), delay);
        }
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

// ===== LEARNING TRIGGER =====
const botSeats = Object.keys(gameBots[gameId] || {});

for (const botSeatStr of botSeats) {
    const botSeat = parseInt(botSeatStr);
    const bot = gameBots[gameId][botSeat];

    if (bot && typeof bot.learnFromRound === 'function') {
        try {
            const botTeam = botSeat % 2 === 0 ? 'team1' : 'team2';
            const oppTeam = botTeam === 'team1' ? 'team2' : 'team1';

            const botScore = game.finalScores[botTeam].total;
            const oppScore = game.finalScores[oppTeam].total;
            const didWin = botScore > oppScore;

            console.log(`[LEARNING] Bot seat ${botSeat}: Bot=${botScore}, Opp=${oppScore}, Win=${didWin}`);

            bot.learnFromRound({
                botScore: botScore,
                oppScore: oppScore,
                scoreDiff: botScore - oppScore,
                didWin: didWin,
                gameId: gameId,
                finalScores: game.finalScores,
                type: bot.type,
                ruleset: bot.ruleset,
                difficulty: bot.difficulty
            });
        } catch (err) {
            console.error(`[LEARNING ERROR] Bot ${botSeat}:`, err);
        }
    }
}
// ===== END LEARNING TRIGGER =====

// 5. CASE A: MATCH OVER (5000+ points)
if (result.isMatchOver) {
        console.log(`[MATCH END] Game ${gameId} won by ${result.winner}`);
        game.matchIsOver = true;
        emitAllLobbyLists();

        // Prepare Data Holder for Client
        let ratingUpdates = {}; // Will hold { seatIndex: { newRating, delta } }

                // --- RATING & STATS UPDATE START ---
        if (game.isRated) {
            try {
                const playerCount = game.config.PLAYER_COUNT;
                const players = await loadRatingPlayersForGame(game, playerCount);

                console.log(`[ELO] Found ${Object.keys(players).length} / ${playerCount} players for rating update.`);

                if (Object.keys(players).length === playerCount) {
                    // A. Calculate Average Ratings Dynamically
                    let team1Rating, team2Rating;

                    if (playerCount === 2) {
                        team1Rating = normalizeStats(players[0]).rating;
                        team2Rating = normalizeStats(players[1]).rating;
                    } else {
                        team1Rating = (normalizeStats(players[0]).rating + normalizeStats(players[2]).rating) / 2;
                        team2Rating = (normalizeStats(players[1]).rating + normalizeStats(players[3]).rating) / 2;
                    }

                    // B. Get Scores
                    const s1 = game.cumulativeScores.team1;
                    const s2 = game.cumulativeScores.team2;

                    // C. Calculate Delta
                    const delta = calculateEloChange(team1Rating, team2Rating, s1, s2);

                    // D. Apply Updates & Save
                    const savePromises = [];

                    for (let seat = 0; seat < playerCount; seat++) {
                        const isTeam1 = (seat === 0 || seat === 2);
                        const change = isTeam1 ? delta : -delta;
                        const currentStats = normalizeStats(players[seat]);

                        const winnerTeam = (result.winner === 'team1') ? 0 : 1; // 0=Team1, 1=Team2
                        const won = (winnerTeam === 0 && isTeam1) || (winnerTeam === 1 && !isTeam1);

                        const nextStats = {
                            rating: currentStats.rating + change,
                            wins: currentStats.wins + (won ? 1 : 0),
                            losses: currentStats.losses + (won ? 0 : 1)
                        };

                        const savedStats = setRatingRecordStats(players[seat], nextStats);

                        ratingUpdates[seat] = {
                            newRating: savedStats.rating,
                            delta: change
                        };

                        savePromises.push(players[seat].save());
                    }

                    await Promise.all(savePromises);
                    console.log("[ELO] Ratings updated successfully.");

                } else {
                    console.log("[ELO] Skipped: Not enough players found.");
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
    let ratingUpdates = {};

    console.log(`[FORFEIT] Game ${gameId} ended. Leaver: Seat ${loserSeat}. Winner: ${winnerTeam}`);
    game.matchIsOver = true;
    emitAllLobbyLists();

    // ELO CALCULATION (rated only). Do this before match_over so the victory UI can show it.
    if (game.isRated) {
        try {
            const players = await loadRatingPlayersForGame(game, playerCount);

            console.log(`[FORFEIT ELO] Found ${Object.keys(players).length} / ${playerCount} players for rating update.`);

            if (Object.keys(players).length === playerCount) {
                // Team average ratings
                let team1Rating, team2Rating;
                if (playerCount === 2) {
                    team1Rating = normalizeStats(players[0]).rating;
                    team2Rating = normalizeStats(players[1]).rating;
                } else {
                    team1Rating = (normalizeStats(players[0]).rating + normalizeStats(players[2]).rating) / 2;
                    team2Rating = (normalizeStats(players[1]).rating + normalizeStats(players[3]).rating) / 2;
                }

                // calculateEloChange returns Team1's change.
                const team1Won = !isTeam1Loser;
                const s1 = team1Won ? 5000 : 0;
                const s2 = team1Won ? 0 : 5000;
                const team1Delta = calculateEloChange(team1Rating, team2Rating, s1, s2);

                // Convert to the losing team's natural loss, always negative.
                const baseLoss = Math.round(team1Won ? -team1Delta : team1Delta);
                const LEAVER_PENALTY_MULTIPLIER = 1.5;

                const savePromises = [];

                for (let seat = 0; seat < playerCount; seat++) {
                    const currentStats = normalizeStats(players[seat]);
                    let delta = 0;

                    const onLosingTeam = (playerCount === 2)
                        ? (seat === loserSeat)
                        : ((isTeam1Loser && (seat === 0 || seat === 2)) ||
                            (!isTeam1Loser && (seat === 1 || seat === 3)));

                    let nextStats = { ...currentStats };

                    if (onLosingTeam) {
                        if (seat === loserSeat) {
                            // Quitter gets 50% extra penalty.
                            delta = Math.round(baseLoss * LEAVER_PENALTY_MULTIPLIER);
                            nextStats.rating += delta;
                            nextStats.losses += 1;
                        } else if (playerCount === 4) {
                            // Partner gets no penalty and no loss in 4P rated forfeit.
                            delta = 0;
                        } else {
                            delta = baseLoss;
                            nextStats.rating += delta;
                            nextStats.losses += 1;
                        }
                    } else {
                        // Winners gain the standard win amount.
                        delta = Math.abs(baseLoss);
                        nextStats.rating += delta;
                        nextStats.wins += 1;
                    }

                    const savedStats = setRatingRecordStats(players[seat], nextStats);
                    ratingUpdates[seat] = { delta, newRating: savedStats.rating };
                    savePromises.push(players[seat].save());
                }

                await Promise.all(savePromises);
                console.log("[FORFEIT ELO] Ratings updated successfully.");
            } else {
                console.log("[FORFEIT ELO] Skipped: Not enough players found.");
            }

        } catch (e) {
            console.error("Forfeit Elo Error:", e);
        }
    }

    // Notify clients after rating calculation so match_over includes ratings.
    io.to(gameId).emit('match_over', {
        winner: winnerTeam,
        scores: game.cumulativeScores,
        reason: "forfeit",
        names: game.names,
        ratings: ratingUpdates
    });

    // Cleanup game from memory
    // CHANGE: Assign this to game.cleanupTimer so Rematch can cancel it!
    if (game.cleanupTimer) clearTimeout(game.cleanupTimer); // Safety clear

    game.cleanupTimer = setTimeout(() => { // <--- ADD "game.cleanupTimer ="
        console.log(`[CLEANUP] Deleting forfeited Game ${gameId}`);
        delete games[gameId];
        delete gameBots[gameId];
    }, 10000); // 10 seconds
}
setInterval(() => {
    Object.keys(games).forEach(gameId => {
        const game = games[gameId];
        if (!game) return;

        // Rated pause freezes the bank timer.
        if (game.isRated && game.ratedPause && game.ratedPause.active) {
            if (Date.now() >= game.ratedPause.endsAt) {
                endRatedPause(gameId, 'expired');
            } else {
                const pausePayload = getRatedPausePayload(gameId);

                io.to(gameId).emit('rated_pause_update', pausePayload);
                io.to(gameId).emit('timer_sync', {
                    bankTimers: game.bankTimers,
                    ratedPause: pausePayload
                });
            }

            return;
        }

        // Disable bank timers for bot/friendly games
        if (gameBots[gameId]) return;
        if (game.isFriendly) return;
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
            io.to(gameId).emit('timer_sync', {
    bankTimers: game.bankTimers,
    ratedPause: getRatedPausePayload(gameId)
});
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
app.post('/api/create-portal-session', async (req, res) => {
    // 1. Identify the User
    const token = req.headers.authorization;
    let username = null;

    if (token) {
        if (playerSessions[token]) {
            username = playerSessions[token].username;
        } else {
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                username = decoded.username;
            } catch (e) {
                console.log("Portal Auth Failed:", e.message);
            }
        }
    }

    if (!username) {
        return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    // 2. Get User's Stripe Customer ID from DB
    if (DEV_MODE) {
        return res.status(400).json({ error: "Cannot manage subscription in Dev Mode." });
    }

    try {
        const user = await User.findOne({ username: username });

        if (!user || !user.stripeCustomerId) {
            return res.status(400).json({ error: "No active subscription found." });
        }

        // 3. Create Stripe Portal Session
        const protocol = req.headers['x-forwarded-proto'] || req.protocol;
        const host = req.get('host');
        const returnUrl = `${protocol}://${host}/`;

        const portalSession = await stripe.billingPortal.sessions.create({
            customer: user.stripeCustomerId,
            return_url: returnUrl,
        });

        // 4. Send URL back to client
        res.json({ url: portalSession.url });

    } catch (e) {
        console.error("Stripe Portal Error:", e.message);
        res.status(500).json({ error: "Could not create portal session." });
    }
});

// --- START SERVER ---
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Serving static files from: ${path.join(__dirname, 'www')}`);
});
