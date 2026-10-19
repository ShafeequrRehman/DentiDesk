// A patient's advance (Customer.previousDues below 0 - money they paid
// ahead) is used up automatically on their appointments: it is counted
// as paid on the appointment, so the bill, the slip, the Dr's record and
// Dues all show only what's really left to pay.
//
// Part of an advance can be kept for one Dr / Service (Customer.advanceFor,
// picked on the Dues page) - that part is only used on that Dr's /
// Service's appointment. The rest is general and used on any.
const Customer = require("../models/Customer");

const WALKIN_PHONE = "03000000000";

function round2(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

// Names this appointment counts for (the Dr it's booked with + its items).
function namesOf(order) {
  const names = new Set();
  if (order.doctorName) names.add(order.doctorName);
  (order.items || []).forEach((item) => item?.name && names.add(item.name));
  return names;
}

// Keep advanceFor consistent with the real advance left.
function clampTargets(customer) {
  let credit = Math.max(-Number(customer.previousDues || 0), 0);
  const kept = [];
  for (const entry of customer.advanceFor || []) {
    const amount = Math.min(round2(entry.amount), credit);
    if (amount > 0) {
      kept.push({ name: entry.name, amount });
      credit -= amount;
    }
  }
  customer.advanceFor = kept;
}

// Applies the patient's advance to this order document. Saves the
// customer; the caller saves the order. Returns the amount used.
async function applyCustomerAdvance(order, scope) {
  try {
    const phone = order?.customer?.phone;
    if (!phone || phone === WALKIN_PHONE) return 0;
    const due = typeof order.remainingAmount === "number"
      ? order.remainingAmount
      : Math.max((order.total || 0) - (order.paidAmount || 0), 0);
    if (!(due > 0)) return 0;
    const customer = await Customer.findOne({ phone, ...scope });
    if (!customer || !(Number(customer.previousDues) < 0)) return 0;
    // An advance belongs to the patient, not to one Dr / Service - plans
    // change, so it is used on whichever appointment comes next. The Dr
    // whose appointment uses it gets it as "advance used".
    const credit = -Number(customer.previousDues);
    const applied = round2(Math.min(due, credit));
    if (!(applied > 0)) return 0;
    customer.advanceFor = [];

    order.paidAmount = Number(order.paidAmount || 0) + applied;
    order.remainingAmount = Math.max(round2(due - applied), 0);
    order.advanceApplied = Number(order.advanceApplied || 0) + applied;
    if (typeof order.logOrderPayment === "function") order.logOrderPayment(applied, { kind: "advance", note: "Advance used" });
    customer.previousDues = round2(Number(customer.previousDues) + applied);
    const label = order.dailyOrderNumber ?? order.shopSequenceNumber ?? String(order._id || "").slice(-4);
    customer.duesHistory.push({
      type: "add",
      amount: applied,
      note: `Advance used for Appointment #${label}`,
      balanceAfter: customer.previousDues,
      paymentMethod: "cash",
    });
    await customer.save();
    return applied;
  } catch (error) {
    console.error("Non-fatal: could not apply the patient's advance", error);
    return 0;
  }
}

module.exports = { applyCustomerAdvance, clampTargets };
