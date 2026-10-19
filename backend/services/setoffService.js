// Purchase set-off (Unified Record): when the clinic owes a contact for a
// purchase AND that contact owes the clinic for appointments, the two are
// settled against each other - the purchase is marked paid and each
// appointment (and so its Dr / Service) is marked paid by "purchase
// adjusted", oldest first. The net balance doesn't change; every record
// (Dr Payments, Record, Vendor Balance, Patient Due) then shows the real
// figure instead of a due that is really covered by the purchase.
const Customer = require("../models/Customer");
const Order = require("../models/Order");
const IngredientPurchase = require("../models/IngredientPurchase");

const WALKIN_PHONE = "03000000000";

function round2(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

async function applyPurchaseSetoff(scope, phone) {
  try {
    if (!phone || phone === WALKIN_PHONE) return 0;
    const customer = await Customer.findOne({ phone, ...scope }).select("_id").lean();
    if (!customer) return 0;
    const purchases = await IngredientPurchase.find({
      ...scope,
      linkedCustomerId: customer._id,
      status: "received",
      remainingAmount: { $gt: 0 },
    }).sort({ purchaseDate: 1, createdAt: 1 });
    if (purchases.length === 0) return 0;
    const orders = await Order.find({
      ...scope,
      "customer.phone": phone,
      status: { $ne: "cancelled" },
      remainingAmount: { $gt: 0 },
    }).sort({ createdAt: 1 });
    if (orders.length === 0) return 0;

    let total = 0;
    let pi = 0;
    let oi = 0;
    const touchedPurchases = new Set();
    const touchedOrders = new Set();
    while (pi < purchases.length && oi < orders.length) {
      const purchase = purchases[pi];
      const order = orders[oi];
      const use = round2(Math.min(Number(purchase.remainingAmount || 0), Number(order.remainingAmount || 0)));
      if (use > 0) {
        purchase.paidAmount = round2(Number(purchase.paidAmount || 0) + use);
        purchase.remainingAmount = Math.max(round2(Number(purchase.remainingAmount) - use), 0);
        purchase.setoffAmount = round2(Number(purchase.setoffAmount || 0) + use);
        order.paidAmount = round2(Number(order.paidAmount || 0) + use);
        order.remainingAmount = Math.max(round2(Number(order.remainingAmount) - use), 0);
        order.setoffApplied = round2(Number(order.setoffApplied || 0) + use);
        order.logOrderPayment(use, { kind: "setoff", note: `Purchase ${purchase.purchaseOrderNumber} adjusted`, ref: String(purchase._id) });
        touchedPurchases.add(purchase);
        touchedOrders.add(order);
        total += use;
      }
      if (!(purchase.remainingAmount > 0)) pi += 1;
      if (!(order.remainingAmount > 0)) oi += 1;
    }
    for (const order of touchedOrders) {
      order.version = Number(order.version || 0) + 1;
      await order.save();
    }
    for (const purchase of touchedPurchases) await purchase.save();
    return round2(total);
  } catch (error) {
    console.error("Non-fatal: purchase set-off failed", error);
    return 0;
  }
}

// A cancelled purchase can't pay anything any more - put the appointments
// it had settled back to due.
async function revertPurchaseSetoff(scope, purchaseId) {
  try {
    const ref = String(purchaseId);
    const orders = await Order.find({ ...scope, "payments.ref": ref });
    for (const order of orders) {
      const lines = (order.payments || []).filter((p) => p.ref === ref && p.kind === "setoff");
      const amount = round2(lines.reduce((sum, p) => sum + Number(p.amount || 0), 0));
      if (!(amount > 0)) continue;
      order.payments = order.payments.filter((p) => !(p.ref === ref && p.kind === "setoff"));
      order.paidAmount = Math.max(round2(Number(order.paidAmount || 0) - amount), 0);
      order.remainingAmount = round2(Number(order.remainingAmount || 0) + amount);
      order.setoffApplied = Math.max(round2(Number(order.setoffApplied || 0) - amount), 0);
      if (order.status === "completed" && order.remainingAmount > 0) order.status = "pending";
      order.$locals.loggedPaid = -amount;
      order.version = Number(order.version || 0) + 1;
      await order.save();
    }
  } catch (error) {
    console.error("Non-fatal: purchase set-off revert failed", error);
  }
}

// Every contact who has both an unpaid purchase and appointment dues.
async function applyAllSetoffs(scope) {
  const purchases = await IngredientPurchase.find({ ...scope, linkedCustomerId: { $ne: null }, status: "received", remainingAmount: { $gt: 0 } })
    .select("linkedCustomerId")
    .lean();
  const ids = [...new Set(purchases.map((p) => String(p.linkedCustomerId)))];
  if (ids.length === 0) return;
  const customers = await Customer.find({ ...scope, _id: { $in: ids } }).select("phone").lean();
  for (const customer of customers) await applyPurchaseSetoff(scope, customer.phone);
}

module.exports = { applyPurchaseSetoff, revertPurchaseSetoff, applyAllSetoffs };
