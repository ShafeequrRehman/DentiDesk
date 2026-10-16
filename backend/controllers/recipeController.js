const mongoose = require("mongoose");
const Recipe = require("../models/Recipe");
const Product = require("../models/Product");
const Ingredient = require("../models/Ingredient");
const { shopScope } = require("../middleware/attachShopScope");
const { getRecipeUnitOptions } = require("../config/ingredientUnits");

// Set Medicine page: each Dr or Service can have a list of medicines and
// disposables from Medicine Stock ("1 pcs Gloves", "5 ml NaOCl"). When an
// appointment for that Dr/Service is finished (checkup done or appointment
// completed), services/stockService.js takes exactly these amounts off
// Medicine Stock - see orderController.js's applyStockOnFinish.

// GET /api/recipes - every recipe this clinic has set.
exports.getRecipes = async (req, res) => {
  const recipes = await Recipe.find({ ...shopScope(req) }).sort({ productName: 1, variation: 1 }).lean();
  res.json(recipes);
};

// PUT /api/recipes/product/:productId  body: { ingredients: [{ ingredientId, quantity, unit }] }
// Saves the full list for one Dr/Service (replaces what was there). An
// empty list removes the recipe.
exports.saveRecipeForProduct = async (req, res) => {
  try {
    const scope = shopScope(req);
    const { productId } = req.params;
    if (!mongoose.isValidObjectId(productId)) return res.status(400).json({ error: "Invalid Drs/Service." });
    const product = await Product.findOne({ _id: productId, ...scope }).select("name variation").lean();
    if (!product) return res.status(404).json({ error: "Drs/Service not found." });

    const rawLines = Array.isArray(req.body?.ingredients) ? req.body.ingredients : [];
    const ids = rawLines.map((line) => String(line?.ingredientId || "")).filter((id) => mongoose.isValidObjectId(id));
    const ingredients = await Ingredient.find({ _id: { $in: ids }, ...scope }).select("name unit").lean();
    const byId = new Map(ingredients.map((ingredient) => [String(ingredient._id), ingredient]));

    // One line per medicine - if the same one is sent twice, the amounts add up.
    const merged = new Map();
    for (const line of rawLines) {
      const ingredient = byId.get(String(line?.ingredientId || ""));
      if (!ingredient) {
        return res.status(400).json({ error: "One of the medicines no longer exists in Medicine Stock." });
      }
      const quantity = Number(line.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        return res.status(400).json({ error: `Enter how much ${ingredient.name} is used.` });
      }
      const allowed = getRecipeUnitOptions(ingredient.unit);
      const unit = allowed.includes(line.unit) ? line.unit : ingredient.unit;
      const key = `${ingredient._id}::${unit}`;
      const existing = merged.get(key);
      merged.set(key, {
        ingredientId: ingredient._id,
        ingredientName: ingredient.name,
        unit,
        quantity: Math.round(((existing?.quantity || 0) + quantity) * 1000) / 1000,
      });
    }

    const lines = [...merged.values()];
    if (lines.length === 0) {
      await Recipe.deleteOne({ productId: product._id, ...scope });
      return res.json({ productId: String(product._id), ingredients: [], deleted: true });
    }

    const recipe = await Recipe.findOneAndUpdate(
      { productId: product._id, ...scope },
      {
        $set: {
          productName: product.name,
          variation: product.variation || "",
          ingredients: lines,
        },
        $setOnInsert: { productId: product._id, ...scope },
      },
      { new: true, upsert: true, runValidators: true },
    ).lean();
    res.json(recipe);
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};
