const express = require("express");
const authenticate = require("../middleware/authenticate");
const { requireShopMember } = require("../middleware/roleGuards");
const requireLicenseValid = require("../middleware/requireLicenseValid");
const requireAnyPermission = require("../middleware/requireAnyPermission");
const { getRecipes, saveRecipeForProduct } = require("../controllers/recipeController");

const router = express.Router();

router.use(authenticate, requireShopMember, requireLicenseValid);
router.use(requireAnyPermission("inventory.manage", "stock.manage"));

// Set Medicine page: the medicines/disposables each Dr or Service uses.
router.get("/", getRecipes);
router.put("/product/:productId", saveRecipeForProduct);

module.exports = router;
