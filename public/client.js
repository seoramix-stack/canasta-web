// client.js

import { state, saveSession, logout } from './state.js';
import * as UI from './ui.js';
import * as Anim from './animations.js';

window.switchSeat = (targetSeat) => {
    if (state.socket) state.socket.emit('act_switch_seat', targetSeat);
};

window.hostStartGame = () => {
    if (state.socket) state.socket.emit('act_host_start');
};
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

    // --- PHASE 3 UPDATE: SEND PLAYER COUNT ---
    state.socket.emit('request_join', { 
        mode: mode, 
        difficulty: state.currentBotDiff,
        playerCount: state.currentPlayerCount // <--- SENT HERE
    });
};

window.leaveGame = () => {
    if(state.socket) state.socket.emit('leave_game');
    if(state.timerInterval) clearInterval(state.timerInterval);
    UI.navTo('screen-home');
};

window.confirmLeave = () => {
    UI.toggleGameMenu(); 
    window.leaveGame();
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
        // --- FIX START ---
        // 1. Get the card data so we can animate it
        const idx = state.selectedIndices[0];
        const card = state.activeData.hand[idx];

        // 2. Trigger the optimistic animation immediately
        Anim.animatePlayerDiscard(idx, card, UI.renderDiscardPile);
        // --- FIX END ---

        state.socket.emit('act_discard', { seat: state.mySeat, index: state.selectedIndices[0] });
        state.selectedIndices = [];
    } else {
        // If selecting multiple cards, assume they want to pick up the pile
        handlePickupClick();
    }
};

window.handleMeldClick = (event, targetRank) => {
    event.stopPropagation();
    if(state.selectedIndices.length === 0) return;
    
    // 1. Analyze the cards the player is holding
    const cards = state.selectedIndices.map(i => state.activeData.hand[i]);
    
    // 2. Check for Mismatch (Holding a Natural that doesn't match the pile)
    const isMismatch = cards.some(c => !c.isWild && c.rank !== targetRank);

    if (isMismatch) {
        console.log("Mismatch detected: Redirecting to New Meld logic.");
        // FIX: Attempt to start a new meld, but capture if it actually happened
        const success = meldSelected(); 
        
        // If meldSelected didn't successfully start a flow (returned false), 
        // we MUST clear selection so the user isn't stuck.
        if (!success) {
            state.selectedIndices = [];
            if(state.activeData) UI.renderHand(state.activeData.hand);
        }
    } else {
        // Standard Add-to-Meld Logic
        Anim.animateMeld(state.selectedIndices, targetRank, UI.updateUI);
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
    // Note: We don't change the UI here immediately; 
    // we wait for 'next_round_ack' to ensure server got the message.
};

// --- MELDING LOGIC (RESTORED) ---

// 1. Click Handler for empty space or background to START a meld
window.meldSelected = () => {
    if (!state.activeData) return false;
    if (state.selectedIndices.length === 0) return false;

    const myTeamMelds = (state.mySeat % 2 === 0) ? state.activeData.team1Melds : state.activeData.team2Melds;
    const hasOpened = Object.keys(myTeamMelds).length > 0;

    if (hasOpened) {
        return handleStandardMeld(); // Now returns true/false
    } else {
        // Check opening requirements (Round 2 often requires 90 or 120 pts)
        let totalPts = 0;
        const selectedCards = state.selectedIndices.map(i => state.activeData.hand[i]);
        selectedCards.forEach(c => totalPts += getCardValue(c.rank));

        const teamScore = (state.mySeat % 2 === 0) ? state.activeData.cumulativeScores.team1 : state.activeData.cumulativeScores.team2;
        const req = getOpeningReq(teamScore);

        if (totalPts >= req) {
            return handleStandardMeld();
        } else {
            // Not enough points -> Open Staging Panel
            startStagingMeld();
            return true; // Successfully started staging
        }
    }
};

function handleStandardMeld() {
    const hand = state.activeData.hand;
    const cards = state.selectedIndices.map(i => hand[i]);
    
    let targetRank = null;
    const natural = cards.find(c => !c.isWild);
    
    if (natural) {
        targetRank = natural.rank;
    } else {
        targetRank = prompt("Rank (e.g., A, 7)?");
        if(targetRank) targetRank = targetRank.toUpperCase().trim();
    }

    // FIX: If user cancels the prompt, return FALSE so we can clear selection
    if (!targetRank) {
        state.selectedIndices = [];
        UI.renderHand(hand);
        return false;
    }

    Anim.animateMeld(state.selectedIndices, targetRank, UI.updateUI);

    state.socket.emit('act_meld', { 
        seat: state.mySeat, 
        indices: state.selectedIndices, 
        targetRank: targetRank 
    });
    
    state.selectedIndices = [];
    return true;
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
        
        // 1. Calculate points from cards currently in HAND
        let meldPts = meld.cards.reduce((sum, c) => sum + getCardValue(c.rank), 0); // Use getCardValue helper safely
        
        // 2. If this is the Pickup Meld, add the TOP CARD's value virtually
        if (meld.isPickupKey) { 
            meldPts += getCardValue(meld.rank); 
            // REMOVED: totalPoints += getCardValue(meld.rank); <--- THIS WAS THE BUG (Double Counting)
        }
        
        // 3. Add the final correct meld total to the grand total
        totalPoints += meldPts;
        
        let html = `<span class='meld-label'>${meld.rank} (${meldPts})</span><div style='display:flex;'>`; 
        meld.cards.forEach(c => { 
            html += `<img src="${Anim.getCardImage(c)}" style="width:30px; height:45px; margin-right:2px;">`; 
        });
        
        // Visual indicator for the "Ghost" card being picked up
        if (meld.isPickupKey) {
             html += `<div style="width:30px; height:45px; border:1px dashed #f1c40f; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:10px; color:#f1c40f;">+1</div>`;
        }

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

window.selectPlayerCount = (count, btn) => {
    // 1. Update State
    state.currentPlayerCount = count;
    
    // 2. Visual Feedback
    document.querySelectorAll('.p-count-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
};

window.selectRuleset = (mode, btn) => {
    // mode can be 'standard' (2/2) or 'easy' (1/1)
    state.currentRuleset = mode;
    
    // Visual Feedback
    document.querySelectorAll('.rules-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
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
    state.socket.on('lobby_update', (data) => {
        // This triggers the UI update whenever someone joins or switches seats
        UI.renderLobbySeats(data, state.mySeat);
    });
    state.socket.on('seat_changed', (data) => {
        state.mySeat = data.newSeat;
        // We don't need to call render here because 'lobby_update' usually follows immediately
    });
    state.socket.on('next_round_ack', () => {
        // Change the button on the Scoreboard to show we are waiting
        const btn = document.getElementById('btn-next-round');
        if (btn) {
            btn.innerText = "WAITING FOR OPPONENTS...";
            btn.disabled = true;
            btn.style.opacity = "0.7";
            btn.style.cursor = "default";
        }
    });
    state.socket.on('ask_request', (data) => {
    // "Partner, may I go out?"
    document.getElementById('modal-partner-ask').style.display = 'flex';
});

state.socket.on('ask_result', (data) => {
    // Show toast/alert to everyone
    // data.decision is true (YES) or false (NO)
    const msg = data.decision ? "PARTNER SAID: YES ✅" : "PARTNER SAID: NO ❌";
    
    // Simple toast notification
    const toast = document.createElement('div');
    toast.style.cssText = "position:absolute; top:20%; left:50%; transform:translateX(-50%); background:rgba(0,0,0,0.8); color:white; padding:15px 30px; border-radius:30px; font-size:20px; z-index:4000; border:2px solid #f1c40f;";
    toast.innerText = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
});

state.socket.on('penalty_notification', (data) => {
    const el = document.getElementById('modal-penalty');
    document.getElementById('penalty-msg').innerText = data.message;
    el.style.display = 'flex';
    // Hide after 3s automatically
    setTimeout(() => el.style.display = 'none', 3000);
});
    state.socket.on('connect', () => console.log("Connected"));
    state.socket.on('ready_status', (data) => {
        // data.readySeats is an array of seat numbers who clicked start (e.g., [0, 2])
        if (data.readySeats) {
            // Loop through all 4 possible seats
            for (let i = 0; i < 4; i++) {
                const el = document.getElementById(`ind-${i}`);
                if (el) {
                    // --- FIX START ---
                    // 1. Hide indicators that don't exist in this game mode
                    // (We use state.currentPlayerCount which holds 2 or 4)
                    if (i >= state.currentPlayerCount) {
                        el.style.display = 'none';
                        continue; 
                    } else {
                        el.style.display = 'flex'; // Reset to flex if re-using modal
                    }
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
        UI.navTo('screen-queue');
        const el = document.getElementById('queue-msg');
        
        // Support old format (just count) or new format (count + needed)
        const needed = data.needed || 4; 
        
        if (el) el.innerText = `${data.count} / ${needed} Players Found`;
    });

    state.socket.on('deal_hand', (data) => {
        state.mySeat = data.seat;
        UI.navTo('screen-game');
        document.getElementById('status').style.display = 'none';
        
        // Render UI first
        UI.updateUI(data);
        // If scores are 0-0, reset timer. Otherwise, keep existing time.
        const isNewMatch = (data.cumulativeScores.team1 === 0 && data.cumulativeScores.team2 === 0);
        startTimerSystem(isNewMatch);

        // Then Animate
        if (data.hand.length > 0) {
            const deckRect = document.getElementById('draw-area').getBoundingClientRect();
            // Simple deal animation
            Anim.flyCard(deckRect, deckRect, "cards/BackRed.png"); 
        }
    });

    state.socket.on('update_game', (data) => {
    // 1. Define the full update callback
    const performFullUpdate = () => UI.updateUI(data);

    if (state.activeData) {
        // 2. Pass the FULL update function to animations
        Anim.handleServerAnimations(state.activeData, data, performFullUpdate);
    }
    
    // 3. Perform the initial update (unless locked by animation flags)
    UI.updateUI(data);
});
    window.requestRematch = () => {
    const btn = document.getElementById('btn-victory-start');
    if(btn) {
        btn.innerText = "WAITING FOR OTHERS...";
        btn.disabled = true;
        btn.style.opacity = "0.7";
        btn.style.cursor = "default";
    }
    // Send signal to server
    state.socket.emit('act_request_rematch');
};

    state.socket.on('match_over', (data) => {
        setTimeout(() => {
            state.discardAnimationActive = false; // Force unlock
            state.meldAnimationActive = false;    // Force unlock
            document.querySelectorAll('.flying-card').forEach(el => el.remove());

            // 1. Force close the Score Modal so it doesn't block the Victory screen
            const scoreModal = document.getElementById('score-modal');
            if (scoreModal) scoreModal.style.display = 'none';

            // 2. Populate Victory Data
            const vicTitle = document.getElementById('vic-title');
            const vicSub = document.getElementById('vic-sub');
            const finalS1 = document.getElementById('final-s1');
            const finalS2 = document.getElementById('final-s2');
            
            const name1 = (data.names && data.names[0]) ? data.names[0] : "TEAM 1";
            const name2 = (data.names && data.names[1]) ? data.names[1] : "TEAM 2";

            // Update the score table labels
            const lbl1 = document.getElementById('vic-name-1');
            const lbl2 = document.getElementById('vic-name-2');
            
            if (state.currentPlayerCount === 2) {
                // 2-Player Mode: Show exact usernames
                if (lbl1) lbl1.innerText = name1;
                if (lbl2) lbl2.innerText = name2;
            } else {
                // 4-Player Mode: Use "MY TEAM" / "OPPONENTS"
                const amITeam1 = (state.mySeat === 0 || state.mySeat === 2);
                
                // lbl1 corresponds to Team 1's score row
                if (lbl1) lbl1.innerText = amITeam1 ? "MY TEAM" : "OPPONENTS";
                
                // lbl2 corresponds to Team 2's score row
                if (lbl2) lbl2.innerText = amITeam1 ? "OPPONENTS" : "MY TEAM";
            }
            
            if (data.winner) {
                if (data.winner === 'draw') {
                    vicTitle.innerText = "DRAW!";
                    vicSub.innerText = "IT'S A TIE";
                } else {
                    if (state.currentPlayerCount === 2) {
                        const wName = (data.winner === 'team1') ? name1 : name2;
                        vicTitle.innerText = "VICTORY!";
                        vicSub.innerText = `${wName} WINS!`;
                    } else {
                        const winTeam = (data.winner === 'team1') ? "TEAM 1" : "TEAM 2";
                        vicTitle.innerText = "VICTORY!";
                        vicSub.innerText = `${winTeam} WINS THE MATCH`;
                    }
                }
            }

            if (data.scores) {
                if (finalS1) finalS1.innerText = data.scores.team1;
                if (finalS2) finalS2.innerText = data.scores.team2;
            }
            const rateBox = document.getElementById('victory-ratings');
            if (data.ratings && Object.keys(data.ratings).length > 0) {
                rateBox.style.display = 'block';
                rateBox.innerHTML = '<div style="font-size:12px; color:#aaa; margin-bottom:5px;">RATING UPDATES</div>';

                // Determine which seats to show based on player count
                const seatsToShow = (state.currentPlayerCount === 2) ? [0, 1] : [0, 1, 2, 3];

                seatsToShow.forEach(seat => {
                    const rData = data.ratings[seat];
                    if (rData) {
                        const name = (data.names && data.names[seat]) ? data.names[seat] : `Player ${seat+1}`;
                        const isPos = rData.delta >= 0;
                        const color = isPos ? '#2ecc71' : '#e74c3c';
                        const sign = isPos ? '+' : '';

                        const row = document.createElement('div');
                        row.style.cssText = "display:flex; justify-content:space-between; margin-bottom:4px; font-size:14px;";
                        row.innerHTML = `
                            <span>${name}</span>
                            <span>
                                <span style="color:#bdc3c7; margin-right:5px;">${rData.newRating}</span>
                                <span style="color:${color}; font-weight:bold;">${sign}${rData.delta}</span>
                            </span>
                        `;
                        rateBox.appendChild(row);
                    }
                });
            } else {
                rateBox.style.display = 'none'; // Hide if unrated or dev mode
            }
            const btn = document.getElementById('btn-victory-start');
            if (btn) {
                btn.id = "btn-victory-start"; 
                btn.innerText = "WANT A REMATCH?"; 
                btn.onclick = window.requestRematch; 
                btn.disabled = false;
                btn.style.opacity = "1";
                btn.style.cursor = "pointer";
            }
            // --------------------------------

            // 3. Navigate to Victory Screen
            UI.navTo('screen-victory');
            
        }, 100);
    });

    state.socket.on('error_message', (msg) => alert(msg));
    
    state.socket.on('private_created', (data) => {
        state.mySeat = data.seat;
    UI.navTo('screen-lobby');
    document.getElementById('lobby-room-id').innerText = data.gameId;
    document.getElementById('lobby-host-controls').style.display = 'block';
    document.getElementById('lobby-wait-msg').style.display = 'none';
    
    // Auto-fill join inputs for easy sharing testing
    document.getElementById('join-id').value = data.gameId;
});

state.socket.on('rematch_update', (data) => {
    const btn = document.getElementById('btn-victory-start');
    if (btn && data.current && data.needed) {
        btn.innerText = `WAITING (${data.current}/${data.needed})`;
    }
});

state.socket.on('joined_private_success', (data) => {
    state.mySeat = data.seat;
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

function startTimerSystem(shouldReset = true) {
    if (state.timerInterval) clearInterval(state.timerInterval);

    if (shouldReset) {
        state.seatTimers = { 0: 720, 1: 720, 2: 720, 3: 720 };
    }
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
        if (state.currentPlayerCount === 2) {
            if (seatIndex === state.mySeat) return 'timer-me';
            return 'timer-partner'; // Opponent is always "Partner" (Top) in 2P
        }
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

// --- PRIVATE ROOM LOGIC ---

window.doCreateRoom = () => {
    const roomName = document.getElementById('create-room-name').value; 
    
    // Validation: Only Room Name required
    if (!roomName) return alert("Please enter a Room Name");
    
    state.socket.emit('request_create_private', { 
        gameId: roomName, 
        // No PIN sent
        playerCount: state.currentPlayerCount || 4, 
        ruleset: state.currentRuleset || 'standard'
    });
};

window.doJoinPrivate = () => {
    const gameId = document.getElementById('join-id').value;
    
    // Validation: Only Game ID required
    if(!gameId) return alert("Please enter the Room Name");

    state.socket.emit('request_join_private', { gameId });
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

// --- LEADERBOARD LOGIC ---

window.openLeaderboard = async () => {
    // 1. Navigate
    UI.navTo('screen-leaderboard');
    
    // 2. Show Loading State
    const container = document.getElementById('leaderboard-list');
    container.innerHTML = '<div style="text-align:center; margin-top:50px; color:#aaa;">Fetching rankings...</div>';

    // 3. Fetch Data
    try {
        const res = await fetch('/api/leaderboard');
        const data = await res.json();

        if (data.success) {
            renderLeaderboard(data.leaderboard);
        } else {
            container.innerHTML = '<div style="text-align:center; margin-top:50px; color:#e74c3c;">Failed to load data.</div>';
        }
    } catch (e) {
        container.innerHTML = '<div style="text-align:center; margin-top:50px; color:#e74c3c;">Server connection error.</div>';
    }
};

function renderLeaderboard(players) {
    const container = document.getElementById('leaderboard-list');
    container.innerHTML = "";

    if (players.length === 0) {
        container.innerHTML = '<div style="text-align:center; margin-top:50px;">No ranked players yet.</div>';
        return;
    }

    // Header Row
    const header = document.createElement('div');
    header.className = 'lb-row lb-header';
    header.innerHTML = `
        <span style="width:30px;">#</span> 
        <span style="flex:1; text-align:left; padding-left:10px;">PLAYER</span> 
        <span style="width:60px; text-align:right;">RATING</span> 
        <span style="width:60px; text-align:right;">W / L</span>
    `;
    container.appendChild(header);

    // Player Rows
    players.forEach((p, index) => {
        const row = document.createElement('div');
        row.className = 'lb-row';

        // Special styling for Top 3
        let rankClass = 'rank-num';
        let rankIcon = index + 1;
        
        if (index === 0) { rankClass += ' rank-1'; rankIcon = '🥇 ' + rankIcon; }
        else if (index === 1) { rankClass += ' rank-2'; rankIcon = '🥈 ' + rankIcon; }
        else if (index === 2) { rankClass += ' rank-3'; rankIcon = '🥉 ' + rankIcon; }

        row.innerHTML = `
            <span class="${rankClass}">${rankIcon}</span>
            <span class="lb-name">${p.username}</span>
            <span class="lb-rating">${Math.round(p.stats.rating)}</span>
            <span class="lb-stats">${p.stats.wins} / ${p.stats.losses}</span>
        `;
        container.appendChild(row);
    });
}
// client.js

window.openProfile = async () => {
    // 1. Show Screen
    UI.navTo('screen-profile');
    
    // 2. Prepare UI (Show loading state)
    document.getElementById('my-rating').innerText = "...";
    document.getElementById('my-wins').innerText = "...";

    // 3. Fetch Data
    const token = state.playerToken;
    if (!token) return;

    try {
        const res = await fetch('/api/profile', {
            method: 'GET',
            headers: { 'Authorization': token }
        });
        const data = await res.json();

        if (data.success) {
            // 4. Update UI with fresh DB data
            document.getElementById('my-username').innerText = data.username;
            document.getElementById('my-rating').innerText = Math.round(data.stats.rating);
            document.getElementById('my-wins').innerText = data.stats.wins;
            
            const lossEl = document.getElementById('my-losses');
            if(lossEl) lossEl.innerText = data.stats.losses;
        }
    } catch (e) {
        console.error("Failed to load profile", e);
    }
};

window.askToGoOut = () => {
    // Close menu
    window.toggleGameMenu();
    
    if (state.currentPlayerCount !== 4) {
        alert("Asking is only for 4-player games.");
        return;
    }
    
    // UI Feedback
    alert("Asking partner...");
    state.socket.emit('act_ask_go_out', { seat: state.mySeat });
};

window.replyGoOut = (decision) => {
    document.getElementById('modal-partner-ask').style.display = 'none';
    state.socket.emit('act_reply_go_out', { seat: state.mySeat, decision: decision });
};