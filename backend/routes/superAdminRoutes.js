const express = require("express");
const router = express.Router();
const authenticate = require("../middleware/authenticate");
const { requireSuperAdmin } = require("../middleware/roleGuards");
const ctrl = require("../controllers/superAdminController");

// Every route here requires a valid Super Admin session. Deliberately NOT
// behind requireLicenseValid - the Super Admin's own access is never
// gated by any shop's license.
const requireAdminPin = require("../middleware/requireAdminPin");
// Every change (not reads) also needs the Super Admin verify PIN.
router.use(authenticate, requireSuperAdmin, requireAdminPin);

// The PIN box checks the PIN here first (requireAdminPin above already
// rejected a wrong one) - so a wrong PIN shows in the box, a right one
// lets the real change go through.
router.post("/verify-pin", (req, res) => res.json({ ok: true }));

// Shops
router.get("/shops", ctrl.listShops);
router.post("/shops", ctrl.createShop);
router.get("/shops/:id", ctrl.getShop);
router.patch("/shops/:id", ctrl.updateShop);
router.delete("/shops/:id", ctrl.deleteShop);
router.patch("/shops/:id/status", ctrl.setShopStatus);
router.patch("/shops/:id/owner", ctrl.updateShopOwner);
router.patch("/shops/:id/owner/reset-password", ctrl.resetShopOwnerPassword);
router.patch("/shops/:id/cancel-order-key", ctrl.resetCancelOrderKey);
router.patch("/shops/:id/page-visibility-key", ctrl.resetPageVisibilityKey);

// License
router.post("/shops/:id/license/extend", ctrl.extendLicense);
router.patch("/shops/:id/license/status", ctrl.setLicenseStatus);
router.patch("/shops/:id/license/expiry", ctrl.setLicenseExpiry);

// Plans
router.get("/plans", ctrl.listPlans);
router.post("/plans", ctrl.createPlan);
router.patch("/plans/:id", ctrl.updatePlan);
router.delete("/plans/:id", ctrl.deletePlan);

// Payments
router.get("/payments", ctrl.listPayments);
router.post("/payments", ctrl.recordPayment);

// Stats
router.get("/stats", ctrl.getStats);

// Settings
router.get("/settings", ctrl.getSettings);
router.patch("/settings", ctrl.updateSettings);

// Logs
router.get("/logs", ctrl.getLogs);

module.exports = router;
