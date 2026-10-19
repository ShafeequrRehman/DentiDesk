const express = require("express");
const authenticate = require("../middleware/authenticate");
const { requireShopMember } = require("../middleware/roleGuards");
const requireLicenseValid = require("../middleware/requireLicenseValid");
const requireAnyPermission = require("../middleware/requireAnyPermission");
const { getProviderPayments, addPayment, removePayment } = require("../controllers/providerPaymentsController");

// Dr / Service Payments page.
const router = express.Router();
router.use(authenticate, requireShopMember, requireLicenseValid);
const canView = requireAnyPermission("dues.manage", "reports.view", "view.dashboard");
const canEdit = requireAnyPermission("dues.manage");
router.get("/", canView, getProviderPayments);
router.post("/:orderId", canEdit, addPayment);
router.delete("/:orderId/:entryId", canEdit, removePayment);

module.exports = router;
