const express = require("express");
const authenticate = require("../middleware/authenticate");
const { requireShopMember } = require("../middleware/roleGuards");
const requireLicenseValid = require("../middleware/requireLicenseValid");
const requireAnyPermission = require("../middleware/requireAnyPermission");
const ctrl = require("../controllers/testimonialController");

const router = express.Router();

router.use(authenticate, requireShopMember, requireLicenseValid);

// Testimonials page (pictures / videos on the online appointment page).
router.get("/", requireAnyPermission("settings.manage"), ctrl.list);
// The picture itself is the request body (no JSON). Pictures only (shrunk
// in the browser first) - videos are added as YouTube links.
router.post(
  "/upload",
  requireAnyPermission("settings.manage"),
  express.raw({ type: ["image/*"], limit: "8mb" }),
  ctrl.upload
);
router.post("/link", requireAnyPermission("settings.manage"), ctrl.addLink);
router.delete("/:id", requireAnyPermission("settings.manage"), ctrl.remove);

module.exports = router;
