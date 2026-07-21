from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from inventory.models import InventoryEvent, Product


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

# Create your tests here.
