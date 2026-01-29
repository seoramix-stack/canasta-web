import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'club.canastamaster.app',
    appName: 'Canasta Master Club',
    webDir: 'public',
    server: {
        // Production: loads from your live server
        url: 'https://canastamaster.club',
        cleartext: false
    },
    android: {
        // Allow mixed content for development if needed
        allowMixedContent: false
    }
};

export default config;
