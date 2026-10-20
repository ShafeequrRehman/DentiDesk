const express = require("express");
const router = express.Router();
const rateLimit = require("express-rate-limit");
const { register, login, refresh, logout, me } = require("../controllers/authController");
const authenticate = require("../middleware/authenticate");

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // Limit each IP to 20 login requests per windowMs
    message: { message: "Too many login attempts, please try again later" }
});

// Self-service registration is disabled (see authController.register) -
// kept as a route so old clients get an explicit, informative response
// instead of a raw 404.
router.post("/register", register);

router.post("/login", loginLimiter, login);
// Refresh tokens are long random values, but still cap guessing attempts.
const refreshLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: { message: "Too many requests, please try again later" }
});

router.post("/refresh", refreshLimiter, refresh);
router.post("/logout", logout);
router.get("/me", authenticate, me);

module.exports = router;
