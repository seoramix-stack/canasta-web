// animations.js
import { state } from './state.js';

// Added 'fadeOut' parameter (default false)
export function flyCard(sourceRect, destRect, imageSrc, delay = 0, onComplete = null, fadeOut = false) {
    // Safety Check: If destination is missing (e.g. game ended), abort
    if (!destRect || destRect.width === 0) return;

    const refEl = document.getElementById('draw-area');
    const stdW = refEl ? refEl.offsetWidth : 50; 
    const stdH = refEl ? refEl.offsetHeight : 70;

    setTimeout(() => {
        const flyer = document.createElement("img");
        flyer.src = imageSrc;
        flyer.className = "flying-card";
        
        const srcCenterX = sourceRect.left + (sourceRect.width / 2);
        const srcCenterY = sourceRect.top + (sourceRect.height / 2);
        
        flyer.style.width = stdW + "px";
        flyer.style.height = stdH + "px";
        flyer.style.left = (srcCenterX - stdW / 2) + "px";
        flyer.style.top = (srcCenterY - stdH / 2) + "px";
        
        // Ensure starting opacity is 1
        flyer.style.opacity = "1";
        
        document.body.appendChild(flyer);
        // Force reflow
        flyer.getBoundingClientRect(); 

        const destCenterX = destRect.left + (destRect.width / 2);
        const destCenterY = destRect.top + (destRect.height / 2);
        const deltaX = destCenterX - srcCenterX;
        const deltaY = destCenterY - srcCenterY;
        
        flyer.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        
        // --- NEW: FADE OUT LOGIC ---
        if (fadeOut) {
            flyer.style.opacity = "0"; 
        }

        setTimeout(() => {
            flyer.remove();
            if (onComplete) onComplete();
        }, 500); // Duration matches CSS .flying-card transition
    }, delay);
}

// REPLACE THIS FUNCTION IN animations.js
export function animatePlayerDiscard(cardIndex, cardData, renderCallback) {
    const allHandCards = document.querySelectorAll('#my-hand .hand-card-wrap');
    const targetEl = allHandCards[cardIndex];
    const discardArea = document.getElementById('discard-area');

    if (targetEl && discardArea) {
        const srcRect = targetEl.getBoundingClientRect();
        const destRect = discardArea.getBoundingClientRect();
        
        // SAFETY CHECK: Only animate if both elements are actually visible
        if (srcRect.width > 0 && destRect.width > 0) {
            // 1. LOCK: Tell UI to show the OLD pile state
            state.discardAnimationActive = true;
            
            const imgUrl = getCardImage(cardData); // Show Face Up
            targetEl.style.opacity = "0"; 

            // 2. FLY:
            flyCard(srcRect, destRect, imgUrl, 0, () => {
                // 3. UNLOCK: Animation done.
                state.discardAnimationActive = false;
                
                // 4. TRIGGER: Force UI to re-render the pile
                if (renderCallback && state.activeData) renderCallback(state.activeData);
            });
        }
    }
}

export function animateMeld(indices, rank) {
    // 1. Target the Specific Rank Pile
    // The ID format comes from your ui.js logic: `meld-pile-my-${rank}`
    // If the pile doesn't exist yet (new meld), we default to the container center.
    const pileId = `meld-pile-my-${rank}`;
    let destRect = null;
    
    const pileEl = document.getElementById(pileId);
    const container = document.getElementById('my-melds');

    // 2. Determine Destination
    if (pileEl) {
        // SCENARIO A: ADDING TO EXISTING MELD
        // Find the last card currently in this pile
        const existingCards = pileEl.querySelectorAll('.meld-card');
        
        if (existingCards.length > 0) {
            const lastCard = existingCards[existingCards.length - 1];
            const lastRect = lastCard.getBoundingClientRect();
            
            // Calculate the "Next Spot" in the cascade.
            // In ui.js, the vertical margin (vertMargin) determines the overlap.
            // On desktop (~105px height), the visible strip is small (~20px).
            // We want to land roughly on top of the last card, shifted down by that visible strip.
            
            const isDesktop = window.innerWidth > 800;
            const offsetStep = isDesktop ? 22 : 18; // Matches 'visibleStrip' from ui.js
            
            destRect = {
                left: lastRect.left,
                top: lastRect.top + offsetStep, 
                width: lastRect.width,
                height: lastRect.height
            };
        } else {
            // Pile exists but empty (rare edge case), fallback to pile header
            destRect = pileEl.getBoundingClientRect();
        }
    } 
    
    // SCENARIO B: NEW MELD (Pile doesn't exist yet)
    // We target the "my-melds" container, but we try to estimate where the NEW pile will appear.
    // Since flexbox adds to the right, we aim for the rightmost edge of the container.
    if (!destRect && container) {
        const cRect = container.getBoundingClientRect();
        // Default to centering it vertically, but placing it at the end horizontally
        destRect = {
            left: cRect.right - 60, // Approximate width of a card group
            top: cRect.top + (cRect.height / 2) - 40, 
            width: 50,
            height: 70
        };
    }

    // Safety fallback
    if (!destRect) return;

    // 3. Launch Animations
    const handCards = document.querySelectorAll('#my-hand .hand-card-wrap');

    indices.forEach((idx, i) => {
        const cardEl = handCards[idx];
        if (cardEl) {
            const srcRect = cardEl.getBoundingClientRect();
            
            // Image: Face Up
            const img = cardEl.querySelector('img');
            const src = img ? img.src : "cards/BackRed.png";

            // Hide immediately
            cardEl.style.opacity = "0";

            // If we are moving multiple cards at once (e.g. melding 3 Kings),
            // we should stagger their destinations slightly so they don't all land on the exact same pixel.
            const staggerOffset = i * 20; 
            
            const finalDest = {
                ...destRect,
                top: destRect.top + staggerOffset
            };

            // Call flyCard with fadeOut = true 
            // (We fade out because the UI update will redraw the new static card instantly upon server confirmation)
            flyCard(srcRect, finalDest, src, 0, null, true);
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

        // Only animate for opponents (we handled our own locally)
        if (actorSeat !== -1 && actorSeat !== state.mySeat) {
            const actorHandDiv = getHandDiv(actorSeat);
            const discardArea = document.getElementById('discard-area');

            if (actorHandDiv && discardArea) {
                const srcRect = actorHandDiv.getBoundingClientRect();
                const destRect = discardArea.getBoundingClientRect();

                // SAFETY CHECK: Only animate if visible
                if (srcRect.width > 0 && destRect.width > 0) {
                    // 1. LOCK
                    state.discardAnimationActive = true;

                    const imgUrl = getCardImage(newData.topDiscard);

                    // 2. FLY
                    flyCard(srcRect, destRect, imgUrl, 0, () => {
                        // 3. UNLOCK & TRIGGER
                        state.discardAnimationActive = false;
                        // CRITICAL FIX: We now use the renderCallback passed in the arguments
                        if (renderCallback && state.activeData) renderCallback(state.activeData);
                    });
                }
            }
        }
    }

    // --- 2. DETECT DRAWS (Opponents Only) ---
    for (let i = 0; i < 4; i++) {
        if (i === state.mySeat) continue; 

        const oldSize = oldData.handSizes ? oldData.handSizes[i] : 0;
        const newSize = newData.handSizes ? newData.handSizes[i] : 0;

        if (newSize > oldSize) {
            const deckDecreased = (newData.deckSize < oldData.deckSize);
            const handDiv = getHandDiv(i);
            const drawArea = document.getElementById('draw-area');     
            const discardArea = document.getElementById('discard-area'); 

            if (handDiv) {
                let srcRect = null;
                const imgUrl = "cards/BackRed.png"; 

                if (deckDecreased && drawArea) {
                    srcRect = drawArea.getBoundingClientRect();
                } else if (discardArea) {
                    srcRect = discardArea.getBoundingClientRect();
                }

                if (srcRect) {
                    const destRect = handDiv.getBoundingClientRect();
                    flyCard(srcRect, destRect, imgUrl, 0);
                }
            }
        }
    }

    // --- 3. LOCAL PLAYER DRAW ---
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
    // 1. MY SEAT
    if (seatIndex === state.mySeat) return document.getElementById('my-hand');

    // 2. 2-PLAYER MODE OVERRIDE
    if (state.currentPlayerCount === 2) {
        // In 2P, the only other player (Opponent) is always mapped to the TOP (Partner) slot.
        return document.getElementById('hand-partner');
    }

    // 3. STANDARD 4-PLAYER MAPPING
    const rel = (seatIndex - state.mySeat + 4) % 4;
    if (rel === 1) return document.getElementById('hand-left');
    if (rel === 2) return document.getElementById('hand-partner');
    if (rel === 3) return document.getElementById('hand-right');
    
    return null;
}