import { buildBookingReceiptText, printLocalBookingReceipt } from './localPrinting';

const receipt = {
  bookingId: 55,
  customerName: 'Jamie Reyes',
  serviceName: 'Studio Portrait',
  packageName: 'Portrait Session',
  scheduledDate: '2026-12-01',
  scheduledTime: '09:00 AM',
  totalAmount: 1000,
  amountPaid: 500,
  currentPaymentAmount: 250,
  remainingBalance: 500,
  paymentStatus: 'Pending verification',
  paymentMethod: 'Cash',
  paymentReference: 'GC-55-REF',
};

afterEach(() => jest.restoreAllMocks());

test('thermal booking text fits the shared 32-column POS receipt width and contains all requested fields', () => {
  const content = buildBookingReceiptText(receipt, undefined, 'Staff/Admin Copy');
  expect(content).toContain('CAV PHOTO STUDIO & CAFE');
  expect(content).toContain('BOOKING RECEIPT');
  expect(content).toContain('STAFF/ADMIN COPY');
  expect(content).toContain('BOOKING REF');
  expect(content).toContain('SESSION DATE');
  expect(content).toContain('SESSION TIME');
  expect(content).toContain('TOTAL AMOUNT');
  expect(content).toContain('PAYMENT AMOUNT');
  expect(content).toContain('PAID TO DATE');
  expect(content).toContain('BALANCE DUE');
  expect(content).toContain('PAYMENT STATUS');
  expect(content).toContain('PAYMENT METHOD');
  expect(content).toContain('PAYMENT REF');
  expect(content.split('\n').every(row => row.length <= 32)).toBe(true);
});

test('local booking printing sends the selected printer and receipt copy through the POS bridge', async () => {
  const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ printed: true, printer: 'Thermal 58mm' }),
  });

  await printLocalBookingReceipt({ receipt, printerName: 'Thermal 58mm', copyLabel: 'Customer Copy' });

  const printRequest = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/print'));
  expect(printRequest).toBeDefined();
  const payload = JSON.parse(printRequest[1].body);
  expect(payload.printerName).toBe('Thermal 58mm');
  expect(payload.content).toContain('CUSTOMER COPY');
  expect(payload.content).toContain('Jamie Reyes');
  expect(payload.content).toContain('PHP');
});
