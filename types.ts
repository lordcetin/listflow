
export enum View {
  LANDING = 'LANDING',
  AUTH = 'AUTH',
  DASHBOARD = 'DASHBOARD'
}

export enum DashboardSection {
  CATEGORIES = 'CATEGORIES',
  ETSY_AUTOMATION = 'ETSY_AUTOMATION',
  PINTEREST_AUTOMATION = 'PINTEREST_AUTOMATION',
  META_AUTOMATION = 'META_AUTOMATION',
  EBAY_AUTOMATION = 'EBAY_AUTOMATION',
  AMAZON_AUTOMATION = 'AMAZON_AUTOMATION',
  ORDERS = 'ORDERS',
  SETTINGS = 'SETTINGS'
}

export interface Variation {
  id: string;
  name: string;
  maliyet: number;
  satisFiyati?: number;
}

export interface SubProduct {
  id: string;
  name: string;
  ornekGorsel: string;
  uretimGorsel: string;
  maliyet: number;
  satisFiyati: number;
  shipping?: number;
  cut?: number;
  margin?: number;
  netProfit?: number;
  catalogDescription?: string;
  catalogYoutubeUrl?: string;
  variations?: Variation[];
}

export interface Category {
  id: string;
  dbId?: string;
  slug?: string;
  name: string;
  subProducts: SubProduct[];
}

export interface Shop {
  id: string;
  name: string;
  category: string;
  subscription: string;
  url?: string;
  isPaid: boolean;
  hasActiveAutomationWebhook?: boolean;
  orderCount: number;
  plan?: string | null;
  subscriptionStatus?: string | null;
  automationIntervalHours?: number | null;
  automationLastRunAt?: string | null;
  lastSuccessfulAutomationAt?: string | null;
  nextAutomationAt?: string | null;
  automationState?: "waiting" | "due" | "processing" | "retrying" | "error";
  canDelete?: boolean;
  deleteBlockedReason?: "active_subscription" | "automation_running" | null;
}

export interface Order {
  id: string;
  productName: string;
  subProductName: string;
  variantName?: string;
  productLink: string;
  category: string;
  date: string;
  address: string;
  isPaid: boolean;
  note?: string;
  ioss?: string;
  labelNumber: string;
  price: number;
  storeId?: string | null;
  paymentStatus?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface AppState {
  currentView: View;
  dashboardSection: DashboardSection;
  isDarkMode: boolean;
  shops: Shop[];
  orders: Order[];
  selectedCategoryId: string | null;
  setView: (view: View) => void;
  setDashboardSection: (section: DashboardSection) => void;
  toggleDarkMode: () => void;
  addShop: (shop: Shop) => void;
  updateShop: (id: string, updates: Partial<Shop>) => void;
  addOrder: (order: Order) => void;
  updateOrder: (id: string, updates: Partial<Order>) => void;
  setSelectedCategory: (id: string | null) => void;
  setShops: (shops: Shop[]) => void;
  setOrders: (orders: Order[]) => void;
}
