from datetime import date
from decimal import Decimal
import json

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from inventory.models import InventoryEvent, Product
from payment.models import Payment
from pos.models import Order, POSStockAction
from pos.receipt_printing import RECEIPT_WIDTH, _end_of_day_text, _escpos_receipt_bytes, _receipt_text
from pos.views import json_safe_report_data


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


class EndOfDayReportDataTests(SimpleTestCase):
    def test_closeout_data_is_safe_for_json_storage(self):
        report = {
            'report_date': date(2026, 7, 22),
            'closing_time': timezone.now(),
            'gross_sales': Decimal('1250.50'),
            'best_selling_items': [{'name': 'Latte', 'total': Decimal('1250.50')}],
        }

        stored_data = json_safe_report_data(report)

        self.assertEqual(stored_data['report_date'], '2026-07-22')
        self.assertEqual(stored_data['gross_sales'], '1250.50')
        self.assertEqual(stored_data['best_selling_items'][0]['total'], '1250.50')
        json.dumps(stored_data)

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


class EndOfDayReportDetailsApiTests(TestCase):
    def setUp(self):
        self.admin = get_user_model().objects.create_user(
            username='closeout-admin',
            email='closeout-admin@example.com',
            password='Admin123!pass',
            role='ADMIN',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)
        self.order = Order.objects.create(
            staff=self.admin,
            subtotal=Decimal('200.00'),
            discount_type='FIXED',
            discount_value=Decimal('20.00'),
            discount_amount=Decimal('20.00'),
            total=Decimal('180.00'),
            transaction_id='CLOSEOUT-TXN-001',
            payment_status='PAID',
            order_type='WALK_IN',
            line_items=[{
                'id': 7,
                'quantity': 2,
                'returned_quantity': 0,
                'price': '100.00',
                'subtotal': '200.00',
                'discount_amount': '20.00',
                'net_subtotal': '180.00',
                'product_details': {'name': 'Closeout Test Latte'},
            }],
        )
        Payment.objects.create(
            payment_type=Payment.POS,
            order=self.order,
            amount=Decimal('180.00'),
            method='CASH',
            transaction_id='CLOSEOUT-PAY-001',
            status='PAID',
            paid_at=timezone.now(),
        )

    def test_saved_report_persists_transaction_item_payment_and_print_history_details(self):
        response = self.client.post('/api/pos/end-of-day-reports/', {
            'report_date': timezone.localdate().isoformat(),
            'opening_cash': '100.00',
            'cash_in_out': '0.00',
            'actual_cash': '280.00',
            'print_report': False,
        }, format='json')

        self.assertEqual(response.status_code, 201, response.data)
        report_id = response.data['id']
        transaction = response.data['transactions'][0]
        self.assertIn('CLOSEOUT-TXN-001', response.data['transaction_ids'])
        self.assertIn('CLOSEOUT-PAY-001', response.data['transaction_ids'])
        self.assertEqual(transaction['items'][0]['name'], 'Closeout Test Latte')
        self.assertEqual(transaction['items'][0]['quantity'], 2)
        self.assertEqual(transaction['items'][0]['price'], '100.00')
        self.assertEqual(transaction['discount_amount'], '20.00')
        self.assertEqual(transaction['payments'][0]['method'], 'CASH')
        self.assertEqual(response.data['expected_cash'], '280.00')
        self.assertEqual(response.data['cash_difference'], '0.00')
        self.assertEqual(response.data['print_history'][0]['event'], 'created')
        self.assertEqual(response.data['transaction_snapshot_version'], 1)

        stored_report = Order.objects.get(pk=report_id)
        self.assertEqual(stored_report.report_data['transactions'][0]['transaction_id'], 'CLOSEOUT-TXN-001')

        legacy_data = dict(stored_report.report_data)
        legacy_data.pop('transactions')
        legacy_data.pop('transaction_ids')
        legacy_data.pop('transaction_snapshot_version')
        legacy_report = Order.objects.create(
            staff=self.admin,
            order_type='END_OF_DAY_REPORT',
            report_data=legacy_data,
        )
        detail = self.client.get(f'/api/pos/end-of-day-reports/{legacy_report.id}/')
        self.assertEqual(detail.status_code, 200, detail.data)
        self.assertTrue(detail.data['transactions_reconstructed'])
        self.assertEqual(detail.data['transactions'][0]['items'][0]['name'], 'Closeout Test Latte')
        self.assertIn('CLOSEOUT-PAY-001', detail.data['transaction_ids'])

        marked = self.client.post(f'/api/pos/end-of-day-reports/{report_id}/mark-printed/', {
            'printer': 'Cashier Receipt Printer',
        }, format='json')
        self.assertEqual(marked.status_code, 200, marked.data)
        self.assertEqual(len(marked.data['print_history']), 2)
        self.assertEqual(marked.data['print_history'][-1]['printer'], 'Cashier Receipt Printer')

        failed_print = self.client.post(f'/api/pos/end-of-day-reports/{report_id}/mark-printed/', {
            'printer': 'Cashier Receipt Printer',
            'printed': False,
            'error': 'Printer is offline.',
        }, format='json')
        self.assertEqual(failed_print.status_code, 200, failed_print.data)
        self.assertEqual(len(failed_print.data['print_history']), 3)
        self.assertFalse(failed_print.data['print_history'][-1]['printed'])
        self.assertEqual(failed_print.data['print_history'][-1]['error'], 'Printer is offline.')
        self.assertEqual(failed_print.data['print_status']['printed'], False)


class PosIdempotencyTests(TestCase):
    def setUp(self):
        self.staff = get_user_model().objects.create_user(
            username='pos-staff',
            email='pos-staff@example.com',
            password='Staff123!pass',
            role='STAFF',
        )
        self.product = Product.objects.create(
            name='Idempotent Latte',
            sku='IDEMPOTENT-LATTE',
            item_type=Product.PRODUCT,
            price=Decimal('125.00'),
            stock_level=5,
            reorder_point=1,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.staff)

    def test_repeated_checkout_returns_the_original_order_without_double_deducting_stock(self):
        payload = {
            'items': [{'product_id': self.product.id, 'quantity': 2}],
            'order_type': 'WALK_IN',
            'payment': {'amount': '250.00', 'method': 'CASH'},
            'idempotency_key': 'pos-idempotency-test-1',
        }

        first = self.client.post('/api/pos/orders/', payload, format='json')
        second = self.client.post('/api/pos/orders/', payload, format='json')

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data['id'], second.data['id'])
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(Payment.objects.filter(payment_type=Payment.POS).count(), 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_level, 3)

    def test_item_discount_and_order_discount_are_recorded_separately_in_total(self):
        response = self.client.post('/api/pos/orders/', {
            'items': [{'product_id': self.product.id, 'quantity': 2, 'discount': {'type': 'PERCENT', 'value': 10}}],
            'discount': {'type': 'PERCENT', 'value': 10},
            'payment': {'amount': '202.50', 'method': 'CASH'},
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        order = Order.objects.get(pk=response.data['id'])
        self.assertEqual(order.subtotal, Decimal('250.00'))
        self.assertEqual(order.discount_amount, Decimal('47.50'))
        self.assertEqual(order.total, Decimal('202.50'))
        self.assertEqual(order.line_items[0]['discount_amount'], '47.50')
        self.assertEqual(order.line_items[0]['net_subtotal'], '202.50')

    def test_wasted_return_changes_sold_revenue_but_does_not_restore_stock(self):
        created = self.client.post('/api/pos/orders/', {
            'items': [{'product_id': self.product.id, 'quantity': 3}],
            'payment': {'amount': '375.00', 'method': 'CASH'},
        }, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        order_id = created.data['id']
        returned = self.client.post(f'/api/pos/orders/{order_id}/returns/', {
            'product_id': self.product.id, 'quantity': 1, 'disposition': 'WASTED',
        }, format='json')
        self.assertEqual(returned.status_code, 200, returned.data)
        self.assertEqual(returned.data['returned_amount'], '125.00')
        self.assertEqual(returned.data['items'][0]['returned_quantity'], 1)
        self.assertEqual(returned.data['items'][0]['wasted_quantity'], 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_level, 2)

        inventory = self.client.get('/api/inventory/product-sales/')
        row = next(item for item in inventory.data if item['product_id'] == self.product.id)
        self.assertEqual(row['beginning_stock'], 5)
        self.assertEqual(row['quantity_sold'], 2)
        self.assertEqual(row['wastage'], 1)
        self.assertEqual(row['ending_stock'], 2)
        self.assertEqual(row['revenue'], '250.00')

        too_many = self.client.post(f'/api/pos/orders/{order_id}/returns/', {
            'product_id': self.product.id, 'quantity': 3, 'disposition': 'WASTED',
        }, format='json')
        self.assertEqual(too_many.status_code, 400)

    def test_restocked_return_restores_stock_without_double_counting_the_ending_stock(self):
        created = self.client.post('/api/pos/orders/', {
            'items': [{'product_id': self.product.id, 'quantity': 3}],
            'payment': {'amount': '375.00', 'method': 'CASH'},
        }, format='json')
        self.assertEqual(created.status_code, 201, created.data)
        returned = self.client.post(f"/api/pos/orders/{created.data['id']}/returns/", {
            'product_id': self.product.id, 'quantity': 1, 'disposition': 'RESTOCKED',
        }, format='json')
        self.assertEqual(returned.status_code, 200, returned.data)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_level, 3)

        inventory = self.client.get('/api/inventory/product-sales/')
        row = next(item for item in inventory.data if item['product_id'] == self.product.id)
        self.assertEqual(row['beginning_stock'], 5)
        self.assertEqual(row['quantity_sold'], 2)
        self.assertEqual(row['wastage'], 0)
        self.assertEqual(row['ending_stock'], 3)
        self.assertEqual(row['revenue'], '250.00')


class POSStockActionApiTests(TestCase):
    def setUp(self):
        self.staff = get_user_model().objects.create_user(
            username='stock-action-staff',
            email='stock-action-staff@example.com',
            password='Staff123!pass',
            role='STAFF',
        )
        self.customer = get_user_model().objects.create_user(
            username='stock-action-customer',
            email='stock-action-customer@example.com',
            password='Customer123!pass',
            role='CUSTOMER',
        )
        self.product = Product.objects.create(
            name='Action Test Americano',
            sku='ACTION-AMERICANO',
            item_type=Product.PRODUCT,
            price=Decimal('125.00'),
            stock_level=10,
            reorder_point=1,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.staff)

    def create_sale(self, quantity=2, product=None):
        product = product or self.product
        response = self.client.post('/api/pos/orders/', {
            'items': [{'product_id': product.id, 'quantity': quantity}],
            'payment': {'amount': str(Decimal('125.00') * quantity), 'method': 'CASH'},
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return response.data

    def action_payload(self, order, action_type, quantity=1, disposition=None, key='stock-action-idempotency-001'):
        item = {'product_id': self.product.id, 'quantity': quantity}
        if disposition:
            item['disposition'] = disposition
        return {
            'action_type': action_type,
            'transaction_id': order['transaction_id'],
            'reason': 'Recorded from the test POS modal',
            'idempotency_key': key,
            'items': [item],
        }

    def test_wastage_is_an_additional_inventory_loss_without_refunding_the_sale(self):
        sale = self.create_sale(quantity=2)
        response = self.client.post('/api/pos/stock-actions/', self.action_payload(sale, 'WASTAGE'), format='json')

        self.assertEqual(response.status_code, 201, response.data)
        order = Order.objects.get(pk=sale['id'])
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_level, 7)
        self.assertEqual(order.returned_amount, Decimal('0.00'))
        self.assertEqual(order.line_items[0]['quantity'] - order.line_items[0]['returned_quantity'], 2)
        self.assertEqual(order.line_items[0]['wasted_quantity'], 1)
        self.assertEqual(order.line_items[0]['wastage_events'][0]['staff_id'], self.staff.id)
        self.assertEqual(POSStockAction.objects.count(), 1)
        movement = InventoryEvent.objects.get(event_type=InventoryEvent.STOCK_MOVEMENT, reason__startswith='POS WASTAGE')
        self.assertEqual(movement.movement_type, 'OUT')
        self.assertEqual(movement.quantity, Decimal('1'))
        self.assertEqual(movement.user, self.staff)

        inventory = self.client.get('/api/inventory/product-sales/')
        row = next(item for item in inventory.data if item['product_id'] == self.product.id)
        self.assertEqual(row['quantity_sold'], 2)
        self.assertEqual(row['wastage'], 1)
        self.assertEqual(row['ending_stock'], 7)
        self.assertEqual(row['revenue'], '250.00')

    def test_refund_without_restock_reduces_sales_but_does_not_deduct_stock_again(self):
        sale = self.create_sale(quantity=4)
        payload = self.action_payload(sale, 'REFUND', quantity=1, disposition='WASTED')
        first = self.client.post('/api/pos/stock-actions/', payload, format='json')
        duplicate_with_new_key = dict(payload, idempotency_key='stock-action-refund-new-key')
        repeated = self.client.post('/api/pos/stock-actions/', duplicate_with_new_key, format='json')

        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(repeated.status_code, 200, repeated.data)
        self.assertEqual(first.data['action_id'], repeated.data['action_id'])
        order = Order.objects.get(pk=sale['id'])
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_level, 6)
        self.assertEqual(order.returned_amount, Decimal('125.00'))
        self.assertEqual(order.line_items[0]['returned_quantity'], 1)
        self.assertEqual(order.line_items[0]['wasted_quantity'], 1)
        self.assertEqual(POSStockAction.objects.count(), 1)
        self.assertEqual(InventoryEvent.objects.filter(product=self.product, reason__startswith='POS REFUND').count(), 0)

        inventory = self.client.get('/api/inventory/product-sales/')
        row = next(item for item in inventory.data if item['product_id'] == self.product.id)
        self.assertEqual(row['quantity_sold'], 3)
        self.assertEqual(row['wastage'], 1)
        self.assertEqual(row['ending_stock'], 6)
        self.assertEqual(row['revenue'], '375.00')

    def test_restocked_refund_restores_stock_once_and_requires_explicit_disposition(self):
        sale = self.create_sale(quantity=4)
        missing_disposition = self.action_payload(sale, 'REFUND', disposition=None)
        missing_disposition['items'][0].pop('disposition', None)
        rejected = self.client.post('/api/pos/stock-actions/', missing_disposition, format='json')
        self.assertEqual(rejected.status_code, 400)

        payload = self.action_payload(sale, 'REFUND', disposition='RESTOCKED')
        first = self.client.post('/api/pos/stock-actions/', payload, format='json')
        repeated = self.client.post('/api/pos/stock-actions/', payload, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(repeated.status_code, 200, repeated.data)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_level, 7)
        self.assertEqual(InventoryEvent.objects.filter(product=self.product, reason__startswith='POS REFUND').count(), 1)

        inventory = self.client.get('/api/inventory/product-sales/')
        row = next(item for item in inventory.data if item['product_id'] == self.product.id)
        self.assertEqual(row['quantity_sold'], 3)
        self.assertEqual(row['wastage'], 0)
        self.assertEqual(row['ending_stock'], 7)

    def test_reason_transaction_quantity_and_transaction_membership_are_validated(self):
        sale = self.create_sale(quantity=1)
        payload = self.action_payload(sale, 'WASTAGE')
        payload['reason'] = ' '
        self.assertEqual(self.client.post('/api/pos/stock-actions/', payload, format='json').status_code, 400)

        payload = self.action_payload(sale, 'WASTAGE')
        payload['transaction_id'] = 'NOT-A-TRANSACTION'
        self.assertEqual(self.client.post('/api/pos/stock-actions/', payload, format='json').status_code, 404)

        payload = self.action_payload(sale, 'REFUND', quantity=2, disposition='WASTED')
        self.assertEqual(self.client.post('/api/pos/stock-actions/', payload, format='json').status_code, 400)

        other_product = Product.objects.create(name='Not Sold Product', sku='NOT-SOLD', item_type=Product.PRODUCT, price=1, stock_level=3)
        payload = self.action_payload(sale, 'WASTAGE')
        payload['items'][0]['product_id'] = other_product.id
        self.assertEqual(self.client.post('/api/pos/stock-actions/', payload, format='json').status_code, 400)
        self.assertEqual(POSStockAction.objects.count(), 0)

    def test_insufficient_stock_does_not_partially_record_wastage(self):
        sale = self.create_sale(quantity=2)
        payload = self.action_payload(sale, 'WASTAGE', quantity=9)
        response = self.client.post('/api/pos/stock-actions/', payload, format='json')
        self.assertEqual(response.status_code, 400)
        self.product.refresh_from_db()
        order = Order.objects.get(pk=sale['id'])
        self.assertEqual(self.product.stock_level, 8)
        self.assertEqual(order.line_items[0]['wasted_quantity'], 0)
        self.assertEqual(POSStockAction.objects.count(), 0)
        self.assertEqual(InventoryEvent.objects.filter(product=self.product, reason__startswith='POS WASTAGE').count(), 0)

    def test_multi_product_failure_rolls_back_every_inventory_and_order_change(self):
        second = Product.objects.create(name='Action Test Matcha', sku='ACTION-MATCHA', item_type=Product.PRODUCT, price=50, stock_level=2)
        sale = self.client.post('/api/pos/orders/', {
            'items': [{'product_id': self.product.id, 'quantity': 1}, {'product_id': second.id, 'quantity': 1}],
            'payment': {'amount': '175.00', 'method': 'CASH'},
        }, format='json')
        self.assertEqual(sale.status_code, 201, sale.data)
        self.product.refresh_from_db()
        second.refresh_from_db()
        before_first = self.product.stock_level
        before_second = second.stock_level
        response = self.client.post('/api/pos/stock-actions/', {
            'action_type': 'WASTAGE',
            'transaction_id': sale.data['transaction_id'],
            'reason': 'Multiple products with second line invalid',
            'idempotency_key': 'stock-action-atomic-rollback-001',
            'items': [
                {'product_id': self.product.id, 'quantity': 1},
                {'product_id': second.id, 'quantity': 2},
            ],
        }, format='json')
        self.assertEqual(response.status_code, 400)
        self.product.refresh_from_db()
        second.refresh_from_db()
        order = Order.objects.get(pk=sale.data['id'])
        self.assertEqual(self.product.stock_level, before_first)
        self.assertEqual(second.stock_level, before_second)
        self.assertEqual([line['wasted_quantity'] for line in order.line_items], [0, 0])
        self.assertEqual(POSStockAction.objects.count(), 0)
        self.assertFalse(InventoryEvent.objects.filter(reason__startswith='POS WASTAGE').exists())

    def test_reusing_an_idempotency_key_for_a_different_action_is_rejected(self):
        sale = self.create_sale(quantity=2)
        payload = self.action_payload(sale, 'WASTAGE')
        first = self.client.post('/api/pos/stock-actions/', payload, format='json')
        self.assertEqual(first.status_code, 201, first.data)
        changed = dict(payload, reason='Different action with the same idempotency key')
        second = self.client.post('/api/pos/stock-actions/', changed, format='json')
        self.assertEqual(second.status_code, 409)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_level, 7)
        self.assertEqual(POSStockAction.objects.count(), 1)

    def test_reopening_modal_cannot_duplicate_the_same_wastage_with_a_new_key(self):
        sale = self.create_sale(quantity=2)
        first_payload = self.action_payload(sale, 'WASTAGE', quantity=1, key='stock-action-first-key')
        first = self.client.post('/api/pos/stock-actions/', first_payload, format='json')
        retry_payload = self.action_payload(sale, 'WASTAGE', quantity=1, key='stock-action-new-key')
        retry = self.client.post('/api/pos/stock-actions/', retry_payload, format='json')

        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(retry.status_code, 200, retry.data)
        self.assertEqual(first.data['action_id'], retry.data['action_id'])
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_level, 7)
        self.assertEqual(POSStockAction.objects.count(), 1)
        self.assertEqual(InventoryEvent.objects.filter(product=self.product, reason__startswith='POS WASTAGE').count(), 1)

    def test_recipe_product_wastage_uses_existing_recipe_stock_movements(self):
        ingredient = Product.objects.create(
            name='Action Test Espresso',
            sku='ACTION-ESPRESSO',
            item_type=Product.INGREDIENT,
            base_unit='ML',
            stock_quantity=Decimal('100.00'),
        )
        drink = Product.objects.create(
            name='Action Test Recipe Americano',
            sku='ACTION-RECIPE-AMERICANO',
            item_type=Product.PRODUCT,
            price=Decimal('125.00'),
            recipe_data=[{'ingredient': ingredient.id, 'quantity': '10.00'}],
        )
        sale = self.create_sale(quantity=2, product=drink)
        ingredient.refresh_from_db()
        self.assertEqual(ingredient.stock_quantity, Decimal('80.00'))

        payload = self.action_payload(sale, 'WASTAGE')
        payload['items'][0]['product_id'] = drink.id
        response = self.client.post('/api/pos/stock-actions/', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        ingredient.refresh_from_db()
        self.assertEqual(ingredient.stock_quantity, Decimal('70.00'))
        movement = InventoryEvent.objects.get(product=ingredient, reason__startswith='POS WASTAGE')
        self.assertEqual(movement.movement_type, 'OUT')
        self.assertEqual(movement.quantity, Decimal('10.00'))

    def test_customer_cannot_record_stock_actions(self):
        sale = self.create_sale(quantity=1)
        self.client.force_authenticate(self.customer)
        response = self.client.post('/api/pos/stock-actions/', self.action_payload(sale, 'WASTAGE'), format='json')
        self.assertEqual(response.status_code, 403)
