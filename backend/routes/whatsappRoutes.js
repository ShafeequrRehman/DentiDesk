const express = require("express");
const router = express.Router();
const { getWhatsAppServiceForShop, normalizePhone } = require("../services/whatsappService");
const Customer = require("../models/Customer");
const authenticate = require("../middleware/authenticate");
const { requireShopMember } = require("../middleware/roleGuards");
const requireAnyPermission = require("../middleware/requireAnyPermission");

// Every route below is scoped to req.user.shopId (verified JWT payload,
// same trust boundary as attachShopScope.js) - each shop gets its own
// isolated WhatsApp session (see services/whatsappService.js). A shop
// owner scans their own QR code once per shop, from Settings, in either
// the desktop app or the mobile app - both just hit these same routes.
router.use(authenticate, requireShopMember);

// Broken Access Control fix: this router only ever checked "logged in as
// SOME employee of this shop" - never which page/permission the caller
// actually has, so any employee token could pair/unpair the shop's WhatsApp
// session or blast messages to any phone number. Each route below is gated
// to exactly the permissions whose page legitimately calls it today (see
// pos-api.ts's fetchWhatsappStatus/fetchWhatsappQR/sendWhatsappMessage/
// sendWhatsappDocument and their callers):
//   /status - WhatsappPage (whatsapp.manage) and DuesPage's own
//             pre-send connectivity check (dues.manage).
//   /qr     - WhatsappPage only (whatsapp.manage) - pairing the shop's
//             session is not something any other page triggers.
//   /send   - WhatsappPage's manual/broadcast send (whatsapp.manage),
//             DuesPage's due-reminder send (dues.manage), and POS/Sales'
//             order-status WhatsApp pings (sales.create).
//   /send-document - receipts from Sales (sales.create), demand
//             sheets/statements from Purchase (purchases.manage) and
//             Ingredient Stock (inventory.manage/stock.manage), and the
//             Close Restaurant day-end summary, gated the same as the
//             button that triggers it (shop.session.manage).
const canViewStatus = requireAnyPermission("whatsapp.manage", "dues.manage");
const canSendMessage = requireAnyPermission("whatsapp.manage", "dues.manage", "sales.create");
const canSendDocument = requireAnyPermission(
  "sales.create",
  "purchases.manage",
  "inventory.manage",
  "stock.manage",
  "shop.session.manage",
);

function getServiceForRequest(req) {
  return getWhatsAppServiceForShop(req.user.shopId);
}

// GET STATUS
router.get("/status", canViewStatus, async (req, res) => {
  try {
    const service = await getServiceForRequest(req);
    res.json(service.getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET QR - this shop's own QR code to scan, not shared with any other shop
router.get("/qr", requireAnyPermission("whatsapp.manage"), async (req, res) => {
  try {
    const service = await getServiceForRequest(req);
    const qr = service.getQR();

    if (!qr) return res.status(404).json({ message: "QR not ready" });

    res.json({ qr });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RESET - forget this clinic's saved WhatsApp session and make a fresh QR.
router.post("/reset", requireAnyPermission("whatsapp.manage"), async (req, res) => {
  try {
    const service = await getServiceForRequest(req);
    await service.reset();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SEND MESSAGE - text only, no file involved, unaffected by where the
// backend runs.
router.post("/send", canSendMessage, async (req, res) => {
  try {
    const service = await getServiceForRequest(req);
    const { phone, message } = req.body;

    const result = await service.sendMessage(phone, message);

    if (result.success) {
      res.json({ success: true });
    } else {
      // A send WhatsApp refused (not linked, bad number) - a clear message, not a crash.
      res.status(400).json(result);
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SEND DOCUMENT
//
// Used to take a raw `filePath` from the request body and read it off
// disk with fs.readFileSync - that only ever worked because the backend
// used to run in-process on the same till that generated the PDF (see
// main.js's createReceiptPdfFromOrderData). Now that the backend can run
// on a different machine entirely (backend/README-deploy.md), a path
// from the client's disk means nothing here - the fix is the client reads
// the file itself and sends the actual bytes (base64-encoded, `fileBase64`
// below), which works identically regardless of where the backend runs.
router.post("/send-document", canSendDocument, async (req, res) => {
  try {
    const service = await getServiceForRequest(req);
    const { phone, fileBase64, fileName } = req.body;

    if (!fileBase64) {
      return res.status(400).json({ success: false, error: "fileBase64 is required" });
    }
    // Clear errors instead of a send that never happens: a missing/wrong
    // number, WhatsApp not linked, or a number that isn't on WhatsApp.
    if (!normalizePhone(phone)) {
      return res.status(400).json({ success: false, reason: "invalid_phone", error: "This patient has no correct phone number - add a correct number first." });
    }
    if (!service.getStatus().isConnected) {
      return res.status(409).json({ success: false, reason: "not_connected", error: "WhatsApp is not connected - link it on the WhatsApp page first." });
    }
    if ((await service.isOnWhatsApp(phone)) === false) {
      return res.status(400).json({ success: false, reason: "not_on_whatsapp", error: `${phone} is not on WhatsApp - check the patient's number.` });
    }

    const fileBuffer = Buffer.from(fileBase64, "base64");
    await service.sendDocument(phone, fileBuffer, fileName);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- Post page: send one picture to every patient ------------------------
// Runs in the background (a few seconds apart, so WhatsApp doesn't flag the
// clinic's number). Numbers that are wrong or not on WhatsApp are skipped
// quietly and only counted. Progress: GET /broadcast/:id.
const broadcastJobs = new Map();
const canPost = requireAnyPermission("whatsapp.manage");

router.post("/broadcast", canPost, async (req, res) => {
  try {
    const { imageBase64, mimetype, caption } = req.body || {};
    if (!imageBase64) return res.status(400).json({ error: "Pick a picture to post." });
    const service = await getServiceForRequest(req);
    if (!service.getStatus().isConnected) {
      return res.status(409).json({ reason: "not_connected", error: "WhatsApp is not connected - link it on the WhatsApp page first." });
    }
    const imageBuffer = Buffer.from(String(imageBase64).replace(/^data:[^;]+;base64,/, ""), "base64");
    if (imageBuffer.length === 0) return res.status(400).json({ error: "The picture could not be read." });

    const customers = await Customer.find({ shopId: req.user.shopId, phone: { $nin: ["", "03000000000"] } }).select("name phone").lean();
    const seen = new Set();
    const recipients = [];
    let invalid = 0;
    for (const customer of customers) {
      const normalized = normalizePhone(customer.phone);
      if (!normalized) {
        invalid += 1;
        continue;
      }
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      recipients.push(customer.phone);
    }

    const id = `${req.user.shopId}-${Date.now()}`;
    const job = { id, total: recipients.length, sent: 0, notOnWhatsApp: 0, failed: 0, invalid, done: false, startedAt: new Date() };
    broadcastJobs.set(id, job);
    res.json(job);

    (async () => {
      for (const phone of recipients) {
        try {
          const onWhatsApp = await service.isOnWhatsApp(phone);
          if (onWhatsApp === false) {
            job.notOnWhatsApp += 1;
            continue;
          }
          await service.sendImage(phone, imageBuffer, mimetype, String(caption || "").slice(0, 1000));
          job.sent += 1;
        } catch {
          job.failed += 1;
        }
        await new Promise((resolve) => setTimeout(resolve, 2500));
      }
      job.done = true;
      job.finishedAt = new Date();
      setTimeout(() => broadcastJobs.delete(id), 6 * 60 * 60 * 1000);
    })();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/broadcast/:id", canPost, (req, res) => {
  const job = broadcastJobs.get(req.params.id);
  if (!job || !String(job.id).startsWith(String(req.user.shopId))) return res.status(404).json({ error: "Post not found." });
  res.json(job);
});

module.exports = router;
