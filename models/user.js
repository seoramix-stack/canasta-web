// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    token: String,
    isOnline: { type: Boolean, default: false },
    stats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        rating: { type: Number, default: 1200 }
    },
    // Social Arrays
    friends: [{ type: String }],
    blocked: [{ type: String }] 
});

module.exports = mongoose.model('User', userSchema);