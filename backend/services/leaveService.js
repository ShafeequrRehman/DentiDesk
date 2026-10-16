const Leave = require("../models/Leave");

// Is this Dr/Service on leave at this date (and time)? Returns the leave
// document, or null when they are available.
async function findLeaveFor(shopId, name, date, time) {
  if (!shopId || !name || !date) return null;
  const leave = await Leave.findOne({ shopId, name, date }).lean();
  if (!leave) return null;
  if (leave.fullDay) return leave;
  if (time && (leave.times || []).includes(time)) return leave;
  return time ? null : leave;
}

function leaveMessage(name, date, time, leave) {
  if (leave.fullDay) return `${name} is on leave on ${date}. Please pick another date.`;
  return `${name} is on leave at ${time} on ${date}. Please pick another time.`;
}

module.exports = { findLeaveFor, leaveMessage };
