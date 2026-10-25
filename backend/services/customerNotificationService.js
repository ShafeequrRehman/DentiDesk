const { getWhatsAppServiceForShop } = require("./whatsappService");
const { currencySign } = require("./currency");
const { categoryLookup, itemPriceHidden, anyPriceHiddenSetting } = require("./onlinePrice");

// Automated WhatsApp status updates sent straight to the CUSTOMER (not the
// rider/staff) at two points in a customer-qr (QR/online) order's
// lifecycle: staff confirming it (orderController.updateTrackingStatus)
// and it being fully completed/settled (orderController.updateOrder's
// completeAndSettle branch). Deliberately only ever called for
// `order.source === "customer-qr"` orders - a walk-in/staff-placed order
// already gets its own separate (Electron-only, PDF) receipt-on-WhatsApp
// flow client-side, so sending this too would double-message that
// customer. Mirrors riderNotificationService.js's shape: fire-and-forget,
// every failure caught internally, never throws back to the caller.

const WALKIN_PLACEHOLDER_PHONE = "03000000000";

// Settings > Manage Receipt (saved per clinic) - the same contact numbers
// and address the slips print; the profile phone/address only as a fallback.
function clinicPhones(shop) {
  return String(shop?.receiptSettings?.receiptContact || shop?.phone || "").trim();
}

function clinicAddress(shop) {
  return String(shop?.receiptSettings?.receiptAddress || shop?.address || "").trim();
}

function hasRealPhone(order) {
  const phone = order?.customer?.phone;
  return Boolean(phone && phone !== WALKIN_PLACEHOLDER_PHONE);
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("en-PK");
}

function formatDate(date) {
  return new Date(date || Date.now()).toLocaleString("en-PK", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// isHidden(item): the clinic hides this Dr's / Service's price from
// patients (Settings) - the line then shows no amount.
function formatItems(items, C = "$", isHidden = () => false) {
  const lines = (items || []).map((item) => {
    const qty = Number(item.quantity) || 0;
    const lineTotal = formatMoney((Number(item.price) || 0) * qty);
    const variation = item.variation && item.variation !== "Standard" ? ` (${item.variation})` : "";
    return isHidden(item) ? `- ${qty}x ${item.name}${variation}` : `- ${qty}x ${item.name}${variation} — ${C}${lineTotal}`;
  });
  return lines.join("\n") || "-";
}

// No dedicated delivery-fee/service-charge field exists on Order yet - see
// orderController.recalculateTotals, `tax` is always 0 today but is the
// closest existing "extra line item" slot, so it doubles as "Other
// Charges" here rather than inventing a new field for this message alone.
function otherCharges(order) {
  return formatMoney(order.tax);
}

function orderNumberOf(order) {
  return order.dailyOrderNumber ?? String(order._id || "").slice(-6);
}

function formatSlotTime(hhmm) {
  if (!/^\d{2}:\d{2}$/.test(hhmm || "")) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function formatSlotDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || "")) return "";
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

// Sent when the clinic presses "Mark Confirmed" on an online appointment.
// "Unpaid / Partly paid / Paid" for the WhatsApp text - from what was
// really paid on this appointment (an advance that covered it says so).
function paymentLine(order, C, hideMoney) {
  const total = Number(order.total || 0);
  const paid = Number(order.paidAmount || 0);
  const remaining = typeof order.remainingAmount === "number" ? Math.max(order.remainingAmount, 0) : Math.max(total - paid, 0);
  const advance = Number(order.advanceApplied || 0);
  if (remaining > 0) {
    const amount = hideMoney ? "" : ` - ${C}${formatMoney(remaining)} to pay at the clinic`;
    return paid > 0 ? `Payment: *Partly paid*${amount}` : `Payment: *Unpaid*${amount || " - pay at the clinic"}`;
  }
  if (total > 0 && paid <= 0 && advance > 0) return "Payment: *Paid from your advance*";
  return "Payment: *Paid*";
}

function buildAppointmentConfirmedMessage(order, shop, isHidden = () => false) {
  const shopName = shop?.name || "";
  const C = currencySign(shop);
  // Any hidden price -> no totals either (they would give it away).
  const hideMoney = (order.items || []).some(isHidden);
  const forLabel = /^dr\.?\s/i.test(order.doctorName || "") ? "Dr" : "Service";
  return [
    `*Your appointment is confirmed* ✅`,
    `Hello ${order.customer?.name || "there"},`,
    `${shopName} has confirmed your appointment.`,
    ``,
    `*Appointment Details*`,
    `------------------------`,
    `Appointment No: ${orderNumberOf(order)}`,
    order.doctorName ? `${forLabel}: ${order.doctorName}` : null,
    order.appointmentDate ? `Date: ${formatSlotDate(order.appointmentDate)}` : null,
    order.appointmentTime ? `Time: ${formatSlotTime(order.appointmentTime)}` : null,
    ...(() => {
      // What the appointment is for - the Dr line itself is not a service.
      // Booking message = no prices / total / payment (that comes with
      // the completed message and the slip).
      const services = (order.items || []).filter((item) => item.name !== order.doctorName);
      return services.length ? [`Services:`, formatItems(services, C, () => true).replace(/- \d+x /g, "- ")] : [];
    })(),
    `------------------------`,
    `Please arrive 10 minutes before your time.`,
    `${clinicPhones(shop)}`,
    `${clinicAddress(shop)}`,
    `${shopName}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function buildOrderPlacedMessage(order, shop, isHidden = () => false) {
  const shopName = shop?.name || "";
  const C = currencySign(shop);
  const hideMoney = (order.items || []).some(isHidden);
  return [
    `Appointment Placed`,
    `Hello ${order.customer?.name || "there"}`,
    `Thank you for placing your appointment with ${shopName}`,
    `Your appointment has been successfully placed and is now being processed.`,
    `Appointment Details`,
    `------------------------`,
    `Appointment No: ${orderNumberOf(order)}`,
    `Date: ${formatDate(order.createdAt)}`,
    `Items:`,
    formatItems(order.items, C, () => true),
    `------------------------`,
    `Appointment Status: Processing`,
    `We appreciate your trust in ${shopName} and will keep you updated about your appointment.`,
    `Thank you for choosing us!`,
    `${clinicPhones(shop) || "-"}`,
    `${clinicAddress(shop) || "-"}`,
    `${shopName}`,
    `Quality - Trust - Service`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function buildOrderCompletedMessage(order, shop) {
  const shopName = shop?.name || "";
  const C = currencySign(shop);
  const remaining = Number(order.remainingAmount || 0);
  const paymentStatus = remaining > 0 ? `${C}${formatMoney(remaining)} Remaining` : `Fully Paid`;
  return [
    `Appointment Completed`,
    `Hello ${order.customer?.name || "there"}`,
    `Great news!`,
    `Your appointment from ${shopName} has been successfully completed.`,
    `Appointment Details`,
    `------------------------`,
    `Appointment No: ${orderNumberOf(order)}`,
    `Date: ${formatDate(order.createdAt)}`,
    `Items:`,
    formatItems(order.items, C),
    `Subtotal: ${C}${formatMoney(order.subtotal)}`,
    `Other Charges: ${C}${otherCharges(order)}`,
    `Total Amount: ${C}${formatMoney(order.total)}`,
    `Payment Details`,
    `Paid Amount: ${C}${formatMoney(order.paidAmount)}`,
    paymentStatus,
    `------------------------`,
    `Appointment Status: Completed`,
    `Thank you so much for shopping with ${shopName}!`,
    `Your support means a lot to us. We look forward to serving you again.`,
    `${clinicPhones(shop) || "-"}`,
    `${clinicAddress(shop) || "-"}`,
    `${shopName}`,
    `Quality - Trust - Service`,
  ].join("\n");
}

async function sendCustomerMessage(order, shop, message) {
  if (!hasRealPhone(order) || !shop?._id) return false;
  try {
    const service = await getWhatsAppServiceForShop(shop._id);
    await service.sendMessage(order.customer.phone, message);
    return true;
  } catch (error) {
    console.error(`Non-fatal: patient WhatsApp notification failed for appointment ${order?._id}`, error.message);
    return false;
  }
}

async function notifyCustomerConfirmed(order, shop) {
  let isHidden = () => false;
  try {
    if (anyPriceHiddenSetting(shop)) {
      const categories = await categoryLookup(order.shopId || shop._id);
      isHidden = (item) => itemPriceHidden(shop, item, categories);
    }
  } catch {
    // can't tell the categories - hide by the Dr name rule alone
    isHidden = (item) => itemPriceHidden(shop, item, null);
  }
  return sendCustomerMessage(order, shop, order.appointmentTime ? buildAppointmentConfirmedMessage(order, shop, isHidden) : buildOrderPlacedMessage(order, shop, isHidden));
}

// Sent when a pending appointment is cancelled (Appointments page Cancel,
// or the clinic declining an online one).
function buildAppointmentCancelledMessage(order, shop) {
  const shopName = shop?.name || "";
  const forLabel = /^dr\.?\s/i.test(order.doctorName || "") ? "Dr" : "Service";
  const reason = String(order.cancelReason || "").trim();
  const showReason = reason && !/^no reason provided$/i.test(reason);
  return [
    `*Your appointment is cancelled* ❌`,
    `Hello ${order.customer?.name || "there"},`,
    `Your appointment at ${shopName} has been cancelled.`,
    ``,
    `*Appointment Details*`,
    `------------------------`,
    `Appointment No: ${orderNumberOf(order)}`,
    order.doctorName ? `${forLabel}: ${order.doctorName}` : null,
    order.appointmentDate ? `Date: ${formatSlotDate(order.appointmentDate)}` : null,
    order.appointmentTime ? `Time: ${formatSlotTime(order.appointmentTime)}` : null,
    showReason ? `Reason: ${reason}` : null,
    `------------------------`,
    `To book a new time, please call us:`,
    `${clinicPhones(shop)}`,
    `${clinicAddress(shop)}`,
    `${shopName}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

async function notifyCustomerCancelled(order, shop) {
  return sendCustomerMessage(order, shop, buildAppointmentCancelledMessage(order, shop));
}

async function notifyCustomerCompleted(order, shop) {
  return sendCustomerMessage(order, shop, buildOrderCompletedMessage(order, shop));
}

module.exports = {
  notifyCustomerConfirmed,
  notifyCustomerCompleted,
  notifyCustomerCancelled,
  buildOrderPlacedMessage,
  buildOrderCompletedMessage,
};
