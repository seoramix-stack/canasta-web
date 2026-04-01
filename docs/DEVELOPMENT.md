# Canasta Web - Development & Debugging Guide

## Setup & Running

### Prerequisites
- Node.js 16+
- MongoDB (local or cloud connection)
- .env file with:
  ```
  JWT_SECRET=your-secret-key
  MONGO_URI=mongodb://localhost/canasta
  STRIPE_SECRET_KEY=sk_test_...
  STRIPE_WEBHOOK_SECRET=whsec_...
  ```

### Development Workflow
```bash
# Install dependencies
npm install

# Start dev server (port 8080 with live reload)
npm run dev

# Alternative: Full server in dev mode
npm run dev:full

# Production build & run
npm start
```

## Frontend Debugging

### Console Access (Dev Tools)
- `window.state` - Inspect global game state
- `state.socket.emit('act_play_card', {card, meldIdx})` - Test game actions
- `localStorage.getItem('playerToken')` - View auth token

### Common UI Issues
| Issue | Fix |
|-------|-----|
| Screen won't show | Check `display: none` in `index.html`, use `UI.navTo()` |
| Navigation stuck | Check socket connection status in console |
| Mobile layout broken | Verify viewport meta tag, check `style.css` media queries |
| State not syncing | Check WebSocket tab in DevTools, verify server sending events |

### Modifying Screens
1. Edit HTML in `www/index.html` - add div with `id="screen-name"`
2. Add CSS styling to `www/style.css`
3. Add navigation handler in `www/ui.js` if special logic needed
4. Use `state` global for reactive updates

## Backend Debugging

### Common Server Issues
```bash
# Port already in use?
lsof -i :3000  # Check what's running
kill -9 <PID>  # Kill process

# MongoDB connection error?
# Verify MONGO_URI in .env and MongoDB is running
mongosh "your-connection-string"

# JWT validation failing?
# Ensure JWT_SECRET matches client expectations
```

### Testing API Endpoints
```bash
# Register user
curl -X POST http://localhost:3000/api/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass"}'

# Login
curl -X POST http://localhost:3000/api/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"testpass"}'

# Get profile (include token from login response)
curl http://localhost:3000/api/profile \
  -H "Authorization: <JWT_TOKEN>"
```

### Socket Debugging
In browser console:
```javascript
// Listen to all socket events
state.socket.onAny((event, ...args) => {
  console.log('Socket event:', event, args);
});

// Send game action
state.socket.emit('act_play_card', {
  card: { suit: 'hearts', rank: 'A' },
  meldIndex: 0
});
```

## Game Logic Debugging

### Understanding Game State
```javascript
// In browser console after game starts
console.log(state.gameState);
// Shows: hands[], melds[], discard[], deck[], phase, currentPlayer, scores[]
```

### Common Game Issues
| Issue | Check |
|-------|-------|
| Cards disappearing | Check `www/game.js` `removeCard()` function |
| Invalid melts accepted | Verify `validateMeld()` logic in game.js |
| Wrong score calculated | Check scoring in game.js `calculateRoundScore()` |
| Player turn stuck | Look for socket emit failures, check queue logic |

### Testing Bot Skills
```bash
# Run simulations
node scripts/simulator.js --rounds 100

# Check bot decision-making
node -e "const {CanastaBot} = require('./scripts/bot.js'); const bot = new CanastaBot(); console.log(bot.evaluateHand(...))"
```

## Performance & Optimization

### Client-Side Profiling
```javascript
// Measure game engine performance
console.time('game-tick');
// ... game code ...
console.timeEnd('game-tick');

// Monitor socket latency
console.time('round-trip');
state.socket.emit('ping_server', Date.now());
```

### Network Inspection
- Open Network tab in DevTools
- Filter by `fetch` and `wss` (WebSocket)
- Look for large payloads in game_state_update events
- Check for repeated failed requests

## Android/Capacitor Development

### Building for Android
```bash
# Sync web assets
npx cap sync

# Copy to Android
npx cap copy

# Build APK
cd android && ./gradlew assembleDebug

# Install on device
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

### Mobile-Specific Issues
- **Touch lag**: Check animation frame rate in `www/animations.js`
- **Status bar visible**: Verify StatusBar.hide() in `www/client.js`
- **Offline play**: Ensure Service Worker configured correctly in `www/sw.js`

## Code Organization Best Practices

### Adding New Features
1. **UI Screen**: Add to `www/index.html`
2. **Styling**: Add to `www/style.css`
3. **State**: Add to `www/state.js` if needed
4. **Logic**: Put in `www/ui.js` or separate module
5. **API**: Add endpoint in `server.js`
6. **Database**: Update `models/user.js` schema if needed

### Code Review Checklist
- [ ] No hardcoded credentials or secrets
- [ ] JWT token used for auth (not cookies)
- [ ] Socket events validated on server
- [ ] Database queries use parameterized queries
- [ ] All APIs rate-limited
- [ ] Errors logged, not silently caught
- [ ] Mobile responsive design tested
- [ ] Performance impact minimal (< 100ms)

## Git Workflow
```bash
# Create feature branch
git checkout -b feature/new-feature-name

# Make changes, test locally
npm run dev

# Commit with clear message
git commit -m "Add new feature: description"

# Push and create pull request
git push origin feature/new-feature-name
```

## Useful Commands
```bash
# Clear all caches & rebuild
rm -rf node_modules package-lock.json
npm install && npm run dev

# Check for unused dependencies
npx depcheck

# Analyze bundle size
npm install --save-dev webpack-bundle-analyzer

# Run linter (if added)
npm run lint

# View MongoDB data
mongosh
> use canasta
> db.users.find()
```
