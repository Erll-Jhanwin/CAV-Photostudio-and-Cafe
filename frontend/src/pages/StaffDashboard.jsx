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
import { Badge, StatusBadge } from '../components/ui/Badge';
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

export default function StaffDashboard() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('pos');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [products, setProducts] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [cart, setCart] = useState([]);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [transactionId, setTransactionId] = useState('');
  const [orderType, setOrderType] = useState('WALK_IN');
  const [linkedBookingId, setLinkedBookingId] = useState('');
  const [receiptOrder, setReceiptOrder] = useState(null);

  const [posSearch, setPosSearch] = useState('');
  const [invSearch, setInvSearch] = useState('');
  const [manualAdjProduct, setManualAdjProduct] = useState(null);
  const [adjQty, setAdjQty] = useState(0);
  const [bookingFilter, setBookingFilter] = useState('PENDING');

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
      const [productsRes, bookingsRes, ordersRes] = await Promise.all([
        client.get('/api/inventory/products/'),
        client.get('/api/bookings/'),
        client.get('/api/pos/orders/')
      ]);
      setProducts(productsRes.data);
      setBookings(bookingsRes.data);
      setOrders(ordersRes.data);
    } catch {
      setError('Failed to load dashboard data. Make sure the server is running.');
    } finally {
      setLoading(false);
    }
  };

  const addToCart = (product) => {
    const existing = cart.find(item => item.id === product.id);
    if (existing) {
      if (existing.quantity >= product.stock_level && product.is_cafe_item) { alert('Insufficient stock.'); return; }
      setCart(cart.map(item => item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item));
    } else {
      if (product.stock_level <= 0 && product.is_cafe_item) { alert('Out of stock.'); return; }
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
      if (delta > 0 && item.quantity >= prod?.stock_level && prod?.is_cafe_item) { alert('Insufficient stock.'); return; }
      setCart(cart.map(i => i.id === id ? { ...i, quantity: i.quantity + delta } : i));
    }
  };

  const getCartTotal = () => cart.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    try {
      const payload = {
        items: cart.map(item => ({ product_id: item.id, quantity: item.quantity })),
        order_type: orderType,
        payment: { amount: getCartTotal(), method: paymentMethod, transaction_id: transactionId }
      };
      if (orderType === 'BOOKING_LINKED' && linkedBookingId) payload.booking_id = linkedBookingId;
      const res = await client.post('/api/pos/orders/', payload);
      setReceiptOrder(res.data);
      setCart([]);
      setTransactionId('');
      setLinkedBookingId('');
      setOrderType('WALK_IN');
      fetchData();
    } catch (err) {
      alert(err.response?.data?.detail || 'Checkout failed.');
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
    if (!manualAdjProduct) return;
    try {
      await client.patch(`/api/inventory/products/${manualAdjProduct.id}/`, { stock_level: adjQty });
      setManualAdjProduct(null);
      fetchData();
    } catch {
      alert('Adjustment failed.');
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
                  {products.filter(p => p.name.toLowerCase().includes(posSearch.toLowerCase())).map((prod, i) => (
                    <button
                      key={prod.id}
                      onClick={() => addToCart(prod)}
                      className={`bg-white rounded-2xl border border-espresso/5 shadow-sm text-left flex flex-col overflow-hidden hover:shadow-md hover:-translate-y-0.5 transition-all duration-200 group relative ${prod.stock_level <= 0 && prod.is_cafe_item ? 'opacity-50 cursor-not-allowed' : ''} animate-in-up`}
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
                        {prod.stock_level <= 0 && prod.is_cafe_item && (
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
                          {prod.stock_level <= prod.reorder_point && prod.is_cafe_item && prod.stock_level > 0 && (
                            <span className="text-red-500 font-bold flex items-center gap-0.5 text-[9px]"><AlertTriangle className="w-2.5 h-2.5" />Low</span>
                          )}
                          {!prod.is_cafe_item && (
                            <span className="text-[9px] text-espresso/40">Unlimited</span>
                          )}
                        </div>
                      </div>
                    </button>
                  ))}
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
                          <div className="grid grid-cols-3 gap-1.5">
                            {['CASH', 'GCASH', 'CARD'].map(m => (
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

                        <Button variant="gold" size="lg" className="w-full" onClick={handleCheckout}>
                          Pay PHP {getCartTotal()}
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
                  <p className="text-xs text-espresso/50 mt-1">Track active stocks and trigger manual adjustments.</p>
                </div>
                <div className="w-full sm:w-64">
                  <label htmlFor="inv-search" className="block text-xs font-semibold text-espresso mb-1.5">Search inventory</label>
                  <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-espresso/30" />
                    <input
                      id="inv-search"
                      type="text"
                      value={invSearch}
                      onChange={e => setInvSearch(e.target.value)}
                      placeholder="Search products..."
                      className="w-full bg-white border border-espresso/10 rounded-xl py-2.5 pl-10 pr-4 text-xs focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/20 transition-all"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-espresso/5 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-cream border-b border-espresso/5 text-espresso/50 font-bold uppercase tracking-wider">
                        <th className="p-4 text-left">SKU</th>
                        <th className="p-4 text-left">Product</th>
                        <th className="p-4 text-left">Category</th>
                        <th className="p-4 text-center">Stock</th>
                        <th className="p-4 text-center">Reorder</th>
                        <th className="p-4 text-left">Supplier</th>
                        <th className="p-4 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.filter(p => p.name.toLowerCase().includes(invSearch.toLowerCase())).map((p, i) => (
                        <tr key={p.id} className="border-b border-espresso/5 hover:bg-espresso/[0.02] transition-colors animate-in-up" style={{ animationDelay: `${i * 20}ms` }}>
                          <td className="p-4 font-mono text-espresso/50">{p.sku || 'N/A'}</td>
                          <td className="p-4 font-semibold text-espresso">{p.name}</td>
                          <td className="p-4 text-espresso/60">{p.category_details?.name || '-'}</td>
                          <td className="p-4 text-center">
                            <span className={`font-bold ${p.stock_level <= p.reorder_point && p.is_cafe_item ? 'text-red-600' : ''}`}>
                              {p.is_cafe_item ? p.stock_level : 'Unlimited'}
                            </span>
                          </td>
                          <td className="p-4 text-center text-espresso/50">{p.is_cafe_item ? p.reorder_point : 'N/A'}</td>
                          <td className="p-4 text-espresso/60">{p.supplier_details?.name || 'N/A'}</td>
                          <td className="p-4 text-right">
                            {p.is_cafe_item && (
                              <Button variant="ghost" size="xs" onClick={() => { setManualAdjProduct(p); setAdjQty(p.stock_level); }}>Adjust</Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* SALES LOGS */}
          {activeTab === 'sales' && (
            <div className="space-y-6 animate-in-up" key="sales">
              <div>
                <h1 className="font-sans text-2xl md:text-3xl font-extrabold text-espresso">Daily Sales Logs</h1>
                <p className="text-xs text-espresso/50 mt-1">Review historical transactions and print receipt vouchers.</p>
              </div>

              {orders.length > 0 ? (
                <div className="space-y-4">
                  {orders.map((o, i) => (
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
                <EmptyState icon={DollarSign} title="No transactions" description="Process your first POS transaction to see it here." />
              )}
            </div>
          )}
        </main>
      </div>

      {/* Adj Modal */}
      <Modal open={!!manualAdjProduct} onClose={() => setManualAdjProduct(null)} title="Adjust Stock Level" size="sm">
        <p className="text-xs text-espresso/60 mb-4">
          Modify inventory count for <strong className="text-espresso">{manualAdjProduct?.name}</strong>.
        </p>
        <div className="space-y-4">
          <Input label="New Stock Count" type="number" value={adjQty} onChange={e => setAdjQty(parseInt(e.target.value) || 0)} />
          <div className="flex gap-2">
            <Button variant="primary" className="flex-1" onClick={handleAdjustInventory}>Save</Button>
            <Button variant="outline" onClick={() => setManualAdjProduct(null)}>Cancel</Button>
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
