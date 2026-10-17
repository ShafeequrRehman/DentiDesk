const QRCode = require("qrcode");
const pino = require("pino");
const path = require("path");
const fs = require("fs");
const os = require("os");

// Per-shop WhatsApp/Baileys sessions.
//
// Previously this whole module was one set of module-level variables
// (sock, qrBase64, socketReady, ...) - a single shared WhatsApp connection
// for every shop on the backend, regardless of which shop was actually
// asking (see whatsappRoutes.js's old comment about this). That meant
// every shop saw the same QR code and sent messages from the same number.
// Now every bit of that state lives inside a per-shop ShopWhatsAppSession,
// keyed by shopId, with its own auth folder so each shop's login is
// completely isolated from every other shop's - one shop logging out or
// getting logged out never touches another shop's session.
let cachedBaileys = null;
async function getBaileys() {
  if (!cachedBaileys) {
    const baileys = await import("@whiskeysockets/baileys");
    cachedBaileys = {
      makeWASocket: baileys.default ? baileys.default : baileys,
      useMultiFileAuthState: baileys.useMultiFileAuthState,
      DisconnectReason: baileys.DisconnectReason,
      fetchLatestBaileysVersion: baileys.fetchLatestBaileysVersion,
      Browsers: baileys.Browsers,
    };
  }
  return cachedBaileys;
}

const isPackaged = process.env.ELECTRON_IS_PACKAGED === "true";
const basePath = isPackaged ? path.join(os.homedir(), ".pos-system") : path.resolve(__dirname, "../../");
// Every shop gets its own subfolder: .auth_whatsapp/<shopId>/ instead of
// one shared .auth_whatsapp/ - this is the actual on-disk isolation that
// makes "each shop scans their own WhatsApp" true.
const AUTH_ROOT_DIR = path.join(basePath, ".auth_whatsapp");

function normalizePhone(phone) {
  if (!phone) return null;
  const num = phone.toString().trim().replace(/\D/g, "");

  if (num.startsWith("0") && num.length === 11) return `92${num.substring(1)}`;
  if (num.length === 10) return `92${num}`;
  if (num.startsWith("92") && num.length === 12) return num;
  if (num.startsWith("0092")) return num.replace(/^00/, "");
  return null;
}

// One instance of this class per shopId - all the state that used to be
// module-level globals now lives on `this`, so two shops' sessions can
// never leak into each other.
class ShopWhatsAppSession {
  constructor(shopId) {
    this.shopId = shopId;
    this.authDir = path.join(AUTH_ROOT_DIR, String(shopId));
    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }

    this.sock = null;
    this.qrBase64 = null;
    this.socketReady = false;
    this.initializing = null; // Promise while connecting, so concurrent callers share one attempt
    this.messageQueue = [];
    // Why the last connection attempt closed (shown on the WhatsApp page),
    // and how many closes in a row happened without ever showing a QR.
    this.lastError = "";
    this.failsWithoutQr = 0;
  }

  async _sendNow(phone, message) {
    if (!this.sock || !this.socketReady) throw new Error("socket-not-ready");
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error("invalid-phone");
    return this.sock.sendMessage(`${normalized}@s.whatsapp.net`, { text: message });
  }

  // `fileBuffer` is real file bytes (a Buffer), never a filesystem path -
  // the backend may be running on a completely different machine than
  // whatever client generated the PDF (see backend/README-deploy.md), so
  // a path from the client's disk means nothing here. Callers must read
  // the file into memory and send the bytes (base64 over HTTP - see
  // whatsappRoutes.js's /send-document route).
  // Is this number on WhatsApp? true / false; null when it can't be checked
  // right now (not connected, or WhatsApp didn't answer).
  async isOnWhatsApp(phone) {
    const normalized = normalizePhone(phone);
    if (!normalized) return false;
    if (!this.sock || !this.socketReady) return null;
    try {
      const result = await this.sock.onWhatsApp(`${normalized}@s.whatsapp.net`);
      return Array.isArray(result) && result.length > 0 ? Boolean(result[0].exists) : false;
    } catch {
      return null;
    }
  }

  // Post page: one picture (with an optional caption) to one number. Only
  // sends while connected - never queued.
  async sendImage(phone, imageBuffer, mimetype, caption) {
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error("invalid-phone");
    if (!this.sock || !this.socketReady) throw new Error("socket-not-ready");
    return this.sock.sendMessage(`${normalized}@s.whatsapp.net`, {
      image: imageBuffer,
      mimetype: mimetype || "image/jpeg",
      caption: caption || "",
    });
  }

  async _sendDocumentNow(phone, fileBuffer, fileName) {
    const normalized = normalizePhone(phone);
    if (!normalized) throw new Error("invalid-phone");
    if (!this.sock || !this.socketReady) throw new Error("socket-not-ready");

    return this.sock.sendMessage(`${normalized}@s.whatsapp.net`, {
      document: fileBuffer,
      mimetype: "application/pdf",
      fileName,
    });
  }

  sendMessage(phone, message, { queueIfNotReady = true } = {}) {
    return new Promise((resolve, reject) => {
      const normalized = normalizePhone(phone);
      if (!normalized) return reject(new Error("invalid-phone"));

      if (!this.sock || !this.socketReady) {
        if (queueIfNotReady) {
          this.messageQueue.push({ type: "message", phone, message, resolve, reject });
          return;
        }
        return reject(new Error("socket-not-ready"));
      }

      this._sendNow(phone, message).then(() => resolve({ success: true })).catch(reject);
    });
  }

  sendDocument(phone, fileBuffer, fileName) {
    const normalized = normalizePhone(phone);
    if (!normalized) return Promise.reject(new Error("invalid-phone"));

    return new Promise((resolve, reject) => {
      if (!this.sock || !this.socketReady) {
        this.messageQueue.push({ type: "document", phone, fileBuffer, fileName, resolve, reject });
        return;
      }
      this._sendDocumentNow(phone, fileBuffer, fileName).then(() => resolve({ success: true })).catch(reject);
    });
  }

  async _flushQueue() {
    if (!this.socketReady) return;

    while (this.messageQueue.length > 0) {
      const job = this.messageQueue.shift();
      if (!job) continue;

      try {
        if (job.type === "document") {
          await this._sendDocumentNow(job.phone, job.fileBuffer, job.fileName);
        } else {
          await this._sendNow(job.phone, job.message);
        }
        job.resolve({ success: true });
      } catch (error) {
        job.reject(error);
      }
    }
  }

  async initialize() {
    if (this.initializing) return this.initializing;

    this.initializing = (async () => {
      const { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = await getBaileys();

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      // Latest WhatsApp Web version - but never let a slow/blocked GitHub
      // lookup stop the QR from appearing (fall back to Baileys' built-in).
      let version;
      try {
        const latest = await Promise.race([
          fetchLatestBaileysVersion(),
          new Promise((_, reject) => setTimeout(() => reject(new Error("version-timeout")), 8000)),
        ]);
        version = latest?.version;
      } catch (error) {
        console.warn(`[whatsapp:${this.shopId}] could not fetch latest WhatsApp version (${error.message}) - using default`);
      }

      this.sock = makeWASocket({
        ...(version ? { version } : {}),
        auth: state,
        logger: pino({ level: "silent" }),
        // A standard browser name - WhatsApp rejects some custom ones (405).
        browser: Browsers.ubuntu("Chrome"),
        printQRInTerminal: false,
        connectTimeoutMs: 30000,
      });

      console.log(`[whatsapp:${this.shopId}] socket initialized`);

      this.sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.qrBase64 = await QRCode.toDataURL(qr);
          this.socketReady = false;
          this.failsWithoutQr = 0;
          this.lastError = "";
          console.log(`[whatsapp:${this.shopId}] QR generated`);
        }

        if (connection === "open") {
          this.socketReady = true;
          this.qrBase64 = null;
          this.failsWithoutQr = 0;
          this.lastError = "";
          console.log(`[whatsapp:${this.shopId}] connected`);
          await this._flushQueue();
        }

        if (connection === "close") {
          const { DisconnectReason: DR } = await getBaileys();
          const reasonCode = lastDisconnect?.error?.output?.statusCode || lastDisconnect?.error?.message || "unknown";

          this.socketReady = false;
          this.qrBase64 = null;
          this.lastError = String(reasonCode);
          console.log(`[whatsapp:${this.shopId}] disconnected:`, reasonCode);

          // Stuck without a QR (e.g. 405 / bad saved session): after 2
          // tries, start clean so a fresh QR can be generated.
          if (!state.creds?.registered) this.failsWithoutQr += 1;
          if (reasonCode !== DR.loggedOut && this.failsWithoutQr >= 2) {
            console.log(`[whatsapp:${this.shopId}] no QR after ${this.failsWithoutQr} tries - clearing the saved session to get a fresh QR.`);
            this.failsWithoutQr = 0;
            fs.rmSync(this.authDir, { recursive: true, force: true });
            fs.mkdirSync(this.authDir, { recursive: true });
          }

          if (reasonCode === DR.loggedOut) {
            console.log(`[whatsapp:${this.shopId}] logged out - clearing this clinic's session only, generating a fresh QR next time.`);
            fs.rmSync(this.authDir, { recursive: true, force: true });
            fs.mkdirSync(this.authDir, { recursive: true });
          }

          setTimeout(() => {
            this.initializing = null;
            this.initialize().catch((error) => {
              console.error(`[whatsapp:${this.shopId}] re-initialization failed:`, error);
            });
          }, 5000);
        }
      });

      this.sock.ev.on("creds.update", saveCreds);

      return this;
    })().catch((error) => {
      this.initializing = null;
      throw error;
    });

    return this.initializing;
  }

  getQR() {
    return this.qrBase64;
  }

  getStatus() {
    return {
      isConnected: this.socketReady,
      socketReady: this.socketReady,
      hasQR: !!this.qrBase64,
      lastError: this.lastError,
    };
  }

  // "Get a new QR" on the WhatsApp page: forget the saved session and
  // start over.
  async reset() {
    try {
      this.sock?.end?.(new Error("reset"));
    } catch {
      // already closed
    }
    this.sock = null;
    this.socketReady = false;
    this.qrBase64 = null;
    this.lastError = "";
    this.failsWithoutQr = 0;
    fs.rmSync(this.authDir, { recursive: true, force: true });
    fs.mkdirSync(this.authDir, { recursive: true });
    this.initializing = null;
    return this.initialize();
  }
}

// shopId -> Promise<ShopWhatsAppSession>, so concurrent requests for the
// same shop while it's still connecting share one in-flight attempt
// instead of racing to create two sockets for the same shop.
const sessionsByShop = new Map();

function getWhatsAppServiceForShop(shopId) {
  if (!shopId) {
    return Promise.reject(new Error("shopId is required for a WhatsApp session"));
  }

  const key = String(shopId);
  let sessionPromise = sessionsByShop.get(key);

  if (!sessionPromise) {
    const session = new ShopWhatsAppSession(key);
    sessionPromise = session.initialize().catch((error) => {
      sessionsByShop.delete(key);
      throw error;
    });
    sessionsByShop.set(key, sessionPromise);
  }

  return sessionPromise;
}

module.exports = { getWhatsAppServiceForShop, normalizePhone };
