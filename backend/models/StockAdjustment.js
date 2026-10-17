const mongoose = require("mongoose");

// Medicine Stock: every manual stock adjustment (the +/- "Adjust" box on a
// medicine), so its history shows who added or removed how much, and why.
const stockAdjustmentSchema = new mongoose.Schema(
  {
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true, index: true },
    ingredientId: { type: mongoose.Schema.Types.ObjectId, ref: "Ingredient", required: true, index: true },
    ingredientName: { type: String, default: "" },
    unit: { type: String, default: "" },
    direction: { type: String, enum: ["in", "out"], required: true },
    // What actually changed (a removal is capped at what was in stock).
    quantity: { type: Number, required: true, min: 0 },
    stockAfter: { type: Number, default: 0 },
    note: { type: String, default: "", trim: true, maxlength: 300 },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("StockAdjustment", stockAdjustmentSchema);
