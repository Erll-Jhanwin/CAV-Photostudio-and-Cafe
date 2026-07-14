import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import {
  ShoppingBag, Package, DollarSign, LogOut, Search, Plus,
  Minus, RefreshCw, AlertTriangle, Check, X, ShieldAlert, CreditCard, Eye, Printer
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

function PaginationControls({ page, setPage, total, pageSize }) {
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-3 text-xs text-espresso/55">
      <span>Page {page} of {totalPages}</span>
      <div className="flex gap-2">
        <button type="button" disabled={page <= 1} onClick={() => setPage(current => Math.max(1, current - 1))} className="rounded-xl border border-espresso/10 bg-white px-3 py-1.5 font-bold disabled:opacity-40">
          Previous
        </button>
        <button type="button" disabled={page >= totalPages} onClick={() => setPage(current => Math.min(totalPages, current + 1))} className="rounded-xl border border-espresso/10 bg-white px-3 py-1.5 font-bold disabled:opacity-40">
          Next
        </button>
      </div>
    </div>
  );
}

const inventoryStatuses = [
  { key: 'ALL', label: 'All Items', className: 'bg-white text-espresso border-espresso/10' },
  { key: 'IN_STOCK', label: 'In Stock', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { key: 'LOW_STOCK', label: 'Low Stock', className: 'bg-amber-50 text-amber-700 border-amber-200' },
  { key: 'NEAR_EXPIRY', label: 'Near Expiry', className: 'bg-orange-50 text-orange-700 border-orange-200' },
  { key: 'EXPIRED', label: 'Expired', className: 'bg-red-50 text-red-700 border-red-200' },
  { key: 'OVERSTOCKED', label: 'Overstocked', className: 'bg-blue-50 text-blue-700 border-blue-200' },
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
  const [activeTab, setActiveTab] = useState('pos');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);

  const [products, setProducts] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [bookings, setBookings] = useState([]);
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
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [showCheckoutLoading, setShowCheckoutLoading] = useState(false);
  const [orderType, setOrderType] = useState('WALK_IN');
  const [linkedBookingId, setLinkedBookingId] = useState('');
  const [receiptOrder, setReceiptOrder] = useState(null);
  const [receiptPrintError, setReceiptPrintError] = useState('');
  const [endOfDayReports, setEndOfDayReports] = useState([]);
  const [endOfDayModalOpen, setEndOfDayModalOpen] = useState(false);
  const [endOfDayDate, setEndOfDayDate] = useState(todayValue());
  const [endOfDayActualCash, setEndOfDayActualCash] = useState('');
  const [endOfDayExpectedCash, setEndOfDayExpectedCash] = useState('');
  const [endOfDayCashLoading, setEndOfDayCashLoading] = useState(false);
  const [endOfDayPrinting, setEndOfDayPrinting] = useState(false);
  const checkoutInFlightRef = useRef(false);

  const [posSearch, setPosSearch] = useState('');
  const [invSearch, setInvSearch] = useState('');
  const [manualAdjIngredient, setManualAdjIngredient] = useState(null);
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
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [productForm, setProductForm] = useState(emptyProductForm());

  const loadStaticInventoryOptions = async (force = false) => {
    const cachedCategories = !force ? readStaffCache('categories') : null;
    const cachedSuppliers = !force ? readStaffCache('suppliers') : null;
    if (cachedCategories) setCategories(cachedCategories);
    if (cachedSuppliers) setSuppliers(cachedSuppliers);
    if (cachedCategories && cachedSuppliers && !force) return;

    const [categoriesRes, suppliersRes] = await Promise.all([
      client.get('/api/inventory/categories/'),
      client.get('/api/inventory/suppliers/')
    ]);
    setCategories(categoriesRes.data);
    setSuppliers(suppliersRes.data);
    writeStaffCache('categories', categoriesRes.data);
    writeStaffCache('suppliers', suppliersRes.data);
  };

  const refreshProducts = async () => {
    const productsRes = await client.get('/api/inventory/products/', { params: { limit: 240 } });
    setProducts(productsRes.data);
    writeStaffCache('products', productsRes.data);
  };

  const ensureDefaultRecipesOnce = async () => {
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
  };

  const loadTabData = async (tab = activeTab, force = false) => {
    if (!force && loadedTabs[tab]) return;
    try {
      setError('');
      setLoadingResources(current => ({ ...current, [tab]: true }));

      if (tab === 'pos') {
        const cachedProducts = !force ? readStaffCache('products') : null;
        if (cachedProducts?.length) {
          setProducts(cachedProducts);
          setLoading(false);
        }
        const [productsRes, bookingsRes] = await Promise.all([
          client.get('/api/inventory/products/', { params: { limit: 240 } }),
          client.get('/api/bookings/', { params: { active: 'true', limit: 100 } })
        ]);
        setProducts(productsRes.data);
        setBookings(bookingsRes.data);
        writeStaffCache('products', productsRes.data);
        ensureDefaultRecipesOnce();
      } else if (tab === 'payments') {
        const paymentsRes = await client.get('/api/bookings/payments/', { params: { limit: 100 } });
        setBookingPayments(paymentsRes.data);
      } else if (tab === 'inventory') {
        await loadStaticInventoryOptions(force);
        const ingredientsRes = await client.get('/api/inventory/ingredients/', { params: { limit: 300 } });
        setIngredients(ingredientsRes.data);
      } else if (tab === 'sales') {
        const [ordersRes, reportsRes] = await Promise.all([
          client.get('/api/pos/orders/', { params: { limit: 100 } }),
          client.get('/api/pos/end-of-day-reports/')
        ]);
        setOrders(ordersRes.data);
        setEndOfDayReports(reportsRes.data);
      }

      setLoadedTabs(current => ({ ...current, [tab]: true }));
    } catch {
      setError('Failed to load dashboard data. Make sure the server is running.');
    } finally {
      setLoadingResources(current => ({ ...current, [tab]: false }));
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
      navigate('/login');
      return;
    }
    loadTabData(activeTab);
  }, [user, navigate, activeTab]);

  useEffect(() => { setProductPage(1); }, [posSearch]);
  useEffect(() => { setPaymentPage(1); }, [paymentStatusFilter]);
  useEffect(() => { setInventoryPage(1); }, [invSearch, inventoryFilter]);
  useEffect(() => { setSalesPage(1); }, [salesPaymentFilter, salesStartDate, salesEndDate]);

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

  const getCartTotal = () => cart.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);
  const getReceiptPayment = (order) => order?.payments?.[0] || null;
  const getReceiptAmountReceived = (order) => Number(getReceiptPayment(order)?.amount || order?.amount_received || order?.total || 0);
  const getReceiptChange = (order) => Math.max(getReceiptAmountReceived(order) - Number(order?.total || 0), 0);

  const handleCheckout = async () => {
    if (cart.length === 0 || checkoutInFlightRef.current) return;
    const total = getCartTotal();
    const cashReceived = paymentMethod === 'CASH' ? Number(amountReceived) : total;

    if (paymentMethod === 'CASH' && (!amountReceived || cashReceived < total)) {
      alert('Amount received must be equal to or greater than the total.');
      return;
    }

    let loadingTimer;
    try {
      checkoutInFlightRef.current = true;
      setCheckoutLoading(true);
      setReceiptPrintError('');
      loadingTimer = setTimeout(() => setShowCheckoutLoading(true), 450);
      const payload = {
        items: cart.map(item => ({ product_id: item.id, quantity: item.quantity })),
        order_type: orderType,
        payment: { amount: cashReceived, method: paymentMethod, transaction_id: transactionId }
      };
      if (orderType === 'BOOKING_LINKED' && linkedBookingId) payload.booking_id = linkedBookingId;
      const res = await client.post('/api/pos/orders/', payload);
      const savedOrder = {
        ...res.data,
        amount_received: res.data.amount_received || cashReceived,
        change_amount: res.data.change_amount || Math.max(cashReceived - total, 0),
      };
      if (!res.data.receipt_print?.printed) {
        setReceiptPrintError(res.data.receipt_print?.error || 'Payment saved, but the receipt could not be printed. Check the default receipt printer driver.');
      }
      setOrders(current => [savedOrder, ...current]);
      setProducts(current => current.map(product => {
        const cartItem = cart.find(item => item.id === product.id);
        if (!cartItem) return product;
        return updateProductRecipeStock(product, cartItem.quantity);
      }));
      setIngredients(current => current.map(ingredient => {
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
      }));
      setCart([]);
      setTransactionId('');
      setAmountReceived('');
      setLinkedBookingId('');
      setOrderType('WALK_IN');
    } catch (err) {
      alert(err.response?.data?.detail || 'Checkout failed.');
    } finally {
      checkoutInFlightRef.current = false;
      clearTimeout(loadingTimer);
      setCheckoutLoading(false);
      setShowCheckoutLoading(false);
    }
  };

  const getExpectedCashForDate = async (dateValue) => {
    setEndOfDayCashLoading(true);
    try {
      const res = await client.get('/api/pos/orders/', { params: { limit: 200 } });
      const cashTotal = res.data
        .filter(order => {
          const orderDate = order.created_at ? new Date(order.created_at).toISOString().slice(0, 10) : '';
          const paidCash = order.payment_status === 'PAID' && order.payments?.some(payment => payment.method === 'CASH');
          return orderDate === dateValue && paidCash;
        })
        .reduce((sum, order) => sum + Number(order.total || 0), 0);
      const formatted = cashTotal.toFixed(2);
      setEndOfDayExpectedCash(formatted);
      setEndOfDayActualCash(formatted);
    } catch {
      setEndOfDayExpectedCash('');
      setEndOfDayActualCash('');
    } finally {
      setEndOfDayCashLoading(false);
    }
  };

  const openEndOfDayModal = async (dateValue = todayValue()) => {
    setEndOfDayDate(dateValue);
    setEndOfDayModalOpen(true);
    await getExpectedCashForDate(dateValue);
  };

  const handleEndOfDayDateChange = async (dateValue) => {
    setEndOfDayDate(dateValue);
    await getExpectedCashForDate(dateValue);
  };

  const handlePrintEndOfDayReport = async () => {
    const actualCash = Number(endOfDayActualCash);
    if (!endOfDayActualCash || !Number.isFinite(actualCash) || actualCash < 0) {
      alert('Enter the actual cash counted in the drawer.');
      return;
    }
    if (!window.confirm(`Print and save the end-of-day report for ${endOfDayDate}?`)) return;

    try {
      setEndOfDayPrinting(true);
      setReceiptPrintError('');
      const res = await client.post('/api/pos/end-of-day-reports/', {
        report_date: endOfDayDate,
        actual_cash: actualCash.toFixed(2),
      });
      setEndOfDayReports(current => [res.data, ...current.filter(report => report.id !== res.data.id)]);
      setEndOfDayModalOpen(false);
      setEndOfDayActualCash('');
      if (!res.data.receipt_print?.printed) {
        setReceiptPrintError(res.data.receipt_print?.error || 'Report saved, but the end-of-day receipt could not be printed.');
      }
    } catch (err) {
      const data = err.response?.data;
      const message = data && typeof data === 'object'
        ? Object.entries(data).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\n')
        : 'Failed to print end-of-day report.';
      alert(message);
    } finally {
      setEndOfDayPrinting(false);
    }
  };

  const handleReprintEndOfDayReport = async (report) => {
    if (!window.confirm(`Reprint end-of-day report for ${report.report_date}?`)) return;
    try {
      setReceiptPrintError('');
      const res = await client.post(`/api/pos/end-of-day-reports/${report.id}/reprint/`);
      setEndOfDayReports(current => current.map(item => item.id === report.id ? res.data : item));
      if (!res.data.receipt_print?.printed) {
        setReceiptPrintError(res.data.receipt_print?.error || 'Report found, but the receipt could not be printed.');
      }
    } catch {
      alert('Failed to reprint report.');
    }
  };

  const handleVerifyBookingPayment = async (payment, newStatus) => {
    const action = newStatus === 'APPROVED' ? 'approve' : 'reject';
    if (!window.confirm(`Are you sure you want to ${action} payment ${payment.reference_number}?`)) return;
    try {
      setVerifyingPaymentId(payment.id);
      const res = await client.patch(`/api/bookings/payments/${payment.id}/verify/`, { status: newStatus });
      setBookingPayments(current => current.map(item => item.id === payment.id ? res.data : item));
      setBookings(current => current.map(booking => (
        booking.id === res.data.booking_details?.id
          ? { ...booking, status: res.data.booking_details.status === 'CONFIRMED_DP' ? 'CONFIRMED_DP' : booking.status }
          : booking
      )));
    } catch (err) {
      alert(err.response?.data?.detail || err.response?.data?.status || 'Failed to verify payment.');
    } finally {
      setVerifyingPaymentId(null);
    }
  };

  const handleAdjustInventory = async () => {
    if (!manualAdjIngredient) return;
    try {
      await client.post('/api/inventory/ingredient-movements/', {
        ingredient: manualAdjIngredient.id,
        movement_type: adjMovementType,
        quantity: adjQty,
        unit: adjUnit,
        reason: 'Manual ingredient adjustment',
      });
      const unitMultiplier = adjUnit === 'KG' || adjUnit === 'L' ? 1000 : 1;
      const baseQuantity = Number(adjQty || 0) * unitMultiplier;
      setIngredients(current => current.map(ingredient => {
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
      }));
      setProducts(current => current.map(product => {
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
      }));
      setManualAdjIngredient(null);
    } catch {
      alert('Adjustment failed.');
    }
  };

  const handleProductFieldChange = (field, value) => {
    setProductForm(current => ({ ...current, [field]: value }));
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    try {
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
      setIngredients(current => [res.data, ...current]);
      setProductForm(emptyProductForm());
      setProductModalOpen(false);
    } catch (err) {
      const data = err.response?.data;
      const message = data && typeof data === 'object'
        ? Object.entries(data).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`).join('\n')
        : 'Failed to create stock item.';
      alert(message);
    }
  };

  const handleLogout = useCallback(() => { logout(); navigate('/login', { replace: true }); }, [logout, navigate]);

  if (loading) return <StaffSkeleton />;

  const navItems = [
    { key: 'pos', label: 'POS Terminal', icon: ShoppingBag, active: activeTab === 'pos', onClick: () => setActiveTab('pos') },
    { key: 'payments', label: 'Payment Booking Verification', icon: CreditCard, active: activeTab === 'payments', onClick: () => setActiveTab('payments') },
    { key: 'inventory', label: 'Live Inventory', icon: Package, active: activeTab === 'inventory', onClick: () => setActiveTab('inventory') },
    { key: 'sales', label: 'Daily Sales Logs', icon: DollarSign, active: activeTab === 'sales', onClick: () => setActiveTab('sales') },
  ];

  const pageTitles = { pos: 'POS Terminal', payments: 'Payment Booking Verification', inventory: 'Live Inventory', sales: 'Daily Sales Logs' };
  const isCurrentTabLoading = !!loadingResources[activeTab];
  const filteredProducts = products.filter(product => product.name.toLowerCase().includes(posSearch.toLowerCase()));
  const pagedProducts = filteredProducts.slice((productPage - 1) * PRODUCT_PAGE_SIZE, productPage * PRODUCT_PAGE_SIZE);
  const visibleInventory = ingredients.filter(ingredient => {
    const matchesSearch = ingredient.name.toLowerCase().includes(invSearch.toLowerCase());
    const matchesStatus = inventoryFilter === 'ALL' || ingredient.inventory_status === inventoryFilter;
    return matchesSearch && matchesStatus;
  });
  const pagedInventory = visibleInventory.slice((inventoryPage - 1) * TABLE_PAGE_SIZE, inventoryPage * TABLE_PAGE_SIZE);
  const inventoryCounts = inventoryStatuses.reduce((counts, status) => {
    if (status.key === 'ALL') {
      counts.ALL = ingredients.length;
    } else {
      counts[status.key] = ingredients.filter(ingredient => ingredient.inventory_status === status.key).length;
    }
    return counts;
  }, {});
  const inventoryAlerts = ingredients
    .filter(ingredient => ['LOW_STOCK', 'NEAR_EXPIRY', 'EXPIRED', 'OVERSTOCKED'].includes(ingredient.inventory_status))
    .slice(0, 4);
  const salesStart = salesStartDate ? new Date(`${salesStartDate}T00:00:00`) : null;
  const salesEnd = salesEndDate ? new Date(`${salesEndDate}T23:59:59.999`) : null;
  const filteredOrders = orders.filter(order => {
    const createdAt = new Date(order.created_at);
    const matchesPayment = salesPaymentFilter === 'ALL' || order.payments?.some(payment => payment.method === salesPaymentFilter);
    const matchesStart = !salesStart || createdAt >= salesStart;
    const matchesEnd = !salesEnd || createdAt <= salesEnd;
    return matchesPayment && matchesStart && matchesEnd;
  });
  const pagedOrders = filteredOrders.slice((salesPage - 1) * TABLE_PAGE_SIZE, salesPage * TABLE_PAGE_SIZE);
  const filteredBookingPayments = bookingPayments.filter(payment => (
    paymentStatusFilter === 'ALL' || payment.status === paymentStatusFilter
  ));
  const pagedBookingPayments = filteredBookingPayments.slice((paymentPage - 1) * TABLE_PAGE_SIZE, paymentPage * TABLE_PAGE_SIZE);

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
        <MobileHeader title={pageTitles[activeTab]} onMenuToggle={() => setSidebarOpen(true)} />

        <main className="flex-1 p-4 md:p-6 lg:p-8 overflow-y-auto scrollbar-thin">
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-800 p-5 rounded-2xl mb-6 flex items-start gap-3 shadow-sm">
              <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-bold text-sm">Connection Error</h4>
                <p className="text-xs text-red-600/80 mt-1">{error}</p>
              </div>
              <Button variant="outline" size="sm" icon={RefreshCw} onClick={() => loadTabData(activeTab, true)}>Retry</Button>
            </div>
          )}

          {receiptPrintError && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-2xl mb-6 flex items-start gap-3 shadow-sm">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-bold text-sm">Receipt Not Printed</h4>
                <p className="text-xs text-amber-700/90 mt-1">{receiptPrintError}</p>
              </div>
              <button type="button" onClick={() => setReceiptPrintError('')} className="text-amber-700/70 hover:text-amber-900">
                <X className="w-4 h-4" />
              </button>
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
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      icon={Printer}
                      onClick={() => openEndOfDayModal()}
                    >
                      Print End-of-Day Report
                    </Button>
                    <div className="flex items-center gap-2 bg-white border border-espresso/10 rounded-xl px-3 py-1.5 text-xs">
                      <span className="font-semibold text-espresso/50">Cart Type:</span>
                      <select value={orderType} onChange={e => setOrderType(e.target.value)} className="bg-transparent font-bold focus:outline-none text-espresso">
                        <option value="WALK_IN">Walk-in Customer</option>
                        <option value="BOOKING_LINKED">Link to Booking</option>
                      </select>
                    </div>
                  </div>
                </div>

                {orderType === 'BOOKING_LINKED' && (
                  <div className="bg-white p-4 rounded-xl border border-espresso/5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center gap-3 animate-in-up">
                    <span className="text-xs font-bold text-espresso/60 uppercase shrink-0">Link Booking:</span>
                    <select value={linkedBookingId} onChange={e => setLinkedBookingId(e.target.value)} className="w-full sm:w-auto bg-cream border border-espresso/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-gold">
                      <option value="">Select a booking</option>
                      {bookings.filter(b => ['PENDING', 'CONFIRMED', 'CONFIRMED_DP'].includes(b.status)).map(b => (
                        <option key={b.id} value={b.id}>{b.customer?.username || 'Customer'} ({b.package_details?.name || 'Package'})</option>
                      ))}
                    </select>
                  </div>
                )}

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
                          <span className="font-sans text-lg text-espresso">PHP {getCartTotal()}</span>
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
                          {showCheckoutLoading ? 'Saving & Printing...' : `Pay PHP ${getCartTotal()}`}
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
                              <span className="font-sans text-lg font-extrabold">{details.package_name || 'Booking'}</span>
                              <StatusBadge status={payment.status} />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-espresso/60">
                              <span>Customer: <strong className="text-espresso">{details.customer_name || 'N/A'}</strong></span>
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
                                View Receipt
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
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  icon={X}
                                  disabled={verifyingPaymentId === payment.id}
                                  onClick={() => handleVerifyBookingPayment(payment, 'REJECTED')}
                                >
                                  Reject
                                </Button>
                              </>
                            ) : (
                              <div className="rounded-xl bg-cream border border-espresso/5 p-3 text-xs text-espresso/60">
                                <p className="font-black text-espresso">Verified by</p>
                                <p>{payment.verified_by_details?.username || 'N/A'}</p>
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
                  Add Ingredient
                </Button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
                {inventoryStatuses.map(status => (
                  <button
                    key={status.key}
                    type="button"
                    onClick={() => setInventoryFilter(status.key)}
                    className={`rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 ${inventoryFilter === status.key ? 'bg-espresso text-cream border-espresso shadow-sm' : 'bg-white border-espresso/5 text-espresso hover:border-gold/40'}`}
                  >
                    <p className="text-[10px] uppercase font-black opacity-60">{status.label}</p>
                    <p className="font-sans text-2xl font-extrabold mt-1">{inventoryCounts[status.key] || 0}</p>
                  </button>
                ))}
              </div>

              {inventoryAlerts.length > 0 && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {inventoryAlerts.map(ingredient => {
                    const meta = getInventoryStatusMeta(ingredient.inventory_status);
                    return (
                      <div key={ingredient.id} className="bg-white border border-espresso/5 rounded-2xl p-4 flex items-start justify-between gap-4 shadow-sm">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-sm text-espresso truncate">{ingredient.name}</p>
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${meta.className}`}>
                              {ingredient.inventory_status_label}
                            </span>
                          </div>
                          <p className="text-xs text-espresso/55 mt-1">{ingredient.suggested_action}</p>
                        </div>
                        <AlertTriangle className="w-5 h-5 text-gold shrink-0" />
                      </div>
                    );
                  })}
                </div>
              )}

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

              <div className="bg-white rounded-2xl border border-espresso/5 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-cream border-b border-espresso/5 text-espresso/50 font-bold uppercase tracking-wider">
                        <th className="p-4 text-left">Ingredient</th>
                        <th className="p-4 text-left">Category</th>
                        <th className="p-4 text-center">Quantity</th>
                        <th className="p-4 text-center">Min / Max</th>
                        <th className="p-4 text-left">Status</th>
                        <th className="p-4 text-left">Action</th>
                        <th className="p-4 text-left">Expiry</th>
                        <th className="p-4 text-left">Storage</th>
                        <th className="p-4 text-right">Adjust</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedInventory.map((ingredient, i) => {
                        const meta = getInventoryStatusMeta(ingredient.inventory_status);
                        return (
                          <tr key={ingredient.id} className="border-b border-espresso/5 hover:bg-espresso/[0.02] transition-colors animate-in-up" style={{ animationDelay: `${i * 20}ms` }}>
                            <td className="p-4">
                              <p className="font-bold text-espresso">{ingredient.name}</p>
                              <p className="text-[10px] text-espresso/45">Batch {ingredient.batch_number || 'N/A'} · {ingredient.supplier_details?.name || 'No supplier'}</p>
                            </td>
                            <td className="p-4 text-espresso/60">{ingredient.category_details?.name || '-'}</td>
                            <td className="p-4 text-center font-bold text-espresso">{Number(ingredient.stock_quantity).toLocaleString()} {ingredient.base_unit}</td>
                            <td className="p-4 text-center text-espresso/55">{ingredient.minimum_stock_level} / {ingredient.maximum_stock_level}</td>
                            <td className="p-4">
                              <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold ${meta.className}`}>
                                {ingredient.inventory_status_label}
                              </span>
                            </td>
                            <td className="p-4 font-bold text-espresso/70">{ingredient.suggested_action}</td>
                            <td className="p-4 text-espresso/60">
                              {ingredient.expiration_date || 'N/A'}
                              {ingredient.days_until_expiry !== null && ingredient.days_until_expiry !== undefined && (
                                <span className="block text-[10px] text-espresso/40">{ingredient.days_until_expiry} day(s)</span>
                              )}
                            </td>
                            <td className="p-4 text-espresso/60">{ingredient.storage_location || 'N/A'}</td>
                            <td className="p-4 text-right">
                              <Button variant="ghost" size="xs" onClick={() => {
                                setManualAdjIngredient(ingredient);
                                setAdjQty(0);
                                setAdjUnit(ingredient.base_unit);
                                setAdjMovementType('IN');
                              }}>Adjust</Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {visibleInventory.length === 0 && (
                    <div className="p-8">
                      <EmptyState icon={Package} title="No ingredients found" description="Try a different search or status filter." />
                    </div>
                  )}
                </div>
                <div className="px-4 pb-4">
                  <PaginationControls page={inventoryPage} setPage={setInventoryPage} total={visibleInventory.length} pageSize={TABLE_PAGE_SIZE} />
                </div>
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

              {filteredOrders.length > 0 ? (
                <div className="space-y-4">
                  {pagedOrders.map((o, i) => (
                    <div key={o.id} className="bg-white p-5 rounded-2xl border border-espresso/5 shadow-sm flex justify-between items-center animate-in-up" style={{ animationDelay: `${i * 40}ms` }}>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-sm">{o.order_type || 'Order'}</span>
                          <StatusBadge status={o.payment_status} />
                        </div>
                        <p className="text-xs text-espresso/60">
                          {o.items?.map(i => `${i.product_details?.name} (x${i.quantity})`).join(', ')}
                        </p>
                        <p className="text-[10px] text-espresso/40">{new Date(o.created_at).toLocaleString()}</p>
                      </div>
                      <div className="flex items-center gap-4 shrink-0">
                        <div className="text-right">
                          <p className="text-[10px] text-espresso/50">Amount</p>
                          <p className="font-bold text-espresso">PHP {o.total}</p>
                        </div>
                        <Button variant="ghost" size="sm" icon={Eye} onClick={() => setReceiptOrder(o)} />
                      </div>
                    </div>
                  ))}
                  <PaginationControls page={salesPage} setPage={setSalesPage} total={filteredOrders.length} pageSize={TABLE_PAGE_SIZE} />
                </div>
              ) : (
                <EmptyState icon={DollarSign} title="No transactions" description="No sales match the selected payment method or date range." />
              )}

              <Card>
                <CardHeader title="End-of-Day Reports" subtitle="Saved shift closeout reports for viewing and reprinting." />
                {endOfDayReports.length > 0 ? (
                  <div className="space-y-3">
                    {endOfDayReports.slice(0, 8).map(report => (
                      <div key={report.id} className="rounded-2xl border border-espresso/5 bg-white p-4 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-black text-espresso">{report.report_date}</p>
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${Number(report.cash_difference) === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                              Cash Diff {formatCurrency(report.cash_difference)}
                            </span>
                          </div>
                          <p className="text-xs text-espresso/55 mt-1">
                            Closed by {report.staff_name || report.closed_by_name || 'Staff'} · {report.total_transactions} transactions · Gross {formatCurrency(report.gross_sales)}
                          </p>
                        </div>
                        <Button variant="outline" size="sm" icon={Printer} onClick={() => handleReprintEndOfDayReport(report)}>
                          Reprint
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={Printer} title="No end-of-day reports" description="Close a shift from the POS page to save and print the first report." />
                )}
              </Card>
            </div>
          )}
        </main>
      </div>

      {/* Add Ingredient Modal */}
      <Modal open={productModalOpen} onClose={() => setProductModalOpen(false)} title="Add Ingredient Stock" size="3xl">
        <form onSubmit={handleCreateProduct} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label="Ingredient Name" required value={productForm.name} onChange={e => handleProductFieldChange('name', e.target.value)} />
            <Input label="Batch Number" required value={productForm.batch_number} onChange={e => handleProductFieldChange('batch_number', e.target.value)} />
            <Select
              label="Category"
              required
              value={productForm.category}
              onChange={e => handleProductFieldChange('category', e.target.value)}
              options={[{ value: '', label: 'Select category' }, ...categories.map(category => ({ value: category.id, label: category.name }))]}
            />
            <Select
              label="Supplier"
              required
              value={productForm.supplier}
              onChange={e => handleProductFieldChange('supplier', e.target.value)}
              options={[{ value: '', label: 'Select supplier' }, ...suppliers.map(supplier => ({ value: supplier.id, label: supplier.name }))]}
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
            />
            <Input label="Quantity" required type="number" min="0" value={productForm.stock_level} onChange={e => handleProductFieldChange('stock_level', e.target.value)} />
            <Input label="Minimum Stock Level" required type="number" min="0" value={productForm.reorder_point} onChange={e => handleProductFieldChange('reorder_point', e.target.value)} />
            <Input label="Maximum Stock Level" required type="number" min="0" value={productForm.maximum_stock_level} onChange={e => handleProductFieldChange('maximum_stock_level', e.target.value)} />
            <Input label="Purchase Date" required type="date" value={productForm.purchase_date} onChange={e => handleProductFieldChange('purchase_date', e.target.value)} />
            <Input label="Expiration Date" type="date" value={productForm.expiration_date} onChange={e => handleProductFieldChange('expiration_date', e.target.value)} />
            <Input label="Storage Location" required value={productForm.storage_location} onChange={e => handleProductFieldChange('storage_location', e.target.value)} />
          </div>
          <div className="sticky bottom-0 bg-white/95 flex flex-col sm:flex-row gap-2 pt-4 pb-1 border-t border-espresso/[0.06]">
            <Button type="submit" variant="primary" className="flex-1">Save Ingredient</Button>
            <Button type="button" variant="outline" onClick={() => setProductModalOpen(false)}>Cancel</Button>
          </div>
        </form>
      </Modal>

      {/* Adj Modal */}
      <Modal open={!!manualAdjIngredient} onClose={() => setManualAdjIngredient(null)} title="Adjust Ingredient Stock" size="sm">
        <p className="text-xs text-espresso/60 mb-4">
          Modify ingredient stock for <strong className="text-espresso">{manualAdjIngredient?.name}</strong>.
        </p>
        <div className="space-y-4">
          <Select
            label="Movement"
            value={adjMovementType}
            onChange={e => setAdjMovementType(e.target.value)}
            options={[
              { value: 'IN', label: 'Stock In' },
              { value: 'OUT', label: 'Stock Out' },
            ]}
          />
          <Input label="Quantity" type="number" min="0" step="0.01" value={adjQty} onChange={e => setAdjQty(e.target.value)} />
          <Select
            label="Unit"
            value={adjUnit}
            onChange={e => setAdjUnit(e.target.value)}
            options={manualAdjIngredient?.base_unit === 'G'
              ? [{ value: 'G', label: 'g' }, { value: 'KG', label: 'kg' }]
              : [{ value: 'ML', label: 'mL' }, { value: 'L', label: 'L' }]
            }
          />
          <div className="flex gap-2">
            <Button variant="primary" className="flex-1" onClick={handleAdjustInventory}>Save</Button>
            <Button variant="outline" onClick={() => setManualAdjIngredient(null)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      {/* End-of-Day Report Modal */}
      <Modal open={endOfDayModalOpen} onClose={() => !endOfDayPrinting && setEndOfDayModalOpen(false)} title="Print End-of-Day Report" size="sm">
        <div className="space-y-4">
          <p className="text-xs leading-relaxed text-espresso/60">
            Enter the actual cash counted in the drawer. The system will save the report and send it to the 58mm receipt printer.
          </p>
          <Input
            label="Report Date"
            type="date"
            value={endOfDayDate}
            onChange={e => handleEndOfDayDateChange(e.target.value)}
            disabled={endOfDayPrinting}
          />
          <Input
            label="Actual Cash Count"
            type="number"
            min="0"
            step="0.01"
            value={endOfDayActualCash}
            onChange={e => setEndOfDayActualCash(e.target.value)}
            placeholder="0.00"
            disabled={endOfDayPrinting || endOfDayCashLoading}
          />
          <div className="rounded-2xl border border-espresso/10 bg-cream/70 p-3 text-[11px] font-bold leading-relaxed text-espresso/65">
            Auto-filled expected cash: {endOfDayCashLoading ? 'Calculating...' : formatCurrency(endOfDayExpectedCash || 0)}. Edit the actual cash count if the drawer count is different.
          </div>
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[11px] font-bold leading-relaxed text-amber-800">
            Confirm before printing. This creates a permanent saved report for future viewing and reprinting.
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button variant="gold" className="flex-1" icon={Printer} onClick={handlePrintEndOfDayReport} loading={endOfDayPrinting}>
              Print Report
            </Button>
            <Button variant="outline" onClick={() => setEndOfDayModalOpen(false)} disabled={endOfDayPrinting}>
              Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {/* Receipt Modal */}
      <Modal open={!!receiptOrder} onClose={() => setReceiptOrder(null)} title="Receipt Preview" size="md">
        <div id="receipt-print-area" className="mx-auto w-[58mm] max-w-full bg-white px-1.5 py-2 font-mono text-[11px] font-black leading-tight text-black">
          <div className="text-center space-y-0.5">
            <p className="text-[13px] font-black leading-tight">CAV PHOTO STUDIO &amp; CAFE</p>
            <p className="text-[9px] font-black leading-tight">028B M.P. Casanova St., Purok 1, Tambo, Lipa City, Batangas</p>
          </div>
          <div className="flex justify-center py-1">
            <div
              aria-label="Receipt QR code preview"
              className="grid h-[72px] w-[72px] grid-cols-7 grid-rows-7 gap-[2px] border-2 border-black bg-white p-1"
            >
              {Array.from({ length: 49 }).map((_, idx) => {
                const row = Math.floor(idx / 7);
                const col = idx % 7;
                const finder = (row < 3 && col < 3) || (row < 3 && col > 3) || (row > 3 && col < 3);
                const data = ((idx + Number(receiptOrder?.id || 0)) * 17) % 5 < 2;
                return <span key={idx} className={finder || data ? 'bg-black' : 'bg-white'} />;
              })}
            </div>
          </div>
          <div className="my-1 border-t border-dashed border-black" />
          <div className="space-y-0.5 text-[10px] font-black">
            <div className="flex justify-between gap-2">
              <span>DATE</span>
              <span className="text-right">{receiptOrder?.created_at ? new Date(receiptOrder.created_at).toLocaleString() : ''}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>CASHIER</span>
              <span className="text-right">{receiptOrder?.staff_name || user?.username}</span>
            </div>
          </div>
          <div className="my-1 border-t border-dashed border-black" />
          <div className="space-y-1">
            <div className="grid grid-cols-[1fr_36px_70px] gap-1 text-[9px] font-black">
              <span>ITEM</span>
              <span className="text-right">QTY</span>
              <span className="text-right">AMOUNT</span>
            </div>
            {receiptOrder?.items?.map(item => (
              <div key={item.id} className="text-[10px] font-black">
                <div className="break-words">{item.product_details?.name || 'Item'}</div>
                <div className="grid grid-cols-[1fr_36px_70px] gap-1">
                  <span>{formatCurrency(item.price)}</span>
                  <span className="text-right">{item.quantity}</span>
                  <span className="text-right">{formatCurrency(item.subtotal)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="my-1 border-t border-dashed border-black" />
          <div className="space-y-0.5 text-[11px] font-black">
            <div className="flex justify-between gap-2 text-[13px]">
              <span>TOTAL</span>
              <span>{formatCurrency(receiptOrder?.total)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>PAID</span>
              <span>{formatCurrency(getReceiptAmountReceived(receiptOrder))}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>CHANGE</span>
              <span>{formatCurrency(getReceiptChange(receiptOrder))}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>PAYMENT</span>
              <span>{receiptOrder?.payments?.[0]?.method || 'CASH'}</span>
            </div>
            {receiptOrder?.payments?.[0]?.transaction_id && (
              <div className="flex justify-between gap-2 text-[9px]">
                <span>REF</span>
                <span className="break-all text-right">{receiptOrder.payments[0].transaction_id}</span>
              </div>
            )}
          </div>
          <div className="my-1 border-t border-dashed border-black" />
          <div className="text-center text-[9px] font-black leading-tight">
            Thank you for visiting CAV!<br />Savor the moment, cherish the photo.
          </div>
          <div className="h-14" aria-hidden="true" />
        </div>
        <div className="flex gap-3 mt-4">
          <Button variant="outline" className="flex-1" onClick={() => setReceiptOrder(null)}>Close</Button>
        </div>
      </Modal>
    </div>
  );
}
