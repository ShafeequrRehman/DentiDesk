// Patient-side price hiding (Settings > Online prices): a clinic can hide
// the price of its Drs and/or its Services on the online appointment page
// and in the WhatsApp messages patients get. POS and staff screens always
// show real prices - the real price is still what the appointment is
// billed at.

// Same rule as the frontend's isDoctorProduct (src/lib/appointments.ts).
function isDoctorLike(name, category) {
  if (/\b(drs?|doctors?)\b/i.test(String(category || ""))) return true;
  return /^dr\.?\s/i.test(String(name || ""));
}

function priceHiddenFor(shop, name, category) {
  if (!shop) return false;
  return isDoctorLike(name, category) ? Boolean(shop.hideOnlinePriceDrs) : Boolean(shop.hideOnlinePriceServices);
}

// name -> category for this clinic's Drs/Services (order items carry only
// the name).
async function categoryLookup(shopId) {
  const Product = require("../models/Product");
  const products = await Product.find({ shopId }).select("name category").lean();
  return new Map(products.map((product) => [String(product.name || "").trim().toLowerCase(), product.category || ""]));
}

function itemPriceHidden(shop, item, categories) {
  const category = categories ? categories.get(String(item?.name || "").trim().toLowerCase()) : "";
  return priceHiddenFor(shop, item?.name, category);
}

function anyPriceHiddenSetting(shop) {
  return Boolean(shop && (shop.hideOnlinePriceDrs || shop.hideOnlinePriceServices));
}

module.exports = { isDoctorLike, priceHiddenFor, categoryLookup, itemPriceHidden, anyPriceHiddenSetting };
