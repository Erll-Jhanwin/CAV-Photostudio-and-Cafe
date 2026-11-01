import React, { useEffect } from 'react';
import { Printer } from 'lucide-react';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { formatManilaDateTime } from '../utils/dateTime';

const peso = value => `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const textValue = value => String(value || '').trim() || 'Not provided';

export const bookingReceiptFromPayment = payment => {
  const details = payment?.booking_details || {};
  const totalAmount = Number(details.total_amount ?? details.package_price ?? 0);
  const amountPaid = Number(payment?.amount || 0);
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

export function printBookingReceipt() {
  window.setTimeout(() => window.print(), 120);
}

export function BookingReceiptDocument({ receipt, copyLabel }) {
  return (
    <article id="booking-receipt-print-area" className="booking-receipt-paper mx-auto w-full max-w-xl rounded-xl border border-espresso/10 bg-white p-5 text-espresso shadow-sm sm:p-7" aria-label={`${copyLabel} booking receipt`}>
      <header className="border-b-2 border-espresso pb-4 text-center">
        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-gold-dark">CAV Photo Studio &amp; Cafe</p>
        <h2 className="mt-2 text-xl font-black tracking-wide">BOOKING RECEIPT</h2>
        <p className="mt-2 inline-flex rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-espresso">{copyLabel}</p>
      </header>

      <section className="space-y-2 border-b border-dashed border-espresso/25 py-4 text-xs">
        <ReceiptRow label="Booking reference" value={`#${textValue(receipt.bookingId)}`} strong />
        {receipt.paymentReference && <ReceiptRow label="Payment reference" value={receipt.paymentReference} />}
        <ReceiptRow label="Transaction date" value={formatManilaDateTime(receipt.transactionDate)} />
      </section>

      <section className="space-y-2 border-b border-dashed border-espresso/25 py-4 text-xs">
        <h3 className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-espresso/55">Customer</h3>
        <ReceiptRow label="Name" value={textValue(receipt.customerName)} strong />
        <ReceiptRow label="Phone" value={textValue(receipt.customerPhone)} />
        <ReceiptRow label="Email" value={textValue(receipt.customerEmail)} />
      </section>

      <section className="space-y-2 border-b border-dashed border-espresso/25 py-4 text-xs">
        <h3 className="mb-3 text-[10px] font-black uppercase tracking-[0.16em] text-espresso/55">Session</h3>
        <ReceiptRow label="Service" value={textValue(receipt.serviceName)} strong />
        <ReceiptRow label="Package" value={textValue(receipt.packageName)} />
        <ReceiptRow label="Schedule" value={`${textValue(receipt.scheduledDate)} · ${textValue(receipt.scheduledTime)}`} />
      </section>

      <section className="space-y-2 py-4 text-xs">
        <ReceiptRow label="Total amount" value={peso(receipt.totalAmount)} strong />
        <ReceiptRow label="Amount paid" value={peso(receipt.amountPaid)} />
        <ReceiptRow label="Remaining balance" value={peso(receipt.remainingBalance)} strong />
        <ReceiptRow label="Payment method" value={textValue(receipt.paymentMethod)} />
      </section>
      <footer className="border-t-2 border-espresso pt-3 text-center text-[10px] font-semibold text-espresso/60">Thank you. Please keep this receipt for your records.</footer>
    </article>
  );
}

function ReceiptRow({ label, value, strong = false }) {
  return <div className="flex items-start justify-between gap-4">
    <span className="shrink-0 text-espresso/55">{label}</span>
    <span className={`min-w-0 break-words text-right ${strong ? 'font-black text-espresso' : 'font-semibold text-espresso/80'}`}>{value}</span>
  </div>;
}

export default function BookingReceiptPrintDialog({ open, receipt, onClose }) {
  useEffect(() => {
    if (!open || !receipt) return undefined;
    const timer = window.setTimeout(() => window.print(), 250);
    return () => window.clearTimeout(timer);
  }, [open, receipt]);

  return (
    <Modal open={open} onClose={onClose} title="Booking receipt" size="2xl" bodyClassName="bg-cream/60">
      {receipt && <div className="space-y-4">
        <BookingReceiptDocument receipt={receipt} copyLabel="Staff/Admin Copy" />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end print:hidden">
          <Button variant="outline" onClick={onClose}>Done</Button>
          <Button variant="gold" icon={Printer} onClick={printBookingReceipt}>Print again</Button>
        </div>
      </div>}
    </Modal>
  );
}
