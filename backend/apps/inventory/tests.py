from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient
from django.utils import timezone
from datetime import timedelta
from pos.models import Order
from inventory.models import BusinessDay, DailyProductBalance

from inventory.models import Category, InventoryEvent, Product, Supplier
from inventory.serializers import ProductSerializer


class StockMovementWriteTests(TestCase):
    def setUp(self):
        self.staff = get_user_model().objects.create_user(
            username='inventory-staff',
            email='inventory-staff@example.com',
            password='Staff123!pass',
            role='STAFF',
        )
        self.product = Product.objects.create(
            name='Inventory Test Print',
            sku='INVENTORY-TEST-PRINT',
            item_type=Product.PRODUCT,
            price='10.00',
            stock_level=4,
            reorder_point=1,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.staff)

    def test_stock_movement_updates_inventory_and_records_an_event(self):
        response = self.client.post('/api/inventory/movements/', {
            'product': self.product.id,
            'movement_type': 'OUT',
            'quantity': 2,
            'reason': 'Test adjustment',
        }, format='json')

        self.assertEqual(response.status_code, 201)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_level, 2)
        self.assertTrue(InventoryEvent.objects.filter(product=self.product, movement_type='OUT').exists())

    def test_public_product_response_excludes_internal_inventory_fields(self):
        self.client.force_authenticate(None)
        response = self.client.get('/api/inventory/products/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]['id'], self.product.id)
        self.assertNotIn('stock_level', response.data[0])
        self.assertNotIn('cost', response.data[0])
        self.assertNotIn('recipe_items', response.data[0])


class CatalogReferenceCrudTests(TestCase):
    def setUp(self):
        self.staff = get_user_model().objects.create_user(
            username='catalog-staff',
            email='catalog-staff@example.com',
            password='Staff123!pass',
            role='STAFF',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.staff)

    def test_category_and_supplier_can_be_created_updated_and_soft_deleted(self):
        category_response = self.client.post('/api/inventory/categories/', {
            'name': 'Seasonal Specials',
            'description': 'Limited menu releases',
        }, format='json')
        self.assertEqual(category_response.status_code, 201)
        category_id = category_response.data['id']
        self.assertTrue(Category.objects.filter(pk=category_id, is_active=True).exists())

        update_response = self.client.patch(f'/api/inventory/categories/{category_id}/', {
            'description': 'Rotating seasonal menu releases',
        }, format='json')
        self.assertEqual(update_response.status_code, 200)
        self.assertEqual(update_response.data['description'], 'Rotating seasonal menu releases')

        supplier_response = self.client.post('/api/inventory/suppliers/', {
            'name': 'Local Packaging Co',
            'email': 'orders@packaging.example',
        }, format='json')
        self.assertEqual(supplier_response.status_code, 201)
        supplier_id = supplier_response.data['id']
        self.assertTrue(Supplier.objects.filter(pk=supplier_id, is_active=True).exists())

        self.assertEqual(self.client.delete(f'/api/inventory/categories/{category_id}/').status_code, 204)
        self.assertEqual(self.client.delete(f'/api/inventory/suppliers/{supplier_id}/').status_code, 204)
        self.assertFalse(self.client.get('/api/inventory/categories/').data and any(row['id'] == category_id for row in self.client.get('/api/inventory/categories/').data))
        self.assertTrue(any(row['id'] == category_id for row in self.client.get('/api/inventory/categories/?include_inactive=true').data))
        self.assertFalse(Category.objects.get(pk=category_id).is_active)
        self.assertFalse(Supplier.objects.get(pk=supplier_id).is_active)


class ProductSerializationQueryTests(TestCase):
    def test_recipe_catalog_serialization_uses_bounded_reference_queries(self):
        category = Category.objects.create(name='Bulk Menu Category')
        ingredient = Product.objects.create(
            name='Bulk Menu Ingredient',
            sku='BULK-MENU-INGREDIENT',
            item_type=Product.INGREDIENT,
            category=category.id,
            category_name=category.name,
            stock_quantity='100.00',
            minimum_stock_level='1.00',
            maximum_stock_level='200.00',
            base_unit='G',
        )
        products = [
            Product.objects.create(
                name=f'Bulk Menu Drink {number}',
                sku=f'BULK-MENU-{number}',
                item_type=Product.PRODUCT,
                category=category.id,
                recipe_data=[{'ingredient': ingredient.id, 'quantity': '5'}],
            )
            for number in range(8)
        ]

        with self.assertNumQueries(2):
            payload = ProductSerializer(products, many=True).data

        self.assertEqual(len(payload), 8)
        self.assertEqual(payload[0]['recipe_items'][0]['ingredient_details']['id'], ingredient.id)
        self.assertEqual(payload[0]['available_servings'], 20)

    def test_product_list_supports_bounded_offset_windows(self):
        Product.objects.bulk_create([
            Product(
                name=f'Window Product {number}',
                sku=f'WINDOW-PRODUCT-{number}',
                item_type=Product.PRODUCT,
            )
            for number in range(5)
        ])
        client = APIClient()
        first = client.get('/api/inventory/products/?limit=2&offset=0')
        second = client.get('/api/inventory/products/?limit=2&offset=2')

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(len(first.data), 2)
        self.assertEqual(len(second.data), 2)
        self.assertTrue({row['id'] for row in first.data}.isdisjoint({row['id'] for row in second.data}))


class PurchaseOrderLifecycleTests(TestCase):
    def setUp(self):
        self.staff = get_user_model().objects.create_user(
            username='purchase-staff',
            email='purchase-staff@example.com',
            password='Staff123!pass',
            role='STAFF',
        )
        self.product = Product.objects.create(
            name='Purchase Order Test Product',
            sku='PO-TEST-001',
            item_type=Product.PRODUCT,
            price='40.00',
            cost='12.50',
            stock_level=4,
            reorder_point=1,
            is_active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.staff)

    def create_order(self):
        return self.client.post('/api/inventory/purchase-orders/', {
            'supplier': 1,
            'notes': 'Weekly replenishment',
            'items': [
                {'product_id': self.product.id, 'quantity': 3, 'unit_cost': '13.00'},
            ],
        }, format='json')

    def test_order_can_be_created_edited_received_once_and_cannot_reopen(self):
        response = self.create_order()
        self.assertEqual(response.status_code, 201)
        order_id = response.data['id']
        self.assertEqual(response.data['status'], 'ORDERED')
        self.assertEqual(response.data['items'][0]['line_total'], '39.00')

        edit_response = self.client.patch(f'/api/inventory/purchase-orders/{order_id}/', {
            'notes': 'Updated delivery instructions',
        }, format='json')
        self.assertEqual(edit_response.status_code, 200)
        self.assertEqual(edit_response.data['notes'], 'Updated delivery instructions')

        receive_response = self.client.patch(f'/api/inventory/purchase-orders/{order_id}/', {'status': 'RECEIVED'}, format='json')
        self.assertEqual(receive_response.status_code, 200)
        self.assertEqual(receive_response.data['status'], 'RECEIVED')
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_level, 7)

    def test_repeated_receive_does_not_duplicate_stock_and_cannot_reopen(self):
        response = self.create_order()
        order_id = response.data['id']
        first_receive = self.client.patch(f'/api/inventory/purchase-orders/{order_id}/', {'status': 'RECEIVED'}, format='json')
        self.assertEqual(first_receive.status_code, 200)
        self.assertEqual(InventoryEvent.objects.filter(event_type=InventoryEvent.STOCK_MOVEMENT, product=self.product, reason=f'Restock from PO #{order_id}').count(), 1)
        second_receive = self.client.patch(f'/api/inventory/purchase-orders/{order_id}/', {'status': 'RECEIVED'}, format='json')
        self.assertEqual(second_receive.status_code, 200)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_level, 7)
        reopen_response = self.client.patch(f'/api/inventory/purchase-orders/{order_id}/', {'status': 'ORDERED'}, format='json')
        self.assertEqual(reopen_response.status_code, 400)
        self.assertIn('status', reopen_response.data)

    def test_cancelled_order_is_terminal_and_invalid_items_are_rejected(self):
        response = self.create_order()
        order_id = response.data['id']
        cancel_response = self.client.patch(f'/api/inventory/purchase-orders/{order_id}/', {'status': 'CANCELLED'}, format='json')
        self.assertEqual(cancel_response.status_code, 200)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_level, 4)
        self.assertEqual(self.client.patch(f'/api/inventory/purchase-orders/{order_id}/', {'status': 'RECEIVED'}, format='json').status_code, 400)
        invalid = self.client.post('/api/inventory/purchase-orders/', {'supplier': 1, 'items': [{'product_id': self.product.id, 'quantity': 0}]}, format='json')
        self.assertEqual(invalid.status_code, 400)
        self.assertIn('items', invalid.data)


class DailyInventoryReconciliationTests(TestCase):
    def setUp(self):
        self.staff = get_user_model().objects.create_user(username='reconcile-staff', password='Staff123!pass', role='STAFF')
        self.admin = get_user_model().objects.create_user(username='reconcile-admin', password='Admin123!pass', role='ADMIN')
        self.product = Product.objects.create(name='Americano reconciliation', sku='AMER-RECON', item_type=Product.PRODUCT, stock_level=36)
        self.day_date = timezone.localdate()
        self.day = BusinessDay.objects.create(business_date=self.day_date, opened_by=self.staff)
        DailyProductBalance.objects.create(day=self.day, product=self.product, beginning_quantity=36)
        self.client = APIClient()

    def test_waste_and_paid_sale_reconcile_expected_and_actual(self):
        self.product.stock_level = 34
        self.product.save(update_fields=['stock_level'])
        Order.objects.create(staff=self.staff, subtotal=20, total=20, transaction_id='SALE-2-AMER', completed_at=timezone.now(), payment_status='PAID', line_items=[{'product': self.product.pk, 'quantity': 2, 'returned_quantity': 0, 'returns': []}])
        self.client.force_authenticate(self.staff)
        loss_payload = {'action': 'LOSS', 'date': self.day_date.isoformat(), 'product_id': self.product.pk, 'quantity': 1, 'reason': 'Spilled while preparing', 'idempotency_key': 'spill-event-1'}
        waste = self.client.post('/api/inventory/daily-reconciliation/', loss_payload, format='json')
        self.assertEqual(waste.status_code, 201)
        duplicate = self.client.post('/api/inventory/daily-reconciliation/', loss_payload, format='json')
        self.assertEqual(duplicate.status_code, 200)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_level, 33)
        row = waste.data['rows'][0]
        self.assertEqual((row['net_sold'], row['loss_qty'], row['expected_ending']), (2, 1, 33))
        counted = self.client.post('/api/inventory/daily-reconciliation/', {'action': 'COUNT', 'date': self.day_date.isoformat(), 'product_id': self.product.pk, 'quantity': 33}, format='json')
        self.assertEqual(counted.data['rows'][0]['tally_status'], 'Tally')

    def test_wasted_refund_is_net_sold_reduction_and_loss(self):
        self.client.force_authenticate(self.staff)
        self.product.stock_level = 31
        self.product.save(update_fields=['stock_level'])
        DailyProductBalance.objects.filter(day=self.day, product=self.product).update(beginning_quantity=35)
        Order.objects.create(staff=self.staff, subtotal=40, total=40, transaction_id='SALE-MATCHA', completed_at=timezone.now(), payment_status='PAID', line_items=[{'product': self.product.pk, 'quantity': 4, 'returned_quantity': 1, 'wasted_quantity': 1, 'returns': [{'quantity': 1, 'disposition': 'WASTED', 'reason': 'Customer refund', 'staff_id': self.staff.pk, 'timestamp': timezone.now().isoformat()}]}], return_events=[{'product_id': self.product.pk, 'quantity': 1, 'disposition': 'WASTED', 'reason': 'Customer refund', 'staff_id': self.staff.pk, 'timestamp': timezone.now().isoformat()}])
        response = self.client.get('/api/inventory/daily-reconciliation/', {'date': self.day_date.isoformat()})
        self.assertEqual(response.status_code, 200)
        row = next(row for row in response.data['rows'] if row['product_id'] == self.product.pk)
        self.assertEqual((row['net_sold'], row['loss_qty'], row['expected_ending']), (3, 1, 31))
        self.assertEqual(row['losses'][0]['loss_type'], 'Refunded')

    def test_restocked_refund_is_not_a_loss_or_a_second_addition(self):
        self.client.force_authenticate(self.staff)
        self.product.stock_level = 33
        self.product.save(update_fields=['stock_level'])
        Order.objects.create(staff=self.staff, subtotal=40, total=40, transaction_id='SALE-RESTOCK', completed_at=timezone.now(), payment_status='PAID', line_items=[{'product': self.product.pk, 'quantity': 4, 'returned_quantity': 1, 'returns': [{'quantity': 1, 'disposition': 'RESTOCKED', 'staff_id': self.staff.pk, 'timestamp': timezone.now().isoformat()}]}], return_events=[{'product_id': self.product.pk, 'quantity': 1, 'disposition': 'RESTOCKED', 'staff_id': self.staff.pk, 'timestamp': timezone.now().isoformat()}])
        response = self.client.get('/api/inventory/daily-reconciliation/', {'date': self.day_date.isoformat()})
        row = next(row for row in response.data['rows'] if row['product_id'] == self.product.pk)
        self.assertEqual((row['net_sold'], row['loss_qty'], row['expected_ending']), (3, 0, 33))

    def test_two_sales_two_losses_and_actual_31_is_short_by_one(self):
        latte = Product.objects.create(name='Ice Latte', sku='LATTE-RECON', item_type=Product.PRODUCT, stock_level=36)
        DailyProductBalance.objects.create(day=self.day, product=latte, beginning_quantity=36)
        latte.stock_level = 34
        latte.save(update_fields=['stock_level'])
        Order.objects.create(staff=self.staff, subtotal=40, total=40, transaction_id='LATTE-SALE-2', completed_at=timezone.now(), payment_status='PAID', line_items=[{'product': latte.pk, 'quantity': 2, 'returns': []}])
        self.client.force_authenticate(self.staff)
        loss = self.client.post('/api/inventory/daily-reconciliation/', {'action': 'LOSS', 'date': self.day_date.isoformat(), 'product_id': latte.pk, 'quantity': 2, 'reason': 'Two drinks spilled', 'idempotency_key': 'latte-loss-two'}, format='json')
        row = next(row for row in loss.data['rows'] if row['product_id'] == latte.pk)
        self.assertEqual((row['beginning_inventory'], row['net_sold'], row['loss_qty'], row['expected_ending']), (36, 2, 2, 32))
        counted = self.client.post('/api/inventory/daily-reconciliation/', {'action': 'COUNT', 'date': self.day_date.isoformat(), 'product_id': latte.pk, 'quantity': 31}, format='json')
        row = next(row for row in counted.data['rows'] if row['product_id'] == latte.pk)
        self.assertEqual((row['variance'], row['tally_status']), (-1, 'Short by 1'))

    def test_later_day_wasted_refund_does_not_rewrite_closed_day_or_double_reduce_stock(self):
        yesterday = self.day_date - timedelta(days=1)
        prior = BusinessDay.objects.create(business_date=yesterday, is_closed=True, closed_by=self.admin, closed_at=timezone.now(), report_data={'date': yesterday.isoformat(), 'rows': []})
        DailyProductBalance.objects.create(day=prior, product=self.product, beginning_quantity=34, actual_ending_quantity=30)
        DailyProductBalance.objects.filter(day=self.day, product=self.product).update(beginning_quantity=30)
        self.product.stock_level = 30
        self.product.save(update_fields=['stock_level'])
        event_time = timezone.now().isoformat()
        Order.objects.create(staff=self.staff, subtotal=40, total=40, transaction_id='CROSS-DAY-REFUND', completed_at=timezone.now() - timedelta(days=1), payment_status='PAID', line_items=[{'product': self.product.pk, 'quantity': 4, 'returned_quantity': 1, 'returns': [{'quantity': 1, 'disposition': 'WASTED', 'reason': 'Returned later', 'staff_id': self.staff.pk, 'timestamp': event_time}]}], return_events=[{'product_id': self.product.pk, 'quantity': 1, 'disposition': 'WASTED', 'reason': 'Returned later', 'staff_id': self.staff.pk, 'timestamp': event_time}])
        self.client.force_authenticate(self.staff)
        response = self.client.get('/api/inventory/daily-reconciliation/', {'date': self.day_date.isoformat()})
        row = next(row for row in response.data['rows'] if row['product_id'] == self.product.pk)
        self.assertEqual((row['net_sold'], row['loss_qty'], row['expected_ending']), (-1, 1, 30))
        self.assertEqual(prior.report_data['date'], yesterday.isoformat())

    def test_shortage_requires_admin_explanation_and_closure_carries_forward(self):
        self.client.force_authenticate(self.staff)
        self.client.post('/api/inventory/daily-reconciliation/', {'action': 'COUNT', 'date': self.day_date.isoformat(), 'product_id': self.product.pk, 'quantity': 35}, format='json')
        denied = self.client.post('/api/inventory/daily-reconciliation/', {'action': 'CLOSE', 'date': self.day_date.isoformat(), 'remarks': 'short'}, format='json')
        self.assertEqual(denied.status_code, 403)
        self.client.force_authenticate(self.admin)
        closed = self.client.post('/api/inventory/daily-reconciliation/', {'action': 'CLOSE', 'date': self.day_date.isoformat(), 'remarks': 'Verified count; reviewed camera footage.'}, format='json')
        self.assertEqual(closed.status_code, 200)
        self.assertTrue(closed.data['is_closed'])
        self.assertEqual(closed.data['rows'][0]['tally_status'], 'Short by 1')
        # A repeated request returns the saved snapshot without creating another adjustment.
        event_count = InventoryEvent.objects.filter(product=self.product).count()
        again = self.client.post('/api/inventory/daily-reconciliation/', {'action': 'CLOSE', 'date': self.day_date.isoformat(), 'remarks': 'ignored retry'}, format='json')
        self.assertEqual(again.status_code, 200)
        self.assertEqual(InventoryEvent.objects.filter(product=self.product).count(), event_count)
        tomorrow = self.day_date + timedelta(days=1)
        next_day = BusinessDay.objects.create(business_date=tomorrow)
        next_report = self.client.get('/api/inventory/daily-reconciliation/', {'date': tomorrow.isoformat()})
        next_row = next(row for row in next_report.data['rows'] if row['product_id'] == self.product.pk)
        self.assertEqual((next_row['beginning_inventory'], next_row['net_sold'], next_row['loss_qty'], next_row['expected_ending'], next_row['actual_ending'], next_row['tally_status']), (35, 0, 0, 35, None, 'Not Counted'))

    def test_staff_cannot_finalize_discrepancy_even_with_remark(self):
        self.client.force_authenticate(self.staff)
        self.client.post('/api/inventory/daily-reconciliation/', {'action': 'COUNT', 'date': self.day_date.isoformat(), 'product_id': self.product.pk, 'quantity': 37}, format='json')
        response = self.client.post('/api/inventory/daily-reconciliation/', {'action': 'CLOSE', 'date': self.day_date.isoformat(), 'remarks': 'Overage checked'}, format='json')
        self.assertEqual(response.status_code, 403)

    def test_admin_correction_preserves_snapshot_and_updates_open_carry_forward(self):
        self.client.force_authenticate(self.staff)
        self.client.post('/api/inventory/daily-reconciliation/', {'action': 'COUNT', 'date': self.day_date.isoformat(), 'product_id': self.product.pk, 'quantity': 36}, format='json')
        self.client.force_authenticate(self.admin)
        closed = self.client.post('/api/inventory/daily-reconciliation/', {'action': 'CLOSE', 'date': self.day_date.isoformat()}, format='json')
        self.assertTrue(closed.data['is_closed'])
        next_date = self.day_date + timedelta(days=1)
        next_report = self.client.get('/api/inventory/daily-reconciliation/', {'date': next_date.isoformat()})
        self.assertEqual(next_report.data['rows'][0]['beginning_inventory'], 36)
        self.client.force_authenticate(self.staff)
        forbidden = self.client.post('/api/inventory/daily-reconciliation/', {'action': 'CORRECTION', 'date': self.day_date.isoformat(), 'product_id': self.product.pk, 'quantity': 35, 'reason': 'Count correction', 'idempotency_key': 'corr-1'}, format='json')
        self.assertEqual(forbidden.status_code, 403)
        self.client.force_authenticate(self.admin)
        payload = {'action': 'CORRECTION', 'date': self.day_date.isoformat(), 'product_id': self.product.pk, 'quantity': 35, 'reason': 'Verified camera review', 'idempotency_key': 'corr-1'}
        corrected = self.client.post('/api/inventory/daily-reconciliation/', payload, format='json')
        self.assertEqual(corrected.status_code, 200)
        self.assertEqual(corrected.data['rows'][0]['actual_ending'], 36)
        self.assertEqual(corrected.data['corrections'][0]['corrected_quantity'], 35)
        next_report = self.client.get('/api/inventory/daily-reconciliation/', {'date': next_date.isoformat()})
        self.assertEqual(next_report.data['rows'][0]['beginning_inventory'], 35)
        movement_count = InventoryEvent.objects.count()
        self.client.post('/api/inventory/daily-reconciliation/', payload, format='json')
        self.assertEqual(InventoryEvent.objects.count(), movement_count)

# Create your tests here.
