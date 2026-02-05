import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
    appId: 'club.canastamaster.app',
    appName: 'Canasta Master Club',
    webDir: 'www',
    server: {
      url: 'http://192.168.68.51:8080',
      cleartext: true
    },
    // LOCAL TESTING: Comment this out to load from local files
    // server: {
    //     url: 'https://canastamaster.club',
    //     cleartext: false
    // },
    android: {
        // Allow mixed content for development if needed
        allowMixedContent: false
    }
};

export default config;
