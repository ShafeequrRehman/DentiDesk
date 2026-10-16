const express = require("express");
const authenticate = require("../middleware/authenticate");
const { requireShopMember } = require("../middleware/roleGuards");
const requireLicenseValid = require("../middleware/requireLicenseValid");
const requirePermission = require("../middleware/requirePermission");
const cashController = require("../controllers/cashController");

const router = express.Router();

router.use(authenticate, requireShopMember, requireLicenseValid);

// view.dashboard - anyone who can see the Dashboard can see its own Cash
// in Hand figure; correcting it (adjust) is gated to dues.manage, same as
// the Bank page above it, since it's the same "who's trusted to touch the
// shop's own money records" boundary.
router.get("/", requirePermission("view.dashboard"), cashController.getCashSummary);
router.post("/adjust", requirePermission("dues.manage"), cashController.adjustCash);
// Clear to $0, and Undo / Delete of a manual history entry.
router.post("/clear", requirePermission("dues.manage"), cashController.clearCash);
router.post("/history/:ref/undo", requirePermission("dues.manage"), cashController.undoCashEntry);
router.delete("/history/:ref", requirePermission("dues.manage"), cashController.deleteCashEntry);

module.exports = router;
