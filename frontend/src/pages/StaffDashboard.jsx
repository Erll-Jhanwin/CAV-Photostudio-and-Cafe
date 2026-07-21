import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import {
  ShoppingBag, Package, DollarSign, Search, Plus,
  Minus, RefreshCw, AlertTriangle, Check, X, ShieldAlert, CreditCard, Eye, Pencil,
  PackageCheck, Clock, CalendarOff, Archive, Printer
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { Card, CardHeader } from '../components/ui/Card';
import { StatusBadge } from '../components/ui/Badge';
import { Input, Select } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton, SkeletonTable, SkeletonProfileCard } from '../components/ui/Skeleton';
import { Sidebar } from '../components/ui/Sidebar';
import { MobileHeader } from '../components/ui/MobileHeader';
import { DataTable, PaginationControls, paginateRows, sortRows } from '../components/ui/DataTable';
import { useStyledConfirm } from '../components/ui/StyledAlert';
import { Avatar } from '../components/ui/Avatar';
import { getLocalPrinters, getLocalPrintingSetupMessage, isLocalStaffConsole, openLocalStaffConsole, printLocalReceipt } from '../utils/localPrinting';
import { brandAssets } from '../utils/cavAssets';
import { normalizePayments, normalizeRowsById } from '../utils/uniqueRecords';

function StaffSkeleton() {
  return (
    <div className="min-h-screen bg-cream flex flex-col md:flex-row">
      <aside className="hidden md:flex w-64 bg-espresso flex-col p-5 shrink-0">
        <Skeleton className="h-12 w-full rounded-xl bg-white/10" />
        <div className="flex-1 space-y-2 mt-8">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-11 w-full rounded-xl bg-white/5" />)}
        </div>
        <SkeletonProfileCard />
        <Skeleton className="h-10 w-full rounded-xl bg-white/5 mt-3" />
      </aside>
      <main className="flex-1 p-6 md:p-8">
        <Skeleton className="h-8 w-48 mb-6" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8"><SkeletonTable rows={6} cols={4} /></div>
          <div className="lg:col-span-4"><SkeletonTable rows={4} cols={2} /></div>
        </div>
      </main>
    </div>
  );
}

const inventoryStatuses = [
  { key: 'ALL', label: 'All Items', className: 'bg-white text-espresso border-espresso/10', icon: Package, iconClass: 'text-espresso bg-cream-dark' },
  { key: 'IN_STOCK', label: 'In Stock', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: PackageCheck, iconClass: 'text-emerald-700 bg-emerald-50' },
  { key: 'LOW_STOCK', label: 'Low Stock', className: 'bg-orange-50 text-orange-700 border-orange-200', icon: AlertTriangle, iconClass: 'text-orange-700 bg-orange-50' },
  { key: 'NEAR_EXPIRY', label: 'Near Expiry', className: 'bg-amber-50 text-amber-700 border-amber-200', icon: Clock, iconClass: 'text-amber-700 bg-amber-50' },
  { key: 'EXPIRED', label: 'Expired', className: 'bg-red-50 text-red-700 border-red-200', icon: CalendarOff, iconClass: 'text-red-700 bg-red-50' },
  { key: 'OVERSTOCKED', label: 'Overstocked', className: 'bg-blue-50 text-blue-700 border-blue-200', icon: Archive, iconClass: 'text-blue-700 bg-blue-50' },
];

const getInventoryStatusMeta = (status) => inventoryStatuses.find(item => item.key === status) || inventoryStatuses[0];

const todayValue = () => new Date().toISOString().split('T')[0];
const formatCurrency = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})}`;
const STAFF_CACHE_TTL_MS = 60 * 1000;
const PRODUCT_PAGE_SIZE = 12;
const TABLE_PAGE_SIZE = 10;
const DISCOUNT_OPTIONS = [10, 20, 30];
const RECEIPT_BUSINESS = {
  logoUrl: brandAssets.logo,
  logoText: 'CAV',
  name: 'CAV PHOTO STUDIO & CAFE',
  address: '028B M.P. Casanova St., Purok 1, Tambo, Lipa City, Batangas',
  contactNumber: '+639171234567',
};
const LOCAL_PRINTING_ENABLED_KEY = 'staff:localPrintingEnabled';
const LOCAL_PRINTING_PRINTER_KEY = 'staff:localPrintingPrinter';

const formatReceiptCurrency = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const readStaffCache = (key) => {
  try {
    const cached = JSON.parse(localStorage.getItem(`staff:${key}`) || 'null');
    if (!cached || Date.now() - cached.timestamp > STAFF_CACHE_TTL_MS) return null;
    return cached.data;
  } catch {
    return null;
  }
};

const writeStaffCache = (key, data) => {
  try {
    localStorage.setItem(`staff:${key}`, JSON.stringify({ timestamp: Date.now(), data }));
  } catch {
    /* ignore cache write failures */
  }
};

const emptyProductForm = () => ({
  name: '',
  category: '',
  supplier: '',
  unit: 'ML',
  stock_level: '',
  reorder_point: '',
  maximum_stock_level: '',
  expiration_date: '',
  purchase_date: todayValue(),
  batch_number: '',
  storage_location: '',
});

const getComputedInventoryInfo = (product) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const expiry = product.expiration_date ? new Date(product.expiration_date) : null;
  if (expiry) expiry.setHours(0, 0, 0, 0);
  const daysUntilExpiry = expiry ? Math.round((expiry - today) / 86400000) : null;
  let status = 'IN_STOCK';
  if (expiry && expiry < today) status = 'EXPIRED';
  else if (expiry && daysUntilExpiry <= 7) status = 'NEAR_EXPIRY';
  else if (Number(product.stock_level || 0) <= Number(product.reorder_point || 0)) status = 'LOW_STOCK';
  else if (Number(product.maximum_stock_level || 0) && Number(product.stock_level || 0) > Number(product.maximum_stock_level || 0)) status = 'OVERSTOCKED';

  const labels = {
    IN_STOCK: 'In Stock (Good Condition)',
    LOW_STOCK: 'Low Stock',
    NEAR_EXPIRY: 'Near Expiry',
    EXPIRED: 'Expired',
    OVERSTOCKED: 'Overstocked',
  };
  const actions = {
    IN_STOCK: 'Maintain Stock',
    LOW_STOCK: 'Reorder',
    NEAR_EXPIRY: 'Prioritize Usage',
    EXPIRED: 'Remove from Sale',
    OVERSTOCKED: 'Reduce Purchasing',
  };
  return {
    inventory_status: status,
    inventory_status_label: labels[status],
    suggested_action: actions[status],
    days_until_expiry: daysUntilExpiry,
  };
};

const getProductAvailable = (product) => {
  if (!product.recipe_items?.length) {
    return Number(product.stock_level || 0);
  }
  const servings = product.recipe_items
    .filter(item => Number(item.quantity) > 0)
    .map(item => Math.floor(Number(item.ingredient_details?.stock_quantity || 0) / Number(item.quantity)));
  return servings.length ? Math.min(...servings) : 0;
};

const updateProductRecipeStock = (product, quantitySold) => {
  if (!product.recipe_items?.length) {
    return { ...product, stock_level: Math.max(Number(product.stock_level || 0) - quantitySold, 0) };
  }
  const recipeItems = product.recipe_items.map(item => {
    const usedQuantity = Number(item.quantity || 0) * quantitySold;
    const ingredientDetails = item.ingredient_details
      ? {
          ...item.ingredient_details,
          stock_quantity: Math.max(Number(item.ingredient_details.stock_quantity || 0) - usedQuantity, 0),
        }
      : item.ingredient_details;
    return { ...item, ingredient_details: ingredientDetails };
  });
  const updatedProduct = { ...product, recipe_items: recipeItems };
  return { ...updatedProduct, available_servings: getProductAvailable(updatedProduct) };
};

export default function StaffDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const confirm = useStyledConfirm();
  const [activeTab, setActiveTab] = useState('pos');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const [products, setProducts] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [bookingPayments, setBookingPayments] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingResources, setLoadingResources] = useState({});
  const [loadedTabs, setLoadedTabs] = useState({});
  const [error, setError] = useState('');

  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [transactionId, setTransactionId] = useState('');
  const [amountReceived, setAmountReceived] = useState('');
  const [discountValue, setDiscountValue] = useState('');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showCheckoutLoading, setShowCheckoutLoading] = useState(false);
  const [receiptOrder, setReceiptOrder] = useState(null);
  const [receiptPrintError, setReceiptPrintError] = useState('');
  const [receiptPrintFallbackOrder, setReceiptPrintFallbackOrder] = useState(null);
  const [localPrintingEnabled, setLocalPrintingEnabled] = useState(() => localStorage.getItem(LOCAL_PRINTING_ENABLED_KEY) === 'true');
  const [localPrinters, setLocalPrinters] = useState([]);
  const [selectedLocalPrinter, setSelectedLocalPrinter] = useState(() => localStorage.getItem(LOCAL_PRINTING_PRINTER_KEY) || '');
  const [localPrintStatus, setLocalPrintStatus] = useState('');
  const [localPrinterLoading, setLocalPrinterLoading] = useState(false);
  const checkoutInFlightRef = useRef(false);

  const [posSearch, setPosSearch] = useState('');
  const [invSearch, setInvSearch] = useState('');
  const [manualAdjIngredient, setManualAdjIngredient] = useState(null);
  const [editingIngredient, setEditingIngredient] = useState(null);
  const [editIngredientForm, setEditIngredientForm] = useState(emptyProductForm());
  const [editIngredientSaving, setEditIngredientSaving] = useState(false);
  const [adjustingStock, setAdjustingStock] = useState(false);
  const [adjQty, setAdjQty] = useState(0);
  const [adjUnit, setAdjUnit] = useState('ML');
  const [adjMovementType, setAdjMovementType] = useState('IN');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState('PENDING_VERIFICATION');
  const [verifyingPaymentId, setVerifyingPaymentId] = useState(null);
  const [inventoryFilter, setInventoryFilter] = useState('ALL');
  const [salesPaymentFilter, setSalesPaymentFilter] = useState('ALL');
  const [salesStartDate, setSalesStartDate] = useState('');
  const [salesEndDate, setSalesEndDate] = useState('');
  const [productPage, setProductPage] = useState(1);
  const [paymentPage, setPaymentPage] = useState(1);
  const [inventoryPage, setInventoryPage] = useState(1);
  const [salesPage, setSalesPage] = useState(1);
  const [inventorySort, setInventorySort] = useState({ key: 'name', dir: 'asc' });
  const [salesSort, setSalesSort] = useState({ key: 'created_at', dir: 'desc' });
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [productForm, setProductForm] = useState(emptyProductForm());
  const [productSaving, setProductSaving] = useState(false);
  const [productErrors, setProductErrors] = useState({});
  const [editIngredientErrors, setEditIngredientErrors] = useState({});
  const tabLoadInFlightRef = useRef(new Set());

  const loadStaticInventoryOptions = useCallback(async (force = false) => {
    const cachedCategories = !force ? readStaffCache('categories') : null;
    const cachedSuppliers = !force ? readStaffCache('suppliers') : null;
    if (cachedCategories) setCategories(normalizeRowsById(cachedCategories, row => row?.name));
    if (cachedSuppliers) setSuppliers(normalizeRowsById(cachedSuppliers, row => row?.name));
    if (cachedCategories && cachedSuppliers && !force) return;

    const [categoriesRes, suppliersRes] = await Promise.all([
      client.get('/api/inventory/categories/'),
      client.get('/api/inventory/suppliers/')
    ]);
    const uniqueCategories = normalizeRowsById(categoriesRes.data, row => row?.name);
    const uniqueSuppliers = normalizeRowsById(suppliersRes.data, row => row?.name);
    setCategories(uniqueCategories);
    setSuppliers(uniqueSuppliers);
    writeStaffCache('categories', uniqueCategories);
    writeStaffCache('suppliers', uniqueSuppliers);
  }, []);

  const refreshProducts = useCallback(async () => {
    const productsRes = await client.get('/api/inventory/products/', { params: { limit: 240 } });
    const uniqueProducts = normalizeRowsById(productsRes.data, row => row?.name);
    setProducts(uniqueProducts);
    writeStaffCache('products', uniqueProducts);
  }, []);

  const ensureDefaultRecipesOnce = useCallback(async () => {
    if (sessionStorage.getItem('staff:recipesChecked')) return;
    sessionStorage.setItem('staff:recipesChecked', 'true');
    try {
      const res = await client.post('/api/inventory/recipes/generate/');
      if (Number(res.data?.created_recipe_items || 0) > 0) {
        refreshProducts();
      }
    } catch {
      /* default recipe generation is non-critical for first paint */
    }
  }, [refreshProducts]);

  const loadTabData = useCallback(async (tab = activeTab, force = false) => {
    if (!force && (loadedTabs[tab] || tabLoadInFlightRef.current.has(tab))) return;
    tabLoadInFlightRef.current.add(tab);
    try {
      setError('');
      setLoadingResources(current => ({ ...current, [tab]: true }));

      if (tab === 'pos') {
        const cachedProducts = !force ? readStaffCache('products') : null;
        if (cachedProducts?.length) {
          setProducts(normalizeRowsById(cachedProducts, row => row?.name));
          setLoading(false);
        }
        const productsRes = await client.get('/api/inventory/products/', { params: { limit: 240 } });
        const uniqueProducts = normalizeRowsById(productsRes.data, row => row?.name);
        setProducts(uniqueProducts);
        writeStaffCache('products', uniqueProducts);
        ensureDefaultRecipesOnce();
      } else if (tab === 'payments') {
        const paymentsRes = await client.get('/api/bookings/payments/', { params: { limit: 100 } });
        setBookingPayments(normalizePayments(paymentsRes.data));
      } else if (tab === 'inventory') {
        await loadStaticInventoryOptions(force);
        const ingredientsRes = await client.get('/api/inventory/ingredients/', { params: { limit: 300 } });
        setIngredients(normalizeRowsById(ingredientsRes.data, row => row?.name));
      } else if (tab === 'sales') {
        const ordersRes = await client.get('/api/pos/orders/', { params: { limit: 100 } });
        setOrders(normalizeRowsById(ordersRes.data, row => row?.transaction_id || row?.created_at));
      }

      setLoadedTabs(current => ({ ...current, [tab]: true }));
    } catch {
      setError('Failed to load dashboard data. Make sure the server is running.');
    } finally {
      tabLoadInFlightRef.current.delete(tab);
      setLoadingResources(current => ({ ...current, [tab]: false }));
      setLoading(false);
    }
  }, [activeTab, loadedTabs, ensureDefaultRecipesOnce, loadStaticInventoryOptions]);

  useEffect(() => {
    if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
      navigate('/login');
      return;
    }
    loadTabData(activeTab);
  }, [user, navigate, activeTab, loadTabData]);

  useEffect(() => { setProductPage(1); }, [posSearch]);
  useEffect(() => { setPaymentPage(1); }, [paymentStatusFilter]);
  useEffect(() => { setInventoryPage(1); }, [invSearch, inventoryFilter]);
  useEffect(() => { setSalesPage(1); }, [salesPaymentFilter, salesStartDate, salesEndDate]);

  useEffect(() => {
    localStorage.setItem(LOCAL_PRINTING_ENABLED_KEY, String(localPrintingEnabled));
  }, [localPrintingEnabled]);

  useEffect(() => {
    if (selectedLocalPrinter) localStorage.setItem(LOCAL_PRINTING_PRINTER_KEY, selectedLocalPrinter);
    else localStorage.removeItem(LOCAL_PRINTING_PRINTER_KEY);
  }, [selectedLocalPrinter]);

  const addToCart = (product) => {
    const availableServings = getProductAvailable(product);
    const existing = cart.find(item => item.id === product.id);
    if (existing) {
      if (existing.quantity >= availableServings && product.is_cafe_item) { alert('Insufficient ingredients for this drink.'); return; }
      setCart(cart.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
    } else {
      if (availableServings <= 0 && product.is_cafe_item) { alert('Out of stock.'); return; }
      setCart([...cart, { ...product, quantity: 1 }]);
    }
  };

  const updateCartQty = (id, delta) => {
    const item = cart.find(i => i.id === id);
    if (!item) return;
    if (item.quantity + delta <= 0) {
      setCart(cart.filter(i => i.id !== id));
    } else {
      const prod = products.find(p => p.id === id);
      if (delta > 0 && item.quantity >= getProductAvailable(prod || {}) && prod?.is_cafe_item) { alert('Insufficient ingredients for this drink.'); return; }
      setCart(cart.map(i => i.id === id ? { ...i, quantity: i.quantity + delta } : i));
    }
  };

  const getCartSubtotal = () => cart.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);
  const getCartDiscountAmount = () => {
    const subtotal = getCartSubtotal();
    const value = Number(discountValue || 0);
    if (!Number.isFinite(value) || value <= 0) return 0;
    return Math.min(subtotal * Math.min(value, 100) / 100, subtotal);
  };
  const getCartTotal = () => Math.max(getCartSubtotal() - getCartDiscountAmount(), 0);
  const getReceiptPayment = (order) => order?.payments?.[0] || null;
  const getReceiptAmountReceived = (order) => Number(getReceiptPayment(order)?.amount || order?.amount_received || order?.total || 0);
  const getReceiptChange = (order) => Number(order?.change_amount ?? Math.max(getReceiptAmountReceived(order) - Number(order?.total || 0), 0));
  const getReceiptSubtotal = (order) => Number(order?.subtotal || order?.total || 0);
  const getReceiptDiscounts = (order) => Number(order?.discounts ?? order?.discount_amount ?? 0);
  const getReceiptOrNumber = (order) => order?.or_number || order?.id || '';
  const getReceiptTransactionNumber = (order) => (
    order?.transaction_id
    || order?.transaction_number
    || getReceiptPayment(order)?.transaction_id
    || (order?.id ? `POS-${order.id}` : '')
  );
  const getReceiptDateTime = (order) => {
    if (order?.created_at_display) return order.created_at_display;
    if (order?.completed_at) return new Date(order.completed_at).toLocaleString();
    return order?.created_at ? new Date(order.created_at).toLocaleString() : '';
  };
  const getReceiptBusiness = (order) => ({
    logoUrl: order?.business_logo_url || RECEIPT_BUSINESS.logoUrl,
    logoText: order?.business_logo_text || RECEIPT_BUSINESS.logoText,
    name: order?.business_name || RECEIPT_BUSINESS.name,
    address: order?.business_address || RECEIPT_BUSINESS.address,
    contactNumber: order?.business_contact_number || RECEIPT_BUSINESS.contactNumber,
  });

  const refreshLocalPrinters = useCallback(async ({ silent = false, openConsoleOnFailure = false } = {}) => {
    try {
      setLocalPrinterLoading(true);
      const printers = await getLocalPrinters();
      setLocalPrinters(printers);
      const defaultPrinter = printers.find(printer => printer.default) || printers[0];
      if (defaultPrinter && (!selectedLocalPrinter || !printers.some(printer => printer.name === selectedLocalPrinter))) {
        setSelectedLocalPrinter(defaultPrinter.name);
      }
      if (!silent) {
        setLocalPrintStatus(printers.length
          ? `${printers.length} local printer${printers.length === 1 ? '' : 's'} detected. ${defaultPrinter?.name ? `Using ${defaultPrinter.name}.` : ''}`
          : 'Local print bridge is running, but no printers were found.');
      }
      return printers;
    } catch (err) {
      if (!silent) {
        setLocalPrintStatus(getLocalPrintingSetupMessage());
      }
      if (openConsoleOnFailure && !isLocalStaffConsole()) {
        openLocalStaffConsole();
      }
      setLocalPrinters([]);
      return [];
    } finally {
      setLocalPrinterLoading(false);
    }
  }, [selectedLocalPrinter]);

  const handleDetectLocalPrinters = useCallback(async () => {
    setLocalPrintingEnabled(true);
    const printers = await refreshLocalPrinters({ openConsoleOnFailure: true });
    if (!printers.length && !isLocalStaffConsole()) {
      setLocalPrintStatus('Opening the local staff console. Sign in there, keep that window open, then Detect will use the cashier PC printers automatically.');
    }
  }, [refreshLocalPrinters]);

  useEffect(() => {
    if (localPrintingEnabled) {
      refreshLocalPrinters({ silent: true });
    }
  }, [localPrintingEnabled, refreshLocalPrinters]);

  const getReceiptFallbackMessage = (printStatus) => {
    const error = printStatus?.error || '';
    if (/No printer command|no receipt printer is available|no default or available printer/i.test(error)) {
      return 'Payment saved. This server cannot access a receipt printer. Open the receipt preview and print from the browser, or run the backend on the cashier PC with a default 58mm printer installed.';
    }
    return error || 'Payment saved, but the receipt could not be printed. Open the receipt preview and print from the browser.';
  };

  const handleBrowserPrintReceipt = () => {
    window.setTimeout(() => window.print(), 150);
  };

  const handleLocalPrintOrder = async (order) => {
    if (!localPrintingEnabled) {
      setLocalPrintStatus('Local Printing Mode is off. Transaction saved without printing.');
      return;
    }

    const printers = localPrinters.length ? localPrinters : await refreshLocalPrinters({ silent: true });
    if (!printers.length) {
      setLocalPrintStatus('No local receipt printer detected. Transaction saved without printing.');
      setReceiptPrintFallbackOrder(order);
      return;
    }

    const printer = printers.find(item => item.name === selectedLocalPrinter) || printers.find(item => item.default) || printers[0];
    try {
      const result = await printLocalReceipt({
        order,
        business: getReceiptBusiness(order),
        user,
        printerName: printer?.name || '',
      });
      setLocalPrintStatus(`Receipt printed locally${result.printer ? ` on ${result.printer}` : ''}.`);
    } catch (err) {
      setLocalPrintStatus(`Local print failed: ${err.message}`);
      setReceiptPrintError(`Payment saved. Local printing failed: ${err.message}`);
      setReceiptPrintFallbackOrder(order);
    }
  };

  const handleCheckout = async () => {
    if (cart.length === 0 || checkoutInFlightRef.current) return;
    const total = getCartTotal();
    const cashReceived = paymentMethod === 'CASH' ? Number(amountReceived) : total;
    const discountNumber = Number(discountValue || 0);

    if (paymentMethod === 'CASH' && (!amountReceived || cashReceived < total)) {
      alert('Amount received must be equal to or greater than the total.');
      return;
    }
    if (!Number.isFinite(discountNumber) || ![0, ...DISCOUNT_OPTIONS].includes(discountNumber)) {
      alert('Select a valid discount.');
      return;
    }

    const confirmed = await confirm({
      title: 'Complete Sale',
      message: `Complete this ${paymentMethod} sale for ${formatReceiptCurrency(total)}?`,
      confirmLabel: 'Complete Sale',
      type: 'success',
    });
    if (!confirmed) return;

    let loadingTimer;
    try {
      checkoutInFlightRef.current = true;
      setCheckoutLoading(true);
      setReceiptPrintError('');
      setReceiptPrintFallbackOrder(null);
      loadingTimer = setTimeout(() => setShowCheckoutLoading(true), 450);
      const payload = {
        items: cart.map(item => ({ product_id: item.id, quantity: item.quantity })),
        order_type: 'WALK_IN',
        print_receipt: false,
        discount: { type: 'PERCENT', value: discountNumber },
        payment: { amount: cashReceived, method: paymentMethod, transaction_id: transactionId }
      };
      const res = await client.post('/api/pos/orders/', payload);
      const savedOrder = {
        ...res.data,
        amount_received: res.data.amount_received || cashReceived,
        change_amount: res.data.change_amount || Math.max(cashReceived - total, 0),
      };
      if (!res.data.receipt_print?.printed) {
        const printError = res.data.receipt_print?.error || '';
        if (printError && !/skipped/i.test(printError)) {
          setReceiptPrintError(getReceiptFallbackMessage(res.data.receipt_print));
          setReceiptPrintFallbackOrder(savedOrder);
        }
      }
      await handleLocalPrintOrder(savedOrder);
      setOrders(current => normalizeRowsById([savedOrder, ...current], row => row?.transaction_id || row?.created_at));
      setProducts(current => normalizeRowsById(current.map(product => {
        const cartItem = cart.find(item => item.id === product.id);
        if (!cartItem) return product;
        return updateProductRecipeStock(product, cartItem.quantity);
      }), row => row?.name));
      setIngredients(current => normalizeRowsById(current.map(ingredient => {
        const usedQuantity = cart.reduce((total, cartItem) => {
          const recipeItem = cartItem.recipe_items?.find(item => item.ingredient === ingredient.id);
          return total + (recipeItem ? Number(recipeItem.quantity || 0) * cartItem.quantity : 0);
        }, 0);
        if (!usedQuantity) return ingredient;
        const updatedIngredient = {
          ...ingredient,
          stock_quantity: Math.max(Number(ingredient.stock_quantity || 0) - usedQuantity, 0),
        };
        return { ...updatedIngredient, ...getComputedInventoryInfo({
          ...updatedIngredient,
          stock_level: updatedIngredient.stock_quantity,
          reorder_point: updatedIngredient.minimum_stock_level,
        }) };
      }), row => row?.name));
      setCart([]);
      setTransactionId('');
      setAmountReceived('');
      setDiscountValue('');
      alert('Sale completed successfully.');
    } catch (err) {
      alert(err.response?.data?.detail || 'Checkout failed.');
    } finally {
      checkoutInFlightRef.current = false;
      clearTimeout(loadingTimer);
      setCheckoutLoading(false);
      setShowCheckoutLoading(false);
    }
  };

  const handleVerifyBookingPayment = async (payment, newStatus) => {
    const action = newStatus === 'APPROVED' ? 'approve' : 'reject';
    if (verifyingPaymentId === payment.id) return;
    const confirmed = await confirm({
      title: `${newStatus === 'APPROVED' ? 'Approve' : 'Reject'} Payment`,
      message: `Are you sure you want to ${action} payment ${payment.reference_number}?`,
      confirmLabel: newStatus === 'APPROVED' ? 'Approve Payment' : 'Reject Payment',
      type: newStatus === 'APPROVED' ? 'success' : 'error',
    });
    if (!confirmed) return;
    try {
      setVerifyingPaymentId(payment.id);
      const res = await client.patch(`/api/bookings/payments/${payment.id}/verify/`, { status: newStatus });
      setBookingPayments(current => normalizePayments(current.map(item => item.id === payment.id ? res.data : item)));
      alert(`Payment ${newStatus === 'APPROVED' ? 'approved' : 'rejected'} successfully.`);
    } catch (err) {
      alert(err.response?.data?.detail || err.response?.data?.status || 'Failed to verify payment.');
    } finally {
      setVerifyingPaymentId(null);
    }
  };

  const handleAdjustInventory = async () => {
    if (!manualAdjIngredient || adjustingStock) return;
    const quantity = Number(adjQty || 0);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      alert('Enter a valid stock adjustment quantity.');
      return;
    }
    const isAdding = adjMovementType === 'IN';
    const confirmed = await confirm({
      title: isAdding ? 'Add Stock' : 'Remove Stock',
      message: `${isAdding ? 'Add' : 'Remove'} ${quantity} ${adjUnit} ${isAdding ? 'to' : 'from'} ${manualAdjIngredient.name}?`,
      confirmLabel: isAdding ? 'Add Stock' : 'Remove Stock',
      type: isAdding ? 'success' : 'warning',
    });
    if (!confirmed) return;
    try {
      setAdjustingStock(true);
      await client.post('/api/inventory/ingredient-movements/', {
        ingredient: manualAdjIngredient.id,
        movement_type: adjMovementType,
        quantity: adjQty,
        unit: adjUnit,
        reason: 'Manual ingredient adjustment',
      });
      const unitMultiplier = adjUnit === 'KG' || adjUnit === 'L' ? 1000 : 1;
      const baseQuantity = Number(adjQty || 0) * unitMultiplier;
      setIngredients(current => normalizeRowsById(current.map(ingredient => {
        if (ingredient.id !== manualAdjIngredient.id) return ingredient;
        const nextQuantity = adjMovementType === 'IN'
          ? Number(ingredient.stock_quantity || 0) + baseQuantity
          : Math.max(Number(ingredient.stock_quantity || 0) - baseQuantity, 0);
        const updatedIngredient = { ...ingredient, stock_quantity: nextQuantity };
        return { ...updatedIngredient, ...getComputedInventoryInfo({
          ...updatedIngredient,
          stock_level: updatedIngredient.stock_quantity,
          reorder_point: updatedIngredient.minimum_stock_level,
        }) };
      }), row => row?.name));
      setProducts(current => normalizeRowsById(current.map(product => {
        const recipeItems = product.recipe_items?.map(item => {
          if (item.ingredient !== manualAdjIngredient.id || !item.ingredient_details) return item;
          const nextQuantity = adjMovementType === 'IN'
            ? Number(item.ingredient_details.stock_quantity || 0) + baseQuantity
            : Math.max(Number(item.ingredient_details.stock_quantity || 0) - baseQuantity, 0);
          return {
            ...item,
            ingredient_details: { ...item.ingredient_details, stock_quantity: nextQuantity },
          };
        });
        const updatedProduct = { ...product, recipe_items: recipeItems };
        return { ...updatedProduct, available_servings: getProductAvailable(updatedProduct) };
      }), row => row?.name));
      setManualAdjIngredient(null);
      alert(isAdding ? 'Stock added successfully.' : 'Stock adjusted successfully.');
    } catch {
      alert('Adjustment failed.');
    } finally {
      setAdjustingStock(false);
    }
  };

  const handleProductFieldChange = (field, value) => {
    setProductForm(current => ({ ...current, [field]: value }));
    setProductErrors(current => ({ ...current, [field]: '' }));
  };

  const validateIngredientForm = (form) => {
    const errors = {};
    const requiredFields = [
      ['name', 'Ingredient name'],
      ['batch_number', 'Batch number'],
      ['category', 'Category'],
      ['supplier', 'Supplier'],
      ['unit', 'Base unit'],
      ['stock_level', 'Quantity'],
      ['reorder_point', 'Minimum stock level'],
      ['maximum_stock_level', 'Maximum stock level'],
      ['purchase_date', 'Purchase date'],
      ['storage_location', 'Storage location'],
    ];

    requiredFields.forEach(([field, label]) => {
      if (!String(form[field] ?? '').trim()) errors[field] = `${label} is required.`;
    });

    ['stock_level', 'reorder_point', 'maximum_stock_level'].forEach(field => {
      const value = Number(form[field]);
      if (String(form[field] ?? '').trim() && (!Number.isFinite(value) || value < 0)) {
        errors[field] = 'Enter a valid non-negative number.';
      }
    });

    const minStock = Number(form.reorder_point);
    const maxStock = Number(form.maximum_stock_level);
    if (Number.isFinite(minStock) && Number.isFinite(maxStock) && maxStock < minStock) {
      errors.maximum_stock_level = 'Maximum stock level must be greater than or equal to minimum stock level.';
    }

    if (form.expiration_date && form.purchase_date && new Date(form.expiration_date) < new Date(form.purchase_date)) {
      errors.expiration_date = 'Expiration date cannot be before purchase date.';
    }

    return errors;
  };

  const productFormValid = !Object.keys(validateIngredientForm(productForm)).length;
  const editIngredientFormValid = !Object.keys(validateIngredientForm(editIngredientForm)).length;

  const ingredientToForm = (ingredient) => ({
    name: ingredient?.name || '',
    category: ingredient?.category || '',
    supplier: ingredient?.supplier || '',
    unit: ingredient?.base_unit || 'ML',
    stock_level: ingredient?.stock_quantity ?? '',
    reorder_point: ingredient?.minimum_stock_level ?? '',
    maximum_stock_level: ingredient?.maximum_stock_level ?? '',
    expiration_date: ingredient?.expiration_date || '',
    purchase_date: ingredient?.purchase_date || todayValue(),
    batch_number: ingredient?.batch_number || '',
    storage_location: ingredient?.storage_location || '',
  });

  const openEditIngredientModal = (ingredient) => {
    setEditingIngredient(ingredient);
    setEditIngredientForm(ingredientToForm(ingredient));
    setEditIngredientErrors({});
  };

  const handleEditIngredientFieldChange = (field, value) => {
    setEditIngredientForm(current => ({ ...current, [field]: value }));
    setEditIngredientErrors(current => ({ ...current, [field]: '' }));
  };

  const handleUpdateIngredient = async (e) => {
    e.preventDefault();
    if (!editingIngredient || editIngredientSaving) return;
    const errors = validateIngredientForm(editIngredientForm);
    setEditIngredientErrors(errors);
    if (Object.keys(errors).length) return;
    const confirmed = await confirm({
      title: 'Update Stock Record',
      message: `Save changes to ${editingIngredient.name}?`,
      confirmLabel: 'Update Record',
      type: 'warning',
    });
    if (!confirmed) return;
    try {
      setEditIngredientSaving(true);
      const payload = {
        name: editIngredientForm.name,
        category: Number(editIngredientForm.category),
        supplier: Number(editIngredientForm.supplier),
        base_unit: editIngredientForm.unit,
        stock_quantity: Number(editIngredientForm.stock_level),
        minimum_stock_level: Number(editIngredientForm.reorder_point),
        maximum_stock_level: Number(editIngredientForm.maximum_stock_level),
        expiration_date: editIngredientForm.expiration_date || null,
        purchase_date: editIngredientForm.purchase_date,
        batch_number: editIngredientForm.batch_number,
        storage_location: editIngredientForm.storage_location,
      };
      const res = await client.patch(`/api/inventory/ingredients/${editingIngredient.id}/`, payload);
      setIngredients(current => normalizeRowsById(current.map(ingredient => ingredient.id === res.data.id ? res.data : ingredient), row => row?.name));
      setProducts(current => normalizeRowsById(current.map(product => {
        const recipeItems = product.recipe_items?.map(item => (
          item.ingredient === res.data.id
            ? { ...item, ingredient_details: res.data, base_unit: res.data.base_unit, ingredient_name: res.data.name }
            : item
        ));
        const updatedProduct = { ...product, recipe_items: recipeItems };
        return { ...updatedProduct, available_servings: getProductAvailable(updatedProduct) };
      }), row => row?.name));
      setEditingIngredient(null);
      setEditIngredientForm(emptyProductForm());
      setEditIngredientErrors({});
      alert('Record updated successfully.');
    } catch (err) {
      const data = err.response?.data;
      const message = data && typeof data === 'object'
        ? Object.entries(data).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\n')
        : 'Failed to update ingredient.';
      alert(message);
    } finally {
      setEditIngredientSaving(false);
    }
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    if (productSaving) return;
    const errors = validateIngredientForm(productForm);
    setProductErrors(errors);
    if (Object.keys(errors).length) return;
    const confirmed = await confirm({
      title: 'Add Stock Item',
      message: `Add ${productForm.name || 'this stock item'} to inventory?`,
      confirmLabel: 'Add Stock',
      type: 'success',
    });
    if (!confirmed) return;
    try {
      setProductSaving(true);
      const payload = {
        name: productForm.name,
        category: Number(productForm.category),
        supplier: Number(productForm.supplier),
        base_unit: productForm.unit,
        stock_quantity: Number(productForm.stock_level),
        minimum_stock_level: Number(productForm.reorder_point),
        maximum_stock_level: Number(productForm.maximum_stock_level),
        expiration_date: productForm.expiration_date || null,
        purchase_date: productForm.purchase_date,
        batch_number: productForm.batch_number,
        storage_location: productForm.storage_location,
      };
      const res = await client.post('/api/inventory/ingredients/', payload);
      setIngredients(current => normalizeRowsById([res.data, ...current], row => row?.name));
      setProductForm(emptyProductForm());
      setProductErrors({});
      setProductModalOpen(false);
      alert('Stock added successfully.');
    } catch (err) {
      const data = err.response?.data;
      const message = data && typeof data === 'object'
        ? Object.entries(data).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\n')
        : 'Failed to create stock item.';
      alert(message);
    } finally {
      setProductSaving(false);
    }
  };

  const handleLogout = useCallback(() => {
    alert('Signed out successfully.');
    logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  if (loading) return <StaffSkeleton />;

  const navItems = [
    { key: 'pos', label: 'POS Terminal', icon: ShoppingBag, active: activeTab === 'pos', onClick: () => setActiveTab('pos') },
    { key: 'payments', label: 'Payment Booking Verification', icon: CreditCard, active: activeTab === 'payments', onClick: () => setActiveTab('payments') },
    { key: 'inventory', label: 'Live Inventory', icon: Package, active: activeTab === 'inventory', onClick: () => setActiveTab('inventory') },
    { key: 'sales', label: 'Daily Sales Logs', icon: DollarSign, active: activeTab === 'sales', onClick: () => setActiveTab('sales') },
  ];

  const pageTitles = { pos: 'POS Terminal', payments: 'Payment Booking Verification', inventory: 'Live Inventory', sales: 'Daily Sales Logs' };
  const isCurrentTabLoading = !!loadingResources[activeTab];
  const toggleSort = (current, setter, key, column = {}) => {
    setter(current.key === key
      ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc', accessor: column.sortAccessor }
      : { key, dir: 'asc', accessor: column.sortAccessor });
  };
  const filteredProducts = products.filter(product => product.name.toLowerCase().includes(posSearch.toLowerCase()));
  const pagedProducts = paginateRows(filteredProducts, productPage, PRODUCT_PAGE_SIZE);
  const visibleInventory = ingredients.filter(ingredient => {
    const matchesSearch = ingredient.name.toLowerCase().includes(invSearch.toLowerCase());
    const matchesStatus = inventoryFilter === 'ALL' || ingredient.inventory_status === inventoryFilter;
    return matchesSearch && matchesStatus;
  });
  const sortedInventory = sortRows(visibleInventory, inventorySort);
  const pagedInventory = paginateRows(sortedInventory, inventoryPage, TABLE_PAGE_SIZE);
  const inventoryCounts = inventoryStatuses.reduce((counts, status) => {
    if (status.key === 'ALL') {
      counts.ALL = ingredients.length;
    } else {
      counts[status.key] = ingredients.filter(ingredient => ingredient.inventory_status === status.key).length;
    }
    return counts;
  }, {});
  const salesStart = salesStartDate ? new Date(`${salesStartDate}T00:00:00`) : null;
  const salesEnd = salesEndDate ? new Date(`${salesEndDate}T23:59:59.999`) : null;
  const filteredOrders = orders.filter(order => {
    const createdAt = new Date(order.completed_at || order.created_at);
    const isCompletedSale = order.payment_status === 'PAID';
    const matchesPayment = salesPaymentFilter === 'ALL' || order.payments?.some(payment => payment.method === salesPaymentFilter);
    const matchesStart = !salesStart || createdAt >= salesStart;
    const matchesEnd = !salesEnd || createdAt <= salesEnd;
    return isCompletedSale && matchesPayment && matchesStart && matchesEnd;
  });
  const sortedOrders = sortRows(filteredOrders, salesSort);
  const pagedOrders = paginateRows(sortedOrders, salesPage, TABLE_PAGE_SIZE);
  const filteredBookingPayments = bookingPayments.filter(payment => (
    paymentStatusFilter === 'ALL' || payment.status === paymentStatusFilter
  ));
  const pagedBookingPayments = paginateRows(filteredBookingPayments, paymentPage, TABLE_PAGE_SIZE);

  return (
    <div className="min-h-screen bg-cream flex flex-col md:flex-row">
      <Sidebar
        brand="CAV Terminal"
        brandSubtitle="Staff Console"
        brandIcon={ShoppingBag}
        navItems={navItems}
        user={user}
        onLogout={() => setSignOutOpen(true)}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
        signOutOpen={signOutOpen}
        onSignOutCancel={() => setSignOutOpen(false)}
        onSignOutConfirm={handleLogout}
      />

      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <MobileHeader title={pageTitles[activeTab]} onMenuToggle={() => setSidebarOpen(true)} user={user} />

        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto scrollbar-thin">
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-800 p-5 rounded-2xl mb-6 flex items-start gap-3 shadow-sm">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-bold text-sm">Connection Error</h4>
                <p className="text-xs text-red-600/80 mt-1">{error}</p>
              </div>
              <Button variant="outline" size="sm" icon={RefreshCw} onClick={() => loadTabData(activeTab, true)}>Reconnect Dashboard</Button>
            </div>
          )}

          {receiptPrintError && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl mb-6 flex flex-col gap-3 shadow-sm sm:flex-row sm:items-start">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-bold text-sm">Receipt Not Printed</h4>
                <p className="text-xs text-amber-700/90 mt-1">{receiptPrintError}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {receiptPrintFallbackOrder && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    icon={Printer}
                    onClick={() => setReceiptOrder(receiptPrintFallbackOrder)}
                    className="border-amber-300 bg-white text-amber-900 hover:bg-amber-100"
                  >
                    Open Receipt
                  </Button>
                )}
                <button type="button" onClick={() => setReceiptPrintError('')} className="rounded-lg p-1 text-amber-700/70 hover:bg-amber-100 hover:text-amber-900" aria-label="Dismiss receipt warning">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {isCurrentTabLoading && !loading && (
            <div className="mb-4 rounded-2xl border border-gold/20 bg-gold/10 px-4 py-2 text-xs font-bold text-espresso">
              Refreshing {pageTitles[activeTab]}...
            </div>
          )}

          {/* POS */}
          {activeTab === 'pos' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-in-up" key="pos">
              <div className="lg:col-span-8 space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                  <div>
                    <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">POS Terminal</h1>
                    <p className="text-xs text-espresso/50 mt-1">Build customer orders for walk-ins or cafe purchases.</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-espresso/[0.06] bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 items-start gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${localPrintingEnabled ? 'bg-emerald-50 text-emerald-700' : 'bg-cream text-espresso/55'}`}>
                        <Printer className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-black text-espresso">Local Printing Mode</p>
                        <p className="mt-1 text-xs leading-relaxed text-espresso/55">
                          Saves transactions online, then prints only from this cashier computer through the local print bridge.
                        </p>
                        {localPrintStatus && (
                          <p className={`mt-2 text-[11px] font-bold ${/failed|not found|no local|no printer/i.test(localPrintStatus) ? 'text-amber-700' : 'text-emerald-700'}`}>
                            {localPrintStatus}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[auto_minmax(180px,1fr)_auto] lg:w-[520px]">
                      <button
                        type="button"
                        onClick={() => setLocalPrintingEnabled(value => !value)}
                        className={`inline-flex min-h-10 items-center justify-center rounded-xl border px-3 text-xs font-black transition-all ${
                          localPrintingEnabled
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                            : 'border-espresso/10 bg-cream text-espresso/60 hover:bg-cream-dark'
                        }`}
                      >
                        {localPrintingEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                      <Select
                        aria-label="Local receipt printer"
                        value={selectedLocalPrinter}
                        onChange={e => setSelectedLocalPrinter(e.target.value)}
                        disabled={!localPrintingEnabled || localPrinterLoading || !localPrinters.length}
                        options={[
                          { value: '', label: localPrinters.length ? 'Use default printer' : 'No printers detected' },
                          ...localPrinters.map(printer => ({
                            value: printer.name,
                            label: `${printer.name}${printer.default ? ' (Default)' : ''}`,
                          })),
                        ]}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        icon={RefreshCw}
                        onClick={handleDetectLocalPrinters}
                        loading={localPrinterLoading}
                        disabled={localPrinterLoading}
                      >
                        Detect
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="relative">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-espresso/30" />
                  <input
                    type="text"
                    value={posSearch}
                    onChange={e => setPosSearch(e.target.value)}
                    placeholder="Search products..."
                    className="w-full bg-white border border-espresso/10 rounded-xl py-2.5 pl-10 pr-4 text-xs focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/20 transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4">
                  {pagedProducts.map((prod, i) => {
                    const availableServings = getProductAvailable(prod);
                    return (
                    <button
                      key={prod.id}
                      onClick={() => addToCart(prod)}
                      className={`bg-white rounded-2xl border border-espresso/5 shadow-sm text-left flex flex-col overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group relative ${availableServings <= 0 && prod.is_cafe_item ? 'opacity-50 cursor-not-allowed' : ''} animate-in-up`}
                      style={{ animationDelay: `${i * 30}ms` }}
                    >
                      {/* Drink image */}
                      <div className="relative w-full h-28 bg-cream overflow-hidden shrink-0">
                        {prod.image_url ? (
                          <img
                            src={prod.image_url}
                            alt={prod.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                          />
                        ) : null}
                        <div
                          className="w-full h-full flex items-center justify-center text-3xl"
                          style={{ display: prod.image_url ? 'none' : 'flex' }}
                        >
                          ☕
                        </div>
                        {/* Category badge pinned on image */}
                        <span className={`absolute top-2 left-2 text-[9px] font-bold px-2 py-0.5 rounded-full shadow-sm ${prod.is_cafe_item ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                          {prod.category_details?.name || (prod.is_cafe_item ? 'Café' : 'Studio')}
                        </span>
                        {/* Out-of-stock overlay */}
                        {availableServings <= 0 && prod.is_cafe_item && (
                          <div className="absolute inset-0 bg-espresso/60 flex items-center justify-center">
                            <span className="text-[10px] font-bold text-white bg-red-500 px-2 py-0.5 rounded-full">Out of Stock</span>
                          </div>
                        )}
                      </div>

                      {/* Info row */}
                      <div className="p-3 flex flex-col gap-1 flex-1">
                        <h4 className="font-bold text-xs text-espresso group-hover:text-gold transition-colors leading-snug">{prod.name}</h4>
                        <div className="flex items-center justify-between mt-auto pt-1">
                          <span className="text-xs text-gold font-bold">₱{prod.price}</span>
                          {prod.is_cafe_item && (
                            <span className={`font-bold flex items-center gap-0.5 text-[9px] ${availableServings <= 5 ? 'text-red-500' : 'text-espresso/40'}`}>
                              {availableServings <= 5 && <AlertTriangle className="w-2.5 h-2.5" />}
                              {availableServings} serving{availableServings === 1 ? '' : 's'}
                            </span>
                          )}
                          {!prod.is_cafe_item && (
                            <span className="text-[9px] text-espresso/40">Unlimited</span>
                          )}
                        </div>
                      </div>
                    </button>
                    );
                  })}
                </div>
                <PaginationControls page={productPage} setPage={setProductPage} total={filteredProducts.length} pageSize={PRODUCT_PAGE_SIZE} />
              </div>

              <div className="lg:col-span-4">
                <Card>
                  <CardHeader title="Active Cart" subtitle={`${cart.length} item${cart.length !== 1 ? 's' : ''}`} />
                  {cart.length > 0 ? (
                    <div className="space-y-4">
                      <div className="space-y-2 max-h-64 overflow-y-auto scrollbar-thin pr-1">
                        {cart.map(item => (
                          <div key={item.id} className="flex items-center justify-between bg-cream p-3 rounded-xl text-xs">
                            <div className="min-w-0 flex-1 pr-2">
                              <p className="font-bold text-espresso truncate">{item.name}</p>
                              <p className="text-espresso/50 mt-0.5">PHP {item.price} each</p>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <button onClick={() => updateCartQty(item.id, -1)} className="bg-white border border-espresso/10 p-1 rounded-lg hover:bg-espresso/5 transition-colors"><Minus className="w-3 h-3" /></button>
                              <span className="font-bold w-5 text-center">{item.quantity}</span>
                              <button onClick={() => updateCartQty(item.id, 1)} className="bg-white border border-espresso/10 p-1 rounded-lg hover:bg-espresso/5 transition-colors"><Plus className="w-3 h-3" /></button>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="border-t border-espresso/5 pt-4 space-y-4">
                        <div className="flex justify-between font-bold text-sm">
                          <span className="text-espresso/70">Total:</span>
                          <span className="font-sans text-lg text-espresso">{formatReceiptCurrency(getCartTotal())}</span>
                        </div>

                        <div className="rounded-xl border border-espresso/5 bg-cream/70 p-3 space-y-2">
                          <div className="flex justify-between text-xs font-bold text-espresso/60">
                            <span>Subtotal</span>
                            <span>{formatReceiptCurrency(getCartSubtotal())}</span>
                          </div>
                          <div className="space-y-2">
                            <p className="text-[10px] uppercase font-bold text-espresso/50">Discount</p>
                            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                              <button
                                type="button"
                                onClick={() => {
                                  setDiscountValue('');
                                }}
                                className={`text-xs font-bold py-2 rounded-xl border transition-all ${
                                  !Number(discountValue || 0)
                                    ? 'bg-espresso text-cream border-espresso shadow-sm'
                                    : 'border-espresso/10 text-espresso/60 hover:border-espresso/30'
                                }`}
                                aria-pressed={!Number(discountValue || 0)}
                              >
                                No Discount
                              </button>
                              {DISCOUNT_OPTIONS.map(value => {
                                const isActive = Number(discountValue || 0) === value;
                                return (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => {
                                    setDiscountValue(String(value));
                                  }}
                                  className={`text-xs font-bold py-2 rounded-xl border transition-all ${
                                    isActive
                                      ? 'bg-espresso text-cream border-espresso shadow-sm'
                                      : 'border-espresso/10 text-espresso/60 hover:border-espresso/30'
                                  }`}
                                  aria-pressed={isActive}
                                >
                                  {value}%
                                </button>
                                );
                              })}
                            </div>
                          </div>
                          <div className="flex justify-between text-xs font-bold text-espresso/60">
                            <span>Discount Applied</span>
                            <span>-{formatReceiptCurrency(getCartDiscountAmount())}</span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-[10px] uppercase font-bold text-espresso/50">Payment Method</p>
                          <div className="grid grid-cols-2 gap-1.5">
                            {['CASH', 'GCASH'].map(m => (
                              <button key={m} onClick={() => setPaymentMethod(m)}
                                className={`text-xs font-bold py-2 rounded-xl border transition-all ${paymentMethod === m ? 'bg-espresso text-cream border-espresso shadow-sm' : 'border-espresso/10 text-espresso/60 hover:border-espresso/30'}`}>
                                {m}
                              </button>
                            ))}
                          </div>
                        </div>

                        {paymentMethod !== 'CASH' && (
                          <div className="animate-in-up">
                            <Input
                              label="Reference ID"
                              value={transactionId}
                              onChange={e => setTransactionId(e.target.value)}
                              placeholder="e.g. GCash Ref Number"
                            />
                          </div>
                        )}

                        {paymentMethod === 'CASH' && (
                          <div className="grid grid-cols-2 gap-2 animate-in-up">
                            <Input
                              label="Amount Received"
                              type="number"
                              min={getCartTotal()}
                              step="0.01"
                              value={amountReceived}
                              onChange={e => setAmountReceived(e.target.value)}
                              placeholder="0.00"
                            />
                            <div className="rounded-xl bg-cream border border-espresso/5 px-3 py-2.5">
                              <p className="text-[10px] uppercase font-bold text-espresso/45">Change</p>
                              <p className="font-sans text-lg font-extrabold text-espresso">
                                PHP {Math.max(Number(amountReceived || 0) - getCartTotal(), 0).toFixed(2)}
                              </p>
                            </div>
                          </div>
                        )}

                        <Button variant="gold" size="lg" className="w-full" onClick={handleCheckout} loading={showCheckoutLoading} disabled={checkoutLoading}>
                          {showCheckoutLoading ? 'Finalizing Sale...' : `Complete Sale - ${formatReceiptCurrency(getCartTotal())}`}
                        </Button>
                      </div>
                    </div>
                    ) : (
                      <div className="text-center py-8 space-y-4">
                        <div className="bg-cream w-16 h-16 mx-auto rounded-2xl flex items-center justify-center">
                          <ShoppingBag className="w-7 h-7 text-espresso/30" />
                        </div>
                        <div>
                          <p className="font-extrabold text-espresso text-sm">Your cart is empty</p>
                          <p className="text-xs text-espresso/40 mt-1 max-w-[180px] mx-auto">Tap a product on the left to ring up a sale.</p>
                        </div>
                      </div>
                  )}
                </Card>
              </div>
            </div>
          )}

          {/* PAYMENT BOOKING VERIFICATION */}
          {activeTab === 'payments' && (
            <div className="space-y-6 animate-in-up" key="payments">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">Payment Booking Verification</h1>
                  <p className="text-xs text-espresso/50 mt-1">Check GCash merchant records before approving down payments.</p>
                </div>
                <div className="w-full sm:w-64">
                  <Select
                    label="Payment Status"
                    value={paymentStatusFilter}
                    onChange={e => setPaymentStatusFilter(e.target.value)}
                    options={[
                      { value: 'PENDING_VERIFICATION', label: 'Pending Verification' },
                      { value: 'APPROVED', label: 'Approved' },
                      { value: 'REJECTED', label: 'Rejected' },
                      { value: 'ALL', label: 'All Payments' },
                    ]}
                  />
                </div>
              </div>

              {filteredBookingPayments.length > 0 ? (
                <div className="space-y-4">
                  {pagedBookingPayments.map((payment, i) => {
                    const details = payment.booking_details || {};
                    const isPending = payment.status === 'PENDING_VERIFICATION';
                    return (
                      <div key={payment.id} className="bg-white p-5 md:p-6 rounded-2xl border border-espresso/5 shadow-sm hover:shadow-md transition-all duration-200 animate-in-up" style={{ animationDelay: `${i * 40}ms` }}>
                        <div className="grid grid-cols-1 xl:grid-cols-[1.1fr_1fr_auto] gap-4 items-start">
                          <div className="space-y-2">
                            <div className="flex items-center gap-3 flex-wrap">
                              <Avatar user={{ username: details.customer_name, profile_picture_url: details.customer_profile_picture_url }} size="sm" />
                              <span className="font-sans text-lg font-extrabold text-espresso">{details.customer_name || 'N/A'}</span>
                              <StatusBadge status={payment.status} />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-espresso/60">
                              <span>Package: <strong className="text-espresso">{details.package_name || 'N/A'}</strong></span>
                              <span>Schedule: <strong className="text-espresso">{details.scheduled_date} {details.scheduled_time}</strong></span>
                              <span>Reference: <strong className="text-espresso break-all">{payment.reference_number}</strong></span>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="bg-cream p-3 rounded-xl border border-espresso/5">
                              <p className="text-espresso/45 font-black uppercase tracking-wider">Amount</p>
                              <p className="font-black text-gold-dark">{formatCurrency(payment.amount)}</p>
                            </div>
                            <div className="bg-cream p-3 rounded-xl border border-espresso/5">
                              <p className="text-espresso/45 font-black uppercase tracking-wider">Required DP</p>
                              <p className="font-black text-espresso">{formatCurrency(payment.required_down_payment)}</p>
                            </div>
                            <div className="bg-cream p-3 rounded-xl border border-espresso/5 col-span-2">
                              <p className="text-espresso/45 font-black uppercase tracking-wider">Paid At</p>
                              <p className="font-black text-espresso">{new Date(payment.paid_at).toLocaleString()}</p>
                            </div>
                          </div>

                          <div className="flex flex-col sm:flex-row xl:flex-col gap-2">
                            {payment.receipt_url && (
                              <a
                                href={payment.receipt_url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center justify-center gap-2 rounded-[20px] bg-white border border-espresso/10 px-4 py-2 text-xs font-black text-espresso hover:bg-cream-dark transition-all"
                              >
                                <Eye className="w-4 h-4" />
                                Review Receipt Proof
                              </a>
                            )}
                            {isPending ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="success"
                                  icon={Check}
                                  loading={verifyingPaymentId === payment.id}
                                  onClick={() => handleVerifyBookingPayment(payment, 'APPROVED')}
                                >
                                  Confirm Payment
                                </Button>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  icon={X}
                                  disabled={verifyingPaymentId === payment.id}
                                  onClick={() => handleVerifyBookingPayment(payment, 'REJECTED')}
                                >
                                  Flag Payment Issue
                                </Button>
                              </>
                            ) : (
                              <div className="rounded-xl bg-cream border border-espresso/5 p-3 text-xs text-espresso/60">
                                <p className="font-black text-espresso">Verified by</p>
                                <div className="mt-2 flex items-center gap-2">
                                  <Avatar user={payment.verified_by_details} size="xs" />
                                  <p>{payment.verified_by_details?.username || 'N/A'}</p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <PaginationControls page={paymentPage} setPage={setPaymentPage} total={filteredBookingPayments.length} pageSize={TABLE_PAGE_SIZE} />
                </div>
              ) : (
                <EmptyState icon={CreditCard} title="No payments found" description="GCash booking payments will appear here once customers submit proof." />
              )}
            </div>
          )}

          {/* INVENTORY */}
          {activeTab === 'inventory' && (
            <div className="space-y-6 animate-in-up" key="inventory">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">Live Inventory</h1>
                  <p className="text-xs text-espresso/50 mt-1">Monitor stock levels, expiry risk, and purchasing actions.</p>
                </div>
                <Button variant="primary" size="sm" icon={Plus} onClick={() => setProductModalOpen(true)}>
                  Add Stock Item
                </Button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {inventoryStatuses.filter(status => status.key !== 'ALL').map(status => {
                  const Icon = status.icon;
                  const isActive = inventoryFilter === status.key;
                  return (
                    <button
                      key={status.key}
                      type="button"
                      onClick={() => setInventoryFilter(status.key)}
                      className={`group rounded-2xl border p-3 text-left shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_46px_rgba(46,26,17,0.08)] ${
                        isActive ? 'bg-espresso text-cream border-espresso' : 'bg-cream/60 border-espresso/[0.05] text-espresso hover:border-gold/40'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl transition-colors ${isActive ? 'bg-gold/15 text-gold' : status.iconClass}`}>
                          <Icon className="h-6 w-6" />
                        </span>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${isActive ? 'border-gold/30 bg-gold/10 text-gold' : status.className}`}>
                          {status.label}
                        </span>
                      </div>
                      <p className={`font-sans text-2xl font-extrabold mt-3 leading-tight ${isActive ? 'text-white' : 'text-espresso'}`}>
                        {inventoryCounts[status.key] || 0}
                      </p>
                      <p className={`text-[10px] uppercase font-black ${isActive ? 'text-cream/55' : 'text-espresso/45'}`}>
                        ingredient{(inventoryCounts[status.key] || 0) === 1 ? '' : 's'}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-col lg:flex-row gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-espresso/30" />
                  <input
                    id="inv-search"
                    type="text"
                    value={invSearch}
                    onChange={e => setInvSearch(e.target.value)}
                    placeholder="Search ingredients..."
                    className="w-full bg-white border border-espresso/10 rounded-xl py-2.5 pl-10 pr-4 text-xs focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/20 transition-all"
                  />
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {inventoryStatuses.slice(1).map(status => (
                    <button
                      key={status.key}
                      type="button"
                      onClick={() => setInventoryFilter(status.key)}
                      className={`whitespace-nowrap rounded-xl border px-3 py-2 text-[10px] font-black transition-all ${inventoryFilter === status.key ? 'bg-espresso text-cream border-espresso' : status.className}`}
                    >
                      {status.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setInventoryFilter('ALL')}
                    className={`whitespace-nowrap rounded-xl border px-3 py-2 text-[10px] font-black transition-all ${inventoryFilter === 'ALL' ? 'bg-espresso text-cream border-espresso' : 'bg-white text-espresso border-espresso/10'}`}
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-espresso/5 bg-white p-4 shadow-sm">
                <DataTable
                  columns={[
                    {
                      key: 'name',
                      label: 'Ingredient',
                      render: ingredient => (
                        <>
                          <p className="font-bold text-espresso">{ingredient.name}</p>
                          <p className="text-[10px] text-espresso/45">Batch {ingredient.batch_number || 'N/A'} · {ingredient.supplier_details?.name || 'No supplier'}</p>
                        </>
                      ),
                    },
                    { key: 'category_details.name', label: 'Category', render: ingredient => ingredient.category_details?.name || '-' },
                    { key: 'stock_quantity', label: 'Quantity', align: 'center', render: ingredient => `${Number(ingredient.stock_quantity).toLocaleString()} ${ingredient.base_unit}` },
                    { key: 'minimum_stock_level', label: 'Min / Max', align: 'center', render: ingredient => `${ingredient.minimum_stock_level} / ${ingredient.maximum_stock_level}` },
                    {
                      key: 'inventory_status_label',
                      label: 'Status',
                      render: ingredient => {
                        const meta = getInventoryStatusMeta(ingredient.inventory_status);
                        return (
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold ${meta.className}`}>
                            {ingredient.inventory_status_label}
                          </span>
                        );
                      },
                    },
                    { key: 'suggested_action', label: 'Action' },
                    {
                      key: 'expiration_date',
                      label: 'Expiry',
                      render: ingredient => (
                        <>
                          {ingredient.expiration_date || 'N/A'}
                          {ingredient.days_until_expiry !== null && ingredient.days_until_expiry !== undefined && (
                            <span className="block text-[10px] text-espresso/40">{ingredient.days_until_expiry} day(s)</span>
                          )}
                        </>
                      ),
                    },
                    { key: 'storage_location', label: 'Storage', render: ingredient => ingredient.storage_location || 'N/A' },
                  ]}
                  rows={pagedInventory}
                  sort={inventorySort}
                  onSort={(key, column) => toggleSort(inventorySort, setInventorySort, key, column)}
                  renderActions={ingredient => (
                    <>
                      <Button
                        variant="ghost"
                        size="xs"
                        icon={Pencil}
                        title={`Edit ${ingredient.name}`}
                        aria-label={`Edit ${ingredient.name}`}
                        onClick={() => openEditIngredientModal(ingredient)}
                      />
                      <Button variant="ghost" size="xs" onClick={() => {
                        setManualAdjIngredient(ingredient);
                        setAdjQty(0);
                        setAdjUnit(ingredient.base_unit);
                        setAdjMovementType('IN');
                      }}>Adjust Stock</Button>
                    </>
                  )}
                  emptyIcon={Package}
                  emptyTitle="No ingredients found"
                  emptyDescription="Try a different search or status filter."
                  minWidth={980}
                  actionWidth="w-[176px]"
                />
                <PaginationControls page={inventoryPage} setPage={setInventoryPage} total={visibleInventory.length} pageSize={TABLE_PAGE_SIZE} />
              </div>
            </div>
          )}

          {/* SALES LOGS */}
          {activeTab === 'sales' && (
            <div className="space-y-6 animate-in-up" key="sales">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">Daily Sales Logs</h1>
                  <p className="text-xs text-espresso/50 mt-1">Review historical transactions and receipt details.</p>
                </div>
                <div className="w-full sm:w-auto flex flex-col lg:flex-row lg:items-end gap-3">
                  <div className="grid grid-cols-1 sm:grid-cols-[minmax(140px,1fr)_minmax(140px,1fr)_auto] gap-2">
                    <Input
                      label="From"
                      type="date"
                      value={salesStartDate}
                      max={salesEndDate || undefined}
                      onChange={e => setSalesStartDate(e.target.value)}
                    />
                    <Input
                      label="To"
                      type="date"
                      value={salesEndDate}
                      min={salesStartDate || undefined}
                      onChange={e => setSalesEndDate(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => { setSalesStartDate(''); setSalesEndDate(''); }}
                      disabled={!salesStartDate && !salesEndDate}
                      className="self-end rounded-[18px] border border-espresso/10 bg-white/90 px-4 py-3 text-xs font-black text-espresso/60 shadow-[0_10px_26px_rgba(46,26,17,0.04)] transition-all hover:text-espresso disabled:opacity-40"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="flex bg-white border border-espresso/10 rounded-xl p-1 text-xs">
                    {[
                      ['ALL', 'All'],
                      ['CASH', 'Cash'],
                      ['GCASH', 'GCash'],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setSalesPaymentFilter(value)}
                        className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${salesPaymentFilter === value ? 'bg-espresso text-cream shadow-sm' : 'text-espresso/50 hover:text-espresso'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-espresso/5 bg-white p-4 shadow-sm">
                <DataTable
                  columns={[
                    { key: 'transaction_id', label: 'Transaction ID', render: order => order.transaction_id || 'Transaction pending' },
                    {
                      key: 'created_at',
                      label: 'Date & Time',
                      sortAccessor: order => order.completed_at || order.created_at,
                      render: order => getReceiptDateTime(order),
                    },
                    {
                      key: 'amount_paid',
                      label: 'Amount Paid',
                      align: 'right',
                      sortAccessor: order => getReceiptAmountReceived(order),
                      render: order => formatReceiptCurrency(getReceiptAmountReceived(order)),
                    },
                  ]}
                  rows={pagedOrders}
                  sort={salesSort}
                  onSort={(key, column) => toggleSort(salesSort, setSalesSort, key, column)}
                  renderActions={order => (
                    <Button
                      variant="ghost"
                      size="xs"
                      icon={Eye}
                      title={`Open receipt ${order.transaction_id || order.id}`}
                      aria-label={`Open receipt ${order.transaction_id || order.id}`}
                      onClick={() => setReceiptOrder(order)}
                    />
                  )}
                  actionLabel="Receipt"
                  emptyIcon={DollarSign}
                  emptyTitle="No transactions"
                  emptyDescription="No sales match the selected payment method or date range."
                  minWidth={700}
                />
                <PaginationControls page={salesPage} setPage={setSalesPage} total={filteredOrders.length} pageSize={TABLE_PAGE_SIZE} />
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Add Ingredient Modal */}
      <Modal open={productModalOpen} onClose={() => { setProductModalOpen(false); setProductErrors({}); }} title="Add Ingredient Stock" size="3xl">
        <form onSubmit={handleCreateProduct} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Ingredient Name" required value={productForm.name} onChange={e => handleProductFieldChange('name', e.target.value)} error={productErrors.name} />
            <Input label="Batch Number" required value={productForm.batch_number} onChange={e => handleProductFieldChange('batch_number', e.target.value)} error={productErrors.batch_number} />
            <Select
              label="Category"
              required
              value={productForm.category}
              onChange={e => handleProductFieldChange('category', e.target.value)}
              options={[{ value: '', label: 'Select category' }, ...categories.map(category => ({ value: category.id, label: category.name }))]}
              error={productErrors.category}
            />
            <Select
              label="Supplier"
              required
              value={productForm.supplier}
              onChange={e => handleProductFieldChange('supplier', e.target.value)}
              options={[{ value: '', label: 'Select supplier' }, ...suppliers.map(supplier => ({ value: supplier.id, label: supplier.name }))]}
              error={productErrors.supplier}
            />
            <Select
              label="Base Unit"
              required
              value={productForm.unit}
              onChange={e => handleProductFieldChange('unit', e.target.value)}
              options={[
                { value: 'ML', label: 'mL' },
                { value: 'G', label: 'g' },
              ]}
              error={productErrors.unit}
            />
            <Input label="Quantity" required type="number" min="0" value={productForm.stock_level} onChange={e => handleProductFieldChange('stock_level', e.target.value)} error={productErrors.stock_level} />
            <Input label="Minimum Stock Level" required type="number" min="0" value={productForm.reorder_point} onChange={e => handleProductFieldChange('reorder_point', e.target.value)} error={productErrors.reorder_point} />
            <Input label="Maximum Stock Level" required type="number" min="0" value={productForm.maximum_stock_level} onChange={e => handleProductFieldChange('maximum_stock_level', e.target.value)} error={productErrors.maximum_stock_level} />
            <Input label="Purchase Date" required type="date" value={productForm.purchase_date} onChange={e => handleProductFieldChange('purchase_date', e.target.value)} error={productErrors.purchase_date} />
            <Input label="Expiration Date" type="date" value={productForm.expiration_date} onChange={e => handleProductFieldChange('expiration_date', e.target.value)} error={productErrors.expiration_date} />
            <Input label="Storage Location" required value={productForm.storage_location} onChange={e => handleProductFieldChange('storage_location', e.target.value)} error={productErrors.storage_location} />
          </div>
          <div className="sticky bottom-0 bg-white/95 flex flex-col sm:flex-row gap-2 pt-4 pb-1 border-t border-espresso/[0.06]">
            <Button type="submit" variant="primary" className="flex-1" loading={productSaving} disabled={productSaving || !productFormValid}>
              Add to Inventory
            </Button>
            <Button type="button" variant="outline" onClick={() => { setProductModalOpen(false); setProductErrors({}); }} disabled={productSaving}>
              Keep Inventory As Is
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Ingredient Modal */}
      <Modal
        open={!!editingIngredient}
        onClose={() => {
          if (editIngredientSaving) return;
          setEditingIngredient(null);
          setEditIngredientErrors({});
        }}
        title="Edit Raw Ingredient"
        size="3xl"
      >
        <form onSubmit={handleUpdateIngredient} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Ingredient Name"
              required
              value={editIngredientForm.name}
              onChange={e => handleEditIngredientFieldChange('name', e.target.value)}
              disabled={editIngredientSaving}
              error={editIngredientErrors.name}
            />
            <Input
              label="Batch Number"
              required
              value={editIngredientForm.batch_number}
              onChange={e => handleEditIngredientFieldChange('batch_number', e.target.value)}
              disabled={editIngredientSaving}
              error={editIngredientErrors.batch_number}
            />
            <Select
              label="Category"
              required
              value={editIngredientForm.category}
              onChange={e => handleEditIngredientFieldChange('category', e.target.value)}
              options={[{ value: '', label: 'Select category' }, ...categories.map(category => ({ value: category.id, label: category.name }))]}
              disabled={editIngredientSaving}
              error={editIngredientErrors.category}
            />
            <Select
              label="Supplier"
              required
              value={editIngredientForm.supplier}
              onChange={e => handleEditIngredientFieldChange('supplier', e.target.value)}
              options={[{ value: '', label: 'Select supplier' }, ...suppliers.map(supplier => ({ value: supplier.id, label: supplier.name }))]}
              disabled={editIngredientSaving}
              error={editIngredientErrors.supplier}
            />
            <Select
              label="Base Unit"
              required
              value={editIngredientForm.unit}
              onChange={e => handleEditIngredientFieldChange('unit', e.target.value)}
              options={[
                { value: 'ML', label: 'mL' },
                { value: 'G', label: 'g' },
              ]}
              disabled={editIngredientSaving}
              error={editIngredientErrors.unit}
            />
            <Input
              label="Stock Quantity"
              required
              type="number"
              min="0"
              step="0.01"
              value={editIngredientForm.stock_level}
              onChange={e => handleEditIngredientFieldChange('stock_level', e.target.value)}
              disabled={editIngredientSaving}
              error={editIngredientErrors.stock_level}
            />
            <Input
              label="Minimum Stock Level"
              required
              type="number"
              min="0"
              step="0.01"
              value={editIngredientForm.reorder_point}
              onChange={e => handleEditIngredientFieldChange('reorder_point', e.target.value)}
              disabled={editIngredientSaving}
              error={editIngredientErrors.reorder_point}
            />
            <Input
              label="Maximum Stock Level"
              required
              type="number"
              min="0"
              step="0.01"
              value={editIngredientForm.maximum_stock_level}
              onChange={e => handleEditIngredientFieldChange('maximum_stock_level', e.target.value)}
              disabled={editIngredientSaving}
              error={editIngredientErrors.maximum_stock_level}
            />
            <Input
              label="Purchase Date"
              required
              type="date"
              value={editIngredientForm.purchase_date}
              onChange={e => handleEditIngredientFieldChange('purchase_date', e.target.value)}
              disabled={editIngredientSaving}
              error={editIngredientErrors.purchase_date}
            />
            <Input
              label="Expiry Date"
              type="date"
              value={editIngredientForm.expiration_date}
              onChange={e => handleEditIngredientFieldChange('expiration_date', e.target.value)}
              disabled={editIngredientSaving}
              error={editIngredientErrors.expiration_date}
            />
            <Input
              label="Stock Location / Position"
              required
              value={editIngredientForm.storage_location}
              onChange={e => handleEditIngredientFieldChange('storage_location', e.target.value)}
              disabled={editIngredientSaving}
              error={editIngredientErrors.storage_location}
            />
          </div>
          <div className="sticky bottom-0 bg-white/95 flex flex-col sm:flex-row gap-2 pt-4 pb-1 border-t border-espresso/[0.06]">
            <Button type="submit" variant="primary" className="flex-1" loading={editIngredientSaving} disabled={editIngredientSaving || !editIngredientFormValid}>
              Update Stock Details
            </Button>
            <Button type="button" variant="outline" onClick={() => { setEditingIngredient(null); setEditIngredientErrors({}); }} disabled={editIngredientSaving}>
              Keep Current Details
            </Button>
          </div>
        </form>
      </Modal>

      {/* Adj Modal */}
      <Modal open={!!manualAdjIngredient} onClose={() => !adjustingStock && setManualAdjIngredient(null)} title="Adjust Ingredient Stock" size="sm">
        <p className="text-xs text-espresso/60 mb-4">
          Modify ingredient stock for <strong className="text-espresso">{manualAdjIngredient?.name}</strong>.
        </p>
        <div className="space-y-4">
          <Select
            label="Movement"
            value={adjMovementType}
            onChange={e => setAdjMovementType(e.target.value)}
            disabled={adjustingStock}
            options={[
              { value: 'IN', label: 'Stock In' },
              { value: 'OUT', label: 'Stock Out' },
            ]}
          />
          <Input label="Quantity" type="number" min="0" step="0.01" value={adjQty} onChange={e => setAdjQty(e.target.value)} disabled={adjustingStock} />
          <Select
            label="Unit"
            value={adjUnit}
            onChange={e => setAdjUnit(e.target.value)}
            disabled={adjustingStock}
            options={manualAdjIngredient?.base_unit === 'G'
              ? [{ value: 'G', label: 'g' }, { value: 'KG', label: 'kg' }]
              : [{ value: 'ML', label: 'mL' }, { value: 'L', label: 'L' }]
            }
          />
          <div className="flex gap-2">
            <Button variant="primary" className="flex-1" onClick={handleAdjustInventory} loading={adjustingStock} disabled={adjustingStock}>
              Apply Stock Adjustment
            </Button>
            <Button variant="outline" onClick={() => setManualAdjIngredient(null)} disabled={adjustingStock}>
              Keep Stock Unchanged
            </Button>
          </div>
        </div>
      </Modal>

      {/* Receipt Modal */}
      <Modal open={!!receiptOrder} onClose={() => setReceiptOrder(null)} title="Receipt Preview" size="md">
        {receiptOrder && (() => {
          const business = getReceiptBusiness(receiptOrder);
          return (
            <div id="receipt-print-area" className="mx-auto w-[58mm] max-w-full bg-white px-[4mm] py-[3mm] font-sans text-[9.5px] font-semibold leading-tight text-black">
              <div className="space-y-1 text-center">
                <div className="flex justify-center">
                  <div className="flex h-[17mm] w-[17mm] items-center justify-center overflow-hidden">
                    {business.logoUrl ? (
                      <img
                        src={business.logoUrl}
                        alt={`${business.name} logo`}
                        className="h-full w-full object-contain grayscale contrast-125"
                      />
                    ) : (
                      <div className="flex h-[14mm] min-w-[22mm] items-center justify-center border border-black px-2 text-[20px] font-black leading-none text-black">
                        {business.logoText}
                      </div>
                    )}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[11px] font-black uppercase leading-tight">{business.name}</p>
                  <p className="text-[8.5px] font-semibold leading-snug">{business.address}</p>
                  <p className="text-[8.5px] font-semibold leading-snug">Contact Number: {business.contactNumber}</p>
                </div>
              </div>

              <div className="my-1.5 border-t border-black" />

              <div className="space-y-0.5">
                <div className="grid grid-cols-[23mm_1fr] gap-1">
                  <span className="font-black">OR No.</span>
                  <span className="break-all text-right">{getReceiptOrNumber(receiptOrder)}</span>
                </div>
                <div className="grid grid-cols-[23mm_1fr] gap-1">
                  <span className="font-black">Transaction No.</span>
                  <span className="break-all text-right">{getReceiptTransactionNumber(receiptOrder)}</span>
                </div>
                <div className="grid grid-cols-[23mm_1fr] gap-1">
                  <span className="font-black">Date &amp; Time</span>
                  <span className="text-right">{getReceiptDateTime(receiptOrder)}</span>
                </div>
                <div className="grid grid-cols-[23mm_1fr] gap-1">
                  <span className="font-black">Cashier</span>
                  <span className="break-all text-right">{receiptOrder?.staff_name || user?.username}</span>
                </div>
              </div>

              <div className="my-1.5 border-t border-black" />

              <div>
                <div className="mb-1 text-center text-[9px] font-black uppercase">Itemized Products</div>
                <div className="grid grid-cols-[1fr_6mm_13mm_15mm] gap-1 border-b border-black pb-0.5 text-[8px] font-black uppercase">
                  <span>Product</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Price</span>
                  <span className="text-right">Amount</span>
                </div>
                <div className="space-y-1 pt-1">
                  {receiptOrder?.items?.map((item, index) => (
                    <div key={item.id || `${item.product}-${index}`} className="grid grid-cols-[1fr_6mm_13mm_15mm] gap-1 text-[8.5px] leading-tight">
                      <span className="break-words pr-1 font-semibold">{item.product_details?.name || 'Item'}</span>
                      <span className="text-right tabular-nums">{item.quantity}</span>
                      <span className="whitespace-nowrap text-right tabular-nums">{formatReceiptCurrency(item.price)}</span>
                      <span className="whitespace-nowrap text-right font-black tabular-nums">{formatReceiptCurrency(item.subtotal)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="my-1.5 border-t border-black" />

              <div className="space-y-0.5">
                <div className="grid grid-cols-[23mm_1fr] gap-1">
                  <span className="font-black">Subtotal</span>
                  <span className="whitespace-nowrap text-right tabular-nums">{formatReceiptCurrency(getReceiptSubtotal(receiptOrder))}</span>
                </div>
                <div className="grid grid-cols-[23mm_1fr] gap-1">
                  <span className="font-black">Discounts</span>
                  <span className="whitespace-nowrap text-right tabular-nums">{formatReceiptCurrency(getReceiptDiscounts(receiptOrder))}</span>
                </div>
                <div className="grid grid-cols-[23mm_1fr] gap-1 border-y border-black py-0.5 text-[11px] font-black">
                  <span>Grand Total</span>
                  <span className="whitespace-nowrap text-right tabular-nums">{formatReceiptCurrency(receiptOrder?.total)}</span>
                </div>
                <div className="grid grid-cols-[23mm_1fr] gap-1">
                  <span className="font-black">Payment Method</span>
                  <span className="text-right">{getReceiptPayment(receiptOrder)?.method || 'CASH'}</span>
                </div>
                <div className="grid grid-cols-[23mm_1fr] gap-1">
                  <span className="font-black">Cash Received</span>
                  <span className="whitespace-nowrap text-right tabular-nums">{formatReceiptCurrency(getReceiptAmountReceived(receiptOrder))}</span>
                </div>
                <div className="grid grid-cols-[23mm_1fr] gap-1">
                  <span className="font-black">Change</span>
                  <span className="whitespace-nowrap text-right tabular-nums">{formatReceiptCurrency(getReceiptChange(receiptOrder))}</span>
                </div>
              </div>

              <div className="mt-1.5 border-t border-black pt-1 text-center text-[10px] font-black">
                Thank You
              </div>
              <div className="h-[5mm]" aria-hidden="true" />
            </div>
          );
        })()}
        <div className="flex flex-col gap-3 mt-4 sm:flex-row">
          <Button variant="gold" className="flex-1" icon={Printer} onClick={handleBrowserPrintReceipt}>
            Print Receipt
          </Button>
          <Button variant="outline" className="flex-1" onClick={() => setReceiptOrder(null)}>Back to Sales Log</Button>
        </div>
      </Modal>
    </div>
  );
}
