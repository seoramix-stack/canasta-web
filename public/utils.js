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

/**
 * Calculates the visible step size (offset) for items in a container.
 * @param {number} availableSpace - Total container width or height.
 * @param {number} itemSize - Dimension of one item (card width/height).
 * @param {number} count - Number of items.
 * @param {number} defaultStep - Preferred spacing when plenty of room.
 * @param {number} minStep - Minimum spacing allowed (squeeze limit).
 * @returns {number} The positive step size (e.g., 25px).
 */
export function calculateStepSize(availableSpace, itemSize, count, defaultStep, minStep) {
    if (count <= 1) return defaultStep;

    // How much space do we have for the "spine" (total minus the last card)
    const availableForSteps = availableSpace - itemSize;
    
    // Calculate the step needed to fit exactly
    const requiredStep = availableForSteps / (count - 1);
    
    // Clamp result: Max = defaultStep (don't spread too thin), Min = minStep
    return Math.max(minStep, Math.min(defaultStep, requiredStep));
}