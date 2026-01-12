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
        if(readyModal) readyModal.style.display = 'flex';
    } else {
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
                el.classList.add('active'); 
            } else {
                el.classList.remove('active'); 
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

    // 1. Sort & Separate Data (Open Melds vs Canastas)
    const rankPriority = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3"];
    const openMelds = [];
    const closedMelds = []; // Canastas (7+ cards)

    if (meldsObj) {
        const sortedRanks = Object.keys(meldsObj).sort((a, b) => { 
            return rankPriority.indexOf(a) - rankPriority.indexOf(b); 
        });
        
        sortedRanks.forEach(rank => { 
            const pile = meldsObj[rank];
            if (pile.length >= 7) {
                closedMelds.push({ rank: rank, cards: pile });
            } else {
                openMelds.push({ rank: rank, cards: pile, label: pile.length });
            }
        });
    }

    const isDesktop = window.innerWidth > 800;
    const groupWidth = isDesktop ? 75 : 50;
    const offsetStep = isDesktop ? 30 : 25; // Spacing between Canastas
    const red3Overlap = 15; // Tighter overlap for Red 3s

    // --- 2. RENDER THE "BONUS STACK" (Red 3s + Canastas) ---
    const hasRed3s = (red3sArray && red3sArray.length > 0);
    const hasCanastas = (closedMelds.length > 0);

    if (hasRed3s || hasCanastas) {
        const stackDiv = document.createElement("div");
        stackDiv.className = "meld-group";
        
        // Layout: Relative container to hold absolute stacked cards
        stackDiv.style.position = "relative";
        stackDiv.style.marginRight = "10px"; 
        stackDiv.style.minWidth = "var(--card-w)"; 
        
        let zIndex = 1;
        let topOffset = 0;

        // A. Render Red 3s (Base of the stack - Cascading)
        if (hasRed3s) {
            red3sArray.forEach((card, idx) => {
                const r3Img = document.createElement("img");
                r3Img.src = getCardImage(card);
                r3Img.className = "card-img meld-card";
                r3Img.style.position = "absolute";
                
                // Cascade logic: Shift each 3 down slightly
                const currentPos = idx * red3Overlap;
                r3Img.style.top = `${currentPos}px`;
                r3Img.style.left = "0";
                
                r3Img.style.zIndex = zIndex++;
                r3Img.style.boxShadow = "2px 2px 0 #555";
                stackDiv.appendChild(r3Img);
                
                // Track the bottom of the last Red 3 to start Canastas below it
                if (idx === red3sArray.length - 1) {
                    topOffset = currentPos + offsetStep;
                }
            });
        }

        // B. Render Canastas (Stacked on top)
        closedMelds.forEach(m => {
            const pile = m.cards;
            
            // Determine Top Card
            const isNatural = !pile.some(c => c.isWild);
            let topCard = pile[0]; 
            if (isNatural) {
                topCard = pile.find(c => c.suit === 'Hearts' || c.suit === 'Diamonds') || pile[0];
            } else {
                topCard = pile.find(c => !c.isWild && (c.suit === 'Clubs' || c.suit === 'Spades')) || pile[0];
            }

            const cWrapper = document.createElement("div");
            cWrapper.style.position = "absolute";
            cWrapper.style.top = `${topOffset}px`;
            cWrapper.style.left = "0";
            cWrapper.style.zIndex = zIndex++;
            
            // --- UPDATED BADGE: Right Aligned ---
            const badgeColor = isNatural ? "#d63031" : "#2d3436";
            const badgeText = isNatural ? "NAT" : "MIX";
            
            cWrapper.innerHTML = `
                <img src="${getCardImage(topCard)}" class="card-img meld-card" style="box-shadow: 2px 2px 3px rgba(0,0,0,0.4); border:1px solid #000;">
                <div style="
                    position: absolute; 
                    top: 4px; 
                    right: 4px; /* <--- ALIGNED RIGHT */
                    background: ${badgeColor}; 
                    color: white; 
                    font-size: 9px; 
                    font-weight: bold;
                    padding: 1px 4px; 
                    border: 1px solid rgba(255,255,255,0.8);
                    border-radius: 4px;
                    z-index: 10;
                    white-space: nowrap;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.8);
                ">
                    ${badgeText}
                </div>
            `;
            
            stackDiv.appendChild(cWrapper);
            topOffset += offsetStep;
        });

        // C. Spacer to maintain container height
        const spacer = document.createElement("div");
        spacer.style.width = "var(--card-w)";
        spacer.style.height = `calc(var(--card-h) + ${Math.max(0, topOffset - offsetStep)}px)`;
        stackDiv.appendChild(spacer);

        container.appendChild(stackDiv);
    }

    // --- 3. RENDER OPEN MELDS (Standard Waterfall) ---
    if (openMelds.length === 0) return;

    const safeWidth = container.clientWidth || window.innerWidth;
    const usedWidth = (hasRed3s || hasCanastas) ? (groupWidth + 20) : 0;
    const containerWidth = safeWidth - usedWidth - 10; 
    
    let horizMargin = 5; 

    if (openMelds.length > 1) {
         const calculated = ((containerWidth - groupWidth) / (openMelds.length - 1)) - groupWidth;
         const minVisible = 15; 
         const maxSqueeze = -(groupWidth - minVisible); 
         horizMargin = Math.min(10, Math.max(maxSqueeze, calculated));
    }

    const cardHeight = isDesktop ? 105 : 70;
    const visibleStrip = isDesktop ? 22 : 18;
    const vertMargin = visibleStrip - cardHeight;

    openMelds.forEach((groupData, gIdx) => {
        const groupDiv = document.createElement("div");
        groupDiv.className = "meld-group";
        const teamSuffix = (elementId === "my-melds") ? "my" : "enemy";
        groupDiv.id = `meld-pile-${teamSuffix}-${groupData.rank}`;
        
        groupDiv.style.position = "relative";
        groupDiv.style.zIndex = gIdx + 100;
        
        if (gIdx < openMelds.length - 1) {
            groupDiv.style.marginRight = `${horizMargin}px`;
        }

        if (elementId === "my-melds") {
            groupDiv.setAttribute("onclick", `handleMeldClick(event, '${groupData.rank}')`);
            groupDiv.style.cursor = "pointer";
        }
        let html = "";
        html += `<div class='meld-container' style='display:flex; flex-direction:column; align-items:center;'>`;
        
        let activeMargin = vertMargin;
        if (groupData.cards.length > 5) activeMargin -= 5; 

        groupData.cards.forEach((c, cIdx) => { 
            const marginTop = (cIdx > 0) ? `margin-top:${activeMargin}px;` : "";
            
            // --- ROTATION LOGIC (Now correctly INSIDE the loop) ---
            let transformStyle = "transform: none;";
            
            // Check if this specific pile has 6 cards AND we are drawing the last one (index 5)
            if (groupData.cards.length === 6 && cIdx === 5) {
                transformStyle = "transform: rotate(-45deg) translateX(10px) translateY(-5px);";
            }

            // Apply the transformStyle to the img tag
            html += `<img src="${getCardImage(c)}" class="card-img meld-card" style="${marginTop} margin-left: 0; ${transformStyle} box-shadow: 1px 1px 2px rgba(0,0,0,0.3);">`; 
        });

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

// ui.js

function renderOtherHand(elementId, count, orientation) {
    const div = document.getElementById(elementId);
    if (!div) return;
    div.innerHTML = "";
    if (!count) return;

    // 1. Detect Environment
    const isDesktop = window.innerWidth > 800;
    
    // 2. Define Card Dimensions based on CSS variables/media query
    // Desktop: 105px height, Mobile: 70px height
    const cardHeight = isDesktop ? 105 : 70; 

    // 3. Calculate Overlap (Squeeze) Logic
    let dynamicMargin = 0;

    if (orientation === 'vert' && isDesktop) {
        // Get the parent zone height (the available space)
        // We look at the parent element (#hand-left-zone or #hand-right-zone)
        const containerHeight = div.parentElement ? div.parentElement.clientHeight : 400;
        
        // Safety buffer (padding top/bottom)
        const availableHeight = containerHeight - 40; 

        // Default overlap (if plenty of space)
        const defaultOverlap = -50; 
        
        // Calculate needed overlap to fit all cards
        // Formula: TotalHeight = CardHeight + (Count - 1) * VisibleStrip
        // We solve for VisibleStrip, then Margin = VisibleStrip - CardHeight
        if (count > 1) {
            const maxVisibleStrip = (availableHeight - cardHeight) / (count - 1);
            
            // The margin is the visible strip minus the full card height
            let calculatedMargin = maxVisibleStrip - cardHeight;
            
            // Cap the margin so they don't spread out too much if there are few cards
            // (e.g., don't let them float far apart)
            dynamicMargin = Math.min(defaultOverlap, calculatedMargin);
        }
    } else {
        // Default Logic for Mobile or Horizontal (Partner)
        if (orientation === 'vert') dynamicMargin = -55; // Mobile vertical default
        else dynamicMargin = -35; // Partner horizontal default
    }

    // 4. Render Cards
    for (let i = 0; i < count; i++) {
        const card = document.createElement("div");
        card.className = (orientation === 'vert') ? "side-card" : "partner-card";
        
        if (i > 0) {
            if (orientation === 'vert') {
                card.style.marginTop = `${dynamicMargin}px`;
            } else {
                card.style.marginLeft = `${dynamicMargin}px`;
            }
        }
        div.appendChild(card);
    }
}

// --- MISSING FUNCTION ADDED HERE ---
function renderHand(hand) {
    const div = document.getElementById('my-hand');
    if(!div) return;
    div.innerHTML = "";
    if (!hand || hand.length === 0) return;

    const isDesktop = window.innerWidth > 800;
    const cardHeight = isDesktop ? 105 : 70;
    const groupWidth = isDesktop ? 75 : 50;
    const containerLimit = isDesktop ? 180 : 110; 
    const buffer = 5; 
    const defaultVisibleStrip = isDesktop ? 40 : 25; 

    const groups = [];
    let currentGroup = [];
    hand.forEach((card, index) => {
        if (currentGroup.length === 0) {
            currentGroup.push({card, index});
        } else {
            // LOGIC CHANGE: 
            // On Desktop, we NEVER group by rank. We treat every card as unique column.
            // On Mobile, we keep grouping by rank (current logic).
            const shouldGroup = !isDesktop && (currentGroup[0].card.rank === card.rank);
            
            if (shouldGroup) {
                currentGroup.push({card, index});
            } else { 
                groups.push(currentGroup); 
                currentGroup = [{card, index}]; 
            }
        }
    });
    if (currentGroup.length > 0) groups.push(currentGroup);

    const safeWidth = div.clientWidth || window.innerWidth;
    const containerWidth = safeWidth - 20; 
    const totalGroups = groups.length;
    let groupOverlap = 5; 

    if (totalGroups > 1) {
        const calculated = ((containerWidth - groupWidth) / (totalGroups - 1)) - groupWidth;
        const minOverlap = isDesktop ? -50 : -30;
        groupOverlap = Math.min(15, Math.max(minOverlap, calculated));
    }

    groups.forEach((grp, gIndex) => {
        const groupDiv = document.createElement("div");
        groupDiv.className = "hand-group";
        if (gIndex < totalGroups - 1) {
            groupDiv.style.marginRight = `${groupOverlap}px`;
        }
        
        const availableSpine = containerLimit - cardHeight - buffer;
        let stepSize = defaultVisibleStrip;

        if (grp.length > 1) {
            const neededSpine = (grp.length - 1) * defaultVisibleStrip;
            if (neededSpine > availableSpine) {
                stepSize = availableSpine / (grp.length - 1);
            }
        }

        const negMargin = -(cardHeight - stepSize);
        
        grp.forEach((item, cIdx) => {
            const wrapper = document.createElement("div");
            wrapper.className = "hand-card-wrap";
            if (cIdx > 0) wrapper.style.marginTop = `${negMargin}px`;
            
            if (state.selectedIndices.includes(item.index)) {
                wrapper.classList.add("selected");
            }
            const img = document.createElement("img");
            img.src = getCardImage(item.card);
            wrapper.onclick = function() { window.toggleSelect(item.index); };
            wrapper.appendChild(img);
            groupDiv.appendChild(wrapper);
        });
        div.appendChild(groupDiv);
    });
}

// ui.js - Replace the existing incomplete showScoreModal function with this:

function showScoreModal(round, match) {
    // 1. Show the modal
    document.getElementById('score-modal').style.display = 'flex';

    // 2. Safety check: Ensure data exists before trying to read it
    if (!round || !round.team1 || !round.team2 || !match) return;

    // 3. Update Match Score Header (Cumulative)
    // We add the current round score to the previous cumulative score for the "Match Score" display
    // Note: The server might have already added them depending on timing, but usually 
    // 'match' is the score BEFORE this round, or we can just display what the server sent.
    // Based on your server logic, 'match' is cumulative. 
    // Let's display the TOTAL (Existing Cumulative + This Round) or just the raw data.
    // Ideally, pass the UPDATED totals. For now, we display what is passed.
    document.getElementById('match-s1').innerText = match.team1;
    document.getElementById('match-s2').innerText = match.team2;

    // 4. Helper to set text by ID
    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    };

    // 5. Populate Team 1 Column
    setText('row-base-1',    round.team1.basePoints);
    setText('row-red3-1',    round.team1.red3Points);
    setText('row-canasta-1', round.team1.canastaBonus);
    setText('row-bonus-1',   round.team1.goOutBonus);
    setText('row-deduct-1',  round.team1.deductions);
    setText('row-total-1',   round.team1.total);

    // 6. Populate Team 2 Column
    setText('row-base-2',    round.team2.basePoints);
    setText('row-red3-2',    round.team2.red3Points);
    setText('row-canasta-2', round.team2.canastaBonus);
    setText('row-bonus-2',   round.team2.goOutBonus);
    setText('row-deduct-2',  round.team2.deductions);
    setText('row-total-2',   round.team2.total);
}