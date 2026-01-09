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

export function handleServerAnimations(oldData, newData) {
    if (!oldData || !newData) return;

    // 1. Self Draw Animation
    if (oldData.hand.length < newData.hand.length) {
        // ... (Logic to find new card)
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
                // Delay slightly to allow React-like render in UI to finish
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
    // ... (You can add the Opponent Draw logic here if needed, keeping it simple for now)
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