const EXTERNAL_BRIDGE_URL = process.env.REACT_APP_LOCAL_PRINT_BRIDGE_URL || 'http://127.0.0.1:8765';
const SAME_ORIGIN_BRIDGE_URL = '/local-print';

const bridgeUrls = () => {
  const urls = [];
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    urls.push(SAME_ORIGIN_BRIDGE_URL);
  }
  urls.push(EXTERNAL_BRIDGE_URL);
  return urls;
};

const money = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const line = (char = '-') => char.repeat(32);

const pair = (label, value) => {
  const left = String(label || '').slice(0, 16);
  const right = String(value || '');
  const spaces = Math.max(1, 32 - left.length - right.length);
  return `${left}${' '.repeat(spaces)}${right}`.slice(0, 32);
};

const center = (value) => String(value || '').slice(0, 32).padStart(Math.floor((32 + String(value || '').slice(0, 32).length) / 2)).padEnd(32);

export const getLocalPrinters = async () => {
  let lastError;
  for (const url of bridgeUrls()) {
    try {
      const response = await fetch(`${url}/printers`, { method: 'GET' });
      if (!response.ok) throw new Error('Local print bridge is not available.');
      const data = await response.json();
      return Array.isArray(data.printers) ? data.printers : [];
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Local print bridge is not available.');
};

export const buildReceiptText = (order, business, user) => {
  const payment = order?.payments?.[0] || {};
  const items = order?.items || [];
  const amountReceived = Number(payment.amount || order?.amount_received || order?.total || 0);
  const change = Number(order?.change_amount ?? Math.max(amountReceived - Number(order?.total || 0), 0));
  const transactionNumber = order?.transaction_id || order?.transaction_number || payment.transaction_id || `POS-${order?.id || ''}`;
  const dateText = order?.created_at_display || (order?.created_at ? new Date(order.created_at).toLocaleString() : '');

  const rows = [
    center(business.logoText || 'CAV'),
    center(business.name || 'CAV PHOTO STUDIO & CAFE'),
    business.address || '',
    pair('CONTACT', business.contactNumber || ''),
    line(),
    pair('OR NO.', order?.or_number || order?.id || ''),
    pair('TXN NO.', transactionNumber),
    pair('DATE', dateText),
    pair('CASHIER', order?.staff_name || user?.username || ''),
    line(),
    'ITEMIZED PRODUCTS',
    line(),
  ];

  items.forEach(item => {
    const name = item.product_details?.name || 'Item';
    rows.push(name.slice(0, 32));
    rows.push(pair(`${item.quantity} x ${money(item.price)}`, money(item.subtotal)));
  });

  rows.push(
    line(),
    pair('SUBTOTAL', money(order?.subtotal || order?.total)),
    pair('DISCOUNTS', money(order?.discounts ?? order?.discount_amount)),
    pair('GRAND TOTAL', money(order?.total)),
    pair('METHOD', payment.method || 'CASH'),
    pair('RECEIVED', money(amountReceived)),
    pair('CHANGE', money(change)),
    line(),
    center('Thank You'),
    '',
    '',
    '',
  );

  return rows.join('\n');
};

export const printLocalReceipt = async ({ order, business, user, printerName }) => {
  const content = buildReceiptText(order, business, user);
  let lastError;
  for (const url of bridgeUrls()) {
    try {
      const response = await fetch(`${url}/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerName, content }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.printed) {
        throw new Error(data.error || 'Local printer did not accept the receipt.');
      }
      return data;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Local printer did not accept the receipt.');
};
