const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Testimonial = require("../models/Testimonial");

const UPLOAD_ROOT = path.join(__dirname, "..", "uploads", "testimonials");
const MAX_PER_CLINIC = 40;
const IMAGE_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
// Videos are never uploaded (they eat server space) - only YouTube links.

// Public address of this server (same rule as publicOrderController's
// publicOrigin) - uploaded files are returned as full URLs.
function originOf(req) {
  const configured = process.env.VITE_API_URL ? process.env.VITE_API_URL.replace(/\/api\/?$/, "") : "";
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

function shape(doc, req) {
  const url = doc.url.startsWith("/media/") ? `${originOf(req)}${doc.url}` : doc.url;
  return { id: String(doc._id), kind: doc.kind, url, title: doc.title || "", createdAt: doc.createdAt };
}

function youtubeId(url) {
  const match = String(url).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/);
  return match ? match[1] : null;
}

async function listFor(shopId) {
  return Testimonial.find({ shopId }).sort({ createdAt: -1 }).limit(MAX_PER_CLINIC).lean();
}

// GET /api/testimonials
exports.list = async (req, res) => {
  try {
    const docs = await listFor(req.user.shopId);
    res.json(docs.map((doc) => shape(doc, req)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// GET /api/public/:shopId/testimonials (online appointment page)
exports.listPublic = async (req, res) => {
  try {
    const docs = await listFor(req.shop._id);
    res.set("Cache-Control", "public, max-age=60");
    res.json(docs.map((doc) => shape(doc, req)));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

async function underLimit(shopId) {
  return (await Testimonial.countDocuments({ shopId })) < MAX_PER_CLINIC;
}

// POST /api/testimonials/upload?title=...  body: the raw image/video file
exports.upload = async (req, res) => {
  try {
    const shopId = String(req.user.shopId);
    const type = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    const ext = IMAGE_TYPES[type];
    if (!ext) return res.status(400).json({ message: "Only pictures (JPG, PNG, WEBP, GIF) can be uploaded - for a video, paste its YouTube link." });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ message: "The file is empty." });
    if (!(await underLimit(shopId))) return res.status(400).json({ message: `Up to ${MAX_PER_CLINIC} testimonials - delete an old one first.` });

    const dir = path.join(UPLOAD_ROOT, shopId);
    await fs.promises.mkdir(dir, { recursive: true });
    const fileName = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
    await fs.promises.writeFile(path.join(dir, fileName), req.body);

    const doc = await Testimonial.create({
      shopId,
      kind: "image",
      url: `/media/testimonials/${shopId}/${fileName}`,
      fileName,
      title: String(req.query.title || "").slice(0, 200),
      createdBy: req.user.id ? String(req.user.id) : "",
    });
    res.status(201).json(shape(doc.toObject(), req));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// POST /api/testimonials/link  { url, title } - a YouTube video or a
// direct https link to a picture/video.
exports.addLink = async (req, res) => {
  try {
    const shopId = req.user.shopId;
    const url = String(req.body?.url || "").trim();
    if (!/^https:\/\/[^\s]+$/i.test(url)) return res.status(400).json({ message: "Paste a full https:// link." });
    if (!(await underLimit(shopId))) return res.status(400).json({ message: `Up to ${MAX_PER_CLINIC} testimonials - delete an old one first.` });
    let kind;
    let finalUrl = url;
    const yt = youtubeId(url);
    if (yt) {
      kind = "youtube";
      finalUrl = `https://www.youtube.com/embed/${yt}`;
    } else if (/\.(jpe?g|png|webp|gif)(\?|$)/i.test(url)) {
      kind = "image";
    } else {
      return res.status(400).json({ message: "For a video use its YouTube link; for a picture, a direct link ending in .jpg/.png/.webp." });
    }
    const doc = await Testimonial.create({ shopId, kind, url: finalUrl, title: String(req.body?.title || "").slice(0, 200), createdBy: req.user.id ? String(req.user.id) : "" });
    res.status(201).json(shape(doc.toObject(), req));
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// DELETE /api/testimonials/:id - removes the uploaded file too.
exports.remove = async (req, res) => {
  try {
    const doc = await Testimonial.findOneAndDelete({ _id: req.params.id, shopId: req.user.shopId });
    if (!doc) return res.status(404).json({ message: "Testimonial not found." });
    if (doc.fileName && /^[\w.-]+$/.test(doc.fileName)) {
      await fs.promises.unlink(path.join(UPLOAD_ROOT, String(doc.shopId), doc.fileName)).catch(() => {});
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.UPLOAD_ROOT = UPLOAD_ROOT;
