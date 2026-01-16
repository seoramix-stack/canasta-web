// bot.js

class CanastaBot {
    constructor(seat) {
        this.seat = seat;
        // No difficulty modes anymore. Just one "Best Strategy".
        
        // --- STRATEGY MEMORY ---
        this.seenDiscards = {}; 
        this.partnerSignaled = false; 
    }

    // --- PARTNER INTERACTION ---
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
        let pCount = game.players.length;
        if (pCount === 4) {
            let partnerSeat = (this.seat + 2) % pCount;
            if (playerSeat === partnerSeat) {
                this.partnerSignaled = card.isWild;
            }
        }
    }

    async executeTurn(game, broadcastFunc) {
        const delay = (ms) => new Promise(res => setTimeout(res, ms));
        
        // Safety check
        if (!game.players[this.seat]) return;

        let realDeckSize = this.getRealDeckSize(game);
        let isLastTurn = realDeckSize < 7; 
        
        // --- PHASE 1: DRAW ---
        // Only draw if we haven't already (e.g. if we are resuming a turn)
        let hasDrawn = (game.players[this.seat].length > 11 && game.config.PLAYER_COUNT === 4) || 
                       (game.players[this.seat].length > 15 && game.config.PLAYER_COUNT === 2);
        
        // A better check: The server dictates phase. Rely on game.turnPhase.
        // But since we are inside the bot logic, let's just attempt to draw.
        
        let drawResult = { success: false };

        let pile = game.discardPile;
        let topCard = pile.length > 0 ? pile[pile.length - 1] : null;
        let wantPile = false;

        if (topCard) {
            let hand = game.players[this.seat];
            let myMelds = this.getMyMelds(game);
            
            if (this.canTakePile(game, hand, topCard, myMelds)) {
                if (isLastTurn) {
                    wantPile = true; 
                } else {
                    let pileValue = this.evaluatePile(pile);
                    if (pileValue > 50) wantPile = true; 
                    if (myMelds[topCard.rank] && myMelds[topCard.rank].length >= 5) {
                        wantPile = true;
                    }
                }
            }
        }

        if (wantPile) {
            let res = game.pickupDiscardPile(this.seat);
            if (!res.success) {
                // Fallback to deck if pickup fails
                drawResult = game.drawFromDeck(this.seat); 
            } else {
                drawResult = res;
            }
        } else {
            drawResult = game.drawFromDeck(this.seat);
        }
        
        // If the draw failed (e.g. "Not your turn" or "Wrong Phase"), 
        // we might already have drawn. Let's assume we proceed ONLY if we have a playable hand.
        
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
            
            let res = game.discardFromHand(this.seat, discardIndex);
            
            if (!res.success) {
                console.log(`[BOT WARNING] Seat ${this.seat} failed to discard index ${discardIndex}: ${res.message}`);
                
                // CRITICAL FIX: IF we failed because "Draw first!", try drawing now!
                if (res.message === "Draw first!") {
                    console.log(`[BOT RECOVERY] Attempting emergency draw for Seat ${this.seat}...`);
                    game.drawFromDeck(this.seat);
                    // Try discarding again immediately (index might have shifted, pick 0 to be safe)
                    game.discardFromHand(this.seat, 0); 
                } 
                // Fallback: Panic discard 
                else if (game.players[this.seat].length > 0) {
                    game.discardFromHand(this.seat, 0);
                }
            }
            
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
        // If we just picked up the pile (huge hand), meld naturals to safe points
        if (hand.length > 14) {
             this.meldNaturals(game);
             return;
        }

        // FIX #2: REMOVED "EARLY GAME" LOCK.
        // If we can open, we SHOULD open.
        
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
        let myMelds = this.getMyMelds(game);
        let candidates = [];

        hand.forEach((card, index) => {
            let score = 0; 

            // --- LAST TURN ---
            if (isLastTurn) {
                // Discard highest value to save points
                score -= this.getCardPointValue(card); 
            } 
            // --- NORMAL STRATEGY ---
            else {
                // A. Base Penalties
                if (card.isWild) score += 2000; 
                if (card.isRed3) score += 5000; 
                
                // B. FIX #1: POINT CONSERVATION
                // Add the card's own value to the score.
                // Discarding a 4 (5pts) adds +5. Discarding a King (10pts) adds +10.
                // Since we sort ascending (lowest score = best discard), this encourages keeping high cards.
                score += this.getCardPointValue(card); 

                // C. FIX #3: TEAM LOYALTY
                // Never discard a card that WE are collecting.
                if (myMelds[card.rank] && !card.isWild) {
                    score += 5000; 
                }

                // D. Enemy Safety
                // If enemy has this melded, DO NOT FEED.
                if (enemyMelds[card.rank] && !card.isWild) {
                     score += 5000; 
                }

                // E. Partner Signal (Frozen Pile)
                if (this.partnerSignaled) {
                    // If partner froze the pile, ONLY discard 100% safe cards.
                    if (!this.isCardSafe(card, game)) score += 10000; 
                }

                // F. "Rule of 8" Safety Calculation
                // If card is mathematically safe, huge bonus (subtraction)
                if (this.isCardSafe(card, game)) {
                    score -= 1000; 
                } else {
                    score += 100; // Risky discard penalty
                }
            }
            candidates.push({ index, score });
        });

        // Sort: Lowest score is the best card to throw
        candidates.sort((a, b) => a.score - b.score);
        return candidates[0].index;
    }

    // --- MELDING LOGIC ---

    meldMax(game) {
        // Greedy algorithm to dump hand
        let changed = true;
        while(changed) {
            changed = false;
            let hand = game.players[this.seat];
            let myMelds = this.getMyMelds(game);
            
            // Loop backwards to splice safely
            for (let i = hand.length - 1; i >= 0; i--) {
                let c = hand[i];
                
                // 1. Try to add Natural to existing meld
                if (myMelds[c.rank]) {
                    let res = game.meldCards(this.seat, [i], c.rank);
                    if (res.success) changed = true;
                }
                // 2. Try to add Wild
                else if (c.isWild) {
                    let bestRank = null;
                    
                    // FIX #4: PANIC DUMP FOR WILDS
                    // First priority: Non-completed Canastas (<7 cards)
                    for(let rank in myMelds) {
                        if (myMelds[rank].length < 7) {
                             bestRank = rank; 
                             break; 
                        }
                    }
                    
                    // Second priority (Panic): ANY meld. 
                    // Better to put a Wild on a closed Canasta (+50pts) than keep it in hand (-50pts).
                    if (!bestRank && Object.keys(myMelds).length > 0) {
                        bestRank = Object.keys(myMelds)[0];
                    }

                    if (bestRank) {
                        let res = game.meldCards(this.seat, [i], bestRank);
                        if (res.success) changed = true;
                    }
                }
            }
        }
        // After dumping singles/wilds, try to form NEW melds
        this.meldNaturals(game);
    }

    attemptToOpen(game) {
        let hand = game.players[this.seat];
        let groups = {};
        hand.forEach((c, i) => {
            if (c.isWild) return;
            if (!groups[c.rank]) groups[c.rank] = [];
            groups[c.rank].push(i);
        });
        
        // Find all natural groups of 3+
        let potentialMelds = [];
        for (let r in groups) {
            if (groups[r].length >= 3) {
                potentialMelds.push({ indices: groups[r], rank: r });
            }
        }
        
        if (potentialMelds.length > 0) {
            let myScore = (this.seat % 2 === 0) ? game.cumulativeScores.team1 : game.cumulativeScores.team2;
            let req = game.getOpeningReq(myScore);
            
            // Calculate total points of these potential melds
            let currentPts = 0;
            potentialMelds.forEach(m => {
                m.indices.forEach(idx => currentPts += this.getCardPointValue(hand[idx]));
            });
            
            // If we meet the requirement, OPEN IMMEDIATELY
            if (currentPts >= req) {
                game.processOpening(this.seat, potentialMelds, false);
            }
        }
    }

    meldNaturals(game) {
        // Tries to form new melds from hand (3+ naturals)
        let changed = true;
        while (changed) {
            changed = false;
            let hand = game.players[this.seat];
            let groups = {};
            
            hand.forEach((c, i) => {
                if (c.isWild) return;
                if (!groups[c.rank]) groups[c.rank] = [];
                groups[c.rank].push(i);
            });

            const ranks = Object.keys(groups);
            for (let rank of ranks) {
                if (groups[rank].length >= 3) {
                    let res = game.meldCards(this.seat, groups[rank], rank);
                    if (res.success) {
                        changed = true;
                        break; 
                    }
                }
            }
        }
    }
    
    meldToCreateTargets(game) {
        // Reuse logic: creates any natural groups it can, to give partner places to play wilds
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
        let pCount = game.players.length; 
        let oppSeat = (this.seat + 1) % pCount; 
        
        if (!game.players[oppSeat]) return false;

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