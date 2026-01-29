// utils.js

/**
 * Adds a "tap" listener that works instantly on mobile and desktop.
 * Replaces standard onclick to remove the 300ms mobile delay.
 */
export function addTapListener(element, callback) {
    if (!element) return;

    // We use 'pointerup' which is the modern standard for both mouse & touch
    element.addEventListener('pointerup', (e) => {
        // Prevent default browser behaviors (like zooming or selecting text)
        e.preventDefault(); 
        
        // Execute the action
        callback(e);
    }, { passive: false });
}