import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'club.canastamaster.app',
    appName: 'Canasta Master Club',
    webDir: 'www',
    server: {
        url: 'https://canastamaster.club',
        cleartext: false,
        allowNavigation: ['canastamaster.club']
    },
    android: {
        // Allow mixed content for development if needed
        allowMixedContent: false
    },
    plugins: {
        SystemBars: {
            // Hide system navigation bar for immersive experience
            hidden: true,
            // Use fade animation when showing/hiding
            animation: 'FADE'
        }
    }
};

export default config;
