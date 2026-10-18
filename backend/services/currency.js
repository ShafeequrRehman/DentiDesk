// Per-clinic money settings, set by the Super Admin (New / Edit Clinic):
// currency "USD" ($) or "PKR" (Rs), and the "Powered by" line printed at
// the bottom of every slip (empty = nothing printed).
const DEFAULT_POWERED_BY = "www.sunrisereach.com";

function normalizeCurrency(value) {
  return String(value || "").toUpperCase() === "PKR" ? "PKR" : "USD";
}

function currencySign(shopOrCode) {
  const code = typeof shopOrCode === "string" ? shopOrCode : shopOrCode?.currency;
  return normalizeCurrency(code) === "PKR" ? "Rs " : "$";
}

// Older clinics saved before this existed keep the old default line.
function poweredByOf(shop) {
  if (!shop || shop.poweredBy === undefined || shop.poweredBy === null) return DEFAULT_POWERED_BY;
  return String(shop.poweredBy);
}

let ShopModel = null;
const cache = new Map();
async function currencySignFor(shopId) {
  if (!shopId) return "$";
  const key = String(shopId);
  const hit = cache.get(key);
  if (hit && hit.at > Date.now() - 60000) return hit.sign;
  if (!ShopModel) ShopModel = require("../models/Shop");
  const shop = await ShopModel.findById(shopId).select("currency").lean().catch(() => null);
  const sign = currencySign(shop);
  cache.set(key, { sign, at: Date.now() });
  return sign;
}

function forgetCurrency(shopId) {
  cache.delete(String(shopId));
}

module.exports = { DEFAULT_POWERED_BY, normalizeCurrency, currencySign, poweredByOf, currencySignFor, forgetCurrency };
