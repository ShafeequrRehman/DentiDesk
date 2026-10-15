// DashboardPageClient.tsx - the Dashboard home page shown right after
// login (today's stats/overview). Sidebar nav labels live in sidebar.ts,
// not here.
export const dashboardHome = {
  title: "Dashboard",
  subtitle: "Live business indicators generated from your POS transactions.",
  window: {
    noShift: "No shift yet — open the clinic to start counting appointments",
    openSince: "Open since {{date}} {{time}} · Live",
    closedRange: "{{startDate}} {{startTime}} - {{endDate}} {{endTime}} · Closed",
  },
  salesOverview: "Sales Overview",
  stats: {
    totalRevenue: "Total Revenue",
    totalOrders: "Total Appointments",
  },
  live: "Live",
  storedDatabaseCustomers: "Stored Database Patients",
  activeBusinessDay: "Active Business Day",
  mini: {
    businessDaySales: "Business Day Sales",
    transactions: "Transactions",
    avgOrder: "Avg. Appointment",
  },
  ordersOverview: "Appointments Overview",
  legend: {
    orders: "Appointments",
    estProfit: "Est Profit",
  },
  serviceStats: "Service Stats",
  orderStatusLabel: {
    completed: "Completed",
    pending: "Pending",
    refunded: "Refunded",
    cancelled: "Cancelled",
  },
  completionRate: "Completion Rate",
  done: "Done",
  topEmployeePerformance: "Top Employee Performance",
  salesVolume: "Sales Volume",
  ordAbbrev: "ord",
  lowInventoryAlert: "Low Inventory Alert",
  stock: "Stock",
  left: "Left",
  loadingPlaceholder: "Loading",
} as const;
