// Sets the Super Admin's login username, password and verify PIN.
// Run on the server (values are NOT stored in the code):
//
//   node backend/scripts/setSuperAdmin.js <username> <password> <pin>
//
// The password and PIN are saved only as bcrypt hashes. Every existing
// Super Admin session is signed out (they log in again with the new
// details).
require("dotenv").config({ path: require("path").join(__dirname, "..", "..", ".env") });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("../models/User");

async function run() {
  const [username, password, pin] = process.argv.slice(2);
  if (!username || !password || !pin) {
    throw new Error("Usage: node backend/scripts/setSuperAdmin.js <username> <password> <pin>");
  }
  if (password.length < 8) throw new Error("Use a password of at least 8 characters.");
  if (!/^\d{4,12}$/.test(pin)) throw new Error("The PIN must be 4 to 12 digits.");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set in .env");

  await mongoose.connect(process.env.MONGO_URI);
  const admins = await User.find({ role: "superadmin" });
  if (admins.length === 0) throw new Error("No Super Admin account found.");
  const admin = admins[0];
  const clash = await User.findOne({ username, _id: { $ne: admin._id } }).lean();
  if (clash) throw new Error(`The username "${username}" is already used by another account.`);

  admin.username = username;
  admin.password = await bcrypt.hash(password, 10);
  admin.adminPinHash = await bcrypt.hash(pin, 10);
  admin.refreshTokenHash = undefined;
  admin.refreshTokenExpiresAt = undefined;
  if ("failedLoginAttempts" in admin) admin.failedLoginAttempts = 0;
  if ("lockUntil" in admin) admin.lockUntil = null;
  await admin.save();

  console.log(`Super Admin updated (_id: ${admin._id}).`);
  console.log(`Username: ${username}`);
  console.log("Password and verify PIN saved (hashed). Log in again with the new details.");
  if (admins.length > 1) console.log(`Note: ${admins.length} Super Admin accounts exist - only the first one was changed.`);
  await mongoose.disconnect();
}

run().catch(async (error) => {
  console.error("Failed:", error.message);
  try { await mongoose.disconnect(); } catch { /* ignore */ }
  process.exitCode = 1;
});
