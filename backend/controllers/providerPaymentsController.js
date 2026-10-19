// Dr / Service Payments page.
//
// GET  /api/provider-payments?from=YYYY-MM-DD&to=YYYY-MM-DD
//   One row per Dr and per Service: billed (appointments in the range),
//   collected / due recovered / advance used (payments in the range, from
//   Order.payments), remaining due right now and advance kept for it -
//   plus the lines behind every figure for the detail view and PDF.
// POST   /api/provider-payments/:orderId     add a payment to an appointment
// DELETE /api/provider-payments/:orderId/:entryId   remove a payment line
//
// An appointment counts for the Dr it is booked with (doctorName) - a
// Service done by a Dr counts in full for that Dr - and, on the Services
// side, for each Service on it (by price share).
const mongoose = require("mongoose");
const Order = require("../models/Order");
const Product = require("../models/Product");
const Customer = require("../models/Customer");
const User = require("../models/User");
const { shopScope } = require("../middleware/attachShopScope");
const { recordCashMovement } = require("./cashController");
const { recordCustomerBankMovement } = require("./bankController");
const { currencySignFor } = require("../services/currency");

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const KARACHI_MS = 5 * 60 * 60 * 1000;

function karachiDay(date) {
  return new Date(new Date(date).getTime() + KARACHI_MS).toISOString().slice(0, 10);
}

function round2(v) {
  return Math.round(Number(v || 0) * 100) / 100;
}

function isDoctorLike(product, name) {
  if (product && /\b(drs?|doctors?)\b/i.test(product.category || "")) return true;
  return /^dr\.?\s/i.test(name || product?.name || "");
}

async function userName(req) {
  if (!req.user?.id) return "";
  const user = await User.findById(req.user.id).select("name username").lean();
  return user?.name || user?.username || "";
}

// Payment lines of an order; anything paid before the history existed is
// shown as one payment on the appointment's day.
function paymentLines(order) {
  const lines = (order.payments || []).map((p) => ({
    id: String(p._id || ""),
    date: p.date,
    amount: Number(p.amount || 0),
    kind: p.kind || "payment",
    method: p.method || "Cash",
    note: p.note || "",
    createdBy: p.createdBy || "",
  }));
  const logged = lines.reduce((sum, l) => sum + l.amount, 0);
  const missing = round2(Number(order.paidAmount || 0) - logged);
  if (missing > 0) {
    lines.unshift({ id: "", date: order.createdAt, amount: missing, kind: "payment", method: order.paymentMethod || "Cash", note: "Paid before payment history", createdBy: "" });
  }
  return lines;
}

exports.getProviderPayments = async (req, res) => {
  try {
    const scope = shopScope(req);
    const shopObjectId = new mongoose.Types.ObjectId(scope.shopId);
    const today = karachiDay(Date.now());
    const from = DAY_RE.test(String(req.query.from || "")) ? String(req.query.from) : today;
    const to = DAY_RE.test(String(req.query.to || "")) ? String(req.query.to) : today;
    const inRange = (date) => {
      const day = karachiDay(date);
      return day >= from && day <= to;
    };

    const [orders, products, customers] = await Promise.all([
      Order.find({ shopId: shopObjectId, status: { $ne: "cancelled" } })
        .select("dailyOrderNumber shopSequenceNumber customer doctorName items total paidAmount remainingAmount payments paymentMethod createdAt appointmentDate appointmentTime status advanceApplied")
        .lean(),
      Product.find({ shopId: shopObjectId }).select("name category").lean(),
      Customer.find({ shopId: shopObjectId, "advanceFor.0": { $exists: true } }).select("name phone advanceFor").lean(),
    ]);
    const productByName = new Map(products.map((p) => [p.name, p]));
    const isDr = (name) => isDoctorLike(productByName.get(name), name);

    const rows = new Map();
    const rowFor = (name, type) => {
      const key = `${type}::${name}`;
      if (!rows.has(key)) {
        rows.set(key, {
          name, type,
          appointments: 0, billed: 0, collected: 0, recovered: 0, advanceUsed: 0, remainingDue: 0, advanceHeld: 0,
          payments: [], appointmentsList: [], dues: [],
        });
      }
      return rows.get(key);
    };

    for (const order of orders) {
      const itemsTotal = (order.items || []).reduce((sum, i) => sum + Number(i.price || 0) * Number(i.quantity || 1), 0) || Number(order.total || 0);
      const shares = [];
      if (order.doctorName && isDr(order.doctorName)) shares.push({ name: order.doctorName, type: "dr", share: 1 });
      for (const item of order.items || []) {
        const line = Number(item.price || 0) * Number(item.quantity || 1);
        const share = itemsTotal > 0 ? line / itemsTotal : 0;
        if (isDr(item.name)) {
          if (!shares.some((s) => s.type === "dr")) shares.push({ name: item.name, type: "dr", share });
        } else {
          shares.push({ name: item.name, type: "service", share });
        }
      }
      if (shares.length === 0) continue;

      const label = `#${String(order.dailyOrderNumber ?? String(order._id).slice(-3)).padStart(3, "0")}`;
      const patient = order.customer?.name || "Patient";
      const phone = order.customer?.phone && order.customer.phone !== "03000000000" ? order.customer.phone : "";
      const lines = paymentLines(order);
      const due = Math.max(Number(order.remainingAmount || 0), 0);

      for (const { name, type, share } of shares) {
        const row = rowFor(name, type);
        if (inRange(order.createdAt)) {
          row.appointments += 1;
          row.billed += Number(order.total || 0) * share;
          row.appointmentsList.push({
            orderId: String(order._id), label, patient, phone, date: order.createdAt,
            slot: order.appointmentDate ? `${order.appointmentDate} ${order.appointmentTime || ""}`.trim() : "",
            billed: round2(Number(order.total || 0) * share),
            paid: round2(Number(order.paidAmount || 0) * share),
            due: round2(due * share),
          });
        }
        for (const line of lines) {
          if (!inRange(line.date)) continue;
          const value = line.amount * share;
          if (line.kind === "advance") row.advanceUsed += value;
          else {
            row.collected += value;
            if (line.kind === "recovery") row.recovered += value;
          }
          row.payments.push({ ...line, amount: round2(value), orderId: String(order._id), label, patient, phone, full: line.amount, share: round2(share) });
        }
        if (due > 0) {
          row.remainingDue += due * share;
          row.dues.push({ orderId: String(order._id), label, patient, phone, date: order.createdAt, due: round2(due * share), fullDue: due });
        }
      }
    }

    for (const customer of customers) {
      for (const entry of customer.advanceFor || []) {
        const type = isDr(entry.name) ? "dr" : "service";
        const row = rowFor(entry.name, type);
        row.advanceHeld += Number(entry.amount || 0);
      }
    }

    const result = [...rows.values()].map((row) => ({
      ...row,
      billed: round2(row.billed),
      collected: round2(row.collected),
      recovered: round2(row.recovered),
      advanceUsed: round2(row.advanceUsed),
      remainingDue: round2(row.remainingDue),
      advanceHeld: round2(row.advanceHeld),
      net: round2(row.collected + row.advanceUsed),
      payments: row.payments.sort((a, b) => new Date(b.date) - new Date(a.date)),
      appointmentsList: row.appointmentsList.sort((a, b) => new Date(b.date) - new Date(a.date)),
      dues: row.dues.sort((a, b) => new Date(a.date) - new Date(b.date)),
    }));
    result.sort((a, b) => b.net - a.net || a.name.localeCompare(b.name));
    res.json({ from, to, rows: result });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/provider-payments/:orderId  body: { amount, method: "Cash"|"Bank", bankId, note }
exports.addPayment = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, ...shopScope(req) });
    if (!order || order.status === "cancelled") return res.status(404).json({ message: "Appointment not found" });
    const due = Math.max(Number(order.remainingAmount || 0), 0);
    const amount = round2(req.body?.amount);
    if (!(amount > 0)) return res.status(400).json({ message: "Enter an amount." });
    if (amount > due) return res.status(400).json({ message: `Only ${await currencySignFor(order.shopId)}${due} is due on this appointment.` });
    const method = req.body?.method === "Bank" ? "Bank" : "Cash";
    const by = await userName(req);
    const note = String(req.body?.note || "").trim();
    const label = order.dailyOrderNumber ?? String(order._id).slice(-4);
    let bank = null;
    if (method === "Bank") {
      bank = await recordCustomerBankMovement({
        bankId: req.body?.bankId,
        shopId: order.shopId,
        type: "deposit",
        amount,
        note: `Due paid - Appointment #${label}${note ? ` - ${note}` : ""}`,
        customerName: order.customer?.name || "",
        customerPhone: order.customer?.phone || "",
        createdBy: by,
      });
      if (!bank) return res.status(400).json({ message: "Pick the bank." });
    } else {
      await recordCashMovement({
        shopId: order.shopId,
        type: "due_recovery",
        direction: "in",
        amount,
        note: `Due paid - Appointment #${label}${note ? ` - ${note}` : ""}`,
        relatedOrderId: order._id,
        relatedCustomerName: order.customer?.name || "",
        relatedCustomerPhone: order.customer?.phone || "",
        createdBy: by,
      });
    }
    order.paidAmount = Number(order.paidAmount || 0) + amount;
    order.remainingAmount = Math.max(round2(due - amount), 0);
    const sameDay = karachiDay(order.createdAt) === karachiDay(Date.now());
    order.logOrderPayment(amount, { kind: sameDay ? "payment" : "recovery", method, bankId: bank?._id || null, note: note || "Added on Dr / Service Payments", createdBy: by });
    order.version = Number(order.version || 0) + 1;
    await order.save();
    res.status(201).json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// DELETE /api/provider-payments/:orderId/:entryId
// Takes the money back out of where it went (cash / bank) - or, for an
// advance line, back into the patient's advance - and puts the due back.
exports.removePayment = async (req, res) => {
  try {
    const order = await Order.findOne({ _id: req.params.orderId, ...shopScope(req) });
    if (!order) return res.status(404).json({ message: "Appointment not found" });
    const entry = (order.payments || []).find((p) => String(p._id) === String(req.params.entryId));
    if (!entry) return res.status(404).json({ message: "This payment line was not found." });
    const amount = round2(entry.amount);
    if (!(amount > 0)) return res.status(400).json({ message: "Only a payment can be removed." });
    const by = await userName(req);
    const label = order.dailyOrderNumber ?? String(order._id).slice(-4);
    const note = `Payment removed - Appointment #${label}`;

    if (entry.kind === "advance") {
      const customer = order.customer?.phone ? await Customer.findOne({ phone: order.customer.phone, ...shopScope(req) }) : null;
      if (customer) {
        customer.previousDues = round2(Number(customer.previousDues || 0) - amount);
        customer.duesHistory.push({ type: "settle", amount, note: `Advance returned - ${note}`, balanceAfter: customer.previousDues, paymentMethod: "cash", createdBy: by });
        await customer.save();
      }
      order.advanceApplied = Math.max(round2(Number(order.advanceApplied || 0) - amount), 0);
    } else if (entry.method === "Bank" && entry.bankId) {
      await recordCustomerBankMovement({ bankId: entry.bankId, shopId: order.shopId, type: "withdrawal", amount, note, customerName: order.customer?.name || "", customerPhone: order.customer?.phone || "", createdBy: by });
    } else {
      await recordCashMovement({ shopId: order.shopId, type: "adjustment", direction: "out", amount, note, relatedOrderId: order._id, relatedCustomerName: order.customer?.name || "", relatedCustomerPhone: order.customer?.phone || "", createdBy: by });
    }

    order.payments = order.payments.filter((p) => String(p._id) !== String(entry._id));
    order.paidAmount = Math.max(round2(Number(order.paidAmount || 0) - amount), 0);
    order.remainingAmount = round2(Number(order.remainingAmount || 0) + amount);
    order.$locals.loggedPaid = -amount; // explained - no extra history line
    order.version = Number(order.version || 0) + 1;
    await order.save();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
