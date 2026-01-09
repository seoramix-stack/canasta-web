// game.js - v12.0: Robust Multi-Round Logic
const { createCanastaDeck, shuffle } = require('./deck');

class CanastaGame {
    constructor() {
        this.deck = [];
        this.discardPile = [];
        this.players = [[], [], [], []]; 
        this.team1Melds = {}; 
        this.team2Melds = {};
        this.team1Red3s = [];
        this.team2Red3s = [];
        
        // GAME STATE
        this.roundStarter = 0; 
        this.currentPlayer = 0; 
        this.turnPhase = "draw"; 
        
        // SCORING
        this.finalScores = null;
        this.cumulativeScores = { team1: 0, team2: 0 }; 
    }

    sortHand(playerIndex) {
        const rankOrder = { "3": 0, "4": 1, "5": 2, "6": 3, "7": 4, "8": 5, "9": 6, "10": 7, "J": 8, "Q": 9, "K": 10, "A": 11, "2": 12, "Joker": 13 };
        this.players[playerIndex].sort((a, b) => {
            let diff = rankOrder[b.rank] - rankOrder[a.rank];
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

    resetMatch() {
        this.cumulativeScores = { team1: 0, team2: 0 };
        this.roundStarter = 0;
        this.setupRound();
        console.log("NEW MATCH STARTED");
    }

    startNextRound() {
        // 1. Update Cumulative Scores
        if (this.finalScores) {
            // FIX: Add .total to access the number, otherwise you add the whole object
            this.cumulativeScores.team1 += this.finalScores.team1.total; 
            this.cumulativeScores.team2 += this.finalScores.team2.total;
            this.finalScores = null;
        }
        
        // 2. CHECK WIN CONDITION (5,000 Points)
        const WIN_THRESHOLD = 1000;
        let s1 = this.cumulativeScores.team1;
        let s2 = this.cumulativeScores.team2;

        if (s1 >= WIN_THRESHOLD || s2 >= WIN_THRESHOLD) {
            if (s1 > s2) return 'team1';
            if (s2 > s1) return 'team2';
            return 'draw'; 
        }

        // 3. If no winner, setup the next round normally
        this.roundStarter = (this.roundStarter + 1) % 4;
        this.setupRound();
        console.log(`NEXT ROUND STARTED. Starter: Player ${this.roundStarter}`);
        return null; 
    }

    setupRound() {
        // Reset State
        this.deck = shuffle(createCanastaDeck());
        this.discardPile = [];
        this.players = [[], [], [], []];
        this.team1Melds = {}; this.team2Melds = {};
        this.team1Red3s = []; this.team2Red3s = [];
        this.finalScores = null;
        
        this.currentPlayer = this.roundStarter;
        this.turnPhase = "draw";

        // Deal
        for (let i = 0; i < 4; i++) {
            this.players[i] = this.deck.splice(0, 11);
            this.checkRed3s(i);
        }

        // Setup Discard (CRASH FIX: Check if deck exists)
        if (this.deck.length > 0) {
            this.discardPile.push(this.deck.shift());
            
            // Safe loop: ensure we don't crash if deck runs out while looking for natural
            while (this.discardPile.length > 0 && 
                   this.deck.length > 0 && 
                   (this.discardPile[0].isRed3 || this.discardPile[0].isWild)) {
                this.deck.push(this.discardPile.pop());
                this.discardPile.push(this.deck.shift());
            }
        }
    }

    drawFromDeck(playerIndex) {
        // 1. Check if it's the right player
        if (playerIndex !== this.currentPlayer) {
            const who = (this.currentPlayer === -1) ? "Game not started (Waiting for Ready)" : `Player ${this.currentPlayer}`;
            return { success: false, message: `Not your turn! It is ${who}'s turn.` };
        }

        // 2. Check phase
        if (this.turnPhase !== "draw") {
            return { success: false, message: "Wrong phase! You must " + this.turnPhase };
        }
        
        // DECK EXHAUSTED LOGIC
        if (this.deck.length === 0) {
            this.turnPhase = "game_over";
            this.finalScores = this.calculateScores(); 
            console.log("ROUND OVER: Deck Exhausted.");
            return { success: true, message: "GAME_OVER_DECK_EMPTY" }; 
        }

        let teamRed3s = (playerIndex % 2 === 0) ? this.team1Red3s : this.team2Red3s;
        let cardsNeeded = 2;
        
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

        // 1. Block Wilds/3s
        if (topCard.isWild || rank === "3") return { success: false, message: "Cannot pick up Wild or 3." };

        // 2. Define Frozen State
        // Frozen if: Team hasn't opened OR Pile contains a Wild
        let hasOpened = (Object.keys(teamMelds).length > 0);
        let containsWild = this.discardPile.some(c => c.isWild);
        let isFrozen = !hasOpened || containsWild;

        // 3. Identify Matching Cards in Hand
        let naturalMatches = [];
        let wildMatches = [];
        hand.forEach((c, idx) => {
            if (c.rank === rank && !c.isWild) naturalMatches.push(idx);
            else if (c.isWild) wildMatches.push(idx);
        });

        // 4. Determine Valid Pickup Method
        let method = null; // 'table', 'natural', 'mixed'

        // Method A: Table Meld
        // Allowed only if pile is NOT frozen (no wild in pile) AND we have a meld
        // Note: If !hasOpened, teamMelds is empty, so this naturally fails as required.
        if (teamMelds[rank] && !containsWild) {
            method = 'table';
        }
        // Method B: Natural Pair (Standard Defrost)
        // Always allowed (Frozen or Not) if you have 2 naturals
        else if (naturalMatches.length >= 2) {
            method = 'natural';
        }
        // Method C: Mixed (Natural + Wild)
        // Only allowed if NOT frozen.
        // (If !hasOpened, isFrozen is true, so this is blocked correctly)
        else if (!isFrozen && naturalMatches.length >= 1 && wildMatches.length >= 1) {
            method = 'mixed';
        }

        if (!method) {
            if (isFrozen) return { success: false, message: "Pile Frozen! Need 2 natural cards." };
            return { success: false, message: "Need pair, matching meld, or Natural+Wild." };
        }

        // 5. Opening Score Check (If strictly opening via this single action)
        if (!hasOpened) {
            // Calculate points of the potential meld (Top + Hand Cards)
            let score = topCard.value;
            
            // Note: Only 'natural' method is possible here due to isFrozen logic above
            if (method === 'natural') {
                 score += hand[naturalMatches[0]].value + hand[naturalMatches[1]].value;
            }

            let req = this.getOpeningReq((playerIndex % 2 === 0) ? this.cumulativeScores.team1 : this.cumulativeScores.team2);
            
            if (score < req) {
                return { success: false, message: `Points (${score}) < Req (${req}). Use 'Staging' to combine melds.` };
            }
        }

        // 6. Execute Pickup
        let pile = this.discardPile.splice(0, this.discardPile.length);
        let pickupCard = pile.pop(); // Remove top card (it goes to meld)
        if (!teamMelds[rank]) teamMelds[rank] = [];

        // Move cards from Hand -> Meld
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

        // Remove from hand (sort desc to avoid index shift)
        indicesToRemove.sort((a,b) => b-a).forEach(i => hand.splice(i, 1));

        // Add rest of pile to hand
        if (pile.length > 0) hand.push(...pile);
        
        this.sortHand(playerIndex);
        this.turnPhase = "playing";
        
        // Return extra info so UI can animate or log
        return { success: true, method: method };
    }

    meldCards(playerIndex, cardIndices, targetRank) {
        if (playerIndex !== this.currentPlayer || this.turnPhase !== "playing") 
            return { success: false, message: "Not your turn!" };
        
        let hand = this.players[playerIndex];
        cardIndices.sort((a, b) => b - a);

        let cards = cardIndices.map(i => hand[i]);
        if (cards.length === 0) return { success: false, message: "No cards selected." };

        // 1. Determine Rank
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

        // --- NEW: BLACK 3 RULES ---
        if (rank === "3") {
            // Rule A: Cannot use Wilds with Black 3s
            if (cards.some(c => c.isWild)) return { success: false, message: "Cannot use Wilds with Black 3s." };
            
            // Rule B: Must be Going Out
            // We calculate if this meld consumes the LAST cards in hand
            let remaining = hand.length - cards.length;
            if (remaining > 0) return { success: false, message: "Black 3s can only be melded when going out." };
        }
        // --------------------------

        // 2. Validate Meld Size
        if (!existingMeld && cards.length < 3) {
            return { success: false, message: "New melds need 3+ cards." };
        }

        // 3. Validate Ranks & Wilds
        let wildCount = 0;
        for (let c of cards) {
            if (c.rank !== rank && !c.isWild) return { success: false, message: "Mixed ranks!" };
            if (c.isWild) wildCount++;
        }
        
        // 4. CANASTA SAFETY CHECK (Illegal Go-Out Prevention)
        let cardsRemaining = hand.length - cards.length;
        
        let hasCanasta = Object.values(teamMelds).some(pile => pile.length >= 7);
        let currentPileSize = existingMeld ? existingMeld.length : 0;
        if (currentPileSize + cards.length >= 7) hasCanasta = true;

        if (!hasCanasta) {
            if (cardsRemaining <= 1) {
                return { success: false, message: "Cannot go out (or hold 1 card) without a Canasta!" };
            }
        }

        // 5. Check Opening Requirements (standard logic...)
        let isOpening = (Object.keys(teamMelds).length === 0);
        if (isOpening) {
             let teamScore = (playerIndex % 2 === 0) ? this.cumulativeScores.team1 : this.cumulativeScores.team2;
             let req = this.getOpeningReq(teamScore);
             let meldPoints = cards.reduce((sum, c) => sum + c.value, 0);
             if (meldPoints < req) return { success: false, message: `Opening meld too low! Need ${req} pts.` };
        }

        // 6. Execute Meld
        cardIndices.forEach(i => hand.splice(i, 1)); 
        if (!teamMelds[rank]) teamMelds[rank] = [];
        teamMelds[rank].push(...cards); 

        this.sortHand(playerIndex); 
        
        if (this.players[playerIndex].length === 0) {
            this.turnPhase = "game_over";
            this.finalScores = this.calculateScores(playerIndex); 
            console.log(`ROUND OVER: Player ${playerIndex} went out by melding (Floating).`);
            return { success: true, message: "GAME_OVER" };
        }

        return { success: true };
    }

    // Updated Calculate Scores to support Concealed Bonus
    calculateScores(winnerSeat = -1, isConcealed = false) {
        const calcTeam = (melds, red3s, pIndices) => {
            let details = {
                basePoints: 0, canastaBonus: 0, red3Points: 0, deductions: 0, goOutBonus: 0, total: 0
            };

            let hasMelded = false;
            for (let rank in melds) {
                let pile = melds[rank];
                if (pile.length > 0) hasMelded = true;
                details.basePoints += pile.reduce((sum, c) => sum + c.value, 0);
                
                if (pile.length >= 7) {
                    let isNatural = pile.every(c => !c.isWild);
                    details.canastaBonus += (isNatural ? 500 : 300);
                }
            }

            // Red 3s
            let r3Val = (red3s.length === 4) ? 800 : (red3s.length * 100);
            details.red3Points = hasMelded ? r3Val : -r3Val;

            // Deductions
            pIndices.forEach(idx => {
                let handPoints = this.players[idx].reduce((sum, c) => sum + c.value, 0);
                details.deductions -= handPoints; 
                
                if (idx === winnerSeat) {
                    // Standard Go Out Bonus
                    details.goOutBonus = 100; 
                    // Concealed Bonus (Extra 100)
                    if (isConcealed) details.goOutBonus += 100; 
                }
            });

            details.total = details.basePoints + details.canastaBonus + details.red3Points + details.deductions + details.goOutBonus;
            return details;
        };

        return {
            team1: calcTeam(this.team1Melds, this.team1Red3s, [0, 2]),
            team2: calcTeam(this.team2Melds, this.team2Red3s, [1, 3])
        };
    }

    discardFromHand(playerIndex, cardIndex) {
        if (playerIndex !== this.currentPlayer || this.turnPhase !== "playing") return { success: false, message: "Draw first!" };

        let hand = this.players[playerIndex];
        let card = hand[cardIndex];

        // GOING OUT LOGIC
        if (hand.length === 1) {
            let teamMelds = (playerIndex % 2 === 0) ? this.team1Melds : this.team2Melds;
            
            // 1. Check for Canasta (Required to go out)
            let hasCanasta = false;
            for (let rank in teamMelds) {
                if (teamMelds[rank].length >= 7) { hasCanasta = true; break; }
            }
            if (!hasCanasta) return { success: false, message: "Need Canasta to go out." };
            
            // 2. Process the "Go Out"
            hand.splice(cardIndex, 1);
            this.discardPile.push(card);
            
            this.turnPhase = "game_over"; 
            // Calculate detailed scores passing the player who went out
            this.finalScores = this.calculateScores(playerIndex); 
            console.log(`ROUND OVER: Player ${playerIndex} went out.`);
            return { success: true, message: "GAME_OVER" };
        }
        // Normal Discard
        hand.splice(cardIndex, 1);
        this.discardPile.push(card);
        this.turnPhase = "draw";
        this.currentPlayer = (this.currentPlayer + 1) % 4;
        return { success: true };
    }

getOpeningReq(score) {
        if (score < 0) return 15;
        if (score < 1500) return 50;
        if (score < 3000) return 90;
        return 120;
    }
// New Method: Handles the "Atomic" opening logic
    processOpening(seat, meldsData, wantPickup) {
        const requiredPhase = wantPickup ? "draw" : "playing";
        if (seat !== this.currentPlayer || this.turnPhase !== requiredPhase) 
            return { success: false, message: "Not your turn or wrong phase!" };

        let hand = [...this.players[seat]];
        let topCard = this.discardPile[this.discardPile.length - 1];
        let totalPoints = 0;
        let usedIndices = new Set();
        
        // 1. Validation Logic
        if (wantPickup) {
        if (!topCard) return { success: false, message: "Pile is empty." };
        if (topCard.rank === "3") return { success: false, message: "Cannot pick up pile with Black 3s." };
        let keyMeld = meldsData[0]; 
        let keyCards = keyMeld.indices.map(i => hand[i]);

        // --- FIX START: Allow Wilds, but enforce 2 Naturals ---
        let naturalCount = 0;
        for (let c of keyCards) {
            // Check for illegal cards (wrong rank AND not wild)
            if (!c.isWild && c.rank !== topCard.rank) {
                return { success: false, message: "Pickup meld contains mismatched natural cards." };
            }
            // Count matching naturals
            if (!c.isWild && c.rank === topCard.rank) {
                naturalCount++;
            }
        }
        
        if (naturalCount < 2) {
            return { success: false, message: "Must use at least 2 NATURAL cards matching top card." };
        }
        // --- FIX END ---

        totalPoints += topCard.value;
    }

        for (let index = 0; index < meldsData.length; index++) {
        let m = meldsData[index];
        let cards = m.indices.map(i => hand[i]);
        
        // Check for duplicate card usage
        for(let i of m.indices) {
            if (usedIndices.has(i)) return { success: false, message: "Cannot use same card twice." };
            usedIndices.add(i);
        }

        let meldRank = m.rank; 
        if (meldRank === "3") {
                if (cards.some(c => c.isWild)) return { success: false, message: "Black 3s cannot contain Wilds." };
                let remainingAfterOpen = hand.length - totalCardsUsing;
                if (remainingAfterOpen !== 0) return { success: false, message: "Black 3s allowed only when going out." };
            }
        let wildCount = 0;
        for (let c of cards) {
            if (!c.isWild && c.rank !== meldRank) return { success: false, message: "Mixed ranks in " + meldRank };
            if (c.isWild) wildCount++;
        }
        
        if (wildCount > cards.length - 2) return { success: false, message: "Too many wilds in " + meldRank + "s." };

        // FIX: THE "GHOST CARD" EXCEPTION
        // If we are picking up, the first meld (index 0) gets a "free pass" on the count
        // because we know the top discard card will be added to it shortly.
        let minRequired = 3;
        if (wantPickup && index === 0) {
            minRequired = 2;
        }

        if (cards.length < minRequired) {
            return { success: false, message: "Meld " + meldRank + "s must have " + minRequired + "+ cards." };
        }

        totalPoints += cards.reduce((sum, c) => sum + c.value, 0);
    }

        let teamScore = (seat % 2 === 0) ? this.cumulativeScores.team1 : this.cumulativeScores.team2;
        let required = this.getOpeningReq(teamScore);
        if (totalPoints < required) return { success: false, message: "Need " + required + " points. You have " + totalPoints + "." };

        // --- NEW: ILLEGAL GO-OUT CHECK ---
        let cardsInHand = hand.length;
        let cardsUsed = usedIndices.size;
        let cardsRemaining = cardsInHand - cardsUsed;
        
        // Predict Canasta Creation
        let teamMelds = (seat % 2 === 0) ? this.team1Melds : this.team2Melds;
        let willHaveCanasta = Object.values(teamMelds).some(p => p.length >= 7); 
        
        // Check new melds for Canasta
        meldsData.forEach(m => {
            let existingLen = teamMelds[m.rank] ? teamMelds[m.rank].length : 0;
            let addedLen = m.indices.length;
            if (wantPickup && m === meldsData[0]) addedLen++; 
            if (existingLen + addedLen >= 7) willHaveCanasta = true;
        });

        if (cardsRemaining <= 1 && !willHaveCanasta) {
            return { success: false, message: "Cannot go out (or hold 1 card) without a Canasta!" };
        }

        // --- EXECUTION PHASE ---
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

        // Remove used cards
        let allUsedIndices = [];
        meldsData.forEach(m => allUsedIndices.push(...m.indices));
        allUsedIndices.sort((a,b) => b-a);
        allUsedIndices.forEach(idx => this.players[seat].splice(idx, 1));

        this.sortHand(seat);

        // --- NEW: CONCEALED CANASTA / INSTANT WIN CHECK ---
        if (this.players[seat].length === 0) {
            this.turnPhase = "game_over";
            // Passed 'true' for isConcealed
            this.finalScores = this.calculateScores(seat, true); 
            console.log(`ROUND OVER: Player ${seat} went out Concealed!`);
            return { success: true, message: "GAME_OVER" };
        }

        this.turnPhase = "playing"; 
        return { success: true };
    }
}
module.exports = { CanastaGame };