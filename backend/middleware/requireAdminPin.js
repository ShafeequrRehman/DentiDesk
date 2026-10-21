// Super Admin panel: every change (new clinic, plan, suspend, license,
// owner password...) needs the verify PIN, sent as the "x-admin-pin"
// header. Reading data (GET) never needs it.
//
// The PIN's bcrypt hash lives on the Super Admin user (User.adminPinHash,
// set by backend/scripts/setSuperAdmin.js). 5 wrong PINs lock changes for
// 15 minutes for that account.
const bcrypt = require("bcryptjs");
const User = require("../models/User");

const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const fails = new Map(); // userId -> { count, lockedUntil }

module.exports = async function requireAdminPin(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  try {
    const userId = String(req.user?.id || "");
    const state = fails.get(userId);
    if (state?.lockedUntil && state.lockedUntil > Date.now()) {
      const minutes = Math.ceil((state.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ message: `Too many wrong PINs - try again in ${minutes} minute(s).`, reason: "pin_locked" });
    }
    const user = await User.findById(userId).select("+adminPinHash").lean();
    if (!user?.adminPinHash) {
      return res.status(403).json({ message: "The Super Admin verify PIN is not set yet - run the setSuperAdmin script on the server.", reason: "pin_not_set" });
    }
    const pin = String(req.headers["x-admin-pin"] || "");
    if (!pin) return res.status(401).json({ message: "Enter the verify PIN to make this change.", reason: "pin_required" });
    const ok = await bcrypt.compare(pin, user.adminPinHash);
    if (!ok) {
      const count = (state?.count || 0) + 1;
      fails.set(userId, count >= MAX_FAILS ? { count: 0, lockedUntil: Date.now() + LOCK_MS } : { count, lockedUntil: 0 });
      return res.status(403).json({ message: "Wrong verify PIN.", reason: "pin_wrong" });
    }
    fails.delete(userId);
    next();
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
