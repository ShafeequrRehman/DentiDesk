const CashRegister = require("../models/CashRegister");
const User = require("../models/User");
const { shopScope } = require("../middleware/attachShopScope");
const { entryRef, findEntryIndex, signedAmount } = require("../services/historyRefs");

// Same pattern as customerController.currentUserName/bankController's own
// copy - the JWT never carries a display name, only id/role/shopId.
async function currentUserName(req) {
  if (!req.user?.id) return "";
  const user = await User.findById(req.user.id).select("name username").lean();
  return user?.name || user?.username || "";
}

async function getOrCreateRegister(shopId) {
  let register = await CashRegister.findOne({ shopId });
  if (!register) {
    register = await CashRegister.create({ shopId, balance: 0, history: [] });
  }
  return register;
}

function serializeRegister(register) {
  const obj = register.toObject ? register.toObject() : register;
  return {
    balance: obj.balance || 0,
    // Newest-first, same convention as Bank/Customer history rendering.
    history: (obj.history || [])
      .map((entry) => ({
        ref: entryRef(entry),
        type: entry.type,
        kind: entry.kind || "adjust",
        undone: !!entry.undone,
        direction: entry.direction,
        amount: entry.amount,
        note: entry.note || "",
        balanceAfter: entry.balanceAfter,
        relatedCustomerName: entry.relatedCustomerName || "",
        relatedCustomerPhone: entry.relatedCustomerPhone || "",
        createdBy: entry.createdBy || "",
        createdAt: entry.createdAt,
      }))
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  };
}

// GET /api/cash
exports.getCashSummary = async (req, res) => {
  try {
    const { shopId } = shopScope(req);
    const register = await getOrCreateRegister(shopId);
    res.json(serializeRegister(register));
  } catch (error) {
    res.status(500).json({ message: "Could not load cash in hand", detail: error.message });
  }
};

// POST /api/cash/adjust  body: { amount, direction: 'in'|'out', note }
// Manual correction from the Dashboard's Cash in Hand card - the owner's
// own explicit ask: every payment figure on the dashboard must be
// editable so a mistake can be corrected. Never clamped to a minimum of 0
// on withdrawal - a shop's real cash drawer can end up recorded as
// negative if it was never seeded with an opening balance, and forcing it
// to stop at 0 would just hide that gap instead of letting the owner see
// and fix it.
exports.adjustCash = async (req, res) => {
  try {
    const amount = Math.max(Number(req.body.amount) || 0, 0);
    const direction = req.body.direction === "out" ? "out" : "in";
    const note = String(req.body.note || "").trim();
    if (amount <= 0) {
      return res.status(400).json({ message: "amount must be greater than 0" });
    }

    const { shopId } = shopScope(req);
    const register = await getOrCreateRegister(shopId);
    register.balance = direction === "in" ? register.balance + amount : register.balance - amount;
    register.history.push({
      type: "adjustment",
      direction,
      amount,
      note: note || "Manual correction",
      balanceAfter: register.balance,
      createdBy: await currentUserName(req),
    });
    await register.save();
    res.json(serializeRegister(register));
  } catch (error) {
    res.status(500).json({ message: "Could not adjust cash in hand", detail: error.message });
  }
};

// Internal helper - NOT a route handler. Called directly from
// orderController.js (a Cash-method order payment at completion) and
// customerController.js (a Cash-method "Pay Dues" recovery) so real cash
// coming in/out of the till is reflected here automatically, the same way
// bankController.recordCustomerBankMovement keeps a Bank's own balance in
// sync. Never throws over a missing shopId/non-positive amount - callers
// treat this as fire-and-forget bookkeeping, not something that should
// fail the order/payment itself.
exports.recordCashMovement = async function recordCashMovement({
  shopId,
  type,
  direction,
  amount,
  note,
  relatedOrderId,
  relatedCustomerName,
  relatedCustomerPhone,
  createdBy,
}) {
  if (!shopId || !(amount > 0)) return null;
  const register = await getOrCreateRegister(shopId);
  register.balance = direction === "in" ? register.balance + amount : register.balance - amount;
  register.history.push({
    type,
    direction,
    amount,
    note: note || "",
    balanceAfter: register.balance,
    relatedOrderId: relatedOrderId || null,
    relatedCustomerName: relatedCustomerName || "",
    relatedCustomerPhone: relatedCustomerPhone || "",
    createdBy: createdBy || "",
  });
  await register.save();
  return register;
};

// POST /api/cash/clear  body: { amount }
// Clear button on Cash in Hand: takes the till to $0 with one recorded
// adjustment (who cleared it, when). Can be undone from the history.
exports.clearCash = async (req, res) => {
  try {
    const { shopId } = shopScope(req);
    const register = await getOrCreateRegister(shopId);
    const amount = Math.round(Number(register.balance || 0) * 100) / 100;
    if (amount === 0) return res.status(400).json({ message: "Cash in Hand is already $0." });
    const direction = amount > 0 ? "out" : "in";
    register.balance = 0;
    register.history.push({
      type: "adjustment",
      direction,
      amount: Math.abs(amount),
      note: `Cleared to $0 - was $${Math.round(amount).toLocaleString("en-US")}`,
      balanceAfter: 0,
      createdBy: await currentUserName(req),
      kind: "clear",
    });
    await register.save();
    res.json(serializeRegister(register));
  } catch (error) {
    res.status(500).json({ message: "Could not clear cash in hand", detail: error.message });
  }
};

// Only manual entries (adjustments / clears / undos) can be undone or
// deleted - real sales, purchases and recoveries are left alone.
function findManualEntry(register, ref) {
  const index = findEntryIndex(register.history, ref);
  if (index === -1) return { error: [404, "That history entry no longer exists."] };
  const entry = register.history[index];
  if (entry.type !== "adjustment") {
    return { error: [400, "Only manual corrections and clears can be changed here - this entry came from a real sale, purchase or payment."] };
  }
  return { index, entry };
}

// POST /api/cash/history/:ref/undo
exports.undoCashEntry = async (req, res) => {
  try {
    const { shopId } = shopScope(req);
    const register = await getOrCreateRegister(shopId);
    const found = findManualEntry(register, req.params.ref);
    if (found.error) return res.status(found.error[0]).json({ message: found.error[1] });
    const { entry } = found;
    if (entry.undone) return res.status(400).json({ message: "This entry was already undone." });
    if (entry.kind === "undo") return res.status(400).json({ message: "An undo can't be undone - delete it instead." });
    register.balance -= signedAmount(entry);
    entry.undone = true;
    register.history.push({
      type: "adjustment",
      direction: entry.direction === "out" ? "in" : "out",
      amount: entry.amount,
      note: `Undo: ${entry.note || "correction"}`,
      balanceAfter: register.balance,
      createdBy: await currentUserName(req),
      kind: "undo",
    });
    register.markModified("history");
    await register.save();
    res.json(serializeRegister(register));
  } catch (error) {
    res.status(500).json({ message: "Could not undo", detail: error.message });
  }
};

// DELETE /api/cash/history/:ref - removes a manual entry and its effect
// on the balance.
exports.deleteCashEntry = async (req, res) => {
  try {
    const { shopId } = shopScope(req);
    const register = await getOrCreateRegister(shopId);
    const found = findManualEntry(register, req.params.ref);
    if (found.error) return res.status(found.error[0]).json({ message: found.error[1] });
    const { index, entry } = found;
    register.balance -= signedAmount(entry);
    register.history.splice(index, 1);
    if (entry.kind === "undo") {
      const original = [...register.history]
        .reverse()
        .find((e) => e.undone && e.type === "adjustment" && e.amount === entry.amount && e.direction !== entry.direction);
      if (original) original.undone = false;
    }
    register.markModified("history");
    await register.save();
    res.json(serializeRegister(register));
  } catch (error) {
    res.status(500).json({ message: "Could not delete this entry", detail: error.message });
  }
};

exports.getOrCreateRegister = getOrCreateRegister;
exports.serializeRegister = serializeRegister;
