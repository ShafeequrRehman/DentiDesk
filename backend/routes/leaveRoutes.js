const express = require("express");
const authenticate = require("../middleware/authenticate");
const { requireShopMember } = require("../middleware/roleGuards");
const requireLicenseValid = require("../middleware/requireLicenseValid");
const requireAnyPermission = require("../middleware/requireAnyPermission");
const { getLeaves, saveLeave, deleteLeave } = require("../controllers/leaveController");

const router = express.Router();

router.use(authenticate, requireShopMember, requireLicenseValid);

// Drs/Services leave (Availability page). Read by the POS slot picker too.
router.get("/", requireAnyPermission("sales.create", "orders.record.view", "inventory.manage"), getLeaves);
router.put("/", requireAnyPermission("sales.create", "orders.record.view", "inventory.manage"), saveLeave);
router.delete("/:id", requireAnyPermission("sales.create", "orders.record.view", "inventory.manage"), deleteLeave);

module.exports = router;
