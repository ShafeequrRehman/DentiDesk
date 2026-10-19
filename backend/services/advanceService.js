// A patient's advance (Customer.previousDues below 0 - money they paid
// ahead) is used up automatically on their appointments: it is counted
// as paid on the appointment, so the bill, the slip, the Dr's record and
// Dues all show only what's really left to pay.
const Customer = require("../models/Customer");

const WALKIN_PHONE = "03000000000";

// Applies the patient's advance to this (unsaved or saved) order document.
// Saves the customer; the caller saves the order. Returns the amount used.
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
    const applied = Math.min(-Number(customer.previousDues), due);
    if (!(applied > 0)) return 0;
    order.paidAmount = Number(order.paidAmount || 0) + applied;
    order.remainingAmount = Math.max(due - applied, 0);
    order.advanceApplied = Number(order.advanceApplied || 0) + applied;
    customer.previousDues = Number(customer.previousDues) + applied;
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

module.exports = { applyCustomerAdvance };
