from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand

from audit.models import AuditLog
from booking.models import Package, Service
from inventory.models import InventoryEvent, Product
from inventory.recipe_defaults import ensure_default_ingredients_and_recipes
from users.models import Customer

User = get_user_model()


class Command(BaseCommand):
    help = 'Seeds compact-schema demo accounts, services, products, ingredients, recipes, and FAQs.'

    def handle(self, *args, **options):
        self.stdout.write('Seeding compact database...')
        self.seed_users()
        self.seed_booking_services()
        self.seed_products()
        ensure_default_ingredients_and_recipes()
        self.seed_faqs()
        self.stdout.write(self.style.SUCCESS('Database seeded successfully!'))

    def seed_users(self):
        for spec in [
            ('admin', 'admin@test.com', 'ADMIN', 'CAV', 'Admin', 'Admin123!', True, True),
            ('staff', 'staff@test.com', 'STAFF', 'CAV', 'Staff', 'Staff123!', True, False),
            ('customer', 'customer@test.com', 'CUSTOMER', 'CAV', 'Customer', 'Customer123!', False, False),
        ]:
            username, email, role, first_name, last_name, password, is_staff, is_superuser = spec
            user, _ = User.objects.get_or_create(username=username)
            user.email = email
            user.role = role
            user.first_name = first_name
            user.last_name = last_name
            user.is_staff = is_staff
            user.is_superuser = is_superuser
            user.is_active = True
            if not user.check_password(password):
                user.set_password(password)
            user.save()
            if role == 'CUSTOMER':
                Customer.objects.get_or_create(user=user, defaults={'points': 150, 'loyalty_tier': 'Bronze', 'notes': 'Demo customer account.'})

    def seed_booking_services(self):
        self_shoot, _ = Service.objects.get_or_create(
            name='Self-Shoot Studio',
            defaults={
                'description': 'Enjoy a private studio session with professional cameras, lighting, and trigger buttons.',
                'duration_minutes': 30,
                'base_price': 500.00,
                'image_url': 'https://images.unsplash.com/photo-1542038784456-1ea8e935640e?q=80&w=600',
            },
        )
        portrait, _ = Service.objects.get_or_create(
            name='Boutique Portrait',
            defaults={
                'description': 'Professional studio portrait taken by our resident photographer.',
                'duration_minutes': 60,
                'base_price': 1200.00,
                'image_url': 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=600',
            },
        )
        for service, name, price, description, inclusions in [
            (self_shoot, 'Single Session', 500.00, 'Perfect for solo shoots.', '30 mins studio shoot, 15 mins photo selection, 1 digital soft copy'),
            (self_shoot, 'Duo Pack', 800.00, 'Bring a friend or partner.', '45 mins studio shoot, 15 mins photo selection, 2 digital soft copies, 2 premium prints'),
            (portrait, 'Solo Premium', 1500.00, 'Executive, business, or premium graduation portrait.', '60 mins shoot by photographer, professional editing, 5 soft copies, 2 premium physical prints'),
        ]:
            Package.objects.get_or_create(service=service, name=name, defaults={'price': price, 'description': description, 'inclusions': inclusions})

    def seed_products(self):
        products = [
            ('CAFE-ESP', 'Espresso', 1, 'Beverages', 90.00, 150, True, 'https://images.unsplash.com/photo-1510707513156-476725f37722?q=80&w=400'),
            ('CAFE-LAT', 'Iced Latte', 1, 'Beverages', 130.00, 100, True, 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?q=80&w=400'),
            ('CAFE-CRO', 'Chocolate Croissant', 2, 'Snacks', 85.00, 30, True, 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=400'),
        ]
        for sku, name, category, category_name, price, stock, is_cafe_item, image_url in products:
            product, created = Product.objects.get_or_create(
                sku=sku,
                defaults={
                    'name': name,
                    'item_type': Product.PRODUCT,
                    'category': category,
                    'category_name': category_name,
                    'supplier': 1,
                    'supplier_details': {'id': 1, 'name': 'Manila Coffee Roasters'},
                    'unit': 'pcs',
                    'cost': 30.00,
                    'price': price,
                    'stock_level': stock,
                    'reorder_point': 20,
                    'maximum_stock_level': 100,
                    'is_cafe_item': is_cafe_item,
                    'image_url': image_url,
                },
            )
            if created:
                InventoryEvent.objects.create(event_type=InventoryEvent.STOCK_MOVEMENT, product=product, movement_type='IN', quantity=stock, reason='Initial stock seeding')

    def seed_faqs(self):
        faqs = [
            ("What are your operating hours?", "CAV Photo Studio and Cafe is open daily from 9:00 AM to 8:00 PM.", "hours,schedule,open"),
            ("How do I book a studio session?", "Log in, open Book Session, choose a package, select a date and time, then submit your booking.", "book,booking,session,reserve"),
            ("Where is CAV located?", "CAV is located at 028B M.P. Casanova St., Purok 1, Tambo, Lipa City, Batangas.", "location,address,where,directions"),
        ]
        for question, answer, tags in faqs:
            if not AuditLog.objects.filter(action='FAQ_RECORD', metadata__question=question, metadata__active=True).exists():
                AuditLog.objects.create(action='FAQ_RECORD', description=question, metadata={'question': question, 'answer': answer, 'tags': tags, 'active': True})
