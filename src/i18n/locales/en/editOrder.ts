// Edit Order page (editing a pending order's items/details before it's
// sent to the kitchen) - see
// src/pages/dashboard/sales/EditOrderPage.tsx.
export const editOrder = {
  loadingOrderEditor: "Loading appointment editor...",
  offlineUnavailable:
    "This appointment isn't in this till's local cache yet (it's either older than the 14-day offline cache window, or this till hasn't synced since it was placed). Use the appointment card's Add Items / Complete Payment instead, or try again once back online.",
  orderNotFound: "Appointment not found.",

  backToSales: "Back to Sales",
  pageTitle: "Edit Appointment #{{orderNumber}}",
  printCenter: "Print Center",
  saveChanges: "Save Changes",

  orderItems: "Appointment Items",
  orderMeta: "Appointment Meta",

  customerNamePlaceholder: "Patient name",
  phonePlaceholder: "Phone",
  searchingCustomers: "Searching patients...",
  duePrefix: "Due PKR {{amount}}",
  addressPlaceholder: "Address",
  waiterPlaceholder: "Waiter",
  tablePlaceholder: "Table",
  orderNotePlaceholder: "Appointment note",

  quickAddProduct: "Quick Add Drs/Service",
  searchMenuItemsPlaceholder: "Search menu items",
  priceDisplay: "Rs {{price}}",
  addCustomItem: "Add Custom Item",
  customItemDefaultName: "Custom Item",

  couldNotSaveChange: "Could not save this change.",
  orderSavedSyncing: "Appointment {{orderId}} saved. Syncing to the cloud...",
  orderSavedOffline: "Appointment {{orderId}} saved. Will sync once back online.",
  orderSavedSuccessfully: "Appointment {{orderId}} saved successfully.",
} as const;
