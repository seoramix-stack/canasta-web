// public/client.js
// --- GLOBAL VARIABLES ---
let socket = null;
let playerToken = localStorage.getItem("canasta_token");
let playerUsername = localStorage.getItem("canasta_user");

// --- INITIALIZATION ---
// Check if we already have a token from a previous session
if (playerToken && playerUsername) {
    // Attempt auto-login
    initSocket(playerToken);
} else {
    // Stay on Login Screen
    navTo('screen-login');
}

// --- AUTH FUNCTIONS ---

function toggleForms(mode) {
    document.getElementById('form-login').style.display = (mode === 'login') ? 'flex' : 'none';
    document.getElementById('form-register').style.display = (mode === 'register') ? 'flex' : 'none';
    // Clear errors
    document.querySelectorAll('.error-msg').forEach(el => el.style.display = 'none');
}

async function doLogin() {
    const user = document.getElementById('login-user').value;
    const pass = document.getElementById('login-pass').value;
    if(!user || !pass) return showAuthError('login', "Please fill all fields");

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
        } else {
            showAuthError('login', data.message);
        }
    } catch (e) { showAuthError('login', "Server error"); }
}

async function doRegister() {
    const user = document.getElementById('reg-user').value;
    const pass = document.getElementById('reg-pass').value;
    if(!user || !pass) return showAuthError('reg', "Please fill all fields");

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
            showAuthError('reg', data.message);
        }
    } catch (e) { showAuthError('reg', "Server error"); }
}

function showAuthError(type, msg) {
    const el = document.getElementById(type + '-error');
    el.innerText = msg;
    el.style.display = 'block';
}

function saveSession(token, username) {
    playerToken = token;
    localStorage.setItem("canasta_token", token);
    localStorage.setItem("canasta_user", username);
}

function logout() {
    localStorage.removeItem("canasta_token");
    localStorage.removeItem("canasta_user");
    location.reload();
}

// --- SOCKET SETUP ---
function initSocket(token) {
    // Prevent double connection
    if (socket) return; 

    socket = io({
        auth: { token: token }
    });

    setupSocketListeners(); // Attach all the game listeners
    navTo('screen-home');   // Go to main menu
    
    // Update Profile Name in UI
    const pName = localStorage.getItem("canasta_user") || "Player";
    document.querySelector('.p-name').innerText = pName;
}

// --- NAVIGATION & MENU ---
let currentBotDiff = 'medium';
let mySeat = -1;
let selectedIndices = []; 
let activeData = null;
let stagedMelds = []; 
let isStaging = false; 
let pickupStaged = false; 

// --- TIMER & GAME STATE ---
let seatTimers = { 0: 720, 1: 720, 2: 720, 3: 720 }; 
let currentTurnSeat = -1;
let timerInterval = null;
let gameStarted = false;

function navTo(screenId) {
    document.querySelectorAll('.app-screen').forEach(el => el.classList.remove('active-screen'));
    document.getElementById(screenId).classList.add('active-screen');
}

function selectBotDiff(diff, btn) {
    currentBotDiff = diff;
    document.querySelectorAll('.diff-btn').forEach(el => el.classList.remove('selected'));
    btn.classList.add('selected');
}

function connectToGame(mode) {
    navTo('screen-game');
    // Hide UI until deal
    document.getElementById('game-ui').style.display = 'none';
    document.getElementById('status').style.display = 'block';
    
    // Reset Modal
    document.getElementById('ready-modal').style.display = 'none';
    document.getElementById('ready-step-1').style.display = 'block';
    document.getElementById('ready-step-2').style.display = 'none';
    
    selectedIndices = []; stagedMelds = []; isStaging = false;
    seatTimers = { 0: 720, 1: 720, 2: 720, 3: 720 };
    if(timerInterval) clearInterval(timerInterval);
    startLocalTimer();

    socket.emit('request_join', { mode: mode, difficulty: currentBotDiff });
}

function leaveGame() {
    socket.emit('leave_game');
    if(timerInterval) clearInterval(timerInterval);
    navTo('screen-home');
}

// --- SOCKETS ---
function setupSocketListeners() {  // <--- 1. OPEN FUNCTION WRAPPER
socket.on('connect', () => { console.log("Connected."); });

socket.on('ready_status', (data) => {
    // data.readySeats is an array of seat numbers who are ready
    for (let i = 0; i < 4; i++) {
        const el = document.getElementById('ind-' + i);
        if (el) {
            if (data.readySeats.includes(i)) {
                el.classList.add('ready');
            } else {
                el.classList.remove('ready');
            }
        }
    }
});

socket.on('deal_hand', (data) => {
    // 1. Detect if this is a fresh start (game was previously empty or we just joined)
    const isFirstDeal = (activeData === null || activeData.hand.length === 0);

    mySeat = data.seat;
    navTo('screen-game');
    document.getElementById('status').style.display = 'none';
    if (data.currentPlayer === -1) {
        // Game Found (Waiting for Ready)
        document.getElementById('game-ui').style.display = 'none'; 
        document.getElementById('ready-modal').style.display = 'flex';
    } else {
        // Game Active (Playing)
        document.getElementById('game-ui').style.display = 'block'; 
        document.getElementById('ready-modal').style.display = 'none'; 
    }

    // CRITICAL: Render the UI first so we know where the cards *will* be
    updateUI(data);

    // 2. TRIGGER DEAL ANIMATION
    if (isFirstDeal && data.hand.length > 0) {
        animateDeal();
    }
});

function animateDeal() {
    const deckRect = getRect('draw-area');
    
    // We deal to all 4 seats (0, 1, 2, 3)
    // 11 cards each
    for (let round = 0; round < 11; round++) {
        for (let seat = 0; seat < 4; seat++) {
            
            const targetDiv = getHandDiv(seat);
            if (!targetDiv) continue;

            // Calculate destination (Center of the hand div)
            const rect = targetDiv.getBoundingClientRect();
            
            // Stagger logic: 
            // round * 4 ensures we deal 1 card to everyone, then the 2nd card, etc.
            // + seat ensures order P1, P2, P3, P4
            const delay = (round * 4 + seat) * 50; 

            // Fly the card!
            // Note: For me (mySeat), we fly the BackRed, and when it lands, the real card reveals.
            flyCard(deckRect, rect, "cards/BackRed.png", delay, () => {
                if (seat === mySeat) {
                    // Reveal my real cards one by one (optional polish)
                    const myCards = document.querySelectorAll('#my-hand .hand-card-wrap img');
                    if (myCards[round]) myCards[round].style.opacity = '1';
                }
            });
        }
    }
}

socket.on('match_over', (data) => {
    console.log("🏆 MATCH OVER DATA:", data);

    // Use setTimeout to ensure the DOM is ready and detach from socket thread
    setTimeout(() => {
        try {
            // 1. Force Hide Game Screen & Modals
            const gameScreen = document.getElementById('screen-game');
            const scoreModal = document.getElementById('score-modal');
            const readyModal = document.getElementById('ready-modal');

            if (scoreModal) scoreModal.style.display = 'none';
            if (readyModal) readyModal.style.display = 'none';
            if (gameScreen) gameScreen.classList.remove('active-screen');

            // 2. Prepare Victory Screen
            const vicScreen = document.getElementById('screen-victory');
            if (!vicScreen) {
                alert("Critical Error: Victory Screen element missing!");
                return;
            }

            // 3. Update Text Content BEFORE showing the screen
            const title = document.getElementById('vic-title');
            const sub = document.getElementById('vic-sub');
            
            // Determine Winner logic
            // Handle both "team1" (string) and 1 (int)
            const team1Won = (data.winner === 1 || data.winner === 'team1');
            const amITeam1 = (mySeat === 0 || mySeat === 2);
            const iWon = (amITeam1 && team1Won) || (!amITeam1 && !team1Won);

            if (title && sub) {
                if (iWon) {
                    title.innerText = "VICTORY!";
                    title.style.color = "#2ecc71";
                    sub.innerText = "MY TEAM WINS THE MATCH";
                    sub.style.color = "#2ecc71";
                } else {
                    title.innerText = "DEFEAT";
                    title.style.color = "#e74c3c";
                    sub.innerText = "OPPONENTS WIN THE MATCH";
                    sub.style.color = "#bdc3c7";
                }
            }

            // 4. Update Score Table
            const scoreBox = document.querySelector('.final-score-box');
            if (scoreBox && data.scores) {
                const s1 = data.scores.team1 || 0;
                const s2 = data.scores.team2 || 0;
                const myScore = amITeam1 ? s1 : s2;
                const oppScore = amITeam1 ? s2 : s1;

                scoreBox.innerHTML = `
                    <div class="fs-row">
                        <span style="color: #f1c40f">MY TEAM</span>
                        <span>${myScore}</span>
                    </div>
                    <div class="fs-row">
                        <span style="color: #fff">OPPONENTS</span>
                        <span>${oppScore}</span>
                    </div>
                `;
            }

            // 5. FINALLY Show the Screen
            // We use both the class AND direct style to guarantee visibility
            vicScreen.classList.add('active-screen');
            vicScreen.style.display = 'flex'; 

            console.log("✅ Victory Screen displayed successfully.");

        } catch (err) {
            console.error("❌ CRASH in match_over:", err);
            // Fallback: Reload to menu if everything fails
            alert("Match Over! Returning to menu...");
            navTo('screen-home');
        }
    }, 100); // 100ms delay to allow previous UI to clear
});

socket.on('update_game', (data) => {
    // 1. Trigger Animations based on changes
    if (activeData) {
        handleServerAnimations(activeData, data);
    }

    // 2. Update the Data & UI
    updateUI(data); 
});

socket.on('error_message', (msg) => { alert(msg); });
}

// --- READY LOGIC ---
function sendReady() {
    document.getElementById('ready-step-1').style.display = 'none';
    document.getElementById('ready-step-2').style.display = 'flex';
    socket.emit('act_ready', { seat: mySeat });
}

// --- TIMER LOGIC ---
function startLocalTimer() {
    timerInterval = setInterval(() => {
        if(gameStarted && currentTurnSeat !== -1 && seatTimers[currentTurnSeat] > 0) {
            seatTimers[currentTurnSeat]--;
            updateTimerDisplay();
        }
    }, 1000);
}

function updateTimerDisplay() {
    if(mySeat === -1) return;
    let visualActiveSeat = (currentTurnSeat === -1 && gameStarted) ? 0 : currentTurnSeat;

    const updateOne = (seatIndex, elementSuffix) => {
        let elText = document.getElementById('timer-' + elementSuffix);
        let elLight = document.getElementById('light-' + elementSuffix);
        
        let total = seatTimers[seatIndex];
        let m = Math.floor(total / 60);
        let s = total % 60;
        elText.innerText = (m < 10 ? "0"+m : m) + ":" + (s < 10 ? "0"+s : s);

        if(visualActiveSeat === seatIndex) {
            elLight.classList.add('active'); 
        } else {
            elLight.classList.remove('active'); 
        }
    };

    updateOne(mySeat, 'me');
    updateOne((mySeat + 1) % 4, 'left');
    updateOne((mySeat + 2) % 4, 'partner');
    updateOne((mySeat + 3) % 4, 'right');
}

// --- UI RENDERING ---

function updateUI(data) {
    if (isStaging) {
        cancelOpening(); 
    }

    activeData = data;

    // If currentPlayer is not -1, the game has started.
    if (data.currentPlayer !== -1) {
        document.getElementById('ready-modal').style.display = 'none';
    }
    document.getElementById('game-ui').style.display = 'block';

    // 1. CHECK FOR GAME OVER
    if (data.phase === 'game_over' && data.scores) {
        showScoreModal(data.scores, data.cumulativeScores);
    } else {
        document.getElementById('score-modal').style.display = 'none';
    }

    // 2. Render Discard Pile
    renderDiscardPile(data);

    // 3. Render Hands & Melds
    renderHand(data.hand);
    renderTable("enemy-melds", (mySeat % 2 === 0) ? data.team2Melds : data.team1Melds, (mySeat % 2 === 0) ? data.team2Red3s : data.team1Red3s);
    renderTable("my-melds", (mySeat % 2 === 0) ? data.team1Melds : data.team2Melds, (mySeat % 2 === 0) ? data.team1Red3s : data.team2Red3s);
    
    // 4. Render Others
    renderOtherHand("hand-partner", data.handSizes[(mySeat + 2) % 4], 'horiz');
    renderOtherHand("hand-left", data.handSizes[(mySeat + 1) % 4], 'vert');
    renderOtherHand("hand-right", data.handSizes[(mySeat + 3) % 4], 'vert');

    // 5. Update Scores
    document.getElementById('live-s1').innerText = data.cumulativeScores.team1;
    document.getElementById('live-s2').innerText = data.cumulativeScores.team2;
    if (data.deckSize !== undefined) {
        document.getElementById('deck-count').innerText = data.deckSize;
    }

    // 6. Highlight Active Turn
    currentTurnSeat = data.currentPlayer;
    gameStarted = true;
    updateTimerDisplay();

    // --- NEW: DYNAMIC NAMING LOGIC ---

    // 1. Determine "My Team" vs "Opponent"
    var lbl1 = document.getElementById('lbl-s1');
    var lbl2 = document.getElementById('lbl-s2');

    // Seat 0 & 2 are Team 1. Seat 1 & 3 are Team 2.
    var amITeam1 = (mySeat === 0 || mySeat === 2);

    if (amITeam1) {
        lbl1.innerText = "MY TEAM";
        lbl1.style.color = "#f1c40f"; // Gold
        lbl2.innerText = "OPPONENTS";
        lbl2.style.color = "#ffffff"; // White
    } else {
        lbl1.innerText = "OPPONENTS";
        lbl1.style.color = "#ffffff";
        lbl2.innerText = "MY TEAM";
        lbl2.style.color = "#f1c40f";
    }

    // 2. Update HUD Names
    if (data.names) {
        // My Name
        document.getElementById('name-me').innerText = data.names[mySeat];
        
        // Partner (My Seat + 2)
        var pSeat = (mySeat + 2) % 4;
        document.getElementById('name-partner').innerText = data.names[pSeat];

        // Left (My Seat + 1)
        var lSeat = (mySeat + 1) % 4;
        document.getElementById('name-left').innerText = data.names[lSeat];

        // Right (My Seat + 3)
        var rSeat = (mySeat + 3) % 4;
        document.getElementById('name-right').innerText = data.names[rSeat];
    }
}

// --- NEW HELPER FUNCTION (Must be OUTSIDE updateUI) ---
function showScoreModal(roundScores, matchScores) {
    document.getElementById('score-modal').style.display = 'flex';

    // 1. Determine Perspective
    // Seats 0 & 2 = Team 1. Seats 1 & 3 = Team 2.
    const amITeam1 = (mySeat === 0 || mySeat === 2);

    // 2. Set Table Headers based on perspective
    // Column 1 is ALWAYS Team 1 data (row-base-1, etc.)
    // Column 2 is ALWAYS Team 2 data (row-base-2, etc.)
    const h1 = document.getElementById('header-col-1');
    const h2 = document.getElementById('header-col-2');

    if (amITeam1) {
        h1.innerText = "MY TEAM";
        h1.style.color = "#f1c40f"; // Gold
        h2.innerText = "OPPONENTS";
        h2.style.color = "#333";    // Dark Grey
    } else {
        h1.innerText = "OPPONENTS";
        h1.style.color = "#333";
        h2.innerText = "MY TEAM";
        h2.style.color = "#f1c40f";
    }

    // 3. Helper to colorize numbers
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        el.innerText = val;
        el.style.color = val < 0 ? '#e74c3c' : (val > 0 ? '#2ecc71' : '#bdc3c7');
    };

    // 4. Fill Table Data (Standard - Col 1 is T1, Col 2 is T2)
    setVal('row-base-1', roundScores.team1.basePoints);
    setVal('row-canasta-1', roundScores.team1.canastaBonus);
    setVal('row-red3-1', roundScores.team1.red3Points);
    setVal('row-bonus-1', roundScores.team1.goOutBonus);
    setVal('row-deduct-1', roundScores.team1.deductions);
    setVal('row-total-1', roundScores.team1.total);

    setVal('row-base-2', roundScores.team2.basePoints);
    setVal('row-canasta-2', roundScores.team2.canastaBonus);
    setVal('row-red3-2', roundScores.team2.red3Points);
    setVal('row-bonus-2', roundScores.team2.goOutBonus);
    setVal('row-deduct-2', roundScores.team2.deductions);
    setVal('row-total-2', roundScores.team2.total);

    // 5. Update Top Match Score Display (The invisible text fix)
    // We construct the string based on who is "My Team"
    
    let t1Start = matchScores.team1;
    let t1Add = roundScores.team1.total;
    let t1End = t1Start + t1Add;
    
    let t2Start = matchScores.team2;
    let t2Add = roundScores.team2.total;
    let t2End = t2Start + t2Add;

    // Formatting Helpers
    const fmtDiff = (n) => (n >= 0 ? `+${n}` : `${n}`);
    const fmtTotal = (n) => `<b style="color:#333; font-size:1.1em;">${n}</b>`; // Dark Grey for visibility

    // Construct the labels dynamically
    const labelT1 = amITeam1 ? "MY TEAM" : "OPPONENTS";
    const labelT2 = amITeam1 ? "OPPONENTS" : "MY TEAM";
    
    // We target the container directly to rewrite the layout clearly
    const s1El = document.getElementById('match-s1');
    const s2El = document.getElementById('match-s2');

    // Because the HTML has "Match Score: [s1] - [s2]", we inject the label AND score into the spans
    s1El.innerHTML = `
        <div style="font-size:12px; color:#888;">${labelT1}</div>
        ${t1Start} <span style="font-size:0.8em; color:#888;">(${fmtDiff(t1Add)})</span> = ${fmtTotal(t1End)}
    `;

    s2El.innerHTML = `
        <div style="font-size:12px; color:#888;">${labelT2}</div>
        ${t2Start} <span style="font-size:0.8em; color:#888;">(${fmtDiff(t2Add)})</span> = ${fmtTotal(t2End)}
    `;
}

function renderDiscardPile(data) {
    var discardDiv = document.getElementById('discard-display');
    discardDiv.innerHTML = ""; 

    if (!data.topDiscard) {
        discardDiv.innerHTML = '<div style="width:var(--card-w); height:var(--card-h); border:2px dashed #555; border-radius:4px; opacity:0.3; display:flex; align-items:center; justify-content:center; font-size:10px; color:#aaa;">EMPTY</div>';
        document.getElementById('frozen-underlay').style.display = 'none';
        return;
    }

    // Logic to distinguish "Just Frozen" vs "Buried Frozen"
    var topIsFreezing = (data.topDiscard.rank === "2" || data.topDiscard.rank === "Joker" || (data.topDiscard.rank === "3" && (data.topDiscard.suit === "Hearts" || data.topDiscard.suit === "Diamonds")));
    
    if (topIsFreezing) {
        // --- SCENARIO 1: The Top Card IS the Wild/Red3 ---
        // 1. Show the card UNDERNEATH (if it exists) so we can see its rank
        if (data.previousDiscard) {
            var imgBase = document.createElement("img");
            imgBase.src = getCardImage(data.previousDiscard);
            imgBase.className = "card-img discard-stack-card discard-base-card";
            discardDiv.appendChild(imgBase);
        }

        // 2. Show the Wild on TOP, shifted right
        var imgWild = document.createElement("img");
        imgWild.src = getCardImage(data.topDiscard);
        imgWild.className = "card-img discard-stack-card discard-wild-top";
        discardDiv.appendChild(imgWild);

        document.getElementById('frozen-underlay').style.display = 'none';

    } else if (data.isFrozen && data.freezingCard) {
        // --- SCENARIO 2: Frozen, but Wild is buried ---
        // 1. Show the Buried Wild (Rotated)
        var imgBot = document.createElement("img");
        imgBot.src = getCardImage(data.freezingCard);
        imgBot.className = "card-img discard-stack-card discard-frozen-rot";
        discardDiv.appendChild(imgBot);

        // 2. Show Top Card (Offset slightly)
        var imgTop = document.createElement("img");
        imgTop.src = getCardImage(data.topDiscard);
        imgTop.className = "card-img discard-stack-card discard-top-offset";
        discardDiv.appendChild(imgTop);
        
        document.getElementById('frozen-underlay').style.display = 'none';

    } else {
        // --- SCENARIO 3: Normal Pile ---
        var img = document.createElement("img");
        img.src = getCardImage(data.topDiscard);
        img.className = "card-img discard-stack-card"; 
        discardDiv.appendChild(img);
        document.getElementById('frozen-underlay').style.display = 'none';
    }
}

function addToStagedMeld(meldIndex) {
    if (selectedIndices.length === 0) return alert("Select cards from your hand first.");
    
    // 1. Get the target meld and the cards to add
    var targetMeld = stagedMelds[meldIndex];
    var newCards = selectedIndices.map(function(idx) { return activeData.hand[idx]; });

    // 2. Validate Ranks
    // You can only add:
    // a) Wild cards
    // b) Cards that match the rank of the staged meld
    var invalidCard = newCards.find(function(c) { 
        return !c.isWild && c.rank !== targetMeld.rank; 
    });

    if (invalidCard) {
        return alert("Cannot add " + invalidCard.rank + " to a " + targetMeld.rank + " meld.");
    }

    // 3. Add to the Staged Object
    // We update both the 'indices' (for server communication) and 'cards' (for UI point calculation)
    targetMeld.indices = targetMeld.indices.concat(selectedIndices);
    targetMeld.cards = targetMeld.cards.concat(newCards);

    // 4. Reset Selection & Re-render
    selectedIndices = [];
    renderHand(activeData.hand); // Refreshes hand to remove selection highlight
    renderStagingArea();         // Updates points and shows new cards in panel
}

function renderOtherHand(elementId, count, orientation) {
    var div = document.getElementById(elementId);
    if (!div) return;
    div.innerHTML = "";
    if (!count || count === 0) return;

    // 1. LIMITS
    var maxVertHeight = 350; 
    var maxHorizWidth = 400;

    var isVert = (orientation === 'vert');
    var isDesktop = window.innerWidth > 800;

    // 2. CONFIGURATION
    // We define how much overlap we want by default.
    var defaultMargin;

    if (isVert) {
        // Vertical Side Hands
        // Mobile: 50px card. -35 margin = 15px visible.
        // Desktop: 75px card. -55 margin = 20px visible.
        defaultMargin = isDesktop ? -55 : -35; 
    } else {
        // Horizontal Partner Hand
        // Mobile: 50px card. -35 margin = 15px visible.
        // Desktop: 75px card. -50 margin = 25px visible.
        defaultMargin = isDesktop ? -50 : -35;
    }

    // 3. CALCULATE SQUISH
    var cardSizeInFlow = isVert ? 50 : 50; 
    if (isDesktop) cardSizeInFlow = isVert ? 75 : 75;

    // Logic: If (Cards * (Size + Margin)) > Limit, we need to squish more.
    var activeMargin = defaultMargin;
    var limit = isVert ? maxVertHeight : maxHorizWidth;

    if (count > 1) {
        // Total width/height if we use default margin
        var naturalSize = (cardSizeInFlow) + ((count - 1) * (cardSizeInFlow + defaultMargin));
        
        if (naturalSize > limit) {
            // We need to fit (count-1) gaps into (limit - one_card_size)
            // gap = (limit - cardSize) / (count - 1)
            // margin = gap - cardSize
            
            var availableSpaceForGaps = limit - cardSizeInFlow;
            var requiredGap = availableSpaceForGaps / (count - 1);
            activeMargin = requiredGap - cardSizeInFlow;
        }
    }

    // 4. RENDER
    for (var i = 0; i < count; i++) {
        var card = document.createElement("div");
        card.className = isVert ? "side-card" : "partner-card";
        
        // Reset margins to be safe (overrides any lingering CSS issues)
        card.style.margin = "0";

        if (i > 0) {
            if (isVert) card.style.marginTop = activeMargin + "px";
            else card.style.marginLeft = activeMargin + "px";
        }
        
        div.appendChild(card);
    }
}

function renderTable(elementId, meldsObj, red3sArray) {
    var container = document.getElementById(elementId);
    if(!container) return;
    
    container.innerHTML = "";
    var groupsToRender = [];

    var isDesktop = window.innerWidth > 800;
    var visibleStrip = isDesktop ? 22 : 18; 
    var cardHeight = isDesktop ? 105 : 70;
    var vertMargin = visibleStrip - cardHeight; 

    // 1. Add Red 3s (Leftmost)
    if (red3sArray && red3sArray.length > 0) {
        groupsToRender.push({ type: 'red3', label: '', cards: red3sArray });
    }

    // 2. Add Melds (Sorted A -> 3)
    if (meldsObj) {
        // Added "3" to the end so Black 3s sort correctly to the right
        var rankPriority = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3"];
        
        var sortedRanks = Object.keys(meldsObj).sort(function(a, b) { 
            return rankPriority.indexOf(a) - rankPriority.indexOf(b); 
        });
        
        sortedRanks.forEach(function(rank) { 
            // CHANGE: Use .length (Count) instead of rank (Name)
            // This displays "5", "6", etc. above the cards.
            groupsToRender.push({ type: 'meld', rank: rank, label: meldsObj[rank].length, cards: meldsObj[rank] }); 
        });
    }

    // 3. Layout Calculations
    var safeWidth = container.clientWidth || window.innerWidth;
    var containerWidth = safeWidth - 10; 
    var groupWidth = isDesktop ? 75 : 50;
    var totalGroups = groupsToRender.length; 
    var horizMargin = 5; 

    if (totalGroups > 1) {
         var calculated = ((containerWidth - groupWidth) / (totalGroups - 1)) - groupWidth;
         horizMargin = Math.min(10, Math.max(-15, calculated));
    }

    // 4. Render Groups
    groupsToRender.forEach(function(groupData, gIdx) {
        var groupDiv = document.createElement("div");
        groupDiv.className = "meld-group";
        const teamSuffix = (elementId === "my-melds") ? "my" : "enemy";
        groupDiv.id = "meld-pile-" + teamSuffix + "-" + groupData.rank;
        
        // 1. Use relative position so z-index works
        groupDiv.style.position = "relative";
        // 2. Assign z-index based on order. 
        // gIdx increases left-to-right, so the right neighbor always has a higher number.
        // This ensures the 9s (Right) will sit ON TOP of the 10s (Left).
        groupDiv.style.zIndex = gIdx; 
        
        if (gIdx < totalGroups - 1) groupDiv.style.marginRight = horizMargin + "px";
        // --- NEW CLICK LOGIC ---
        // Only make "My Melds" interactive. Enemy melds are just for show.
        if (elementId === "my-melds" && groupData.type === 'meld') {
            // Pass the specific rank (e.g., 'K') to the handler
            groupDiv.setAttribute("onclick", "handleMeldClick(event, '" + groupData.rank + "')");
            groupDiv.style.cursor = "pointer";
        }
        
        var html = "<span class='meld-label'>" + groupData.label + "</span>";
        html += "<div class='meld-container' style='display:flex; flex-direction:column; align-items:center;'>";
        
        var pile = groupData.cards;
        var isClosed = (groupData.type !== 'red3' && pile.length >= 7);

        if (isClosed) {
            // Closed Canasta
            var isNatural = !pile.some(function(c) { return c.isWild; });
            var topCard = pile[0]; 
            if (isNatural) topCard = pile.find(function(c) { return c.suit === 'Hearts' || c.suit === 'Diamonds'; }) || pile[0];
            else topCard = pile.find(function(c) { return !c.isWild && (c.suit === 'Clubs' || c.suit === 'Spades'); }) || pile[0];
            
            var badgeColor = isNatural ? "#d63031" : "#2d3436";
            
            html += '<div style="position:relative;">' + 
                    '<img src="' + getCardImage(topCard) + '" class="card-img meld-card" style="box-shadow:2px 2px 0 #555; border:1px solid #000;">' + 
                    '<div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg); background:'+badgeColor+'; color:white; font-size:8px; padding:1px 3px; border:1px solid white;">'+(isNatural?"NAT":"MIX")+'</div>' + 
                    '</div>';
        } else {
            // Open Meld
            var activeMargin = vertMargin;
            if (pile.length > 5) activeMargin -= 5; 

            pile.forEach(function(c, cIdx) { 
                var style = (cIdx > 0) ? "margin-top:" + activeMargin + "px;" : "";
                style += "margin-left: 0; transform: none; box-shadow: 1px 1px 2px rgba(0,0,0,0.3);";
                html += '<img src="' + getCardImage(c) + '" class="card-img meld-card" style="' + style + '">'; 
            });
        }
        
        html += "</div>"; 
        groupDiv.innerHTML = html; 
        container.appendChild(groupDiv);
    });
}

function renderHand(hand) {
    var div = document.getElementById('my-hand');
    if(!div) return;
    div.innerHTML = "";
    if (!hand || hand.length === 0) return;

    var isDesktop = window.innerWidth > 800;
    
    // --- DIMENSIONS & CONFIG ---
    var cardHeight = isDesktop ? 105 : 70;
    var groupWidth = isDesktop ? 75 : 50;
    
    // NEW DESKTOP SETTINGS:
    var containerLimit = isDesktop ? 180 : 110; 
    
    var buffer = 5; 
    var defaultVisibleStrip = isDesktop ? 40 : 25; 

    // 1. Group cards by Rank
    var groups = [];
    var currentGroup = [];
    hand.forEach(function(card, index) {
        if (currentGroup.length === 0) currentGroup.push({card: card, index: index});
        else {
            if (currentGroup[currentGroup.length - 1].card.rank === card.rank) currentGroup.push({card: card, index: index});
            else { groups.push(currentGroup); currentGroup = [{card: card, index: index}]; }
        }
    });
    if (currentGroup.length > 0) groups.push(currentGroup);

    // 2. Horizontal Calculation
    var safeWidth = div.clientWidth || window.innerWidth;
    var containerWidth = safeWidth - 20;
    var totalGroups = groups.length;
    var groupOverlap = 5; 

    if (totalGroups > 1) {
        var calculated = ((containerWidth - groupWidth) / (totalGroups - 1)) - groupWidth;
        groupOverlap = Math.min(15, Math.max(-30, calculated));
    }

    // 3. Render Groups
    groups.forEach(function(grp, gIdx) {
        var groupDiv = document.createElement("div");
        groupDiv.className = "hand-group";
        if (gIdx < totalGroups - 1) groupDiv.style.marginRight = groupOverlap + "px";
        
        // --- SQUISH LOGIC ---
        var availableSpine = containerLimit - cardHeight - buffer;
        var stepSize = defaultVisibleStrip;

        if (grp.length > 1) {
            var neededSpine = (grp.length - 1) * defaultVisibleStrip;
            // Only squish if we exceed the limit
            if (neededSpine > availableSpine) {
                stepSize = availableSpine / (grp.length - 1);
            }
        }

        // Standard "Fan Down" logic:
        // By pulling the card up less than its full height, we create a stack that grows downwards visually.
        var negMargin = -(cardHeight - stepSize);
        
        grp.forEach(function(item, cIdx) {
            var wrapper = document.createElement("div");
            wrapper.className = "hand-card-wrap";
            
            if (cIdx > 0) wrapper.style.marginTop = negMargin + "px";
            
            if (selectedIndices.includes(item.index)) wrapper.classList.add("selected");
            
            var img = document.createElement("img");
            img.src = getCardImage(item.card);
            wrapper.appendChild(img);
            wrapper.onclick = function() { toggleSelect(item.index); };
            groupDiv.appendChild(wrapper);
        });
        div.appendChild(groupDiv);
    });
}

function toggleSelect(idx) {
    if (selectedIndices.includes(idx)) {
        selectedIndices = selectedIndices.filter(function(i) { return i !== idx; });
    } else {
        selectedIndices.push(idx);
    }
    if (activeData) renderHand(activeData.hand);
}

function drawCard() { 
    console.log("Attempting to draw..."); // Debug log
    socket.emit('act_draw', { seat: mySeat }); 
}

function handleDiscardClick() {
    if (selectedIndices.length === 1) {
         // 1. Capture Animation Data
         const cardIndex = selectedIndices[0];
         // Find the actual DOM element for this card
         // Note: We need a reliable way to pick the right one. 
         // Since renderHand creates elements in order, we can use querySelectorAll
         const cardWraps = document.querySelectorAll('#my-hand .hand-card-wrap img');
         const sourceEl = cardWraps[cardIndex];
         
         if (sourceEl) {
             const sourceRect = sourceEl.getBoundingClientRect();
             const destRect = getRect('discard-display');
             const imgSrc = sourceEl.src;
             
             // Fly Card!
             flyCard(sourceRect, destRect, imgSrc);
         }

         socket.emit('act_discard', { seat: mySeat, index: selectedIndices[0] }); 
         selectedIndices = [];
    } else { 
        handlePickupClick(); 
    }
}
// Update the new click handler too
function handleMeldClick(event, targetRank) {
    event.stopPropagation();
    if (selectedIndices.length === 0) return;

    // Animation Logic
    const cardWraps = document.querySelectorAll('#my-hand .hand-card-wrap img');
    // Try to find the specific pile we clicked on for better accuracy
    const targetPile = event.currentTarget; // The div we clicked
    const destRect = targetPile ? targetPile.getBoundingClientRect() : getRect('my-melds');

    selectedIndices.forEach(idx => {
        if(cardWraps[idx]) {
            flyCard(cardWraps[idx].getBoundingClientRect(), destRect, cardWraps[idx].src);
        }
    });
    var cards = selectedIndices.map(function(i) { return activeData.hand[i]; });
    var invalid = cards.find(function(c) { 
        return !c.isWild && c.rank !== targetRank; 
    });

    if (invalid) {
        alert("Cannot add " + invalid.rank + " to a pile of " + targetRank + "s.");
        return;
    }

    // 4. Send Immediate Action
    // We already know the rank, so we bypass the prompt and the staging logic.
    socket.emit('act_meld', { 
        seat: mySeat, 
        indices: selectedIndices, 
        targetRank: targetRank 
    });

    // 5. Cleanup
    selectedIndices = [];
    renderHand(activeData.hand);
}

function meldSelected() {
    if (!activeData) return;
    
    // Check if my team has already opened
    var myTeamMelds = (mySeat % 2 === 0) ? activeData.team1Melds : activeData.team2Melds;
    var hasOpened = Object.keys(myTeamMelds).length > 0;

    if (hasOpened) {
        // If already opened, just meld normally
        handleStandardMeld();
    } else {
        // --- NEW SMART OPENING LOGIC ---
        
        // 1. Calculate the points of the currently selected cards
        var totalPts = 0;
        var selectedCards = selectedIndices.map(function(i) { 
            return activeData.hand[i]; 
        });

        // Sum up points (A=20, Joker=50, etc.)
        selectedCards.forEach(function(c) {
             totalPts += getCardValue(c.rank); 
        });

        // 2. Get the required points for this match state
        var myScore = (mySeat % 2 === 0) ? activeData.cumulativeScores.team1 : activeData.cumulativeScores.team2;
        var req = getOpeningReq(myScore);

        // 3. Decision: Direct Meld vs. Staging
        // If this SINGLE meld is enough to open, skip staging and try to meld it directly.
        if (totalPts >= req) {
            handleStandardMeld();
        } else {
            // Not enough points in this specific meld? 
            // Send to staging so they can combine it with other melds.
            startStagingMeld();
        }
    }
}

function handleStandardMeld() {
    if (selectedIndices.length === 0) return alert("Select cards first.");
    
    var cards = selectedIndices.map(function(i) { return activeData.hand[i]; });
    
    // Logic to find Rank (Existing)
    var allWilds = true; cards.forEach(function(c) { if (!c.isWild) allWilds = false; });
    var forcedRank = null;
    if (allWilds) { 
        forcedRank = prompt("Rank?"); 
        if(!forcedRank) return; 
        forcedRank=forcedRank.toUpperCase().trim(); 
    }
    
    // Determine Target Rank
    // If not forced (wilds), pick the rank of the first natural card
    const targetRank = forcedRank || cards.find(c => !c.isWild).rank;

    // TARGET: Find the specific pile div
    const targetId = "meld-pile-my-" + targetRank;
    let destRect = getRect(targetId);
    
    // If pile doesn't exist yet (New Meld), target the container
    if (destRect.width === 0) destRect = getRect('my-melds');

    // FLY CARDS
    const cardWraps = document.querySelectorAll('#my-hand .hand-card-wrap img');
    selectedIndices.forEach(idx => {
        if(cardWraps[idx]) {
            flyCard(cardWraps[idx].getBoundingClientRect(), destRect, cardWraps[idx].src);
        }
    });

    socket.emit('act_meld', { seat: mySeat, indices: selectedIndices, targetRank: forcedRank }); 
    selectedIndices = [];
}

function startStagingMeld() {
    if (selectedIndices.length === 0) return alert("Select cards first.");
    var selectedCards = selectedIndices.map(function(idx) { return activeData.hand[idx]; });
    var natural = selectedCards.find(function(c) { return !c.isWild; });
    var targetRank = natural ? natural.rank : prompt("Rank?");
    if (!targetRank) return;
    stagedMelds.push({ indices: [].concat(selectedIndices), rank: targetRank, cards: selectedCards });
    isStaging = true; selectedIndices = []; renderStagingArea();
}
function handlePickupClick() {
    var myTeamMelds = (mySeat % 2 === 0) ? activeData.team1Melds : activeData.team2Melds;
    if (Object.keys(myTeamMelds).length > 0) socket.emit('act_pickup', { seat: mySeat });
    else handlePickupAttempt();
}
function handlePickupAttempt() {
    if (!activeData || !activeData.topDiscard) return alert("Discard pile is empty.");
    
    // 1. Validation: Must select at least 2 cards
    if (selectedIndices.length < 2) return alert("Select at least 2 natural cards to pick up.");

    var topCard = activeData.topDiscard;
    var selectedCards = selectedIndices.map(function(i) { return activeData.hand[i]; });

    // 2. Count Naturals matching the Top Card
    var matchingNaturals = 0;
    var allValid = true;

    selectedCards.forEach(function(c) {
        if (!c.isWild && c.rank === topCard.rank) {
            matchingNaturals++;
        } else if (c.isWild) {
            // Wilds are allowed as "extra" cards, but don't count towards the required pair
        } else {
            // Found a card that is neither a matching natural nor a wild (e.g. a random 5)
            allValid = false;
        }
    });

    if (!allValid) return alert("All selected cards must match the top card (or be Wild).");
    if (matchingNaturals < 2) return alert("You need at least 2 Natural " + topCard.rank + "s to pick up.");

    // 3. Success - Create the Staged Meld
    pickupStaged = true;
    
    // Create the meld object
    stagedMelds.unshift({ 
        indices: [].concat(selectedIndices), // Copy the array
        rank: topCard.rank, 
        cards: selectedCards, 
        isPickupKey: true 
    });

    isStaging = true; 
    selectedIndices = []; 
    renderStagingArea();
}

function renderStagingArea() {
    document.getElementById('staging-panel').style.display = 'block';
    var container = document.getElementById('staged-container'); 
    container.innerHTML = "";
    
    var totalPoints = 0;
    
    // 1. Render Existing Staged Melds
    stagedMelds.forEach(function(meld, index) {
        var grp = document.createElement('div'); 
        grp.className = 'meld-group';
        grp.setAttribute('onclick', 'addToStagedMeld(' + index + ')');
        grp.style.cursor = 'pointer';
        grp.style.border = '1px dashed rgba(241, 196, 15, 0.5)';
        grp.style.padding = '5px';
        grp.style.borderRadius = '6px';
        grp.style.minWidth = '60px';
        grp.title = "Click to add selected cards to this meld";

        var meldPts = meld.cards.reduce(function(sum, c) { return sum + c.value; }, 0);
        if (meld.isPickupKey) { 
            meldPts += getCardValue(meld.rank); 
            totalPoints += getCardValue(meld.rank); 
        }
        totalPoints += meldPts;
        
        var html = "<span class='meld-label'>" + meld.rank + " (" + meldPts + ")</span><div class='meld-container' style='flex-direction:row;'>"; 
        meld.cards.forEach(function(c) { 
            html += '<img src="' + getCardImage(c) + '" style="width:30px; height:45px; margin-right:2px;">'; 
        });
        html += "</div>"; 
        grp.innerHTML = html; 
        container.appendChild(grp);
    });

    // 2. NEW: "Add New Meld" Button
    // This creates a distinct box that says "NEW MELD +"
    var newMeldBtn = document.createElement('div');
    newMeldBtn.className = 'meld-group';
    newMeldBtn.style.border = '2px dashed #bdc3c7';
    newMeldBtn.style.borderRadius = '6px';
    newMeldBtn.style.cursor = 'pointer';
    newMeldBtn.style.minWidth = '60px';
    newMeldBtn.style.display = 'flex';
    newMeldBtn.style.alignItems = 'center';
    newMeldBtn.style.justifyContent = 'center';
    newMeldBtn.style.opacity = '0.7';
    newMeldBtn.innerHTML = "<div style='font-size:24px; color:#bdc3c7; font-weight:bold;'>+</div><div style='font-size:10px; color:#bdc3c7;'>NEW</div>";
    newMeldBtn.onclick = function() { addNewStagedMeld(); }; // Calls new function
    container.appendChild(newMeldBtn);

    // 3. Score Calculation (Unchanged)
    var req = getOpeningReq((mySeat % 2 === 0) ? activeData.cumulativeScores.team1 : activeData.cumulativeScores.team2);
    document.getElementById('staged-pts').innerText = totalPoints; 
    document.getElementById('req-pts').innerText = req;
    
    var btn = document.getElementById('btn-confirm-open');
    if (totalPoints >= req) { 
        btn.style.opacity = "1"; 
        btn.disabled = false; 
    } else { 
        btn.style.opacity = "0.5"; 
        btn.disabled = true; 
    }
}
function addNewStagedMeld() {
    if (selectedIndices.length === 0) return alert("Select cards for the new meld first.");
    
    // Reuse existing logic from startStagingMeld, but force it into the array
    var selectedCards = selectedIndices.map(function(idx) { return activeData.hand[idx]; });
    
    // Validation
    var natural = selectedCards.find(function(c) { return !c.isWild; });
    var targetRank = natural ? natural.rank : prompt("Rank for these Wilds?");
    if (!targetRank) return;
    targetRank = targetRank.toUpperCase().trim();

    // Basic check
    if (selectedCards.length < 3) return alert("A new meld must have at least 3 cards.");

    // Add to array
    stagedMelds.push({ 
        indices: [].concat(selectedIndices), 
        rank: targetRank, 
        cards: selectedCards 
    });

    selectedIndices = [];
    renderHand(activeData.hand); // Clear selection visuals
    renderStagingArea();
}

function sendOpening() { socket.emit('act_open_game', { seat: mySeat, melds: stagedMelds, pickup: pickupStaged }); cancelOpening(); }
function cancelOpening() { stagedMelds = []; isStaging = false; pickupStaged = false; document.getElementById('staging-panel').style.display = 'none'; renderHand(activeData.hand); }
function startNextRound() { socket.emit('act_next_round'); }

function getCardImage(card) {
    if (card.rank === "Joker") return "cards/JokerRed.png"; 
    return "cards/" + card.rank + card.suit.charAt(0) + ".png";
}
function getCardValue(rank) {
    if (rank === "Joker") return 50; if (rank === "2" || rank === "A") return 20; if (["8","9","10","J","Q","K"].includes(rank)) return 10; return 5; 
}
function getOpeningReq(score) {
    if (score < 0) return 15; if (score < 1500) return 50; if (score < 3000) return 90; return 120;
}

// --- ANIMATION SYSTEM ---

// 1. Core "Fly" Function


function flyCard(sourceRect, destRect, imageSrc, delay = 0, onComplete = null) {
    // 1. Get Standard Card Size
    // We measure the #draw-area to get the correct size for the current device (mobile vs desktop)
    const refEl = document.getElementById('draw-area');
    const stdW = refEl ? refEl.offsetWidth : 50; 
    const stdH = refEl ? refEl.offsetHeight : 70;

    setTimeout(() => {
        const flyer = document.createElement("img");
        flyer.src = imageSrc;
        flyer.className = "flying-card";
        
        // 2. Position: CENTERED on Source
        // Instead of copying sourceRect width/height (which might be rotated/distorted),
        // we calculate the center point and apply the Standard Size.
        const srcCenterX = sourceRect.left + (sourceRect.width / 2);
        const srcCenterY = sourceRect.top + (sourceRect.height / 2);
        
        flyer.style.width = stdW + "px";
        flyer.style.height = stdH + "px";
        flyer.style.left = (srcCenterX - stdW / 2) + "px";
        flyer.style.top = (srcCenterY - stdH / 2) + "px";
        
        document.body.appendChild(flyer);
        
        // Force reflow
        flyer.getBoundingClientRect(); 

        // 3. Calculate Destination
        // We also target the CENTER of the destination rect for perfect accuracy
        const destCenterX = destRect.left + (destRect.width / 2);
        const destCenterY = destRect.top + (destRect.height / 2);

        const deltaX = destCenterX - srcCenterX;
        const deltaY = destCenterY - srcCenterY;
        
        flyer.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        
        setTimeout(() => {
            flyer.remove();
            if (onComplete) onComplete();
        }, 500);
        
    }, delay);
}

// 2. Helper to get rects safely
function getRect(id) {
    const el = document.getElementById(id);
    return el ? el.getBoundingClientRect() : { top: 0, left: 0, width: 0, height: 0 };
}

function getHandDiv(seatIndex) {
    // Calculate relative position: 0=Me, 1=Left, 2=Partner, 3=Right
    // (This logic matches your existing updateUI mapping)
    const rel = (seatIndex - mySeat + 4) % 4;
    
    if (rel === 0) return document.getElementById('my-hand');
    if (rel === 1) return document.getElementById('hand-left');
    if (rel === 2) return document.getElementById('hand-partner');
    if (rel === 3) return document.getElementById('hand-right');
    return null;
}
// --- ADVANCED ANIMATION SYSTEM ---

function handleServerAnimations(oldData, newData) {
    // 1. SELF DRAW ANIMATION (The "Right Spot" Logic)
    // We compare our old hand to our new hand to find exactly which card was added.
    if (oldData.hand.length < newData.hand.length) {
        // Find the new card(s)
        // We use a simple counter to handle duplicates (e.g. drawing a 2nd King)
        const getCounts = (hand) => {
            const counts = {};
            hand.forEach(c => { const key = c.rank + c.suit; counts[key] = (counts[key] || 0) + 1; });
            return counts;
        };
        
        const oldC = getCounts(oldData.hand);
        const newC = getCounts(newData.hand);
        
        // Identify which cards are new
        const addedCards = [];
        newData.hand.forEach((c, index) => {
            const key = c.rank + c.suit;
            if ((oldC[key] || 0) < (newC[key] || 0)) {
                // This is a new card! We track its index so we know where it sits in the UI.
                addedCards.push({ card: c, index: index });
                // Decrement new count so we don't mark the 2nd copy as new if we already had one
                newC[key]--; 
            }
        });

        // Trigger Animation
        const deckRect = getRect('draw-area');
        addedCards.forEach((item, i) => {
            // Find the DOM element for this specific card index
            // Note: We need to wait for renderHand to run first (which happens in updateUI next)
            // So we delay this slightly.
            setTimeout(() => {
                const myHandImages = document.querySelectorAll('#my-hand .hand-card-wrap img');
                const targetImg = myHandImages[item.index];
                
                if (targetImg) {
                    // 1. Hide the real card initially
                    targetImg.style.opacity = '0';
                    
                    // 2. Fly the FACE UP card from deck to this slot
                    const destRect = targetImg.getBoundingClientRect();
                    flyCard(deckRect, destRect, getCardImage(item.card), i * 100, () => {
                        targetImg.style.opacity = '1'; // Reveal
                    });
                }
            }, 50); // 50ms wait for React-like render to finish
        });
    }

    // 2. OPPONENT DRAW ANIMATION
    for (let seat = 0; seat < 4; seat++) {
        if (seat === mySeat) continue; 
        const diff = newData.handSizes[seat] - oldData.handSizes[seat];
        // If hand grew and it wasn't a pickup (pile didn't shrink significantly)
        const pileSame = (newData.deckSize < oldData.deckSize); 
        
        if (diff > 0 && pileSame) {
            const handDiv = getHandDiv(seat);
            if (handDiv) {
                const deckRect = getRect('draw-area');
                const handRect = handDiv.getBoundingClientRect();
                for(let i=0; i<diff; i++) {
                    flyCard(deckRect, handRect, "cards/BackRed.png", i * 100);
                }
            }
        }
    }

    // 3. MELD ANIMATIONS (Self & Opponent)
    // We check both teams
    checkMeldGrowth(oldData.team1Melds, newData.team1Melds, oldData.currentPlayer, 0);
    checkMeldGrowth(oldData.team2Melds, newData.team2Melds, oldData.currentPlayer, 1);
}

function checkMeldGrowth(oldMelds, newMelds, actorSeat, teamId) {
    if (actorSeat === -1) return;

    // 1. Calculate which specific cards were added to which ranks
    // Ex: { "K": [CardObj, CardObj], "5": [CardObj] }
    const changes = {};

    // Check every rank in the new melds
    for (let rank in newMelds) {
        const oldLen = (oldMelds[rank] || []).length;
        const newPile = newMelds[rank];
        
        if (newPile.length > oldLen) {
            // Grab the specific cards that were added (from the end of the array)
            const addedCount = newPile.length - oldLen;
            const addedCards = newPile.slice(-addedCount);
            changes[rank] = addedCards;
        }
    }

    // 2. Animate them
    for (let rank in changes) {
        const cards = changes[rank];
        const amITeam1 = (mySeat === 0 || mySeat === 2);
        
        // Determine Target ID (My side or Enemy side)
        // If I am Team 1 (TeamId=0) -> My Melds.
        // If I am Team 2 (TeamId=1) -> My Melds.
        // Otherwise Enemy.
        const isMyTeam = (amITeam1 && teamId === 0) || (!amITeam1 && teamId === 1);
        const suffix = isMyTeam ? "my" : "enemy";
        const targetId = "meld-pile-" + suffix + "-" + rank;
        
        // Fallback: If the pile is new, the ID might not exist yet until updateUI runs.
        // We target the main container as a backup.
        let destRect = getRect(targetId);
        if (destRect.width === 0) destRect = getRect(isMyTeam ? 'my-melds' : 'enemy-melds');

        // Determine Source
        let sourceRect;
        if (actorSeat === mySeat) {
            // I am melding. The cards come from my hand.
            // (We already animated this locally in 'handleStandardMeld', so strictly we could skip.
            // BUT, if we want to ensure it looks correct on sync, we can animate.
            // However, usually we skip 'mySeat' here to avoid double animation.)
            continue; 
        } else {
            // Opponent melding. Source is their hand div.
            const handDiv = getHandDiv(actorSeat);
            sourceRect = handDiv ? handDiv.getBoundingClientRect() : getRect('draw-area');
        }

        // FLY THE REAL FACES
        cards.forEach((card, i) => {
            flyCard(sourceRect, destRect, getCardImage(card), i * 100);
        });
    }
}