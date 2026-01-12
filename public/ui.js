// ui.js
import { state } from './state.js';
import { getCardImage } from './animations.js';

// --- HELPERS ---
export function navTo(screenId) {
    document.querySelectorAll('.app-screen').forEach(el => el.classList.remove('active-screen'));
    const target = document.getElementById(screenId);
    if(target) target.classList.add('active-screen');
}

export function toggleGameMenu() {
    const el = document.getElementById('game-menu-overlay');
    el.style.display = (el.style.display === 'none') ? 'flex' : 'none';
}

// --- RENDER FUNCTIONS ---
export { renderHand };

export function updateUI(data) {
    state.activeData = data;
    
    // Safety check for critical elements
    if(!document.getElementById('game-ui')) return;

    const readyModal = document.getElementById('ready-modal');
    if (data.currentPlayer === -1 && data.phase !== 'game_over') {
        // Game hasn't started -> SHOW Ready Modal
        if(readyModal) readyModal.style.display = 'flex';
    } else {
        // Game is running -> HIDE Ready Modal
        if(readyModal) readyModal.style.display = 'none';
    }
    document.getElementById('game-ui').style.display = 'block';

    // Scores & Round Over
    if (data.phase === 'game_over' && data.scores) {
        showScoreModal(data.scores, data.cumulativeScores);
    } else {
        document.getElementById('score-modal').style.display = 'none';
    }

    renderDiscardPile(data);
    renderHand(data.hand);
    
    const s = state.mySeat;
    renderTable("enemy-melds", (s % 2 === 0) ? data.team2Melds : data.team1Melds, (s % 2 === 0) ? data.team2Red3s : data.team1Red3s);
    renderTable("my-melds", (s % 2 === 0) ? data.team1Melds : data.team2Melds, (s % 2 === 0) ? data.team1Red3s : data.team2Red3s);
    
    renderOtherHand("hand-partner", data.handSizes[(s + 2) % 4], 'horiz');
    renderOtherHand("hand-left", data.handSizes[(s + 1) % 4], 'vert');
    renderOtherHand("hand-right", data.handSizes[(s + 3) % 4], 'vert');

    // Update Text info
    document.getElementById('live-s1').innerText = data.cumulativeScores.team1;
    document.getElementById('live-s2').innerText = data.cumulativeScores.team2;
    if (data.deckSize !== undefined) document.getElementById('deck-count').innerText = data.deckSize;

    

    // Names
    if (data.names) {
        document.getElementById('name-me').innerText = data.names[s];
        document.getElementById('name-partner').innerText = data.names[(s + 2) % 4];
        document.getElementById('name-left').innerText = data.names[(s + 1) % 4];
        document.getElementById('name-right').innerText = data.names[(s + 3) % 4];
    }
    const lightMap = [
        { id: 'light-me',      seatIndex: s },
        { id: 'light-left',    seatIndex: (s + 1) % 4 },
        { id: 'light-partner', seatIndex: (s + 2) % 4 },
        { id: 'light-right',   seatIndex: (s + 3) % 4 }
    ];

    lightMap.forEach(mapping => {
        const el = document.getElementById(mapping.id);
        if (el) {
            if (mapping.seatIndex === data.currentPlayer) {
                el.classList.add('active'); // Turns GREEN
            } else {
                el.classList.remove('active'); // Turns RED
            }
        }
    });
    // Turn Logic
    state.currentTurnSeat = data.currentPlayer;
    state.gameStarted = true;
}

function renderTable(elementId, meldsObj, red3sArray) {
    const container = document.getElementById(elementId);
    if (!container) return;
    
    container.innerHTML = "";
    const groupsToRender = [];

    // Detect Desktop
    const isDesktop = window.innerWidth > 800;
    
    // Config matches your CSS variables implicitly
    const visibleStrip = isDesktop ? 22 : 18; 
    const cardHeight = isDesktop ? 105 : 70;
    const vertMargin = visibleStrip - cardHeight; 

    // 1. Add Red 3s (Leftmost)
    if (red3sArray && red3sArray.length > 0) {
        groupsToRender.push({ type: 'red3', label: '', cards: red3sArray });
    }

    // 2. Add Melds (Sorted A -> 3)
    if (meldsObj) {
        // "3" is at the end so Black 3s sort to the right
        const rankPriority = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3"];
        
        const sortedRanks = Object.keys(meldsObj).sort((a, b) => { 
            return rankPriority.indexOf(a) - rankPriority.indexOf(b); 
        });
        
        sortedRanks.forEach(rank => { 
            // Use .length for the label count
            groupsToRender.push({ 
                type: 'meld', 
                rank: rank, 
                label: meldsObj[rank].length, 
                cards: meldsObj[rank] 
            }); 
        });
    }

    // 3. Layout Calculations (Horizontal Spacing)
    const safeWidth = container.clientWidth || window.innerWidth;
    const containerWidth = safeWidth - 10; 
    const groupWidth = isDesktop ? 75 : 50;
    const totalGroups = groupsToRender.length; 
    let horizMargin = 5; 

    if (totalGroups > 1) {
         const calculated = ((containerWidth - groupWidth) / (totalGroups - 1)) - groupWidth;
         // Clamp margin
         horizMargin = Math.min(10, Math.max(-15, calculated));
    }

    // 4. Render Groups
    groupsToRender.forEach((groupData, gIdx) => {
        const groupDiv = document.createElement("div");
        groupDiv.className = "meld-group";
        
        const teamSuffix = (elementId === "my-melds") ? "my" : "enemy";
        groupDiv.id = `meld-pile-${teamSuffix}-${groupData.rank}`;
        
        // Stacking Context: Higher index sits on top of lower index visually if they overlap
        groupDiv.style.position = "relative";
        groupDiv.style.zIndex = gIdx; 
        
        if (gIdx < totalGroups - 1) {
            groupDiv.style.marginRight = `${horizMargin}px`;
        }

        // Click Handler (Only for My Melds)
        if (elementId === "my-melds" && groupData.type === 'meld') {
            // We use onclick attribute to hook into the window-level function defined in client.js
            groupDiv.setAttribute("onclick", `handleMeldClick(event, '${groupData.rank}')`);
            groupDiv.style.cursor = "pointer";
        }
        
        // Build HTML String for speed/simplicity
        let html = `<span class='meld-label'>${groupData.label}</span>`;
        html += `<div class='meld-container' style='display:flex; flex-direction:column; align-items:center;'>`;
        
        const pile = groupData.cards;
        const isClosed = (groupData.type !== 'red3' && pile.length >= 7);

        if (isClosed) {
            // --- CLOSED CANASTA (Stacked) ---
            const isNatural = !pile.some(c => c.isWild);
            
            // Find appropriate top card
            let topCard = pile[0]; 
            if (isNatural) {
                topCard = pile.find(c => c.suit === 'Hearts' || c.suit === 'Diamonds') || pile[0];
            } else {
                topCard = pile.find(c => !c.isWild && (c.suit === 'Clubs' || c.suit === 'Spades')) || pile[0];
            }
            
            const badgeColor = isNatural ? "#d63031" : "#2d3436";
            const badgeText = isNatural ? "NAT" : "MIX";

            // CRITICAL FIX: Added 'card-img' class here
            html += `
                <div style="position:relative;">
                    <img src="${getCardImage(topCard)}" class="card-img meld-card" style="box-shadow:2px 2px 0 #555; border:1px solid #000;">
                    <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg); background:${badgeColor}; color:white; font-size:8px; padding:1px 3px; border:1px solid white;">
                        ${badgeText}
                    </div>
                </div>`;
        } else {
            // --- OPEN MELD (Cascade) ---
            let activeMargin = vertMargin;
            // Squish tighter if pile is getting tall (Visual Polish)
            if (pile.length > 5) activeMargin -= 5; 

            pile.forEach((c, cIdx) => { 
                const marginTop = (cIdx > 0) ? `margin-top:${activeMargin}px;` : "";
                // CRITICAL FIX: Added 'card-img' class here
                html += `<img src="${getCardImage(c)}" class="card-img meld-card" style="${marginTop} margin-left: 0; transform: none; box-shadow: 1px 1px 2px rgba(0,0,0,0.3);">`; 
            });
        }
        
        html += "</div>"; 
        groupDiv.innerHTML = html; 
        container.appendChild(groupDiv);
    });
}

function renderDiscardPile(data) {
    const discardDiv = document.getElementById('discard-display');
    discardDiv.innerHTML = ""; 
    if (!data.topDiscard) {
        discardDiv.innerHTML = '<div style="opacity:0.3; text-align:center; color:#aaa;">EMPTY</div>';
        return;
    }
    const img = document.createElement("img");
    img.src = getCardImage(data.topDiscard);
    img.className = "card-img discard-stack-card"; 
    discardDiv.appendChild(img);
}

function renderOtherHand(elementId, count, orientation) {
    const div = document.getElementById(elementId);
    if (!div) return;
    div.innerHTML = "";
    if (!count) return;
    for (let i = 0; i < count; i++) {
        const card = document.createElement("div");
        card.className = (orientation === 'vert') ? "side-card" : "partner-card";
        // Simple margin logic
        if (i > 0) {
            if (orientation === 'vert') card.style.marginTop = "-35px";
            else card.style.marginLeft = "-35px";
        }
        div.appendChild(card);
    }
}

function renderTable(elementId, meldsObj, red3s) {
    const container = document.getElementById(elementId);
    if(!container) return;
    container.innerHTML = "";
    
    // (Simplified Logic for brevity - paste your full logic here if needed)
    if (meldsObj) {
        Object.keys(meldsObj).forEach(rank => {
            const groupDiv = document.createElement("div");
            groupDiv.className = "meld-group";
            // Click Handler
            if(elementId === "my-melds") {
                groupDiv.onclick = (e) => window.handleMeldClick(e, rank);
            }
            
            meldsObj[rank].forEach((c, idx) => {
                const img = document.createElement("img");
                img.src = getCardImage(c);
                img.className = "meld-card";
                if(idx > 0) img.style.marginTop = "-85px";
                groupDiv.appendChild(img);
            });
            container.appendChild(groupDiv);
        });
    }
}

function showScoreModal(round, match) {
    document.getElementById('score-modal').style.display = 'flex';
    // ... (Your existing Score Modal logic)
}