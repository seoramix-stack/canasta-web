// services/matchmaking.js
const { CanastaGame } = require('./game.js');
const { CanastaBot } = require('../scripts/bot.js');

const BOT_NAMES = [
    "Alex", "Sara", "Mike", "Jessica", "David", "Emily",
    "Anna", "Robert", "Laura", "James", "Linda",
    "Tom", "Sophie", "Daniel", "Maria", "Kevin", "Rachel"
];

const matchmakingQueues = {
    'rated_2': [],
    'rated_4': [],
    'casual_2': [],
    'casual_4': []
};

function generateGameId() {
    return 'game_' + Math.random().toString(36).substr(2, 9);
}

// We export a function that accepts the shared state from server.js
module.exports = (games, gameBots, playerSessions, sendUpdate) => {

    // --- MAIN INTERVAL LOOP (Starts automatically) ---
    setInterval(() => {
        const MAX_WAIT_TIME = 30000; // 30 Seconds
        const now = Date.now();

        Object.keys(matchmakingQueues).forEach(key => {
            const queue = matchmakingQueues[key];
            if (queue.length === 0) return;

            const oldestPlayer = queue[0];
            
            if (now - oldestPlayer.joinTime > MAX_WAIT_TIME) {
                const [mode, countStr] = key.split('_');
                const pCount = parseInt(countStr);

                // Flush queue and start hybrid game
                const humansToGroup = queue.splice(0, pCount);
                console.log(`[Backfill] Queue ${key} timeout. Grouping ${humansToGroup.length} humans with bots.`);
                startBackfillGame(humansToGroup, pCount, mode);
            }
        });
    }, 5000);


    // --- LOGIC: START BACKFILL GAME ---
    async function startBackfillGame(humanObjects, totalPlayers, mode) {
        const gameId = generateGameId();
        
        const config = (totalPlayers === 2) 
            ? { PLAYER_COUNT: 2, HAND_SIZE: 15 } 
            : { PLAYER_COUNT: 4, HAND_SIZE: 11 };

        games[gameId] = new CanastaGame(config);
        games[gameId].resetMatch();
        games[gameId].isRated = false; // Bot games are unranked
        
        games[gameId].names = Array(totalPlayers).fill(null);
        gameBots[gameId] = {};

        // 1. Setup Humans
        for (let i = 0; i < humanObjects.length; i++) {
            const humanSocket = humanObjects[i].socket;
            const humanName = humanSocket.handshake.auth.username || `Player ${i+1}`;

            await humanSocket.join(gameId); 
            
            games[gameId].names[i] = humanName;
            humanSocket.data.gameId = gameId;
            humanSocket.data.seat = i;

            const token = humanSocket.handshake.auth.token;
            if (token) {
                playerSessions[token] = { gameId, seat: i, username: humanName };
                if (!games[gameId].playerTokens) games[gameId].playerTokens = {};
                games[gameId].playerTokens[i] = token;
            }

            humanSocket.emit('error_message', "Queue time exceeded. Filling remaining spots with bots.");
        }

        // 2. Setup Bots
        const type = (totalPlayers === 2) ? '2p' : '4p';
        for (let i = humanObjects.length; i < totalPlayers; i++) {
            let randomName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
            games[gameId].names[i] = randomName;
            gameBots[gameId][i] = new CanastaBot(i, 'hard', type);
        }

        // 3. Start
        games[gameId].currentPlayer = 0; 
        games[gameId].roundStarter = 0;
        
        console.log(`[Backfill] Started Hybrid ${totalPlayers}P Game ${gameId}`);
        
        // 4. Update Clients
        humanObjects.forEach((h, index) => {
            sendUpdate(gameId, h.socket.id, index);
        });
    }

    // --- LOGIC: JOIN GLOBAL GAME ---
    function joinGlobalGame(socket, data) {
        const pCount = (data && parseInt(data.playerCount) === 2) ? 2 : 4;
        const mode = (data && data.mode === 'rated') ? 'rated' : 'casual';
        const queueKey = `${mode}_${pCount}`;
        const queue = matchmakingQueues[queueKey];

        // Avoid duplicates
        if (queue.find(s => s.socket.id === socket.id)) return;

        queue.push({ socket: socket, joinTime: Date.now() });

        // Notify queue status
        queue.forEach(p => {
            const s = p.socket ? p.socket : p; 
            s.emit('queue_update', { count: queue.length, needed: pCount });
        });

        // Check if Full
        if (queue.length >= pCount) {
            const playersWrappers = queue.splice(0, pCount);
            const gameId = generateGameId();
            
            const gameConfig = (pCount === 2) 
                ? { PLAYER_COUNT: 2, HAND_SIZE: 15 } 
                : { PLAYER_COUNT: 4, HAND_SIZE: 11 };

            games[gameId] = new CanastaGame(gameConfig);
            games[gameId].resetMatch();
            games[gameId].isRated = (mode === 'rated'); 
            games[gameId].readySeats = new Set();
            games[gameId].currentPlayer = -1;
            games[gameId].names = Array(pCount).fill("Player");

            playersWrappers.forEach((pObj, i) => {
                const pSocket = pObj.socket;
                pSocket.join(gameId); 
                pSocket.data.seat = i;
                pSocket.data.gameId = gameId;

                const pName = pSocket.handshake.auth.username || `Player ${i+1}`;
                games[gameId].names[i] = pName;

                const token = pSocket.handshake.auth.token;
                if (!games[gameId].playerTokens) games[gameId].playerTokens = {};
                if (token) {
                    games[gameId].playerTokens[i] = token;
                    playerSessions[token] = { gameId, seat: i, username: pName };
                }
                
                sendUpdate(gameId, pSocket.id, i);
            });
            
            console.log(`[MATCH] Started ${pCount}-Player ${mode.toUpperCase()} Game ${gameId}`);
        }
    }

    // --- LOGIC: REMOVE FROM QUEUE ---
    function removeSocketFromQueue(socketId) {
        Object.keys(matchmakingQueues).forEach(key => {
            const queue = matchmakingQueues[key];
            const index = queue.findIndex(p => (p.socket ? p.socket.id : p.id) === socketId);
            
            if (index !== -1) {
                queue.splice(index, 1);
                const needed = parseInt(key.split('_')[1]);
                
                // Notify remaining players
                queue.forEach(p => {
                    const s = p.socket ? p.socket : p;
                    s.emit('queue_update', { count: queue.length, needed: needed });
                });
            }
        });
    }

    return {
        joinGlobalGame,
        removeSocketFromQueue
    };
};