// Sales page (order list, order detail panel, payment/cancel/add-items
// modals, online-order QR controls, receipt/kitchen auto-print status
// messages) - see src/pages/dashboard/sales/SalesPage.tsx.
export const sales = {
  searchPlaceholder: "Search appointments, tables, patients, waiters - Enter to check out",
  orderImageAlt: "Appointment",

  stats: {
    pendingOrders: "Pending Appointments",
    completed: "Completed",
    cancelled: "Cancelled",
    openValue: "Open Value",
  },

  shiftContext: {
    openShift: "Showing appointments for the current open shift - not split by calendar date.",
    lastShift: "Showing appointments for this clinic's last shift - not split by calendar date.",
    noShiftRecorded: "No shift recorded yet. Open the clinic to start taking appointments.",
  },

  tabs: {
    pending: "Pending ({{count}})",
    completed: "Completed ({{count}})",
  },

  filters: {
    dineIn: "Dine In",
    takeAway: "Take Away",
    delivery: "Delivery",
  },

  loadingOrders: "Loading appointments...",
  noPendingOrdersFiltered: "No pending appointments matched the current filters.",
  noCompletedOrdersFiltered: "No completed appointments matched the current filters.",

  onlineWaitingAcceptance: "Online - Waiting Acceptance",
  onlineStatusPrefix: "Online - {{status}}",
  changeRequestedBadge: "Change Requested",

  orderNumberHeading: "Appointment #{{number}}",
  tableLabel: "Table {{table}}",
  orderTypeItemsCount: "{{type}} • {{count}} items",
  loadMore: "Load More ({{count}} more)",

  orderDetailLabel: "Appointment Detail",
  loadingFullOrderDetails: "Loading full appointment details...",
  sendingEllipsis: "Sending...",
  printReceipt: "Print Receipt",
  editLocked: "Edit Locked",

  boxLabels: {
    doctor: "Dr",
    appointmentDate: "Appointment Date",
    timeSlot: "Time Slot",
    checkup: "Checkup",
    orderNumber: "Appointment Number",
    createdAt: "Created At",
    customer: "Patient",
    waiter: "Waiter",
    table: "Table",
    orderType: "Appointment Type",
    paymentMethod: "Payment Method",
    deliveryLocation: "Delivery Location",
    previousDues: "Previous Dues",
    remaining: "Remaining",
    note: "Note",
    billTid: "TID",
    billName: "Bill Name",
    cashRecipientName: "Cash Given To",
  },

  notApplicable: "N/A",
  notShared: "Not shared",
  openInMaps: "Open in Maps",

  items: "Items",
  addItems: "Add Items",
  orderLocked: "Appointment Locked",
  loadingItems: "Loading items...",
  qty: "Qty {{quantity}}",

  billSummary: {
    subtotal: "Subtotal",
    tax: "Tax",
    billTotal: "Bill Total",
    paid: "Paid",
    grandTotal: "Grand Total",
    finalPayable: "Final Payable",
    discountPercent: "Discount ({{value}}% - Percentage)",
    discountFixed: "Discount (Fixed Value)",
  },

  completeOrder: "Complete Appointment",
  cancelOrder: "Cancel Appointment",
  orderCancelledKept: "This appointment was cancelled and kept for record.",
  cancelledBy: "Cancelled by {{name}}",
  reasonLabel: "Reason: {{reason}}",
  orderCompletedStored: "This appointment is completed and stored in sales history.",

  selectOrderTitle: "Select an appointment",
  selectOrderHint: "Choose any appointment card from the left.",

  completePaymentTitle: "Complete Payment",
  amountPaidLabel: "Amount Paid / Cash Received",
  billPlaceholder: "Bill is ${{payable}} - enter cash received",
  changeReturnLabel: "Change Return / Balance Due Back",
  putInPending: "Put in Pending - confirm with no payment collected right now (this leaves the full ${{payable}} as a due).",
  confirmPaymentButton: "Confirm Payment",
  payFull: "Pay Full",

  addItemsToOrderTitle: "Add Items To Appointment",
  autoPrintFrameTitle: "Auto Print Frame",

  loginTokenMissing: "Login token not found. Sales updates will not sync to MongoDB until you log in again.",
  localHubUnreachable: "Couldn't reach this till's own Local Hub{{reason}} - restart the app to enable offline appointment history.",
  failedToStart: "failed to start",

  orderNotInLocalCache: "This appointment isn't in this till's local cache - try again once back online.",
  couldNotRefreshOffline: "Couldn't refresh this appointment offline.",
  couldNotRefreshOrder: "Could not refresh this appointment.",
  noPendingOrderFound: "No pending appointment found matching \"{{query}}\".",

  savedSyncingToCloud: "Saved - syncing to the cloud...",
  savedWillSyncOffline: "Saved - will sync once back online.",
  couldNotSaveChange: "Could not save this change.",

  invalidPaymentAmountTitle: "Invalid Payment Amount",
  enterValidPaymentAmount: "Enter a valid payment amount.",
  paymentAmountRequiredTitle: "Payment Amount Required",
  paymentAmountRequiredMessage: "Enter a payment amount, or check \"Put in Pending\" to confirm this appointment with no payment collected.",

  zeroPaymentCustomerRequired: "Add the patient's name and phone number before confirming with zero payment - the full amount becomes a due, and dues need a real patient to track them against. Edit the appointment first, or pay in full instead.",
  partialPaymentCustomerRequired: "Add the patient's name and phone number before confirming a partial payment - dues need a real patient to track them against. Edit the appointment first, or pay in full instead.",

  confirmZeroPaymentTitle: "Confirm Zero Payment",
  confirmZeroPaymentMessage: "No payment will be collected right now for Appointment #{{orderNumber}} - the full ${{payable}} will be recorded as a due against {{customerName}}. Continue?",

  orderCompletedChange: "Appointment #{{orderNumber}} completed - ${{paid}} collected, ${{change}} change returned.",
  orderCompletedNoChange: "Appointment #{{orderNumber}} completed - ${{paid}} collected.",

  whatsappReceiptSendFailed: "Appointment completed, but WhatsApp PDF receipt could not be sent.",
  orderCancelledSuccessfully: "Appointment {{orderId}} cancelled successfully.",
  declineOnlineOrderConfirm: "Decline/cancel this online appointment?",
  orderMarkedStatus: "Appointment #{{orderId}} marked {{status}}.",
  couldNotUpdateOrder: "Could not update this appointment.",

  assignedRiderNotified: "Assigned to {{name}} - WhatsApp sent.",
  assignedRiderNotNotified: "Assigned to {{name}}, but the WhatsApp message could not be sent.",
  couldNotAssignRider: "Could not assign this rider.",

  changeRequestApproved: "Change request approved - appointment updated.",
  changeRequestDeclined: "Change request declined.",
  couldNotRespondToRequest: "Could not respond to this request.",

  selectAtLeastOneItem: "Select at least one item.",

  addedItemsSyncing: "Added {{count}} item(s) to {{orderId}}. Syncing to the cloud...",
  addedItemsOffline: "Added {{count}} item(s) to {{orderId}}. Will sync once back online.",
  addedItemsPlain: "Added {{count}} item(s) to {{orderId}}.",

  whatsappNeedsInternet: "WhatsApp needs an internet connection - try again once back online.",
  noValidPhoneNumber: "No valid phone number for this patient.",
  customerReceiptLabel: "Patient receipt",
  receiptSentWhatsApp: "Receipt sent via WhatsApp to {{phone}}",
  whatsappSendFailed: "Failed to send WhatsApp message. Is it connected?",
  whatsappSendFailedPrefix: "WhatsApp send failed: ",

  whatsappOrderNo: "Appointment No: *{{number}}*",
  whatsappTotal: "Total: *${{total}}*",
  whatsappThankYou: "Thank you for your appointment!",

  customer: {
    dineInCustomer: "Dine-In Patient",
    walkInCustomer: "Walk-in Patient",
    waiterPrefix: "Waiter: {{name}}",
    noPhone: "No phone",
  },

  minAgo: "{{mins}} min ago",
  hrMinAgo: "{{hr}} hr {{min}} min ago",
  dayAgo: "{{days}} Day ago",
  daysAgo: "{{days}} Days ago",

  tableTypeTitle: "Table {{table}} - {{type}}",
  familyTable: "Family Table",
  simpleTable: "Simple Table",

  tracking: {
    awaitingConfirmation: "Waiting for confirmation",
    confirmed: "Confirmed",
    preparing: "Preparing",
    ready: "Ready",
    completed: "Completed",
    cancelled: "Cancelled",
  },

  orderStatus: {
    pending: "pending",
    completed: "completed",
    paid: "paid",
    cancelled: "cancelled",
  },

  online: {
    orderLabel: "Online Appointment",
    paymentStatusLabel: "Payment: {{status}}",
    markStatus: "Mark {{status}}",
    decline: "Decline",
    deliveryRider: "Delivery Rider",
    assignedTo: "Assigned to {{name}}",
    notAssignedYet: "Not assigned yet.",
    noRidersOnStaff: "No riders on staff",
    chooseRider: "Choose a rider…",
    reassignNotify: "Reassign & Notify",
    assignNotify: "Assign & Notify",
    customerRequestedChange: "Patient Requested a Change",
    approve: "Approve",
  },
  checkupDone: "Checked",
  checkupWaiting: "Waiting",
} as const;
