# Canasta Game Rules & Implementation

## Game Basics (3-5 Minute Overview)

### Players & Scoring
- **2 players**: Solo vs Solo (each is their own team)
- **4 players**: Partner-based (teams of 2)
- **Win condition**: First team to 5000 points wins match
- **Round-based**: Play until someone goes out, calculate score, repeat

### Turn Actions
1. **Draw**: Must draw 1 card (or 2+ from discard under conditions)
2. **Meld**: Play card groups/sequences to table (optional)
3. **Discard**: End turn by placing 1 card face-up

### Card Values
- **Red 3s**: +100 pts each (bonus, cannot be played)
- **Black 3s**: -300 pts if in hand (penalty unplayed)
- **Numbered cards**: Face value (4=4pts, 10=10pts)
- **Aces**: 20 pts (can be low or high)
- **Face cards**: 20 pts each
- **2s (Deuces)**: Wild cards (20 pts, match any rank)

### Melding (Creating Sets)
**Natural sequences** (consecutive cards, same suit):
- Min 3 cards to meld (Ace-2-3 or higher)
- Must be correct suit

**Wild sequences** (using 2s/Jokers):
- Mix natural + 2s (2 cannot exceed natural cards)
- Example: ♥3-♥4-♥(2-acting-as-5) is valid

**Sets** (same rank):
- Min 3 cards minimum
- Example: ♠7-♣7-♦7 is valid

**Canasta** (special bonus):
- 7-card+ meld = +500 pts (natural)
- 7-card+ with wild = +300 pts
- Counts toward team victory condition

### Going Out & Ending Round
**Go Out**: Discard last card → round ends immediately
- **Bonus**: +100 pts if partner has melded (2-player: always get bonus)
- **Loss**: -50 pts if red 3 not played (shown face-up at start)

## Implementation Code Map

### Core Game Engine
`www/game.js` implements:
- **CanastaGame class**: Main game logic
  - `constructor(players, ruleset)` 
  - `drawCard(playerIdx)` - Draw from deck
  - `drawFromDiscard(playerIdx)` - Draw face-up cards (only if melds)
  - `playCard(playerIdx, card, meldIdx)` - Add card to table
  - `discard(playerIdx, card)` - End turn
  - `validateMeld(cards)` - Check if sequence/set is legal
  - `calculateRoundScore(teamScores)` - Final scoring
  - `checkGoOut(playerIdx)` - Determine if round ended
  - `nextPhase()` - Advance turn order

### Deck & Cards
`www/deck.js`:
- Standard 2x52 deck (2 decks combined for 4-player)
- Card representation: `{suit, rank, id}`
- `shuffle()`, `drawCard()`, `reset()`

### Scoring System
`www/elo.js`:
- **Rated match scoring**: Uses ELO rating system
- K-factor: 32 (each game changes rating by ~16-32 points)
- Formula: `newRating = oldRating + K * (actualScore - expectedScore)`
- Minimum rating: 800, Maximum: 3000

## Game Rules by Ruleset

### Standard (Draw 2 / 2 Out)
- Start with standard hand size
- 2 melded sets required before player can go out
- Stricter meld requirements = more strategic

### Easy (Draw 1 / 1 Out)
- Easier to go out (only 1 melded set required)
- Lower hand penalty
- Better for beginners/bots training

## Round Scoring Breakdown

### Points Calculation in `calculateRoundScore()`
```
Base Points = sum of all melded card values
Red 3 Bonus = # of red 3s * 100 pts
Canasta Bonus = # of 7+ card melds * (500 or 300)
Go Out Bonus = 100 pts (if team melded)
Unplayed Penalties = sum of unplayed card values (negative)

FINAL = Base + Red3 + Canasta + GoOut - Penalties
```

### Cumulative vs Match Scoring
- After each round, points added to team score
- Round-over screen shows breakdown
- Match ends when team reaches 5000 pts

## Key Game Events (Socket Flow)

### Server → Client Communication
```
CLIENT                          SERVER
  |                               |
  |-- 'act_play_card' ----------->|
  |                         [Validate]
  |                         [Update game state]
  |<--- 'game_state_update' ------|
  |   (shows updated melds, hand)  |
  |                               |
  |-- 'act_discard' ------------->|
  |                         [Next player turn]
  |<--- 'game_state_update' ------|
  |   (new player's turn)         |
  |                               |
  |               [Player goes out]
  |<--- 'game_round_end' ---------|
  |   (scores, rankings updated)  |
```

## Common Game State Structure
```javascript
{
  gameId: "game_abc123",
  phase: "playing",           // setup, playing, round_end, match_end
  currentPlayer: 0,
  playerOrder: [0, 1, 2, 3],
  hands: [
    [{suit: "hearts", rank: "A"}, ...],  // Player 0
    [{suit: "spades", rank: "K"}, ...],  // Player 1
    ...
  ],
  melds: [
    [[], [], []],              // Team 1 (players 0,2)
    [[], [], []]               // Team 2 (players 1,3)
  ],
  discard: [{suit, rank}, ...],
  deck: {remaining: 42},
  scores: [
    {team: "Team 1", score: 2500, red3: 200, ...},
    {team: "Team 2", score: 1800, red3: 100, ...}
  ],
  turnTimer: 60,              // seconds remaining
  bankTimer: 720,             // total match time
  isBot: [false, true, false, true]
}
```

## Testing Game Logic

### Unit Testing Melts
```javascript
const {CanastaGame} = require('./www/game.js');
const game = new CanastaGame([player0, player1], 'standard');

// Test natural sequence
game.validateMeld([
  {suit: 'hearts', rank: '3'},
  {suit: 'hearts', rank: '4'},
  {suit: 'hearts', rank: '5'}
]); // Should return true

// Test invalid sequence
game.validateMeld([
  {suit: 'hearts', rank: '3'},
  {suit: 'spades', rank: '4'},
  {suit: 'hearts', rank: '5'}
]); // Should return false
```

### Simulating Full Match
```bash
node scripts/simulator.js --players 4 --rounds 10
# Runs 10 complete matches, logs winners & avg scores
```

## Debugging Game Issues

### Card disappearing
- Check `removeCard()` in game.js to ensure card IDs match
- Verify deck.js not reshuffling at wrong time
- Log `game.hands[playerIdx]` to inspect current cards

### Invalid melds accepted
- Check 3-card minimum in validateMeld()
- Verify wild card (2s) don't exceed natural cards in sequence
- Test with console: `game.validateMeld([...])`

### Score calculation wrong
- Check Red 3 bonus (should be *100)
- Verify Canasta detection (7+ cards, natural vs wild)
- Test calculateRoundScore() with known values

### Turn order stuck
- Verify `currentPlayer` increments
- Check socket emit in discard action
- Ensure server sends game_state_update after each action

## Rules Reference (In-Game Help)
See `screen-how-to` in `www/index.html` for player-facing rules.
Also shown as modal when 'RULES' button clicked.

## ELO Rating Changes
### Winning Match
- **Underdog**: +30-40 (beating higher-rated players)
- **Favorite**: +5-15 (beating lower-rated players)
- **Draw/Tie**: +0-5

### Losing Match
- **Underdog**: -5-15 (losing to favorites)
- **Favorite**: -20-30 (losing to lower-rated players)

Calculation ensures ratings stay balanced and reflect skill progression.
