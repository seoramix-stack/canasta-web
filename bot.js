// bot.js

class CanastaBot {
    constructor(seat) {
        this.seat = seat;
        this.seenDiscards = {}; 
        this.partnerSignaled = false; 
    }

    // --- PARTNER INTERACTION ---
    decideGoOutPermission(game) {
        let hand = game.players[this.seat];
        if (hand.some(c => c.isRed3)) return false;

        let handPenalty = 0;
        hand.forEach(c => handPenalty += this.getCardPointValue(c));
        if (handPenalty > 150) return false;

        return true; 
    }

    observeDiscard(card, playerSeat, game) {
        if (!card) return;
        if (!this.seenDiscards[card.rank]) this.seenDiscards[card.rank] = 0;
        this.seenDiscards[card.rank]++;

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
        let drawResult = { success: false, message: "Skipped" };

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

        // ---------------------------------------------------------
        // [CRITICAL FIX] STOP EXECUTION IF DRAW FAILED
        // ---------------------------------------------------------
        if (!drawResult.success) {
            // Check for valid Resume scenarios
            const isAlreadyPlaying = (game.turnPhase === 'playing' && game.currentPlayer === this.seat);
            const isGameOver = (drawResult.message === "GAME_OVER_DECK_EMPTY");

            if (isAlreadyPlaying) {
                console.log(`[BOT RESUME] Seat ${this.seat} resuming turn in 'playing' phase.`);
                // Allow proceeding to Meld/Discard
            } 
            else if (isGameOver) {
                console.log(`[BOT END] Seat ${this.seat} triggered End of Deck.`);
                // Allow proceeding so server can handle game over
            } 
            else {
                // REAL FAILURE: Stop to prevent infinite loop
                console.error(`[BOT STOP] Seat ${this.seat} Draw Failed: ${drawResult.message}`);
                return; // <--- This 'return' breaks the loop
            }
        }
        // ---------------------------------------------------------

        broadcastFunc(this.seat);
        await delay(1000);

        // --- PHASE 2: MELD ---
        this.executeMeldingStrategy(game, isLastTurn);
        
        broadcastFunc(this.seat);
        await delay(800);

        // --- PHASE 3: DISCARD ---
        if (game.players[this.seat].length > 0) {
            let discardIndex = this.pickDiscard(game, isLastTurn);
            
            // Validate the card exists before acting
            if (game.players[this.seat][discardIndex]) {
                let cardToThrow = game.players[this.seat][discardIndex];
                this.observeDiscard(cardToThrow, this.seat, game); 
                
                let res = game.discardFromHand(this.seat, discardIndex);
                
                if (!res.success) {
                    console.warn(`[BOT WARNING] Seat ${this.seat} failed to discard index ${discardIndex}: ${res.message}`);
                    
                    // Fallback: Discard index 0 just to pass the turn
                    if (game.players[this.seat].length > 0) {
                        game.discardFromHand(this.seat, 0);
                    }
                }
                
                broadcastFunc(this.seat);
            }
        }
    }

    // --- STRATEGY CORE ---

    executeMeldingStrategy(game, isLastTurn) {
        let hand = game.players[this.seat];
        let myMelds = this.getMyMelds(game);
        let hasOpened = Object.keys(myMelds).length > 0;
        
        let panicMode = this.checkPanicMode(game);
        
        if (isLastTurn || panicMode) {
            this.meldMax(game); 
            return;
        }

        if (hand.length > 14) {
             this.meldNaturals(game);
             return;
        }

        if (!hasOpened) {
            this.attemptToOpen(game);
        } else {
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
            if (isLastTurn) {
                score -= this.getCardPointValue(card); 
            } else {
                if (card.isWild) score += 2000; 
                if (card.isRed3) score += 5000; 
                score += this.getCardPointValue(card); 

                if (myMelds[card.rank] && !card.isWild) score += 5000; 
                if (enemyMelds[card.rank] && !card.isWild) score += 5000; 
                if (this.partnerSignaled) {
                    if (!this.isCardSafe(card, game)) score += 10000; 
                }
                if (this.isCardSafe(card, game)) score -= 1000; 
                else score += 100;
            }
            candidates.push({ index, score });
        });

        candidates.sort((a, b) => a.score - b.score);
        return candidates.length > 0 ? candidates[0].index : 0;
    }

    // --- MELDING LOGIC ---

    meldMax(game) {
        let changed = true;
        while(changed) {
            changed = false;
            let hand = game.players[this.seat];
            let myMelds = this.getMyMelds(game);
            
            for (let i = hand.length - 1; i >= 0; i--) {
                let c = hand[i];
                if (myMelds[c.rank]) {
                    let res = game.meldCards(this.seat, [i], c.rank);
                    if (res.success) changed = true;
                }
                else if (c.isWild) {
                    let bestRank = null;
                    for(let rank in myMelds) {
                        if (myMelds[rank].length < 7) { bestRank = rank; break; }
                    }
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
        
        let potentialMelds = [];
        for (let r in groups) {
            if (groups[r].length >= 3) {
                potentialMelds.push({ indices: groups[r], rank: r });
            }
        }
        
        if (potentialMelds.length > 0) {
            let myScore = (this.seat % 2 === 0) ? game.cumulativeScores.team1 : game.cumulativeScores.team2;
            let req = game.getOpeningReq(myScore);
            
            let currentPts = 0;
            potentialMelds.forEach(m => {
                m.indices.forEach(idx => currentPts += this.getCardPointValue(hand[idx]));
            });
            
            if (currentPts >= req) {
                game.processOpening(this.seat, potentialMelds, false);
            }
        }
    }

    meldNaturals(game) {
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
                    if (res.success) { changed = true; break; }
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
        if (myMelds[topCard.rank]) return true;
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
        if (canastaCount >= 1 && bigMeldCount >= 1 && oppHandSize <= 5) return true;
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