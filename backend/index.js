// Load .env relative to this file's own location (backend/../.env), not
// whatever directory the Node process happened to be started from. aaPanel
// (and some other process managers) can launch `node backend/index.js` with
// a working directory that isn't the project root, which made a bare
// `require("dotenv").config()` silently fail to find .env there and fall
// through to whatever MONGO_URI was already set in the OS/parent-process
// environment - see the production DB-routing incident write-up in the
// Claude project for the full story.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// BUILD MARKER - proves this exact backend/index.js file is the one that
// is actually running. Check the terminal for this line every time you
// restart `npm run dev`, to rule out a stale backend process holding
// port 5000 from an earlier run.
console.log("[backend/index.js] LOADED build-marker: 2026-07-08-debug-v2");

// Ensure JWT_SECRET is present in .env
function ensureJwtSecret() {
  if (process.env.JWT_SECRET) return;
  const secret = crypto.randomBytes(64).toString("hex");
  const envPath = path.join(__dirname, "..", ".env");
  const envVar = `\nJWT_SECRET=${secret}\n`;
  try {
    fs.appendFileSync(envPath, envVar);
    process.env.JWT_SECRET = secret;
    console.log("Generated secure JWT_SECRET and saved to .env");
  } catch (err) {
    console.error("Failed to save JWT_SECRET to .env", err);
    process.env.JWT_SECRET = secret; // fallback in memory
  }
}
ensureJwtSecret();

const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const mongoose = require("mongoose");
const { connectDB } = require("./config/db");
const seedDefaults = require("./config/seed");
const connectivityMonitor = require("./config/connectivityMonitor");
const authRoutes = require("./routes/authRoutes");
const superAdminRoutes = require("./routes/superAdminRoutes");
const shopOwnerRoutes = require("./routes/shopOwnerRoutes");
const productRoutes = require("./routes/productRoutes");
const customerRoutes = require("./routes/customerRoutes");
const bankRoutes = require("./routes/bankRoutes");
const cashRoutes = require("./routes/cashRoutes");
const dashboardAdjustmentRoutes = require("./routes/dashboardAdjustmentRoutes");
const orderRoutes = require("./routes/orderRoutes");
const shopSessionRoutes = require("./routes/shopSessionRoutes");
const waiterRoutes = require("./routes/waiterRoutes");
const ingredientRoutes = require("./routes/ingredientRoutes");
const recipeRoutes = require("./routes/recipeRoutes");
const leaveRoutes = require("./routes/leaveRoutes");
const providerPaymentRoutes = require("./routes/providerPaymentRoutes");
const ingredientPurchaseRoutes = require("./routes/ingredientPurchaseRoutes");
const reportRoutes = require("./routes/reportRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const purchaseRoutes = require("./routes/purchaseRoutes");
const expenseRoutes = require("./routes/expenseRoutes");
const whatsappRoutes = require("./routes/whatsappRoutes");
const printerRoutes = require("./routes/printerRoutes");
const appVersionRoutes = require("./routes/appVersionRoutes");
const publicOrderRoutes = require("./routes/publicOrderRoutes");
const testimonialRoutes = require("./routes/testimonialRoutes");

const sanitizeInput = require("./middleware/sanitizeInput");

const app = express();

// --- Security hardening -------------------------------------------------
// No "X-Powered-By: Express" header telling attackers what we run.
app.disable("x-powered-by");
// Behind aaPanel's nginx (same machine): trust its X-Forwarded-For only
// when the request really comes from the local proxy, so rate limits see
// each visitor's real IP - and a direct caller can't fake one.
app.set("trust proxy", "loopback");
// Browser security headers: no MIME sniffing, no framing of the app on
// another site (clickjacking), no full URLs leaked as Referer, HTTPS only.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (req.secure) res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  // API answers (patient data, money) are never stored in shared caches.
  if (req.path.startsWith("/api/")) res.setHeader("Cache-Control", "no-store");
  next();
});

app.use(cors());
// Default express.json() body limit is 100kb - too small for a product's
// manually-uploaded photo (sent as a base64 data URI in Product.image, see
// resizeImageToDataUrl in ProductManagementSection.tsx, which caps the
// resized image around ~250-350KB before base64 inflates it further). 8mb
// matches the Local Hub's own express.json limit (localHub/server.js) with
// headroom.
app.use(express.json({ limit: "8mb" }));

// The web app calls some routes as /api/system/... (WhatsApp, documents)
// and /api/pos/... - in development Vite's proxy rewrites those to /api/...
// (see vite.config.ts). On the live server there is no Vite, so do the same
// rewrite here; otherwise those calls fall through to the web page and
// WhatsApp's status / QR / send never reach the backend.
app.use((req, _res, next) => {
  if (req.url.startsWith("/api/system/")) req.url = `/api/${req.url.slice("/api/system/".length)}`;
  else if (req.url.startsWith("/api/pos/")) req.url = `/api/${req.url.slice("/api/pos/".length)}`;
  next();
});
// See sanitizeInput.js - strips Mongo operator keys ($ne, $gt, etc.) out
// of every request body/query/params before any route handler runs.
app.use(sanitizeInput);

// One overall request cap per IP across the whole API - stops scripts from
// hammering or scraping it. Normal use (several tills/phones behind one
// clinic connection, live polling) stays far below this.
app.use(
  "/api",
  rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 3000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === "/health",
    message: { message: "Too many requests - please wait a few minutes and try again." },
  })
);

// Server errors (500) never send internal details (code paths, database
// messages) to the browser - they are written to the server log instead.
app.use((req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 500 && body && typeof body === "object") {
      const detail = body.error || body.message;
      if (detail) console.error(`[500] ${req.method} ${req.originalUrl}: ${detail}`);
      const safe = "Something went wrong on the server. Please try again.";
      return originalJson({ ...(body.success === false ? { success: false } : {}), ...(body.reason ? { reason: body.reason } : {}), error: safe, message: safe });
    }
    return originalJson(body);
  };
  next();
});

// Reachability check for the frontend's real online/offline indicator (see
// src/lib/network-status.ts). The actual continuous checking happens in
// config/connectivityMonitor.js (started below in startBackend, ticking
// every 5s in the background regardless of whether any request is in
// flight) - this route just reads that cached result instantly, so the
// frontend gets an immediate answer instead of waiting out a fresh ping on
// every single poll.
app.get("/api/health", (req, res) => {
  const status = connectivityMonitor.getStatus();
  res.status(status.isOnline ? 200 : 503).json({ ok: status.isOnline, dbConnected: status.isOnline, lastCheckedAt: status.lastCheckedAt, time: Date.now() });
});

// Mobile app-update check (see routes/appVersionRoutes.js) - mounted here,
// same as /api/health above, so it works even when MongoDB Atlas is
// unreachable and without needing a logged-in session (a phone should be
// able to tell it needs an update before it can even log in).
app.use("/api/app-version", appVersionRoutes);

// Static hosting for built pos-mobile APKs - drop a new build into
// backend/public/apk/ and point `npm run set-app-version` at
// /apk/<filename> (see backend/scripts/setAppVersion.js). No auth - the
// file itself isn't sensitive, and a phone needs to download it before it
// can log in.
app.use("/apk", express.static(path.join(__dirname, "public", "apk")));

// Testimonial pictures/videos uploaded on the Testimonials page - public,
// they are shown on the online appointment page. Only plain files, no
// folder listings, no hidden files.
app.use(
  "/media/testimonials",
  express.static(path.join(__dirname, "uploads", "testimonials"), { dotfiles: "deny", index: false, maxAge: "7d" })
);


// With bufferCommands disabled (see config/db.js), a DB-touching route hit
// while Atlas is unreachable now fails fast instead of hanging - but the
// error message was still a raw Mongoose internals string ("Cannot call
// ... before initial connection is complete"), which is meaningless to
// someone looking at a failed login. This turns that into one unambiguous
// message before the request ever reaches a controller. readyState: 0 =
// disconnected, 1 = connected, 2 = connecting, 3 = disconnecting.
app.use("/api", (req, res, next) => {
  if (mongoose.connection.readyState !== 1) {
    return res.status(503).json({
      message: "Database is not connected. This is a MongoDB Atlas connectivity issue (DNS/network/IP allowlist), not an application error - check the backend terminal for the exact connection error, and verify your current IP is allowed in Atlas Network Access.",
      reason: "database_unavailable",
    });
  }
  next();
});

app.use("/api/auth", authRoutes);
app.use("/api/superadmin", superAdminRoutes);
app.use("/api/shop", shopOwnerRoutes);
app.use("/api/products", productRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/banks", bankRoutes);
app.use("/api/cash", cashRoutes);
app.use("/api/dashboard-adjustments", dashboardAdjustmentRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/shop-session", shopSessionRoutes);
app.use("/api/waiters", waiterRoutes);
app.use("/api/ingredients", ingredientRoutes);
app.use("/api/recipes", recipeRoutes);
app.use("/api/leaves", leaveRoutes);
app.use("/api/provider-payments", providerPaymentRoutes);
app.use("/api/ingredient-purchases", ingredientPurchaseRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/purchases", purchaseRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/printers", printerRoutes);
app.use("/api/testimonials", testimonialRoutes);
// Customer-facing QR ordering (menu/tables/order-status/place-order/
// payment) - no login, see requireShopOrderable.js/publicOrderController.js
// for why every input there is treated as untrusted. Still mounted under
// /api so it inherits the DB-readiness check above (matched by prefix),
// just never the `authenticate` middleware any other /api/* route runs.
app.use("/api/public", publicOrderRoutes);

// Serves the built pos-web frontend (npm run build's dist/ output) so the
// customer QR ordering PWA (HashRouter route /order/:shopId - see
// src/App.tsx) is reachable from a customer's own phone browser at this
// same public domain, without needing the Electron app at all. Staff still
// normally use the Electron shell, which loads its own local copy of this
// same build - this is purely an ADDITIONAL way to reach it, over plain
// HTTP(S). Because this app is HashRouter-based (see src/main.tsx), every
// real route lives after the "#" and is resolved entirely client-side -
// Express only ever needs to serve index.html/manifest.json/sw.js at "/",
// never a wildcard catch-all for arbitrary paths. Registered BEFORE the
// plain-text "/" handler below so it actually gets first crack at "/" once
// dist/ exists; if dist/ doesn't exist yet, express.static just calls
// next() and the plain-text handler still answers instead of 404ing.
const distPath = path.join(__dirname, "..", "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
}

app.get("/", (req, res) => {
    res.send("POS Backend Running ...");
});

// Global error handler - catches synchronous throws from any middleware
// (e.g. shopScope() in middleware/attachShopScope.js when shopId is
// unexpectedly missing) and anything explicitly passed to next(err).
// Kept last, after all routes.
app.use((err, req, res, next) => {
  console.error(`[HTTP ERROR] ${req.method} ${req.originalUrl}:`, err);
  const statusCode = err.statusCode || 500;
  // Body too big / bad JSON etc. keep their short message; real crashes
  // never show internals to the browser.
  res.status(statusCode).json({ message: statusCode >= 500 ? "Something went wrong on the server. Please try again." : err.message || "Request error" });
});

let serverInstance = null;

async function startBackend(port = 5000) {
  if (serverInstance) return serverInstance;

  try {
    await connectDB();
    await seedDefaults();
    // Starts the background connectivity poller (see
    // config/connectivityMonitor.js) - runs continuously on its own
    // 5-second timer from here on, independent of the HTTP server.
    connectivityMonitor.start();

    return new Promise((resolve, reject) => {
      const PORT = process.env.PORT || port;
      serverInstance = app.listen(PORT, () => {
        console.log(`Backend server running on port ${PORT}`);
        resolve(serverInstance);
      });
      serverInstance.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${PORT} is already in use. Please close any other application using this port.`));
        } else {
          reject(err);
        }
      });
    });
  } catch (error) {
    console.error("Failed to start backend:", error);
    throw error;
  }
}

async function stopBackend() {
  connectivityMonitor.stop();
  if (serverInstance) {
    await new Promise((resolve) => serverInstance.close(resolve));
    serverInstance = null;
    console.log("Backend server stopped");
  }
}

// Only auto-start if running directly (not imported)
if (require.main === module) {
  startBackend().catch((error) => {
    console.error("Startup error:", error);
    process.exit(1);
  });
}

module.exports = { app, startBackend, stopBackend };
