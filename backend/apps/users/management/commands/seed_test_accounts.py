import os
import random
from datetime import datetime, timedelta
from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
from django.utils import timezone
from users.models import Customer
from booking.models import Service, Package, Booking
from inventory.models import Supplier, Category, Product, StockMovement
from chatbot.models import ChatbotFAQ
from sales.models import DailySalesSummary

User = get_user_model()

class Command(BaseCommand):
    help = 'Seeds the database with test accounts, services, packages, products, FAQs, and sales history.'

    def handle(self, *args, **options):
        self.stdout.write('Seeding database...')

        # 1. Seed Users and Profiles
        self.seed_users()

        # 2. Seed Services and Packages
        self.seed_booking_services()

        # 3. Seed Suppliers and Categories
        self.seed_inventory_base()

        # 4. Seed Products and Inventory
        self.seed_products()

        # 5. Seed Chatbot FAQs
        self.seed_faqs()

        # 6. Seed Historical Sales (60 Days)
        self.seed_sales_history()

        self.stdout.write(self.style.SUCCESS('Database seeded successfully!'))

    def seed_users(self):
        self.stdout.write('Creating users...')
        
        # Admin
        admin, created = User.objects.get_or_create(
            username='admin',
            email='admin@test.com',
            defaults={
                'role': 'ADMIN',
                'first_name': 'CAV',
                'last_name': 'Admin',
                'is_staff': True,
                'is_superuser': True
            }
        )
        if created or not admin.check_password('Admin123!'):
            admin.set_password('Admin123!')
            admin.save()

        # Staff
        staff, created = User.objects.get_or_create(
            username='staff',
            email='staff@test.com',
            defaults={
                'role': 'STAFF',
                'first_name': 'CAV',
                'last_name': 'Staff',
                'is_staff': True
            }
        )
        if created or not staff.check_password('Staff123!'):
            staff.set_password('Staff123!')
            staff.save()

        # Customer
        customer_user, created = User.objects.get_or_create(
            username='customer',
            email='customer@test.com',
            defaults={
                'role': 'CUSTOMER',
                'first_name': 'CAV',
                'last_name': 'Customer'
            }
        )
        if created or not customer_user.check_password('Customer123!'):
            customer_user.set_password('Customer123!')
            customer_user.save()

        # Customer profile
        Customer.objects.get_or_create(
            user=customer_user,
            defaults={
                'points': 150,
                'loyalty_tier': 'Bronze',
                'notes': 'Demo customer account.'
            }
        )

    def seed_booking_services(self):
        self.stdout.write('Creating services and packages...')
        
        # Self-Shoot Service
        self_shoot, _ = Service.objects.get_or_create(
            name='Self-Shoot Studio',
            defaults={
                'description': 'Enjoy a private studio session with professional cameras, lighting, and trigger buttons.',
                'duration_minutes': 30,
                'base_price': 500.00,
                'image_url': 'https://images.unsplash.com/photo-1542038784456-1ea8e935640e?q=80&w=600'
            }
        )

        Package.objects.get_or_create(
            service=self_shoot,
            name='Single Session',
            defaults={
                'price': 500.00,
                'description': 'Perfect for solo shoots.',
                'inclusions': '30 mins studio shoot, 15 mins photo selection, 1 digital soft copy'
            }
        )

        Package.objects.get_or_create(
            service=self_shoot,
            name='Duo Pack',
            defaults={
                'price': 800.00,
                'description': 'Bring a friend or partner.',
                'inclusions': '45 mins studio shoot, 15 mins photo selection, 2 digital soft copies, 2 premium prints'
            }
        )

        # Portrait Service
        portrait, _ = Service.objects.get_or_create(
            name='Boutique Portrait',
            defaults={
                'description': 'Professional studio portrait taken by our resident photographer.',
                'duration_minutes': 60,
                'base_price': 1200.00,
                'image_url': 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?q=80&w=600'
            }
        )

        Package.objects.get_or_create(
            service=portrait,
            name='Solo Premium',
            defaults={
                'price': 1500.00,
                'description': 'Executive, business, or premium graduation portrait.',
                'inclusions': '60 mins shoot by photographer, professional editing, 5 soft copies, 2 premium physical prints'
            }
        )

    def seed_inventory_base(self):
        self.stdout.write('Creating suppliers and categories...')
        
        self.coffee_supplier, _ = Supplier.objects.get_or_create(
            name='Manila Coffee Roasters',
            defaults={
                'contact_person': 'Juan Dela Cruz',
                'email': 'juan@manilacoffee.com',
                'phone': '+639171234567',
                'address': 'Quezon City, Metro Manila'
            }
        )

        self.paper_supplier, _ = Supplier.objects.get_or_create(
            name='Studio Paper Supplies Corp',
            defaults={
                'contact_person': 'Maria Santos',
                'email': 'maria@studiosupplies.com',
                'phone': '+639187654321',
                'address': 'Pasig City, Metro Manila'
            }
        )

        self.cat_beverages, _ = Category.objects.get_or_create(name='Beverages', defaults={'description': 'Espresso-based coffees, teas, and refreshers'})
        self.cat_snacks, _ = Category.objects.get_or_create(name='Snacks', defaults={'description': 'Freshly baked pastries and sandwiches'})
        self.cat_supplies, _ = Category.objects.get_or_create(name='Photo Supplies', defaults={'description': 'Studio printing paper, frames, and print assets'})

    def seed_products(self):
        self.stdout.write('Creating products...')
        
        # Espresso
        espresso, created = Product.objects.get_or_create(
            name='Espresso',
            defaults={
                'sku': 'CAFE-ESP',
                'category': self.cat_beverages,
                'supplier': self.coffee_supplier,
                'cost': 30.00,
                'price': 90.00,
                'stock_level': 150,
                'reorder_point': 20,
                'is_cafe_item': True,
                'image_url': 'https://images.unsplash.com/photo-1510707513156-476725f37722?q=80&w=400'
            }
        )
        if created:
            StockMovement.objects.create(product=espresso, movement_type='IN', quantity=150, reason='Initial stock seeding')

        # Iced Latte
        latte, created = Product.objects.get_or_create(
            name='Iced Latte',
            defaults={
                'sku': 'CAFE-LAT',
                'category': self.cat_beverages,
                'supplier': self.coffee_supplier,
                'cost': 45.00,
                'price': 130.00,
                'stock_level': 100,
                'reorder_point': 20,
                'is_cafe_item': True,
                'image_url': 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?q=80&w=400'
            }
        )
        if created:
            StockMovement.objects.create(product=latte, movement_type='IN', quantity=100, reason='Initial stock seeding')

        # Chocolate Croissant
        croissant, created = Product.objects.get_or_create(
            name='Chocolate Croissant',
            defaults={
                'sku': 'CAFE-CRO',
                'category': self.cat_snacks,
                'cost': 35.00,
                'price': 85.00,
                'stock_level': 30,
                'reorder_point': 10,
                'is_cafe_item': True,
                'image_url': 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?q=80&w=400'
            }
        )
        if created:
            StockMovement.objects.create(product=croissant, movement_type='IN', quantity=30, reason='Initial stock seeding')

        # Low stock item: Photo Paper A4
        photo_paper, created = Product.objects.get_or_create(
            name='Premium Glossy A4 Paper',
            defaults={
                'sku': 'STUDIO-PPA4',
                'category': self.cat_supplies,
                'supplier': self.paper_supplier,
                'cost': 150.00,
                'price': 350.00,
                'stock_level': 3,  # BELOW REORDER POINT (5)!
                'reorder_point': 10,
                'is_cafe_item': False,
                'image_url': 'https://images.unsplash.com/photo-1603481588273-2f908a9a7a1b?q=80&w=400'
            }
        )
        if created:
            StockMovement.objects.create(product=photo_paper, movement_type='IN', quantity=3, reason='Initial stock seeding')

    def seed_faqs(self):
        self.stdout.write('Creating chatbot FAQs...')
        
        ChatbotFAQ.objects.get_or_create(
            question="What are your operating hours?",
            defaults={
                "answer": "CAV Photo Studio and Café is open daily from 9:00 AM to 8:00 PM. The café accepts orders until 7:30 PM, and the last studio session booking is at 7:00 PM.",
                "tags": "hours,schedule,open"
            }
        )

        ChatbotFAQ.objects.get_or_create(
            question="How do I book a studio session?",
            defaults={
                "answer": "You can book directly from our website! Simply log in, navigate to 'Book Session' from your dashboard, choose your desired Service (Self-Shoot or Boutique Portrait) and Package, select an available date and time, and submit your booking.",
                "tags": "book,booking,session,reserve"
            }
        )

        ChatbotFAQ.objects.get_or_create(
            question="What packages do you offer for photo studio?",
            defaults={
                "answer": "We offer 'Self-Shoot Studio' starting at PHP 500 (Duo pack at PHP 800) and 'Boutique Portrait' starting at PHP 1,500. Each package includes specific session lengths, digital soft copies, and physical printouts. You can see full package details in our portal under Packages.",
                "tags": "packages,price,studio,selfshoot,portrait"
            }
        )

        ChatbotFAQ.objects.get_or_create(
            question="Can we walk in for café or photo studio?",
            defaults={
                "answer": "Yes! The café is open to walk-ins anytime during operating hours. For the photo studio, we accept walk-ins depending on room availability, but we highly recommend booking online in advance to secure your slot.",
                "tags": "walkin,walk-in,café,studio"
            }
        )

        ChatbotFAQ.objects.get_or_create(
            question="Where is CAV located?",
            defaults={
                "answer": "We are located at 123 Capstone Drive, Barangay Loyola, Quezon City, Metro Manila. We have free parking spaces in front of the shop!",
                "tags": "location,address,where,directions"
            }
        )

    def seed_sales_history(self):
        self.stdout.write('Creating historical sales data (60 days)...')
        
        # Generate sales history for the past 60 days
        start_date = datetime.now().date() - timedelta(days=60)
        
        for i in range(61):
            date = start_date + timedelta(days=i)
            
            # Base revenue
            base_pos = 2000.00
            base_booking = 1500.00
            
            # Weekend effect (seasonality)
            is_weekend = date.weekday() in [5, 6]  # Saturday, Sunday
            weekend_multiplier = 2.2 if is_weekend else 1.0
            
            # Growth trend over 60 days
            trend_multiplier = 1.0 + (i * 0.008)
            
            # Random noise (+/- 15%)
            noise = random.uniform(0.85, 1.15)
            
            # Compute day's revenues
            pos_revenue = base_pos * weekend_multiplier * trend_multiplier * noise
            booking_revenue = base_booking * weekend_multiplier * trend_multiplier * noise
            total_revenue = pos_revenue + booking_revenue
            transaction_count = random.randint(15, 30) if is_weekend else random.randint(8, 15)
            
            # Create or update summary
            DailySalesSummary.objects.update_or_create(
                date=date,
                defaults={
                    'total_revenue': round(total_revenue, 2),
                    'pos_revenue': round(pos_revenue, 2),
                    'booking_revenue': round(booking_revenue, 2),
                    'transaction_count': transaction_count
                }
            )
