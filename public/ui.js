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

export function renderDiscardPile(data) {
    const discardDiv = document.getElementById('discard-display');
    if (!discardDiv) return;

    // --- CRITICAL FIX START ---
    // 1. FREEZE STATE CHECK MUST BE FIRST!
    // If we clear innerHTML before this line, the pile will disappear.
    if (state.discardAnimationActive) return;
    // --- CRITICAL FIX END ---

    // 2. NOW it is safe to clear the pile for the new render
    discardDiv.innerHTML = ""; 
    
    if (!data.topDiscard) {
        discardDiv.innerHTML = '<div class="discard-empty-slot"></div>';
        return;
    }

    const isFrozen = !!data.freezingCard;
    
    // Check if the Top Card IS the freezing card (e.g. Wild/Red3 on top)
    const topIsFreezer = isFrozen && 
                         (data.freezingCard.rank === data.topDiscard.rank) && 
                         (data.freezingCard.suit === data.topDiscard.suit);

    if (topIsFreezer) {
        // --- SCENARIO 1: PILE IS FROZEN ON TOP (Wild/Red3 just played) ---
        // We render the Previous Card (Base) + The Wild (Rotated Top)
        
        if (data.previousDiscard) {
            const prevImg = document.createElement("img");
            prevImg.src = getCardImage(data.previousDiscard);
            prevImg.className = "card-img discard-stack-card discard-base-card";
            discardDiv.appendChild(prevImg);
        }

        const topImg = document.createElement("img");
        topImg.src = getCardImage(data.topDiscard);
        topImg.className = "card-img discard-stack-card frozen-rotated-top";
        discardDiv.appendChild(topImg);

    } else {
        // --- SCENARIO 2: NORMAL CARD ON TOP ---
        
        if (isFrozen) {
            // Render the buried Wild/Red3 sticking out underneath
            const freezeImg = document.createElement("img");
            freezeImg.src = getCardImage(data.freezingCard);
            freezeImg.className = "card-img discard-stack-card frozen-rotated-under";
            discardDiv.appendChild(freezeImg);
        }

        const topImg = document.createElement("img");
        topImg.src = getCardImage(data.topDiscard);
        topImg.className = "card-img discard-stack-card";
        // Ensure normal top card is above buried freezer
        topImg.style.zIndex = "10"; 
        discardDiv.appendChild(topImg);
    }
}


export function updateUI(data) {
    state.activeData = data;
    
    // Safety check
    if(!document.getElementById('game-ui')) return;

    // Ready Modal Logic
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

    // --- RENDER MELDS (Top = Enemy, Bottom = Me) ---
    // In 2P, Team 2 is the Enemy, so they go to "enemy-melds" (Top), which is correct.
    renderTable("enemy-melds", (s % 2 === 0) ? data.team2Melds : data.team1Melds, (s % 2 === 0) ? data.team2Red3s : data.team1Red3s);
    renderTable("my-melds", (s % 2 === 0) ? data.team1Melds : data.team2Melds, (s % 2 === 0) ? data.team1Red3s : data.team2Red3s);
    
    // --- SEATING LOGIC UPDATE (2P vs 4P) ---
    const is2P = (state.currentPlayerCount === 2);
    
    if (is2P) {
        // 2-PLAYER MODE: Opponent sits at Top (Partner Zone)
        const oppSeat = (s === 0) ? 1 : 0; // If I am 0, Opponent is 1

        renderOtherHand("hand-partner", data.handSizes[oppSeat], 'horiz'); // Top
        renderOtherHand("hand-left", 0, 'vert');   // Empty
        renderOtherHand("hand-right", 0, 'vert');  // Empty

        // Update Names & HUD Visibility
        if (data.names) {
            document.getElementById('name-me').innerText = data.names[s] || "";
            document.getElementById('name-partner').innerText = data.names[oppSeat] || ""; // Opponent Name
            
            // Hide Side HUDs
            const hide = (id) => { if(document.getElementById(id)) document.getElementById(id).style.opacity = '0'; };
            hide('hud-left');
            hide('hud-right');
            
            // Show Top HUD
            const topHud = document.getElementById('hud-partner');
            if(topHud) topHud.style.opacity = '1';
        }

        // Active Turn Light
        const myLight = document.getElementById('light-me');
        const oppLight = document.getElementById('light-partner');

        if (myLight) myLight.classList.toggle('active', data.currentPlayer === s);
        if (oppLight) oppLight.classList.toggle('active', data.currentPlayer === oppSeat);

    } else {
        // 4-PLAYER MODE (Standard)
        renderOtherHand("hand-partner", data.handSizes[(s + 2) % 4], 'horiz');
        renderOtherHand("hand-left", data.handSizes[(s + 1) % 4], 'vert');
        renderOtherHand("hand-right", data.handSizes[(s + 3) % 4], 'vert');

        if (data.names) {
            document.getElementById('name-me').innerText = data.names[s];
            document.getElementById('name-partner').innerText = data.names[(s + 2) % 4];
            document.getElementById('name-left').innerText = data.names[(s + 1) % 4];
            document.getElementById('name-right').innerText = data.names[(s + 3) % 4];
            
            // Show All HUDs
            ['hud-left', 'hud-right', 'hud-partner'].forEach(id => {
                if(document.getElementById(id)) document.getElementById(id).style.opacity = '1';
            });
        }
        
        // 4P Lights
        const lightMap = [
            { id: 'light-me',      seatIndex: s },
            { id: 'light-left',    seatIndex: (s + 1) % 4 },
            { id: 'light-partner', seatIndex: (s + 2) % 4 },
            { id: 'light-right',   seatIndex: (s + 3) % 4 }
        ];
        lightMap.forEach(m => {
            const el = document.getElementById(m.id);
            if (el) el.classList.toggle('active', m.seatIndex === data.currentPlayer);
        });
    }

    // Text updates
    document.getElementById('live-s1').innerText = data.cumulativeScores.team1;
    document.getElementById('live-s2').innerText = data.cumulativeScores.team2;
    if (data.deckSize !== undefined) document.getElementById('deck-count').innerText = data.deckSize;
    
    // Labels
    const amITeam1 = (state.mySeat === 0 || state.mySeat === 2);
    const lbl1 = document.getElementById('lbl-s1');
    const lbl2 = document.getElementById('lbl-s2');
    if (lbl1 && lbl2) {
        lbl1.innerText = amITeam1 ? "MY TEAM" : "OPPONENTS";
        lbl2.innerText = amITeam1 ? "OPPONENTS" : "MY TEAM";
    }

    state.currentTurnSeat = data.currentPlayer;
    state.gameStarted = true;
}

function renderTable(elementId, meldsObj, red3sArray) {
    const container = document.getElementById(elementId);
    if (!container) return;
    if (state.meldAnimationActive) return;
    container.innerHTML = "";

    // 1. Sort & Separate Data
    const rankPriority = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3"];
    const openMelds = [];
    const closedMelds = [];

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
    
    // --- 2. RENDER THE "BONUS STACK" (Red 3s + Canastas) ---
    // This sits on the left. We calculate its width to subtract from available space.
    const hasRed3s = (red3sArray && red3sArray.length > 0);
    const hasCanastas = (closedMelds.length > 0);
    let stackWidth = 0;

    if (hasRed3s || hasCanastas) {
        const stackDiv = document.createElement("div");
        stackDiv.className = "meld-group";
        
        // Layout: Relative container
        stackDiv.style.position = "relative";
        // Give the stack a fixed margin to separate it from open melds
        stackDiv.style.marginRight = isDesktop ? "30px" : "15px"; 
        stackDiv.style.minWidth = "var(--card-w)"; 
        
        // Track width used by this stack (Card Width + Margin)
        stackWidth = groupWidth + (isDesktop ? 30 : 15);

        let zIndex = 1;
        let topOffset = 0;
        const offsetStep = isDesktop ? 30 : 25;
        const red3Overlap = 15;

        // A. Render Red 3s
        if (hasRed3s) {
            red3sArray.forEach((card, idx) => {
                const r3Img = document.createElement("img");
                r3Img.src = getCardImage(card);
                r3Img.className = "card-img meld-card";
                r3Img.style.position = "absolute";
                r3Img.style.top = `${idx * red3Overlap}px`;
                r3Img.style.left = "0";
                r3Img.style.zIndex = zIndex++;
                r3Img.style.boxShadow = "2px 2px 0 #555";
                stackDiv.appendChild(r3Img);
                if (idx === red3sArray.length - 1) topOffset = (idx * red3Overlap) + offsetStep;
            });
        }

        // B. Render Canastas
        closedMelds.forEach(m => {
            const pile = m.cards;
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
            
            const badgeColor = isNatural ? "#d63031" : "#2d3436";
            const badgeText = isNatural ? "NAT" : "MIX";
            
            cWrapper.innerHTML = `
                <img src="${getCardImage(topCard)}" class="card-img meld-card" style="box-shadow: 2px 2px 3px rgba(0,0,0,0.4); border:1px solid #000;">
                <div style="position: absolute; top: 4px; right: 4px; background: ${badgeColor}; color: white; font-size: 9px; font-weight: bold; padding: 1px 4px; border: 1px solid rgba(255,255,255,0.8); border-radius: 4px; z-index: 10; white-space: nowrap;">
                    ${badgeText}
                </div>
            `;
            stackDiv.appendChild(cWrapper);
            topOffset += offsetStep;
        });

        const spacer = document.createElement("div");
        spacer.style.width = "var(--card-w)";
        spacer.style.height = `calc(var(--card-h) + ${Math.max(0, topOffset - offsetStep)}px)`;
        stackDiv.appendChild(spacer);
        container.appendChild(stackDiv);
    }

    // --- 3. RENDER OPEN MELDS (With Squeeze Logic) ---
    if (openMelds.length === 0) return;

    // A. Calculate Available Space
    const safeWidth = container.clientWidth || (window.innerWidth * 0.4); // Approx width of table zone
    const availableWidth = safeWidth - stackWidth; // Remove space taken by Canastas
    
    // B. Calculate Margin needed to fit all cards
    // Formula: TotalWidth = (NumCards * CardWidth) + ((NumCards - 1) * Margin)
    // We solve for Margin: Margin = (AvailableWidth - (NumCards * CardWidth)) / (NumCards - 1)
    
    let horizMargin = isDesktop ? 20 : 5; // Default comfortable margin

    if (openMelds.length > 1) {
        const totalCardWidth = openMelds.length * groupWidth;
        const spacingSlots = openMelds.length - 1;
        
        // Check if we overflow
        if (totalCardWidth + (spacingSlots * horizMargin) > availableWidth) {
            // Squeeze calculation
            const neededSqueeze = (availableWidth - totalCardWidth) / spacingSlots;
            
            // Cap the squeeze (don't overlap more than 60% of card)
            const minOverlap = isDesktop ? -50 : -30; 
            horizMargin = Math.max(minOverlap, neededSqueeze);
        }
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
        groupDiv.style.zIndex = gIdx + 10;
        
        // APPLY THE CALCULATED MARGIN
        if (gIdx < openMelds.length - 1) {
            groupDiv.style.marginRight = `${horizMargin}px`;
        }

        if (elementId === "my-melds") {
            groupDiv.setAttribute("onclick", `handleMeldClick(event, '${groupData.rank}')`);
            groupDiv.style.cursor = "pointer";
        }

        let html = `<div class='meld-container' style='display:flex; flex-direction:column; align-items:center;'>`;
        
        let activeMargin = vertMargin;
        if (groupData.cards.length > 5) activeMargin -= 5; 

        groupData.cards.forEach((c, cIdx) => { 
            const marginTop = (cIdx > 0) ? `margin-top:${activeMargin}px;` : "";
            let transformStyle = "transform: none;";
            if (groupData.cards.length === 6 && cIdx === 5) {
                transformStyle = "transform: rotate(-45deg) translateX(10px) translateY(-5px);";
            }
            html += `<img src="${getCardImage(c)}" class="card-img meld-card" style="${marginTop} margin-left: 0; ${transformStyle} box-shadow: 1px 1px 2px rgba(0,0,0,0.3);">`; 
        });

        html += "</div>"; 
        groupDiv.innerHTML = html; 
        container.appendChild(groupDiv);
    });
}

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

    // Calculate overlap to squeeze cards if they exceed container width
    if (totalGroups > 1) {
        const calculated = ((containerWidth - groupWidth) / (totalGroups - 1)) - groupWidth;
        
        // 1. Define Squeeze Limits (How tight can they get?)
        const minOverlap = isDesktop ? -60 : -30; 

        // 2. Define Spread Limits (How far apart can they be?)
        // Desktop: Force overlap of -40px (leaving ~35px visible per card) even if there is plenty of space.
        // Mobile: Allow them to spread with a gap (15px) if few cards.
        const maxSpacing = isDesktop ? -40 : 15; 
        
        groupOverlap = Math.min(maxSpacing, Math.max(minOverlap, calculated));
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