"""
Management command to seed the CAV Photo Studio & Cafe menu into the database.

Menu data (July 2026):
  Classics      - Americano ₱70, Cappuccino ₱110, Spanish Latte ₱105, Caramel Macchiato ₱105
  Signatures    - Chocnut Latte ₱125, Triple Chocolate Latte ₱140
  Matcha        - Classic Matcha ₱130, Dirty Matcha ₱145, Chocnut Matcha ₱155, Strawberry Matcha ₱145
  Soda          - Sparkling Mango ₱75, Sparkling Strawberry ₱75, Sparkling Blueberry ₱75, Sparkling Green Apple ₱65

Usage:
  python manage.py seed_menu            # safe upsert (default)
  python manage.py seed_menu --reset    # wipe all café menu items first, then re-seed
"""

from django.core.management.base import BaseCommand
from inventory.models import Category, Product


MENU = {
    "Classics": [
        {
            "name": "Americano",
            "price": 70.00,
            "sku": "CAF-CLS-001",
            "image_url": "https://images.unsplash.com/photo-1551030173-122aabc4489c?w=400&q=80",
        },
        {
            "name": "Cappuccino",
            "price": 110.00,
            "sku": "CAF-CLS-002",
            "image_url": "https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=400&q=80",
        },
        {
            "name": "Spanish Latte",
            "price": 105.00,
            "sku": "CAF-CLS-003",
            "image_url": "https://images.unsplash.com/photo-1561882468-9110e03e0f78?w=400&q=80",
        },
        {
            "name": "Caramel Macchiato",
            "price": 105.00,
            "sku": "CAF-CLS-004",
            "image_url": "https://images.unsplash.com/photo-1517701604599-bb29b565090c?w=400&q=80",
        },
    ],
    "Signatures": [
        {
            "name": "Chocnut Latte",
            "price": 125.00,
            "sku": "CAF-SIG-001",
            "image_url": "https://images.unsplash.com/photo-1578314675249-a6910f80cc4e?w=400&q=80",
        },
        {
            "name": "Triple Chocolate Latte",
            "price": 140.00,
            "sku": "CAF-SIG-002",
            "image_url": "https://images.unsplash.com/photo-1610889556528-9a770e32642f?w=400&q=80",
        },
    ],
    "Matcha": [
        {
            "name": "Classic Matcha",
            "price": 130.00,
            "sku": "CAF-MAT-001",
            "image_url": "https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=400&q=80",
        },
        {
            "name": "Dirty Matcha",
            "price": 145.00,
            "sku": "CAF-MAT-002",
            "image_url": "https://images.unsplash.com/photo-1564890369478-c89ca6d9cde9?w=400&q=80",
        },
        {
            "name": "Chocnut Matcha",
            "price": 155.00,
            "sku": "CAF-MAT-003",
            "image_url": "https://images.unsplash.com/photo-1545631757-2ee9cff5bb7c?w=400&q=80",
        },
        {
            "name": "Strawberry Matcha",
            "price": 145.00,
            "sku": "CAF-MAT-004",
            "image_url": "https://images.unsplash.com/photo-1546549095-77f48c851c8f?w=400&q=80",
        },
    ],
    "Soda": [
        {
            "name": "Sparkling Mango",
            "price": 75.00,
            "sku": "CAF-SOD-001",
            "image_url": "https://images.unsplash.com/photo-1541614101331-1a5a3a194e92?w=400&q=80",
        },
        {
            "name": "Sparkling Strawberry",
            "price": 75.00,
            "sku": "CAF-SOD-002",
            "image_url": "https://images.unsplash.com/photo-1497534446932-c925b458314e?w=400&q=80",
        },
        {
            "name": "Sparkling Blueberry",
            "price": 75.00,
            "sku": "CAF-SOD-003",
            "image_url": "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80",
        },
        {
            "name": "Sparkling Green Apple",
            "price": 65.00,
            "sku": "CAF-SOD-004",
            "image_url": "https://images.unsplash.com/photo-1596803244897-82e71b4a59e3?w=400&q=80",
        },
    ],
}

# Default stock level for newly created café menu items
DEFAULT_STOCK = 100
REORDER_POINT = 10


class Command(BaseCommand):
    help = "Seed the CAV Photo Studio & Café menu (Categories + Products) into the database."

    def add_arguments(self, parser):
        parser.add_argument(
            "--reset",
            action="store_true",
            help="Delete all existing café menu products before seeding.",
        )

    def handle(self, *args, **options):
        if options["reset"]:
            deleted_count, _ = Product.objects.filter(is_cafe_item=True).delete()
            self.stdout.write(
                self.style.WARNING(f"Deleted {deleted_count} existing café menu product(s).")
            )

        created_products = 0
        updated_products = 0

        for category_name, items in MENU.items():
            category, cat_created = Category.objects.get_or_create(
                name=category_name,
                defaults={"description": f"CAV Café — {category_name} drinks"},
            )
            if cat_created:
                self.stdout.write(self.style.SUCCESS(f"  [+] Category created: {category_name}"))
            else:
                self.stdout.write(f"  [~] Category exists: {category_name}")

            for item in items:
                # Preserve existing stock for already-seeded items
                existing_stock = (
                    Product.objects.filter(sku=item["sku"])
                    .values_list("stock_level", flat=True)
                    .first()
                )

                product, prod_created = Product.objects.update_or_create(
                    sku=item["sku"],
                    defaults={
                        "name":          item["name"],
                        "price":         item["price"],
                        "cost":          0.00,
                        "category":      category,
                        "supplier":      None,
                        "stock_level":   DEFAULT_STOCK if existing_stock is None else existing_stock,
                        "reorder_point": REORDER_POINT,
                        "is_cafe_item":  True,
                        "image_url":     item.get("image_url", ""),
                    },
                )
                if prod_created:
                    created_products += 1
                    self.stdout.write(
                        self.style.SUCCESS(
                            f"      [+] Created: {product.name} @ PHP {product.price}"
                        )
                    )
                else:
                    updated_products += 1
                    self.stdout.write(
                        f"      [~] Updated: {product.name} @ PHP {product.price}"
                    )

        self.stdout.write("")
        self.stdout.write(
            self.style.SUCCESS(
                f"Seeding complete -- {created_products} created, {updated_products} updated."
            )
        )
