import { formatManilaDateTime } from './dateTime';

const EXTERNAL_BRIDGE_URL = process.env.REACT_APP_LOCAL_PRINT_BRIDGE_URL || 'http://127.0.0.1:8765';
const SAME_ORIGIN_BRIDGE_URL = '/local-print';
export const LOCAL_STAFF_CONSOLE_URL = 'http://127.0.0.1:3001/staff';
const LOCAL_STAFF_CONSOLE_BRIDGE_URL = 'http://127.0.0.1:3001/local-print';

export const isLocalStaffConsole = () => (
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  && window.location.port === '3001'
);

const bridgeUrls = () => {
  const urls = [];
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    urls.push(SAME_ORIGIN_BRIDGE_URL);
    if (!isLocalStaffConsole()) urls.push(LOCAL_STAFF_CONSOLE_BRIDGE_URL);
  } else {
    urls.push(LOCAL_STAFF_CONSOLE_BRIDGE_URL);
  }
  urls.push(EXTERNAL_BRIDGE_URL);
  return [...new Set(urls)];
};

export const getLocalPrintingSetupMessage = () => {
  const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocalHost && window.location.port !== '3001') {
    return 'Local printer service not found. Open http://127.0.0.1:3001 from "Start Local Staff Console.cmd", then click Detect again.';
  }
  if (isLocalHost) {
    return 'Local printer service did not respond. Restart "Start Local Staff Console.cmd", keep the window open, then click Detect again.';
  }
  return 'Local printer service not found. Opening the local staff console. If it does not load, double-click "Start Local Staff Console.cmd" on the cashier PC.';
};

export const openLocalStaffConsole = () => {
  if (isLocalStaffConsole()) return null;
  return window.open(LOCAL_STAFF_CONSOLE_URL, 'cav-local-staff-console');
};

const money = (value) => `PHP ${Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})}`;

const amount = (value) => Number(value || 0).toLocaleString('en-PH', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const RECEIPT_WIDTH = 30;
const ITEM_QTY_WIDTH = 4;
const ITEM_UNIT_WIDTH = 10;
const ITEM_TOTAL_WIDTH = RECEIPT_WIDTH - ITEM_QTY_WIDTH - ITEM_UNIT_WIDTH;

const normalizeText = (value) => String(value || '').replace(/\s+/g, ' ').trim();

const line = (char = '-') => char.repeat(RECEIPT_WIDTH);

const wrapText = (value, width = RECEIPT_WIDTH) => {
  const text = normalizeText(value);
  if (!text) return [''];
  const words = text.split(' ');
  const rows = [];
  let current = '';
  words.forEach((word) => {
    const chunks = [];
    for (let index = 0; index < word.length; index += width) {
      chunks.push(word.slice(index, index + width));
    }
    chunks.forEach((chunk) => {
      const next = current ? `${current} ${chunk}` : chunk;
      if (next.length <= width) {
        current = next;
      } else {
        if (current) rows.push(current);
        current = chunk;
      }
    });
  });
  if (current) rows.push(current);
  return rows;
};

const fitLeft = (value, width) => normalizeText(value).padEnd(width).slice(0, width);
const fitRight = (value, width) => normalizeText(value).padStart(width).slice(-width);

const pair = (label, value) => {
  const left = normalizeText(label);
  const right = normalizeText(value);
  if (!right) return wrapText(left);
  if (left.length + 1 + right.length <= RECEIPT_WIDTH) {
    return [`${left}${' '.repeat(RECEIPT_WIDTH - left.length - right.length)}${right}`];
  }
  const rightWidth = Math.min(Math.max(right.length, 10), RECEIPT_WIDTH - 8);
  const leftWidth = RECEIPT_WIDTH - rightWidth - 1;
  const leftRows = wrapText(left, leftWidth);
  const rightRows = wrapText(right, rightWidth);
  const rows = [];
  const totalRows = Math.max(leftRows.length, rightRows.length);
  for (let index = 0; index < totalRows; index += 1) {
    rows.push(`${fitLeft(leftRows[index] || '', leftWidth)} ${fitRight(rightRows[index] || '', rightWidth)}`);
  }
  return rows;
};

const centerLine = (value) => {
  const text = normalizeText(value);
  const padding = Math.max(RECEIPT_WIDTH - text.length, 0);
  const left = Math.floor(padding / 2);
  return `${' '.repeat(left)}${text}${' '.repeat(padding - left)}`;
};

const center = (value) => wrapText(value).map(centerLine);

const itemAmountLine = (item) => (
  `${fitLeft(item.quantity, ITEM_QTY_WIDTH)}${fitRight(amount(item.price), ITEM_UNIT_WIDTH)}${fitRight(amount(item.subtotal), ITEM_TOTAL_WIDTH)}`
);

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
  const dateText = order?.created_at_display || formatManilaDateTime(order?.created_at);

  const rows = [
    ...center(business.logoText || 'CAV'),
    ...center(business.name || 'CAV PHOTO STUDIO & CAFE'),
    ...center(business.address || ''),
    ...pair('CONTACT', business.contactNumber || ''),
    line(),
    ...pair('OR NO.', order?.or_number || order?.id || ''),
    ...pair('TXN NO.', transactionNumber),
    ...pair('DATE', dateText),
    ...pair('CASHIER', order?.staff_name || user?.username || ''),
    line(),
    'ITEMIZED PRODUCTS',
    `${fitLeft('QTY', ITEM_QTY_WIDTH)}${fitRight('PRICE', ITEM_UNIT_WIDTH)}${fitRight('AMOUNT', ITEM_TOTAL_WIDTH)}`,
    line(),
  ];

  items.forEach(item => {
    const name = item.product_details?.name || 'Item';
    rows.push(...wrapText(name));
    rows.push(itemAmountLine(item));
  });

  rows.push(
    line(),
    ...pair('SUBTOTAL', money(order?.subtotal || order?.total)),
    ...pair('DISCOUNTS', money(order?.discounts ?? order?.discount_amount)),
    ...pair('GRAND TOTAL', money(order?.total)),
    ...pair('METHOD', payment.method || 'CASH'),
    ...pair('RECEIVED', money(amountReceived)),
    ...pair('CHANGE', money(change)),
    line(),
    ...center('Thank You'),
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
