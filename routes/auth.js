// routes/auth.js
const express = require('express');
const router = express.Router();

// We export a function so we can pass in the User model and DEV_MODE flag
module.exports = (User, DEV_MODE) => {

    // REGISTER ROUTE
    router.post('/register', async (req, res) => {
        const { username, password } = req.body;
        
        // [DEV MODE BYPASS]
        if (DEV_MODE) {
            const token = 'dev_token_' + Math.random().toString(36).substr(2, 9);
            console.log(`[DEV-AUTH] Register Mock: ${username}`);
            return res.json({ success: true, token: token, username: username });
        }

        if (!username || !password) return res.json({ success: false, message: "Missing fields" });

        try {
            const existing = await User.findOne({ username });
            if (existing) return res.json({ success: false, message: "Username taken" });

            const token = 'user_' + Math.random().toString(36).substr(2, 9);
            const newUser = new User({ username, password, token });
            await newUser.save();

            console.log(`[AUTH] Registered: ${username}`);
            res.json({ success: true, token: token, username: username });
        } catch (e) {
            console.error("Register Error:", e);
            res.status(500).json({ success: false, message: "Server Error" });
        }
    });

    // LOGIN ROUTE
    router.post('/login', async (req, res) => {
        const { username, password } = req.body;

        // [DEV MODE BYPASS]
        if (DEV_MODE) {
            const token = 'dev_token_' + Math.random().toString(36).substr(2, 9);
            console.log(`[DEV-AUTH] Login Mock: ${username}`);
            return res.json({ success: true, token: token, username: username });
        }

        try {
            const user = await User.findOne({ username });
            if (user && user.password === password) {
                console.log(`[AUTH] Login: ${username}`);
                res.json({ success: true, token: user.token, username: username });
            } else {
                res.json({ success: false, message: "Invalid credentials" });
            }
        } catch (e) {
            res.status(500).json({ success: false, message: "Server Error" });
        }
    });

    return router;
};