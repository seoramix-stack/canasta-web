const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error("FATAL ERROR: JWT_SECRET is not defined.");
    process.exit(1);
}

module.exports = (User, DEV_MODE) => {

    // REGISTER ROUTE
    router.post('/register', async (req, res) => {
        let { username, password } = req.body;

        if (DEV_MODE) {
            console.log('[AUTH DEBUG] DEV_MODE Register for:', username);
            const token = jwt.sign({ username, id: 'dev_id' }, JWT_SECRET);
            return res.json({ success: true, token: token, username: username });
        }

        if (!username || !password) return res.json({ success: false, message: "Missing fields" });
        
        username = username.toLowerCase().trim();
        password = password.trim();

        try {
            const existing = await User.findOne({ username });
            if (existing) return res.json({ success: false, message: "Username taken" });

            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            // Create User and set token BEFORE saving to avoid double-hashing in hooks
            const newUser = new User({
                username,
                password: hashedPassword
            });

            const token = jwt.sign(
                { id: newUser._id, username: newUser.username },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            newUser.token = token;
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
        let { username, password } = req.body;

        if (DEV_MODE) {
            console.log('[AUTH DEBUG] DEV_MODE Login for:', username);
            const token = jwt.sign({ username, id: 'dev_id' }, JWT_SECRET);
            return res.json({ success: true, token: token, username: username });
        }

        if (!username || !password) return res.json({ success: false, message: "Missing fields" });

        username = username.toLowerCase().trim();
        password = password.trim();

        try {
            console.log(`[AUTH] Login attempt for: ${username}`);
            const user = await User.findOne({ username });
            
            if (!user) {
                console.log(`[AUTH] User not found: ${username}`);
                return res.json({ success: false, message: "User not found" });
            }

            console.log(`[AUTH] Comparing password for ${username}. Hash in DB starts with: ${user.password.substring(0, 10)}...`);
            
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                console.log(`[AUTH] Password mismatch for: ${username}`);
                return res.json({ success: false, message: "Invalid credentials" });
            }

            const token = jwt.sign(
                { id: user._id, username: user.username },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            // 4. UPDATE USER STATE
            user.token = token;
            user.isOnline = true;
            
            // Use findOneAndUpdate or updateOne to bypass "pre-save" hooks 
            // that might be re-hashing your password accidentally.
            await User.updateOne({ _id: user._id }, { $set: { token: token, isOnline: true } });

            console.log(`[AUTH] Login: ${username}`);
            res.json({ success: true, token: token, username: username });

        } catch (e) {
            console.error("Login Error:", e);
            res.status(500).json({ success: false, message: "Server Error" });
        }
    });

    return router;
};