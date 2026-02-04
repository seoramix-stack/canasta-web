// ui.js
import { state } from './state.js';
import { getCardImage } from './animations.js';
import { addTapListener } from './utils.js';
// --- HELPERS ---
export function navTo(screenId) {
    document.querySelectorAll('.app-screen').forEach(el => el.classList.remove('active-screen'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active-screen');
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
    if (!document.getElementById('game-ui')) return;

    // Ready Modal Logic
    const readyModal = document.getElementById('ready-modal');
    if (data.currentPlayer === -1 && data.phase !== 'game_over') {
        if (readyModal) {
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
        if (readyModal) readyModal.style.display = 'none';
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
                if (el) el.style.display = 'none';
            };
            hide('hud-left');
            hide('hud-right');

            // Show Top HUD
            const topHud = document.getElementById('hud-partner');
            if (topHud) topHud.style.opacity = '1';
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
        renderOtherHand("hand-left", data.handBacks ? data.handBacks[(s + 1) % 4] : [], 'vert');
        renderOtherHand("hand-right", data.handBacks ? data.handBacks[(s + 3) % 4] : [], 'vert');

        if (data.names) {
            document.getElementById('name-me').innerText = data.names[s];
            document.getElementById('name-partner').innerText = data.names[(s + 2) % 4];
            document.getElementById('name-left').innerText = data.names[(s + 1) % 4];
            document.getElementById('name-right').innerText = data.names[(s + 3) % 4];

            ['hud-left', 'hud-right', 'hud-partner'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    el.style.display = 'flex';
                    el.style.opacity = '1';
                }
            });
        }

        // 4P Lights
        const lightMap = [
            { id: 'light-me', seatIndex: s },
            { id: 'light-left', seatIndex: (s + 1) % 4 },
            { id: 'light-partner', seatIndex: (s + 2) % 4 },
            { id: 'light-right', seatIndex: (s + 3) % 4 }
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

// --- INTERACTION HELPER ---
function attachMeldInteraction(element, rank) {
    if (!rank) return;

    // Store rank for retrieval during touch events
    element.dataset.rank = rank;

    // 1. DESKTOP / SIMPLE CLICK
    addTapListener(element, (e) => {
        if (state.selectedIndices.length > 0) {
            e.stopPropagation();
            window.handleMeldClick(e, rank);
        }
    });

    // 2. MOBILE TOUCH & DRAG
    element.addEventListener('touchstart', (e) => {
        if (state.selectedIndices.length === 0) return;

        // Prevent scrolling while trying to select a pile
        e.preventDefault();

        // Highlight this element immediately
        element.classList.add('meld-target-highlight');
        state.touchTarget = element; // Track globally in state (or module var)
    });

    element.addEventListener('touchmove', (e) => {
        if (state.selectedIndices.length === 0) return;
        e.preventDefault();

        const touch = e.touches[0];

        // Find the element currently under the finger
        const elUnderFinger = document.elementFromPoint(touch.clientX, touch.clientY);
        if (!elUnderFinger) return;

        // Look for a parent that is a meld target (has data-rank)
        const meldTarget = elUnderFinger.closest('[data-rank]');

        // If we moved to a NEW valid target
        if (meldTarget && meldTarget !== state.touchTarget) {
            // Un-highlight previous
            if (state.touchTarget) state.touchTarget.classList.remove('meld-target-highlight');

            // Highlight new
            meldTarget.classList.add('meld-target-highlight');
            state.touchTarget = meldTarget;
        }
        // If we drifted off any valid target
        else if (!meldTarget && state.touchTarget) {
            state.touchTarget.classList.remove('meld-target-highlight');
            state.touchTarget = null;
        }
    });

    element.addEventListener('touchend', (e) => {
        if (state.selectedIndices.length === 0) return;

        // If we ended on a valid target, execute the meld
        if (state.touchTarget) {
            state.touchTarget.classList.remove('meld-target-highlight');
            const targetRank = state.touchTarget.dataset.rank;

            if (targetRank) {
                window.handleMeldClick(e, targetRank);
            }
        }
        state.touchTarget = null;
    });
}

function renderTable(elementId, meldsObj, red3sArray) {
    const container = document.getElementById(elementId);
    if (!container) return;
    if (state.meldAnimationActive) return;
    container.innerHTML = "";

    // --- 1. SETUP DIMENSIONS & LAYOUT MODE ---
    const isDesktop = window.innerWidth > 800;
    const cardWidth = isDesktop ? 75 : 50;
    const cardHeight = isDesktop ? 105 : 70;
    const boxHeight = container.clientHeight || 150;

    // --- 2. PREPARE DATA ---
    const rankPriority = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3"];
    const openMelds = [];
    const closedMelds = [];

    if (meldsObj) {
        const sortedRanks = Object.keys(meldsObj).sort((a, b) =>
            rankPriority.indexOf(a) - rankPriority.indexOf(b)
        );
        sortedRanks.forEach(rank => {
            const pile = meldsObj[rank];
            if (pile.length >= 7) {
                closedMelds.push({ rank: rank, cards: pile });
            } else {
                openMelds.push({ rank: rank, cards: pile });
            }
        });
    }

    const hasRed3s = (red3sArray && red3sArray.length > 0);
    const suffix = (elementId === 'my-melds') ? 'my' : 'enemy';

    // Helpers
    const getVerticalOffset = (itemCount) => {
        const defaultStep = isDesktop ? 45 : 25;
        const availableH = isDesktop ? 195 : (container.clientHeight || 150);
        const neededH = (itemCount * defaultStep) + cardHeight;
        if (neededH > availableH && itemCount > 1) {
            return Math.max(20, (availableH - cardHeight) / itemCount);
        }
        return defaultStep;
    };

    const createStackContainer = (specialId = null) => {
        const div = document.createElement("div");
        div.className = "meld-group";
        if (specialId) div.id = specialId;
        div.style.position = "relative";
        div.style.minWidth = "var(--card-w)";
        div.style.zIndex = "1";
        return div;
    };

    // --- 3. MOBILE VS DESKTOP RENDERING ---

    if (!isDesktop) {
        // === MOBILE LAYOUT (2 Columns) ===
        container.style.display = "grid";
        container.style.gridTemplateColumns = "50px 1fr"; // Fixed Left Col, Flex Right Col
        container.style.gap = "1px";
        container.style.paddingLeft = "34px";
        container.style.paddingRight = "34px";
        container.style.overflowX = "hidden";
        container.style.alignItems = "start";

        // LEFT COL: Red 3s & Canastas
        const leftCol = document.createElement("div");
        leftCol.style.display = "flex";
        leftCol.style.flexDirection = "column"; // Vertical Stack
        leftCol.style.gap = "0px"; // Space between piles vertically
        leftCol.style.alignItems = "center";
        leftCol.style.minWidth = "55px";

        // RIGHT COL: Open Melds
        const rightCol = document.createElement("div");
        rightCol.style.display = "flex";
        rightCol.style.flexDirection = "row"; // Horizontal Flow
        rightCol.style.alignItems = "flex-start";
        rightCol.style.height = "100%";

        // --- POPULATE LEFT COLUMN ---
        // 1. Calculate how many distinct groups are in this column
        const red3Count = hasRed3s ? 1 : 0;
        const canastaCount = closedMelds.length;
        const totalGroups = red3Count + canastaCount;

        // 2. Calculate Dynamic Squeeze Margin
        // Default overlap is -45px (tight cascade).
        // If groups won't fit, we squeeze them harder.
        let cascadeMargin = -45;

        if (totalGroups > 1) {
            // Available vertical space for the cascade spine
            // boxHeight is usually ~160px on mobile
            const availableSpine = boxHeight - cardHeight;

            // If stacking them with -45px margin exceeds space, calculate new margin
            // Formula: (Total Items - 1) * (CardHeight + Margin) = AvailableSpace
            const neededHeight = cardHeight + ((totalGroups - 1) * (cardHeight + cascadeMargin));

            if (neededHeight > boxHeight) {
                // Calculate the exact step size needed to fit perfectly
                const stepSize = availableSpine / (totalGroups - 1);
                cascadeMargin = stepSize - cardHeight;
            }
        }
        // A. Red 3s (Top Left)
        if (hasRed3s) {
            const r3Group = { type: 'red3', cards: red3sArray, id: `meld-pile-${suffix}-Red3` };
            const r3El = renderSingleGroup(r3Group, createStackContainer, getVerticalOffset, cardHeight, boxHeight, isDesktop, suffix);
            r3El.style.zIndex = "1";
            leftCol.appendChild(r3El);
        }

        // B. Canastas (Below Red 3s)
        if (closedMelds.length > 0) {
            closedMelds.forEach((mData, idx) => {
                const cGroup = { type: 'canasta', data: [mData], id: `meld-pile-${suffix}-Canasta-${idx}` };
                const rendered = renderSingleGroup(cGroup, createStackContainer, getVerticalOffset, cardHeight, boxHeight, isDesktop, suffix);

                // Apply the calculated dynamic margin
                if (idx > 0 || hasRed3s) {
                    rendered.style.marginTop = `${cascadeMargin}px`;
                }

                rendered.style.zIndex = 10 + idx;
                leftCol.appendChild(rendered);
            });
        }

        const openGroups = openMelds.map(m => ({
            type: 'open', cards: m.cards, rank: m.rank, id: `meld-pile-${suffix}-${m.rank}`
        }));
        // --- POPULATE RIGHT COLUMN (UPDATED SQUEEZE LOGIC) ---
        if (openGroups.length > 0) {
            const sidePlayerReserve = 34;

            const leftColWidth = 51;

            // Available Width = Screen - Left Pad(55) - Right Pad(55) - Red3 Column(60)
            const availableWidth = window.innerWidth - (sidePlayerReserve * 2) - leftColWidth;

            let finalMargin = 5;
            const maxOverlap = -(cardWidth - 25);

            if (openGroups.length > 1) {
                const totalFullWidth = openGroups.length * cardWidth;
                const idealWidth = totalFullWidth + ((openGroups.length - 1) * finalMargin);

                if (idealWidth > availableWidth) {
                    // Now this squeeze calculation will be accurate
                    const stepSize = (availableWidth - cardWidth) / (openGroups.length - 1);
                    finalMargin = Math.max(maxOverlap, stepSize - cardWidth);
                }
            }

            openGroups.forEach((grp, idx) => {
                const rendered = renderSingleGroup(grp, createStackContainer, getVerticalOffset, cardHeight, boxHeight, isDesktop, suffix);
                if (idx < openGroups.length - 1) {
                    rendered.style.marginRight = `${finalMargin}px`;
                }
                rightCol.appendChild(rendered);
            });
        }

        container.appendChild(leftCol);
        container.appendChild(rightCol);

    } else {
        // === DESKTOP LAYOUT (Original Linear Row) ===
        container.style.display = "flex";
        container.style.flexDirection = "row";
        container.style.paddingLeft = "160px";

        // Combine all into one list
        const allGroups = [];
        if (hasRed3s) allGroups.push({ type: 'red3', cards: red3sArray, id: `meld-pile-${suffix}-Red3` });
        if (closedMelds.length > 0) allGroups.push({ type: 'canasta', data: closedMelds, id: `meld-pile-${suffix}-Canasta` });
        openMelds.forEach(m => allGroups.push({ type: 'open', cards: m.cards, rank: m.rank, id: `meld-pile-${suffix}-${m.rank}` }));

        // Desktop Squeeze
        const rawContainerWidth = container.offsetWidth || container.clientWidth;
        const availableWidth = rawContainerWidth - 20;
        let finalMargin = 15;
        const maxOverlap = -(cardWidth - 30);

        if (allGroups.length > 1) {
            const totalFullWidth = allGroups.length * cardWidth;
            const idealWidth = totalFullWidth + ((allGroups.length - 1) * finalMargin);
            if (idealWidth > availableWidth) {
                const stepSize = (availableWidth - cardWidth) / (allGroups.length - 1);
                finalMargin = Math.max(maxOverlap, stepSize - cardWidth);
            }
        }

        allGroups.forEach((grp, idx) => {
            const rendered = renderSingleGroup(grp, createStackContainer, getVerticalOffset, cardHeight, boxHeight, isDesktop, suffix);
            if (idx < allGroups.length - 1) rendered.style.marginRight = `${finalMargin}px`;
            rendered.style.zIndex = 10 + idx;
            container.appendChild(rendered);
        });
    }
}

// --- HELPER TO RENDER A SINGLE GROUP (Extracted to avoid duplication) ---
function renderSingleGroup(group, createStackContainer, getVerticalOffset, cardHeight, boxHeight, isDesktop, suffix) {
    const groupDiv = createStackContainer(group.id);

    // RED 3s
    if (group.type === 'red3') {
        const offset = getVerticalOffset(group.cards.length);
        let top = 0; let z = 1;
        group.cards.forEach(card => {
            const img = document.createElement("img");
            img.src = getCardImage(card);
            img.className = "card-img meld-card";
            img.style.position = "absolute";
            img.style.top = `${top}px`;
            img.style.zIndex = z++;
            img.style.boxShadow = "2px 2px 0 #555";
            groupDiv.appendChild(img);
            top += offset;
        });
        const spacer = document.createElement("div");
        spacer.style.width = "var(--card-w)";
        spacer.style.height = `calc(var(--card-h) + ${top - offset}px)`;
        groupDiv.appendChild(spacer);
    }
    // CANASTAS
    else if (group.type === 'canasta') {
        const pileData = group.data;
        // Note: Mobile might pass single canasta in array, Desktop passes all. Logic handles both.
        const offset = getVerticalOffset(pileData.length);
        let top = 0; let z = 1;

        pileData.forEach(m => {
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
            wrapper.style.top = `${top}px`;
            wrapper.style.zIndex = z++;

            // Re-attach click interaction (defined in previous step)
            if (typeof attachMeldInteraction === 'function') {
                attachMeldInteraction(wrapper, m.rank);
            }

            const badgeColor = isNatural ? "#d63031" : "#2d3436";
            const badgeText = isNatural ? "NAT" : "MIX";

            wrapper.innerHTML = `
                <img src="${getCardImage(topCard)}" class="card-img meld-card" style="box-shadow: 2px 2px 3px rgba(0,0,0,0.4); border:1px solid #000;">
                <div style="position: absolute; top: 4px; right: 4px; background: ${badgeColor}; color: white; font-size: 9px; font-weight: bold; padding: 1px 4px; border: 1px solid rgba(255,255,255,0.8); border-radius: 4px; z-index: 10;">
                    ${badgeText}
                </div>
            `;
            groupDiv.appendChild(wrapper);
            top += offset;
        });
        const spacer = document.createElement("div");
        spacer.style.width = "var(--card-w)";
        spacer.style.height = `calc(var(--card-h) + ${top - offset}px)`;
        groupDiv.appendChild(spacer);
    }
    // OPEN MELDS
    else {
        // Re-attach click interaction
        if (typeof attachMeldInteraction === 'function') {
            attachMeldInteraction(groupDiv, group.rank);
        }

        const totalCards = group.cards.length;
        let activeMargin = isDesktop ? -75 : -50;

        if (totalCards > 1) {
            const stackH = cardHeight + ((totalCards - 1) * (cardHeight + activeMargin));
            if (stackH > boxHeight) {
                activeMargin = ((boxHeight - cardHeight) / (totalCards - 1)) - cardHeight;
            }
        }

        let html = `<div class='meld-container' style="display:flex; flex-direction:column; align-items:center;">`;
        group.cards.forEach((c, cIdx) => {
            const marginTop = (cIdx > 0) ? `margin-top:${activeMargin}px;` : "margin-top:0px;";
            let transformStyle = "";
            if (cIdx === 5) transformStyle = "transform: rotate(45deg);";

            html += `
                <img src="${getCardImage(c)}" 
                     class="card-img meld-card" 
                     style="${marginTop} ${transformStyle} z-index: ${cIdx}; position: relative; box-shadow: 0px -1px 3px rgba(0,0,0,0.3);">
            `;
        });
        html += "</div>";
        groupDiv.innerHTML = html;
    }

    return groupDiv;
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
        const defaultOverlap = -60;

        if (count > 1) {
            const maxVisibleStrip = (availableHeight - cardHeight) / (count - 1);
            let calculatedMargin = maxVisibleStrip - cardHeight;
            dynamicMargin = Math.min(defaultOverlap, calculatedMargin);
        }
    } else {
        if (orientation === 'vert') dynamicMargin = -45; // Mobile: less squeeze to show more card
        else dynamicMargin = -32;
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
    if (!div) return;
    div.innerHTML = "";
    if (!hand || hand.length === 0) return;
    const stagedIndices = new Set();
    if (state.isStaging) {
        state.stagedMelds.forEach(meld => {
            meld.indices.forEach(idx => stagedIndices.add(idx));
        });
    }
    const isDesktop = window.innerWidth > 800;
    const cardHeight = isDesktop ? 105 : 70;
    const groupWidth = isDesktop ? 75 : 50;
    const containerLimit = isDesktop ? 180 : 110;
    const buffer = 5;
    const defaultVisibleStrip = isDesktop ? 40 : 25;

    const groups = [];
    let currentGroup = [];
    hand.forEach((card, index) => {
        if (stagedIndices.has(index)) return;
        if (currentGroup.length === 0) {
            currentGroup.push({ card, index });
        } else {
            // LOGIC CHANGE: 
            // On Desktop, we NEVER group by rank. We treat every card as unique column.
            // On Mobile, we keep grouping by rank (current logic).
            const shouldGroup = !isDesktop && (currentGroup[0].card.rank === card.rank);

            if (shouldGroup) {
                currentGroup.push({ card, index });
            } else {
                groups.push(currentGroup);
                currentGroup = [{ card, index }];
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
        const minOverlap = isDesktop ? -35 : -30;

        // 2. Define Spread Limits (How far apart can they be?)
        // Desktop: Force overlap of -32px (leaving ~43px visible per card) even if there is plenty of space.
        // Mobile: Allow them to spread with a gap (15px) if few cards.
        const maxSpacing = isDesktop ? -32 : 15;

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
            addTapListener(wrapper, () => window.toggleSelect(item.index));
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
    setText('row-base-1', round.team1.basePoints);
    setText('row-red3-1', round.team1.red3Points);
    setText('row-canasta-1', round.team1.canastaBonus);
    setText('row-bonus-1', round.team1.goOutBonus);
    setText('row-deduct-1', round.team1.deductions);
    setText('row-total-1', round.team1.total);
    setText('row-prev-1', prev1);
    setText('row-cumul-1', match.team1);

    // 6. Populate Team 2 Column
    setText('row-base-2', round.team2.basePoints);
    setText('row-red3-2', round.team2.red3Points);
    setText('row-canasta-2', round.team2.canastaBonus);
    setText('row-bonus-2', round.team2.goOutBonus);
    setText('row-deduct-2', round.team2.deductions);
    setText('row-total-2', round.team2.total);
    setText('row-prev-2', prev2);
    setText('row-cumul-2', match.team2);

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
        addTapListener(nextBtn, () => window.startNextRound());
    }
}
// ui.js

export function renderLobbySeats(data, mySeat) {
    // Ensure we are on the lobby screen
    navTo('screen-lobby');

    const container = document.getElementById('lobby-players'); // <--- ADDED THIS LINE
    if (!container) return;

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
        addTapListener(btn, () => window.hostStartGame());
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
            addTapListener(slot, () => window.switchSeat(i));
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
