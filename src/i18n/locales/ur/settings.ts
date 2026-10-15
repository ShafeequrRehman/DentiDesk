export const settings = {
  pageTitle: "سسٹم کی ترتیبات",
  pageSubtitle: "اپنے ورک اسپیس اور عمومی ترجیحات کو ترتیب دیں۔",
  saveChanges: "تبدیلیاں محفوظ کریں",

  menu: {
    shopProfile: "کلینک پروفائل",
    manageProducts: "اپائنٹمنٹس مینج کریں",
    manageReceipt: "رسید مینج کریں",
    sidebarPages: "سائیڈ بار صفحات",
    customerOrdering: "مریض اپائنٹمنٹ",
    paymentsTax: "ادائیگیاں اور ٹیکس",
    hardwarePos: "ہارڈویئر / POS",
    security: "سیکیورٹی",
    notifications: "اطلاعات",
    backupData: "بیک اپ اور ڈیٹا",
  },

  systemHealth: {
    title: "سسٹم کی صحت",
    allOperational: "تمام سسٹمز درست کام کر رہے ہیں",
  },

  sectionSubtitle: "اپنی {{section}} کی ترتیبات اور معلومات اپ ڈیٹ کریں۔",

  receiptPrintLogo: {
    title: "رسید پرنٹ لوگو",
    quickAccessDescription: "مریض کی رسیدوں پر پرنٹ ہونے والے لوگو تک فوری رسائی۔",
    openPrintSettings: "پرنٹ کی ترتیبات کھولیں",
    hardwareDescription: "وہ لوگو منتخب کریں جو مریض کی رسیدوں کے اوپر پرنٹ ہوتا ہے۔",
  },

  waiterMoved: {
    title: "ویٹر سیٹ اپ منتقل ہو گیا ہے",
    descriptionPart1: "ویٹرز اور اپائنٹمنٹ لینے والے اب یہاں سے شامل کیے جاتے ہیں",
    manageStaff: "اسٹاف مینج کریں",
    descriptionPart2: "وہاں عہدہ کے ساتھ ایک اسٹاف ممبر شامل کریں",
    waiter: "ویٹر",
    or: "یا",
    orderTaker: "اپائنٹمنٹ ٹیکر",
    descriptionPart3: "اور وہ خود بخود POS ویٹر ڈراپ ڈاؤن میں نظر آئیں گے۔",
  },

  fields: {
    shopName: "کلینک کا نام",
    shopNamePlaceholder: "اپنے کلینک کا نام",
    businessEmail: "بزنس ای میل",
    shopAddress: "کلینک کا پتہ",
    shopAddressPlaceholder: "اپنے کلینک کا پتہ",
    businessStartTime: "کاروبار شروع ہونے کا وقت",
    businessEndTime: "کاروبار ختم ہونے کا وقت",
    currency: "کرنسی",
    timezone: "ٹائم زون",
    taxRate: "ٹیکس کی شرح (%)",
  },

  devicePreferences: {
    title: "ڈیوائس ترجیحات",
    dualScreenDisplay: {
      label: "ڈوئل اسکرین ڈسپلے",
      description: "مریض کے لیے چیک آؤٹ اسکرین فعال کریں۔",
    },
    autoPrintReceipts: {
      label: "خودکار رسید پرنٹ",
      description: "ہر ٹرانزیکشن کے بعد رسید پرنٹ کریں۔",
    },
  },

  hardware: {
    devicePrintersTitle: "ڈیوائس پرنٹرز",
    counterPrinter: "کاؤنٹر پرنٹر",
    selectCounterPrinter: "کاؤنٹر پرنٹر منتخب کریں",
  },

  printLogoCard: {
    changeLogo: "لوگو تبدیل کریں",
    selectLogo: "لوگو منتخب کریں",
    remove: "ہٹا دیں",
    previewAlt: "منتخب پرنٹ لوگو کا پیش منظر",
    noLogo: "کوئی لوگو نہیں",
    selectedAsset: "منتخب فائل",
    helpText: "صاف PNG، JPG، WEBP، یا SVG استعمال کریں۔ لوگو اس براؤزر میں محفوظ ہو جاتا ہے اور جب بھی آپ پرنٹ سینٹر کھولیں گے استعمال ہوگا۔",
    noLogoSelected: "کوئی لوگو منتخب نہیں",
    uploadedPrintLogo: "اپ لوڈ شدہ پرنٹ لوگو",
    selectedPrintLogoFallback: "منتخب پرنٹ لوگو",
  },

  toasts: {
    settingsSaved: "ترتیبات محفوظ ہو گئیں۔",
    syncFailed: "ترتیبات محفوظ ہو گئیں، لیکن کلینک کا نام/پتہ سنک نہیں ہو سکا - اپنا کنکشن چیک کریں اور دوبارہ کوشش کریں۔",
  },
} as const;
