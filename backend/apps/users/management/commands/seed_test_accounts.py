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
        studio, _ = Service.objects.get_or_create(
            name='Studio Session',
            defaults={
                'description': 'Standard studio photo session packages for solo, couple, friends, family, and birthdays.',
                'duration_minutes': 60,
                'base_price': 1000.00,
                'image_url': '/assets/pics/solo/solo%20pic%20landscape.jpg',
            },
        )
        events, _ = Service.objects.get_or_create(
            name='Photo Service Booking',
            defaults={
                'description': 'Full-service booking process for events and extended photoshoots.',
                'duration_minutes': 120,
                'base_price': 2500.00,
                'image_url': '/assets/pics/events/standard%20event%20package.jpg',
            },
        )
        for service, name, price, description, inclusions in [
            (studio, 'Solo Package', 1000.00, '1 person / 5 shots', '1 person, 5 shots, studio lighting, backdrop selection, basic retouching, digital soft copies'),
            (studio, 'Mr. & Ms. / Couple Package', 1000.00, '2 persons / 10 shots', '2 persons, 10 shots, studio lighting, backdrop selection, basic retouching, digital soft copies'),
            (studio, 'Mr. & Ms. Friends Package', 1000.00, '3-5 persons / 15 shots', '3-5 persons, 15 shots, studio lighting, backdrop selection, basic retouching, digital soft copies'),
            (studio, 'Family Package', 1500.00, '2-6 persons / 15 shots', '2-6 persons, 15 shots, studio lighting, backdrop selection, basic retouching, digital soft copies'),
            (studio, 'Birthday Package', 1500.00, '1-4 persons / 15 shots', '1-4 persons, 15 shots, studio lighting, backdrop selection, basic retouching, digital soft copies, birthday props'),
            (events, 'Standard Event Package', 2500.00, '2 hours event/program photoshoot', '2 hours coverage, availability validation, layout setup, printing coordination, final digital file record'),
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
            ("What are your operating hours?", "CAV Photo Studio and Cafe is open daily from 9:00 AM to 7:00 PM Philippine time (Asia/Manila, UTC+8).", "hours,schedule,open"),
            ("How do I book a studio session?", "Log in, open Book Session, choose a package, select a date and time, then submit your booking.", "book,booking,session,reserve"),
            ("Where is CAV located?", "CAV is located at 028B M.P. Casanova St., Purok 1, Tambo, Lipa City, Batangas.", "location,address,where,directions"),
        ]
        for question, answer, tags in faqs:
            if not AuditLog.objects.filter(action='FAQ_RECORD', metadata__question=question, metadata__active=True).exists():
                AuditLog.objects.create(action='FAQ_RECORD', description=question, metadata={'question': question, 'answer': answer, 'tags': tags, 'active': True})
