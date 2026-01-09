// state.js
export const state = {
    socket: null,
    playerToken: localStorage.getItem("canasta_token"),
    playerUsername: localStorage.getItem("canasta_user"),
    currentBotDiff: 'medium',
    mySeat: -1,
    selectedIndices: [],
    activeData: null,
    stagedMelds: [],
    isStaging: false,
    pickupStaged: false,
    seatTimers: { 0: 720, 1: 720, 2: 720, 3: 720 },
    currentTurnSeat: -1,
    timerInterval: null,
    gameStarted: false,
    isTransitioning: false // New flag to prevent double next-round clicks
};

// Helper to save session
export function saveSession(token, username) {
    state.playerToken = token;
    state.playerUsername = username;
    localStorage.setItem("canasta_token", token);
    localStorage.setItem("canasta_user", username);
}

export function logout() {
    localStorage.removeItem("canasta_token");
    localStorage.removeItem("canasta_user");
    location.reload();
}