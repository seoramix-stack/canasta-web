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

    const isDesktop = window.innerWidth > 800;
    const visibleStrip = isDesktop ? 22 : 18; 
    const cardHeight = isDesktop ? 105 : 70;
    const vertMargin = visibleStrip - cardHeight; 

    if (red3sArray && red3sArray.length > 0) {
        groupsToRender.push({ type: 'red3', label: '', cards: red3sArray });
    }

    if (meldsObj) {
        const rankPriority = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3"];
        const sortedRanks = Object.keys(meldsObj).sort((a, b) => { 
            return rankPriority.indexOf(a) - rankPriority.indexOf(b); 
        });
        
        sortedRanks.forEach(rank => { 
            groupsToRender.push({ 
                type: 'meld', 
                rank: rank, 
                label: meldsObj[rank].length, 
                cards: meldsObj[rank] 
            }); 
        });
    }

    const safeWidth = container.clientWidth || window.innerWidth;
    const containerWidth = safeWidth - 10; 
    const groupWidth = isDesktop ? 75 : 50;
    const totalGroups = groupsToRender.length; 
    let horizMargin = 5; 

    if (totalGroups > 1) {
         const calculated = ((containerWidth - groupWidth) / (totalGroups - 1)) - groupWidth;
         horizMargin = Math.min(10, Math.max(-15, calculated));
    }

    groupsToRender.forEach((groupData, gIdx) => {
        const groupDiv = document.createElement("div");
        groupDiv.className = "meld-group";
        const teamSuffix = (elementId === "my-melds") ? "my" : "enemy";
        groupDiv.id = `meld-pile-${teamSuffix}-${groupData.rank}`;
        
        groupDiv.style.position = "relative";
        groupDiv.style.zIndex = gIdx; 
        
        if (gIdx < totalGroups - 1) {
            groupDiv.style.marginRight = `${horizMargin}px`;
        }

        if (elementId === "my-melds" && groupData.type === 'meld') {
            groupDiv.setAttribute("onclick", `handleMeldClick(event, '${groupData.rank}')`);
            groupDiv.style.cursor = "pointer";
        }
        
        let html = `<span class='meld-label'>${groupData.label}</span>`;
        html += `<div class='meld-container' style='display:flex; flex-direction:column; align-items:center;'>`;
        
        const pile = groupData.cards;
        const isClosed = (groupData.type !== 'red3' && pile.length >= 7);

        if (isClosed) {
            const isNatural = !pile.some(c => c.isWild);
            let topCard = pile[0]; 
            if (isNatural) {
                topCard = pile.find(c => c.suit === 'Hearts' || c.suit === 'Diamonds') || pile[0];
            } else {
                topCard = pile.find(c => !c.isWild && (c.suit === 'Clubs' || c.suit === 'Spades')) || pile[0];
            }
            
            const badgeColor = isNatural ? "#d63031" : "#2d3436";
            const badgeText = isNatural ? "NAT" : "MIX";

            html += `
                <div style="position:relative;">
                    <img src="${getCardImage(topCard)}" class="card-img meld-card" style="box-shadow:2px 2px 0 #555; border:1px solid #000;">
                    <div style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-30deg); background:${badgeColor}; color:white; font-size:8px; padding:1px 3px; border:1px solid white;">
                        ${badgeText}
                    </div>
                </div>`;
        } else {
            let activeMargin = vertMargin;
            if (pile.length > 5) activeMargin -= 5; 

            pile.forEach((c, cIdx) => { 
                const marginTop = (cIdx > 0) ? `margin-top:${activeMargin}px;` : "";
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

function showScoreModal(round, match) {
    document.getElementById('score-modal').style.display = 'flex';
    // ... (Your existing Score Modal logic)
}