// animations.js
import { state } from './state.js';

export function flyCard(sourceRect, destRect, imageSrc, delay = 0, onComplete = null) {
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
        
        document.body.appendChild(flyer);
        // Force reflow
        flyer.getBoundingClientRect(); 

        const destCenterX = destRect.left + (destRect.width / 2);
        const destCenterY = destRect.top + (destRect.height / 2);
        const deltaX = destCenterX - srcCenterX;
        const deltaY = destCenterY - srcCenterY;
        
        flyer.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
        
        setTimeout(() => {
            flyer.remove();
            if (onComplete) onComplete();
        }, 500);
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
        
        // 3. Get Image URL
        const imgUrl = "cards/BackRed.png";

        // --- VISUAL POLISH: Hide the original card so it looks like it "left" your hand ---
        targetEl.style.opacity = "0"; 

        // 4. Fly!
        flyCard(srcRect, destRect, imgUrl, 0);
    }
}

export function handleServerAnimations(oldData, newData) {
    if (!oldData || !newData) return;

    // --- 1. DETECT DISCARDS (Opponents Only) ---
    // Logic: If the top card of the discard pile changed, the person whose turn it WAS likely discarded it.
    const getSig = (c) => c ? (c.rank + c.suit) : "null";
    const oldTop = oldData.topDiscard;
    const newTop = newData.topDiscard;

    if (getSig(oldTop) !== getSig(newTop) && newTop) {
        const actorSeat = oldData.currentPlayer; // The player who just finished their turn

        // Only animate if it wasn't ME (I handle my own animations optimistically)
        if (actorSeat !== -1 && actorSeat !== state.mySeat) {
            const actorHandDiv = getHandDiv(actorSeat);
            const discardArea = document.getElementById('discard-area');

            if (actorHandDiv && discardArea) {
                // Fly the card image from their hand to the pile
                const srcRect = actorHandDiv.getBoundingClientRect();
                const destRect = discardArea.getBoundingClientRect();
                const imgUrl = getCardImage(newTop);

                flyCard(srcRect, destRect, imgUrl, 0);
            }
        }
    }

    // --- 2. DETECT DRAWS (Opponents Only) ---
    // Logic: Loop through all seats. If a hand grew larger, they drew cards.
    for (let i = 0; i < 4; i++) {
        if (i === state.mySeat) continue; // Skip me

        const oldSize = oldData.handSizes ? oldData.handSizes[i] : 0;
        const newSize = newData.handSizes ? newData.handSizes[i] : 0;

        if (newSize > oldSize) {
            // They gained cards. Determine source (Deck vs Pile).
            const deckDecreased = (newData.deckSize < oldData.deckSize);
            const handDiv = getHandDiv(i);
            const drawArea = document.getElementById('draw-area');     // Deck
            const discardArea = document.getElementById('discard-area'); // Pile

            if (handDiv) {
                let srcRect = null;
                // Opponents usually draw face-down (BackRed), unless picking up the pile
                const imgUrl = "cards/BackRed.png"; 

                if (deckDecreased && drawArea) {
                    // Standard Draw
                    srcRect = drawArea.getBoundingClientRect();
                } else if (discardArea) {
                    // Pile Pickup (Deck didn't decrease, but hand grew)
                    srcRect = discardArea.getBoundingClientRect();
                }

                if (srcRect) {
                    const destRect = handDiv.getBoundingClientRect();
                    flyCard(srcRect, destRect, imgUrl, 0);
                }
            }
        }
    }

    // --- 3. LOCAL PLAYER DRAW (Keep existing logic) ---
    // This handles the visual update for YOUR draw if it wasn't optimistic
    if (oldData.hand && newData.hand && oldData.hand.length < newData.hand.length) {
         // ... (Keep your existing Self-Draw logic here if you haven't moved it to optimistic UI) ...
         // If you have moved completely to optimistic UI for draws, you can remove this block.
         // Otherwise, ensure it only runs if the animation hasn't played yet.
         // For safety, the existing logic I saw in your file is good to keep:
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


// ... existing code ...

export function animateMeld(indices, rank) {
    let destRect;
    
    // 1. Try to find the existing pile
    const existingPileId = `meld-pile-my-${rank}`;
    const existingEl = document.getElementById(existingPileId);

    if (existingEl) {
        // CASE A: Add to existing pile -> Fly to that pile
        destRect = existingEl.getBoundingClientRect();
    } else {
        // CASE B: New Meld -> The "Ghost Target" Technique
        const container = document.getElementById('my-melds');
        if (!container) return;

        // 1. Create a dummy element that mimics a real meld group
        const ghost = document.createElement('div');
        ghost.className = 'meld-group';
        ghost.style.visibility = 'hidden'; // Invisible
        ghost.style.position = 'absolute'; // Prevent it from breaking layout permanently
        // (Note: We use 'absolute' here so we don't cause a visual jump, 
        // but we position it relative to the container to measure)
        
        // Actually, to get the TRUE flexbox position, we should let it flow, 
        // measure it, and remove it before the browser repaints.
        ghost.style.position = 'static'; 
        
        // Add a dummy card so it has the correct width/height
        ghost.innerHTML = `<div class='meld-container'><img src="cards/BackRed.png" class="card-img meld-card"></div>`;

        // 2. Append, Measure, Remove (Synchronous -> User won't see a flicker)
        container.appendChild(ghost);
        destRect = ghost.getBoundingClientRect();
        container.removeChild(ghost);
    }

    if (!destRect) return;

    // 2. Get Hand Elements to fly
    const handCards = document.querySelectorAll('#my-hand .hand-card-wrap');

    // 3. Launch Animations
    indices.forEach(idx => {
        const cardEl = handCards[idx];
        if (cardEl) {
            const srcRect = cardEl.getBoundingClientRect();
            
            // Get the real image to fly (Face Up is better for melds)
            const img = cardEl.querySelector('img');
            const src = img ? img.src : "cards/BackRed.png";

            // Hide the card in hand immediately (prevents "duplicate" look)
            cardEl.style.opacity = "0";

            // Fly to the calculated Ghost Target
            flyCard(srcRect, destRect, src, 0);
        }
    });
}