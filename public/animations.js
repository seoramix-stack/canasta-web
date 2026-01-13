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

export function animatePlayerDiscard(cardIndex, cardData) {
    // 1. Find the specific DOM element in the hand
    const allHandCards = document.querySelectorAll('#my-hand .hand-card-wrap');
    const targetEl = allHandCards[cardIndex];
    const discardArea = document.getElementById('discard-area');

    if (targetEl && discardArea) {
        // 2. Get Coordinates
        const srcRect = targetEl.getBoundingClientRect();
        const destRect = discardArea.getBoundingClientRect();
        
        // 3. Get Image URL (BackRed masks duplicate glitch)
        const imgUrl = "cards/BackRed.png";

        // Hide original immediately
        targetEl.style.opacity = "0"; 

        // 4. Fly!
        flyCard(srcRect, destRect, imgUrl, 0);
    }
}

// --- OPTION 2: "THE DISSOLVE" ---
export function animateMeld(indices, rank) {
    // 1. Target the General Meld Container
    const container = document.getElementById('my-melds');
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    
    // 2. Get Hand Elements to fly
    const handCards = document.querySelectorAll('#my-hand .hand-card-wrap');

    // 3. Launch Animations
    indices.forEach(idx => {
        const cardEl = handCards[idx];
        if (cardEl) {
            const srcRect = cardEl.getBoundingClientRect();
            
            // Image: Face Up is better for melds so we see what we played
            const img = cardEl.querySelector('img');
            const src = img ? img.src : "cards/BackRed.png";

            // Hide the card in hand immediately
            cardEl.style.opacity = "0";

            // --- CALCULATE MIDPOINT DESTINATION ---
            // Instead of flying to the exact spot (which might be wrong),
            // we fly 50% of the way towards the center of the meld area.
            
            const srcCx = srcRect.left + srcRect.width/2;
            const srcCy = srcRect.top + srcRect.height/2;
            
            const contCx = containerRect.left + containerRect.width/2;
            const contCy = containerRect.top + containerRect.height/2;

            // Interpolate 50% (0.5)
            const midX = srcCx + (contCx - srcCx) * 0.5;
            const midY = srcCy + (contCy - srcCy) * 0.5;

            // Create a fake rect for the destination
            const midRect = {
                left: midX - srcRect.width/2,
                top: midY - srcRect.height/2,
                width: srcRect.width,
                height: srcRect.height
            };

            // Call flyCard with fadeOut = true
            flyCard(srcRect, midRect, src, 0, null, true);
        }
    });
}

export function handleServerAnimations(oldData, newData) {
    if (!oldData || !newData) return;

    // --- 1. DETECT DISCARDS (Opponents Only) ---
    // Improved Logic: Check for Phase Transition (Playing -> Draw/GameOver)
    // This implies the player finished their turn by discarding (or going out).
    
    const wasPlaying = oldData.phase === 'playing';
    const nowDrawOrEnd = (newData.phase === 'draw' || newData.phase === 'game_over');
    
    // Also verify the pile top card actually changed (avoids animation if floating out)
    const getSig = (c) => c ? (c.rank + c.suit) : "null";
    const oldTop = oldData.topDiscard;
    const newTop = newData.topDiscard;
    const pileChanged = getSig(oldTop) !== getSig(newTop);

    if (wasPlaying && nowDrawOrEnd && newTop && pileChanged) {
        const actorSeat = oldData.currentPlayer; // The player who just finished their turn

        if (actorSeat !== -1 && actorSeat !== state.mySeat) {
            const actorHandDiv = getHandDiv(actorSeat);
            const discardArea = document.getElementById('discard-area');

            if (actorHandDiv && discardArea) {
                const srcRect = actorHandDiv.getBoundingClientRect();
                const destRect = discardArea.getBoundingClientRect();
                
                // For opponents, we show the FACE of the card so you see what they threw.
                const imgUrl = getCardImage(newTop);

                flyCard(srcRect, destRect, imgUrl, 0);
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
    const rel = (seatIndex - state.mySeat + 4) % 4;
    if (rel === 0) return document.getElementById('my-hand');
    if (rel === 1) return document.getElementById('hand-left');
    if (rel === 2) return document.getElementById('hand-partner');
    if (rel === 3) return document.getElementById('hand-right');
    return null;
}