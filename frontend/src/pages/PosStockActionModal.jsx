import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Search, Trash2 } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';

const makeIdempotencyKey = () => {
  const token = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `pos-stock-action-${token}`.slice(0, 100);
};

export default function PosStockActionModal({
  open,
  actionType,
  products = [],
  loadingProducts = false,
  productError = '',
  submitting = false,
  error = '',
  initialValues = null,
  onClose,
  onRetryProducts,
  onSearchTransactions,
  onLookupTransaction,
  onSubmit,
}) {
  const [search, setSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [matchedTransactions, setMatchedTransactions] = useState([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [transactionLookupLoading, setTransactionLookupLoading] = useState(false);
  const [transactionLookupError, setTransactionLookupError] = useState('');
  const [matchedTransaction, setMatchedTransaction] = useState(null);
  const [transactionId, setTransactionId] = useState('');
  const [reason, setReason] = useState('');
  const [selectedItems, setSelectedItems] = useState([]);
  const idempotencyKeyRef = useRef('');
  const transactionRequestRef = useRef(0);
  const isRefund = actionType === 'REFUND';
  const title = isRefund ? 'Record Refund' : 'Record Wastage';

  useEffect(() => {
    if (!open) return;
    setSearch('');
    setCustomerSearch('');
    setMatchedTransactions([]);
    setSuggestionsOpen(false);
    setMatchedTransaction(null);
    setTransactionLookupError('');
    setTransactionId(initialValues?.transactionId || '');
    setReason('');
    const initialProduct = initialValues?.productId
      ? {
          id: initialValues.productId,
          name: initialValues.productName || `Product #${initialValues.productId}`,
          item_type: 'PRODUCT',
          is_active: true,
        }
      : null;
    setSelectedItems(initialProduct ? [{
      product_id: initialProduct.id,
      name: initialProduct.name,
      quantity: initialValues.quantity || 1,
      ...(actionType === 'REFUND' ? { disposition: '' } : {}),
    }] : []);
    idempotencyKeyRef.current = makeIdempotencyKey();
  }, [open, actionType, initialValues]);

  useEffect(() => {
    if (!open || !customerSearch.trim() || !onSearchTransactions) {
      return undefined;
    }
    const requestId = ++transactionRequestRef.current;
    const timeoutId = window.setTimeout(async () => {
      try {
        const rows = await onSearchTransactions(customerSearch.trim());
        if (transactionRequestRef.current !== requestId) return;
        setMatchedTransactions((rows || []).filter(row => row.payment_status === 'PAID' && row.order_type !== 'END_OF_DAY_REPORT'));
        setSuggestionsOpen(true);
      } catch {
        if (transactionRequestRef.current === requestId) setMatchedTransactions([]);
      }
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [open, customerSearch, onSearchTransactions]);

  useEffect(() => {
    if (!open || !initialValues?.transactionId || !onLookupTransaction) return undefined;
    let active = true;
    const requestId = ++transactionRequestRef.current;
    setTransactionLookupLoading(true);
    onLookupTransaction(initialValues.transactionId).then(order => {
      if (!active || transactionRequestRef.current !== requestId) return;
      if (order) {
        setMatchedTransaction(order);
        const initialProductId = Number(initialValues.productId);
        if (initialProductId) {
          const line = (order.items || []).find(item => Number(item.product) === initialProductId);
          if (line) setSelectedItems([{
            product_id: initialProductId,
            name: line.product_details?.name || initialValues.productName || `Product #${initialProductId}`,
            quantity: Math.min(Number(initialValues.quantity || 1), Math.max(Number(line.quantity || 0) - Number(line.returned_quantity || 0), 1)),
            available_quantity: Math.max(Number(line.quantity || 0) - Number(line.returned_quantity || 0), 0),
            ...(actionType === 'REFUND' ? { disposition: '' } : {}),
          }]);
        }
      } else {
        setTransactionLookupError('No completed sale matches that transaction ID. Check it and try again.');
      }
    }).catch(() => {
      if (active && transactionRequestRef.current === requestId) setTransactionLookupError('Couldn’t load this transaction. Check your connection and try again.');
    }).finally(() => {
      if (active && transactionRequestRef.current === requestId) setTransactionLookupLoading(false);
    });
    return () => { active = false; };
  }, [open, initialValues, onLookupTransaction, actionType]);

  const activeProducts = useMemo(() => products
    // /api/inventory/products/ is already restricted to PRODUCT rows. The
    // ProductSerializer intentionally omits item_type, so accept that shape.
    .filter(product => product.item_type !== 'INGREDIENT' && product.is_active !== false)
    .sort((left, right) => left.name.localeCompare(right.name)), [products]);
  const eligibleProducts = useMemo(() => {
    if (!matchedTransaction) return activeProducts;
    return (matchedTransaction.items || []).filter(line => {
      const sold = Number(line.quantity || 0);
      const used = Number(isRefund ? line.returned_quantity || 0 : line.wasted_quantity || 0);
      return sold > used;
    }).map(line => ({
      id: Number(line.product),
      name: line.product_details?.name || `Product #${line.product}`,
      is_active: true,
      available_quantity: Math.max(Number(line.quantity || 0) - Number(isRefund ? line.returned_quantity || 0 : line.wasted_quantity || 0), 0),
    }));
  }, [activeProducts, matchedTransaction, isRefund]);
  const filteredProducts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query || matchedTransaction) return eligibleProducts;
    return eligibleProducts.filter(product => `${product.name} ${product.sku || ''}`.toLocaleLowerCase().includes(query));
  }, [eligibleProducts, matchedTransaction, search]);
  const canSubmit = Boolean(
    matchedTransaction
    && transactionId.trim()
    && reason.trim()
    && selectedItems.length
    && selectedItems.every(item => Number.isInteger(Number(item.quantity)) && Number(item.quantity) > 0
      && (!isRefund || ['WASTED', 'RESTOCKED'].includes(item.disposition))
      && (item.available_quantity == null || Number(item.quantity) <= Number(item.available_quantity)))
    && !submitting,
  );

  const addProduct = (product) => {
    setSelectedItems(current => {
      const existing = current.find(item => item.product_id === product.id);
      if (existing) return current.map(item => item.product_id === product.id ? { ...item, quantity: Number(item.quantity) + 1 } : item);
      return [...current, {
        product_id: product.id,
        name: product.name,
        quantity: 1,
        available_quantity: product.available_quantity,
        ...(isRefund ? { disposition: '' } : {}),
      }];
    });
  };

  const updateQuantity = (productId, quantity) => {
    if (!/^\d*$/.test(String(quantity))) return;
    setSelectedItems(current => current.map(item => item.product_id === productId ? { ...item, quantity } : item));
  };

  const clearMatchedTransaction = () => {
    transactionRequestRef.current += 1;
    setMatchedTransaction(null);
    setSelectedItems([]);
    setTransactionLookupError('');
    setTransactionLookupLoading(false);
  };

  const loadTransaction = async (order = null) => {
    const id = String(order?.transaction_id || transactionId).trim();
    if (!id || !onLookupTransaction) return;
    const requestId = ++transactionRequestRef.current;
    setTransactionLookupLoading(true);
    setTransactionLookupError('');
    setMatchedTransaction(null);
    setSelectedItems([]);
    try {
      const loadedOrder = order || await onLookupTransaction(id);
      if (transactionRequestRef.current !== requestId) return;
      if (!loadedOrder || loadedOrder.payment_status !== 'PAID') {
        setTransactionLookupError('No completed sale matches that transaction ID. Check it and try again.');
        return;
      }
      setTransactionId(loadedOrder.transaction_id || id);
      setMatchedTransaction(loadedOrder);
      setSuggestionsOpen(false);
      const eligibleLines = (loadedOrder.items || []).filter(line => Number(line.quantity || 0) > Number(isRefund ? line.returned_quantity || 0 : line.wasted_quantity || 0));
      setTransactionLookupError(eligibleLines.length ? '' : `This sale has no eligible items for ${isRefund ? 'a refund' : 'wastage'}.`);
    } catch {
      if (transactionRequestRef.current === requestId) setTransactionLookupError('Couldn’t load this transaction. Check your connection and try again.');
    } finally {
      if (transactionRequestRef.current === requestId) setTransactionLookupLoading(false);
    }
  };

  const selectTransaction = (order) => {
    transactionRequestRef.current += 1;
    setTransactionId(order.transaction_id || '');
    setMatchedTransactions([]);
    setSuggestionsOpen(false);
    setMatchedTransaction(null);
    setSelectedItems([]);
    void loadTransaction(order);
  };

  const submit = (event) => {
    event.preventDefault();
    if (!canSubmit || submitting) return;
    onSubmit?.({
      action_type: actionType,
      transaction_id: transactionId.trim(),
      reason: reason.trim(),
      idempotency_key: idempotencyKeyRef.current,
      items: selectedItems.map(({ product_id, quantity, disposition }) => ({
        product_id,
        quantity: Number(quantity),
        ...(isRefund ? { disposition } : {}),
      })),
    });
  };

  if (!actionType) return null;

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose?.()}
      title={title}
      size="2xl"
      bodyClassName="max-h-[calc(100vh-9rem)]"
    >
      <form onSubmit={submit} className="space-y-4">
        <label className="block text-xs font-bold text-espresso/70">
          Customer name
          <div className="relative mt-1.5">
            <input
              aria-label="Search transactions by customer name"
              role="combobox"
              aria-autocomplete="list"
              aria-controls="pos-customer-transaction-list"
              aria-expanded={suggestionsOpen && matchedTransactions.length > 0}
              value={customerSearch}
              onChange={event => {
                setCustomerSearch(event.target.value);
                setSearch('');
                setTransactionId('');
                setMatchedTransactions([]);
                setSuggestionsOpen(false);
                clearMatchedTransaction();
              }}
              onFocus={() => matchedTransactions.length > 0 && setSuggestionsOpen(true)}
              placeholder="Type a customer name to find a sale"
              className="w-full rounded-xl border border-espresso/10 bg-white px-3 py-2.5 text-sm font-normal text-espresso outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
            {suggestionsOpen && matchedTransactions.length > 0 && (
              <div id="pos-customer-transaction-list" role="listbox" aria-label="Matching customer transactions" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-espresso/10 bg-white p-1.5 shadow-xl">
                {matchedTransactions.map(order => (
                  <button key={order.transaction_id || order.id} type="button" role="option" aria-selected="false" onClick={() => selectTransaction(order)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-cream focus:bg-cream focus:outline-none focus:ring-2 focus:ring-gold/30">
                    <span className="block truncate text-xs font-bold text-espresso">{order.customer_name || 'Walk-in Customer'}</span>
                    <span className="mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-espresso/55"><span>{order.transaction_id || `Order #${order.id}`}</span><span>{formatOrderDate(order.completed_at || order.created_at)}</span><span>₱{Number(order.total || 0).toFixed(2)}</span></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </label>

        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block text-xs font-bold text-espresso/70">
            Transaction ID <span className="text-red-600">*</span>
            <input
              aria-label="Transaction ID"
              required
              value={transactionId}
              onChange={event => {
                setTransactionId(event.target.value);
                clearMatchedTransaction();
              }}
              placeholder="Enter the completed sale transaction ID"
              className="mt-1.5 w-full rounded-xl border border-espresso/10 bg-white px-3 py-2.5 text-sm font-normal text-espresso outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </label>
          <Button type="button" variant="outline" className="sm:mb-0.5" onClick={() => void loadTransaction()} disabled={!transactionId.trim() || transactionLookupLoading || !onLookupTransaction} loading={transactionLookupLoading}>
            Load sale items
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold text-espresso/70">
            Reason <span className="text-red-600">*</span>
            <input
              aria-label="Reason"
              required
              maxLength={300}
              value={reason}
              onChange={event => setReason(event.target.value)}
              placeholder={isRefund ? 'Why is this item being refunded?' : 'Why was this item wasted?'}
              className="mt-1.5 w-full rounded-xl border border-espresso/10 bg-white px-3 py-2.5 text-sm font-normal text-espresso outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </label>
        </div>

        {transactionLookupError && <p role="status" className="-mt-2 text-xs text-amber-800">{transactionLookupError}</p>}
        {matchedTransaction && <p role="status" className="-mt-2 text-xs text-espresso/55">Eligible products from {matchedTransaction.transaction_id} are loaded below.</p>}
        {transactionLookupLoading && <p role="status" className="-mt-2 text-xs text-espresso/55">Loading transaction…</p>}

        <div>
          <label htmlFor="pos-stock-product-search" className="mb-1.5 block text-xs font-bold text-espresso/70">Find a product</label>
          <div className="relative">
            <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-espresso/35" />
            <input
              id="pos-stock-product-search"
              aria-label="Search products"
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search all products by name or SKU..."
              className="w-full rounded-xl border border-espresso/10 bg-white py-2.5 pl-9 pr-3 text-sm text-espresso outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>
          <div className="mt-2 max-h-36 space-y-1 overflow-y-auto rounded-xl border border-espresso/5 bg-cream/50 p-1.5" aria-label="Available products">
            {loadingProducts ? <p role="status" className="px-3 py-4 text-center text-xs text-espresso/50">Loading product list…</p>
              : filteredProducts.length ? filteredProducts.map(product => (
              <button
                key={product.id}
                type="button"
                onClick={() => addProduct(product)}
                className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-espresso hover:bg-white focus:bg-white focus:outline-none focus:ring-2 focus:ring-gold/30"
              >
                <span className="font-semibold">{product.name}</span>
                <span className="ml-2 flex shrink-0 items-center gap-1 text-xs font-bold text-gold-dark"><Plus aria-hidden="true" className="h-3.5 w-3.5" />Add{product.available_quantity ? ` · ${product.available_quantity}` : ''}</span>
              </button>
            )) : productError && activeProducts.length === 0 ? <div className="px-3 py-3 text-center text-xs text-red-700"><p role="alert">{productError}</p><Button type="button" size="xs" variant="outline" className="mt-2" onClick={onRetryProducts}>Retry product list</Button></div>
              : <p className="px-3 py-4 text-center text-xs text-espresso/50">{activeProducts.length ? 'No matching products.' : 'No active products are available.'}</p>}
          </div>
          {!loadingProducts && productError && filteredProducts.length > 0 && <p role="status" className="mt-1 text-[11px] text-amber-800">{productError}</p>}
        </div>

        <section aria-label="Selected products" className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-black uppercase tracking-wide text-espresso/60">{isRefund ? 'Refund items' : 'Wastage items'}</h3>
            <span className="text-[11px] text-espresso/45">{selectedItems.length} selected</span>
          </div>
          {selectedItems.length ? selectedItems.map(item => (
            <div key={item.product_id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl bg-cream px-3 py-2.5 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
              <span className="truncate text-sm font-bold text-espresso">{item.name}</span>
              {isRefund && (
                <select
                  aria-label={`${item.name} restock disposition`}
                  value={item.disposition}
                  onChange={event => setSelectedItems(current => current.map(row => row.product_id === item.product_id ? { ...row, disposition: event.target.value } : row))}
                  className="col-span-3 rounded-lg border border-espresso/10 bg-white px-2 py-1.5 text-xs text-espresso sm:col-span-1"
                >
                  <option value="">Choose stock disposition</option>
                  <option value="WASTED">Not restocked</option>
                  <option value="RESTOCKED">Restock to inventory</option>
                </select>
              )}
              <div className="flex items-center gap-1">
                <button type="button" aria-label={`Decrease ${item.name} quantity`} disabled={Number(item.quantity) <= 1} onClick={() => updateQuantity(item.product_id, Number(item.quantity) - 1)} className="rounded-md border border-espresso/10 bg-white p-1.5 text-espresso disabled:opacity-35"><Minus aria-hidden="true" className="h-3 w-3" /></button>
                <input
                  aria-label={`${item.name} quantity`}
                  type="number"
                  min="1"
                  max={eligibleProducts.find(product => product.id === item.product_id)?.available_quantity}
                  step="1"
                  value={item.quantity}
                  onChange={event => updateQuantity(item.product_id, event.target.value)}
                  className="w-14 rounded-md border border-espresso/10 bg-white px-1 py-1.5 text-center text-sm font-bold text-espresso"
                />
                <button type="button" aria-label={`Increase ${item.name} quantity`} onClick={() => updateQuantity(item.product_id, Number(item.quantity || 0) + 1)} className="rounded-md border border-espresso/10 bg-white p-1.5 text-espresso"><Plus aria-hidden="true" className="h-3 w-3" /></button>
              </div>
              <button type="button" aria-label={`Remove ${item.name}`} onClick={() => setSelectedItems(current => current.filter(row => row.product_id !== item.product_id))} className="rounded-md p-1.5 text-red-600 hover:bg-red-50"><Trash2 aria-hidden="true" className="h-4 w-4" /></button>
            </div>
          )) : <p className="rounded-xl border border-dashed border-espresso/15 px-3 py-4 text-center text-xs text-espresso/50">Search above and add the products to record.</p>}
        </section>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex flex-col-reverse gap-2 border-t border-espresso/[0.06] pt-4 sm:flex-row">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" variant={isRefund ? 'primary' : 'gold'} className="flex-1" loading={submitting} disabled={!canSubmit}>
            {isRefund ? 'Confirm Refund' : 'Confirm Wastage'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function formatOrderDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}
