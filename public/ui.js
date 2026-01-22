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

    if (data.maxPlayers) {
        state.currentPlayerCount = data.maxPlayers;
    }
    const lobbyList = document.getElementById('lobby-players');
    if (lobbyList && data.names) {
        lobbyList.innerHTML = ""; // Clear existing list
        
        data.names.forEach(name => {
            const row = document.createElement('div');
            // Simple styling for the list item
            row.style.cssText = "padding: 8px; border-bottom: 1px solid #555; font-size: 16px; color: white;";
            
            // Dim text if it's still a placeholder
            if (name === "Waiting...") {
                row.style.color = "#7f8c8d";
                row.style.fontStyle = "italic";
            }
            
            row.innerText = name;
            lobbyList.appendChild(row);
        });
    }
    // Safety check
    if(!document.getElementById('game-ui')) return;

    // Ready Modal Logic
    const readyModal = document.getElementById('ready-modal');
    if (data.currentPlayer === -1 && data.phase !== 'game_over') {
        if(readyModal) {
            readyModal.style.display = 'flex';

            // Force the "Start Game" button to be visible
            const step1 = document.getElementById('ready-step-1');
            if (step1) step1.style.display = 'block';

            // Force the "Waiting" spinner to be hidden
            const step2 = document.getElementById('ready-step-2');
            if (step2) step2.style.display = 'none';
        }

        for (let i = 0; i < 4; i++) {
                const el = document.getElementById(`ind-${i}`);
                if (el) {
                    el.style.display = (i < state.currentPlayerCount) ? 'flex' : 'none';
                }
            }
    } else {
        if(readyModal) readyModal.style.display = 'none';
    }
    document.getElementById('game-ui').style.display = 'block';

    // Scores & Round Over
    if (data.phase === 'game_over' && data.scores) {
        // PASS 'data.names' AS THE 3RD ARGUMENT
        showScoreModal(data.scores, data.cumulativeScores, data.names);
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
    
    // --- UPDATE DRAW PILE IMAGE ---
    // Change the deck image to match the actual next card (Red or Blue)
    const drawImg = document.querySelector('#draw-area .card-img');
    if (drawImg && data.nextDeckColor) {
        drawImg.src = `cards/Back${data.nextDeckColor}.png`;
    }

    // --- SEATING LOGIC UPDATE (2P vs 4P) ---
    const is2P = (state.currentPlayerCount === 2);
    
    if (is2P) {
        // 2-PLAYER MODE: Opponent sits at Top (Partner Zone)
        const oppSeat = (s === 0) ? 1 : 0; // If I am 0, Opponent is 1

        // CHANGE: Pass handBacks (Array of colors) instead of handSizes
        renderOtherHand("hand-partner", data.handBacks ? data.handBacks[oppSeat] : [], 'horiz'); 
        renderOtherHand("hand-left", [], 'vert');   // Empty
        renderOtherHand("hand-right", [], 'vert');  // Empty

        // Update Names & HUD Visibility
        if (data.names) {
            document.getElementById('name-me').innerText = data.names[s] || "";
            document.getElementById('name-partner').innerText = data.names[oppSeat] || ""; 
            
            const hide = (id) => { 
                const el = document.getElementById(id);
                if(el) el.style.display = 'none'; 
            };
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
        // CHANGE: Pass handBacks (Array of colors) instead of handSizes
        renderOtherHand("hand-partner", data.handBacks ? data.handBacks[(s + 2) % 4] : [], 'horiz');
        renderOtherHand("hand-left",    data.handBacks ? data.handBacks[(s + 1) % 4] : [], 'vert');
        renderOtherHand("hand-right",   data.handBacks ? data.handBacks[(s + 3) % 4] : [], 'vert');

        if (data.names) {
            document.getElementById('name-me').innerText = data.names[s];
            document.getElementById('name-partner').innerText = data.names[(s + 2) % 4];
            document.getElementById('name-left').innerText = data.names[(s + 1) % 4];
            document.getElementById('name-right').innerText = data.names[(s + 3) % 4];
            
            ['hud-left', 'hud-right', 'hud-partner'].forEach(id => {
                const el = document.getElementById(id);
                if(el) {
                    el.style.display = 'flex';
                    el.style.opacity = '1';
                }
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
    
    // --- 2. RENDER THE "BONUS STACKS" (Red 3s & Canastas) ---
    const hasRed3s = (red3sArray && red3sArray.length > 0);
    const hasCanastas = (closedMelds.length > 0);
    let stackWidth = 0;

    // Helper: Calculates vertical squeeze for a stack
    const getVerticalOffset = (itemCount) => {
        const cardH = isDesktop ? 105 : 70;
        const defaultStep = isDesktop ? 30 : 25;
        // Estimate available height (approx 40% of screen height)
        const availableH = container.clientHeight || (window.innerHeight * 0.4);
        const neededH = (itemCount * defaultStep) + cardH;

        if (neededH > availableH && itemCount > 1) {
            const squeezed = (availableH - cardH) / itemCount;
            return Math.max(10, squeezed); // Don't squeeze tighter than 10px
        }
        return defaultStep;
    };

    // Helper: Creates a generic stack container
    const createStackContainer = () => {
        const div = document.createElement("div");
        div.className = "meld-group";
        div.style.position = "relative";
        div.style.marginRight = isDesktop ? "20px" : "15px";
        div.style.minWidth = "var(--card-w)";
        return div;
    };

    if (isDesktop) {
        // === DESKTOP: SEPARATE STACKS ===
        
        // A. Render Red 3s Column
        if (hasRed3s) {
            const r3Div = createStackContainer();
            const offset = getVerticalOffset(red3sArray.length);
            let top = 0;
            let z = 1;

            red3sArray.forEach(card => {
                const img = document.createElement("img");
                img.src = getCardImage(card);
                img.className = "card-img meld-card";
                img.style.position = "absolute";
                img.style.top = `${top}px`;
                img.style.left = "0";
                img.style.zIndex = z++;
                img.style.boxShadow = "2px 2px 0 #555";
                r3Div.appendChild(img);
                top += offset;
            });

            // Spacer for flexbox layout
            const spacer = document.createElement("div");
            spacer.style.width = "var(--card-w)";
            spacer.style.height = `calc(var(--card-h) + ${top - offset}px)`;
            r3Div.appendChild(spacer);
            
            container.appendChild(r3Div);
            stackWidth += (groupWidth + 20);
        }

        // B. Render Canastas Column
        if (hasCanastas) {
            const cDiv = createStackContainer();
            const offset = getVerticalOffset(closedMelds.length);
            let top = 0;
            let z = 1;

            closedMelds.forEach(m => {
                const pile = m.cards;
                const isNatural = !pile.some(c => c.isWild);
                // Find top card logic
                let topCard = pile[0]; 
                if (isNatural) {
                    topCard = pile.find(c => c.suit === 'Hearts' || c.suit === 'Diamonds') || pile[0];
                } else {
                    topCard = pile.find(c => !c.isWild && (c.suit === 'Clubs' || c.suit === 'Spades')) || pile[0];
                }

                const wrapper = document.createElement("div");
                wrapper.style.position = "absolute";
                wrapper.style.top = `${top}px`;
                wrapper.style.zIndex = z++;
                
                const badgeColor = isNatural ? "#d63031" : "#2d3436";
                const badgeText = isNatural ? "NAT" : "MIX";

                wrapper.innerHTML = `
                    <img src="${getCardImage(topCard)}" class="card-img meld-card" style="box-shadow: 2px 2px 3px rgba(0,0,0,0.4); border:1px solid #000;">
                    <div style="position: absolute; top: 4px; right: 4px; background: ${badgeColor}; color: white; font-size: 9px; font-weight: bold; padding: 1px 4px; border: 1px solid rgba(255,255,255,0.8); border-radius: 4px; z-index: 10;">
                        ${badgeText}
                    </div>
                `;
                cDiv.appendChild(wrapper);
                top += offset;
            });

            const spacer = document.createElement("div");
            spacer.style.width = "var(--card-w)";
            spacer.style.height = `calc(var(--card-h) + ${top - offset}px)`;
            cDiv.appendChild(spacer);

            container.appendChild(cDiv);
            stackWidth += (groupWidth + 20);
        }

    } else {
        // === MOBILE: COMBINED STACK (To save horizontal space) ===
        if (hasRed3s || hasCanastas) {
            const stackDiv = createStackContainer();
            stackWidth = groupWidth + 15;

            const totalItems = (hasRed3s ? red3sArray.length : 0) + closedMelds.length;
            const offsetStep = getVerticalOffset(totalItems);

            let zIndex = 1;
            let topOffset = 0;

            // 1. Red 3s
            if (hasRed3s) {
                red3sArray.forEach(card => {
                    const img = document.createElement("img");
                    img.src = getCardImage(card);
                    img.className = "card-img meld-card";
                    img.style.position = "absolute";
                    img.style.top = `${topOffset}px`;
                    img.style.zIndex = zIndex++;
                    img.style.boxShadow = "2px 2px 0 #555";
                    stackDiv.appendChild(img);
                    topOffset += offsetStep;
                });
                // Small gap between types
                if (hasCanastas) topOffset += (offsetStep * 0.5); 
            }

            // 2. Canastas
            closedMelds.forEach(m => {
                const pile = m.cards;
                const isNatural = !pile.some(c => c.isWild);
                let topCard = pile[0]; 
                if (isNatural) {
                    topCard = pile.find(c => c.suit === 'Hearts' || c.suit === 'Diamonds') || pile[0];
                } else {
                    topCard = pile.find(c => !c.isWild && (c.suit === 'Clubs' || c.suit === 'Spades')) || pile[0];
                }

                const wrapper = document.createElement("div");
                wrapper.style.position = "absolute";
                wrapper.style.top = `${topOffset}px`;
                wrapper.style.zIndex = zIndex++;
                
                const badgeColor = isNatural ? "#d63031" : "#2d3436";
                const badgeText = isNatural ? "NAT" : "MIX";
                
                wrapper.innerHTML = `
                    <img src="${getCardImage(topCard)}" class="card-img meld-card" style="box-shadow: 2px 2px 3px rgba(0,0,0,0.4); border:1px solid #000;">
                    <div style="position: absolute; top: 4px; right: 4px; background: ${badgeColor}; color: white; font-size: 9px; font-weight: bold; padding: 1px 4px; border: 1px solid rgba(255,255,255,0.8); border-radius: 4px; z-index: 10;">
                        ${badgeText}
                    </div>
                `;
                stackDiv.appendChild(wrapper);
                topOffset += offsetStep;
            });

            const spacer = document.createElement("div");
            spacer.style.width = "var(--card-w)";
            spacer.style.height = `calc(var(--card-h) + ${topOffset}px)`;
            stackDiv.appendChild(spacer);
            container.appendChild(stackDiv);
        }
    }

    // --- 3. RENDER OPEN MELDS (With Squeeze Logic) ---
    if (openMelds.length === 0) return;

    // A. Calculate Available Space
    let safeWidth = container.clientWidth;
    if (window.innerWidth <= 800) {
        // Mobile Max = Screen Width - Side Columns (25px + 25px) - Padding (~10px)
        const mobileMax = window.innerWidth - 60; 
        // If container reports it's wider than the screen (overflowing), force it down
        if (!safeWidth || safeWidth > mobileMax) safeWidth = mobileMax;
    } else {
        // Desktop Fallback
        safeWidth = safeWidth || (window.innerWidth * 0.4); 
    }

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

function renderOtherHand(elementId, backsArray, orientation) {
    const div = document.getElementById(elementId);
    if (!div) return;
    div.innerHTML = "";
    
    // Safety check if array is missing
    if (!backsArray || backsArray.length === 0) return;
    
    const count = backsArray.length;

    // 1. Detect Environment
    const isDesktop = window.innerWidth > 800;
    
    // 2. Define Card Dimensions based on CSS variables/media query
    const cardHeight = isDesktop ? 105 : 70; 

    // 3. Calculate Overlap (Squeeze) Logic
    let dynamicMargin = 0;

    if (orientation === 'vert' && isDesktop) {
        const containerHeight = div.parentElement ? div.parentElement.clientHeight : 400;
        const availableHeight = containerHeight - 40; 
        const defaultOverlap = -50; 
        
        if (count > 1) {
            const maxVisibleStrip = (availableHeight - cardHeight) / (count - 1);
            let calculatedMargin = maxVisibleStrip - cardHeight;
            dynamicMargin = Math.min(defaultOverlap, calculatedMargin);
        }
    } else {
        if (orientation === 'vert') dynamicMargin = -55; 
        else dynamicMargin = -35; 
    }

    // 4. Render Cards
    for (let i = 0; i < count; i++) {
        const card = document.createElement("div");
        
        // Base class
        let className = (orientation === 'vert') ? "side-card" : "partner-card";
        
        // CHANGE: Add the specific color class based on the data
        // Expects: "card-back-Red" or "card-back-Blue"
        const color = backsArray[i] || 'Red'; // Default to Red if undefined
        className += ` card-back-${color}`;
        
        card.className = className;
        
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

function showScoreModal(round, match, names) {
    // 1. Show the modal
    document.getElementById('score-modal').style.display = 'flex';

    // 2. Safety check
    if (!round || !round.team1 || !round.team2 || !match) return;

    const h1 = document.getElementById('header-col-1');
    const h2 = document.getElementById('header-col-2');

    // --- HEADER LOGIC (Your Name Fix) ---
    if (names && state.currentPlayerCount === 2) {
        // 2-Player Mode: Show exact Usernames
        if (h1) h1.innerText = names[0] || "Player 1";
        if (h2) h2.innerText = names[1] || "Player 2";
    } else {
        // 4-Player Mode: "MY TEAM" vs "OPPONENTS"
        const amITeam1 = (state.mySeat === 0 || state.mySeat === 2);
        if (h1) h1.innerText = amITeam1 ? "MY TEAM" : "OPPONENTS";
        if (h2) h2.innerText = amITeam1 ? "OPPONENTS" : "MY TEAM";
    }

    // 4. Helper to set text by ID
    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    };
    const prev1 = match.team1 - round.team1.total;
    const prev2 = match.team2 - round.team2.total;
    // 5. Populate Team 1 Column
    setText('row-base-1',    round.team1.basePoints);
    setText('row-red3-1',    round.team1.red3Points);
    setText('row-canasta-1', round.team1.canastaBonus);
    setText('row-bonus-1',   round.team1.goOutBonus);
    setText('row-deduct-1',  round.team1.deductions);
    setText('row-total-1',   round.team1.total);
    setText('row-prev-1',    prev1);
    setText('row-cumul-1',   match.team1);

    // 6. Populate Team 2 Column
    setText('row-base-2',    round.team2.basePoints);
    setText('row-red3-2',    round.team2.red3Points);
    setText('row-canasta-2', round.team2.canastaBonus);
    setText('row-bonus-2',   round.team2.goOutBonus);
    setText('row-deduct-2',  round.team2.deductions);
    setText('row-total-2',   round.team2.total);
    setText('row-prev-2',    prev2);
    setText('row-cumul-2',   match.team2);

    // --- 7. BUTTON RESET LOGIC (The Fix for Stuck Games) ---    
    let nextBtn = document.getElementById('btn-next-round');
    
    // If not found by ID, try to find the existing button in the modal
    if (!nextBtn) {
        const modal = document.getElementById('score-modal');
        const buttons = modal.querySelectorAll('button');
        buttons.forEach(b => {
            if (b.innerText.includes("NEXT ROUND")) nextBtn = b;
        });
    }

    if (nextBtn) {
        // RESET the button state so it's fresh for this new round
        nextBtn.id = "btn-next-round"; // Ensure it has the ID for next time
        nextBtn.innerText = "START NEXT ROUND";
        nextBtn.disabled = false;
        nextBtn.style.opacity = "1";
        nextBtn.style.cursor = "pointer";
        nextBtn.onclick = window.startNextRound;
    }
}
// ui.js

export function renderLobbySeats(data, mySeat) {
    // Ensure we are on the lobby screen
    navTo('screen-lobby');

    const container = document.getElementById('lobby-players');
    container.innerHTML = ""; 
    container.style.display = "flex";
    container.style.flexWrap = "wrap";
    container.style.gap = "10px";
    container.style.justifyContent = "center";

    // Host Controls
    const hostControls = document.getElementById('lobby-host-controls');
    // Simple check: If I am in seat 0, I am host (default logic)
    // Or simpler: The server won't execute the command if I'm not host.
    // Let's just show the button if I am Seat 0 for now.
    if (mySeat === 0) {
        hostControls.style.display = 'block';
        // Rebind the button to the NEW function
        const btn = hostControls.querySelector('button');
        btn.onclick = window.hostStartGame;
        btn.innerText = "START MATCH";
    } else {
        hostControls.style.display = 'none';
        document.getElementById('lobby-wait-msg').style.display = 'block';
    }

    // Render 4 Slots
    for (let i = 0; i < data.maxPlayers; i++) {
        const name = data.names[i];
        const isMe = (i === mySeat);
        const isEmpty = (name === null);

        const slot = document.createElement('div');
        slot.style.cssText = `
            width: 45%; 
            height: 80px; 
            background: ${isEmpty ? 'rgba(255,255,255,0.1)' : '#2c3e50'}; 
            border: 2px solid ${isMe ? '#f1c40f' : '#555'}; 
            border-radius: 8px;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            cursor: ${isEmpty ? 'pointer' : 'default'};
            transition: all 0.2s;
        `;

        // Teams Label
        let teamLabel = (i % 2 === 0) ? "TEAM 1" : "TEAM 2";
        
        if (isEmpty) {
            slot.innerHTML = `<div style="color:#7f8c8d; font-size:12px;">${teamLabel}</div><div style="color:#aaa;">OPEN SEAT</div>`;
            slot.onclick = () => window.switchSeat(i);
            slot.onmouseover = () => slot.style.background = 'rgba(255,255,255,0.2)';
            slot.onmouseout = () => slot.style.background = 'rgba(255,255,255,0.1)';
        } else {
            slot.innerHTML = `
                <div style="color:#f1c40f; font-size:10px; font-weight:bold;">${teamLabel}</div>
                <div style="color:white; font-weight:bold; font-size:16px;">${name} ${isMe ? '(YOU)' : ''}</div>
            `;
        }

        container.appendChild(slot);
    }
}
export function showInactivityWarning(secondsLeft) {
    let warningEl = document.getElementById('inactivity-warning');
    
    if (!warningEl) {
        warningEl = document.createElement('div');
        warningEl.id = 'inactivity-warning';
        document.body.appendChild(warningEl);
    }

    // Now uses clean class names managed by style.css
    warningEl.innerHTML = `
        <div class="warning-icon">⏳</div>
        <div>ARE YOU STILL THERE?</div>
        <div class="warning-countdown">FORFEIT IN: ${secondsLeft}s</div>
        <div class="warning-hint">Move or touch to continue</div>
    `;
    warningEl.style.display = 'block';
}

export function hideInactivityWarning() {
    const el = document.getElementById('inactivity-warning');
    if (el) el.style.display = 'none';
}
