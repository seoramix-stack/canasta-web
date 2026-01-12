// client.js

import { state, saveSession, logout } from './state.js';
import * as UI from './ui.js';
import * as Anim from './animations.js';

window.hardReset = () => {
    localStorage.clear();
    location.reload();
};

// --- 1. INITIALIZATION ---
if (state.playerToken && state.playerUsername) {
    initSocket(state.playerToken);
} else {
    UI.navTo('screen-login');
}

// --- 2. EXPOSE FUNCTIONS TO HTML (Crucial Step!) ---
window.navTo = UI.navTo;
window.toggleGameMenu = UI.toggleGameMenu;
window.logout = logout;

// Auth Forms
window.toggleForms = (mode) => {
    document.getElementById('form-login').style.display = (mode === 'login') ? 'flex' : 'none';
    document.getElementById('form-register').style.display = (mode === 'register') ? 'flex' : 'none';
};
window.doLogin = async () => {
    const user = document.getElementById('login-user').value;
    const pass = document.getElementById('login-pass').value;
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });
        const data = await res.json();
        if (data.success) {
            saveSession(data.token, data.username);
            initSocket(data.token);
        } else { alert(data.message); }
    } catch (e) { alert("Server Error"); }
};

window.doRegister = async () => {
    const user = document.getElementById('reg-user').value;
    const pass = document.getElementById('reg-pass').value;
    if(!user || !pass) { alert("Please fill all fields"); return; }

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, password: pass })
        });
        const data = await res.json();

        if (data.success) {
            // Auto-login after register
            saveSession(data.token, data.username);
            initSocket(data.token);
        } else {
            alert(data.message);
        }
    } catch (e) { alert("Server error"); }
};

window.togglePass = (inputId, iconEl) => {
    const input = document.getElementById(inputId);
    if (input.type === "password") {
        input.type = "text";
        iconEl.innerText = "🙈"; 
    } else {
        input.type = "password";
        iconEl.innerText = "👁️"; 
    }
};

window.connectToGame = (mode) => {
    UI.navTo('screen-queue');
    const el = document.getElementById('queue-msg');
    if(el) el.innerText = "Connecting...";

    state.socket.emit('request_join', { mode: mode, difficulty: state.currentBotDiff });
};

window.leaveGame = () => {
    if(state.socket) state.socket.emit('leave_game');
    if(state.timerInterval) clearInterval(state.timerInterval);
    UI.navTo('screen-home');
};

window.confirmLeave = () => {
    if(confirm("Quit game?")) { UI.toggleGameMenu(); window.leaveGame(); }
};

window.sendReady = () => {
    document.getElementById('ready-step-1').style.display = 'none';
    document.getElementById('ready-step-2').style.display = 'flex';
    state.socket.emit('act_ready', { seat: state.mySeat });
};

window.drawCard = () => {
    state.socket.emit('act_draw', { seat: state.mySeat });
};

window.toggleSelect = (idx) => {
    if (state.selectedIndices.includes(idx)) {
        state.selectedIndices = state.selectedIndices.filter(i => i !== idx);
    } else {
        state.selectedIndices.push(idx);
    }
    // Re-render only the hand to show selection
    if (state.activeData) UI.renderHand(state.activeData.hand); 
};

window.handleDiscardClick = () => {
    if (state.selectedIndices.length === 1) {
        state.socket.emit('act_discard', { seat: state.mySeat, index: state.selectedIndices[0] });
        state.selectedIndices = [];
    } else {
        // If selecting multiple cards, assume they want to pick up the pile (Staging logic)
        handlePickupClick();
    }
};

window.handleMeldClick = (event, targetRank) => {
    event.stopPropagation();
    if(state.selectedIndices.length === 0) return;
    
    // 1. Analyze the cards the player is holding
    const cards = state.selectedIndices.map(i => state.activeData.hand[i]);
    
    // 2. Check for Mismatch
    // A mismatch happens if you hold a Natural card that is NOT the target rank.
    // (Wilds never mismatch, so they will always pass this check and go to 'else')
    const isMismatch = cards.some(c => !c.isWild && c.rank !== targetRank);

    if (isMismatch) {
        // --- SMART FALLBACK ---
        // You clicked on "Kings" but you are holding "Queens".
        // You clearly want to make a NEW meld of Queens, but had no empty space to click.
        // So we redirect this action to the 'New Meld' handler.
        console.log("Mismatch detected: Redirecting to New Meld logic.");
        meldSelected(); 
    } else {
        // --- ADD TO PILE ---
        // You are holding Kings or Wilds, and you clicked Kings.
        // You intended to add to this pile.
        state.socket.emit('act_meld', { 
            seat: state.mySeat, 
            indices: state.selectedIndices, 
            targetRank: targetRank 
        });
        state.selectedIndices = [];
    }
};

window.startNextRound = () => {
    state.socket.emit('act_next_round');
};

// --- MELDING LOGIC (RESTORED) ---

// 1. Click Handler for empty space or background to START a meld
window.meldSelected = () => {
    if (!state.activeData) return;
    if (state.selectedIndices.length === 0) return;

    // Check if we have already opened
    const myTeamMelds = (state.mySeat % 2 === 0) ? state.activeData.team1Melds : state.activeData.team2Melds;
    const hasOpened = Object.keys(myTeamMelds).length > 0;

    if (hasOpened) {
        // Just a standard meld
        handleStandardMeld();
    } else {
        // Smart Logic: Check if we have enough points to open immediately
        let totalPts = 0;
        const selectedCards = state.selectedIndices.map(i => state.activeData.hand[i]);
        selectedCards.forEach(c => totalPts += getCardValue(c.rank));

        const teamScore = (state.mySeat % 2 === 0) ? state.activeData.cumulativeScores.team1 : state.activeData.cumulativeScores.team2;
        const req = getOpeningReq(teamScore);

        if (totalPts >= req) {
            handleStandardMeld();
        } else {
            // Not enough points -> Open Staging Panel
            startStagingMeld();
        }
    }
};

function handleStandardMeld() {
    const hand = state.activeData.hand;
    const cards = state.selectedIndices.map(i => hand[i]);
    
    // Auto-detect rank if possible
    let targetRank = null;
    const natural = cards.find(c => !c.isWild);
    
    if (natural) {
        targetRank = natural.rank;
    } else {
        // All wilds? Ask user
        targetRank = prompt("Rank (e.g., A, 7)?");
        if(targetRank) targetRank = targetRank.toUpperCase().trim();
    }

    if (!targetRank) return;

    state.socket.emit('act_meld', { 
        seat: state.mySeat, 
        indices: state.selectedIndices, 
        targetRank: targetRank 
    });
    state.selectedIndices = [];
}

// --- STAGING (OPENING) LOGIC ---

function startStagingMeld() {
    const hand = state.activeData.hand;
    const selectedCards = state.selectedIndices.map(i => hand[i]);
    
    let targetRank = null;
    const natural = selectedCards.find(c => !c.isWild);
    if(natural) targetRank = natural.rank;
    else targetRank = prompt("Rank?");
    
    if (!targetRank) return;
    targetRank = targetRank.toUpperCase().trim();

    state.stagedMelds.push({ 
        indices: [...state.selectedIndices], 
        rank: targetRank, 
        cards: selectedCards 
    });
    state.isStaging = true; 
    state.selectedIndices = []; 
    renderStagingArea();
    UI.renderHand(hand); // Clear selection
}

function renderStagingArea() {
    document.getElementById('staging-panel').style.display = 'block';
    const container = document.getElementById('staged-container'); 
    container.innerHTML = "";
    
    let totalPoints = 0;
    
    state.stagedMelds.forEach((meld, index) => {
        const grp = document.createElement('div'); 
        grp.className = 'meld-group';
        grp.onclick = () => addToStagedMeld(index);
        grp.style.cursor = 'pointer';
        grp.style.border = '1px dashed #f1c40f';
        grp.style.padding = '5px';
        
        let meldPts = meld.cards.reduce((sum, c) => sum + c.value, 0);
        if (meld.isPickupKey) { 
            meldPts += getCardValue(meld.rank); 
            totalPoints += getCardValue(meld.rank); 
        }
        totalPoints += meldPts;
        
        let html = `<span class='meld-label'>${meld.rank} (${meldPts})</span><div style='display:flex;'>`; 
        meld.cards.forEach(c => { 
            html += `<img src="${Anim.getCardImage(c)}" style="width:30px; height:45px; margin-right:2px;">`; 
        });
        html += "</div>"; 
        grp.innerHTML = html; 
        container.appendChild(grp);
    });

    // Add "New Meld" Button
    const newBtn = document.createElement('div');
    newBtn.className = 'meld-group';
    newBtn.innerHTML = "<div style='font-size:24px; color:#bdc3c7;'>+</div>";
    newBtn.style.border = '2px dashed #777';
    newBtn.style.justifyContent = 'center';
    newBtn.style.alignItems = 'center';
    newBtn.onclick = () => addNewStagedMeld();
    container.appendChild(newBtn);

    const teamScore = (state.mySeat % 2 === 0) ? state.activeData.cumulativeScores.team1 : state.activeData.cumulativeScores.team2;
    const req = getOpeningReq(teamScore);
    
    document.getElementById('staged-pts').innerText = totalPoints; 
    document.getElementById('req-pts').innerText = req;
    
    const btn = document.getElementById('btn-confirm-open');
    btn.disabled = (totalPoints < req);
    btn.style.opacity = (totalPoints < req) ? "0.5" : "1";
}

window.addToStagedMeld = (meldIndex) => {
    if (state.selectedIndices.length === 0) return alert("Select cards first.");
    const targetMeld = state.stagedMelds[meldIndex];
    const newCards = state.selectedIndices.map(i => state.activeData.hand[i]);
    
    // Check rank
    if (newCards.some(c => !c.isWild && c.rank !== targetMeld.rank)) {
        return alert(`Cards must be ${targetMeld.rank} or Wild.`);
    }

    targetMeld.indices.push(...state.selectedIndices);
    targetMeld.cards.push(...newCards);
    state.selectedIndices = [];
    renderStagingArea();
    UI.renderHand(state.activeData.hand);
};

window.addNewStagedMeld = () => {
    if (state.selectedIndices.length === 0) return alert("Select cards first.");
    startStagingMeld();
};

window.sendOpening = () => {
    state.socket.emit('act_open_game', { 
        seat: state.mySeat, 
        melds: state.stagedMelds, 
        pickup: state.pickupStaged 
    }); 
    window.cancelOpening(); 
};

window.cancelOpening = () => {
    state.stagedMelds = [];
    state.isStaging = false;
    state.pickupStaged = false;
    document.getElementById('staging-panel').style.display = 'none';
    if(state.activeData) UI.renderHand(state.activeData.hand);
};

// --- PICKUP LOGIC ---
function handlePickupClick() {
    // If we have opened, try standard pickup
    const myTeamMelds = (state.mySeat % 2 === 0) ? state.activeData.team1Melds : state.activeData.team2Melds;
    if (Object.keys(myTeamMelds).length > 0) {
        state.socket.emit('act_pickup', { seat: state.mySeat });
    } else {
        // If closed, we need to select 2 naturals to open with pile
        handlePickupAttempt();
    }
}

function handlePickupAttempt() {
    if (!state.activeData.topDiscard) return alert("Pile empty.");
    if (state.selectedIndices.length < 2) return alert("Select 2 natural cards.");

    const top = state.activeData.topDiscard;
    const selected = state.selectedIndices.map(i => state.activeData.hand[i]);

    if (selected.some(c => c.rank !== top.rank && !c.isWild)) return alert("Must match top card.");
    if (selected.filter(c => !c.isWild).length < 2) return alert("Need 2 Naturals.");

    state.pickupStaged = true;
    state.stagedMelds.unshift({
        indices: [...state.selectedIndices],
        rank: top.rank,
        cards: selected,
        isPickupKey: true
    });
    state.isStaging = true;
    state.selectedIndices = [];
    renderStagingArea();
    UI.renderHand(state.activeData.hand);
}

// --- HELPERS ---
function getCardValue(rank) {
    if (rank === "Joker") return 50; 
    if (rank === "2" || rank === "A") return 20; 
    if (["8","9","10","J","Q","K"].includes(rank)) return 10; 
    return 5; 
}
function getOpeningReq(score) {
    if (score < 0) return 15; if (score < 1500) return 50; if (score < 3000) return 90; return 120;
}

// --- 3. SOCKET SETUP ---
function initSocket(token) {
    if (state.socket) return; 
    const storedUser = localStorage.getItem("canasta_user"); 

    state.socket = io({
        auth: { token: token, username: storedUser }
    });

    state.socket.on('connect', () => console.log("Connected"));
    state.socket.on('ready_status', (data) => {
        // data.readySeats is an array of seat numbers who clicked start (e.g., [0, 2])
        if (data.readySeats) {
            // Loop through all 4 possible seats
            for (let i = 0; i < 4; i++) {
                const el = document.getElementById(`ind-${i}`);
                if (el) {
                    // If seat 'i' is in the list, make it green. Otherwise, keep it gray.
                    if (data.readySeats.includes(i)) {
                        el.classList.add('ready');
                    } else {
                        el.classList.remove('ready');
                    }
                }
            }
        }
    });

    // --- QUEUE UPDATE HANDLER (Updated) ---
    state.socket.on('queue_update', (data) => {
        // 1. Ensure we stay on the blank searching screen
        UI.navTo('screen-queue');

        // 2. Update the text count (e.g. "2 / 4 Players Found")
        const el = document.getElementById('queue-msg');
        if (el) el.innerText = `${data.count} / 4 Players Found`;
    });

    state.socket.on('deal_hand', (data) => {
        state.mySeat = data.seat;
        UI.navTo('screen-game');
        document.getElementById('status').style.display = 'none';
        
        // Render UI first
        UI.updateUI(data);
        startTimerSystem();

        // Then Animate
        if (data.hand.length > 0) {
            const deckRect = document.getElementById('draw-area').getBoundingClientRect();
            // Simple deal animation
            Anim.flyCard(deckRect, deckRect, "cards/BackRed.png"); 
        }
    });

    state.socket.on('update_game', (data) => {
        // Run animations if we have old data
        if (state.activeData) {
            Anim.handleServerAnimations(state.activeData, data);
        }
        UI.updateUI(data);
    });

    state.socket.on('match_over', (data) => {
        // Fix for the Crash: Ensure we don't try to access UI if user left
        setTimeout(() => {
            // 1. Force close the Score Modal so it doesn't block the Victory screen
            const scoreModal = document.getElementById('score-modal');
            if (scoreModal) scoreModal.style.display = 'none';

            // 2. Populate Victory Data
            const vicTitle = document.getElementById('vic-title');
            const vicSub = document.getElementById('vic-sub');
            const finalS1 = document.getElementById('final-s1');
            const finalS2 = document.getElementById('final-s2');

            if (data.winner) {
                if (data.winner === 'draw') {
                    vicTitle.innerText = "DRAW!";
                    vicSub.innerText = "IT'S A TIE";
                } else {
                    const winTeam = (data.winner === 'team1') ? "TEAM 1" : "TEAM 2";
                    vicTitle.innerText = "VICTORY!";
                    vicSub.innerText = `${winTeam} WINS THE MATCH`;
                }
            }

            if (data.scores) {
                if (finalS1) finalS1.innerText = data.scores.team1;
                if (finalS2) finalS2.innerText = data.scores.team2;
            }

            // 3. Navigate to Victory Screen
            UI.navTo('screen-victory');
            
        }, 100);
    });

    state.socket.on('error_message', (msg) => alert(msg));
    
    state.socket.on('private_created', (data) => {
    UI.navTo('screen-lobby');
    document.getElementById('lobby-room-id').innerText = data.gameId;
    document.getElementById('lobby-pin').innerText = data.pin;
    document.getElementById('lobby-host-controls').style.display = 'block';
    document.getElementById('lobby-wait-msg').style.display = 'none';
    
    // Auto-fill join inputs for easy sharing testing
    document.getElementById('join-id').value = data.gameId;
});

state.socket.on('joined_private_success', (data) => {
    UI.navTo('screen-lobby');
    document.getElementById('lobby-room-id').innerText = data.gameId;
    document.getElementById('lobby-host-controls').style.display = 'none';
    document.getElementById('lobby-wait-msg').style.display = 'block';
});

state.socket.on('social_list_data', (data) => {
    if (state.friendMode === 'search') return; // Don't overwrite search results
    
    const list = (state.friendMode === 'blocked') ? data.blocked : data.friends;
    renderUserList(list, state.friendMode);
});

state.socket.on('social_search_results', (names) => {
        if (state.friendMode !== 'search') return;
        renderUserList(names, 'search');
    });

    // Initial UI Update
    const pName = storedUser || "Player";
    const nameEl = document.querySelector('.p-name');
if (nameEl) nameEl.innerText = pName;
    UI.navTo('screen-home'); 
}

// --- TIMER LOGIC ---

function startTimerSystem() {
    if (state.timerInterval) clearInterval(state.timerInterval);

    // Reset to 12 minutes (720 seconds)
    state.seatTimers = { 0: 720, 1: 720, 2: 720, 3: 720 };
    updateTimerDOM(); 

    state.timerInterval = setInterval(() => {
        if (!state.gameStarted || state.currentTurnSeat === -1) return;

        // Check if the current player has time left
        if (state.seatTimers[state.currentTurnSeat] > 0) {
            state.seatTimers[state.currentTurnSeat]--;
            updateTimerDOM();
        }

        // --- NEW: CHECK FOR GAME OVER (0 SECONDS) ---
        if (state.seatTimers[state.currentTurnSeat] === 0) {
            clearInterval(state.timerInterval); // Stop the clock
            
            // If it is MY turn and I hit 0, I must tell the server I lost.
            // (We check 'mySeat' so only 1 person sends the signal)
            if (state.currentTurnSeat === state.mySeat) {
                console.log("Time ran out! Sending timeout...");
                state.socket.emit('act_timeout');
            }
        }
    }, 1000);
}

function updateTimerDOM() {
    // Helper to format 720 -> "12:00"
    const fmt = (s) => {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return `${m}:${sec.toString().padStart(2, '0')}`;
    };

    // Helper to find the right HTML element for a seat
    const getDomId = (seatIndex) => {
        const rel = (seatIndex - state.mySeat + 4) % 4;
        if (rel === 0) return 'timer-me';
        if (rel === 1) return 'timer-left';
        if (rel === 2) return 'timer-partner';
        if (rel === 3) return 'timer-right';
        return null;
    };

    // Update all 4 timers
    for (let i = 0; i < 4; i++) {
        const elId = getDomId(i);
        const el = document.getElementById(elId);
        if (el) el.innerText = fmt(state.seatTimers[i]);
    }
}

// client.js

// --- PRIVATE ROOM LOGIC ---

window.doCreateRoom = () => {
    const roomName = document.getElementById('create-room-name').value; // Get Name
    const pin = document.getElementById('create-pin').value;
    
    // Validation
    if (!roomName) return alert("Please enter a Room Name");
    if (!pin || pin.length !== 4) return alert("Enter a 4-digit PIN");
    
    // Send both Name (as gameId) and PIN
    state.socket.emit('request_create_private', { gameId: roomName, pin: pin });
};

window.doJoinPrivate = () => {
    const gameId = document.getElementById('join-id').value;
    const pin = document.getElementById('join-pin').value;
    if(!gameId || !pin) return alert("Fill all fields");

    state.socket.emit('request_join_private', { gameId, pin });
};

// --- FRIENDS LOGIC ---

window.openFriendsScreen = () => {
    UI.navTo('screen-friends');
    state.socket.emit('social_get_lists'); // Fetch data
    window.showFriendTab('list');
};

window.showFriendTab = (mode) => {
    state.friendMode = mode;
    const content = document.getElementById('friend-content');
    const searchBar = document.getElementById('friend-search-bar');
    
    content.innerHTML = "";
    searchBar.style.display = (mode === 'search') ? 'block' : 'none';

    if (mode === 'list' || mode === 'blocked') {
        state.socket.emit('social_get_lists');
    }
};

window.doUserSearch = () => {
    const q = document.getElementById('search-query').value;
    if (q.length > 2) state.socket.emit('social_search', q);
};

window.addFriend = (name, btn) => {
    state.socket.emit('social_add_friend', name);
    
    // VISUAL FEEDBACK
    if (btn) {
        btn.innerText = "✔";       // Change to Checkmark
        btn.style.background = "#7f8c8d"; // Change to grey to indicate 'disabled/done'
        btn.disabled = true;       // Prevent double-clicking
        btn.onclick = null;        // Remove click handler
    }
};

window.blockUser = (name) => state.socket.emit('social_block_user', name);


function renderUserList(items, mode) {
    const div = document.getElementById('friend-content');
    div.innerHTML = "";
    if (!items || items.length === 0) {
        div.innerHTML = "<div style='text-align:center; color:#777; padding:20px;'>No players found.</div>";
        return;
    }

    items.forEach(item => {
        const row = document.createElement('div');
        row.style.cssText = "display:flex; justify-content:space-between; align-items:center; padding:10px; border-bottom:1px solid #444; color:white;";
        
        // Handle both Strings (Search/Blocked) and Objects (Friends with Status)
        let name = item;
        let isOnline = false;
        
        if (typeof item === 'object') {
            name = item.username;
            isOnline = item.isOnline;
        }

        // Create Status Dot (Only for Friends list)
        let statusDot = "";
        if (mode === 'list') { // 'list' is the ID for "My Friends" tab
            const color = isOnline ? "#2ecc71" : "#7f8c8d"; // Green vs Grey
            statusDot = `<span style="display:inline-block; width:8px; height:8px; background:${color}; border-radius:50%; margin-right:8px; box-shadow: 0 0 5px ${color};"></span>`;
        }

        let actions = "";
        if (mode === 'search') {
            actions = `<button onclick="addFriend('${name}', this)" style="background:#2ecc71; border:none; border-radius:4px; cursor:pointer; width:30px; color:#2c3e50; font-weight:bold;">+</button>`;
        } else if (mode === 'list') {
            actions = `<button onclick="blockUser('${name}')" style="background:#e74c3c; color:white; border:none; border-radius:4px; font-size:10px; padding:2px 5px; cursor:pointer;">BLOCK</button>`;
        } else if (mode === 'blocked') {
            actions = `<span style="color:#e74c3c; font-size:12px;">BLOCKED</span>`;
        }

        // Insert Name with Dot
        row.innerHTML = `<div style="display:flex; align-items:center;">${statusDot}<span>${name}</span></div> <div>${actions}</div>`;
        div.appendChild(row);
    });
}