// deck.js - The Logic for the Cards

const SUITS = ["Hearts", "Diamonds", "Clubs", "Spades"];
const RANKS = ["4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2", "3"];

class Card {
    constructor(suit, rank, value) {
        this.suit = suit;
        this.rank = rank;
        this.value = value;
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
    
    // Canasta uses 2 standard decks mixed together
    for (let d = 0; d < 2; d++) {
        // Create standard cards
        for (let suit of SUITS) {
            for (let rank of RANKS) {
                // Calculate points
                let points = 0;
                if (rank === "3") points = (suit === "Hearts" || suit === "Diamonds") ? 100 : 5;
                else if (["4", "5", "6", "7"].includes(rank)) points = 5;
                else if (["8", "9", "10", "J", "Q", "K"].includes(rank)) points = 10;
                else if (["A", "2"].includes(rank)) points = 20;

                deck.push(new Card(suit, rank, points));
            }
        }
        // Add 2 Jokers per deck (Total 4 Jokers in game)
        deck.push(new Card("None", "Joker", 50));
        deck.push(new Card("None", "Joker", 50));
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