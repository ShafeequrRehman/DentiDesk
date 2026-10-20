const mongoose = require("mongoose");

// Patient testimonials (Testimonials page): pictures and videos shown on
// the online appointment page, under the Drs & Services. An uploaded file
// lives on the server's disk (uploads/testimonials/<shopId>/...); a link
// (YouTube or a direct image/video URL) is stored as-is.
const testimonialSchema = new mongoose.Schema(
  {
    shopId: { type: mongoose.Schema.Types.ObjectId, ref: "Shop", required: true, index: true },
    // image | video (uploaded or direct link) | youtube
    kind: { type: String, enum: ["image", "video", "youtube"], required: true },
    // Uploaded: "/media/testimonials/<shopId>/<file>"; link: the full URL.
    url: { type: String, required: true, trim: true, maxlength: 1000 },
    fileName: { type: String, default: "" },
    title: { type: String, default: "", trim: true, maxlength: 200 },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Testimonial", testimonialSchema);
