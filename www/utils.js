export function addTapListener(element, callback) {
    if (!element) return;

    let startX = 0;
    let startY = 0;

    element.addEventListener('pointerdown', (e) => {
        startX = e.clientX;
        startY = e.clientY;
    });

    element.addEventListener('pointerup', (e) => {
        const diffX = Math.abs(e.clientX - startX);
        const diffY = Math.abs(e.clientY - startY);

        if (diffX < 10 && diffY < 10) {
            e.preventDefault();
            callback(e);
        }
    }, { passive: false });
}

export function calculateStepSize(totalTime, elapsed) {
    return Math.max(0, Math.min(100, (elapsed / totalTime) * 100));
}