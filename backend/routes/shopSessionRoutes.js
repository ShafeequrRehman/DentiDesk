const express = require("express");
const authenticate = require("../middleware/authenticate");
const { requireShopMember } = require("../middleware/roleGuards");
const requireLicenseValid = require("../middleware/requireLicenseValid");
const requirePermission = require("../middleware/requirePermission");
const requireAnyPermission = require("../middleware/requireAnyPermission");
const ctrl = require("../controllers/shopSessionController");

const router = express.Router();

router.use(authenticate, requireShopMember, requireLicenseValid);

router.get("/current", ctrl.getCurrent);
// Read-only: the Appointments page needs it to show the current shift's
// appointments, so anyone who can see appointments may read it.
router.get("/history", requireAnyPermission("shop.session.manage", "sales.create", "orders.record.view", "view.dashboard"), ctrl.getHistory);
router.post("/open", requirePermission("shop.session.manage"), ctrl.openSession);
router.post("/close", requirePermission("shop.session.manage"), ctrl.closeSession);

module.exports = router;
