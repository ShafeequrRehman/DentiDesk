const DashboardAdjustment = require("../models/DashboardAdjustment");
const User = require("../models/User");
const { shopScope } = require("../middleware/attachShopScope");
const { entryRef, findEntryIndex, signedAmount } = require("../services/historyRefs");

// Same pattern as cashController/customerController/bankController's own
// copy - the JWT never carries a display name, only id/role/shopId.
async function currentUserName(req) {
  if (!req.user?.id) return "";
  const user = await User.findById(req.user.id).select("name username").lean();
  return user?.name || user?.username || "";
}

// Every Accounting Overview tile this endpoint accepts a manual correction
// for - deliberately NOT "cashInHand" (CashRegister/cashController already
// owns that one, with its own Adjust modal) or "balanceOnBank" (each Bank
// document owns its own balance/history from the Bank page) - those two
// already have a real editable home of their own, so routing them through
// here too would let the same figure drift out of sync with itself.
const ALLOWED_KEYS = new Set([
  "totalSaleToday",
  "customerUdharTotal",
  "customerAdvanceTotal",
  "stockValue",
  "vendorBalance",
  "totalPurchaseToday",
  "totalExpensesToday",
  "saleOnCash",
  "saleOnBank",
  "saleOnCredit",
  "totalRecoveryToday",
]);

async function getOrCreate(shopId, key) {
  let doc = await DashboardAdjustment.findOne({ shopId, key });
  if (!doc) {
    doc = await DashboardAdjustment.create({ shopId, key, total: 0, history: [] });
  }
  return doc;
}

// GET /api/dashboard-adjustments
// Returns { [key]: totalAdjustment } for every tile this shop has ever
// corrected - reportController.getDashboardSummary adds each one onto its
// own real computed figure before sending the Dashboard its numbers.
exports.getAllAdjustments = async (req, res) => {
  try {
    const { shopId } = shopScope(req);
    const docs = await DashboardAdjustment.find({ shopId }).select("key total").lean();
    const byKey = {};
    docs.forEach((doc) => {
      byKey[doc.key] = doc.total;
    });
    res.json(byKey);
  } catch (error) {
    res.status(500).json({ message: "Could not load dashboard adjustments", detail: error.message });
  }
};

// GET /api/dashboard-adjustments/:key/history
exports.getHistory = async (req, res) => {
  try {
    const { key } = req.params;
    if (!ALLOWED_KEYS.has(key)) {
      return res.status(400).json({ message: "This tile can't be corrected here." });
    }
    const { shopId } = shopScope(req);
    const doc = await getOrCreate(shopId, key);
    const history = doc.history
      .map((entry) => ({ ...(entry.toObject ? entry.toObject() : entry), ref: entryRef(entry) }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json({ key, total: doc.total, history });
  } catch (error) {
    res.status(500).json({ message: "Could not load correction history", detail: error.message });
  }
};

// POST /api/dashboard-adjustments/:key/adjust  body: { amount, direction: 'in'|'out', note }
// The owner's own explicit ask - every dashboard money figure must be
// editable so a mistake can be corrected, mirroring cashController.adjustCash's
// own pattern exactly.
exports.adjust = async (req, res) => {
  try {
    const { key } = req.params;
    if (!ALLOWED_KEYS.has(key)) {
      return res.status(400).json({ message: "This tile can't be corrected here." });
    }
    const amount = Math.max(Number(req.body.amount) || 0, 0);
    const direction = req.body.direction === "out" ? "out" : "in";
    const note = String(req.body.note || "").trim();
    if (amount <= 0) {
      return res.status(400).json({ message: "amount must be greater than 0" });
    }

    const { shopId } = shopScope(req);
    const doc = await getOrCreate(shopId, key);
    doc.total = direction === "in" ? doc.total + amount : doc.total - amount;
    doc.history.push({
      direction,
      amount,
      note: note || "Manual correction",
      totalAfter: doc.total,
      createdBy: await currentUserName(req),
    });
    await doc.save();
    res.json({ key, total: doc.total });
  } catch (error) {
    res.status(500).json({ message: "Could not save correction", detail: error.message });
  }
};

function money(value) {
  return `$${Math.round(Number(value) || 0).toLocaleString("en-US")}`;
}

// POST /api/dashboard-adjustments/:key/clear  body: { amount, label }
// Clear button: brings the tile to $0 by recording a correction of exactly
// the amount it shows right now. Kept in the history (who cleared it, when)
// and can be undone from there.
exports.clear = async (req, res) => {
  try {
    const { key } = req.params;
    if (!ALLOWED_KEYS.has(key)) {
      return res.status(400).json({ message: "This tile can't be cleared here." });
    }
    const amount = Math.round((Number(req.body.amount) || 0) * 100) / 100;
    if (amount <= 0) return res.status(400).json({ message: "This figure is already $0." });
    const label = String(req.body.label || "").trim().slice(0, 60);
    const { shopId } = shopScope(req);
    const doc = await getOrCreate(shopId, key);
    doc.total -= amount;
    doc.history.push({
      direction: "out",
      amount,
      note: `Cleared to $0${label ? ` (${label})` : ""} - was ${money(amount)}`,
      totalAfter: doc.total,
      createdBy: await currentUserName(req),
      kind: "clear",
    });
    await doc.save();
    res.json({ key, total: doc.total });
  } catch (error) {
    res.status(500).json({ message: "Could not clear this figure", detail: error.message });
  }
};

// POST /api/dashboard-adjustments/:key/history/:ref/undo
// Undo one entry (a clear or a correction): it stays in the history marked
// "Undone by ... at ...", and stops counting towards the figure.
exports.undo = async (req, res) => {
  try {
    const { key, ref } = req.params;
    if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ message: "This tile can't be changed here." });
    const { shopId } = shopScope(req);
    const doc = await getOrCreate(shopId, key);
    const index = findEntryIndex(doc.history, ref);
    if (index === -1) return res.status(404).json({ message: "That history entry no longer exists." });
    const entry = doc.history[index];
    if (entry.undone) return res.status(400).json({ message: "This entry was already undone." });
    entry.undone = true;
    entry.undoneBy = await currentUserName(req);
    entry.undoneAt = new Date();
    doc.total = activeTotal(doc.history);
    doc.markModified("history");
    await doc.save();
    res.json({ key, total: doc.total });
  } catch (error) {
    res.status(500).json({ message: "Could not undo", detail: error.message });
  }
};

// DELETE /api/dashboard-adjustments/:key/history/:ref
// Removes one entry from the history. If it wasn't undone, its effect on
// the figure goes with it.
exports.deleteEntry = async (req, res) => {
  try {
    const { key, ref } = req.params;
    if (!ALLOWED_KEYS.has(key)) return res.status(400).json({ message: "This tile can't be changed here." });
    const { shopId } = shopScope(req);
    const doc = await getOrCreate(shopId, key);
    const index = findEntryIndex(doc.history, ref);
    if (index === -1) return res.status(404).json({ message: "That history entry no longer exists." });
    doc.history.splice(index, 1);
    doc.total = activeTotal(doc.history);
    doc.markModified("history");
    await doc.save();
    res.json({ key, total: doc.total });
  } catch (error) {
    res.status(500).json({ message: "Could not delete this entry", detail: error.message });
  }
};

// The figure's correction = every entry that hasn't been undone.
function activeTotal(history) {
  return (history || []).reduce((sum, entry) => (entry.undone ? sum : sum + signedAmount(entry)), 0);
}
