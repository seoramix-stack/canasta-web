// client.js

import { state, saveSession, logout } from './state.js';
import * as UI from './ui.js';
import * as Anim from './animations.js';

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
    UI.navTo('screen-game');
    document.getElementById('status').style.display = 'block';
    state.socket.emit('request_join', { mode: mode, difficulty: state.currentBotDiff });
};

window.leaveGame = () => {
    if(state.socket) state.socket.emit('leave_game');
    if(state.timerInterval) clearInterval(state.timerInterval);
    UI.navTo('screen-home');
};

window.confirmLeave = () => {
    if(confirm("Quit game?")) { UI.toggleGameMenu(); window.leaveGame(); }
};

window.sendReady = () => {
    document.getElementById('ready-step-1').style.display = 'none';
    document.getElementById('ready-step-2').style.display = 'flex';
    state.socket.emit('act_ready', { seat: state.mySeat });
};

// Game Actions
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
    if (state.activeData) UI.updateUI(state.activeData); 
};

window.handleDiscardClick = () => {
    if (state.selectedIndices.length === 1) {
        state.socket.emit('act_discard', { seat: state.mySeat, index: state.selectedIndices[0] });
        state.selectedIndices = [];
    } else {
        alert("Select exactly 1 card to discard.");
    }
};

window.handleMeldClick = (event, targetRank) => {
    event.stopPropagation();
    if(state.selectedIndices.length === 0) return;
    state.socket.emit('act_meld', { 
        seat: state.mySeat, 
        indices: state.selectedIndices, 
        targetRank: targetRank 
    });
    state.selectedIndices = [];
};

window.startNextRound = () => {
    state.socket.emit('act_next_round');
};

// --- 3. SOCKET SETUP ---
function initSocket(token) {
    if (state.socket) return; 
    const storedUser = localStorage.getItem("canasta_user"); 

    state.socket = io({
        auth: { token: token, username: storedUser }
    });

    state.socket.on('connect', () => console.log("Connected"));

    state.socket.on('deal_hand', (data) => {
        state.mySeat = data.seat;
        UI.navTo('screen-game');
        document.getElementById('status').style.display = 'none';
        
        // Render UI first
        UI.updateUI(data);

        // Then Animate
        if (data.hand.length > 0) {
            const deckRect = document.getElementById('draw-area').getBoundingClientRect();
            // Simple deal animation
            Anim.flyCard(deckRect, deckRect, "cards/BackRed.png"); 
        }
    });

    state.socket.on('update_game', (data) => {
        // Run animations if we have old data
        if (state.activeData) {
            Anim.handleServerAnimations(state.activeData, data);
        }
        UI.updateUI(data);
    });

    state.socket.on('match_over', (data) => {
        // Fix for the Crash: Ensure we don't try to access UI if user left
        setTimeout(() => {
            const vicScreen = document.getElementById('screen-victory');
            if(!vicScreen) return; 
            
            // ... (Your victory logic) ...
            vicScreen.classList.add('active-screen');
        }, 100);
    });

    state.socket.on('error_message', (msg) => alert(msg));
    
    // Initial UI Update
    const pName = storedUser || "Player";
    document.querySelector('.p-name').innerText = pName;
    UI.navTo('screen-home'); 
}