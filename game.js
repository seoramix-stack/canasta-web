// game.js - v12.1: Configurable Rules & Refactored
const { createCanastaDeck, shuffle } = require('./deck');

class CanastaGame {
    constructor(customConfig = {}) {
        // --- CONFIGURATION ENGINE (Phase 1 & 2 Complete) ---
        this.config = {
            WIN_SCORE: 5000,           // Points to win match
            MIN_CANASTAS_OUT: 2,       // User requested default: 2 Canastas to go out
            DRAW_COUNT: 2,             // Standard: Draw 2 cards
            HAND_SIZE: 11,             // Standard 4P: 11 Cards
            PLAYER_COUNT: 4,
            ...customConfig            // Allows overriding rules later
        };

        // --- GAME STATE ---
        this.deck = [];
        this.discardPile = [];
        this.players = Array.from({ length: this.config.PLAYER_COUNT }, () => []);
        this.team1Melds = {}; 
        this.team2Melds = {};
        this.team1Red3s = [];
        this.team2Red3s = [];
        
        this.roundStarter = 0; 
        this.currentPlayer = 0; 
        this.turnPhase = "draw"; 
        
        this.finalScores = null;
        this.cumulativeScores = { team1: 0, team2: 0 }; 

        // STATIC DATA (Moved here for performance)
        this.RANK_VALUES = {
            "Joker": 50, "2": 20, "A": 20,
            "K": 10, "Q": 10, "J": 10, "10": 10, "9": 10, "8": 10,
            "7": 5, "6": 5, "5": 5, "4": 5, "3": 5 // Black 3 is 5
        };
        
        this.RANK_ORDER = { 
            "3": 0, "4": 1, "5": 2, "6": 3, "7": 4, "8": 5, "9": 6, 
            "10": 7, "J": 8, "Q": 9, "K": 10, "A": 11, "2": 12, "Joker": 13 
        };
    }

    // --- HELPERS ---
    getCardValue(rank) {
        return this.RANK_VALUES[rank] || 0;
    }
    
    sortHand(playerIndex) {
        this.players[playerIndex].sort((a, b) => {
            let diff = this.RANK_ORDER[b.rank] - this.RANK_ORDER[a.rank];
            if (diff !== 0) return diff;
            return (a.suit < b.suit) ? -1 : 1;
        });
    }

    checkRed3s(playerIndex) {
        let hand = this.players[playerIndex];
        let teamRed3s = (playerIndex % 2 === 0) ? this.team1Red3s : this.team2Red3s;
        let hasRed3 = true;
        while (hasRed3) {
            let idx = hand.findIndex(c => c.isRed3);
            if (idx !== -1) {
                let card = hand.splice(idx, 1)[0];
                teamRed3s.push(card);
                if (this.deck.length > 0) hand.push(this.deck.shift());
            } else { hasRed3 = false; }
        }
        this.sortHand(playerIndex);
    }

    getOpeningReq(score) {
        if (score < 0) return 15;
        if (score < 1500) return 50;
        if (score < 3000) return 90;
        return 120;
    }

    // --- MATCH MANAGEMENT ---

    resetMatch() {
        this.cumulativeScores = { team1: 0, team2: 0 };
        this.roundStarter = 0;
        this.setupRound();
        console.log(`NEW MATCH STARTED (Rules: ${this.config.MIN_CANASTAS_OUT} Canastas to Out)`);
    }

    resolveMatchStatus() {
        if (this.finalScores) {
            this.cumulativeScores.team1 += this.finalScores.team1.total;
            this.cumulativeScores.team2 += this.finalScores.team2.total;
        }

        const WIN = this.config.WIN_SCORE;
        let s1 = this.cumulativeScores.team1;
        let s2 = this.cumulativeScores.team2;

        if (s1 >= WIN || s2 >= WIN) {
            if (s1 > s2) return { isMatchOver: true, winner: 'team1' };
            if (s2 > s1) return { isMatchOver: true, winner: 'team2' };
            return { isMatchOver: true, winner: 'draw' };
        }

        return { isMatchOver: false };
    }
    
    startNextRound() {
        const WIN = this.config.WIN_SCORE;
        if (this.cumulativeScores.team1 >= WIN || this.cumulativeScores.team2 >= WIN) {
            return 'game_already_over'; 
        }

        this.roundStarter = (this.roundStarter + 1) % this.config.PLAYER_COUNT;
        this.setupRound();
        console.log(`NEXT ROUND STARTED. Starter: Player ${this.roundStarter}`);
        return null; 
    }

    setupRound() {
        this.deck = shuffle(createCanastaDeck());
        this.discardPile = [];
        this.players = Array.from({ length: this.config.PLAYER_COUNT }, () => []);
        this.team1Melds = {}; this.team2Melds = {};
        this.team1Red3s = []; this.team2Red3s = [];
        this.finalScores = null;
        
        this.currentPlayer = this.roundStarter;
        this.turnPhase = "draw";

        // Deal (Using Config)
        for (let i = 0; i < this.config.PLAYER_COUNT; i++) {
        this.players[i] = this.deck.splice(0, this.config.HAND_SIZE);
        this.checkRed3s(i);
    }

        // Setup Discard
        if (this.deck.length > 0) {
            this.discardPile.push(this.deck.shift());
            // Prevent Wild/Red3 as initial top card
            while (this.discardPile.length > 0 && 
                   this.deck.length > 0 && 
                   (this.discardPile[0].isRed3 || this.discardPile[0].isWild)) {
                this.deck.push(this.discardPile.pop());
                this.discardPile.push(this.deck.shift());
            }
        }
    }

    // --- GAME ACTIONS ---

    drawFromDeck(playerIndex) {
        if (playerIndex !== this.currentPlayer) return { success: false, message: "Not your turn!" };
        if (this.turnPhase !== "draw") return { success: false, message: "Wrong phase!" };
        
        if (this.deck.length === 0) {
            this.turnPhase = "game_over";
            this.finalScores = this.calculateScores(); 
            return { success: true, message: "GAME_OVER_DECK_EMPTY" }; 
        }

        let teamRed3s = (playerIndex % 2 === 0) ? this.team1Red3s : this.team2Red3s;
        
        // Draw Count from Config (Standard: 2)
        let cardsNeeded = this.config.DRAW_COUNT;
        
        while (cardsNeeded > 0 && this.deck.length > 0) {
            let card = this.deck.shift();
            while (card && card.isRed3) {
                teamRed3s.push(card);
                card = (this.deck.length > 0) ? this.deck.shift() : null;
            }
            if (card) {
                this.players[playerIndex].push(card);
                cardsNeeded--;
            }
        }

        this.sortHand(playerIndex);
        this.turnPhase = "playing";
        return { success: true };
    }

    pickupDiscardPile(playerIndex) {
        if (playerIndex !== this.currentPlayer || this.turnPhase !== "draw") return { success: false, message: "Only at start of turn." };
        if (this.discardPile.length === 0) return { success: false, message: "Pile is empty." };

        let topCard = this.discardPile[this.discardPile.length - 1];
        let hand = this.players[playerIndex];
        let teamMelds = (playerIndex % 2 === 0) ? this.team1Melds : this.team2Melds;
        let rank = topCard.rank;

        if (topCard.isWild || rank === "3") return { success: false, message: "Cannot pick up Wild or 3." };

        let hasOpened = (Object.keys(teamMelds).length > 0);
        let containsWild = this.discardPile.some(c => c.isWild);
        let isFrozen = !hasOpened || containsWild;

        let naturalMatches = [];
        let wildMatches = [];
        hand.forEach((c, idx) => {
            if (c.rank === rank && !c.isWild) naturalMatches.push(idx);
            else if (c.isWild) wildMatches.push(idx);
        });

        let method = null; 

        if (teamMelds[rank] && !containsWild) {
            method = 'table';
        } else if (naturalMatches.length >= 2) {
            method = 'natural';
        } else if (!isFrozen && naturalMatches.length >= 1 && wildMatches.length >= 1) {
            method = 'mixed';
        }

        if (!method) {
            if (isFrozen) return { success: false, message: "Pile Frozen! Need 2 natural cards." };
            return { success: false, message: "Need pair, matching meld, or Natural+Wild." };
        }

        if (!hasOpened) {
            let score = this.getCardValue(topCard.rank);
            if (method === 'natural') {
                 score += this.getCardValue(hand[naturalMatches[0]].rank) + this.getCardValue(hand[naturalMatches[1]].rank);
            }
            let req = this.getOpeningReq((playerIndex % 2 === 0) ? this.cumulativeScores.team1 : this.cumulativeScores.team2);
            if (score < req) return { success: false, message: `Points (${score}) < Req (${req}). Use 'Staging'.` };
        }

        let pile = this.discardPile.splice(0, this.discardPile.length);
        let pickupCard = pile.pop(); 
        if (!teamMelds[rank]) teamMelds[rank] = [];

        let indicesToRemove = [];
        if (method === 'table') {
            teamMelds[rank].push(pickupCard);
        } else if (method === 'natural') {
            indicesToRemove.push(naturalMatches[0], naturalMatches[1]);
            teamMelds[rank].push(hand[naturalMatches[0]], hand[naturalMatches[1]], pickupCard);
        } else if (method === 'mixed') {
            indicesToRemove.push(naturalMatches[0], wildMatches[0]);
            teamMelds[rank].push(hand[naturalMatches[0]], hand[wildMatches[0]], pickupCard);
        }

        indicesToRemove.sort((a,b) => b-a).forEach(i => hand.splice(i, 1));
        if (pile.length > 0) hand.push(...pile);
        
        this.sortHand(playerIndex);
        this.turnPhase = "playing";
        return { success: true, method: method };
    }

    meldCards(playerIndex, cardIndices, targetRank) {
        if (playerIndex !== this.currentPlayer || this.turnPhase !== "playing") 
            return { success: false, message: "Not your turn!" };
        
        let hand = this.players[playerIndex];
        cardIndices.sort((a, b) => b - a);

        let cards = cardIndices.map(i => hand[i]);
        if (cards.length === 0) return { success: false, message: "No cards selected." };

        let rank = targetRank || null;
        if (!rank) {
            let natural = cards.find(c => !c.isWild);
            if (!natural) {
                 if (!rank) return { success: false, message: "All wilds? Specify rank." };
            } else {
                rank = natural.rank;
            }
        }

        let teamMelds = (playerIndex % 2 === 0) ? this.team1Melds : this.team2Melds;
        let existingMeld = teamMelds[rank];

        if (rank === "3") {
            if (cards.some(c => c.isWild)) return { success: false, message: "Cannot use Wilds with Black 3s." };
            let remaining = hand.length - cards.length;
            if (remaining > 1) { 
                return { success: false, message: "Black 3s allowed only when going out." }; 
            }
        }

        if (!existingMeld && cards.length < 3) {
            return { success: false, message: "New melds need 3+ cards." };
        }

        for (let c of cards) {
            if (c.rank !== rank && !c.isWild) return { success: false, message: "Mixed ranks!" };
        }
        
        // --- PHASE 2 UPDATE: Check Config for Canastas Needed ---
        let cardsRemaining = hand.length - cards.length;
        
        // Count how many canastas we have
        let currentCanastas = Object.values(teamMelds).filter(pile => pile.length >= 7).length;
        
        // Check if this specific meld CREATES a new canasta
        let currentPileSize = existingMeld ? existingMeld.length : 0;
        if (currentPileSize + cards.length >= 7 && currentPileSize < 7) {
            currentCanastas++;
        }

        // --- CRITICAL FIX: PREVENT GETTING STUCK WITH 1 CARD ---
        // If you don't have the Canastas to win, you MUST keep at least 2 cards:
        // 1 to discard + 1 to keep holding.
        if (currentCanastas < this.config.MIN_CANASTAS_OUT) {
            if (cardsRemaining === 0) {
                 return { success: false, message: `Need ${this.config.MIN_CANASTAS_OUT} Canastas to Float (go out without discard)!` };
            }
            if (cardsRemaining === 1) {
                 return { success: false, message: `Cannot meld down to 1 card without ${this.config.MIN_CANASTAS_OUT} Canastas!` };
            }
        }

        let isOpening = (Object.keys(teamMelds).length === 0);
        if (isOpening) {
             let teamScore = (playerIndex % 2 === 0) ? this.cumulativeScores.team1 : this.cumulativeScores.team2;
             let req = this.getOpeningReq(teamScore);
             let meldPoints = cards.reduce((sum, c) => sum + this.getCardValue(c.rank), 0);
             if (meldPoints < req) return { success: false, message: `Opening meld too low! Need ${req} pts.` };
        }

        cardIndices.forEach(i => hand.splice(i, 1)); 
        if (!teamMelds[rank]) teamMelds[rank] = [];
        teamMelds[rank].push(...cards); 

        this.sortHand(playerIndex); 
        
        if (this.players[playerIndex].length === 0) {
            this.turnPhase = "game_over";
            this.finalScores = this.calculateScores(playerIndex); 
            console.log(`ROUND OVER: Player ${playerIndex} went out (Floating).`);
            return { success: true, message: "GAME_OVER" };
        }

        return { success: true };
    }

    discardFromHand(playerIndex, cardIndex) {
        if (playerIndex !== this.currentPlayer || this.turnPhase !== "playing") return { success: false, message: "Draw first!" };

        let hand = this.players[playerIndex];
        let card = hand[cardIndex];
        let teamMelds = (playerIndex % 2 === 0) ? this.team1Melds : this.team2Melds;

        // --- PHASE 2 UPDATE: Check Config for Canastas Needed ---
        let canastaCount = Object.values(teamMelds).filter(pile => pile.length >= 7).length;

        if (hand.length === 1) {
            if (canastaCount < this.config.MIN_CANASTAS_OUT) {
                return { success: false, message: `Need ${this.config.MIN_CANASTAS_OUT} Canastas to go out.` };
            }
            
            hand.splice(cardIndex, 1);
            this.discardPile.push(card);
            
            this.turnPhase = "game_over"; 
            this.finalScores = this.calculateScores(playerIndex); 
            console.log(`ROUND OVER: Player ${playerIndex} went out.`);
            return { success: true, message: "GAME_OVER" };
        }

        hand.splice(cardIndex, 1);
        this.discardPile.push(card);
        this.turnPhase = "draw";
        this.currentPlayer = (this.currentPlayer + 1) % this.config.PLAYER_COUNT;
        return { success: true };
    }

    calculateScores(winnerSeat = -1, isConcealed = false) {
        const calcTeam = (melds, red3s, pIndices) => {
            let details = { basePoints: 0, canastaBonus: 0, red3Points: 0, deductions: 0, goOutBonus: 0, total: 0 };
            let hasMelded = Object.keys(melds).length > 0;

            for (let rank in melds) {
                let pile = melds[rank];
                details.basePoints += pile.reduce((sum, c) => sum + this.getCardValue(c.rank), 0);
                if (pile.length >= 7) {
                    let isNatural = pile.every(c => !c.isWild);
                    details.canastaBonus += (isNatural ? 500 : 300);
                }
            }

            let r3Val = (red3s.length === 4) ? 800 : (red3s.length * 100);
            details.red3Points = hasMelded ? r3Val : -r3Val;

            pIndices.forEach(idx => {
                let handPoints = this.players[idx].reduce((sum, c) => sum + this.getCardValue(c.rank), 0);
                details.deductions -= handPoints; 
                if (idx === winnerSeat) {
                    details.goOutBonus = 100; 
                    if (isConcealed) details.goOutBonus += 100; 
                }
            });

            details.total = details.basePoints + details.canastaBonus + details.red3Points + details.deductions + details.goOutBonus;
            return details;
        };

        const pCount = this.config.PLAYER_COUNT;
    
    // Dynamic Team Indices:
    // 2-Player: Team 1 = [0], Team 2 = [1]
    // 4-Player: Team 1 = [0, 2], Team 2 = [1, 3]
    const team1Indices = (pCount === 2) ? [0] : [0, 2];
    const team2Indices = (pCount === 2) ? [1] : [1, 3];

    return {
        team1: calcTeam(this.team1Melds, this.team1Red3s, team1Indices),
        team2: calcTeam(this.team2Melds, this.team2Red3s, team2Indices)
    };
}

    processOpening(seat, meldsData, wantPickup) {
        const requiredPhase = wantPickup ? "draw" : "playing";
        if (seat !== this.currentPlayer || this.turnPhase !== requiredPhase) 
            return { success: false, message: "Not your turn or wrong phase!" };

        let hand = [...this.players[seat]];
        let topCard = this.discardPile[this.discardPile.length - 1];
        let totalPoints = 0;
        let usedIndices = new Set();
        
        if (wantPickup) {
            if (!topCard) return { success: false, message: "Pile is empty." };
            if (topCard.rank === "3") return { success: false, message: "Cannot pick up pile with Black 3s." };
            
            let keyMeld = meldsData[0]; 
            let keyCards = keyMeld.indices.map(i => hand[i]);

            let naturalCount = 0;
            for (let c of keyCards) {
                if (!c.isWild && c.rank !== topCard.rank) return { success: false, message: "Pickup meld contains mismatched natural cards." };
                if (!c.isWild && c.rank === topCard.rank) naturalCount++;
            }
            
            if (naturalCount < 2) return { success: false, message: "Must use at least 2 NATURAL cards matching top card." };
            totalPoints += this.getCardValue(topCard.rank);
        }

        for (let index = 0; index < meldsData.length; index++) {
            let m = meldsData[index];
            let cards = m.indices.map(i => hand[i]);
            
            for(let i of m.indices) {
                if (usedIndices.has(i)) return { success: false, message: "Cannot use same card twice." };
                usedIndices.add(i);
            }

            let meldRank = m.rank; 
            if (meldRank === "3") {
                if (cards.some(c => c.isWild)) return { success: false, message: "Black 3s cannot contain Wilds." };
                if ((hand.length - usedIndices.size) !== 0) return { success: false, message: "Black 3s allowed only when going out." };
            }

            let wildCount = 0;
            for (let c of cards) {
                if (!c.isWild && c.rank !== meldRank) return { success: false, message: "Mixed ranks in " + meldRank };
                if (c.isWild) wildCount++;
            }
            
            if (wildCount > cards.length - 2) return { success: false, message: "Too many wilds in " + meldRank + "s." };

            let minRequired = 3;
            // Ghost Card logic preserved
            if (wantPickup && index === 0) minRequired = 2;

            if (cards.length < minRequired) return { success: false, message: "Meld " + meldRank + "s must have " + minRequired + "+ cards." };

            totalPoints += cards.reduce((sum, c) => sum + this.getCardValue(c.rank), 0);
        }

        let teamScore = (seat % 2 === 0) ? this.cumulativeScores.team1 : this.cumulativeScores.team2;
        let required = this.getOpeningReq(teamScore);
        if (totalPoints < required) return { success: false, message: "Need " + required + " points. You have " + totalPoints + "." };

        // --- PHASE 2 UPDATE: Canasta Check for Going Out ---
        let cardsRemaining = hand.length - usedIndices.size;
        
        let teamMelds = (seat % 2 === 0) ? this.team1Melds : this.team2Melds;
        let canastaCount = Object.values(teamMelds).filter(p => p.length >= 7).length;

        // Predict new Canastas
        meldsData.forEach(m => {
            let existingLen = teamMelds[m.rank] ? teamMelds[m.rank].length : 0;
            let addedLen = m.indices.length;
            if (wantPickup && m === meldsData[0]) addedLen++; 
            if (existingLen + addedLen >= 7 && existingLen < 7) canastaCount++;
        });

        if (cardsRemaining === 0) {
             if (canastaCount < this.config.MIN_CANASTAS_OUT) {
                 return { success: false, message: `Need ${this.config.MIN_CANASTAS_OUT} Canastas to go out!` };
             }
        }

        // --- EXECUTION ---
        if (wantPickup) {
            let pile = this.discardPile.splice(0, this.discardPile.length);
            this.players[seat].push(...pile);
        }

        meldsData.forEach((m, index) => {
            let meldRank = m.rank;
            if (!teamMelds[meldRank]) teamMelds[meldRank] = [];
            let meldCards = m.indices.map(i => hand[i]);
            teamMelds[meldRank].push(...meldCards);
            if (wantPickup && index === 0) teamMelds[meldRank].push(topCard);
        });

        let allUsedIndices = [];
        meldsData.forEach(m => allUsedIndices.push(...m.indices));
        allUsedIndices.sort((a,b) => b-a);
        allUsedIndices.forEach(idx => this.players[seat].splice(idx, 1));

        this.sortHand(seat);

        if (this.players[seat].length === 0) {
            this.turnPhase = "game_over";
            this.finalScores = this.calculateScores(seat, true); 
            console.log(`ROUND OVER: Player ${seat} went out Concealed!`);
            return { success: true, message: "GAME_OVER" };
        }

        this.turnPhase = "playing"; 
        return { success: true };
    }
}

module.exports = { CanastaGame };