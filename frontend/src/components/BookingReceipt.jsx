import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Printer } from 'lucide-react';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { printLocalBookingReceipt, RECEIPT_BUSINESS } from '../utils/localPrinting';

const peso = value => `PHP ${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const textValue = value => String(value || '').trim() || 'Not provided';

export const bookingReceiptFromPayment = payment => {
  const details = payment?.booking_details || {};
  const totalAmount = Number(details.total_amount ?? details.package_price ?? 0);
  const amountPaid = Number(details.amount_paid ?? payment?.amount ?? 0);
  return {
    bookingId: payment?.booking || details.id,
    customerName: details.customer_name,
    customerPhone: details.customer_phone,
    customerEmail: details.customer_email,
    serviceName: details.service_name,
    packageName: details.package_name,
    scheduledDate: details.scheduled_date,
    scheduledTime: details.scheduled_time,
    totalAmount,
    amountPaid,
    remainingBalance: Number(details.remaining_balance ?? Math.max(totalAmount - amountPaid, 0)),
    paymentMethod: payment?.method_label || payment?.method,
    paymentReference: payment?.reference_number,
    transactionDate: payment?.paid_at || payment?.verified_at || payment?.created_at,
  };
};

export async function printBookingReceipt({ receipt, printerName = '', copyLabel = 'Staff/Admin Copy' } = {}) {
  if (receipt) {
    try {
      return await printLocalBookingReceipt({ receipt, printerName, copyLabel });
    } catch {
      // Fall back to the browser's thermal-sized print preview when the local bridge is unavailable.
    }
  }
  window.setTimeout(() => window.print(), 120);
  return null;
}

export function BookingReceiptDocument({ receipt, copyLabel, business = RECEIPT_BUSINESS }) {
  return (
    <article id="booking-receipt-print-area" className="booking-receipt-paper mx-auto w-[58mm] max-w-full bg-white p-2 font-mono text-[9px] font-bold leading-tight text-black" aria-label={`${copyLabel} booking receipt`}>
      <header className="space-y-1 border-b border-dashed border-black pb-2 text-center">
        <img src={business.logoUrl} alt="" className="mx-auto h-[12mm] w-[12mm] object-contain grayscale" />
        <p className="text-[10px] font-black uppercase leading-tight">{business.name}</p>
        <p className="text-[8px] font-semibold leading-tight">{business.address}</p>
        <p className="text-[8px] font-semibold">Contact: {business.contactNumber}</p>
        <p className="pt-1 text-[10px] font-black uppercase">Booking Receipt</p>
        <p className="text-[8px] font-black uppercase">{copyLabel}</p>
      </header>

      <section className="space-y-1 border-b border-dashed border-black py-2 text-[8px]">
        <ReceiptRow label="Booking reference" value={`#${textValue(receipt.bookingId)}`} />
        <ReceiptRow label="Customer" value={textValue(receipt.customerName)} />
        <ReceiptRow label="Service" value={textValue(receipt.serviceName)} />
        <ReceiptRow label="Package" value={textValue(receipt.packageName)} />
        <ReceiptRow label="Session date" value={textValue(receipt.scheduledDate)} />
        <ReceiptRow label="Session time" value={textValue(receipt.scheduledTime)} />
      </section>

      <section className="space-y-1 py-2 text-[8px]">
        <ReceiptRow label="Total amount" value={peso(receipt.totalAmount)} strong />
        <ReceiptRow label="Payment received" value={peso(receipt.amountPaid)} strong />
        <ReceiptRow label="Remaining balance" value={peso(receipt.remainingBalance)} strong />
        <ReceiptRow label="Payment method" value={textValue(receipt.paymentMethod)} />
        {receipt.paymentReference && <ReceiptRow label="Payment reference" value={textValue(receipt.paymentReference)} />}
      </section>
      <footer className="border-t border-dashed border-black pt-2 text-center text-[8px] font-semibold">Thank you</footer>
    </article>
  );
}

function ReceiptRow({ label, value, strong = false }) {
  return <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-1">
    <span className="min-w-0 break-words">{label}</span>
    <span className={`max-w-[30mm] break-words text-right ${strong ? 'font-black' : 'font-semibold'}`}>{value}</span>
  </div>;
}

export default function BookingReceiptPrintDialog({ open, receipt, onClose, printerName = '' }) {
  const [copyLabel, setCopyLabel] = useState('Staff/Admin Copy');
  const [printError, setPrintError] = useState('');
  const [printing, setPrinting] = useState(false);
  const autoPrintKeyRef = useRef(null);

  const handlePrint = useCallback(async copy => {
    setCopyLabel(copy);
    setPrintError('');
    setPrinting(true);
    try {
      const result = await printLocalBookingReceipt({ receipt, printerName, copyLabel: copy });
      if (!result?.printed) throw new Error('The local printer did not accept the receipt.');
    } catch (error) {
      setPrintError(`Local receipt printing was unavailable${error?.message ? `: ${error.message}` : ''}. Opening browser print preview.`);
      window.setTimeout(() => window.print(), 120);
    } finally {
      setPrinting(false);
    }
  }, [printerName, receipt]);

  useEffect(() => {
    if (!open || !receipt) {
      autoPrintKeyRef.current = null;
      return undefined;
    }
    const receiptKey = `${receipt.bookingId}:${receipt.paymentReference || ''}`;
    if (autoPrintKeyRef.current === receiptKey) return undefined;
    autoPrintKeyRef.current = receiptKey;
    const timer = window.setTimeout(() => { void handlePrint('Staff/Admin Copy'); }, 250);
    return () => window.clearTimeout(timer);
  }, [handlePrint, open, receipt]);

  return (
    <Modal open={open} onClose={onClose} title="Booking receipt" size="2xl" bodyClassName="bg-cream/60">
      {receipt && <div className="space-y-4">
        <div className="max-h-[65vh] overflow-y-auto rounded-xl bg-white p-3">
          <BookingReceiptDocument receipt={receipt} copyLabel={copyLabel} />
        </div>
        {printError && <p role="status" className="rounded-xl bg-amber-50 p-3 text-xs font-semibold text-amber-900">{printError}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end print:hidden">
          <Button variant="outline" onClick={onClose}>Done</Button>
          <Button variant="outline" icon={Printer} loading={printing && copyLabel === 'Customer Copy'} disabled={printing} onClick={() => void handlePrint('Customer Copy')}>Print Customer Copy</Button>
          <Button variant="gold" icon={Printer} loading={printing && copyLabel === 'Staff/Admin Copy'} disabled={printing} onClick={() => void handlePrint('Staff/Admin Copy')}>Print Your Copy</Button>
        </div>
      </div>}
    </Modal>
  );
}
