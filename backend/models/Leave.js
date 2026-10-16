const mongoose = require("mongoose");

// Dr / Service leave (Availability page). One document per Dr or Service
// per date. fullDay = not available at all that date; otherwise `times`
// lists the "HH:MM" slots that are off. Leave slots can't be booked on the
// POS or the online appointment page (see services/leaveService.js).
const leaveSchema = new mongoose.Schema(
  {
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true, index: true },
    name: { type: String, required: true, trim: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    fullDay: { type: Boolean, default: false },
    times: { type: [String], default: [] },
    note: { type: String, default: "", trim: true, maxlength: 300 },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

leaveSchema.index({ shopId: 1, name: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Leave", leaveSchema);
