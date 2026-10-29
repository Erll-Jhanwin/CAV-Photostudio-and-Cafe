from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

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
        self.assertEqual(response.status_code, 201)
        order_id = response.data['id']

        cancel_response = self.client.patch(f'/api/inventory/purchase-orders/{order_id}/', {'status': 'CANCELLED'}, format='json')
        self.assertEqual(cancel_response.status_code, 200)
        self.assertEqual(cancel_response.data['status'], 'CANCELLED')
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock_level, 4)

        receive_response = self.client.patch(f'/api/inventory/purchase-orders/{order_id}/', {'status': 'RECEIVED'}, format='json')
        self.assertEqual(receive_response.status_code, 400)

        invalid_response = self.client.post('/api/inventory/purchase-orders/', {
            'supplier': 1,
            'items': [{'product_id': self.product.id, 'quantity': 0}],
        }, format='json')
        self.assertEqual(invalid_response.status_code, 400)
        self.assertIn('items', invalid_response.data)

# Create your tests here.
