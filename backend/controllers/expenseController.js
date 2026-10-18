const Expense = require("../models/Expense");
const { currencySignFor } = require("../services/currency");
const User = require("../models/User");
const Bank = require("../models/Bank");
const { shopScope } = require("../middleware/attachShopScope");
const { recordCashMovement } = require("./cashController");
const { recordCustomerBankMovement } = require("./bankController");

async function recorderName(req) {
  const user = req.user?.id ? await User.findById(req.user.id).select("name username").lean() : null;
  return user?.name || user?.username || "";
}

// GET /api/expenses/employees - a minimal (name/username only) staff
// directory for the expense-logging form's "Employee" picker and the
// Reports page's employee filter. Deliberately NOT shopOwnerController's
// listEmployees (that returns monthlySalary, permissions, idCardNumber,
// address... a full HR record correctly locked to Shop-Owner-only) - this
// is scoped just enough for "which employee does this meal belong to",
// open to any shop member the same way GET /expenses and GET /waiters
// already are (see those routes' own comments) rather than gated behind
// expenses.manage, since merely SEEING the names of this shop's own staff
// carries no more sensitivity than the Waiters directory already exposes.
exports.getEmployeesLite = async (req, res) => {
  const employees = await User.find({ ...shopScope(req), role: "employee" })
    .select("name username")
    .sort({ name: 1 })
    .lean();
  res.json(employees);
};

exports.getExpenses = async (req, res) => {
  // Optional Employee Expenses filter - Payroll's per-employee salary
  // history view uses this to pull just that one person's meal/food
  // expenses (see Expense.employeeId's own comment); every other existing
  // caller (the Reports page's restaurant-wide expense list) never sends
  // this param, so it's a no-op filter for them, same query as before.
  const query = { ...shopScope(req) };
  if (req.query.employeeId) query.employeeId = req.query.employeeId;
  const expenses = await Expense.find(query)
    .populate("employeeId", "name username")
    .sort({ date: -1 })
    .lean();
  res.json(expenses);
};

exports.getExpense = async (req, res) => {
  const expense = await Expense.findOne({ _id: req.params.id, ...shopScope(req) }).lean();
  if (!expense) return res.status(404).json({ error: "Expense not found" });
  res.json(expense);
};

exports.createExpense = async (req, res) => {
  const { shopId, ...body } = req.body;

  if (!body.category || !String(body.category).trim()) {
    return res.status(400).json({ error: "category is required" });
  }
  if (!(Number(body.amount) > 0)) {
    return res.status(400).json({ error: "amount must be greater than zero" });
  }

  // Employee Expenses: verify the employee actually exists in THIS shop
  // before attaching an expense to them - a stray/typo'd id would
  // otherwise silently save, then never show up on anyone's Payroll
  // history view (see Expense.employeeId's own comment) with no error to
  // explain why.
  if (body.employeeId) {
    const employee = await User.findOne({ _id: body.employeeId, shopId: req.user.shopId, role: "employee" }).select("_id").lean();
    if (!employee) {
      return res.status(400).json({ error: "Employee not found for this clinic" });
    }
  } else {
    body.employeeId = null;
  }

  // Paid from Cash in Hand or a bank - the money is taken out of it.
  const source = body.paymentSource === "bank" ? "bank" : body.paymentSource === "cash" ? "cash" : "";
  const amount = Number(body.amount);
  let bank = null;
  if (source === "bank") {
    bank = body.bankId ? await Bank.findOne({ _id: body.bankId, shopId: req.user.shopId }) : null;
    if (!bank) return res.status(400).json({ error: "Pick the bank this expense is paid from." });
    if (amount > bank.balance) {
      return res.status(400).json({ error: `${bank.name} only has ${await currencySignFor(bank.shopId)}${bank.balance.toLocaleString()} - not enough for ${await currencySignFor(bank.shopId)}${amount.toLocaleString()}.` });
    }
  }

  const expense = await Expense.create({
    ...body,
    paymentSource: source,
    bankId: bank ? bank._id : null,
    bankName: bank ? bank.name : "",
    shopId: req.user.shopId,
    recordedBy: req.user.id,
  });

  const label = `Expense: ${expense.category}${expense.note ? ` - ${expense.note}` : ""}`;
  if (source === "cash") {
    await recordCashMovement({ shopId: req.user.shopId, type: "expense", direction: "out", amount, note: label, createdBy: await recorderName(req) });
  } else if (bank) {
    await recordCustomerBankMovement({ bankId: bank._id, shopId: req.user.shopId, type: "withdrawal", amount, note: label, createdBy: await recorderName(req) });
  }
  res.status(201).json(await expense.populate("employeeId", "name username"));
};

exports.updateExpense = async (req, res) => {
  const { shopId, recordedBy, ...updates } = req.body;
  const expense = await Expense.findOneAndUpdate({ _id: req.params.id, ...shopScope(req) }, updates, { new: true });
  if (!expense) return res.status(404).json({ error: "Expense not found" });
  res.json(expense);
};

exports.deleteExpense = async (req, res) => {
  const expense = await Expense.findOneAndDelete({ _id: req.params.id, ...shopScope(req) });
  if (!expense) return res.status(404).json({ error: "Expense not found" });
  // Put the money back where it was paid from.
  const label = `Reversed expense: ${expense.category}${expense.note ? ` - ${expense.note}` : ""} (deleted)`;
  if (expense.paymentSource === "cash") {
    await recordCashMovement({ shopId: expense.shopId, type: "expense", direction: "in", amount: expense.amount, note: label, createdBy: await recorderName(req) });
  } else if (expense.paymentSource === "bank" && expense.bankId) {
    await recordCustomerBankMovement({ bankId: expense.bankId, shopId: expense.shopId, type: "deposit", amount: expense.amount, note: label, createdBy: await recorderName(req) });
  }
  res.status(204).send();
};
