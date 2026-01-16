// deck.js - The Logic for the Cards

const SUITS = ["Hearts", "Diamonds", "Clubs", "Spades"];
const RANKS = ["4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2", "3"];

class Card {
    constructor(suit, rank, value, deckType) {
        this.suit = suit;
        this.rank = rank;
        this.value = value;
        this.deckType = deckType; // 'Red' or 'Blue'
        this.isWild = (rank === "2" || rank === "Joker");
        this.isRed3 = (rank === "3" && (suit === "Hearts" || suit === "Diamonds"));
    }

    // A helper to print the card nicely (e.g., "[Hearts 5]")
    toString() {
        return `[${this.suit} ${this.rank}]`;
    }
}

function createCanastaDeck() {
    let deck = [];
    
    for (let d = 0; d < 2; d++) {
        // 1. Determine the color for this half of the deck
        const type = (d === 0) ? 'Red' : 'Blue';

        for (let suit of SUITS) {
            for (let rank of RANKS) {
                let points = 0;
                if (rank === "3") points = (suit === "Hearts" || suit === "Diamonds") ? 100 : 5;
                else if (["4", "5", "6", "7"].includes(rank)) points = 5;
                else if (["8", "9", "10", "J", "Q", "K"].includes(rank)) points = 10;
                else if (["A", "2"].includes(rank)) points = 20;

                // 2. PASS 'type' HERE!
                deck.push(new Card(suit, rank, points, type)); 
            }
        }
        // 3. PASS 'type' TO JOKERS TOO!
        deck.push(new Card("None", "Joker", 50, type));
        deck.push(new Card("None", "Joker", 50, type));
    }
    return deck;
}

function shuffle(deck) {
    // The Fisher-Yates Shuffle Algorithm (Standard for games)
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}
module.exports = { createCanastaDeck, shuffle };