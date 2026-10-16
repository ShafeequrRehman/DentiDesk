// Dashboard Clear / Undo / Delete: a stable id for one history entry.
// Newer entries have their own _id; older ones (saved before entries had
// ids) are found by their createdAt time instead.
function entryRef(entry) {
  if (entry?._id) return String(entry._id);
  const time = entry?.createdAt ? new Date(entry.createdAt).getTime() : NaN;
  return Number.isFinite(time) ? `t${time}` : "";
}

function findEntryIndex(history, ref) {
  if (!ref) return -1;
  return (history || []).findIndex((entry) => entryRef(entry) === ref);
}

// +amount for money in, -amount for money out.
function signedAmount(entry) {
  const amount = Number(entry?.amount || 0);
  return entry?.direction === "out" ? -amount : amount;
}

module.exports = { entryRef, findEntryIndex, signedAmount };
