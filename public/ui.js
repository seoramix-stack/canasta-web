// ui.js
import { state } from './state.js';
import { getCardImage } from './animations.js';
import { addTapListener, calculateStepSize } from './utils.js';

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

    if (state.discardAnimationActive) return;

    discardDiv.innerHTML = ""; 
    
    if (!data.topDiscard) {
        discardDiv.innerHTML = '<div class="discard-empty-slot"></div>';
        return;
    }

    const isFrozen = !!data.freezingCard;
    const topIsFreezer = isFrozen && 
                         (data.freezingCard.rank === data.topDiscard.rank) && 
                         (data.freezingCard.suit === data.topDiscard.suit);

    if (topIsFreezer) {
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
        if (isFrozen) {
            const freezeImg = document.createElement("img");
            freezeImg.src = getCardImage(data.freezingCard);
            freezeImg.className = "card-img discard-stack-card frozen-rotated-under";
            discardDiv.appendChild(freezeImg);
        }
        const topImg = document.createElement("img");
        topImg.src = getCardImage(data.topDiscard);
        topImg.className = "card-img discard-stack-card";
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
        lobbyList.innerHTML = ""; 
        data.names.forEach(name => {
            const row = document.createElement('div');
            row.style.cssText = "padding: 8px; border-bottom: 1px solid #555; font-size: 16px; color: white;";
            if (name === "Waiting...") {
                row.style.color = "#7f8c8d";
                row.style.fontStyle = "italic";
            }
            row.innerText = name;
            lobbyList.appendChild(row);
        });
    }

    if(!document.getElementById('game-ui')) return;

    const readyModal = document.getElementById('ready-modal');
    if (data.currentPlayer === -1 && data.phase !== 'game_over') {
        if(readyModal) {
            readyModal.style.display = 'flex';
            const step1 = document.getElementById('ready-step-1');
            if (step1) step1.style.display = 'block';
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

    if (data.phase === 'game_over' && data.scores) {
        showScoreModal(data.scores, data.cumulativeScores, data.names);
    } else {
        document.getElementById('score-modal').style.display = 'none';
    }

    renderDiscardPile(data);
    renderHand(data.hand);
    
    const s = state.mySeat;

    renderTable("enemy-melds", (s % 2 === 0) ? data.team2Melds : data.team1Melds, (s % 2 === 0) ? data.team2Red3s : data.team1Red3s);
    renderTable("my-melds", (s % 2 === 0) ? data.team1Melds : data.team2Melds, (s % 2 === 0) ? data.team1Red3s : data.team2Red3s);
    
    const drawImg = document.querySelector('#draw-area .card-img');
    if (drawImg && data.nextDeckColor) {
        drawImg.src = `cards/Back${data.nextDeckColor}.png`;
    }

    const is2P = (state.currentPlayerCount === 2);
    
    if (is2P) {
        const oppSeat = (s === 0) ? 1 : 0; 
        renderOtherHand("hand-partner", data.handBacks ? data.handBacks[oppSeat] : [], 'horiz'); 
        renderOtherHand("hand-left", [], 'vert');   
        renderOtherHand("hand-right", [], 'vert');  

        if (data.names) {
            document.getElementById('name-me').innerText = data.names[s] || "";
            document.getElementById('name-partner').innerText = data.names[oppSeat] || ""; 
            
            const hide = (id) => { 
                const el = document.getElementById(id);
                if(el) el.style.display = 'none'; 
            };
            hide('hud-left');
            hide('hud-right');
            
            const topHud = document.getElementById('hud-partner');
            if(topHud) topHud.style.opacity = '1';
        }

        const myLight = document.getElementById('light-me');
        const oppLight = document.getElementById('light-partner');

        if (myLight) myLight.classList.toggle('active', data.currentPlayer === s);
        if (oppLight) oppLight.classList.toggle('active', data.currentPlayer === oppSeat);

    } else {
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

    document.getElementById('live-s1').innerText = data.cumulativeScores.team1;
    document.getElementById('live-s2').innerText = data.cumulativeScores.team2;
    if (data.deckSize !== undefined) document.getElementById('deck-count').innerText = data.deckSize;
    
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
    element.dataset.rank = rank; 

    addTapListener(element, (e) => {
        if (state.selectedIndices.length > 0) {
            e.stopPropagation();
            window.handleMeldClick(e, rank);
        }
    });

    element.addEventListener('touchstart', (e) => {
        if (state.selectedIndices.length === 0) return;
        e.preventDefault(); 
        element.classList.add('meld-target-highlight');
        state.touchTarget = element; 
    });

    element.addEventListener('touchmove', (e) => {
        if (state.selectedIndices.length === 0) return;
        e.preventDefault();
        const touch = e.touches[0];
        const elUnderFinger = document.elementFromPoint(touch.clientX, touch.clientY);
        if (!elUnderFinger) return;
        const meldTarget = elUnderFinger.closest('[data-rank]');

        if (meldTarget && meldTarget !== state.touchTarget) {
            if (state.touchTarget) state.touchTarget.classList.remove('meld-target-highlight');
            meldTarget.classList.add('meld-target-highlight');
            state.touchTarget = meldTarget;
        } else if (!meldTarget && state.touchTarget) {
            state.touchTarget.classList.remove('meld-target-highlight');
            state.touchTarget = null;
        }
    });

    element.addEventListener('touchend', (e) => {
        if (state.selectedIndices.length === 0) return;
        if (state.touchTarget) {
            state.touchTarget.classList.remove('meld-target-highlight');
            const targetRank = state.touchTarget.dataset.rank;
            if (targetRank) window.handleMeldClick(e, targetRank);
        }
        state.touchTarget = null;
    });
}

function renderTable(elementId, meldsObj, red3sArray) {
    const container = document.getElementById(elementId);
    if (!container) return;
    if (state.meldAnimationActive) return;
    container.innerHTML = "";

    const isDesktop = window.innerWidth > 800;
    const cardHeight = isDesktop ? 105 : 70; 
    const cardWidth = isDesktop ? 75 : 50;
    const boxHeight = container.clientHeight || 150;
    
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

    // --- OFFSET CALCULATORS ---
    const getStandardOffset = (itemCount) => {
        const defaultStep = isDesktop ? 30 : 25;
        const availableH = isDesktop ? 270 : boxHeight;
        const minStep = isDesktop ? 20 : 12;
        return calculateStepSize(availableH, cardHeight, itemCount, defaultStep, minStep);
    };

    const getCompactOffset = (itemCount) => {
        if (isDesktop) return getStandardOffset(itemCount);
        // Mobile Left Column Squeeze: pretend we have less height to force stacking
        const availableH = boxHeight * 0.7; 
        return calculateStepSize(availableH, cardHeight, itemCount, 15, 10);
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

    if (!isDesktop) {
        // === MOBILE LAYOUT (2 Columns) ===
        container.style.display = "grid";
        container.style.gridTemplateColumns = "50px 1fr"; 
        container.style.gap = "1px";
        container.style.paddingLeft = "34px"; 
        container.style.paddingRight = "34px";
        container.style.overflowX = "hidden";
        container.style.alignItems = "start";

        const leftCol = document.createElement("div");
        leftCol.style.display = "flex";
        leftCol.style.flexDirection = "column"; 
        leftCol.style.alignItems = "center";
        leftCol.style.minWidth = "55px";

        const rightCol = document.createElement("div");
        rightCol.style.display = "flex";
        rightCol.style.flexDirection = "row"; 
        rightCol.style.alignItems = "flex-start";
        
        // Calculate Cascade for Left Column
        const totalGroups = (hasRed3s ? 1 : 0) + closedMelds.length;
        let cascadeMargin = -45; 
        if (totalGroups > 1) {
            const avail = boxHeight - cardHeight;
            // Use helper to calculate the cascading stack step
            const step = calculateStepSize(avail, cardHeight, totalGroups, cardHeight - 45, 10);
            cascadeMargin = step - cardHeight;
        }

        if (hasRed3s) {
            const r3Group = { type: 'red3', cards: red3sArray, id: `meld-pile-${suffix}-Red3` };
            // Use getCompactOffset
            const r3El = renderSingleGroup(r3Group, createStackContainer, getCompactOffset, cardHeight);
            r3El.style.zIndex = "1"; 
            leftCol.appendChild(r3El);
        }

        if (closedMelds.length > 0) {
            closedMelds.forEach((mData, idx) => {
                const cGroup = { type: 'canasta', data: [mData], id: `meld-pile-${suffix}-Canasta-${idx}` };
                // Use getCompactOffset
                const rendered = renderSingleGroup(cGroup, createStackContainer, getCompactOffset, cardHeight);
                if (idx > 0 || hasRed3s) rendered.style.marginTop = `${cascadeMargin}px`;
                rendered.style.zIndex = 10 + idx; 
                leftCol.appendChild(rendered);
            });
        }

        const openGroups = openMelds.map(m => ({
            type: 'open', cards: m.cards, rank: m.rank, id: `meld-pile-${suffix}-${m.rank}`
        }));
        
        if (openGroups.length > 0) {
            // Calculate Horizontal Squeeze
            const sidePadding = 34;
            const leftColWidth = 50; 
            const availW = (window.innerWidth - (sidePadding * 2) - leftColWidth) - 10;
            
            const defaultGap = 5; 
            const minStep = 15; // Allows heavy overlap
            const idealStep = cardWidth + defaultGap;

            const hStep = calculateStepSize(availW, cardWidth, openGroups.length, idealStep, minStep);
            const hMargin = hStep - cardWidth;

            openGroups.forEach((grp, idx) => {
                const rendered = renderSingleGroup(grp, createStackContainer, getStandardOffset, cardHeight);
                if (idx < openGroups.length - 1) rendered.style.marginRight = `${hMargin}px`;
                rightCol.appendChild(rendered);
            });
        }

        container.appendChild(leftCol);
        container.appendChild(rightCol);

    } else {
        // === DESKTOP LAYOUT ===
        container.style.display = "flex";
        container.style.flexDirection = "row";
        container.style.paddingLeft = "160px";
        
        const allGroups = [];
        if (hasRed3s) allGroups.push({ type: 'red3', cards: red3sArray, id: `meld-pile-${suffix}-Red3` });
        if (closedMelds.length > 0) allGroups.push({ type: 'canasta', data: closedMelds, id: `meld-pile-${suffix}-Canasta` });
        openMelds.forEach(m => allGroups.push({ type: 'open', cards: m.cards, rank: m.rank, id: `meld-pile-${suffix}-${m.rank}` }));

        allGroups.forEach((grp, idx) => {
            const rendered = renderSingleGroup(grp, createStackContainer, getStandardOffset, cardHeight);
            if (idx < allGroups.length - 1) rendered.style.marginRight = "15px";
            rendered.style.zIndex = 10 + idx;
            container.appendChild(rendered);
        });
    }
}

// SIMPLIFIED SINGLE GROUP RENDERER
function renderSingleGroup(group, createStackContainer, offsetCalculator, cardHeight) {
    const groupDiv = createStackContainer(group.id);
    
    // RED 3s & CANASTAS
    if (group.type === 'red3' || group.type === 'canasta') {
        const cards = (group.type === 'red3') ? group.cards : group.data; 
        const count = cards.length;
        const offset = offsetCalculator(count);
        let top = 0; let z = 1;

        cards.forEach(item => {
            if (group.type === 'red3') {
                const img = document.createElement("img");
                img.src = getCardImage(item);
                img.className = "card-img meld-card";
                img.style.position = "absolute";
                img.style.top = `${top}px`;
                img.style.zIndex = z++;
                img.style.boxShadow = "2px 2px 0 #555";
                groupDiv.appendChild(img);
            } else {
                // Canasta Logic
                const pile = item.cards;
                const isNatural = !pile.some(c => c.isWild);
                let topCard = pile.find(c => isNatural ? (c.suit==='Hearts'||c.suit==='Diamonds') : (!c.isWild && (c.suit==='Clubs'||c.suit==='Spades'))) || pile[0];

                const wrapper = document.createElement("div");
                wrapper.style.position = "absolute";
                wrapper.style.top = `${top}px`;
                wrapper.style.zIndex = z++;
                
                if (typeof attachMeldInteraction === 'function') attachMeldInteraction(wrapper, item.rank);

                const badgeColor = isNatural ? "#d63031" : "#2d3436";
                const badgeText = isNatural ? "NAT" : "MIX";
                wrapper.innerHTML = `
                    <img src="${getCardImage(topCard)}" class="card-img meld-card" style="box-shadow: 2px 2px 3px rgba(0,0,0,0.4); border:1px solid #000;">
                    <div style="position: absolute; top: 4px; right: 4px; background: ${badgeColor}; color: white; font-size: 9px; font-weight: bold; padding: 1px 4px; border: 1px solid rgba(255,255,255,0.8); border-radius: 4px; z-index: 10;">${badgeText}</div>
                `;
                groupDiv.appendChild(wrapper);
            }
            top += offset;
        });

        const spacer = document.createElement("div");
        spacer.style.width = "var(--card-w)";
        spacer.style.height = `calc(var(--card-h) + ${top - offset}px)`;
        groupDiv.appendChild(spacer);

    } else {
        // OPEN MELDS
        if (typeof attachMeldInteraction === 'function') attachMeldInteraction(groupDiv, group.rank);

        // Calculate active margin for open cards
        const step = offsetCalculator(group.cards.length);
        const activeMargin = step - cardHeight;
        
        let html = `<div class='meld-container' style="display:flex; flex-direction:column; align-items:center;">`;
        group.cards.forEach((c, cIdx) => { 
            const marginTop = (cIdx > 0) ? `margin-top:${activeMargin}px;` : "margin-top:0px;";
            let transformStyle = (cIdx === 5) ? "transform: rotate(45deg);" : "";
            html += `<img src="${getCardImage(c)}" class="card-img meld-card" style="${marginTop} ${transformStyle} z-index: ${cIdx}; position: relative; box-shadow: 0px -1px 3px rgba(0,0,0,0.3);">`; 
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
    if (!backsArray || backsArray.length === 0) return;
    
    const count = backsArray.length;
    const isDesktop = window.innerWidth > 800;
    const cardHeight = isDesktop ? 105 : 70; 

    let dynamicMargin = 0;

    if (orientation === 'vert') {
        const containerH = div.parentElement ? div.parentElement.clientHeight : 400;
        const availH = containerH - 40; 
        const defaultOverlap = isDesktop ? -50 : -55;
        const defaultStep = cardHeight + defaultOverlap;
        
        // Use Helper
        const step = calculateStepSize(availH, cardHeight, count, defaultStep, 15);
        dynamicMargin = step - cardHeight;

    } else {
        const defaultOverlap = -35;
        dynamicMargin = defaultOverlap; 
    }

    for (let i = 0; i < count; i++) {
        const card = document.createElement("div");
        let className = (orientation === 'vert') ? "side-card" : "partner-card";
        const color = backsArray[i] || 'Red'; 
        className += ` card-back-${color}`;
        card.className = className;
        
        if (i > 0) {
            if (orientation === 'vert') card.style.marginTop = `${dynamicMargin}px`;
            else card.style.marginLeft = `${dynamicMargin}px`;
        }
        div.appendChild(card);
    }
}

function renderHand(hand) {
    const div = document.getElementById('my-hand');
    if(!div) return;
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
            currentGroup.push({card, index});
        } else {
            const shouldGroup = !isDesktop && (currentGroup[0].card.rank === card.rank);
            if (shouldGroup) currentGroup.push({card, index});
            else { groups.push(currentGroup); currentGroup = [{card, index}]; }
        }
    });
    if (currentGroup.length > 0) groups.push(currentGroup);

    // --- 1. HORIZONTAL GROUP SQUEEZE ---
    const safeWidth = div.clientWidth || window.innerWidth;
    const containerWidth = safeWidth - 20; 
    const defaultGroupStep = groupWidth + (isDesktop ? -40 : 15);
    const minGroupStep = groupWidth + (isDesktop ? -60 : -30);
    
    // Use Helper
    const groupStep = calculateStepSize(containerWidth, groupWidth, groups.length, defaultGroupStep, minGroupStep);
    const groupOverlap = groupStep - groupWidth;

    groups.forEach((grp, gIndex) => {
        const groupDiv = document.createElement("div");
        groupDiv.className = "hand-group";
        if (gIndex < groups.length - 1) {
            groupDiv.style.marginRight = `${groupOverlap}px`;
        }
        
        const availSpine = containerLimit - cardHeight - buffer;
        const defaultCardStep = defaultVisibleStrip;
        
        // Use Helper for Vertical Stack inside Group
        const cardStep = calculateStepSize(availSpine, cardHeight, grp.length, defaultCardStep, 15);
        const cardMargin = cardStep - cardHeight;
        
        grp.forEach((item, cIdx) => {
            const wrapper = document.createElement("div");
            wrapper.className = "hand-card-wrap";
            wrapper.dataset.index = item.index;

            if (cIdx > 0) wrapper.style.marginTop = `${cardMargin}px`;
            
            if (state.selectedIndices.includes(item.index)) {
                wrapper.classList.add("selected");
            }

            const img = document.createElement("img");
            img.src = getCardImage(item.card);
            wrapper.appendChild(img);
            
            let hasMoved = false;
            let handledByTouchStart = false;

            wrapper.addEventListener('touchstart', (e) => {
                state.isSwiping = true;
                hasMoved = false;
                handledByTouchStart = false;
                if (!state.selectedIndices.includes(item.index)) {
                    state.selectedIndices.push(item.index);
                    wrapper.classList.add('selected');
                    handledByTouchStart = true;
                }
            }, { passive: true });

            wrapper.addEventListener('touchmove', (e) => {
                if (!state.isSwiping) return;
                const touch = e.touches[0];
                const el = document.elementFromPoint(touch.clientX, touch.clientY);
                const cardWrap = el ? el.closest('.hand-card-wrap') : null;

                if (cardWrap) {
                    const index = parseInt(cardWrap.dataset.index);
                    if (!state.selectedIndices.includes(index)) {
                        window.toggleSelect(index);
                    }
                }
            }, { passive: true });

            wrapper.addEventListener('touchend', () => {
                state.isSwiping = false;
            });

            addTapListener(wrapper, () => {
                if (hasMoved) return;
                if (handledByTouchStart) return;
                window.toggleSelect(item.index);
            });

            groupDiv.appendChild(wrapper);
        });
        div.appendChild(groupDiv);
    });
}

function showScoreModal(round, match, names) {
    document.getElementById('score-modal').style.display = 'flex';
    if (!round || !round.team1 || !round.team2 || !match) return;

    const h1 = document.getElementById('header-col-1');
    const h2 = document.getElementById('header-col-2');

    if (names && state.currentPlayerCount === 2) {
        if (h1) h1.innerText = names[0] || "Player 1";
        if (h2) h2.innerText = names[1] || "Player 2";
    } else {
        const amITeam1 = (state.mySeat === 0 || state.mySeat === 2);
        if (h1) h1.innerText = amITeam1 ? "MY TEAM" : "OPPONENTS";
        if (h2) h2.innerText = amITeam1 ? "OPPONENTS" : "MY TEAM";
    }

    const setText = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val;
    };
    const prev1 = match.team1 - round.team1.total;
    const prev2 = match.team2 - round.team2.total;
    
    setText('row-base-1',    round.team1.basePoints);
    setText('row-red3-1',    round.team1.red3Points);
    setText('row-canasta-1', round.team1.canastaBonus);
    setText('row-bonus-1',   round.team1.goOutBonus);
    setText('row-deduct-1',  round.team1.deductions);
    setText('row-total-1',   round.team1.total);
    setText('row-prev-1',    prev1);
    setText('row-cumul-1',   match.team1);

    setText('row-base-2',    round.team2.basePoints);
    setText('row-red3-2',    round.team2.red3Points);
    setText('row-canasta-2', round.team2.canastaBonus);
    setText('row-bonus-2',   round.team2.goOutBonus);
    setText('row-deduct-2',  round.team2.deductions);
    setText('row-total-2',   round.team2.total);
    setText('row-prev-2',    prev2);
    setText('row-cumul-2',   match.team2);

    let nextBtn = document.getElementById('btn-next-round');
    if (!nextBtn) {
        const modal = document.getElementById('score-modal');
        const buttons = modal.querySelectorAll('button');
        buttons.forEach(b => {
            if (b.innerText.includes("NEXT ROUND")) nextBtn = b;
        });
    }

    if (nextBtn) {
        nextBtn.id = "btn-next-round"; 
        nextBtn.innerText = "START NEXT ROUND";
        nextBtn.disabled = false;
        nextBtn.style.opacity = "1";
        nextBtn.style.cursor = "pointer";
        addTapListener(nextBtn, () => window.startNextRound());
    }
}

export function renderLobbySeats(data, mySeat) {
    navTo('screen-lobby');

    const container = document.getElementById('lobby-players'); 
    if (!container) return;

    container.innerHTML = ""; 
    container.style.display = "flex";
    container.style.flexWrap = "wrap";
    container.style.gap = "10px";
    container.style.justifyContent = "center";

    const hostControls = document.getElementById('lobby-host-controls');
    if (mySeat === 0) {
        hostControls.style.display = 'block';
        const btn = hostControls.querySelector('button');
        addTapListener(btn, () => window.hostStartGame());
        btn.innerText = "START MATCH";
    } else {
        hostControls.style.display = 'none';
        document.getElementById('lobby-wait-msg').style.display = 'block';
    }

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