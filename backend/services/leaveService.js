const Leave = require("../models/Leave");
const Product = require("../models/Product");
const Shop = require("../models/Shop");

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function weekdayOf(date) {
  const [y, m, d] = String(date).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function prettyTime(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  const hh = h % 24;
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(m).padStart(2, "0")} ${hh >= 12 ? "PM" : "AM"}`;
}

// Weekly schedule check (Manage Appointments' work days / hours). Returns
// a message when the Dr/Service doesn't work at that date/time, else null.
const HHMM = /^\d{2}:\d{2}$/;

// Clinic hours from Settings; end at/before start (e.g. "02:00") = midnight.
function clinicHours(shop) {
  const start = HHMM.test(shop?.clinicStart || "") ? shop.clinicStart : "09:00";
  let end = HHMM.test(shop?.clinicEnd || "") ? shop.clinicEnd : "21:00";
  if (end <= start) end = "24:00";
  return { start, end };
}

async function findScheduleProblem(shopId, name, date, time) {
  if (!shopId || !name || !/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return null;
  const [product, shop, special] = await Promise.all([
    Product.findOne({ shopId, name }).select("workDays workStart workEnd").lean(),
    Shop.findById(shopId).select("clinicStart clinicEnd").lean(),
    Leave.findOne({ shopId, name, date }).select("extraFullDay extraTimes").lean(),
  ]);
  // Extra availability set on the Dr Availability page beats the routine.
  if (special?.extraFullDay) return null;
  if (time && (special?.extraTimes || []).includes(time)) return null;
  if (!product) return null;
  const clinic = clinicHours(shop);
  if (time && HHMM.test(time) && (time < clinic.start || time >= clinic.end)) {
    return `The clinic is open from ${prettyTime(clinic.start)} until ${prettyTime(clinic.end)}. Please pick another time.`;
  }
  const days = Array.isArray(product.workDays) ? product.workDays.filter((d) => d >= 0 && d <= 6) : [];
  if (days.length > 0 && !days.includes(weekdayOf(date))) {
    const list = [...days].sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join(", ");
    return `${name} doesn't work on ${DAY_NAMES[weekdayOf(date)]}s - available on ${list}. Please pick another date.`;
  }
  if (time && /^\d{2}:\d{2}$/.test(time)) {
    const start = /^\d{2}:\d{2}$/.test(product.workStart || "") ? product.workStart : "";
    const end = /^\d{2}:\d{2}$/.test(product.workEnd || "") ? product.workEnd : "";
    if ((start && time < start) || (end && time >= end)) {
      return `${name} is available ${start ? `from ${prettyTime(start)}` : ""}${end ? ` until ${prettyTime(end)}` : ""}. Please pick another time.`;
    }
  }
  return null;
}

// Is this Dr/Service on leave at this date (and time)? Returns the leave
// document, or null when they are available.
async function findLeaveFor(shopId, name, date, time) {
  if (!shopId || !name || !date) return null;
  const leave = await Leave.findOne({ shopId, name, date }).lean();
  if (!leave) return null;
  if (!leave.fullDay && !(leave.times || []).length) return null; // only extra availability
  if (leave.fullDay) return leave;
  if (time && (leave.times || []).includes(time)) return leave;
  return time ? null : leave;
}

function leaveMessage(name, date, time, leave) {
  if (leave.fullDay) return `${name} is on leave on ${date}. Please pick another date.`;
  return `${name} is on leave at ${time} on ${date}. Please pick another time.`;
}

module.exports = { findLeaveFor, leaveMessage, findScheduleProblem };
