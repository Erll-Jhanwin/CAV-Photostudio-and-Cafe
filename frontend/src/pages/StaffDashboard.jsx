import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import {
  ShoppingBag, ClipboardList, Package, DollarSign, LogOut, Search, Plus,
  Minus, RefreshCw, Printer, AlertTriangle, Check, X, ShieldAlert
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

  const [products, setProducts] = useState([]);
  const [ingredients, setIngredients] = useState([]);
  const [categories, setCategories] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
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

  const [posSearch, setPosSearch] = useState('');
  const [invSearch, setInvSearch] = useState('');
  const [manualAdjIngredient, setManualAdjIngredient] = useState(null);
  const [adjQty, setAdjQty] = useState(0);
  const [adjUnit, setAdjUnit] = useState('ML');
  const [adjMovementType, setAdjMovementType] = useState('IN');
  const [bookingFilter, setBookingFilter] = useState('PENDING');
  const [inventoryFilter, setInventoryFilter] = useState('ALL');
  const [salesPaymentFilter, setSalesPaymentFilter] = useState('ALL');
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [productForm, setProductForm] = useState(emptyProductForm());

  useEffect(() => {
    if (!user || (user.role !== 'STAFF' && user.role !== 'ADMIN')) {
      navigate('/login');
      return;
    }
    fetchData();
  }, [user, navigate]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError('');
      try {
        await client.post('/api/inventory/recipes/generate/');
      } catch { /* keep loading dashboard even if recipe generation is already unavailable */ }
      const [productsRes, ingredientsRes, bookingsRes, ordersRes, categoriesRes, suppliersRes] = await Promise.all([
        client.get('/api/inventory/products/'),
        client.get('/api/inventory/ingredients/'),
        client.get('/api/bookings/'),
        client.get('/api/pos/orders/'),
        client.get('/api/inventory/categories/'),
        client.get('/api/inventory/suppliers/')
      ]);
      setProducts(productsRes.data);
      setIngredients(ingredientsRes.data);
      setBookings(bookingsRes.data);
      setOrders(ordersRes.data);
      setCategories(categoriesRes.data);
      setSuppliers(suppliersRes.data);
    } catch {
      setError('Failed to load dashboard data. Make sure the server is running.');
    } finally {
      setLoading(false);
    }
  };

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
    if (cart.length === 0 || checkoutLoading) return;
    const total = getCartTotal();
    const cashReceived = paymentMethod === 'CASH' ? Number(amountReceived) : total;

    if (paymentMethod === 'CASH' && (!amountReceived || cashReceived < total)) {
      alert('Amount received must be equal to or greater than the total.');
      return;
    }

    let loadingTimer;
    try {
      setCheckoutLoading(true);
      loadingTimer = setTimeout(() => setShowCheckoutLoading(true), 450);
      const payload = {
        items: cart.map(item => ({ product_id: item.id, quantity: item.quantity })),
        order_type: orderType,
        payment: { amount: cashReceived, method: paymentMethod, transaction_id: transactionId }
      };
      if (orderType === 'BOOKING_LINKED' && linkedBookingId) payload.booking_id = linkedBookingId;
      const res = await client.post('/api/pos/orders/', payload);
      setReceiptOrder({
        ...res.data,
        amount_received: cashReceived,
        change_amount: Math.max(cashReceived - total, 0),
      });
      setOrders(current => [res.data, ...current]);
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
      clearTimeout(loadingTimer);
      setCheckoutLoading(false);
      setShowCheckoutLoading(false);
    }
  };

  const handleBookingAction = async (bookingId, newStatus) => {
    try {
      await client.patch(`/api/bookings/${bookingId}/`, { status: newStatus });
      fetchData();
    } catch {
      alert('Failed to update booking.');
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

  const triggerPrintReceipt = () => {
    const printContent = document.getElementById('receipt-print-area')?.innerHTML;
    if (!printContent) return;
    const win = window.open('', '_blank');
    if (!win) { alert('Please allow pop-ups to print the receipt.'); return; }
    win.document.write(`
      <html><head><title>CAV Receipt</title>
      <style>
        body { font-family: monospace; padding: 20px; width: 300px; margin: 0 auto; font-size: 12px; }
        .center { text-align: center; } .bold { font-weight: bold; }
        .item { display: flex; justify-content: space-between; margin-bottom: 5px; }
        .total { border-top: 1px dashed #000; margin-top: 10px; padding-top: 5px; font-weight: bold; display: flex; justify-content: space-between; }
        @media print { @page { margin: 0; } }
      </style></head>
      <body>${printContent}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  };

  const handleLogout = useCallback(() => { logout(); navigate('/'); }, [logout, navigate]);

  if (loading) return <StaffSkeleton />;

  const navItems = [
    { key: 'pos', label: 'POS Terminal', icon: ShoppingBag, active: activeTab === 'pos', onClick: () => setActiveTab('pos') },
    { key: 'validator', label: 'Booking Validator', icon: ClipboardList, active: activeTab === 'validator', onClick: () => setActiveTab('validator') },
    { key: 'inventory', label: 'Live Inventory', icon: Package, active: activeTab === 'inventory', onClick: () => setActiveTab('inventory') },
    { key: 'sales', label: 'Daily Sales Logs', icon: DollarSign, active: activeTab === 'sales', onClick: () => setActiveTab('sales') },
  ];

  const pageTitles = { pos: 'POS Terminal', validator: 'Booking Validator', inventory: 'Live Inventory', sales: 'Daily Sales Logs' };
  const visibleInventory = ingredients.filter(ingredient => {
    const matchesSearch = ingredient.name.toLowerCase().includes(invSearch.toLowerCase());
    const matchesStatus = inventoryFilter === 'ALL' || ingredient.inventory_status === inventoryFilter;
    return matchesSearch && matchesStatus;
  });
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
  const filteredOrders = orders.filter(order => (
    salesPaymentFilter === 'ALL' || order.payments?.some(payment => payment.method === salesPaymentFilter)
  ));

  return (
    <div className="min-h-screen bg-cream flex flex-col md:flex-row">
      <Sidebar
        brand="CAV Terminal"
        brandSubtitle="Staff Console"
        brandIcon={ShoppingBag}
        navItems={navItems}
        user={user}
        onLogout={handleLogout}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
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
              <Button variant="outline" size="sm" icon={RefreshCw} onClick={fetchData}>Retry</Button>
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
                  <div className="flex items-center gap-2 bg-white border border-espresso/10 rounded-xl px-3 py-1.5 text-xs">
                    <span className="font-semibold text-espresso/50">Cart Type:</span>
                    <select value={orderType} onChange={e => setOrderType(e.target.value)} className="bg-transparent font-bold focus:outline-none text-espresso">
                      <option value="WALK_IN">Walk-in Customer</option>
                      <option value="BOOKING_LINKED">Link to Booking</option>
                    </select>
                  </div>
                </div>

                {orderType === 'BOOKING_LINKED' && (
                  <div className="bg-white p-4 rounded-xl border border-espresso/5 shadow-sm flex flex-col sm:flex-row items-start sm:items-center gap-3 animate-in-up">
                    <span className="text-xs font-bold text-espresso/60 uppercase shrink-0">Link Booking:</span>
                    <select value={linkedBookingId} onChange={e => setLinkedBookingId(e.target.value)} className="w-full sm:w-auto bg-cream border border-espresso/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-gold">
                      <option value="">Select a booking</option>
                      {bookings.filter(b => b.status === 'PENDING' || b.status === 'CONFIRMED').map(b => (
                        <option key={b.id} value={b.id}>#{b.id} - {b.customer?.username} ({b.package_details?.name})</option>
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
                  {products.filter(p => p.name.toLowerCase().includes(posSearch.toLowerCase())).map((prod, i) => {
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
                          {showCheckoutLoading ? 'Generating Receipt...' : `Pay PHP ${getCartTotal()}`}
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

          {/* BOOKING VALIDATOR */}
          {activeTab === 'validator' && (
            <div className="space-y-6 animate-in-up" key="validator">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">Booking Validator</h1>
                  <p className="text-xs text-espresso/50 mt-1">Verify scheduled client slots and update booking statuses.</p>
                </div>
                <div className="flex bg-white border border-espresso/10 rounded-xl p-1 text-xs">
                  {['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED'].map(st => (
                    <button key={st} onClick={() => setBookingFilter(st)}
                      className={`px-3 py-1.5 rounded-lg font-semibold transition-all ${bookingFilter === st ? 'bg-espresso text-cream shadow-sm' : 'text-espresso/50 hover:text-espresso'}`}>
                      {st}
                    </button>
                  ))}
                </div>
              </div>

              {bookings.filter(b => b.status === bookingFilter).length > 0 ? (
                <div className="space-y-4">
                  {bookings.filter(b => b.status === bookingFilter).map((b, i) => (
                    <div key={b.id} className="bg-white p-5 md:p-6 rounded-2xl border border-espresso/5 shadow-sm hover:shadow-md transition-all duration-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 animate-in-up" style={{ animationDelay: `${i * 50}ms` }}>
                      <div className="space-y-2 flex-1">
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="font-sans text-lg font-extrabold">{b.package_details?.name}</span>
                          <StatusBadge status={b.status} />
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs text-espresso/60">
                          <span>Customer: <strong className="text-espresso">{b.customer?.username || 'Anonymous'}</strong></span>
                          <span>Date: <strong className="text-espresso">{b.scheduled_date}</strong></span>
                          <span>Time: <strong className="text-espresso">{b.scheduled_time}</strong></span>
                          <span>ID: <strong className="text-espresso">#{b.id}</strong></span>
                        </div>
                        {b.notes && <p className="text-[10px] text-espresso/50 italic bg-cream p-2 rounded-lg">Notes: {b.notes}</p>}
                      </div>
                      <div className="flex gap-2 shrink-0 w-full md:w-auto">
                        {b.status === 'PENDING' && (
                          <>
                            <Button variant="primary" size="sm" icon={Check} onClick={() => handleBookingAction(b.id, 'CONFIRMED')}>Approve</Button>
                            <Button variant="outline" size="sm" icon={X} onClick={() => handleBookingAction(b.id, 'CANCELLED')} className="text-red-600 border-red-200 hover:bg-red-50">Cancel</Button>
                          </>
                        )}
                        {b.status === 'CONFIRMED' && (
                          <Button variant="success" size="sm" icon={Check} onClick={() => handleBookingAction(b.id, 'COMPLETED')}>Mark Completed</Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={ClipboardList} title={`No ${bookingFilter.toLowerCase()} bookings`} description="No bookings match the selected status filter." />
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
                      {visibleInventory.map((ingredient, i) => {
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
              </div>
            </div>
          )}

          {/* SALES LOGS */}
          {activeTab === 'sales' && (
            <div className="space-y-6 animate-in-up" key="sales">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">Daily Sales Logs</h1>
                  <p className="text-xs text-espresso/50 mt-1">Review historical transactions and print receipt vouchers.</p>
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

              {filteredOrders.length > 0 ? (
                <div className="space-y-4">
                  {filteredOrders.map((o, i) => (
                    <div key={o.id} className="bg-white p-5 rounded-2xl border border-espresso/5 shadow-sm flex justify-between items-center animate-in-up" style={{ animationDelay: `${i * 40}ms` }}>
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-sm">Order #{o.id}</span>
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
                        <Button variant="ghost" size="sm" icon={Printer} onClick={() => setReceiptOrder(o)} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState icon={DollarSign} title="No transactions" description="No sales match the selected payment method." />
              )}
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

      {/* Receipt Modal */}
      <Modal open={!!receiptOrder} onClose={() => setReceiptOrder(null)} title="Receipt Preview" size="md">
        <div id="receipt-print-area" className="bg-cream p-6 rounded-2xl border border-espresso/5 font-mono text-xs text-espresso space-y-4 max-w-sm mx-auto">
          <div className="text-center space-y-1">
            <p className="font-sans font-extrabold text-base">CAV PHOTO STUDIO &amp; CAFE</p>
            <p className="text-[9px]">028B M.P. Casanova St., Purok 1, Tambo, Lipa City, Batangas</p>
            <p className="text-[9px]">cav.photostudio.cafe@gmail.com</p>
          </div>
          <div className="border-t border-dashed border-espresso/20 pt-2 space-y-1 text-[10px]">
            <p>Order ID: #{receiptOrder?.id}</p>
            <p>Date: {receiptOrder?.created_at ? new Date(receiptOrder.created_at).toLocaleString() : ''}</p>
            <p>Server: {receiptOrder?.staff_name || user?.username}</p>
            <p>Type: {receiptOrder?.order_type}</p>
          </div>
          <div className="border-t border-dashed border-espresso/20 pt-2 space-y-1.5">
            {receiptOrder?.items?.map(item => (
              <div key={item.id} className="flex justify-between text-[10px]">
                <span>{item.product_details?.name || 'Item'} x {item.quantity}</span>
                <span>PHP {item.subtotal}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-dashed border-espresso/20 pt-2 flex justify-between font-bold text-sm">
            <span>TOTAL:</span>
            <span>PHP {receiptOrder?.total}</span>
          </div>
          <div className="border-t border-dashed border-espresso/20 pt-2 text-[10px] space-y-0.5">
            <p>Method: {receiptOrder?.payments?.[0]?.method || 'CASH'}</p>
            <p>Amount Received: PHP {getReceiptAmountReceived(receiptOrder).toFixed(2)}</p>
            <p>Change: PHP {getReceiptChange(receiptOrder).toFixed(2)}</p>
            {receiptOrder?.payments?.[0]?.transaction_id && <p>Ref: {receiptOrder.payments[0].transaction_id}</p>}
          </div>
          <div className="text-center text-[9px] pt-4 border-t border-dashed border-espresso/20">
            Thank you for visiting CAV!<br />Savor the moment, cherish the photo.
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <Button variant="primary" className="flex-1" icon={Printer} onClick={triggerPrintReceipt}>Print</Button>
          <Button variant="outline" onClick={() => setReceiptOrder(null)}>Close</Button>
        </div>
      </Modal>
    </div>
  );
}
