const Leave = require("../models/Leave");
const { shopScope } = require("../middleware/attachShopScope");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// GET /api/leaves?name=&date=&from=&to=
exports.getLeaves = async (req, res) => {
  try {
    const query = { ...shopScope(req) };
    const name = String(req.query.name || "").trim();
    const date = String(req.query.date || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    if (name) query.name = name;
    // A Dr's own login only sees their own leave / availability.
    if (req.user?.linkedDoctor) query.name = req.user.linkedDoctor;
    if (DATE_RE.test(date)) query.date = date;
    else if (DATE_RE.test(from) || DATE_RE.test(to)) {
      query.date = {};
      if (DATE_RE.test(from)) query.date.$gte = from;
      if (DATE_RE.test(to)) query.date.$lte = to;
    }
    const leaves = await Leave.find(query).sort({ date: 1, name: 1 }).limit(1000).lean();
    res.json(leaves.map((leave) => ({ ...leave, id: String(leave._id) })));
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};

// PUT /api/leaves  body: { name, date, fullDay, times: ["HH:MM"], note }
// Saves the leave for one Dr/Service on one date. Not full day and no
// times = no leave (removed).
exports.saveLeave = async (req, res) => {
  try {
    const scope = shopScope(req);
    const name = String(req.body?.name || "").trim();
    const date = String(req.body?.date || "").trim();
    if (!name) return res.status(400).json({ error: "Pick a Dr or Service." });
    if (req.user?.linkedDoctor && name !== req.user.linkedDoctor) {
      return res.status(403).json({ error: "You can only change your own availability." });
    }
    if (!DATE_RE.test(date)) return res.status(400).json({ error: "Pick a date." });
    const fullDay = req.body?.fullDay === true;
    const times = fullDay
      ? []
      : [...new Set((Array.isArray(req.body?.times) ? req.body.times : []).map(String).filter((t) => TIME_RE.test(t)))].sort();
    const note = String(req.body?.note || "").trim().slice(0, 300);
    // Extra availability (outside the weekly routine). Never together
    // with full-day leave, and a slot is either leave or extra - not both.
    const extraFullDay = !fullDay && req.body?.extraFullDay === true;
    const extraTimes = fullDay || extraFullDay
      ? []
      : [...new Set((Array.isArray(req.body?.extraTimes) ? req.body.extraTimes : []).map(String).filter((t) => TIME_RE.test(t) && !times.includes(t)))].sort();

    if (!fullDay && times.length === 0 && !extraFullDay && extraTimes.length === 0) {
      await Leave.deleteOne({ ...scope, name, date });
      return res.json({ name, date, fullDay: false, times: [], extraFullDay: false, extraTimes: [], note: "", deleted: true });
    }
    const leave = await Leave.findOneAndUpdate(
      { ...scope, name, date },
      { $set: { fullDay, times, extraFullDay, extraTimes, note, createdBy: req.user?.name || req.user?.email || "" }, $setOnInsert: { ...scope, name, date } },
      { new: true, upsert: true, runValidators: true },
    ).lean();
    res.json({ ...leave, id: String(leave._id) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};

// DELETE /api/leaves/:id
exports.deleteLeave = async (req, res) => {
  try {
    await Leave.deleteOne({ _id: req.params.id, ...shopScope(req), ...(req.user?.linkedDoctor ? { name: req.user.linkedDoctor } : {}) });
    res.json({ ok: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: error.message });
  }
};
