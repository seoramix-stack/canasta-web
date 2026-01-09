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
export function updateUI(data) {
    state.activeData = data;
    
    // Safety check for critical elements
    if(!document.getElementById('game-ui')) return;

    if (data.currentPlayer !== -1) {
        document.getElementById('ready-modal').style.display = 'none';
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

    // Turn Logic
    state.currentTurnSeat = data.currentPlayer;
    state.gameStarted = true;

    // Names
    if (data.names) {
        document.getElementById('name-me').innerText = data.names[s];
        document.getElementById('name-partner').innerText = data.names[(s + 2) % 4];
        document.getElementById('name-left').innerText = data.names[(s + 1) % 4];
        document.getElementById('name-right').innerText = data.names[(s + 3) % 4];
    }
}

function renderHand(hand) {
    const div = document.getElementById('my-hand');
    if(!div) return;
    div.innerHTML = "";
    if (!hand || hand.length === 0) return;

    // Grouping Logic
    const groups = [];
    let currentGroup = [];
    hand.forEach((card, index) => {
        if (currentGroup.length === 0) currentGroup.push({card, index});
        else {
            if (currentGroup[currentGroup.length - 1].card.rank === card.rank) currentGroup.push({card, index});
            else { groups.push(currentGroup); currentGroup = [{card, index}]; }
        }
    });
    if (currentGroup.length > 0) groups.push(currentGroup);

    groups.forEach((grp) => {
        const groupDiv = document.createElement("div");
        groupDiv.className = "hand-group";
        
        grp.forEach((item, cIdx) => {
            const wrapper = document.createElement("div");
            wrapper.className = "hand-card-wrap";
            if (cIdx > 0) wrapper.style.marginTop = "-70px"; // Simplified overlap
            if (state.selectedIndices.includes(item.index)) wrapper.classList.add("selected");
            
            const img = document.createElement("img");
            img.src = getCardImage(item.card);
            wrapper.appendChild(img);
            // NOTE: We call window.toggleSelect because we will attach it globally
            wrapper.onclick = function() { window.toggleSelect(item.index); };
            groupDiv.appendChild(wrapper);
        });
        div.appendChild(groupDiv);
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