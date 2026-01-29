// animations.js
import { state } from './state.js';

// Updated flyCard: Returns the flyer element and adds 'persist' option
export function flyCard(sourceRect, destRect, imageSrc, delay = 0, onComplete = null, fadeOut = false, persist = false) {
    if (!destRect || destRect.width === 0) return null;

    const refEl = document.getElementById('draw-area');
    const stdW = refEl ? refEl.offsetWidth : 50; 
    const stdH = refEl ? refEl.offsetHeight : 70;

    // 1. Create the element immediately (in memory)
    const flyer = document.createElement("img");
    flyer.src = imageSrc;
    flyer.className = "flying-card"; // Make sure your CSS defines transition: transform 0.5s, opacity 0.5s
    
    // Set initial dimensions and position immediately
    const srcCenterX = sourceRect.left + (sourceRect.width / 2);
    const srcCenterY = sourceRect.top + (sourceRect.height / 2);
    
    flyer.style.width = stdW + "px";
    flyer.style.height = stdH + "px";
    flyer.style.left = (srcCenterX - stdW / 2) + "px";
    flyer.style.top = (srcCenterY - stdH / 2) + "px";
    flyer.style.opacity = "1";

    // 2. Schedule the animation
    setTimeout(() => {
        document.body.appendChild(flyer);
        // Force reflow
        flyer.getBoundingClientRect(); 

        const destCenterX = destRect.left + (destRect.width / 2);
        const destCenterY = destRect.top + (destRect.height / 2);
        const deltaX = destCenterX - srcCenterX;
        const deltaY = destCenterY - srcCenterY;
        
        flyer.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        
        if (fadeOut) {
            flyer.style.opacity = "0"; 
        }

        setTimeout(() => {
            // If onComplete (rendering) crashes, we MUST still remove the card
            try {
                if (onComplete) onComplete();
            } catch (err) {
                console.error("Animation callback failed:", err);
                // Force reset state if render crashed
                state.discardAnimationActive = false;
                state.meldAnimationActive = false;
            }

            // Only remove automatically if persist is FALSE
            if (!persist) {
                // Use requestAnimationFrame to ensure the underlying UI has painted first
                requestAnimationFrame(() => {
                    if (flyer.parentNode) flyer.remove();
                });
            }
        }, 500); // Duration matches CSS .flying-card transition
    }, delay);

    // 3. Return the element so the caller can track/remove it manually if needed
    return flyer;
}

export function animatePlayerDiscard(cardIndex, cardData, renderCallback) {
    const allHandCards = document.querySelectorAll('#my-hand .hand-card-wrap');
    const targetEl = allHandCards[cardIndex];
    const discardArea = document.getElementById('discard-area');

    if (targetEl && discardArea) {
        const srcRect = targetEl.getBoundingClientRect();
        const destRect = discardArea.getBoundingClientRect();
        
        if (srcRect.width > 0 && destRect.width > 0) {
            state.discardAnimationActive = true;
            
            const imgUrl = getCardImage(cardData);
            targetEl.style.opacity = "0"; 

            const flyer = flyCard(srcRect, destRect, imgUrl, 0, () => {
                state.discardAnimationActive = false;
                if (renderCallback && state.activeData) renderCallback(state.activeData);
            });

            if (!flyer) {
                state.discardAnimationActive = false;
                targetEl.style.opacity = "1"; // Restore card if animation failed
            }
        }
    }
}

function calculateMeldTarget(container, rank) {
    if (!container) return null;

    const rankPriority = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3"];
    const isDesktop = window.innerWidth > 800;
    const groupWidth = isDesktop ? 75 : 50;
    const groupHeight = isDesktop ? 105 : 70;
    const suffix = (container.id === 'my-melds') ? 'my' : 'enemy';
    const pileId = `meld-pile-${suffix}-${rank}`;
    const pileEl = document.getElementById(pileId);

    // --- 1. DETERMINE SEARCH CONTAINER & BASE COORDINATES ---
    let searchContainer = container;
    
    // On Mobile, open melds live in the 2nd child (Right Column) of the grid
    if (!isDesktop && container.children.length >= 2) {
        searchContainer = container.children[1]; 
    }

    // Get the EXACT position of where the meld area starts
    const cRect = searchContainer.getBoundingClientRect();
    let startX, startY;

    if (isDesktop) {
        startX = cRect.left + 160;
        if (cRect.height > groupHeight) {
            startY = cRect.top + (cRect.height - groupHeight) / 2;
        } else {
            startY = cRect.top;
        }
    } else {
        // Mobile Logic (Kept same as previous fix)
        startX = cRect.left;
        startY = cRect.top;
        if (startX === 0 && startY === 0) {
             const parentRect = container.getBoundingClientRect();
             startX = parentRect.left + 34 + 50 + 1; 
             startY = parentRect.top;
        }
    }

    // --- 2. STRATEGY A: PILE ALREADY EXISTS ---
    if (pileEl) {
        const existingCards = pileEl.querySelectorAll('.meld-card');
        if (existingCards.length > 0) {
            const lastCard = existingCards[existingCards.length - 1];
            const lastRect = lastCard.getBoundingClientRect();
            
            if (lastRect.width > 0 && lastRect.left >= startX - 5) {
                const offsetStep = isDesktop ? 22 : 18;
                return {
                    left: lastRect.left,
                    top: lastRect.top + offsetStep,
                    width: lastRect.width,
                    height: lastRect.height
                };
            }
        }
        
        const pileRect = pileEl.getBoundingClientRect();
        if (pileRect.width > 0 && pileRect.left >= startX - 5) {
            return pileRect;
        }
    }

    // --- 3. STRATEGY B: NEW PILE (CALCULATE SLOT) ---
    const existingGroups = Array.from(searchContainer.children).filter(el => el.classList.contains('meld-group'));
    const newRankIdx = rankPriority.indexOf(rank);
    let pivotElement = null;

    // Find insertion point (Rank Descending: A, K, Q...)
    for (let group of existingGroups) {
        const idParts = group.id.split('-');
        const groupRank = idParts[idParts.length - 1];
        const gIdx = rankPriority.indexOf(groupRank);
        if (gIdx > newRankIdx) {
            pivotElement = group;
            break;
        }
    }

    let destRect = null;

    if (pivotElement) {
        // Insert BEFORE pivot
        const pivotRect = pivotElement.getBoundingClientRect();
        // Use pivot's position, but ensure we don't go left of startX
        const finalX = (pivotRect.width > 0) ? pivotRect.left : startX;

        // Visual Slide Effect for existing groups
        let current = pivotElement;
        const totalSlotWidth = groupWidth + (isDesktop ? 20 : 5);
        while (current) {
            if (current.classList.contains('meld-group')) {
                current.style.transition = "transform 0.4s cubic-bezier(0.25, 1, 0.5, 1)";
                current.style.transform = `translateX(${totalSlotWidth}px)`;
            }
            current = current.nextElementSibling;
        }
        
        destRect = {
            left: finalX,
            top: pivotRect.top || startY,
            width: groupWidth,
            height: isDesktop ? 105 : 70
        };
    } else {
        // Append to END
        if (existingGroups.length > 0) {
            const lastGroup = existingGroups[existingGroups.length - 1];
            const lastRect = lastGroup.getBoundingClientRect();
            const margin = isDesktop ? 15 : 5;
            
            // Use last group's position + margin
            const finalX = (lastRect.width > 0) ? (lastRect.right + margin) : startX;
            
            destRect = {
                left: finalX,
                top: lastRect.top || startY,
                width: groupWidth,
                height: isDesktop ? 105 : 70
            };
        } else {
            // First Meld! Directly use the calculated start positions
            destRect = {
                left: startX,
                top: startY,
                width: groupWidth,
                height: isDesktop ? 105 : 70
            };
        }
    }
    
    // FINAL SAFETY: Ensure we never target to the left of our container start
    if (destRect.left < startX) {
        destRect.left = startX;
    }

    return destRect;
}

export function animateMeld(indices, rank, renderCallback) {
    const container = document.getElementById('my-melds');
    const destRect = calculateMeldTarget(container, rank); 

    if (!destRect) return;

    state.meldAnimationActive = true;

    const handCards = document.querySelectorAll('#my-hand .hand-card-wrap');
    let cardsFinished = 0;
    const totalCards = indices.length;
    
    // Collect flyers to remove them strictly AFTER the UI updates
    const flyers = [];

    indices.forEach((idx, i) => {
        const cardEl = handCards[idx];
        if (cardEl) {
            const srcRect = cardEl.getBoundingClientRect();
            const img = cardEl.querySelector('img');
            const src = img ? img.src : "cards/BackRed.png";
            
            cardEl.style.opacity = "0";
            
            const staggerOffset = i * 20;
            const finalDest = { ...destRect, top: destRect.top + staggerOffset };
            
            // Pass persist: true
            const f = flyCard(srcRect, finalDest, src, 0, () => {
                cardsFinished++;
                
                if (cardsFinished === totalCards) {
                    state.meldAnimationActive = false;
                    
                    if (renderCallback && state.activeData) {
                        renderCallback(state.activeData);
                    }
                    
                    // FIX: Remove all local flyers now that UI is rendered
                    requestAnimationFrame(() => {
                        flyers.forEach(el => el.remove());
                    });
                }
            }, false, true); // fadeOut=false, persist=true
            
            if(f) flyers.push(f);
        }
    });
}

export function handleServerAnimations(oldData, newData, renderCallback) {
    if (!oldData || !newData) return;

    const wasPlaying = oldData.phase === 'playing';
    const nowDrawOrEnd = (newData.phase === 'draw' || newData.phase === 'game_over');
    const getSig = (c) => c ? (c.rank + c.suit) : "null";
    
    // --- 1. DETECT DISCARDS (Opponents Only) ---
    if (wasPlaying && nowDrawOrEnd && getSig(oldData.topDiscard) !== getSig(newData.topDiscard)) {
        const actorSeat = oldData.currentPlayer; 

        if (actorSeat !== -1 && actorSeat !== state.mySeat) {
            const actorHandDiv = getHandDiv(actorSeat);
            const discardArea = document.getElementById('discard-area');

            if (actorHandDiv && discardArea) {
                const srcRect = actorHandDiv.getBoundingClientRect();
                const destRect = discardArea.getBoundingClientRect();

                if (srcRect.width > 0 && destRect.width > 0) {
                    state.discardAnimationActive = true;
                    const imgUrl = getCardImage(newData.topDiscard);

                    const flyer = flyCard(srcRect, destRect, imgUrl, 0, () => {
                        state.discardAnimationActive = false; // Unlock
                        if (renderCallback && state.activeData) renderCallback(state.activeData);
                    });
                    
                    // If flyCard returned null (failed to start), force unlock IMMEDIATELY
                    if (!flyer) {
                        state.discardAnimationActive = false;
                    }
                }
            }
        }
    }
    
    // --- 2. DETECT MELDS (Opponents & Partner) ---
    const checkMelds = (teamKey) => {
        const oldMelds = oldData[teamKey] || {};
        const newMelds = newData[teamKey] || {};
        
        Object.keys(newMelds).forEach(rank => {
            const oldPile = oldMelds[rank] || [];
            const newPile = newMelds[rank];
            const diff = newPile.length - oldPile.length;

            if (diff > 0) {
                const actor = oldData.currentPlayer;
                if (actor === -1 || actor === state.mySeat) return; 

                const myTeam = (state.mySeat % 2 === 0) ? 1 : 2;
                const actorTeam = (actor % 2 === 0) ? 1 : 2;
                const containerId = (myTeam === actorTeam) ? 'my-melds' : 'enemy-melds';
                const container = document.getElementById(containerId);

                state.meldAnimationActive = true;

                const destRect = calculateMeldTarget(container, rank);
                if (!destRect) {
                    state.meldAnimationActive = false;
                    return;
                }

                const handDiv = getHandDiv(actor);
                if (!handDiv) {
                    state.meldAnimationActive = false;
                    return;
                }
                const srcRect = handDiv.getBoundingClientRect();

                let cardsAnimated = 0;
                const flyers = []; // Store references

                for (let i = 0; i < diff; i++) {
                    const cardData = newPile[oldPile.length + i];
                    const imgUrl = getCardImage(cardData);

                    const staggerOffset = i * 20;
                    const finalDest = { ...destRect, top: destRect.top + staggerOffset };

                    // FIX: Use persist=true so cards don't vanish individually
                    const f = flyCard(srcRect, finalDest, imgUrl, i * 80, () => {
                        cardsAnimated++;
                        
                        if (cardsAnimated === diff) {
                            state.meldAnimationActive = false;
                            
                            // 1. Render UI (Real cards appear)
                            if (renderCallback) renderCallback(state.activeData);

                            // 2. Remove animations (Now that real cards are visible)
                            requestAnimationFrame(() => {
                                flyers.forEach(el => el.remove());
                            });
                        }
                    }, false, true);
                    
                    if(f) flyers.push(f);
                }
            }
        });
    };

    checkMelds('team1Melds');
    checkMelds('team2Melds');
    
    // --- 3. DETECT DRAWS (Opponents Only) ---
    for (let i = 0; i < 4; i++) {
        if (i === state.mySeat) continue; 

        // CHANGE: Compare handBacks arrays instead of handSizes numbers
        const oldBacks = (oldData.handBacks && oldData.handBacks[i]) ? oldData.handBacks[i] : [];
        const newBacks = (newData.handBacks && newData.handBacks[i]) ? newData.handBacks[i] : [];
        
        // If the new hand has more cards than before
        if (newBacks.length > oldBacks.length) {
            const handDiv = getHandDiv(i);
            const drawArea = document.getElementById('draw-area');     

            if (handDiv && drawArea) {
                let srcRect = drawArea.getBoundingClientRect(); 
                if (srcRect) {
                    // CHANGE: Grab the color of the *last* card added to the hand
                    // Default to 'Red' if undefined to prevent errors
                    const newCardColor = newBacks[newBacks.length - 1] || 'Red';
                    const imgName = `cards/Back${newCardColor}.png`;

                    flyCard(srcRect, handDiv.getBoundingClientRect(), imgName, 0);
                }
            }
        }
    }

    // --- 4. LOCAL PLAYER DRAW ---
    if (oldData.hand && newData.hand && oldData.hand.length < newData.hand.length) {
         const getCounts = (hand) => {
            const counts = {};
            hand.forEach(c => { const key = c.rank + c.suit; counts[key] = (counts[key] || 0) + 1; });
            return counts;
        };
        const oldC = getCounts(oldData.hand);
        const newC = getCounts(newData.hand);
        
        newData.hand.forEach((c, index) => {
            const key = c.rank + c.suit;
            if ((oldC[key] || 0) < (newC[key] || 0)) {
                setTimeout(() => {
                    const myHandImages = document.querySelectorAll('#my-hand .hand-card-wrap img');
                    const targetImg = myHandImages[index];
                    if (targetImg) {
                        targetImg.style.opacity = '0';
                        const deckRect = document.getElementById('draw-area').getBoundingClientRect();
                        const destRect = targetImg.getBoundingClientRect();
                        flyCard(deckRect, destRect, getCardImage(c), 0, () => {
                            targetImg.style.opacity = '1';
                        });
                    }
                }, 50); 
                newC[key]--;
            }
        });
    }
}

export function getCardImage(card) {
    if (card.rank === "Joker") return "cards/JokerRed.png"; 
    return "cards/" + card.rank + card.suit.charAt(0) + ".png";
}

export function getHandDiv(seatIndex) {
    if (seatIndex === state.mySeat) return document.getElementById('my-hand');
    if (state.currentPlayerCount === 2) {
        return document.getElementById('hand-partner');
    }
    const rel = (seatIndex - state.mySeat + 4) % 4;
    if (rel === 1) return document.getElementById('hand-left');
    if (rel === 2) return document.getElementById('hand-partner');
    if (rel === 3) return document.getElementById('hand-right');
    return null;
}