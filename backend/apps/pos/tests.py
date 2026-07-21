from django.test import SimpleTestCase

from pos.receipt_printing import RECEIPT_WIDTH, _end_of_day_text, _escpos_receipt_bytes, _receipt_text


class ReceiptPrintingTests(SimpleTestCase):
    def test_receipt_text_uses_requested_pos_fields(self):
        receipt = {
            "id": 42,
            "or_number": 42,
            "transaction_number": "GCASH-123",
            "business_logo_text": "CAV",
            "business_name": "CAV PHOTO STUDIO & CAFE",
            "business_address": "028B M.P. Casanova St., Purok 1, Tambo, Lipa City, Batangas",
            "business_contact_number": "+639171234567",
            "staff_name": "cashier1",
            "created_at_display": "2026-07-15 10:30 AM",
            "total": "150.00",
            "discounts": "0.00",
            "amount_received": "200.00",
            "change_amount": "50.00",
            "items": [
                {
                    "quantity": 2,
                    "price": "75.00",
                    "subtotal": "150.00",
                    "product_details": {"name": "Iced Latte"},
                }
            ],
            "payments": [
                {"method": "GCASH", "amount": "200.00", "transaction_id": "GCASH-123"}
            ],
        }

        text = _receipt_text(receipt)

        for expected in [
            "CAV",
            "CAV PHOTO STUDIO & CAFE",
            "CONTACT NUMBER",
            "OR NO.",
            "42",
            "TRANSACTION NO.",
            "GCASH-123",
            "DATE & TIME",
            "2026-07-15 10:30 AM",
            "CASHIER",
            "cashier1",
            "ITEMIZED PRODUCTS",
            "Iced Latte",
            "DISCOUNTS",
            "GRAND TOTAL",
            "PAYMENT METHOD",
            "CASH RECEIVED",
            "CHANGE",
            "Thank You",
        ]:
            self.assertIn(expected, text)

        self.assertNotIn("Savor the moment", text)
        self.assertTrue(all(len(line) <= RECEIPT_WIDTH for line in text.splitlines()))

        raw = _escpos_receipt_bytes(receipt)
        self.assertIn(b"CAV", raw)
        self.assertNotIn(b"\x1d(k", raw)

    def test_end_of_day_text_prints_complete_z_report_fields(self):
        report = {
            "report_date": "2026-07-15",
            "closing_time_display": "09:30 PM",
            "staff_name": "cashier1",
            "opening_cash": "1000.00",
            "cash_sales": "1500.00",
            "gcash_sales": "800.00",
            "card_sales": "0.00",
            "refunds": "50.00",
            "discounts": "25.00",
            "total_transactions": 12,
            "cash_in_out": "-100.00",
            "expected_cash": "2400.00",
            "actual_cash": "2390.00",
            "cash_difference": "-10.00",
            "gross_sales": "2300.00",
            "booking_income": "800.00",
            "cafe_pos_income": "1500.00",
            "total_items_sold": 18,
            "cancelled_or_voided_transactions": 1,
        }

        text = _end_of_day_text(report)

        for expected in [
            "Z REPORT",
            "DATE & TIME",
            "2026-07-15 09:30 PM",
            "STAFF NAME",
            "cashier1",
            "OPENING CASH",
            "CASH SALES",
            "GCASH SALES",
            "CARD SALES",
            "REFUNDS",
            "DISCOUNTS",
            "TOTAL TRANSACTIONS",
            "CASH IN/OUT",
            "EXPECTED CASH",
            "ACTUAL CASH",
            "CASH DIFFERENCE",
        ]:
            self.assertIn(expected, text)
        self.assertTrue(all(len(line) <= RECEIPT_WIDTH for line in text.splitlines()))
