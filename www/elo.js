// elo.js

/**
 * Calculates the rating change for Team 1.
 * Team 2's change is simply the negative of this value.
 *
 * @param {number} r1 - Average rating of Team 1
 * @param {number} r2 - Average rating of Team 2
 * @param {number} s1 - Final score of Team 1
 * @param {number} s2 - Final score of Team 2
 * @returns {number} - The points to add to Team 1 (and subtract from Team 2)
 */
function calculateEloChange(r1, r2, s1, s2) {
    const K = 32; // Standard volatility factor (higher = faster rank changes)
    
    // 1. Calculate Expected Score (Win Probability)
    // Standard Elo formula: 1 / (1 + 10^((RatingB - RatingA) / 400))
    const expectedScore1 = 1 / (1 + Math.pow(10, (r2 - r1) / 400));
    
    // 2. Determine Actual Result (1 = Win, 0 = Loss, 0.5 = Draw)
    let actualScore1;
    if (s1 > s2) actualScore1 = 1;
    else if (s2 > s1) actualScore1 = 0;
    else actualScore1 = 0.5; // Draw

    // 3. Margin of Victory (MOV) Multiplier
    // In Canasta, a 5000-1000 win is more significant than a 5000-4900 win.
    // We use a logarithmic scale so massive point diffs don't break the system,
    // but they still reward stomps more than close games.
    const diff = Math.abs(s1 - s2);
    
    // Logic: 
    // If diff is 0 (Draw), multiplier is 1.
    // If diff is 500 (Close), multiplier is ~1.2
    // If diff is 3000 (Stomp), multiplier is ~1.9
    // "2000" is our scaling constant suitable for Canasta scores.
    const movMultiplier = Math.log(diff / 2000 + 1) + 1;

    // 4. Calculate Delta
    const delta = Math.round(K * movMultiplier * (actualScore1 - expectedScore1));

    return delta;
}

module.exports = { calculateEloChange };