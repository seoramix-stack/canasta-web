// bot.js

class CanastaBot {
    constructor(seat, difficulty = 'hard') {
        this.seat = seat;
        this.difficulty = difficulty;
        
        // --- STRATEGY MEMORY ---
        this.seenDiscards = {}; 
        this.partnerSignaled = false; 
    }

    decideGoOutPermission(game) {
        let hand = game.players[this.seat];
        
        // 1. If I have a Red 3 in hand, NEVER let partner go out. Massive penalty.
        if (hand.some(c => c.isRed3)) return false;

        // 2. Calculate penalty of my hand
        let handPenalty = 0;
        hand.forEach(c => handPenalty += this.getCardPointValue(c));

        // 3. Threshold: If I hold > 150 points, say NO.
        if (handPenalty > 150) return false;

        return true; // "Yes, go ahead!"
    }

    observeDiscard(card, playerSeat, game) {
        if (!card) return;
        
        // 1. Memory: Count the card for "Rule of 8" logic
        if (!this.seenDiscards[card.rank]) this.seenDiscards[card.rank] = 0;
        this.seenDiscards[card.rank]++;

        // 2. Partner Signal Check
        let partnerSeat = (this.seat + 2) % 4;
        if (playerSeat === partnerSeat) {
            this.partnerSignaled = card.isWild;
        }
    }

    async executeTurn(game, broadcastFunc) {
        const delay = (ms) => new Promise(res => setTimeout(res, ms));
        
        let realDeckSize = this.getRealDeckSize(game);
        let isLastTurn = realDeckSize < 7; 

        // --- PHASE 1: DRAW ---
        let pile = game.discardPile;
        let topCard = pile.length > 0 ? pile[pile.length - 1] : null;
        let wantPile = false;

        if (topCard) {
            let hand = game.players[this.seat];
            let myMelds = this.getMyMelds(game);
            
            if (this.canTakePile(game, hand, topCard, myMelds)) {
                // If last turn, ALWAYS take to maximize melding options
                if (isLastTurn) {
                    wantPile = true;
                } else {
                    let pileValue = this.evaluatePile(pile);
                    // Take if valuable OR if it helps us open
                    if (pileValue > 50) wantPile = true; 
                    else if (this.difficulty === 'hard' && pile.length < 2) wantPile = false;
                }
            }
        }

        if (wantPile) {
            let res = game.pickupDiscardPile(this.seat);
            if (!res.success) game.drawFromDeck(this.seat); 
        } else {
            game.drawFromDeck(this.seat);
        }
        
        broadcastFunc(this.seat);
        await delay(1000);

        // --- PHASE 2: MELD ---
        this.executeMeldingStrategy(game, isLastTurn);
        
        broadcastFunc(this.seat);
        await delay(800);

        // --- PHASE 3: DISCARD ---
        if (game.players[this.seat].length > 0) {
            let discardIndex = this.pickDiscard(game, isLastTurn);
            
            let cardToThrow = game.players[this.seat][discardIndex];
            this.observeDiscard(cardToThrow, this.seat, game); 
            
            game.discardFromHand(this.seat, discardIndex);
            broadcastFunc(this.seat);
        }
    }

    // --- STRATEGY CORE ---

    executeMeldingStrategy(game, isLastTurn) {
        let hand = game.players[this.seat];
        let myMelds = this.getMyMelds(game);
        let hasOpened = Object.keys(myMelds).length > 0;
        
        // 1. PANIC / LAST TURN: DUMP EVERYTHING
        let panicMode = this.checkPanicMode(game);
        
        if (isLastTurn || panicMode) {
            this.meldMax(game); 
            return;
        }

        // 2. NORMAL PLAY
        let deckSize = this.getRealDeckSize(game);
        let earlyGame = (deckSize > 37);

        // If we just picked up the pile, we might have a huge hand. 
        // We should meld naturals to be safe, but keep wilds.
        if (hand.length > 14) {
             this.meldNaturals(game);
             return;
        }

        if (earlyGame) return; // Strict early game patience

        // Mid-Late Game Logic:
        // If we haven't opened yet, check if we CAN open to avoid getting stuck
        if (!hasOpened) {
            this.attemptToOpen(game);
        } else {
            // If already opened, ensure we have targets for partner
            this.meldToCreateTargets(game);
        }
    }

    pickDiscard(game, isLastTurn) {
        let hand = game.players[this.seat];
        let enemyMelds = (this.seat % 2 === 0) ? game.team2Melds : game.team1Melds;
        let candidates = [];

        hand.forEach((card, index) => {
            let score = 0; 

            // --- LAST TURN ---
            if (isLastTurn) {
                // Discard highest value to save points
                score -= this.getCardPointValue(card); 
            } 
            // --- NORMAL ---
            else {
                if (card.isWild) score += 2000; 
                if (card.isRed3) score += 5000; 
                
                // CRITICAL FIX: DO NOT FEED THE ENEMY
                // If enemy has this rank melded, it is NOT safe. It is deadly.
                if (enemyMelds[card.rank] && !card.isWild) {
                     score += 5000; // Massive penalty
                }

                // Partner Freeze Logic
                if (this.partnerSignaled) {
                    if (!this.isCardSafe(card, game)) score += 10000; 
                }

                // "Rule of 8" Safety
                if (this.isCardSafe(card, game)) {
                    score -= 1000; // Encourage discarding safe cards
                } else {
                    score += 100; // Risky
                }
            }
            candidates.push({ index, score });
        });

        candidates.sort((a, b) => a.score - b.score);
        return candidates[0].index;
    }

    // --- MELDING LOGIC (IMPLEMENTED) ---

    // 1. Meld EVERYTHING possible (for panic/endgame)
    meldMax(game) {
        // A. Try to add to existing melds first (Loop multiple times to handle new openings)
        let changed = true;
        while(changed) {
            changed = false;
            let hand = game.players[this.seat];
            let myMelds = this.getMyMelds(game);
            
            // Loop backwards to splice safely
            for (let i = hand.length - 1; i >= 0; i--) {
                let c = hand[i];
                // Try to add to EXISTING meld
                if (myMelds[c.rank]) {
                    let res = game.meldCards(this.seat, [i], c.rank);
                    if (res.success) changed = true;
                }
                // Try to add Wilds to ANY valid meld (prioritize Canastas or large melds)
                else if (c.isWild) {
                    // Find best target: Close to Canasta (6 cards) > High Value > Any
                    let bestRank = null;
                    for(let rank in myMelds) {
                        if (myMelds[rank].length < 7) {
                             bestRank = rank; 
                             break; 
                        }
                    }
                    if (bestRank) {
                        let res = game.meldCards(this.seat, [i], bestRank);
                        if (res.success) changed = true;
                    }
                }
            }
        }
        
        // B. Try to create NEW melds from remaining hand
        this.meldNaturals(game); // Reuse this logic
    }

    // 2. Open cleanly if we meet requirements
    attemptToOpen(game) {
        let hand = game.players[this.seat];
        // Group by rank
        let groups = {};
        hand.forEach((c, i) => {
            if (c.isWild) return;
            if (!groups[c.rank]) groups[c.rank] = [];
            groups[c.rank].push(i);
        });
        
        // Identify pure naturals >= 3
        let potentialMelds = [];
        for (let r in groups) {
            if (groups[r].length >= 3) {
                potentialMelds.push({ indices: groups[r], rank: r });
            }
        }
        
        if (potentialMelds.length > 0) {
            // Check points
            let myScore = (this.seat % 2 === 0) ? game.cumulativeScores.team1 : game.cumulativeScores.team2;
            let req = game.getOpeningReq(myScore);
            
            let currentPts = 0;
            potentialMelds.forEach(m => {
                m.indices.forEach(idx => currentPts += this.getCardPointValue(hand[idx]));
            });
            
            if (currentPts >= req) {
                // FIX: Use processOpening to send ALL melds atomically.
                // This prevents index shifting errors and ensures total points logic holds.
                game.processOpening(this.seat, potentialMelds, false);
            }
        }
    }

    // 3. Create targets for partner (Naturals >= 3)
    // FIX: Updated to handle Index Invalidation via Loop-Restart
    meldNaturals(game) {
        let changed = true;
        
        while (changed) {
            changed = false;
            let hand = game.players[this.seat];
            let groups = {};
            
            // 1. Re-calculate groups based on CURRENT hand indices
            hand.forEach((c, i) => {
                if (c.isWild) return;
                if (!groups[c.rank]) groups[c.rank] = [];
                groups[c.rank].push(i);
            });

            // 2. Find ONE valid group to meld
            // We only meld ONE group per iteration because melding invalidates indices.
            // After a successful meld, we break and restart the loop (changed=true).
            const ranks = Object.keys(groups);
            
            // Optional: Sort ranks to prioritize Aces/Kings?
            // ranks.sort(...) 

            for (let rank of ranks) {
                if (groups[rank].length >= 3) {
                    let res = game.meldCards(this.seat, groups[rank], rank);
                    if (res.success) {
                        changed = true;
                        break; // BREAK LOOP: Indices are now garbage. Re-scan.
                    }
                }
            }
        }
    }
    
    meldToCreateTargets(game) {
        this.meldNaturals(game);
    }

    // --- HELPERS ---

    getMyMelds(game) {
        return (this.seat % 2 === 0) ? game.team1Melds : game.team2Melds;
    }

    canTakePile(game, hand, topCard, myMelds) {
        if (topCard.isWild || topCard.rank === '3') return false;
        
        // 1. Can we add to existing meld?
        if (myMelds[topCard.rank]) return true;

        // 2. Do we have 2 naturals in hand?
        let naturals = hand.filter(c => c.rank === topCard.rank && !c.isWild).length;
        if (naturals >= 2) return true;

        return false; 
    }

    evaluatePile(pile) {
        let value = 0;
        pile.forEach(c => value += this.getCardPointValue(c));
        return value;
    }

    getRealDeckSize(game) {
        let visibleDeckCount = game.deck.length;
        let team1R3 = game.team1RedThrees || [];
        let team2R3 = game.team2RedThrees || [];
        let visibleR3 = team1R3.length + team2R3.length;
        let missingR3 = 4 - visibleR3;
        return visibleDeckCount - missingR3; 
    }

    checkPanicMode(game) {
        let oppSeat = (this.seat + 1) % 4; 
        let oppHandSize = game.players[oppSeat].length;
        let oppMelds = (this.seat % 2 !== 0) ? game.team1Melds : game.team2Melds;
        
        let canastaCount = 0;
        let bigMeldCount = 0;

        for (let rank in oppMelds) {
            if (oppMelds[rank].length >= 7) canastaCount++;
            else if (oppMelds[rank].length >= 5) bigMeldCount++;
        }

        if (canastaCount >= 1 && bigMeldCount >= 1 && oppHandSize <= 5) {
            return true;
        }
        return false;
    }

    isCardSafe(card, game) {
        if (card.isWild) return true;
        let rank = card.rank;
        
        let inHand = game.players[this.seat].filter(c => c.rank === rank).length;
        
        let tableCount = 0;
        [game.team1Melds, game.team2Melds].forEach(teamMelds => {
            if (teamMelds[rank]) tableCount += teamMelds[rank].length;
        });

        let inTrash = this.seenDiscards[rank] || 0;
        let totalSeen = inHand + tableCount + inTrash;

        // "Rule of 8": If 7 cards are accounted for, the 8th is safe (cannot make a pair)
        if (totalSeen >= 7) return true; 
        return false;
    }

    getCardPointValue(card) {
        if (card.rank === 'Joker') return 50;
        if (card.rank === '2' || card.rank === 'A') return 20;
        if (['8','9','10','J','Q','K'].includes(card.rank)) return 10;
        return 5; 
    }
}

module.exports = { CanastaBot };